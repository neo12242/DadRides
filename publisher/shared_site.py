"""One lock, durable exports and production head for every publisher of the same static site."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re

PUBLIC_PATH = re.compile(r"(?:src/content/articles/[a-z0-9-]+\.md|public/(?:images/(?:articles|dadrides)/[a-z0-9-]+/[a-f0-9]{64}\.(?:jpg|png|webp)|(?:makerops|dadrides)/[a-z0-9-]+\.json))\Z")


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


class Coordinator:
    def __init__(self, root, namespace, job):
        if not re.fullmatch(r'[a-z0-9-]+', namespace) or not re.fullmatch(r'[a-z0-9-]+', job):
            raise ValueError('Invalid publication identity')
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.namespace, self.job = namespace, job
        self.pending = self.root / 'pending.json'
        self.lock = None

    def __enter__(self):
        self.lock = (self.root / 'deployment.lock').open('a+b')
        try:
            if os.name == 'nt':
                import msvcrt
                self.lock.seek(0); self.lock.write(b'0'); self.lock.flush(); self.lock.seek(0)
                msvcrt.locking(self.lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if self.pending.exists():
                pending = json.loads(self.pending.read_text(encoding='utf-8'))
                if pending['namespace'] != self.namespace or pending['job'] != self.job:
                    raise ValueError('Another publication has an uncertain deployment; reconcile it first')
            return self
        except Exception:
            self.lock.close()
            raise

    def __exit__(self, *_):
        self.lock.close()

    def expected_head(self, initial):
        path = self.root / 'production-head.json'
        return json.loads(path.read_text())['id'] if path.exists() else initial

    def packages(self):
        return {p.stem: json.loads(p.read_text(encoding='utf-8')) for p in (self.root / 'exports').glob('*.json')}

    def prepare(self, files):
        """Persist the complete approved export before dispatch; previous files become tombstones."""
        if self.pending.exists():
            return  # Retry uses the durable approved bundle, not mutable inputs.
        packages = self.packages()
        old = packages.get(self.namespace, {'files': {}, 'history': {}})
        history = old.get('history', {})
        for name, content in old['files'].items():
            digest = hashlib.sha256(base64.b64decode(content)).hexdigest()
            history[name] = list(set(history.get(name, []) + [digest]))
        for name, content in files.items():
            if not PUBLIC_PATH.fullmatch(name) or not isinstance(content, bytes):
                raise ValueError('Invalid public export path')
            if any(name in p['files'] or name in p.get('history', {}) for key, p in packages.items() if key != self.namespace):
                raise ValueError('Public path belongs to another publisher')
        package = {'files': {name: base64.b64encode(content).decode('ascii') for name, content in files.items()}, 'history': history}
        atomic_json(self.pending, {'namespace': self.namespace, 'job': self.job, 'package': package})

    def overlay(self, site):
        site = Path(site).resolve()
        packages = self.packages()
        if self.pending.exists():
            p = json.loads(self.pending.read_text(encoding='utf-8'))
            packages[p['namespace']] = p['package']
        for package in packages.values():
            for name in set(package['files']) | set(package.get('history', {})):
                if not PUBLIC_PATH.fullmatch(name):
                    raise ValueError('Invalid persisted export path')
                target = (site / name).resolve()
                if not target.is_relative_to(site):
                    raise ValueError('Export escaped site directory')
                content = base64.b64decode(package['files'][name]) if name in package['files'] else None
                allowed = package.get('history', {}).get(name, []) + ([hashlib.sha256(content).hexdigest()] if content is not None else [])
                if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() not in allowed:
                    raise ValueError('Public source changed outside this publisher')
                if content is None:
                    if target.exists():
                        target.unlink()  # Only a verified, owned export inside the temporary build.
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)

    def finish(self, head):
        if self.pending.exists():
            pending = json.loads(self.pending.read_text(encoding='utf-8'))
            if pending['namespace'] != self.namespace or pending['job'] != self.job:
                raise ValueError('Publication identity changed')
            atomic_json(self.root / 'exports' / (self.namespace + '.json'), pending['package'])
        atomic_json(self.root / 'production-head.json', {'id': head})
        if self.pending.exists():
            self.pending.unlink()

    def cancel_before_dispatch(self):
        if self.pending.exists():
            if not json.loads(self.pending.read_text(encoding='utf-8')).get('dispatched'):
                self.pending.unlink()

    def mark_dispatched(self):
        pending = json.loads(self.pending.read_text(encoding='utf-8'))
        pending['dispatched'] = True
        atomic_json(self.pending, pending)
