"""Loopback HTTP boundary for the local Swiss Voices research workspace.

Guard Host against DNS rebinding and Origin against browser cross-site requests.
It does not authenticate same-machine processes or make the workspace multiuser.
"""
from __future__ import annotations


def trusted_request(headers, port: int, *, write: bool = False) -> bool:
    """Accept only a single local Host, same-origin browser calls and JSON writes.

    Missing Origin is allowed for trusted local CLI tools. A web page on an
    unrelated origin cannot use that exception for normal browser POSTs.
    """
    hosts = headers.get_all("Host", [])
    if len(hosts) != 1:
        return False
    host = hosts[0]
    if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
        return False
    origins = headers.get_all("Origin", [])
    if len(origins) > 1 or (origins and origins[0] != f"http://{host}"):
        return False
    if write:
        content_types = headers.get_all("Content-Type", [])
        if len(content_types) != 1:
            return False
        if content_types[0].split(";", 1)[0].strip().lower() != "application/json":
            return False
    return True
