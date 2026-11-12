import unittest
from unittest.mock import patch
import collect


class CollectorTests(unittest.TestCase):
    def test_timeout_cleans_up_child_processes_holding_output_pipes(self):
        import sys
        import time
        started = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            collect.run([sys.executable, '-c',
                         'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c","import time;time.sleep(10)"]);time.sleep(10)'], timeout=0.2)
        self.assertLess(time.monotonic() - started, 2)


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

    def test_weirdlab_allocated_gpu_counts_and_scope(self):
        records = [
            dict(job_id=1, user_name='alice', account='gpu-a40-weirdlab', job_state=['RUNNING'],
                 tres_alloc_str='gres/gpu=6,gres/gpu:a40=6', nodes='g[1-2]'),
            dict(job_id=2, user_name='alice', account='ckpt-weirdlab', job_state=['COMPLETING'],
                 tres_alloc_str='gres/gpu=2', gres_detail=['gpu:l40s:2(IDX:0-1)'], nodes='g3'),
            dict(job_id=3, account='weirdlab', job_state='SUSPENDED',
                 tres_alloc_str='gres/gpu=1', nodes='g4'),
            dict(job_id=4, account='gpu-a40-weirdlab', job_state=['PENDING'],
                 tres_req_str='gres/gpu=8', tres_alloc_str=''),
            dict(job_id=5, account='otherlab', job_state=['RUNNING'], tres_alloc_str='gres/gpu=8'),
            dict(job_id=6, account='weirdlab', job_state=['RUNNING'], tres_alloc_str='cpu=8'),
            dict(job_id=7, account='weirdlab', job_state=['RUNNING'],
                 tres_alloc_str='gres/gpu=4', gres_detail=['gpu:a40:1(IDX:0)']),
        ]
        rows = collect.parse_weirdlab_jobs(records,
            ['gpu-a40-weirdlab', 'ckpt-weirdlab', 'weirdlab'],
            [dict(name='g4', gres='gpu:h200:8')])
        self.assertEqual([r['id'] for r in rows], ['1', '2', '3', '7'])
        self.assertEqual(rows[0]['gpus'], 6)  # Already a job total, not per-node.
        self.assertEqual(rows[0]['gpu_types'], {'A40': 6})
        self.assertEqual(rows[1]['scope'], 'checkpoint')
        self.assertEqual(rows[1]['gpu_types'], {'L40S': 2})
        self.assertEqual(rows[2]['gpu_types'], {'H200': 1})
        self.assertEqual(rows[3]['gpu_types'], {'UNKNOWN': 4})

    def test_compact_queue_keeps_allocations_and_job_names(self):
        output = chr(31).join(['1', 'alice', 'job|with,delimiters', 'RUNNING',
                              'gpu-a40-weirdlab', 'gpu-a40', 'g[1-2]',
                              'gres/gpu=6,gres/gpu:a40=6', '']) + '\n'
        rows = collect.parse_weirdlab_queue(output)
        jobs = collect.parse_weirdlab_jobs(rows, ['gpu-a40-weirdlab'], [])
        self.assertEqual(jobs[0]['name'], 'job|with,delimiters')
        self.assertEqual(jobs[0]['gpu_types'], {'A40': 6})
        with self.assertRaises(ValueError):
            collect.parse_weirdlab_queue('incomplete response')


    def test_activity_failure_does_not_fail_snapshot(self):
        with patch.object(collect, 'run', side_effect=RuntimeError('access unavailable')):
            activity = collect.weirdlab_activity([['weirdlab', '', 'normal']], [])
        self.assertEqual(activity['jobs'], [])
        self.assertEqual(activity['error'], 'access unavailable')


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
