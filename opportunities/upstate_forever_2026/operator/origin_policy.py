"""Exact origins for the loopback operator and its authenticated HTTPS transport."""
from __future__ import annotations
from dataclasses import dataclass
import ipaddress
import re
from urllib.parse import urlsplit

_DNS = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")


class OriginError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def advertised_origin(value: str | None) -> str | None:
    """Require one canonical HTTPS DNS origin on implicit port 443."""
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > 261:
        raise OriginError("ORIGIN_CONFIG", "Supply one canonical HTTPS origin.")
    # urlsplit may otherwise silently discard control characters.
    if any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise OriginError("ORIGIN_CONFIG", "Use an ASCII canonical HTTPS origin.")
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise OriginError("ORIGIN_CONFIG", "Use one well-formed HTTPS origin.") from error
    host = parsed.hostname or ""
    if (parsed.scheme != "https" or parsed.netloc != host
            or parsed.path or parsed.query or parsed.fragment
            or value != "https://" + host):
        raise OriginError("ORIGIN_CONFIG",
            "Use https://host without credentials, port, path, query or fragment.")
    labels = host.split(".")
    if (len(host) > 253 or len(labels) < 2
            or any(not _DNS.fullmatch(label) for label in labels)):
        raise OriginError("ORIGIN_CONFIG", "Use the exact lower-case public DNS hostname.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise OriginError("ORIGIN_CONFIG", "Use the configured public DNS hostname.")
    return value


@dataclass(frozen=True)
class OriginPolicy:
    local: str
    advertised: str | None = None

    def __post_init__(self):
        parsed = urlsplit(self.local)
        try:
            port = parsed.port
        except ValueError as error:
            raise OriginError("ORIGIN_CONFIG", "The local origin requires its bound port.") from error
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                or not port or not 1 <= port <= 65535
                or self.local != "http://127.0.0.1:" + str(port)):
            raise OriginError("ORIGIN_CONFIG", "Use the bound loopback HTTP origin.")
        advertised_origin(self.advertised)

    def request_origin(self, headers, target: str) -> str:
        """Check one Host, an optional matching Origin, and an origin-form target."""
        if (not isinstance(target, str) or not target.startswith("/")
                or target.startswith("//") or "#" in target
                or any(ord(char) < 33 or ord(char) == 127 for char in target)):
            raise OriginError("HOST_INVALID", "Use an origin-relative request target.")
        hosts = headers.get_all("Host", [])
        origins = headers.get_all("Origin", [])
        if len(hosts) != 1:
            raise OriginError("HOST_INVALID", "Supply exactly one configured Host.")
        if len(origins) > 1:
            raise OriginError("ORIGIN_INVALID", "Supply at most one matching Origin.")
        accepted = {urlsplit(self.local).netloc: self.local}
        if self.advertised:
            accepted[urlsplit(self.advertised).netloc] = self.advertised
        selected = accepted.get(hosts[0])
        if selected is None:
            raise OriginError("HOST_INVALID", "Open the configured workbench address.")
        if origins and origins[0] != selected:
            raise OriginError("ORIGIN_INVALID", "Use the matching workbench page.")
        return selected

    def cookie_attributes(self, request_origin: str, *, clear: bool = False) -> str:
        if (request_origin != self.local
                and (self.advertised is None or request_origin != self.advertised)):
            raise OriginError("ORIGIN_INVALID", "Use the checked request origin.")
        secure = "; Secure" if self.advertised and request_origin == self.advertised else ""
        return "; HttpOnly; SameSite=Strict; Path=/api/; Max-Age=" + (
            "0" if clear else "28800") + secure
