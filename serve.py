#!/usr/bin/env python3
"""Статический сервер для разработки без кэша.
python3 serve.py [port] [--shots DIR] — POST /shot?name=x сохраняет PNG в DIR."""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

args = sys.argv[1:]
port = int(args[0]) if args and args[0].isdigit() else 8000
shots = args[args.index('--shots') + 1] if '--shots' in args else os.path.join(os.getcwd(), 'shots')

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, fmt, *a):
        if '404' in fmt % a or 'POST' in fmt % a: super().log_message(fmt, *a)
    def do_POST(self):
        u = urlparse(self.path)
        if u.path != '/shot':
            self.send_error(404); return
        name = parse_qs(u.query).get('name', ['shot'])[0]
        name = ''.join(ch for ch in name if ch.isalnum() or ch in '-_') or 'shot'
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n)
        os.makedirs(shots, exist_ok=True)
        path = os.path.join(shots, name + '.png')
        with open(path, 'wb') as f: f.write(data)
        body = path.encode()
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.send_header('Content-Length', str(len(body))); self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
