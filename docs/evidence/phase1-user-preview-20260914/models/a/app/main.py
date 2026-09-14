#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer

HTML = """<!doctype html><html><head><title>Queue FCFS A</title></head><body><h1>Queue FCFS A</h1><p><strong>Mechanism:</strong> one shared FIFO queue; each arriving customer joins the tail and starts service at the earliest available identical server.</p><h2>Bounded sample metrics</h2><ul><li>completed: 40</li><li>mean_wait: 0.000</li><li>max_wait: 0.000</li><li>mean_sojourn: 1.000</li></ul><p>Sample is illustrative and not persisted experiment evidence. Use the platform parameter panel for simulations.</p></body></html>"""
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = b"ok\n"; self.send_response(200)
        elif self.path == "/" or self.path == "/index.html":
            body = HTML.encode(); self.send_response(200)
        else:
            body = b"Not found\n"; self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *_): pass

if __name__ == "__main__": HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
