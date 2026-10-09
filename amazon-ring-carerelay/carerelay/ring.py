from __future__ import annotations

import math
import re
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Callable, Iterator

from .core import CareRelayError

WHEP_TEMPLATE = "https://api.amazonvision.com/v1/devices/{device_id}/media/streaming/whep/sessions"
MAX_SDP_BYTES = 256_000
MAX_SDP_ANSWER_BYTES = 1_000_000


def _device_id(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 96:
        raise CareRelayError("device_id must be non-empty text <= 96 chars")
    if value in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        raise CareRelayError("device_id contains unsafe characters")
    return value


def _authorization(token: str) -> str:
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token):
        raise CareRelayError("bearer token is missing or malformed")
    return f"Bearer {token}"


def _timeout(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CareRelayError("timeout must be finite and positive")
    try:
        result = float(value)
    except OverflowError:
        raise CareRelayError("timeout must be finite and positive") from None
    if not math.isfinite(result) or result <= 0:
        raise CareRelayError("timeout must be finite and positive")
    return result


def _session_location(device_id: str, value: str) -> str:
    """Accept only the documented same-device Ring session resource."""
    prefix = WHEP_TEMPLATE.format(device_id=_device_id(device_id)) + "/"
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise CareRelayError("Ring WHEP response is missing a valid Location header")
    if any(ord(ch) <= 32 or ord(ch) >= 127 for ch in value) or any(ch in value for ch in "?#\\"):
        raise CareRelayError("Ring WHEP Location is not a same-device session URL")
    # A root-relative Location is resolved only against the fixed Ring origin.
    if value.startswith("/") and not value.startswith("//"):
        value = "https://api.amazonvision.com" + value
    try:
        parts = urllib.parse.urlsplit(value)
    except ValueError:
        raise CareRelayError("Ring WHEP Location is not a same-device session URL") from None
    if parts.scheme != "https" or parts.netloc not in {"api.amazonvision.com", "api.amazonvision.com:443"}:
        raise CareRelayError("Ring WHEP Location is not a same-device session URL")
    normalized = "https://api.amazonvision.com" + parts.path
    if not normalized.startswith(prefix):
        raise CareRelayError("Ring WHEP Location is not a same-device session URL")
    session_id = normalized[len(prefix):]
    if session_id in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9_.:-]+", session_id):
        raise CareRelayError("Ring WHEP Location has an invalid session identifier")
    return normalized


def _sdp_bytes(value: str) -> bytes:
    if not isinstance(value, str) or not value.splitlines() or value.splitlines()[0] != "v=0":
        raise CareRelayError("SDP offer must start with the v=0 line")
    try:
        body = value.encode("utf-8")
    except UnicodeEncodeError:
        raise CareRelayError("SDP offer must be valid UTF-8") from None
    if len(body) > MAX_SDP_BYTES:
        raise CareRelayError("SDP offer exceeds size limit")
    return body


@dataclass(frozen=True)
class WhepSession:
    location: str
    sdp_answer: str


def build_whep_request(device_id: str, bearer_token: str, sdp_offer: str) -> urllib.request.Request:
    return urllib.request.Request(
        url=WHEP_TEMPLATE.format(device_id=_device_id(device_id)),
        data=_sdp_bytes(sdp_offer),
        method="POST",
        headers={
            "Authorization": _authorization(bearer_token),
            "Content-Type": "application/sdp",
            "Accept": "application/sdp",
            "User-Agent": "CareRelay/1.0",
        },
    )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward bearer credentials or replay a session POST after a redirect.
        return None


def _close_response(response: object) -> None:
    close = getattr(response, "close", None)
    if callable(close):
        try:
            close()
        except OSError:
            pass  # Local socket disposal must not mask the operation's outcome.


class RingWhepClient:
    """Server-side Ring WHEP creation and explicit session termination.

    No automatic retry, token persistence, video storage or live-provider assertion.
    Injected openers are trusted transports and must also disable redirects.
    """

    def __init__(self, opener: Callable[..., object] | None = None) -> None:
        self._opener = opener if opener is not None else urllib.request.build_opener(_NoRedirect()).open

    @contextmanager
    def _response(self, request: urllib.request.Request, timeout: float) -> Iterator[object]:
        response = None
        try:
            response = self._opener(request, timeout=_timeout(timeout))
            yield response
        except urllib.error.HTTPError as exc:
            _close_response(exc)
            raise CareRelayError(f"Ring WHEP provider returned HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise CareRelayError("Ring WHEP provider request failed; outcome may be unknown") from None
        finally:
            if response is not None:
                _close_response(response)

    def create_session(self, device_id: str, bearer_token: str, sdp_offer: str, timeout: float = 10.0) -> WhepSession:
        request = build_whep_request(device_id, bearer_token, sdp_offer)
        location = None
        try:
            with self._response(request, timeout) as response:
                if getattr(response, "status", None) != 201:
                    raise CareRelayError("Ring WHEP creation requires HTTP 201")
                headers = getattr(response, "headers", None)
                location = _session_location(device_id, headers.get("Location") if headers else None)
                content_type = headers.get("Content-Type", "")
                if content_type.split(";", 1)[0].strip().lower() != "application/sdp":
                    raise CareRelayError("Ring WHEP response must use application/sdp")
                answer_bytes = response.read(MAX_SDP_ANSWER_BYTES + 1)
                if not isinstance(answer_bytes, bytes) or len(answer_bytes) > MAX_SDP_ANSWER_BYTES:
                    raise CareRelayError("Ring WHEP SDP answer exceeds size limit or is not bytes")
                try:
                    answer = answer_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    raise CareRelayError("Ring WHEP SDP answer must be UTF-8") from None
                if not answer.splitlines() or answer.splitlines()[0] != "v=0":
                    raise CareRelayError("Ring WHEP response is not an SDP answer")
                return WhepSession(location=location, sdp_answer=answer)
        except CareRelayError as exc:
            # Only a confirmed 201 with a validated Location identifies a resource
            # safe to terminate. An unknown POST outcome is never retried.
            if location is not None:
                try:
                    self.close_session(device_id, bearer_token, location, timeout)
                except CareRelayError:
                    exc.add_note("Cleanup of the confirmed Ring session failed; remote state is unverified.")
            raise

    def close_session(self, device_id: str, bearer_token: str, session: WhepSession | str, timeout: float = 10.0) -> None:
        location = session.location if isinstance(session, WhepSession) else session
        request = urllib.request.Request(
            url=_session_location(device_id, location),
            method="DELETE",
            headers={"Authorization": _authorization(bearer_token), "User-Agent": "CareRelay/1.0"},
        )
        with self._response(request, timeout) as response:
            if getattr(response, "status", None) not in {200, 204}:
                raise CareRelayError("Ring WHEP termination was not confirmed")

    @contextmanager
    def session(self, device_id: str, bearer_token: str, sdp_offer: str, timeout: float = 10.0) -> Iterator[WhepSession]:
        """Close a successfully created session on normal exit or caller failure."""
        session = self.create_session(device_id, bearer_token, sdp_offer, timeout)
        try:
            yield session
        except BaseException as exc:
            try:
                self.close_session(device_id, bearer_token, session, timeout)
            except CareRelayError:
                exc.add_note("Ring session cleanup failed; remote state is unverified.")
            raise
        else:
            self.close_session(device_id, bearer_token, session, timeout)
