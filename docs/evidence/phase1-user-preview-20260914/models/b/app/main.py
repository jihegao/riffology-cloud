#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer

HTML = """<!doctype html><html><head><title>Queue Priority B</title></head><body><h1>Queue Priority B</h1><p><strong>机制：</strong>单一等待集合采用非抢占优先级队列；服务完成或服务器空闲时，高优先级顾客先于普通顾客，同级按到达顺序选择。已开始的服务不会被打断，多台服务器均适用。</p><p>页面不展示示意实验数字。参数实验结果请以平台 Run 面板为准。</p></body></html>"""
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health": body, code = b"ok\n", 200
        elif self.path in ("/", "/index.html"): body, code = HTML.encode(), 200
        else: body, code = b"Not found\n", 404
        self.send_response(code); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *_): pass
if __name__ == "__main__": HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
