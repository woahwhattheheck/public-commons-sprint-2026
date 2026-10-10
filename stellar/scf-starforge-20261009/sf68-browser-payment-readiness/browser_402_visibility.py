"""SF68 actual Chromium CORS visibility acceptance, local HTTP only.

Requires Python Playwright and a Chromium executable. Chromium's managed-network
policy in some cloud sessions rejects localhost browser navigation; this test
keeps Chromium's security defaults and uses Playwright route.fulfill to bridge
an opaque buyer page to ORIGINAL local server GET responses. It exercises
browser JavaScript's response-header exposure, NOT the browser OPTIONS
preflight path, live merchant endpoints, or paid retry/settlement.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

observed = []

class Seller(BaseHTTPRequestHandler):
    def do_GET(self):
        variant = self.path.removeprefix('/')
        assert variant in {'good', 'bad'}, self.path
        observed.append({'method': self.command, 'path': self.path,
                         'origin': self.headers.get('Origin')})
        self.send_response(402)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', 'null'))
        if variant == 'good':
            self.send_header('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED')
        self.send_header('PAYMENT-REQUIRED', 'local-402-challenge')
        self.end_headers()

    def do_POST(self):
        raise AssertionError('No paid POST may reach this fixture')

    def log_message(self, *_):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Seller)
    Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                executable_path=os.environ.get('BROWSER_BIN', '/usr/bin/chromium'),
                headless=True, args=['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'])
            context = browser.new_context()

            def route_seller(route):
                request = route.request
                assert request.url in {'https://seller.example/good', 'https://seller.example/bad'}
                assert request.method == 'GET', request.method
                original = Request(url + '/' + request.url.rsplit('/', 1)[-1],
                                   headers={'Origin': request.headers.get('origin', 'null')},
                                   method='GET')
                try:
                    with urlopen(original, timeout=7) as response:
                        code, headers, body = response.status, dict(response.headers), response.read()
                except HTTPError as error:
                    code, headers, body = error.code, dict(error.headers), error.read()
                route.fulfill(status=code, headers=headers, body=body)

            context.route('https://seller.example/**', route_seller)
            page = context.new_page()
            page.set_content('<!doctype html><title>local buyer harness</title>')
            result = page.evaluate('''async () => {
              const out = {};
              for(const name of ['good', 'bad']) {
                const response = await fetch('https://seller.example/' + name);
                out[name] = {status: response.status,
                  visibleChallenge: response.headers.get('PAYMENT-REQUIRED')};
              }
              return out;
            }''')
            receipt = {'browserVersion': browser.version, 'buyerOrigin': 'opaque:null',
                       'originalLocalSellerCalls': observed, 'javascript': result,
                       'scope': 'CORS GET response header visibility only, not preflight or settlement'}
            print(json.dumps(receipt, indent=2))
            assert result == {
                'good': {'status': 402, 'visibleChallenge': 'local-402-challenge'},
                'bad': {'status': 402, 'visibleChallenge': None},
            }, result
            assert observed == [
                {'method': 'GET', 'path': '/good', 'origin': 'null'},
                {'method': 'GET', 'path': '/bad', 'origin': 'null'},
            ], observed
            context.close()
            browser.close()
    finally:
        server.shutdown(); server.server_close()

if __name__ == '__main__':
    main()
