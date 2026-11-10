"""Local edition: serve the same web UI and run the engine natively (your CPU/GPU, your Python packages).

    python -m upliftlab serve            # http://127.0.0.1:4180
"""
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import bridge

LOCK = threading.Lock()


def detect_devices():
    try:
        import torch
        if torch.cuda.is_available():
            return [f'cuda:{i}' for i in range(torch.cuda.device_count())] + ['cpu']
    except Exception:
        pass
    return ['cpu']


def make_handler(web_root):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _same_origin(self):
            origin = self.headers.get('Origin')
            return origin is None or urlparse(origin).netloc == self.headers.get('Host')

        def do_GET(self):
            path = urlparse(self.path).path
            if path == '/api/engine':
                return self._json(json.loads(bridge.call('info')))
            file = (web_root / path.lstrip('/')).resolve() if path != '/' else web_root / 'index.html'
            if web_root not in file.parents and file != web_root / 'index.html' or not file.is_file():
                self.send_error(404)
                return
            body = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            path = urlparse(self.path).path
            if not path.startswith('/api/engine/') or not self._same_origin():
                self.send_error(403)
                return
            payload = self.rfile.read(int(self.headers.get('Content-Length', 0) or 0)).decode() or '{}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.end_headers()

            def send(line):
                self.wfile.write((line + '\n').encode())
                self.wfile.flush()
            # One run per process: calls run in order, progress lines stream before the result.
            with LOCK:
                bridge.set_reporter(lambda message: send(json.dumps({'type': 'progress', 'data': json.loads(message)})))
                send(json.dumps({'type': 'result', **json.loads(bridge.call(path.rsplit('/', 1)[1], payload))}, ensure_ascii=False))
                bridge.set_reporter(lambda message: None)

        def _json(self, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return Handler


def ui_root(web=None):
    """The UI to serve: --web if given, else web/ in a source checkout, else the single-file build shipped in the package."""
    here = Path(__file__).resolve().parent
    for folder in ([Path(web)] if web else [here.parents[1] / 'web', here / 'ui']):
        if (folder / 'index.html').is_file():
            return folder.resolve()
    raise SystemExit(f'web UI not found{f" at {web}" if web else ""}. Install a released package (pip install upliftlab), run from a source checkout, or pass --web.')


def serve(host='127.0.0.1', port=4180, web=None, open_browser=True):
    web_root = ui_root(web)
    devices = detect_devices()
    bridge.state.update(runtime='local', device=devices[0], devices=devices)
    server = ThreadingHTTPServer((host, port), make_handler(web_root))
    url = f'http://{host}:{port}'
    print(f'upliftlab local · {url} · device {devices[0]} · Ctrl+C to stop', flush=True)
    if open_browser:
        import threading
        import webbrowser
        threading.Timer(.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
