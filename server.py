#!/usr/bin/env python3
import http.server, json, os, urllib.parse, re, shutil
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
HISTORY_DIR = os.path.join(BASE, 'data', 'history')
os.makedirs(HISTORY_DIR, exist_ok=True)
SAVE_FILES = {
    'naming': os.path.join(BASE, 'data', 'naming-decisions.json'),
    'feedback': os.path.join(BASE, 'data', 'feedback.json'),
    'decisions': os.path.join(BASE, 'data', 'decisions.json'),
}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)

            if path in ('/save/naming', '/save/feedback', '/save/decisions'):
                key = path.split('/')[-1]
                with open(SAVE_FILES[key], 'w') as f:
                    json.dump(data, f, indent=2)
                self._ok()

            elif path.startswith('/save/variant/'):
                variant_id = path.split('/')[-1]
                # Safety: only alphanumeric, hyphens, underscores
                if not re.match(r'^[a-z0-9_-]+$', variant_id):
                    self._error(400, 'Invalid variant ID')
                    return
                safe_path = os.path.join(BASE, 'data', f'variant-{variant_id}.json')
                # Ensure path is inside data/
                if not os.path.abspath(safe_path).startswith(os.path.abspath(os.path.join(BASE, 'data'))):
                    self._error(403, 'Path traversal blocked')
                    return
                # Backup previous version before overwriting
                if os.path.exists(safe_path):
                    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
                    backup_path = os.path.join(HISTORY_DIR, f'variant-{variant_id}_{ts}.json')
                    shutil.copy2(safe_path, backup_path)
                    print(f'  📋 Backed up: {backup_path}')
                with open(safe_path, 'w') as f:
                    json.dump(data, f, indent=2)
                print(f'  💾 Saved variant: {safe_path}')
                self._ok()

            else:
                self._error(404, 'Not found')

        except Exception as e:
            self._error(500, str(e))

    def _ok(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def _error(self, code, msg):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'error': msg}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        if args and str(args[0]).startswith('POST'):
            print(f'  💾 {args[0]}')

if __name__ == '__main__':
    port = 8766
    print(f'Menu demo running at http://localhost:{port}')
    print(f'Autosave → {BASE}/data/')
    http.server.HTTPServer(('', port), Handler).serve_forever()
