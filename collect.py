"""Runs on a cluster login node; bounded, read-only Slurm queries."""
import datetime
import getpass
import json
import re
import subprocess
import sys
import socket
import os
import signal
import shutil
import csv
import io


def run(args, timeout=18):
    # Utilities such as hyakalloc spawn Slurm clients; bound the entire owned tree.
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         universal_newlines=True, start_new_session=True)
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        p.communicate()
        raise RuntimeError('%s timed out after %s seconds' % (' '.join(args[:2]), timeout))
    if p.returncode:
        raise RuntimeError(err.strip() or 'Command failed: ' + args[0])
    return out


def fields(line):
    return dict(re.findall(r'(?:^|\s)(\w+)=(\S*)', line))


def tres(value, key):
    for item in value.split(','):
        k, _, v = item.partition('=')
        if k == key:
            try:
                return int(v)
            except ValueError:
                return 0
    return 0


def parse_allocations(output):
    """Parse hyakalloc's account/partition TOTAL, USED and FREE rows."""
    allocations = []
    current = None
    for line in output.splitlines():
        if '│' not in line:
            continue
        cells = [cell.strip() for cell in line.split('│')[1:-1]]
        if len(cells) != 6 or cells[5] not in ('TOTAL', 'USED', 'FREE'):
            continue
        account, partition, cpus, memory, gpus, kind = cells
        if kind == 'TOTAL':
            current = dict(account=account, partition=partition)
            allocations.append(current)
        if current is not None:
            current[kind.lower()] = dict(cpus=int(cpus), memory=memory, gpus=int(gpus))
    return [a for a in allocations if all(k in a for k in ('total','used','free'))]


def parse_weirdlab_jobs(records, account_names, nodes):
    """Use allocated TRES, never pending requests or per-node request counts."""
    allowed = set(account_names)
    node_by_name = {n['name']: n for n in nodes}
    jobs = []
    for record in records:
        account = record.get('account', '')
        states = record.get('job_state') or []
        if isinstance(states, str):
            states = [states]
        state = next((s for s in states if s in ('RUNNING', 'COMPLETING', 'SUSPENDED')), None)
        if account not in allowed or not state:
            continue
        allocated = record.get('tres_alloc_str') or ''
        types = {}
        for entry in allocated.split(','):
            key, _, value = entry.partition('=')
            if key.startswith('gres/gpu:') and value.isdigit():
                model = key[len('gres/gpu:'):].upper()
                types[model] = types.get(model, 0) + int(value)
        total = tres(allocated, 'gres/gpu') or sum(types.values())
        if not total:
            continue
        if not types:
            for detail in record.get('gres_detail') or []:
                for model, count in re.findall(r'gpu:([^:(),]+):(\d+)', detail):
                    types[model.upper()] = types.get(model.upper(), 0) + int(count)
        nodelist = record.get('nodes') or ''
        if not types and nodelist in node_by_name:
            match = re.search(r'gpu:([^:(),]+):\d+', node_by_name[nodelist].get('gres', ''))
            if match:
                types[match.group(1).upper()] = total
        if sum(types.values()) != total:
            types = {'UNKNOWN': total}
        jobs.append(dict(id=str(record.get('job_id', '')), user=record.get('user_name') or 'Unknown',
                         name=record.get('name') or '', state=state, account=account,
                         partition=record.get('partition') or '', nodelist=nodelist,
                         gpus=total, gpu_types=types,
                         scope='checkpoint' if account.startswith('ckpt-') else 'account'))
    return jobs


def parse_weirdlab_queue(output):
    keys = ['job_id', 'user_name', 'name', 'job_state', 'account', 'partition', 'nodes', 'tres_alloc_str']
    records = []
    for line in output.splitlines():
        if not line.strip():
            continue
        cells = line.split(chr(31))
        if cells[-1] == '':
            cells.pop()
        if len(cells) != len(keys):
            raise ValueError('Unexpected GPU activity response format')
        records.append(dict(zip(keys, (cell.strip() for cell in cells))))
    return records


def weirdlab_activity(accounts, nodes, account_error=None):
    if account_error:
        return dict(jobs=[], error='Account associations could not be refreshed: ' + account_error)
    names = sorted(set(a[0] for a in accounts if a[0] == 'weirdlab' or a[0].endswith('-weirdlab')))
    if not names:
        return dict(jobs=[], error=None)
    try:
        # Exact association names need no group-name expansion from the site's wrapper.
        executable = '/usr/bin/squeue' if os.path.isfile('/usr/bin/squeue') else 'squeue'
        columns = ['JobID', 'UserName', 'Name', 'State', 'Account', 'Partition', 'NodeList', 'tres-alloc']
        output_format = ','.join(column + ':0' + chr(31) for column in columns)
        output = run([executable, '--accounts=' + ','.join(names),
                      '--states=RUNNING,COMPLETING,SUSPENDED', '--noheader', '--Format=' + output_format], 25)
        return dict(jobs=parse_weirdlab_jobs(parse_weirdlab_queue(output), names, nodes), error=None)
    except Exception as e:
        return dict(jobs=[], error=str(e))


def snapshot():
    user = getpass.getuser()
    jobs = []
    for line in run(['squeue', '-u', user, '-h', '-o', '%i|%j|%T|%P|%D|%C|%b|%M|%l|%R|%a|%N']).splitlines():
        row = line.split('|')
        if len(row) != 12:
            continue
        job = dict(zip(['id','name','state','partition','nodes','cpus','gres','elapsed','limit','reason','account','nodelist'], row))
        job['nodes'] = int(job['nodes'])
        job['cpus'] = int(job['cpus'])
        job['gpus'] = sum(int(x) for x in re.findall(r'(?:^|,)gres/gpu(?::[^:,]+)?:(\d+)', job['gres']))
        jobs.append(job)
    nodes = []
    for line in run(['scontrol', 'show', 'nodes', '-o']).splitlines():
        n = fields(line)
        if 'NodeName' not in n:
            continue
        state = n.get('State', 'UNKNOWN')
        usable = not any(x in state for x in ['DOWN','DRAIN','FAIL','MAINT','UNKNOWN','NOT_RESPONDING','POWERED_DOWN','POWERING_DOWN','INVALID'])
        total_gpu = tres(n.get('CfgTRES',''), 'gres/gpu')
        used_gpu = tres(n.get('AllocTRES',''), 'gres/gpu')
        nodes.append(dict(name=n['NodeName'], partitions=n.get('Partitions','').split(','), state=state,
                          cpus=int(n.get('CPUEfctv', n.get('CPUTot',0))), allocated_cpus=int(n.get('CPUAlloc',0)),
                          gpus=total_gpu, allocated_gpus=used_gpu, schedulable=usable,
                          gres=n.get('Gres',''), memory_mb=int(n.get('RealMemory',0))))
    warnings = []
    account_error = None
    try:
        accounts = [x.split('|')[:3] for x in run(['sacctmgr','-n','-P','show','assoc','where','user='+user,'format=Account,Partition,QOS']).splitlines() if x.strip()]
    except Exception as e:
        accounts = []
        account_error = str(e)
        warnings.append(str(e))
    allocations = []
    allocation_error = None
    checkpoint = None
    allocations_supported = shutil.which('hyakalloc') is not None
    try:
        allocations = parse_allocations(run(['hyakalloc', '-u', user], 25)) if allocations_supported else []
        if allocations_supported and not allocations:
            allocation_error = 'No account allocation rows returned by hyakalloc.'
    except Exception as e:
        allocation_error = str(e)
    try:
        recent = [dict(zip(['id','name','state','elapsed','exit_code'], x.split('|')[:5])) for x in run(['sacct','-X','-n','-P','-u',user,'-S','now-1days','-o','JobID,JobName%100,State,Elapsed,ExitCode']).splitlines() if x.strip()][-30:]
    except Exception as e:
        recent = []
        warnings.append(str(e))
    lab_activity = weirdlab_activity(accounts, nodes, account_error)
    running = [j for j in jobs if j['state'] in ['RUNNING','COMPLETING','SUSPENDED']]
    expanded = set()
    for nodelist in set(j['nodelist'] for j in running):
        if nodelist and nodelist != '(null)':
            expanded.update(run(['scontrol','show','hostnames',nodelist]).splitlines())
    return dict(user=user, host=socket.gethostname(), collected_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                jobs=jobs, nodes=nodes, accounts=accounts, weirdlab_gpu_activity=lab_activity, allocations=allocations, allocations_supported=allocations_supported, allocation_error=allocation_error, checkpoint=checkpoint, recent=recent, warnings=warnings,
                usage=dict(nodes=len(expanded), cpus=sum(j['cpus'] for j in running), gpus=sum(j['gpus'] for j in running),
                           running=len(running), pending=sum(j['state']=='PENDING' for j in jobs)))


def storage_bytes(value):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*([KMGTPE]?)(?:i?B)?\s*', value, re.I)
    if not match:
        return None
    power = 'KMGTPE'.find(match.group(2).upper()) + 1 if match.group(2) else 0
    return int(float(match.group(1)) * 1024 ** power)


def parse_storage_leaderboard(output):
    """Read cached per-file-owner accounting from hyakstorage, never walk directories."""
    board = dict(lab='weirdlab', path=None, used=None, quota=None,
                 used_bytes=None, quota_bytes=None, members=[], error=None)
    in_users = False
    for line in output.splitlines():
        heading = re.search(r'Usage report for (\/\S+)', line)
        if heading:
            board['path'] = heading.group(1)
        if 'Usage by user:' in line:
            in_users = True
            continue
        if '│' not in line:
            continue
        cells = [cell.strip() for cell in line.split('│')[1:-1]]
        if len(cells) == 3 and cells[0] == 'Total:':
            disk = re.split(r'\s*/\s*', cells[1])
            if len(disk) == 2:
                board.update(used=disk[0], quota=disk[1],
                             used_bytes=storage_bytes(disk[0]), quota_bytes=storage_bytes(disk[1]))
        elif in_users and len(cells) == 3:
            disk = re.match(r'([\d.]+\s*[KMGTPE]?(?:i?B)?)', cells[1], re.I)
            files = re.match(r'(\d+)', cells[2])
            if not disk:
                continue
            used = disk.group(1).strip()
            amount = storage_bytes(used)
            if amount is None:
                continue
            board['members'].append(dict(user=cells[0], used=used, used_bytes=amount,
                                         files=int(files.group(1)) if files else None))
    if not in_users or board['used_bytes'] is None:
        raise ValueError('The cluster did not return a per-member storage report.')
    return finish_storage_leaderboard(board)


def finish_storage_leaderboard(board):
    board['members'].sort(key=lambda member: (-member['used_bytes'], member['user']))
    for member in board['members']:
        member['percent_of_lab_used'] = (100.0 * member['used_bytes'] / board['used_bytes']
                                         if board['used_bytes'] else 0.0)
    board['collected_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return board


def storage_amount(amount):
    for power, suffix in ((4, 'TiB'), (3, 'GiB'), (2, 'MiB'), (1, 'KiB')):
        if amount >= 1024 ** power:
            return ('%.1f' % (amount / 1024 ** power)).rstrip('0').rstrip('.') + suffix
    return str(amount) + 'B'


def parse_storage_leaderboard_csv(output):
    rows = list(csv.DictReader(io.StringIO(output)))
    total = next((r for r in rows if r.get('type') == 'fileset' and r.get('path') == '/gpfs/projects/weirdlab'), None)
    if total is None:
        raise ValueError('The cluster did not return the Weirdlab fileset quota.')
    used, quota = int(total['kib_used']) * 1024, int(total['kib_max']) * 1024
    board = dict(lab='weirdlab', path=total['path'], used=storage_amount(used),
                 quota=storage_amount(quota) if quota else None,
                 used_bytes=used, quota_bytes=quota or None, members=[], error=None)
    for row in rows:
        if row.get('type') != 'user' or row.get('path') != total['path']:
            continue
        amount = int(row['kib_used']) * 1024
        board['members'].append(dict(user=row['id'], used=storage_amount(amount),
                                     used_bytes=amount, files=int(row['files'])))
    return finish_storage_leaderboard(board)


def storage_leaderboard():
    try:
        if os.path.isdir('/gpfs/projects/weirdlab'):
            output = run(['hyakstorage', '-c', '-u', '-d', '/gpfs/projects/weirdlab'], 35)
            return parse_storage_leaderboard_csv(output)
        # Explicit group and user view avoids reading other labs' individual usage.
        return parse_storage_leaderboard(run(['hyakstorage', '-u', '-d', 'weirdlab'], 35))
    except Exception as error:
        return dict(lab='weirdlab', members=[], error=str(error))


def storage():
    reports = []
    for command in [['hyakstorage'], ['quota','-s']]:
        try:
            reports.append({'command':' '.join(command), 'output':run(command, 55)})
            break
        except Exception as e:
            reports.append({'command':' '.join(command), 'error':str(e)})
    # This is filesystem capacity, not the user's usage or quota.
    try:
        reports.append({'command':'df -h (filesystem-wide capacity)', 'output':run(['df','-h',__import__('os').path.expanduser('~')])})
    except Exception as e:
        reports.append({'error':str(e)})
    return dict(collected_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), reports=reports,
                user=getpass.getuser(), leaderboard=storage_leaderboard())

if __name__ == '__main__':
    try:
        print(json.dumps(storage() if '--storage' in sys.argv else snapshot()))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
