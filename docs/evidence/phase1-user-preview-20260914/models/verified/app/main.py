#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
HTML='''<!doctype html><html><head><title>Queue Priority B verified</title></head><body><h1>Queue Priority B verified</h1><p>Verified non-preemptive priority queue: among customers already waiting, high priority is selected first and ties use arrival order; a service already started is never interrupted. Multiple identical servers share the queue.</p><p>Run results are available from the platform Run panel; this Preview does not present experiment evidence.</p></body></html>'''
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path=='/health': body,code=b'ok\n',200
        elif self.path in ('/','/index.html'): body,code=HTML.encode(),200
        else: body,code=b'Not found\n',404
        self.send_response(code); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*args): pass
if __name__=='__main__': HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
