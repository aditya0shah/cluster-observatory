"""Preserve useful snapshots and keep cache failures nonfatal."""
import json


def merge_snapshot(previous, current):
    previous = previous or {}
    merged = dict(current)
    timestamp = current['collected_at']
    if current.get('allocation_error'):
        last_success = previous.get('allocations_collected_at')
        if not last_success and previous.get('allocations') and not previous.get('allocation_error'):
            last_success = previous.get('collected_at')
        if last_success:
            merged['allocations'] = previous.get('allocations', [])
            merged['allocations_collected_at'] = last_success
    else:
        merged['allocations_collected_at'] = timestamp

    activity = dict(current.get('weirdlab_gpu_activity') or {})
    old_activity = previous.get('weirdlab_gpu_activity') or {}
    if activity.get('error'):
        last_success = old_activity.get('collected_at')
        if not last_success and 'jobs' in old_activity and not old_activity.get('error'):
            last_success = previous.get('collected_at')
        if last_success:
            activity['jobs'] = old_activity.get('jobs', [])
            activity['collected_at'] = last_success
    else:
        activity['collected_at'] = timestamp
    merged['weirdlab_gpu_activity'] = activity
    return merged


def save_snapshot(path, data):
    """Return a cache error without interrupting live in-memory updates."""
    temporary = path.with_suffix('.tmp')
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary.write_text(json.dumps(data))
        temporary.chmod(0o600)
        temporary.replace(path)
    except OSError as error:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        return str(error)
    return None
