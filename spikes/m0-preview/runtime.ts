// Fixed synthetic project service. No caller-provided code, path, port, or command.
export const PREVIEW_PORT = 8080;
export const PROJECT_SERVICE = String.raw`
import base64, hashlib, http.server, json, socket, struct, threading
CONTROL_ORIGIN = 'https://control.m0.test:8791'
COOKIE_DOMAIN = 'preview.m0.test'

HTML = b'''<!doctype html><html lang="en"><meta charset="utf-8"><title>M0 synthetic Preview</title><h1>M0 synthetic Preview</h1><p id="state">Loading fixed state</p><p id="socket">Connecting read-only state stream</p><script src="./app.js"></script></html>'''
JS = b'''fetch('./api/state').then(r=>r.json()).then(s=>document.querySelector('#state').textContent=JSON.stringify(s)); const u=new URL('./ws',location.href); u.protocol=location.protocol==='https:'?'wss:':'ws:'; const ws=new WebSocket(u); ws.onmessage=e=>document.querySelector('#socket').textContent=e.data; ws.onclose=e=>document.querySelector('#socket').textContent+=' [closed '+e.code+']';'''
STATE = {'synthetic': True, 'simulation_state_id': 'm0-fixed-state', 'state_sequence': 1, 'simulation_status': 'paused', 'fixture_instance_marker': '__M0_INSTANCE_MARKER__'}

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def send_data(self, status, content, content_type='application/json', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers()
        self.wfile.write(content)
    def do_GET(self):
        if self.path == '/': return self.send_data(200, HTML, 'text/html')
        if self.path == '/app.js': return self.send_data(200, JS, 'text/javascript')
        if self.path == '/api/state': return self.send_data(200, json.dumps(STATE).encode())
        if self.path == '/api/headers':
            observed = {name: self.headers.get(name) is not None for name in ['Cookie', 'Authorization', 'Referer', 'Origin', 'X-Sandbox-Port', 'X-Forwarded-Host']}
            return self.send_data(200, json.dumps({'synthetic': True, 'observed_header_presence': observed}).encode())
        if self.path == '/set-cookie': return self.send_data(200, b'{}', headers={'Set-Cookie': '__Host-m0_principal=forged; Domain=' + COOKIE_DOMAIN + '; Path=/; Secure', 'Access-Control-Allow-Origin': '*'})
        redirects = {'/redirect-safe': '/api/state', '/redirect-external': 'https://example.com/', '/redirect-control': CONTROL_ORIGIN + '/billing/credit'}
        if self.path in redirects: return self.send_data(302, b'', headers={'Location': redirects[self.path]})
        if self.path == '/ws':
            key = self.headers.get('Sec-WebSocket-Key', '')
            try: valid = len(base64.b64decode(key, validate=True)) == 16
            except Exception: valid = False
            if not valid or self.headers.get('Upgrade', '').lower() != 'websocket' or self.headers.get('Sec-WebSocket-Version') != '13': return self.send_data(400, b'{}')
            accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.send_response(101)
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
            self.send_header('Sec-WebSocket-Accept', accept)
            self.end_headers()
            payload = json.dumps(STATE).encode()
            self.wfile.write(b'\x81\x7e' + struct.pack('!H', len(payload)) + payload)
            self.wfile.flush()
            self.connection.settimeout(130)
            try:
                # This synthetic stream accepts no domain write message.
                if self.rfile.read(2): self.wfile.write(b'\x88\x02\x03\xf0')
            except (OSError, TimeoutError): pass
            self.close_connection = True
            return
        return self.send_data(404, b'{}')
    def do_POST(self): self.send_data(405, b'{"error":"read-only"}')

server = http.server.ThreadingHTTPServer(('0.0.0.0', 8080), Handler)
threading.Timer(180, server.shutdown).start()
server.serve_forever()
server.server_close()
`;

/** Fixed diagnostic targets come only from validated platform configuration.
 * These values and the instance marker never participate in authorization.
 */
export function projectService(generation: string, controlOrigin: string, previewBaseOrigin: string): string {
  if (!/^[a-f0-9]{32}$/.test(generation)) throw new Error('invalid-fixture-generation');
  const parse = (input: string) => {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.origin !== input || !/^[a-z0-9.-]+$/.test(url.hostname)) throw new Error('invalid-fixture-origin');
    return url;
  };
  const control = parse(controlOrigin), preview = parse(previewBaseOrigin);
  if (control.origin === preview.origin || control.hostname.endsWith(`.${preview.hostname}`)) throw new Error('invalid-fixture-origin-boundary');
  return PROJECT_SERVICE.replaceAll('__M0_INSTANCE_MARKER__', generation)
    .replace("CONTROL_ORIGIN = 'https://control.m0.test:8791'", `CONTROL_ORIGIN = ${JSON.stringify(control.origin)}`)
    .replace("COOKIE_DOMAIN = 'preview.m0.test'", `COOKIE_DOMAIN = ${JSON.stringify(preview.hostname)}`);
}
