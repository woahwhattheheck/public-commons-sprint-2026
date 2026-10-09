import io
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from carerelay.core import CareRelayError
from carerelay.ring import RingWhepClient, WHEP_TEMPLATE, build_whep_request

URL = WHEP_TEMPLATE.format(device_id="dev") + "/session-1"


class Response(io.BytesIO):
    def __init__(self, status=201, body=b"v=0\r\n", location=URL, content_type="application/sdp"):
        super().__init__(body)
        self.status = status
        self.headers = {"Location": location, "Content-Type": content_type}

    def info(self):
        return self.headers


class ScriptedTransport:
    def __init__(self, *responses):
        self.responses = iter(responses)
        self.calls = []

    def __call__(self, request, timeout):
        self.calls.append((request, timeout))
        response = next(self.responses)
        if isinstance(response, BaseException):
            raise response
        return response


class RingLifecycleTests(unittest.TestCase):
    def test_default_transport_rejects_redirect_without_a_second_request(self):
        class Redirect(urllib.request.HTTPSHandler):
            def __init__(self):
                super().__init__()
                self.calls = []
                self.response = Response(302, location="https://elsewhere.invalid/session")
                self.response.code = 302
                self.response.msg = "Found"
            def https_open(self, request):
                self.calls.append(request)
                return self.response

        handler = Redirect()
        real_build = urllib.request.build_opener
        with patch("carerelay.ring.urllib.request.build_opener", side_effect=lambda *args: real_build(*args, handler)):
            client = RingWhepClient()
        with self.assertRaises(CareRelayError):
            client.create_session("dev", "fixture-token", "v=0\r\n")
        self.assertEqual(len(handler.calls), 1)
        self.assertTrue(handler.response.closed)

    def test_create_and_delete_close_responses_and_keep_credentials_out_of_session(self):
        created, deleted = Response(), Response(status=204, body=b"")
        transport = ScriptedTransport(created, deleted)
        client = RingWhepClient(transport)
        session = client.create_session("dev", "fixture-token", "v=0\r\n", 3)
        self.assertTrue(created.closed)
        client.close_session("dev", "fixture-token", session)
        self.assertTrue(deleted.closed)
        self.assertEqual([request.method for request, _ in transport.calls], ["POST", "DELETE"])
        request, timeout = transport.calls[1]
        self.assertEqual(request.full_url, URL)
        self.assertEqual(request.get_header("Authorization"), "Bearer fixture-token")
        self.assertEqual(timeout, 10)
        self.assertNotIn("fixture-token", repr(session))

    def test_invalid_locations_never_dispatch_cleanup_or_delete(self):
        locations = [
            "https://elsewhere.invalid/session-1",
            URL.replace("/dev/", "/other/"),
            URL + "?access_token=fixture", URL + "#fragment",
            URL.replace("session-1", "../other"),
            URL.replace("session-1", "%2e%2e"),
            URL.replace("api.amazonvision.com", "user@api.amazonvision.com"),
        ]
        for location in locations:
            with self.subTest(location=location):
                response = Response(location=location)
                transport = ScriptedTransport(response)
                client = RingWhepClient(transport)
                with self.assertRaises(CareRelayError):
                    client.create_session("dev", "fixture-token", "v=0\r\n")
                self.assertEqual(len(transport.calls), 1)
                self.assertTrue(response.closed)
                with self.assertRaises(CareRelayError):
                    client.close_session("dev", "fixture-token", location)
                self.assertEqual(len(transport.calls), 1)
        relative = URL.removeprefix("https://api.amazonvision.com")
        session = RingWhepClient(ScriptedTransport(Response(location=relative))).create_session("dev", "fixture-token", "v=0\r\n")
        self.assertEqual(session.location, URL)

    def test_rejected_confirmed_answer_is_closed_and_compensated_once(self):
        for response in (Response(body=b"not SDP"), Response(content_type="text/html"), Response(body=b"\xff")):
            with self.subTest(body=response.getvalue()):
                cleanup = Response(status=204, body=b"")
                transport = ScriptedTransport(response, cleanup)
                with self.assertRaises(CareRelayError):
                    RingWhepClient(transport).create_session("dev", "fixture-token", "v=0\r\n")
                self.assertTrue(response.closed and cleanup.closed)
                self.assertEqual([r.method for r, _ in transport.calls], ["POST", "DELETE"])

    def test_context_manager_cleans_on_normal_and_exceptional_exit(self):
        for fail in (False, True):
            transport = ScriptedTransport(Response(), Response(status=204))
            client = RingWhepClient(transport)
            if fail:
                with self.assertRaisesRegex(RuntimeError, "caller failure"):
                    with client.session("dev", "fixture-token", "v=0\r\n"):
                        raise RuntimeError("caller failure")
            else:
                with client.session("dev", "fixture-token", "v=0\r\n") as session:
                    self.assertEqual(session.location, URL)
            self.assertEqual([r.method for r, _ in transport.calls], ["POST", "DELETE"])

    def test_unknown_creation_is_not_retried_and_error_bodies_are_closed(self):
        body = io.BytesIO(b"sensitive provider detail")
        errors = [urllib.error.URLError("sensitive transport detail"),
                  urllib.error.HTTPError(URL, 429, "rate limited", {}, body)]
        for error in errors:
            transport = ScriptedTransport(error)
            with self.assertRaises(CareRelayError) as caught:
                RingWhepClient(transport).create_session("dev", "fixture-token", "v=0\r\n")
            self.assertEqual(len(transport.calls), 1)
            self.assertNotIn("sensitive", str(caught.exception))
        self.assertTrue(body.closed)

    def test_cleanup_failure_does_not_mask_original_exception(self):
        transport = ScriptedTransport(Response(), urllib.error.URLError("private"))
        with self.assertRaisesRegex(RuntimeError, "original") as caught:
            with RingWhepClient(transport).session("dev", "fixture-token", "v=0\r\n"):
                raise RuntimeError("original")
        self.assertIn("unverified", caught.exception.__notes__[0])
        self.assertEqual(len(transport.calls), 2)
        client = RingWhepClient(ScriptedTransport(Response(), Response(status=202)))
        with self.assertRaisesRegex(CareRelayError, "not confirmed"):
            with client.session("dev", "fixture-token", "v=0\r\n"):
                pass

    def test_malformed_inputs_fail_before_transport(self):
        for device, token, offer in [("..", "token", "v=0"), ("dev", "bad\x00token", "v=0"),
                                     ("dev", "token", "v=01"), ("dev", "token", "v=0\n\ud800")]:
            with self.assertRaises(CareRelayError):
                build_whep_request(device, token, offer)
        transport = ScriptedTransport()
        client = RingWhepClient(transport)
        for timeout in (True, 0, -1, float("inf"), float("nan")):
            with self.assertRaises(CareRelayError):
                client.create_session("dev", "token", "v=0", timeout)
        self.assertEqual(transport.calls, [])


if __name__ == "__main__":
    unittest.main()
