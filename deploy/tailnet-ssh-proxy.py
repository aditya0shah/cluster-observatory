#!/usr/bin/env python3
"""Forward tailnet SSH with a smaller TCP segment size; SSH still authenticates in sshd."""
import argparse
import select
import socket
import socketserver


class Proxy(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 32

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_MAXSEG, 1024)
        super().server_bind()


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            with socket.create_connection(('127.0.0.1', 22), timeout=10) as upstream:
                upstream.settimeout(None)
                self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                peers = {self.request: upstream, upstream: self.request}
                readers = list(peers)
                while readers:
                    ready, _, _ = select.select(readers, [], [], 60)
                    for source in ready:
                        data = source.recv(65536)
                        if data:
                            peers[source].sendall(data)
                        else:
                            readers.remove(source)
                            peers[source].shutdown(socket.SHUT_WR)
        except (OSError, ValueError):
            pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', required=True)
    parser.add_argument('--port', type=int, default=2222)
    args = parser.parse_args()
    with Proxy((args.bind, args.port), Handler) as server:
        server.serve_forever()
