"""Institutional HTTP boundary for the original audit host.

The host keeps one workspace/session authority. Browser transactions are bound
to the exact workspace and provider, use a single-use retained state record, and
return to a fixed same-origin application route.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import time
from datetime import datetime, timezone
from http import cookies
from urllib.parse import urlencode, urlsplit

from . import identity_oidc
from .store import Forbidden, encoded, fingerprint, identifier, now


def public_origin(value):
    if not isinstance(value, str) or not value.isascii() or len(value) > 2048:
        raise ValueError("Set the registered HTTPS application origin.")
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or not value.startswith("https://")
                or not parsed.hostname or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or "?" in value or "#" in value or "\\" in value or "%" in parsed.netloc
                or any(c.isspace() for c in value)
                or parsed.port is not None and not 1 <= parsed.port <= 65535):
            raise ValueError()
    except ValueError:
        raise ValueError("Set one HTTPS origin without a path, query, credentials or fragment.") from None
    return "https://" + parsed.netloc.lower()


def request_context(handler):
    host = handler.headers.get("Host")
    if host not in handler.server.accepted_hosts:
        raise Forbidden("Open the configured workspace address.")
    handler.request_origin = (handler.server.origin if handler.server.public_origin
                              else ("https://" if handler.server.direct_tls else "http://") + host)
    callback = handler.path_only == "/api/identity/callback" and handler.command == "GET"
    if not callback:
        origin = handler.headers.get("Origin")
        if origin is not None and origin != handler.request_origin:
            raise Forbidden("This request originated outside the workspace.")
        if handler.headers.get("Sec-Fetch-Site") == "cross-site":
            raise Forbidden("Open the workspace directly.")
    handler.cookie_secure = handler.request_origin.startswith("https://")


def callback_url(handler, provider_id):
    if not handler.cookie_secure:
        raise Forbidden("Configure this workspace's HTTPS address before institutional sign-in.")
    return handler.request_origin + "/api/identity/callback?" + urlencode({
        "workspace": handler.workspace_key, "provider": identifier(provider_id)})


def cookie_value(handler, name):
    value = cookies.SimpleCookie()
    with contextlib.suppress(cookies.CookieError):
        value.load(handler.headers.get("Cookie", ""))
    return value[name].value if name in value else ""


def session_cookie(handler, token, *, maximum=28800, same_site="Strict"):
    return (handler.cookie_name + "=" + token + "; HttpOnly; SameSite=" + same_site
            + "; Path=/; Max-Age=" + str(max(0, int(maximum)))
            + ("; Secure" if handler.cookie_secure else ""))


def _flow_name(handler, provider_id):
    return "audit_flow_" + handler.workspace_key + "_" + fingerprint(provider_id)[:16]


def _flow_cookie(handler, provider_id, value, maximum):
    return (_flow_name(handler, provider_id) + "=" + value
            + "; HttpOnly; SameSite=Lax; Path=/api/identity/callback; Max-Age=" + str(maximum)
            + "; Secure")


def _back(handler, result, headers):
    location = "/?" + urlencode({"workspace": handler.workspace_key})
    if result:
        location += "#" + urlencode({"identity": result})
    handler._send(303, b"", headers={"Location": location, "Set-Cookie": headers})


def _callback(handler):
    q = handler.query
    if not q.get("workspace") or not q.get("provider"):
        raise Forbidden("The callback must select its original workspace and provider.")
    provider_id = identifier(q["provider"])
    callback = callback_url(handler, provider_id)
    clear = _flow_cookie(handler, provider_id, "", 0)
    flow = None
    try:
        flow = handler.service.identity.consume_login(
            q.get("state"), cookie_value(handler, _flow_name(handler, provider_id)), provider_id, callback)
        config = flow["provider"]["payload"]["configuration"]
        metadata = flow["provider"]["payload"]["metadata"]
        identity_oidc.validate_response_issuer(config, metadata, q.get("iss"))
        if q.get("error"):
            if q.get("code"):
                raise identity_oidc.OIDCError("authorization_response")
            handler.service.identity._transient(lambda: handler.service.store._event(
                "institutional-sign-in", "institutional_provider_declined", provider_id,
                {"provider_revision": flow["provider_revision"]}))
            return _back(handler, "provider_declined", [clear])
        claims = identity_oidc.exchange(
            config, metadata, q.get("code"), flow["verifier"], flow["nonce"],
            response_issuer=q.get("iss"), requested_at=flow["requested_at"])
        result = handler.service.identity.complete_login(flow, claims, handler.headers.get("User-Agent", ""))
        if not result["permitted"]:
            return _back(handler, "access_review", [clear])
        old = cookie_value(handler, handler.cookie_name)
        if old:
            handler.service.store.end_session(old)
        remaining = max(0, int(
            (datetime.fromisoformat(result["session"]["expires_at"]) - datetime.now(timezone.utc)).total_seconds()))
        return _back(handler, "opened", [
            clear, session_cookie(handler, result["token"], maximum=remaining, same_site="Lax")])
    except (identity_oidc.OIDCError, Forbidden, ValueError, KeyError):
        if flow:
            handler.service.identity._transient(lambda: handler.service.store._event(
                "institutional-sign-in", "institutional_callback_not_adopted", provider_id,
                {"provider_revision": flow["provider_revision"]}))
        return _back(handler, "sign_in_failed", [clear])


def get(handler):
    """Return true after serving an identity route; otherwise continue the host."""
    path, q = handler.path_only, handler.query
    if path == "/api/identity/providers":
        providers = (handler.service.identity.public_providers(lambda p: callback_url(handler, p))
                     if handler.cookie_secure else [])
        handler._send(200, {"providers": providers, "https_configured": handler.cookie_secure,
                            "workspace": handler.workspace_key})
        return True
    if path == "/api/identity/callback":
        _callback(handler)
        return True
    if not path.startswith("/api/identity/"):
        return False
    actor = handler._session()
    identity = handler.service.identity
    if path == "/api/identity/state":
        result = identity.state(actor)
        result["host"] = {"origin": handler.request_origin, "https_configured": handler.cookie_secure,
                          "workspace": handler.workspace_key}
        with handler.service.store.lock:
            row = handler.service.store.db.execute(
                "SELECT id FROM identity_session_details WHERE token_sha256=?",
                (hashlib.sha256(handler.session_token.encode()).hexdigest(),)).fetchone()
            result["request_session_id"] = row["id"] if row else None
        if result["capabilities"]["owner"]:
            result["callbacks"] = {
                r["id"]: callback_url(handler, r["id"]) if handler.cookie_secure else None
                for r in result["providers"]}
    elif path == "/api/identity/history":
        result = {"editions": identity.history(actor, q["kind"], q["id"])}
    elif path == "/api/identity/sessions":
        result = {"sessions": identity.sessions(actor, q.get("account"))}
    elif path == "/api/identity/attestation-preview":
        result = identity.preview_attestation(actor, q["provider"])
    elif path == "/api/identity/contract":
        result = json.loads(handler.service.identity_contract_bytes)
    elif path == "/api/identity/export":
        with handler.service.store.lock:
            identity._owner(actor)
            current = identity.state(actor)
            from .identity import KINDS
            histories = {kind: {r["id"]: handler.service.store.history(kind, r["id"])
                               for r in handler.service.store.records(kind)} for kind in sorted(KINDS)}
            result = {
                "schema": "commons-audit-institutional-access-review/1", "captured_at": now(),
                "workspace_id": handler.service.store.setting("workspace_id"),
                "contract_sha256": hashlib.sha256(handler.service.identity_contract_bytes).hexdigest(),
                "state": current, "editions": histories,
                "receiving": "Restore the original encrypted workspace; review and reactivate providers and delegated administration with the new owner.",
            }
            data = encoded(result).encode()
        handler._send(200, data, "application/json", {
            "Content-Disposition": 'attachment; filename="Institutional_Access_Review.json"',
            "X-Content-SHA256": hashlib.sha256(data).hexdigest()})
        return True
    else:
        handler._send(404, {"error": "This institutional workspace route does not exist."})
        return True
    handler._send(200, result)
    return True


def post(handler, body):
    """The original host has already required same-origin JSON and X-Audit-Request."""
    if handler.path_only != "/api/identity/login":
        return False
    if set(body) != {"provider_id"}:
        raise ValueError("Choose one configured institutional provider.")
    provider_id = identifier(body["provider_id"])
    opened = handler.service.identity.begin_login(
        provider_id, callback_url(handler, provider_id), handler.client_address[0])
    handler._send(200, {"authorization_url": opened["authorization_url"], "expires_in": opened["expires_in"]},
                  headers={"Set-Cookie": _flow_cookie(
                      handler, provider_id, opened["browser_binding"], opened["expires_in"])})
    return True
