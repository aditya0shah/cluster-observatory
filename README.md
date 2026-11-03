# Cluster Observatory

A private, self-hosted monitoring dashboard for UW Klone and Tillicum. Live jobs, GPU account allocations, personal storage usage, shared quotas, and recent activity in a neon terminal interface.

Python standard library only. No frontend build, database, cloud service, or API keys.

## Features

- Separate Klone and Tillicum tabs with live connection status and last-good snapshots.
- Job queue, distinct allocated nodes, allocated GPUs/CPUs, pending reasons, and recent accounting records.
- Account-specific allocation tables from `hyakalloc`: total allocation, account usage, your usage, and remaining resources.
- A40, L40/L40S, A100, H100/H200 and newer GPU classes; shared checkpoint capacity appears separately.
- Weirdlab GPU activity grouped by user, with account/checkpoint counts per GPU type and expandable job/node details.
- On-demand storage checks with personal usage, quota percentages, account totals, and expandable raw reports.
- Read-only queries. No job submission, cancellation, credential collection, or recursive filesystem scans.

## Quick start

Requirements: Python 3.8+ on the server host, OpenSSH, and authenticated cluster connections. Cluster login-node Python 3.6+ is supported. Optional Node.js is used only for frontend checks.

```sh
python3 server.py
```

Open http://127.0.0.1:8765. Stop with Ctrl-C.

By default, the server uses SSH aliases `klone` and `tillicum`. Configure connection sharing in `~/.ssh/config`:

```sshconfig
Host klone
    HostName klone.hyak.uw.edu
    User YOUR_NETID

Host tillicum
    HostName tillicum.hyak.uw.edu
    User YOUR_NETID

Host klone tillicum
    ControlMaster auto
    ControlPath ~/.ssh/control/%C
    ControlPersist yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

Create the socket directory, then authenticate in your own terminal:

```sh
mkdir -p ~/.ssh/control
chmod 700 ~/.ssh/control
ssh -MNf klone
ssh -MNf tillicum
```

Approve your password/Duo prompts there. The dashboard only reuses authenticated masters; it never initiates an interactive login. Reauthenticate after connection loss, maintenance, or server reboot.

## Always-on lab PC

If the host already has the `~/bin/cluster` helper with `run` and `login` commands:

```sh
DASHBOARD_BACKEND=labpc python3 server.py
```

This uses helper targets `hyak` and `tillicum` and preserves the existing shared sessions. In a terminal on the PC:

```sh
~/bin/cluster login hyak
~/bin/cluster login tillicum
```

For automatic startup, copy [deploy/cluster-observatory.service](deploy/cluster-observatory.service) to `~/.config/systemd/user/`, and edit the checkout path and environment settings:

```sh
systemctl --user daemon-reload
systemctl --user enable --now cluster-observatory.service
journalctl --user -u cluster-observatory.service -n 50
```

User lingering is required for startup without a desktop login; check your host's existing configuration. The dashboard service can restart automatically, but cluster authentication after reboot still requires your terminal login.

## Tailscale

Keep the service on loopback for local access. To view from your tailnet without an SSH tunnel, bind specifically to the server's Tailscale IPv4 address:

```sh
DASHBOARD_BIND=YOUR_TAILSCALE_IP \
DASHBOARD_ORIGIN=http://YOUR_TAILSCALE_IP:8765 \
DASHBOARD_BACKEND=labpc \
python3 server.py
```

For a memorable address, use `http://YOUR_TAILSCALE_HOSTNAME:8765` and add that origin to `DASHBOARD_EXTRA_ORIGINS`.

Then open `http://YOUR_TAILSCALE_IP:8765` from a Tailscale-connected device. The dashboard has no application login: restrict network access to trusted devices using your tailnet policy. Avoid a public or all-interface binding. If Tailscale has not started when the service boots, systemd retries the bind.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_BACKEND` | `ssh` | `ssh` or the existing `labpc` helper |
| `DASHBOARD_BIND` | `127.0.0.1` | Listen address |
| `DASHBOARD_PORT` | `8765` | HTTP port |
| `DASHBOARD_ORIGIN` | Derived from bind/port | Browser origin allowed to trigger refresh and storage checks |
| `DASHBOARD_EXTRA_ORIGINS` | Empty | Comma-separated additional trusted browser origins, such as a Tailscale MagicDNS hostname |
| `DASHBOARD_KLONE_HOST` | `klone` / `hyak` | SSH alias or helper target |
| `DASHBOARD_TILLICUM_HOST` | `tillicum` | SSH alias or helper target |
| `DASHBOARD_CLUSTER_HELPER` | `~/bin/cluster` | Existing helper executable for `labpc` mode |
| `DASHBOARD_STATE` | `~/.local/state/cluster-observatory` | Private snapshot cache |

Environment variables must be exported or supplied to the process; no `.env` file is loaded automatically.

## Reading the metrics

Snapshots refresh every 2 minutes; browsers read the cache every 5 seconds. Closing the browser does not stop the server. Running on an always-on host keeps monitoring independent of your laptop.

GPU/CPU metrics represent allocations, not hardware utilization. Distinct nodes exclude pending jobs and count a shared node once. Completing and suspended jobs are included as active allocations.

Weirdlab activity uses one account-filtered `squeue --json` request per snapshot and shows active GPU allocations charged to Weirdlab accounts. Counts come from allocated TRES, including multi-node totals and jobs requesting GPUs per job. GPU types come from allocation records, GRES detail or a known single node; unresolved types remain explicit. Older GPU classes and CPU-only jobs are omitted from the panel. Checkpoint jobs appear separately. This identifies account jobs, not physical ownership of a particular GPU. Expanded user rows stay open as cached data refreshes.

`hyakalloc` account totals are shared across account members. Your CPU/GPU usage is matched to exact partition-account associations. Your memory allocation is not inferred. Free account capacity does not guarantee a job will start: memory, job size, QoS and scheduler policies also matter. If account figures are unavailable, no cluster-wide substitute is shown.

`hyakstorage` personal figures are separate from shared totals; unsupported or missing personal quotas stay unknown. Personal percentages use a personal quota where reported, otherwise the shared account quota with an explicit label. Derived percentages are approximate because source values are rounded. Unit suffixes use a 1024 step. `df` is filesystem-wide capacity and never treated as personal usage. `quota -s` is the raw fallback if `hyakstorage` is unavailable.

The collector issues bounded read-only Slurm commands over the host's existing connections. Storage checks are on demand. Snapshot data, credentials, host-specific addresses and logs are not committed.

## Checks

```sh
python3 -m unittest discover -s tests
node --check static/app.js
node tests/frontend.cjs
```
