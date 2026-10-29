#!/usr/bin/env python3
"""Read-only dashboard using the host machine's authenticated cluster sessions."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parent
BACKEND = os.environ.get('DASHBOARD_BACKEND', 'ssh')
if BACKEND not in ('ssh', 'labpc'):
    raise ValueError('DASHBOARD_BACKEND must be ssh or labpc')
BIND = os.environ.get('DASHBOARD_BIND', '127.0.0.1')
PORT = int(os.environ.get('DASHBOARD_PORT', '8765'))
ORIGIN = os.environ.get('DASHBOARD_ORIGIN', 'http://' + BIND + ':' + str(PORT))
ALLOWED_ORIGINS = {ORIGIN, 'http://127.0.0.1:' + str(PORT), 'http://localhost:' + str(PORT)}
ALLOWED_ORIGINS.update(value.strip() for value in os.environ.get('DASHBOARD_EXTRA_ORIGINS', '').split(',') if value.strip())
HOSTS = {c: os.environ.get('DASHBOARD_' + c.upper() + '_HOST', 'hyak' if BACKEND == 'labpc' and c == 'klone' else c)
         for c in ('klone', 'tillicum')}
HELPER = Path(os.environ.get('DASHBOARD_CLUSTER_HELPER', str(Path.home() / 'bin/cluster')))
ROUTE = 'labpc → cluster' if BACKEND == 'labpc' else 'Host → cluster'
LOGIN_COMMANDS = {c: ('~/bin/cluster login ' + host) if BACKEND == 'labpc'
                  else 'ssh -MNf -o ControlMaster=yes -o ControlPersist=yes ' + host
                  for c, host in HOSTS.items()}
STATE = Path(os.environ.get('DASHBOARD_STATE', str(Path.home() / '.local/state/cluster-observatory')))
STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
CACHE = STATE / 'snapshots.json'
LOCK = threading.RLock()
try:
    DATA = json.loads(CACHE.read_text())
except (OSError, ValueError):
    DATA = {}
EVENTS = {c: threading.Event() for c in ('klone','tillicum')}
STORAGE_EVENTS = {c: threading.Event() for c in EVENTS}
for cluster in EVENTS:
    DATA.setdefault(cluster, {})
    DATA[cluster]['connected'] = False
    DATA[cluster]['error'] = 'Checking SSH connection…'
    DATA[cluster]['storage_loading'] = False


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def persist():
    tmp = CACHE.with_suffix('.tmp')
    tmp.write_text(json.dumps(DATA))
    tmp.chmod(0o600)
    tmp.replace(CACHE)


def collect(cluster, storage=False):
    script = (BASE / 'collect.py').read_text()
    command = "python3 -" + (' --storage' if storage else '') + " <<'DASHBOARD_PYTHON'\n" + script + '\nDASHBOARD_PYTHON'
    if BACKEND == 'labpc':
        args = [str(HELPER), 'run', HOSTS[cluster], 'bash -l -s']
    else:
        host = HOSTS[cluster]
        options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ForwardAgent=no']
        check = subprocess.run(['ssh'] + options + ['-O', 'check', host], capture_output=True, text=True, timeout=15)
        if check.returncode:
            raise RuntimeError('No authenticated SSH master. In your terminal run: ' + LOGIN_COMMANDS[cluster])
        args = ['ssh'] + options + ['-o', 'ControlMaster=no', '-o', 'ProxyCommand=false', '-T', host, 'bash -l -s']
    proc = subprocess.run(args, input=command + '\n', capture_output=True, text=True, timeout=120)
    try:
        result = json.loads(proc.stdout)
    except ValueError:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or 'Cluster returned no data')
    if 'error' in result:
        raise RuntimeError(result['error'])
    if proc.returncode:
        raise RuntimeError(proc.stderr.strip() or 'Cluster query failed')
    return result


def poll(cluster):
    while True:
        EVENTS[cluster].clear()
        try:
            result = collect(cluster)
            with LOCK:
                DATA[cluster].update(snapshot=result, connected=True, error=None, checked_at=now())
                persist()
        except Exception as e:
            with LOCK:
                DATA[cluster].update(connected=False, error=str(e), checked_at=now())
                persist()
        EVENTS[cluster].wait(30)


def storage_poll(cluster):
    while True:
        STORAGE_EVENTS[cluster].wait()
        STORAGE_EVENTS[cluster].clear()
        with LOCK:
            DATA[cluster]['storage_loading'] = True
        try:
            result = collect(cluster, True)
            with LOCK:
                DATA[cluster].update(storage=result, storage_error=None)
        except Exception as e:
            with LOCK:
                DATA[cluster]['storage_error'] = str(e)
        finally:
            with LOCK:
                DATA[cluster]['storage_loading'] = False
                persist()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args)>1 else '') != '200':
            super().log_message(fmt, *args)

    def reply(self, code, body, content_type='application/json'):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/status':
            with LOCK:
                return self.reply(200, dict(clusters=DATA, server_time=now(), refresh_seconds=30, route=ROUTE, backend=BACKEND, login_commands=LOGIN_COMMANDS))
        files = {'/':('index.html','text/html; charset=utf-8'), '/app.js':('app.js','text/javascript'), '/style.css':('style.css','text/css'), '/terminal.css':('terminal.css','text/css')}
        if path in files:
            name, mime = files[path]
            return self.reply(200, (BASE / 'static' / name).read_bytes(), mime)
        self.reply(404, {'error':'Not found'})

    def do_POST(self):
        # Require same-origin custom header: no cross-site form-triggered work.
        if self.headers.get('X-Dashboard') != '1' or (self.headers.get('Origin') is not None and self.headers.get('Origin') not in ALLOWED_ORIGINS):
            return self.reply(403, {'error':'Same-origin requests only'})
        parts = urlsplit(self.path).path.strip('/').split('/')
        if len(parts)==3 and parts[0]=='api' and parts[1] in EVENTS and parts[2] in ('refresh','storage'):
            cluster, action = parts[1:]
            if action=='refresh':
                EVENTS[cluster].set()
            else:
                with LOCK:
                    if DATA[cluster].get('storage_loading'):
                        return self.reply(202, {'ok':True})
                    DATA[cluster]['storage_loading'] = True
                STORAGE_EVENTS[cluster].set()
            return self.reply(202, {'ok':True})
        self.reply(404, {'error':'Not found'})


if __name__ == '__main__':
    for cluster in EVENTS:
        threading.Thread(target=poll, args=(cluster,), daemon=True).start()
        threading.Thread(target=storage_poll, args=(cluster,), daemon=True).start()
    print('Hyak Dashboard: ' + ORIGIN, flush=True)
    ThreadingHTTPServer((BIND,PORT), Handler).serve_forever()
