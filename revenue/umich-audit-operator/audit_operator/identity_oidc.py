"""Configured OpenID Connect authorization-code flow for staff sign-in.

The application owns browser state, provider revisions, account binding and sessions.
This reusable protocol module returns verified literal identity and only the
configured simple claims. Application roles and account stores remain separate.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import math
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt

_TIMEOUT = 10
_JSON_LIMIT = 65536
_JWKS_LIMIT = 262144
_ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_VERIFIER = re.compile(r"[A-Za-z0-9._~-]{43,128}")
_COMPACT = re.compile(r"[A-Za-z0-9_-]+")
_CLAIM = re.compile(r"[A-Za-z_][A-Za-z0-9_.:/-]{0,127}")
_RESERVED_CLAIMS = frozenset({
    "iss", "sub", "aud", "exp", "iat", "nbf", "nonce", "auth_time",
    "azp", "at_hash", "c_hash", "access_token", "refresh_token", "id_token",
    "client_secret", "authorization", "password",
})
_MESSAGES = {
    "configuration": "Organization sign-in configuration is not valid.",
    "provider_unavailable": "The identity provider could not complete sign-in.",
    "provider_metadata": "The identity provider metadata was not accepted.",
    "authorization_response": "The organization sign-in response was not accepted.",
    "token_response": "The identity provider token response was not accepted.",
    "signing_key": "The identity provider signing key was not accepted.",
    "id_token": "The organization identity could not be verified.",
}


class OIDCError(ValueError):
    """Safe public error: details from HTTP, credentials and tokens never escape."""

    def __init__(self, code):
        self.code = code if code in _MESSAGES else "id_token"
        super().__init__(_MESSAGES[self.code])


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _text(value, limit, code, *, ascii_only=False):
    if (not isinstance(value, str) or not value or len(value) > limit
            or any(ord(char) < 32 or ord(char) == 127 for char in value)
            or (ascii_only and not value.isascii())):
        raise OIDCError(code)
    return value


def _https(value, code, *, query=True):
    _text(value, 4096, code, ascii_only=True)
    try:
        parsed = urllib.parse.urlsplit(value)
        if (not value.startswith("https://") or parsed.scheme != "https"
                or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.fragment
                or "#" in value or "\\" in value or "%" in parsed.netloc
                or (not query and ("?" in value or parsed.query))
                or any(char.isspace() for char in value)):
            raise ValueError()
        port = parsed.port
        if port is not None and not 1 <= port <= 65535:
            raise ValueError()
    except ValueError:
        raise OIDCError(code) from None
    return parsed


def _origin(parsed):
    return ("https", parsed.hostname.lower(), parsed.port or 443)


def _config(config):
    if not isinstance(config, dict):
        raise OIDCError("configuration")
    issuer = _https(config.get("issuer"), "configuration", query=False)
    _text(config.get("client_id"), 1024, "configuration", ascii_only=True)
    _https(config.get("redirect_uri"), "configuration")
    secret_env = config.get("client_secret_env")
    if not isinstance(secret_env, str) or not _ENV.fullmatch(secret_env):
        raise OIDCError("configuration")
    ca_env = config.get("ca_bundle_env")
    if ca_env is not None and (not isinstance(ca_env, str) or not _ENV.fullmatch(ca_env)):
        raise OIDCError("configuration")
    max_age = config.get("max_age", 300)
    if type(max_age) is not int or not 0 <= max_age <= 3600:
        raise OIDCError("configuration")
    supplied = config.get("allowed_endpoint_origins")
    origins = {_origin(issuer)}
    if supplied is not None:
        if not isinstance(supplied, list) or len(supplied) > 32:
            raise OIDCError("configuration")
        for value in supplied:
            parsed = _https(value, "configuration", query=False)
            if parsed.path not in ("", "/"):
                raise OIDCError("configuration")
            origins.add(_origin(parsed))
    scopes = config.get("scopes", ["openid", "profile"])
    claims = config.get("claim_names", ["name"])
    acr_values = config.get("required_acr_values", [])
    for values, limit in ((scopes, 16), (claims, 32), (acr_values, 16)):
        if (not isinstance(values, list) or len(values) > limit
                or any(not isinstance(value, str) or not value or len(value) > 256
                       or any(ord(c) < 33 or ord(c) == 127 for c in value) for value in values)
                or len(set(values)) != len(values)):
            raise OIDCError("configuration")
    if "openid" not in scopes or any(not value.isascii() for value in scopes):
        raise OIDCError("configuration")
    if any(not _CLAIM.fullmatch(value) or value in _RESERVED_CLAIMS for value in claims):
        raise OIDCError("configuration")
    return origins, max_age


def _metadata(config, metadata):
    origins, _ = _config(config)
    if not isinstance(metadata, dict) or metadata.get("issuer") != config["issuer"]:
        raise OIDCError("provider_metadata")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if _origin(_https(metadata.get(key), "provider_metadata")) not in origins:
            raise OIDCError("provider_metadata")
    required = {
        "response_types_supported": "code",
        "id_token_signing_alg_values_supported": "RS256",
    }
    optional = {
        "grant_types_supported": "authorization_code",
        "response_modes_supported": "query",
        "token_endpoint_auth_methods_supported": "client_secret_basic",
        "code_challenge_methods_supported": "S256",
    }
    for key, required_value in (*required.items(), *optional.items()):
        if key in optional and key not in metadata:
            continue
        values = metadata.get(key)
        if (not isinstance(values, list) or not values or len(values) > 100
                or any(not isinstance(value, str) for value in values)
                or required_value not in values):
            raise OIDCError("provider_metadata")
    if ("authorization_response_iss_parameter_supported" in metadata
            and type(metadata["authorization_response_iss_parameter_supported"]) is not bool):
        raise OIDCError("provider_metadata")
    return metadata


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError()
        value[key] = item
    return value


def _bad_constant(_):
    raise ValueError()


def _json(raw, code):
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                           parse_constant=_bad_constant)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise OIDCError(code) from None


def _request(config, url, code, *, data=None, headers=None, limit=_JSON_LIMIT):
    # Each operation uses configured HTTPS only; neither redirects nor ambient
    # proxy configuration can move a credential-bearing request elsewhere.
    _https(url, "provider_metadata")
    try:
        ca_env = config.get("ca_bundle_env")
        ca_path = os.environ.get(ca_env) if ca_env else None
        if ca_env and not ca_path:
            raise OIDCError("configuration")
        context = ssl.create_default_context(cafile=ca_path)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _NoRedirect(),
            urllib.request.HTTPSHandler(context=context))
        request_headers = {"Accept": "application/json", "Accept-Encoding": "identity",
                           "User-Agent": "Commons-Institutional-OIDC/1"}
        request_headers.update(headers or {})
        request = urllib.request.Request(url, data=data, headers=request_headers,
                                         method="POST" if data is not None else "GET")
        deadline = time.monotonic() + _TIMEOUT
        with opener.open(request, timeout=_TIMEOUT) as response:
            if response.status != 200:
                raise OIDCError(code)
            if response.headers.get_content_type() not in (
                    "application/json", "application/jwk-set+json"):
                raise OIDCError(code)
            length = response.headers.get("Content-Length")
            if length is not None:
                try:
                    if not 0 <= int(length) <= limit:
                        raise ValueError()
                except ValueError:
                    raise OIDCError(code) from None
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise OIDCError(code)
            raw = bytearray()
            while True:
                if time.monotonic() >= deadline:
                    raise OIDCError("provider_unavailable")
                chunk = response.read1(min(16384, limit + 1 - len(raw)))
                raw.extend(chunk)
                if len(raw) > limit:
                    raise OIDCError(code)
                if not chunk:
                    break
            return _json(bytes(raw), code)
    except OIDCError:
        raise
    except (urllib.error.HTTPError, urllib.error.URLError, OSError,
            ValueError, http.client.HTTPException):
        raise OIDCError("provider_unavailable") from None


def discover(config):
    """Fetch and validate metadata for exactly the configured HTTPS issuer."""
    _config(config)
    url = config["issuer"].rstrip("/") + "/.well-known/openid-configuration"
    return _metadata(config, _request(config, url, "provider_metadata"))


def _transaction(nonce, verifier, *, state=None):
    _text(nonce, 1024, "authorization_response", ascii_only=True)
    if not isinstance(verifier, str) or not _VERIFIER.fullmatch(verifier):
        raise OIDCError("authorization_response")
    if state is not None:
        _text(state, 1024, "authorization_response", ascii_only=True)


def authorization_url(config, metadata, state, nonce, verifier):
    """Create a code-flow URL; the caller must retain one-use browser binding."""
    _metadata(config, metadata)
    _text(state, 1024, "authorization_response", ascii_only=True)
    _transaction(nonce, verifier, state=state)
    _, max_age = _config(config)
    values = {
        "response_type": "code", "response_mode": "query",
        "client_id": config["client_id"], "redirect_uri": config["redirect_uri"],
        "scope": " ".join(config.get("scopes", ["openid", "profile"])), "state": state, "nonce": nonce,
        "code_challenge": base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii"),
        "code_challenge_method": "S256", "max_age": str(max_age),
    }
    if config.get("required_acr_values"):
        values["acr_values"] = " ".join(config["required_acr_values"])
    endpoint = _https(metadata["authorization_endpoint"], "provider_metadata")
    try:
        existing = urllib.parse.parse_qsl(endpoint.query, keep_blank_values=True,
                                          max_num_fields=64, errors="strict")
    except (ValueError, UnicodeError):
        raise OIDCError("provider_metadata") from None
    if any(key in values or key in ("request", "request_uri") for key, _ in existing):
        raise OIDCError("provider_metadata")
    return urllib.parse.urlunsplit(endpoint._replace(
        query=urllib.parse.urlencode(existing + list(values.items()))))


def _compact_json(part):
    if not part or not _COMPACT.fullmatch(part) or len(part) % 4 == 1:
        raise OIDCError("id_token")
    try:
        raw = base64.b64decode(part + "=" * (-len(part) % 4),
                               altchars=b"-_", validate=True)
    except ValueError:
        raise OIDCError("id_token") from None
    return _json(raw, "id_token")


def _signing_key(config, metadata, header):
    kid = header.get("kid")
    if kid is not None:
        _text(kid, 256, "signing_key")
    jwks = _request(config, metadata["jwks_uri"], "signing_key", limit=_JWKS_LIMIT)
    keys = jwks.get("keys")
    if not isinstance(keys, list) or not 1 <= len(keys) <= 100:
        raise OIDCError("signing_key")
    candidates = []
    for key in keys:
        if not isinstance(key, dict) or key.get("kty") != "RSA":
            continue
        if kid is not None and key.get("kid") != kid:
            continue
        if key.get("alg", "RS256") != "RS256" or key.get("use", "sig") != "sig":
            continue
        operations = key.get("key_ops")
        if operations is not None and operations != ["verify"]:
            continue
        candidates.append(key)
    if len(candidates) != 1:
        raise OIDCError("signing_key")
    key = candidates[0]
    if any(field in key for field in ("d", "p", "q", "dp", "dq", "qi", "oth")):
        raise OIDCError("signing_key")
    for field, limit in (("n", 2048), ("e", 16)):
        if (not isinstance(key.get(field), str) or not key[field]
                or len(key[field]) > limit or not _COMPACT.fullmatch(key[field])):
            raise OIDCError("signing_key")
    try:
        public = jwt.PyJWK.from_dict(
            {"kty": "RSA", "n": key["n"], "e": key["e"], "alg": "RS256"},
            algorithm="RS256").key
        if not 2048 <= public.key_size <= 8192:
            raise OIDCError("signing_key")
        return public
    except (jwt.PyJWTError, ValueError, TypeError, OverflowError):
        raise OIDCError("signing_key") from None


def _verified_claims(config, metadata, encoded, nonce, requested_at):
    _text(encoded, 32768, "id_token", ascii_only=True)
    parts = encoded.split(".")
    if len(parts) != 3:
        raise OIDCError("id_token")
    header = _compact_json(parts[0])
    _compact_json(parts[1])  # Reject ambiguous JSON before the library decodes it.
    if (header.get("alg") != "RS256" or header.get("typ") not in (None, "JWT")
            or any(key in header for key in ("jku", "jwk", "x5u", "x5c", "crit", "b64"))
            or not _COMPACT.fullmatch(parts[2])):
        raise OIDCError("id_token")
    key = _signing_key(config, metadata, header)
    try:
        claims = jwt.decode(
            encoded, key, algorithms=["RS256"], audience=config["client_id"],
            issuer=config["issuer"], leeway=0,
            options={"require": ["iss", "sub", "aud", "exp", "iat", "nonce", "auth_time"]})
    except (jwt.PyJWTError, ValueError, TypeError, OverflowError):
        raise OIDCError("id_token") from None
    audience = claims.get("aud")
    if (claims.get("iss") != config["issuer"]
            or (audience != config["client_id"] and audience != [config["client_id"]])):
        raise OIDCError("id_token")
    if "azp" in claims and claims["azp"] != config["client_id"]:
        raise OIDCError("id_token")
    actual_nonce = claims.get("nonce")
    if (not isinstance(actual_nonce, str) or not actual_nonce.isascii()
            or not hmac.compare_digest(actual_nonce, nonce)):
        raise OIDCError("id_token")
    subject = claims.get("sub")
    # OIDC sub is a case-sensitive ASCII identifier. Never trim or normalize it.
    if not isinstance(subject, str) or not 1 <= len(subject) <= 255 or not subject.isascii():
        raise OIDCError("id_token")
    for field in ("auth_time", "iat", "exp", *(("nbf",) if "nbf" in claims else ())):
        if type(claims.get(field)) is not int or claims[field] < 0:
            raise OIDCError("id_token")
    now = int(time.time())
    _, max_age = _config(config)
    if not claims["auth_time"] <= claims["iat"] <= now < claims["exp"]:
        raise OIDCError("id_token")
    if max_age == 0:
        # max_age=0 requests a fresh login. NumericDate uses whole seconds here;
        # bind that authentication to the retained transaction's start.
        if claims["auth_time"] < _requested_at(requested_at):
            raise OIDCError("id_token")
    elif now - claims["auth_time"] > max_age:
        raise OIDCError("id_token")
    required_acr = config.get("required_acr_values", [])
    if required_acr and claims.get("acr") not in required_acr:
        raise OIDCError("id_token")
    result = {key: claims[key] for key in ("iss", "sub", "auth_time", "iat", "exp")}
    for name in config.get("claim_names", ["name"]):
        if name in claims:
            result[name] = _claim_value(claims[name])
    if required_acr:
        result["acr"] = claims["acr"]
    return result


def _claim_value(value):
    """Retain bounded verified attributes, never arbitrary nested provider data."""
    if value is None or type(value) is bool:
        return value
    if type(value) is int:
        if abs(value) > 9007199254740991:
            raise OIDCError("id_token")
        return value
    if type(value) is float:
        if not math.isfinite(value) or abs(value) > 9007199254740991:
            raise OIDCError("id_token")
        return value
    if isinstance(value, str):
        if len(value) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise OIDCError("id_token")
        return value
    if isinstance(value, list) and len(value) <= 256:
        if any(not isinstance(item, str) or len(item) > 512
               or any(ord(c) < 32 or ord(c) == 127 for c in item) for item in value):
            raise OIDCError("id_token")
        return list(value)
    raise OIDCError("id_token")


def _requested_at(value):
    if type(value) not in (int, float) or not 0 <= value <= time.time():
        raise OIDCError("authorization_response")
    return int(value)


def validate_response_issuer(config, metadata, response_issuer=None):
    """Validate RFC 9207 issuer for both successful and error callbacks."""
    _metadata(config, metadata)
    if ((metadata.get("authorization_response_iss_parameter_supported", False)
            and response_issuer is None)
            or (response_issuer is not None and response_issuer != config["issuer"])):
        raise OIDCError("authorization_response")


def exchange(config, metadata, code, verifier, nonce, *,
             response_issuer=None, requested_at=None):
    """Exchange one code and return verified claims; never return provider tokens."""
    validate_response_issuer(config, metadata, response_issuer)
    _transaction(nonce, verifier)
    _text(code, 4096, "authorization_response", ascii_only=True)
    if config.get("max_age", 300) == 0:
        _requested_at(requested_at)  # Validate retained context before spending a code.
    secret = os.environ.get(config["client_secret_env"])
    if not isinstance(secret, str) or not secret or len(secret) > 8192:
        raise OIDCError("configuration")
    credential = urllib.parse.quote_plus(config["client_id"], safe="") + ":" + (
        urllib.parse.quote_plus(secret, safe=""))
    authorization = "Basic " + base64.b64encode(credential.encode("ascii")).decode("ascii")
    body = urllib.parse.urlencode({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": config["redirect_uri"], "code_verifier": verifier,
    }).encode("ascii")
    response = _request(config, metadata["token_endpoint"], "token_response",
                        data=body, headers={"Authorization": authorization,
                        "Content-Type": "application/x-www-form-urlencoded"})
    if ("error" in response or not isinstance(response.get("token_type"), str)
            or response["token_type"].lower() != "bearer"):
        raise OIDCError("token_response")
    _text(response.get("access_token"), 32768, "token_response", ascii_only=True)
    return _verified_claims(config, metadata, response.get("id_token"), nonce, requested_at)

