from __future__ import annotations

import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

from .core import CareRelayError

WHEP_TEMPLATE = "https://api.amazonvision.com/v1/devices/{device_id}/media/streaming/whep/sessions"
MAX_SDP_BYTES = 256_000
MAX_SDP_ANSWER_BYTES = 1_000_000


def _device_id(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 96:
        raise CareRelayError("device_id must be non-empty text <= 96 chars")
    if not all(ch.isalnum() or ch in "-_.:" for ch in value):
        raise CareRelayError("device_id contains unsafe characters")
    return value


@dataclass(frozen=True)
class WhepSession:
    location: str
    sdp_answer: str


def build_whep_request(device_id: str, bearer_token: str, sdp_offer: str) -> urllib.request.Request:
    did = _device_id(device_id)
    if not isinstance(bearer_token, str) or not bearer_token or any(ch.isspace() for ch in bearer_token):
        raise CareRelayError("bearer token is missing or malformed")
    if not isinstance(sdp_offer, str) or not sdp_offer.startswith("v=0"):
        raise CareRelayError("SDP offer must start with v=0")
    body = sdp_offer.encode("utf-8")
    if len(body) > MAX_SDP_BYTES:
        raise CareRelayError("SDP offer exceeds size limit")
    url = WHEP_TEMPLATE.format(device_id=did)
    return urllib.request.Request(
        url=url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {bearer_token}",
            "Content-Type": "application/sdp",
            "Accept": "application/sdp",
            "User-Agent": "CareRelay/1.0",
        },
    )


class RingWhepClient:
    """Minimal runtime hook to Ring's documented WHEP endpoint.

    The client deliberately does not persist credentials or video. It only negotiates
    the video-only WHEP session documented on developer.ring.com. A real provider run
    requires owner-authenticated Ring credentials / simulator access.
    """

    def __init__(self, opener: Callable[..., object] = urllib.request.urlopen) -> None:
        self._opener = opener

    def create_session(self, device_id: str, bearer_token: str, sdp_offer: str, timeout: float = 10.0) -> WhepSession:
        request = build_whep_request(device_id, bearer_token, sdp_offer)
        try:
            response = self._opener(request, timeout=timeout)
            status = getattr(response, "status", None)
            if status != 201:
                raise CareRelayError(f"Ring WHEP returned unexpected HTTP status: {status}")
            location = response.headers.get("Location") if getattr(response, "headers", None) else None
            if not location or not isinstance(location, str) or len(location) > 2048:
                raise CareRelayError("Ring WHEP response is missing a valid Location header")
            answer_bytes = response.read(MAX_SDP_ANSWER_BYTES + 1)
            if len(answer_bytes) > MAX_SDP_ANSWER_BYTES:
                raise CareRelayError("Ring WHEP SDP answer exceeds size limit")
            try:
                answer = answer_bytes.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise CareRelayError("Ring WHEP SDP answer must be UTF-8") from exc
            if not answer.startswith("v=0"):
                raise CareRelayError("Ring WHEP response is not an SDP answer")
            return WhepSession(location=location, sdp_answer=answer)
        except CareRelayError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise CareRelayError("Ring WHEP provider request failed") from exc
