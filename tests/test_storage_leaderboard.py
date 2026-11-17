import unittest
from collect import parse_storage_leaderboard, parse_storage_leaderboard_csv, storage_bytes
from snapshot_cache import merge_storage


class StorageLeaderboardTests(unittest.TestCase):
    def test_klone_orders_by_bytes_and_percentage_uses_lab_usage(self):
        report = '''Usage report for /mmfs1/gscratch/weirdlab
│ Total: │ 2TB / 4TB │ 100 / 200 files │
│ My usage: │ 512GB │ 10 files │
Usage by user:
│ bob │ 512GB (25%) │ 10 files (10%) │
│ alice │ 1TB (50%) │ 20 files (20%) │
│ 12345 │ 0GB (0%) │ 0 files (0%) │'''
        board = parse_storage_leaderboard(report)
        self.assertEqual([m['user'] for m in board['members']], ['alice', 'bob', '12345'])
        self.assertEqual(board['members'][0]['percent_of_lab_used'], 50)
        self.assertEqual(board['members'][1]['percent_of_lab_used'], 25)
        self.assertEqual(board['members'][0]['files'], 20)
        self.assertEqual(storage_bytes('1TiB'), 1024**4)
        self.assertIsNone(storage_bytes('unknown'))

    def test_tillicum_csv_is_limited_to_weirdlab(self):
        report = '''path,type,id,kib_used,kib_max,files
/gpfs/projects/weirdlab,fileset,project-weirdlab,400,1000,30
/gpfs/projects/weirdlab,user,bob,100,0,10
/gpfs/projects/weirdlab,user,alice,300,0,20
/gpfs/projects/other,user,outsider,9999,0,99
'''
        board = parse_storage_leaderboard_csv(report)
        self.assertEqual([m['user'] for m in board['members']], ['alice', 'bob'])
        self.assertEqual(board['used_bytes'], 400*1024)
        self.assertEqual(board['quota_bytes'], 1000*1024)
        self.assertEqual(board['members'][0]['percent_of_lab_used'], 75)
        with self.assertRaises(ValueError):
            parse_storage_leaderboard('no per-member data')

    def test_failed_refresh_retains_dated_leaderboard(self):
        old = dict(leaderboard={'members': [{'user': 'alice'}], 'collected_at': 'old', 'error': None})
        result = merge_storage(old, {'leaderboard': {'members': [], 'error': 'timed out'}})
        self.assertEqual(result['leaderboard']['members'], [{'user': 'alice'}])
        self.assertEqual(result['leaderboard']['collected_at'], 'old')
        self.assertEqual(result['leaderboard']['error'], 'timed out')
