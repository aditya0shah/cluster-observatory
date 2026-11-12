import unittest
from snapshot_cache import merge_snapshot, save_snapshot
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import errno
import json


class SnapshotCacheTests(unittest.TestCase):
    def test_failed_panels_keep_last_success_without_marking_it_fresh(self):
        old = dict(collected_at='old', allocations=[{'account': 'lab'}],
                   allocation_error=None, weirdlab_gpu_activity={'jobs': [{'id': '1'}], 'error': None})
        failed = dict(collected_at='new', allocations=[], allocation_error='timeout',
                      weirdlab_gpu_activity={'jobs': [], 'error': 'timeout'})
        result = merge_snapshot(old, failed)
        self.assertEqual(result['allocations'], old['allocations'])
        self.assertEqual(result['allocations_collected_at'], 'old')
        self.assertEqual(result['weirdlab_gpu_activity']['jobs'], [{'id': '1'}])
        self.assertEqual(result['weirdlab_gpu_activity']['collected_at'], 'old')
        self.assertEqual(result['weirdlab_gpu_activity']['error'], 'timeout')
        again = merge_snapshot(result, dict(failed, collected_at='later'))
        self.assertEqual(again['allocations_collected_at'], 'old')
        self.assertEqual(again['weirdlab_gpu_activity']['collected_at'], 'old')

    def test_successful_empty_result_clears_old_jobs(self):
        old = dict(collected_at='old', allocations=[{'account': 'lab'}],
                   weirdlab_gpu_activity={'jobs': [{'id': '1'}], 'error': None})
        current = dict(collected_at='new', allocations=[], allocation_error=None,
                       weirdlab_gpu_activity={'jobs': [], 'error': None})
        result = merge_snapshot(old, current)
        self.assertEqual(result['allocations'], [])
        self.assertEqual(result['allocations_collected_at'], 'new')
        self.assertEqual(result['weirdlab_gpu_activity']['jobs'], [])
        self.assertEqual(result['weirdlab_gpu_activity']['collected_at'], 'new')

    def test_first_failure_never_gets_a_success_timestamp(self):
        failed = dict(collected_at='new', allocations=[], allocation_error='timeout',
                      weirdlab_gpu_activity={'jobs': [], 'error': 'timeout'})
        result = merge_snapshot(None, failed)
        self.assertNotIn('allocations_collected_at', result)
        self.assertNotIn('collected_at', result['weirdlab_gpu_activity'])


class DiskCacheTests(unittest.TestCase):
    def test_disk_full_is_nonfatal_preserves_cache_and_recovers(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshots.json'
            path.write_text('{"old": true}')
            with patch.object(Path, 'write_text', side_effect=OSError(errno.ENOSPC, 'No space left on device')):
                error = save_snapshot(path, {'new': True})
            self.assertIn('No space left on device', error)
            self.assertEqual(json.loads(path.read_text()), {'old': True})
            self.assertFalse(path.with_suffix('.tmp').exists())
            self.assertIsNone(save_snapshot(path, {'new': True}))
            self.assertEqual(json.loads(path.read_text()), {'new': True})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
