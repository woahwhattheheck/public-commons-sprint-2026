"""One isolated, offline, real-loopback HTTP boundary check; no model/API usage."""
from email.message import Message
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import http.client
import json

from origin_guard import trusted_request


def header_map(values):
    result = Message()
    for k, v in values:
        result[k] = v
    return result


def run():
    cases = [
        ([("Host", "127.0.0.1:8768")], False, True),
        ([("Host", "localhost:8768"), ("Origin", "http://localhost:8768")], True, False),
        ([("Host", "127.0.0.1:8768"), ("Content-Type", "application/json")], True, True),
        ([("Host", "localhost:8768"), ("Origin", "http://localhost:8768"), ("Content-Type", "application/json; charset=UTF-8")], True, True),
        ([("Host", "untrusted.test:8768")], False, False),
        ([("Host", "127.0.0.1:8768"), ("Origin", "http://untrusted.test")], False, False),
        ([("Host", "127.0.0.1:8768"), ("Origin", "null")], False, False),
        ([("Host", "127.0.0.1:8768"), ("Origin", "http://untrusted.test"), ("Content-Type", "application/json")], True, False),
        ([("Host", "127.0.0.1:8768"), ("Content-Type", "text/plain")], True, False),
        ([("Host", "127.0.0.1:8768"), ("Content-Type", "application/x-www-form-urlencoded")], True, False),
        ([("Host", "127.0.0.1:8768"), ("Content-Type", "application/json"), ("Content-Type", "text/plain")], True, False),
        ([("Host", "127.0.0.1:8768"), ("Host", "untrusted.test:8768"), ("Content-Type", "application/json")], True, False),
    ]
    for headers, write, expected in cases:
        assert trusted_request(header_map(headers), 8768, write=write) is expected, (headers, write)

    state = {"writes": 0}

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status):
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            self._send(200 if trusted_request(self.headers, self.server.server_port) else 403)

        def do_POST(self):
            if not trusted_request(self.headers, self.server.server_port, write=True):
                return self._send(403)
            n = int(self.headers.get("Content-Length", "0"))
            json.loads(self.rfile.read(n))
            state["writes"] += 1
            self._send(200)

        def log_message(self, fmt, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    th = Thread(target=server.serve_forever, daemon=True)
    th.start()
    try:
        port = server.server_port

        def send(method, host=None, origin=None, ctype=None):
            con = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            headers = {"Host": host or f"127.0.0.1:{port}"}
            if origin is not None:
                headers["Origin"] = origin
            if ctype is not None:
                headers["Content-Type"] = ctype
            con.request(method, "/api/cases", body=b'{}' if method == "POST" else None,
                        headers=headers)
            response = con.getresponse()
            response.read()
            status = response.status
            con.close()
            return status

        assert send("GET") == 200
        assert send("GET", host=f"attacker.example:{port}") == 403
        assert send("POST", ctype="application/json") == 200
        assert send("POST", ctype="application/json", origin="https://other.test") == 403
        assert send("POST", ctype="text/plain", origin=f"http://127.0.0.1:{port}") == 403
        assert send("POST", ctype="application/json", origin=f"http://127.0.0.1:{port}") == 200
        assert state["writes"] == 2
    finally:
        server.shutdown()
        server.server_close()
        th.join(timeout=3)
    print("PASS focused Swiss Voices origin boundary: 12 header cases + 6 live loopback calls, exactly 2 permitted writes; no provider calls")


if __name__ == "__main__":
    run()
