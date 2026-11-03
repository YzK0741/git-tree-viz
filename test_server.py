import os
import json
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

import server


class CommitDetailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.path.dirname(__file__), ignore_cleanup_errors=True)
        self.addCleanup(self.tmp.cleanup)
        self.repo = self.tmp.name
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Test Author')
        self.git('config', 'user.email', 'author@example.com')
        self.write('hello.txt', 'first\n')
        self.git('add', '.')
        self.git('commit', '-m', 'initial')
        self.root = self.git('rev-parse', 'HEAD').strip()
        self.write('hello.txt', 'first\nsecond\n')
        self.git('commit', '-am', 'update')
        self.tip = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', self.repo, *args], encoding='utf-8')

    def write(self, path, content):
        with open(os.path.join(self.repo, path), 'w', encoding='utf-8', newline='') as f:
            f.write(content)

    def detail(self, *args, **kwargs):
        fn = getattr(server, 'load_commit_detail', None)
        self.assertTrue(callable(fn), 'commit detail API is missing')
        return fn(self.repo, *args, **kwargs)

    def test_root_diff_and_changed_file(self):
        detail = self.detail(self.root)
        self.assertEqual(detail['parents'], [])
        self.assertEqual(detail['files'][0]['path'], 'hello.txt')
        self.assertEqual(detail['files'][0]['status'], 'A')
        self.assertEqual(detail['files'][0]['additions'], 1)
        self.assertIn('+first', detail['patch'])

    def test_parent_diff_and_metadata(self):
        detail = self.detail(self.tip)
        self.assertEqual(detail['hash'], self.tip)
        self.assertEqual(detail['parents'], [self.root])
        self.assertEqual(detail['files'][0]['additions'], 1)
        self.assertIn('+second', detail['patch'])
        self.assertEqual(detail['base'], self.root)

    def test_reject_invalid_hash_and_parent(self):
        for rev in ['--all', 'HEAD', 'bad/path']:
            with self.subTest(rev=rev), self.assertRaises(ValueError):
                self.detail(rev)
        with self.assertRaises(ValueError):
            self.detail(self.tip, parent=2)

    def test_merge_can_compare_either_parent(self):
        self.git('checkout', '-b', 'feature', self.root)
        self.write('feature.txt', 'feature\n')
        self.git('add', '.')
        self.git('commit', '-m', 'feature')
        feature = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', 'main')
        self.git('merge', '--no-ff', 'feature', '-m', 'merge')
        merge = self.git('rev-parse', 'HEAD').strip()
        first = self.detail(merge, parent=0)
        second = self.detail(merge, parent=1)
        self.assertEqual(first['base'], self.tip)
        self.assertEqual(second['base'], feature)
        self.assertEqual(first['files'][0]['path'], 'feature.txt')
        self.assertEqual(second['files'][0]['path'], 'hello.txt')

    def test_binary_and_unicode_path(self):
        self.write('中文 file.txt', '你好\n')
        with open(os.path.join(self.repo, 'binary.dat'), 'wb') as f:
            f.write(b'\0binary')
        self.git('add', '.')
        self.git('commit', '-m', 'files')
        detail = self.detail(self.git('rev-parse', 'HEAD').strip())
        files = {f['path']: f for f in detail['files']}
        self.assertIn('中文 file.txt', files)
        self.assertIsNone(files['binary.dat']['additions'])

    def test_batch_metrics_include_root_and_normal_commit(self):
        fn = getattr(server, 'load_commit_metrics', None)
        self.assertTrue(callable(fn), 'batch change metrics API is missing')
        metrics = fn(self.repo)
        self.assertEqual(metrics[self.root], {'additions': 1, 'deletions': 0, 'files': 1, 'edits': 1})
        self.assertEqual(metrics[self.tip], {'additions': 1, 'deletions': 0, 'files': 1, 'edits': 1})

    def test_batch_metrics_count_binary_and_merge_against_first_parent(self):
        fn = getattr(server, 'load_commit_metrics', None)
        self.assertTrue(callable(fn), 'batch change metrics API is missing')
        self.git('checkout', '-b', 'feature', self.root)
        with open(os.path.join(self.repo, 'binary.dat'), 'wb') as f:
            f.write(b'\0binary')
        self.write('中文 file.txt', 'new\nlines\n')
        self.git('add', '.')
        self.git('commit', '-m', 'files')
        self.git('checkout', 'main')
        self.git('merge', '--no-ff', 'feature', '-m', 'merge')
        merge = self.git('rev-parse', 'HEAD').strip()
        self.assertEqual(fn(self.repo)[merge], {'additions': 2, 'deletions': 0, 'files': 2, 'edits': 2})


class ExportTests(unittest.TestCase):
    git = CommitDetailTests.git
    write = CommitDetailTests.write

    def setUp(self):
        CommitDetailTests.setUp(self)
        # Destinations are siblings of the source, under the temporary workspace.
        self.output = tempfile.TemporaryDirectory(dir=os.path.dirname(__file__), ignore_cleanup_errors=True)
        self.addCleanup(self.output.cleanup)
        self.destination = os.path.join(self.output.name, '导出 version')

    def export(self, commit=None, **options):
        fn = getattr(server, 'export_commit', None)
        self.assertTrue(callable(fn), 'commit export is missing')
        return fn(self.repo, commit or self.root, self.destination, **options)

    def test_snapshot_is_selected_commit_not_dirty_worktree(self):
        self.write('hello.txt', 'dirty\n')
        self.write('untracked.txt', 'untracked\n')
        result = self.export()
        with open(os.path.join(self.destination, 'hello.txt'), 'rb') as f:
            self.assertEqual(f.read(), b'first\n')
        self.assertFalse(os.path.exists(os.path.join(self.destination, '.git')))
        self.assertFalse(os.path.exists(os.path.join(self.destination, 'untracked.txt')))
        self.assertEqual(result['hash'], self.root)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.tip)
        with open(os.path.join(self.repo, 'hello.txt'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'dirty\n')

    def test_snapshot_keeps_export_ignore_files_and_binary_bytes(self):
        self.write('.gitattributes', 'hello.txt export-ignore\n')
        with open(os.path.join(self.repo, 'binary.dat'), 'wb') as f:
            f.write(b'\x00\xff\r\n')
        self.git('add', '.')
        self.git('commit', '-m', 'binary and attributes')
        self.export(self.git('rev-parse', 'HEAD').strip())
        self.assertTrue(os.path.isfile(os.path.join(self.destination, 'hello.txt')))
        with open(os.path.join(self.destination, 'binary.dat'), 'rb') as f:
            self.assertEqual(f.read(), b'\x00\xff\r\n')

    def test_git_export_has_history_and_selected_branch(self):
        self.export(include_git=True, branch='review/version')
        self.assertTrue(os.path.isdir(os.path.join(self.destination, '.git')))
        def git(*args):
            return subprocess.check_output(['git', '-C', self.destination, *args], encoding='utf-8').strip()
        self.assertEqual(git('rev-parse', 'HEAD'), self.root)
        self.assertEqual(git('branch', '--show-current'), 'review/version')
        self.assertEqual(git('log', '-1', '--format=%s'), 'initial')
        self.assertFalse(os.path.isfile(os.path.join(self.destination, '.git', 'objects', 'info', 'alternates')))

    def test_empty_destination_allowed_and_nonempty_protected(self):
        os.mkdir(self.destination)
        self.export()
        with self.assertRaises(ValueError):
            self.export()
        with open(os.path.join(self.destination, 'hello.txt'), 'rb') as f:
            self.assertEqual(f.read(), b'first\n')

    def test_git_export_without_branch_detaches_head(self):
        self.export(include_git=True)
        self.assertEqual(server._git(self.destination, 'rev-parse', 'HEAD').strip(), self.root)
        self.assertEqual(server._git(self.destination, 'branch', '--show-current').strip(), '')
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.tip)

    def test_failed_export_preserves_empty_destination_and_cleans_staging(self):
        os.mkdir(self.destination)
        with mock.patch.object(server, '_snapshot_files', side_effect=RuntimeError('test failure')):
            with self.assertRaises(RuntimeError):
                self.export()
        self.assertEqual(os.listdir(self.destination), [])
        self.assertFalse(any(name.startswith('.git-tree-export-') for name in os.listdir(self.output.name)))

    def test_invalid_revision_branch_and_destination_leave_no_output(self):
        with self.assertRaises(ValueError):
            self.export('--all')
        with self.assertRaises((ValueError, RuntimeError)):
            self.export(include_git=True, branch='bad..branch')
        self.assertFalse(os.path.exists(self.destination))
        fn = getattr(server, 'export_commit')
        for dest in (self.repo, os.path.join(self.repo, 'export'), 'relative-path', ''):
            with self.subTest(dest=dest), self.assertRaises(ValueError):
                fn(self.repo, self.root, dest)

    def test_preflight_reports_submodules_and_lfs(self):
        self.write('.gitattributes', '*.bin filter=lfs diff=lfs merge=lfs -text\n')
        self.git('add', '.')
        self.git('update-index', '--add', '--cacheinfo', '160000,' + self.root + ',vendor/module')
        self.git('commit', '-m', 'special files')
        fn = getattr(server, 'load_export_info', None)
        self.assertTrue(callable(fn), 'export preflight is missing')
        info = fn(self.repo, self.git('rev-parse', 'HEAD').strip())
        self.assertEqual(info['submodules'], ['vendor/module'])
        self.assertTrue(info['lfs'])
        self.assertTrue(info['warnings'])

    def test_http_export_and_cross_origin_protection(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        httpd.default_repo = self.repo
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = 'http://127.0.0.1:' + str(httpd.server_port)
        payload = json.dumps({'repo': self.repo, 'hash': self.root, 'destination': self.destination}).encode()
        request = urllib.request.Request(base + '/api/export', data=payload,
            headers={'Content-Type': 'application/json', 'Origin': 'https://unrelated.example'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request)
        self.assertEqual(caught.exception.code, 400)
        caught.exception.close()
        self.assertFalse(os.path.exists(self.destination))
        request = urllib.request.Request(base + '/api/export', data=payload,
            headers={'Content-Type': 'application/json', 'Origin': base})
        with urllib.request.urlopen(request) as response:
            result = json.load(response)
        self.assertTrue(result['ok'])
        self.assertEqual(result['data']['hash'], self.root)
        self.assertTrue(os.path.isfile(os.path.join(self.destination, 'hello.txt')))


class TagTests(unittest.TestCase):
    git = CommitDetailTests.git
    write = CommitDetailTests.write

    def setUp(self):
        CommitDetailTests.setUp(self)
        self.token = server.set_write_access(self.repo, True)['token']

    def create(self, name='review/test', commit=None):
        fn = getattr(server, 'create_tag', None)
        self.assertTrue(callable(fn), 'tag creation is missing')
        return fn(self.repo, commit or self.root, name, self.token)

    def test_create_and_undo_without_changing_head_or_worktree(self):
        self.write('hello.txt', 'dirty\n')
        result = self.create()
        self.assertEqual(self.git('rev-parse', 'refs/tags/review/test').strip(), self.root)
        self.assertEqual(self.git('rev-parse', 'HEAD').strip(), self.tip)
        self.create('review/second', self.tip)
        self.git('tag', 'manual-tag', self.root)
        # Ownership is stored in Git refs and remains available after reloading the page/server.
        self.assertEqual(len(server.load_owned_tags(self.repo)), 2)
        undo = server.undo_all_tags(self.repo, self.token)
        self.assertEqual(set(undo['removed']), {'review/test', 'review/second'})
        self.assertEqual(self.git('tag', '--list', 'review/test').strip(), '')
        self.assertEqual(self.git('tag', '--list', 'manual-tag').strip(), 'manual-tag')
        with open(os.path.join(self.repo, 'hello.txt'), encoding='utf-8') as f:
            self.assertEqual(f.read(), 'dirty\n')

    def test_existing_tag_is_not_overwritten(self):
        self.create()
        with self.assertRaises((ValueError, RuntimeError)):
            self.create(commit=self.tip)
        self.assertEqual(self.git('rev-parse', 'refs/tags/review/test').strip(), self.root)

    def test_manual_tag_never_becomes_software_owned(self):
        self.git('tag', 'review/test', self.root)
        with self.assertRaises(RuntimeError):
            self.create()
        self.assertEqual(server.load_owned_tags(self.repo), [])
        self.assertEqual(server.undo_all_tags(self.repo, self.token)['removed'], [])
        self.assertEqual(self.git('tag', '--list', 'review/test').strip(), 'review/test')

    def test_undo_skips_moved_tags_and_removes_others(self):
        result = self.create()
        self.create('review/safe')
        self.git('update-ref', 'refs/tags/review/test', self.tip)
        undo = server.undo_all_tags(self.repo, self.token)
        self.assertEqual(undo['skipped'], ['review/test'])
        self.assertEqual(undo['removed'], ['review/safe'])
        self.assertEqual(self.git('rev-parse', 'refs/tags/review/test').strip(), self.tip)

    def test_invalid_tag_and_repeated_undo(self):
        for name in ('', '-bad', 'bad..name', 'has space', 'refs/tags/no', 'HEAD'):
            with self.subTest(name=name), self.assertRaises((ValueError, RuntimeError)):
                self.create(name)
        result = self.create('版本/v1')
        server.undo_all_tags(self.repo, self.token)
        self.assertEqual(server.undo_all_tags(self.repo, self.token)['removed'], [])

    def test_read_only_blocks_both_creation_and_rollback(self):
        self.create()
        server.set_write_access(self.repo, False, self.token)
        with self.assertRaises(ValueError):
            self.create('blocked')
        with self.assertRaises(ValueError):
            server.undo_all_tags(self.repo, self.token)
        self.assertEqual(self.git('tag', '--list', 'review/test').strip(), 'review/test')


if __name__ == '__main__':
    unittest.main()
