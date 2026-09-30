import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid
import worker
from shared_site import Coordinator


def job():
    mod, release = str(uuid.uuid4()), str(uuid.uuid4())
    return {'mod': mod, 'job': release, 'claim': str(uuid.uuid4()), 'slug': 'test-mod', 'revision': 'a' * 64,
            'document': {'id': mod, 'slug': 'test-mod', 'title': 'A mod', 'summary': 'A summary', 'date': '2026-09-24', 'tags': [], 'cover': '', 'photos': [], 'links': [], 'story': 'My build', 'installation': '', 'review': ''}}


class PublisherTests(unittest.TestCase):
    def test_text_cannot_become_scripts_markdown_or_frontmatter(self):
        release = job(); release['document']['story'] = '<script>alert(1)</script>\n[private](https://evil.test)\n---'
        release['document']['title'] = 'Title\n---\nprivate: true'
        files = worker.export_files(release, lambda _: self.fail('Unexpected media read'))
        article = files['src/content/articles/dadrides-test-mod.md'].decode()
        self.assertNotIn('<script>', article); self.assertIn('&lt;script&gt;', article)
        self.assertIn('Title\\n---\\nprivate: true', article)
        release['document']['links'] = [{'label': 'unsafe', 'url': 'javascript:alert(1)'}]
        with self.assertRaises(ValueError): worker.export_files(release, lambda _: b'')

    def test_media_export_requires_matching_hash_and_withdrawal_has_no_article(self):
        release = job(); data = b'jpeg'; digest = hashlib.sha256(data).hexdigest()
        release['document']['photos'] = [{'id': digest, 'caption': '<caption>'}]; release['document']['cover'] = digest
        with self.assertRaises(ValueError): worker.export_files(release, lambda _: b'wrong')
        files = worker.export_files(release, lambda _: data)
        self.assertEqual(len(files), 3)
        release['document'] = None; release['revision'] = None
        files = worker.export_files(release, lambda _: self.fail('Withdrawal must not fetch images'))
        self.assertEqual(len(files), 1); self.assertFalse(json.loads(next(iter(files.values())))['published'])

    def test_two_publishers_preserve_exports_and_owned_withdrawals(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); site = root / 'site'; site.mkdir()
            (site / 'unrelated.txt').write_text('keep')
            one = 'src/content/articles/maker-project.md'; two = 'src/content/articles/dadrides-test.md'
            with Coordinator(root / 'state', 'makerops-1', 'release-one') as c:
                c.prepare({one: b'Maker work'}); c.overlay(site); c.mark_dispatched(); c.finish('head-one')
            with Coordinator(root / 'state', 'dadrides-one', 'release-two') as c:
                self.assertEqual(c.expected_head('initial'), 'head-one')
                c.prepare({two: b'Ride mod'}); c.overlay(site); c.mark_dispatched(); c.finish('head-two')
            self.assertEqual((site / one).read_bytes(), b'Maker work')
            with Coordinator(root / 'state', 'dadrides-one', 'release-three') as c:
                c.prepare({}); c.overlay(site); c.mark_dispatched(); c.finish('head-three')
            self.assertFalse((site / two).exists()); self.assertEqual((site / one).read_bytes(), b'Maker work'); self.assertEqual((site / 'unrelated.txt').read_text(), 'keep')
            with Coordinator(root / 'state', 'makerops-1', 'release-four') as c:
                c.prepare({one: b'Updated maker work'}); c.overlay(site); c.finish('head-four')
            self.assertFalse((site / two).exists())

    def test_other_publisher_cannot_replace_owned_paths_or_uncertain_deployments(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); path = 'src/content/articles/dadrides-one.md'
            with Coordinator(root, 'dadrides-one', 'release-one') as c:
                c.prepare({path: b'original'}); c.mark_dispatched()
            with self.assertRaises(ValueError):
                with Coordinator(root, 'makerops-1', 'release-two'): pass
            with Coordinator(root, 'dadrides-one', 'release-one') as c:
                c.cancel_before_dispatch(); self.assertTrue(c.pending.exists())
                c.finish('head-one')
            with Coordinator(root, 'makerops-1', 'release-two') as c:
                with self.assertRaises(ValueError): c.prepare({path: b'overwrite'})

    def test_unmanaged_source_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); site = root / 'site'; path = site / 'src/content/articles/dadrides-one.md'; path.parent.mkdir(parents=True); path.write_text('unmanaged')
            with Coordinator(root / 'state', 'dadrides-one', 'release-one') as c:
                c.prepare({'src/content/articles/dadrides-one.md': b'new'})
                with self.assertRaises(ValueError): c.overlay(site)
                c.cancel_before_dispatch()
            self.assertEqual(path.read_text(), 'unmanaged')

    def test_already_deployed_release_is_reconciled_without_second_deployment(self):
        with tempfile.TemporaryDirectory() as temp:
            release = job(); config = {'shared_state': temp, 'initial_head': 'before'}
            with Coordinator(temp, 'dadrides-' + release['mod'], release['job']) as c:
                c.prepare(worker.export_files(release, lambda _: b'')); c.mark_dispatched()
            head = {'id': 'after', 'deployment_trigger': {'metadata': {'commit_message': 'DadRides release ' + release['job']}}}
            with patch.object(worker, 'verified', return_value=True), patch.object(worker, 'production_head', return_value=head), patch.object(worker, 'run_process', side_effect=AssertionError('Redeployed')):
                self.assertEqual(worker.execute(release, config, lambda *_: None), {'state': 'published'})
            self.assertFalse((Path(temp) / 'pending.json').exists())


if __name__ == '__main__': unittest.main()
