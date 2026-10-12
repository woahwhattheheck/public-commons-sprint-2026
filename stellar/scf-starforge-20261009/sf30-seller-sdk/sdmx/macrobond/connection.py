"""Macrobond Analysis connection definition for the maintained series provider."""
from __future__ import annotations

import ipaddress
import re
from urllib.parse import unquote, urlsplit, urlunsplit
from xml.sax.saxutils import escape

NAMESPACE = "http://schemas.mbnd.eu/2019/webapiseriesprovider"


def normalize_host(host: str) -> str:
    """Validate a provider base URL without accepting embedded credentials."""
    if not isinstance(host, str) or not host or len(host) > 4096:
        raise ValueError("Supply the provider's absolute HTTP or HTTPS base URL.")
    if any(ord(character) <= 32 or ord(character) == 127 for character in host) or "\\" in host:
        raise ValueError("The provider URL cannot contain whitespace, controls or backslashes.")
    try:
        parsed = urlsplit(host)
        port = parsed.port
        hostname = parsed.hostname
    except ValueError as error:
        raise ValueError("The provider URL is invalid.") from error
    if parsed.scheme not in ("http", "https") or not hostname or not parsed.netloc:
        raise ValueError("Supply the provider's absolute HTTP or HTTPS base URL.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Enter provider credentials in Macrobond settings, not in the connection URL.")
    if parsed.query or parsed.fragment or "?" in host or "#" in host:
        raise ValueError("The provider base URL cannot contain a query or fragment.")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("The provider port must be between 1 and 65535.")
    if "%" in hostname:
        raise ValueError("The provider hostname cannot contain an escaped host or an IPv6 zone.")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        try:
            ascii_host = hostname.encode("idna").decode("ascii").lower()
        except UnicodeError as error:
            raise ValueError("The provider hostname is invalid.") from error
        if len(ascii_host) > 253 or not all(
            re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
            for label in ascii_host.rstrip(".").split(".")
        ):
            raise ValueError("The provider hostname is invalid.")
        authority = ascii_host
    else:
        authority = "[" + address.compressed + "]" if address.version == 6 else address.compressed
    if port is not None:
        authority += ":" + str(port)
    path = parsed.path
    if re.search(r"%(?![0-9a-fA-F]{2})", path):
        raise ValueError("The provider path contains an invalid percent escape.")
    decoded = unquote(path)
    if any(ord(character) < 32 or ord(character) == 127 for character in decoded) or "\\" in decoded:
        raise ValueError("The provider path contains a control or backslash.")
    if any(part in (".", "..") for part in decoded.split("/")):
        raise ValueError("The provider base path cannot contain dot segments.")
    return urlunsplit((parsed.scheme, authority, path.rstrip("/"), "", ""))


def definition_xml(host: str) -> bytes:
    """Return the original Web API Series Provider XML; credentials stay in the client."""
    selected = normalize_host(host)
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<web:WebApiSeriesProvider xmlns:web="' + NAMESPACE + '">\n'
        "  <web:Host>" + escape(selected) + "</web:Host>\n"
        "</web:WebApiSeriesProvider>\n"
    ).encode("utf-8")
