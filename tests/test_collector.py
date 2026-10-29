import unittest
from unittest.mock import patch
import collect


class CollectorTests(unittest.TestCase):
    def test_account_allocation_rows_remain_separate(self):
        output = '''│ lab │ gpu-a40 │ 52 │ 1000G │ 8 │ TOTAL │
│ │ │ 20 │ 200G │ 3 │ USED │
│ │ │ 32 │ 800G │ 5 │ FREE │
│ other │ gpu-a40 │ 26 │ 500G │ 4 │ TOTAL │
│ │ │ 10 │ 100G │ 1 │ USED │
│ │ │ 16 │ 400G │ 3 │ FREE │'''
        rows = collect.parse_allocations(output)
        self.assertEqual([r['account'] for r in rows], ['lab', 'other'])
        self.assertEqual(rows[0]['free']['gpus'], 5)
        self.assertEqual(rows[1]['total']['gpus'], 4)
        self.assertEqual(collect.parse_allocations('no allocation data'), [])

    def test_distinct_nodes_and_pending_exclusion(self):
        def run(args, timeout=18):
            if args[0] == 'squeue':
                return ('1|first|RUNNING|gpu-a40|1|8|gres/gpu:a40:1|1:00|2:00|n1|gpu-a40-lab|n1\n'
                        '2|second|RUNNING|gpu-a40|1|4|gres/gpu:2|1:00|2:00|n1|gpu-a40-lab|n1\n'
                        '3|waiting|PENDING|gpu-a40|1|16|gres/gpu:1|0:00|2:00|(Resources)|gpu-a40-lab|\n')
            if args[:3] == ['scontrol', 'show', 'nodes']:
                return ('NodeName=n1 CPUEfctv=52 CPUAlloc=12 CfgTRES=gres/gpu=8,gres/gpu:a40=8 AllocTRES=gres/gpu=3,gres/gpu:a40=3 Partitions=gpu-a40,ckpt State=MIXED RealMemory=1000 Gres=gpu:a40:8\n'
                        'NodeName=n2 CPUEfctv=52 CPUAlloc=0 CfgTRES=gres/gpu=8 AllocTRES=cpu=0 Partitions=gpu-a40 State=IDLE+DRAIN RealMemory=1000 Gres=gpu:a40:8')
            if args[:3] == ['scontrol', 'show', 'hostnames']:
                return 'n1\n'
            if args[0] == 'sacctmgr':
                return 'gpu-a40-lab||normal\n'
            return ''
        with patch.object(collect, 'run', side_effect=run):
            snapshot = collect.snapshot()
        self.assertEqual(snapshot['usage'], dict(nodes=1, cpus=12, gpus=3, running=2, pending=1))
        self.assertEqual(snapshot['nodes'][0]['gpus'], 8)
        self.assertFalse(snapshot['nodes'][1]['schedulable'])


if __name__ == '__main__':
    unittest.main()
