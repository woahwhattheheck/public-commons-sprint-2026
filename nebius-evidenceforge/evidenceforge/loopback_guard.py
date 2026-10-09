"""Local-only browser request boundary for EvidenceForge's reviewer interface.

The reviewer UI is deliberately bound to IPv4 loopback; this module does not
supply authentication for a remotely hosted service.
"""
from __future__ import annotations

import re
from email.message import Message

# Browser Host headers must identify exactly the host/port of the locally
# bound HTTP listener, not merely an address that resolves to loopback.
_LOCAL_HOST = re.compile(r"(localhost|127\.0\.0\.1):([0-9]{1,5})\Z", re.IGNORECASE)


def allowed_request(headers: Message, port: int, *, mutation: bool = False) -> bool:
    """Admit a browser request only for the intended local URL.

    Accepts localhost and 127.0.0.1 with the actual bound port. Rejects
    ambiguous Host headers and browser requests coming from another origin.
    Origin is optional to retain CLI clients using the separate action token.
    """
    if type(port) is not int or not 1 <= port <= 65535:
        return False
    hosts = headers.get_all("Host", [])
    if len(hosts) != 1 or not isinstance(hosts[0], str):
        return False
    raw_host = hosts[0]
    if raw_host != raw_host.strip():
        return False
    match = _LOCAL_HOST.fullmatch(raw_host)
    if match is None or int(match.group(2)) != port:
        return False
    normalized_host = f"{match.group(1).lower()}:{port}"

    # Modern browsers provide Fetch Metadata for requests with a web origin.
    # Reject cross-origin and related-site requests; direct URL navigation
    # reports 'none', and the app's own script uses 'same-origin'.
    fetch_sites = headers.get_all("Sec-Fetch-Site", [])
    if len(fetch_sites) > 1 or any(
        value.lower() not in {"none", "same-origin"} for value in fetch_sites
    ):
        return False

    origins = headers.get_all("Origin", [])
    if len(origins) > 1:
        return False
    if origins and origins[0].lower() != f"http://{normalized_host}":
        return False

    # The action token remains mandatory on state-changing endpoints.
    # This function adds a local-origin boundary; it does not replace that
    # token, and permits command-line requests without an Origin header.
    return True
