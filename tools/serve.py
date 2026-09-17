#!/usr/bin/env python3
"""
웹 콘솔 로컬 서버.

Web Serial(USB) 과 Web Bluetooth 는 보안 컨텍스트에서만 동작하는데,
http://localhost 는 보안 컨텍스트로 취급된다. 반면 https 로 열면 ws:// 연결이
차단되어 WiFi 방식을 쓸 수 없다. 그래서 http://localhost 로 여는 것이
세 가지 연결 방식을 모두 쓸 수 있는 유일한 조합이다.

    python3 tools/serve.py          # http://localhost:8000
    python3 tools/serve.py 9000     # 포트 지정
    python3 tools/serve.py --no-browser

윈도우에서 python3 를 못 찾으면:  py -3 tools/serve.py
"""
import sys

# --- 파이썬 버전 확인 (SimpleHTTPRequestHandler 의 directory= 는 3.7+) -------
if sys.version_info < (3, 7):
    sys.stderr.write(
        "\n[오류] 파이썬 3.7 이상이 필요합니다. 지금 버전: %s\n"
        "       python3 --version 으로 확인하고, 최신 파이썬으로 실행해 주세요.\n\n"
        % sys.version.split()[0]
    )
    raise SystemExit(1)

import functools
import http.server
import os
import socket
import socketserver
import webbrowser

ROOT = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
)

MAX_PORT_TRIES = 20


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


def check_files():
    """web/ 폴더와 핵심 파일이 제자리에 있는지 확인한다."""
    if not os.path.isdir(ROOT):
        sys.stderr.write(
            "\n[오류] web 폴더를 찾을 수 없습니다: %s\n"
            "       저장소를 통째로 받았는지 확인해 주세요.\n"
            "       (git clone https://github.com/jh2deity-collab/ESPS3-32)\n\n" % ROOT
        )
        raise SystemExit(1)

    needed = [
        "index.html",
        "css/app.css",
        "js/app.js",
        "js/protocol.js",
        "js/transports/mock.js",
        "vendor/esptool-js/esptool.js",
    ]
    missing = [f for f in needed if not os.path.isfile(os.path.join(ROOT, f))]
    if missing:
        sys.stderr.write(
            "\n[오류] 파일이 빠져 있습니다:\n%s\n"
            "       저장소를 다시 받아 주세요.\n\n"
            % "".join("         web/%s\n" % f for f in missing)
        )
        raise SystemExit(1)


def bind(port):
    """port 부터 차례로 비어 있는 포트를 찾아 서버를 연다."""
    handler = functools.partial(Handler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    last_error = None

    for candidate in range(port, port + MAX_PORT_TRIES):
        try:
            return socketserver.TCPServer(("127.0.0.1", candidate), handler), candidate
        except OSError as exc:
            if exc.errno not in (48, 98, 10048):  # 이미 사용 중 (mac/linux/windows)
                raise
            last_error = exc
            if candidate == port:
                print("  포트 %d 는 이미 사용 중입니다. 다음 포트를 찾습니다..." % port)

    sys.stderr.write(
        "\n[오류] %d ~ %d 사이에 빈 포트가 없습니다 (%s)\n"
        "       다른 포트를 직접 지정해 보세요:  python3 tools/serve.py 9000\n\n"
        % (port, port + MAX_PORT_TRIES - 1, last_error)
    )
    raise SystemExit(1)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    port = 8000
    if args:
        try:
            port = int(args[0])
        except ValueError:
            sys.stderr.write("\n[오류] 포트는 숫자여야 합니다: %s\n\n" % args[0])
            raise SystemExit(1)
        if not (1 <= port <= 65535):
            sys.stderr.write("\n[오류] 포트 범위는 1~65535 입니다.\n\n")
            raise SystemExit(1)

    check_files()
    httpd, port = bind(port)
    url = "http://localhost:%d/" % port

    print("")
    print("  ESPS3-32 I/O 테스트 콘솔")
    print("  ------------------------------------------")
    print("  주소   : %s" % url)
    print("  폴더   : %s" % ROOT)
    print("  파이썬 : %s" % sys.version.split()[0])
    print("")
    print("  브라우저에서 위 주소를 여세요. 반드시 localhost 로 열어야")
    print("  USB·블루투스 연결이 동작합니다(파일을 직접 열면 안 됩니다).")
    print("  종료하려면 Ctrl+C")
    print("")

    if "--no-browser" not in sys.argv:
        try:
            webbrowser.open(url)
        except Exception:
            pass  # 브라우저 자동 실행은 실패해도 서버는 계속 돈다

    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  서버를 종료합니다.")


if __name__ == "__main__":
    main()
