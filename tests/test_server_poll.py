import unittest
from unittest.mock import Mock, patch
import server


class PollingTests(unittest.TestCase):
    def test_cache_failure_does_not_disconnect_cluster_or_stop_polling(self):
        event = Mock()
        event.wait.side_effect = [False, StopIteration]
        snapshot = dict(collected_at='fresh', allocations=[], allocation_error=None,
                        weirdlab_gpu_activity={'jobs': [], 'error': None})
        with patch.dict(server.DATA, {'klone': {}}, clear=True), \
             patch.dict(server.EVENTS, {'klone': event}), \
             patch.object(server, 'CACHE_ERROR', None), \
             patch.object(server, 'collect', return_value=snapshot) as collect, \
             patch.object(server, 'save_snapshot', return_value='No space left on device'), \
             patch('builtins.print'):
            with self.assertRaises(StopIteration):
                server.poll('klone')
            self.assertEqual(collect.call_count, 2)
            self.assertTrue(server.DATA['klone']['connected'])
            self.assertIsNone(server.DATA['klone']['error'])
            self.assertEqual(server.CACHE_ERROR, 'No space left on device')
