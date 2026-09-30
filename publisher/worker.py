#!/usr/bin/env python3
"""DadRides to The Alaska Geek. No MakerOps API or database access."""
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from shared_site import Coordinator


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


OPENER = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))


def fetch(url, headers=None, body=None, limit=4_000_000):
    request_headers = {'User-Agent': 'DadRides-Publisher/1.6.0 (+https://rides.example.com)', **(headers or {})}
    with OPENER.open(urllib.request.Request(url, headers=request_headers, data=body), timeout=30) as response:
        content = response.read(limit + 1)
        if len(content) > limit:
            raise ValueError('Response too large')
        return content


def export_files(job, media):
    mod, release = str(uuid.UUID(job['mod'])), str(uuid.UUID(job['job']))
    slug = job['slug']
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
        raise ValueError('Invalid slug')
    marker = {'job': release, 'mod': mod, 'revision': job['revision'], 'slug': 'dadrides-' + slug, 'published': job['document'] is not None}
    files = {'public/dadrides/' + mod + '.json': json.dumps(marker).encode()}
    m = job['document']
    if m is None:
        return files
    if m['id'] != mod or m['slug'] != slug or len(m['photos']) > 20:
        raise ValueError('Mismatched publication')
    images = {}
    for p in m['photos']:
        digest = p['id']
        if not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('Invalid image identity')
        content = media(digest)
        if len(content) > 3_000_000 or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError('Image checksum mismatch')
        path = '/images/dadrides/' + mod + '/' + digest + '.jpg'
        files['public' + path] = content
        images[digest] = path
    front = {'title': m['title'], 'slug': 'dadrides-' + slug, 'summary': m['summary'], 'publishedAt': m['date'], 'tags': list(dict.fromkeys(['dadrides', 'mods', *m['tags']])), 'draft': False, 'published': True}
    if m['cover']:
        front['coverImage'] = images[m['cover']]
    # Only generated HTML is emitted. User text cannot become Markdown syntax, scripts or frontmatter.
    body = ['<div data-dadrides-release="' + release + '"></div>']
    for key, title in [('story', 'The mod'), ('installation', 'Installation notes'), ('review', 'Review & verdict')]:
        if m[key]:
            body += ['<h2>' + title + '</h2>', '<p>' + html.escape(m[key]).replace('\n', '<br />') + '</p>']
    if m['links']:
        body += ['<h2>Parts &amp; useful links</h2>', '<ul>']
        for link in m['links']:
            url = urllib.parse.urlsplit(link['url'])
            if url.scheme != 'https' or not url.netloc or url.username or url.password:
                raise ValueError('Unsafe public link')
            body.append('<li><a rel="noopener noreferrer" href="' + html.escape(link['url'], quote=True) + '">' + html.escape(link['label']) + '</a></li>')
        body.append('</ul>')
    for p in m['photos']:
        caption = html.escape(p['caption'], quote=True)
        body.append('<figure><img loading="lazy" src="' + images[p['id']] + '" alt="' + caption + '" /><figcaption>' + caption + '</figcaption></figure>')
    article = '---\n' + '\n'.join(key + ': ' + json.dumps(value, ensure_ascii=False) for key, value in front.items()) + '\n---\n\n' + '\n\n'.join(body)
    files['src/content/articles/dadrides-' + slug + '.md'] = article.encode()
    return files


def production_head(config):
    data = json.loads(fetch('https://api.cloudflare.com/client/v4/accounts/' + config['account'] + '/pages/projects/' + config['project'], {'Authorization': 'Bearer ' + config['cf_token']}))
    project = data.get('result') or {}
    head = project.get('canonical_deployment') or {}
    if not data.get('success') or project.get('production_branch') != config['branch'] or head.get('latest_stage', {}).get('status') != 'success':
        raise ValueError('Cannot verify production head')
    return head


def verified(config, job):
    try:
        marker = json.loads(fetch(config['public'] + '/dadrides/' + job['mod'] + '.json?release=' + job['job'], {'Cache-Control': 'no-cache'}))
        if marker.get('job') != job['job'] or marker.get('mod') != job['mod'] or marker.get('revision') != job['revision'] or marker.get('published') != (job['document'] is not None):
            return False
        url = config['public'] + '/articles/dadrides-' + job['slug'] + '/?release=' + job['job']
        if job['document'] is None:
            try:
                fetch(url)
                return False
            except urllib.error.HTTPError as error:
                return error.code == 404
        return ('data-dadrides-release="' + job['job'] + '"').encode() in fetch(url)
    except (urllib.error.URLError, ValueError):
        return False


def run_process(command, cwd, env, heartbeat):
    # Commands are argument arrays; stdout may contain secrets and is never logged.
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 900
            while process.poll() is None:
                if time.monotonic() > deadline or os.fstat(log.fileno()).st_size > 8_000_000:
                    raise RuntimeError('Build timed out')
                heartbeat()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
            if process.returncode:
                raise RuntimeError('Build or deployment failed')
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=30)


def execute(job, config, call):
    dispatched = False
    with Coordinator(config['shared_state'], 'dadrides-' + job['mod'], job['job']) as coord:
        dispatched = coord.pending.exists() and json.loads(coord.pending.read_text(encoding='utf-8')).get('dispatched', False)
        def head():
            return production_head(config)
        def guard():
            if head()['id'] != coord.expected_head(config['initial_head']):
                raise ValueError('Public source changed outside this publisher')
        try:
            if verified(config, job):
                current = head()
                if current['id'] != coord.expected_head(config['initial_head']) and current.get('deployment_trigger', {}).get('metadata', {}).get('commit_message') != 'DadRides release ' + job['job']:
                    raise ValueError('Production head does not belong to this release')
                coord.finish(current['id'])
                return {'state': 'published'}
            guard()
            if not coord.pending.exists():
                files = export_files(job, lambda digest: call(job['job'] + '/media/' + digest, None, job['claim'], True))
                coord.prepare(files)
            source = Path(config['source']).resolve()
            if not (source / 'package-lock.json').exists() or not (source / 'node_modules/astro').is_dir():
                raise ValueError('Authoritative source or locked dependencies missing')
            with tempfile.TemporaryDirectory(prefix='dadrides-', dir=config['work']) as temp:
                site = Path(temp) / 'site'
                shutil.copytree(source, site, ignore=shutil.ignore_patterns('.git', 'node_modules', 'dist', '.astro', '.wrangler', '.env', '.env.*'))
                os.symlink(source / 'node_modules', site / 'node_modules', target_is_directory=True)
                coord.overlay(site)
                heartbeat = lambda: call(job['job'] + '/heartbeat', {}, job['claim'])
                env = {k: os.environ[k] for k in ('PATH', 'LANG', 'TZ', 'SystemRoot', 'COMSPEC') if k in os.environ}
                env.update({'HOME': temp, 'CI': 'true', 'ASTRO_TELEMETRY_DISABLED': '1'})
                run_process([config['npm'], 'run', 'build'], site, env, heartbeat)
                marker = json.loads((site / 'dist/dadrides' / (job['mod'] + '.json')).read_text())
                page = site / 'dist/articles' / ('dadrides-' + job['slug']) / 'index.html'
                if marker['job'] != job['job'] or (job['document'] is not None and (not page.exists() or ('data-dadrides-release="' + job['job'] + '"').encode() not in page.read_bytes())) or (job['document'] is None and page.exists()):
                    raise ValueError('Built publication mismatch')
                guard(); heartbeat()
                coord.mark_dispatched(); dispatched = True
                env.update({'CLOUDFLARE_API_TOKEN': config['cf_token'], 'CLOUDFLARE_ACCOUNT_ID': config['account']})
                run_process([config['node'], config['wrangler'], 'pages', 'deploy', str(site / 'dist'), '--project-name', config['project'], '--branch', config['branch'], '--commit-dirty=true', '--commit-message', 'DadRides release ' + job['job']], site, env, heartbeat)
                for _ in range(12):
                    if verified(config, job):
                        current = head()
                        if current.get('deployment_trigger', {}).get('metadata', {}).get('commit_message') != 'DadRides release ' + job['job']:
                            raise ValueError('Production head changed during verification')
                        coord.finish(current['id'])
                        return {'state': 'published'}
                    heartbeat(); time.sleep(5)
                raise RuntimeError('Publication verification pending')
        except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
            if dispatched:
                # Preserve pending bundle and lease. Retry/reconcile this job after lease expiry.
                return None
            coord.cancel_before_dispatch()
            return {'state': 'failed', 'error': 'source_changed' if isinstance(error, ValueError) and 'outside' in str(error) else 'build' if isinstance(error, RuntimeError) else 'validation'}


def main():
    origin = os.environ['DADRIDES_ORIGIN'].rstrip('/')
    if origin not in ('https://rides.example.com', 'https://dadrides.pages.dev'):
        raise SystemExit('Expected approved DadRides origin')
    token = os.environ['DADRIDES_PUBLISHER_TOKEN']
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', token):
        raise SystemExit('Invalid publisher credential')
    config = {'public': 'https://thealaskageek.com', 'project': 'thealaskageek', 'branch': 'main', 'account': os.environ['CLOUDFLARE_ACCOUNT_ID'], 'cf_token': os.environ['CLOUDFLARE_API_TOKEN'], 'source': os.environ['PUBLICATION_SITE_SOURCE'], 'shared_state': os.environ['PUBLICATION_SHARED_STATE'], 'work': os.environ['DADRIDES_PUBLISHER_WORK'], 'initial_head': os.environ['PUBLICATION_INITIAL_HEAD'], 'wrangler': os.environ['WRANGLER_PATH'], 'npm': shutil.which('npm'), 'node': shutil.which('node')}
    Path(config['work']).mkdir(parents=True, exist_ok=True, mode=0o700)
    def call(path, body=None, claim=None, binary=False):
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
        if claim:
            headers['x-publisher-claim'] = claim
        content = fetch(origin + '/api/publisher/' + path, headers, json.dumps(body).encode() if body is not None else None)
        return content if binary else json.loads(content)
    while True:
        try:
            job = call('claim', {})
            if job.get('job'):
                result = execute(job, config, call)
                if result is not None:
                    call(job['job'] + '/complete', result, job['claim'])
                    print('Publication', job['job'], result['state'], flush=True)
        except (OSError, ValueError, urllib.error.URLError):
            print('Publisher needs attention; retrying. Credentials and content omitted.', flush=True)
        time.sleep(15)


if __name__ == '__main__':
    main()
