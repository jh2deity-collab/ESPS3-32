#!/usr/bin/env python3
"""
웹 콘솔 로컬 서버.

Web Serial(USB) 과 Web Bluetooth 는 보안 컨텍스트에서만 동작하는데,
http://localhost 는 보안 컨텍스트로 취급된다. 반면 https 로 열면 ws:// 연결이
차단되어 WiFi 방식을 쓸 수 없다. 그래서 http://localhost 로 여는 것이
세 가지 연결 방식을 모두 쓸 수 있는 유일한 조합이다.

    python3 tools/serve.py          # http://localhost:8000
    python3 tools/serve.py 9000     # 포트 지정
"""
import functools
import http.server
import os
import socketserver
import sys
import webbrowser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        # 개발 중에는 캐시가 방해만 된다
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=os.path.abspath(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        url = f"http://localhost:{port}/"
        print(f"ESPS3-32 I/O 테스트 콘솔  →  {url}")
        print("종료하려면 Ctrl+C\n")
        if "--no-browser" not in sys.argv:
            try:
                webbrowser.open(url)
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료합니다.")


if __name__ == "__main__":
    main()
