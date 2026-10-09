"""CartWitness: consent-first AI-assisted shopping with a PayPal sandbox payment rail.

Local competition demo, not a production payment processor.
No live PayPal endpoint is present or configurable.
"""
import base64
import hmac
import json
import os
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from decimal import Decimal
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8765"))
ORIGIN = f"http://{HOST}:{PORT}"
PAYPAL_HOST = "https://api-m.sandbox.paypal.com"
FIXTURE = os.environ.get("DEMO_FIXTURE") == "1"
PAYPAL_READY = bool(os.environ.get("PAYPAL_CLIENT_ID") and os.environ.get("PAYPAL_CLIENT_SECRET"))
AI_READY = bool(os.environ.get("OPENAI_API_KEY"))
CATALOG = [
    {"sku": "trail-repair", "name": "Trail repair kit", "cents": 4295,
     "tags": "hiking outdoors repair emergency patch reusable",
     "why": "A compact repair set for outdoor trips."},
    {"sku": "desk-focus", "name": "Desk focus set", "cents": 3490,
     "tags": "work study laptop desk focus organizer ergonomic",
     "why": "A tidy workstation bundle for focused work."},
    {"sku": "garden-water", "name": "Water-saving garden kit", "cents": 5899,
     "tags": "plants garden drought watering conservation home",
     "why": "Water-efficient gardening essentials."},
    {"sku": "travel-light", "name": "Lightweight travel kit", "cents": 6750,
     "tags": "travel packing carry-on bag trip organizer",
     "why": "Light packing gear for repeat trips."},
    {"sku": "home-energy", "name": "Home energy monitor", "cents": 8950,
     "tags": "electricity energy watt smart home savings",
     "why": "A monitoring kit for household energy habits."},
    {"sku": "repair-starter", "name": "Everyday repair toolkit", "cents": 2495,
     "tags": "home screwdriver tools budget fix maintenance repair",
     "why": "Useful basic hand tools for low-cost fixes."}
]
CATALOG_BY_SKU = {p["sku"]: p for p in CATALOG}
SESSIONS = {}
LOCK = threading.RLock()


class ServiceError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def money(cents):
    return f"{cents // 100}.{cents % 100:02d}"


def budget_cents(value):
    value = str(value)
    if not re.fullmatch(r"(?:[1-9][0-9]{0,2}|[1-4][0-9]{3}|5000)(?:\.[0-9]{1,2})?", value):
        raise ServiceError(400, "Budget must be a positive USD amount below $5,001.")
    result = int(Decimal(value) * 100)
    if result < 1500 or result > 50000:
        raise ServiceError(400, "Supported catalogue budget: $15 through $500.")
    return result


def demo_selection(prompt, affordable):
    tokens = set(re.findall(r"[a-z]{3,}", prompt.lower()))
    def score(p):
        keywords = set(p["tags"].split()) | set(p["name"].lower().split())
        return (len(tokens & keywords), -p["cents"], p["sku"])
    return max(affordable, key=score)


class _NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    """Do not forward authenticated provider requests across HTTP redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_AUTH_SAFE_OPENER = urllib.request.build_opener(_NoAuthRedirect)


def api_json(url, *, method="GET", payload=None, headers=None, auth=None, form=None):
    data = None
    headers = dict(headers or {})
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if auth:
        headers["Authorization"] = auth
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _AUTH_SAFE_OPENER.open(req, timeout=12) as resp:
            raw = resp.read(65536)
        decoded = json.loads(raw)
        if not isinstance(decoded, dict):
            raise ValueError("Provider JSON root must be an object.")
        return decoded
    except urllib.error.HTTPError as exc:
        kind = "PayPal sandbox" if url.startswith(PAYPAL_HOST) else "AI service"
        raise ServiceError(502, f"{kind} returned HTTP {exc.code}. No payment status assumed.") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise ServiceError(502, "Remote provider unavailable or returned invalid JSON.") from exc


def ai_selection(prompt, budget, affordable):
    if not AI_READY:
        if not FIXTURE:
            raise ServiceError(503, "Configure OPENAI_API_KEY for AI recommendations or enable labelled DEMO_FIXTURE=1.")
        chosen = demo_selection(prompt, affordable)
        return chosen, chosen["why"] + " (Offline rule-based fixture, not an AI inference.)", "fixture-ranking"
    inventory = [{"sku": p["sku"], "name": p["name"], "usd": money(p["cents"]),
                  "tags": p["tags"]} for p in affordable]
    body = {
        "model": os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "You are a constrained catalogue shopping advisor. "
             "Reply with one JSON object containing ONLY sku (a valid provided sku) "
             "and reason (at most 180 chars). Never invent products, prices or transactions."},
            {"role": "user", "content": json.dumps({"request": prompt, "budget_usd": money(budget),
                                                   "available_products": inventory})}
        ]
    }
    response = api_json(
        "https://api.openai.com/v1/chat/completions", method="POST", payload=body,
        auth="Bearer " + os.environ["OPENAI_API_KEY"])
    try:
        raw = response["choices"][0]["message"]["content"]
        choice = json.loads(raw)
        sku = choice["sku"]
        reason = choice["reason"]
        if sku not in {p["sku"] for p in affordable} or not isinstance(reason, str):
            raise ValueError("invalid recommended product")
        reason = reason.strip()
        if not 5 <= len(reason) <= 180:
            raise ValueError("invalid explanation")
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        raise ServiceError(502, "AI response did not match the bounded catalogue; no checkout created.") from exc
    return CATALOG_BY_SKU[sku], reason, "ai-model"


def paypal_token():
    if not PAYPAL_READY:
        raise ServiceError(503, "Sandbox credentials missing. No real PayPal order was created.")
    encoded = base64.b64encode(
        (os.environ["PAYPAL_CLIENT_ID"] + ":" + os.environ["PAYPAL_CLIENT_SECRET"]).encode()).decode()
    data = api_json(PAYPAL_HOST + "/v1/oauth2/token", method="POST",
                    form={"grant_type": "client_credentials"}, auth="Basic " + encoded)
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        raise ServiceError(502, "PayPal sandbox did not provide an access token.")
    return token


def paypal(endpoint, *, method="GET", payload=None, request_id=None):
    if not endpoint.startswith("/") or "//" in endpoint:
        raise ServiceError(400, "Invalid sandbox resource.")
    headers = {"Prefer": "return=representation"}
    if request_id:
        headers["PayPal-Request-Id"] = request_id
    return api_json(PAYPAL_HOST + endpoint, method=method, payload=payload,
                    headers=headers, auth="Bearer " + paypal_token())


def same_amount(purchase_units, chosen):
    if not isinstance(purchase_units, list) or len(purchase_units) != 1:
        return False
    unit = purchase_units[0]
    if not isinstance(unit, dict):
        return False
    amount = unit.get("amount")
    if not isinstance(amount, dict):
        return False
    return (unit.get("reference_id") == chosen["sku"]
            and amount.get("currency_code") == "USD"
            and amount.get("value") == money(chosen["cents"]))


def valid_approved_order(detail, chosen, expected_id):
    return (isinstance(detail, dict)
            and detail.get("id") == expected_id and detail.get("status") == "APPROVED"
            and same_amount(detail.get("purchase_units"), chosen))


def valid_capture(detail, chosen, expected_id):
    if not isinstance(detail, dict):
        return False
    if detail.get("id") != expected_id or detail.get("status") != "COMPLETED":
        return False
    if not same_amount(detail.get("purchase_units"), chosen):
        return False
    payments = detail["purchase_units"][0].get("payments")
    if not isinstance(payments, dict):
        return False
    captures = payments.get("captures")
    if not isinstance(captures, list) or len(captures) != 1:
        return False
    capture = captures[0]
    if not isinstance(capture, dict):
        return False
    amount = capture.get("amount")
    return (capture.get("status") == "COMPLETED"
            and isinstance(amount, dict)
            and amount.get("currency_code") == "USD"
            and amount.get("value") == money(chosen["cents"]))


def approval_url(order):
    links = order.get("links")
    if not isinstance(links, list):
        raise ServiceError(502, "PayPal sandbox order lacks a verified approval link.")
    for link in links:
        if not isinstance(link, dict) or link.get("rel") not in ("approve", "payer-action"):
            continue
        url = link.get("href", "")
        if not isinstance(url, str):
            continue
        parsed = urllib.parse.urlparse(url)
        if (parsed.scheme == "https" and parsed.hostname
                and (parsed.hostname == "sandbox.paypal.com"
                     or parsed.hostname.endswith(".sandbox.paypal.com"))):
            return url
    raise ServiceError(502, "PayPal sandbox order lacks a verified approval link.")


def session_for(handler):
    jar = cookies.SimpleCookie()
    try:
        jar.load(handler.headers.get("Cookie", ""))
    except cookies.CookieError:
        pass
    sid = jar["cw"].value if "cw" in jar else ""
    with LOCK:
        if sid not in SESSIONS:
            sid = secrets.token_urlsafe(30)
            SESSIONS[sid] = {"csrf": secrets.token_urlsafe(30), "phase": "idle",
                             "audit": [], "generation": secrets.token_urlsafe(16),
                             "revision": 0}
    handler.session_id = sid
    return SESSIONS[sid]


def summarize(state):
    plan = state.get("plan")
    return {"csrf": state["csrf"], "phase": state["phase"],
            "generation": state["generation"], "revision": state["revision"],
            "plan": plan, "order_id": state.get("order_id"),
            "approval_url": state.get("approval_url"), "audit": state["audit"][-7:],
            "mode": "fixture" if FIXTURE else "sandbox",
            "paypal_ready": PAYPAL_READY, "ai_ready": AI_READY,
            "catalogue": [{"sku": p["sku"], "name": p["name"], "price": money(p["cents"]),
                           "why": p["why"]} for p in CATALOG]}


def record(state, event, note):
    state["revision"] += 1
    state["audit"].append({"step": len(state["audit"]) + 1, "event": event, "detail": note})


def require_current_consent(body, state, *, for_capture=False):
    """A stale browser tab cannot authorize a different plan or returned order."""
    if (type(body.get("revision")) is not int
            or body["revision"] != state["revision"]
            or body.get("generation") != state["generation"]):
        raise ServiceError(409, "Checkout changed. Refresh and review before approving.")
    if for_capture:
        if body.get("order_id") != state.get("order_id"):
            raise ServiceError(409, "Approved order changed. Refresh before confirming capture.")
    else:
        chosen = state["chosen"]
        if body.get("sku") != chosen["sku"] or body.get("usd") != money(chosen["cents"]):
            raise ServiceError(409, "Reviewed product or price changed. Refresh before ordering.")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Intentionally do not log PayPal OAuth, payer tokens or session cookies.
        print("CartWitness HTTP", args[1] if len(args) > 1 else "served")

    def send(self, status, body, mimetype="application/json"):
        raw = body if isinstance(body, bytes) else body.encode()
        self.send_response(status)
        self.send_header("Content-Type", mimetype + ("; charset=utf-8" if mimetype.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        if getattr(self, "session_id", None):
            self.send_header("Set-Cookie", f"cw={self.session_id}; HttpOnly; SameSite=Lax; Path=/")
        self.end_headers()
        self.wfile.write(raw)

    def json_out(self, status, data):
        self.send(status, json.dumps(data).encode())

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        static = {"/": ("static/index.html", "text/html"),
                  "/app.js": ("static/app.js", "application/javascript"),
                  "/style.css": ("static/style.css", "text/css")}
        if path in static:
            name, mime = static[path]
            return self.send(200, (ROOT / name).read_bytes(), mime)
        if path not in ("/api/state", "/api/return", "/api/cancel"):
            return self.json_out(404, {"error": "Not found."})
        state = session_for(self)
        with LOCK:
            if path == "/api/state":
                return self.json_out(200, summarize(state))
            if path == "/api/cancel":
                if state["phase"] in ("approval_pending", "payer_returned"):
                    state["phase"] = "cancelled"
                    record(state, "cancelled", "No payment capture attempted.")
                return self.redirect("/")
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            returned_id = params.get("token", [""])[0]
            if not hmac.compare_digest(returned_id, state.get("order_id", "_")):
                return self.json_out(400, {"error": "Return token does not match this session's order."})
            if state["phase"] == "approval_pending":
                if state.get("fixture_order"):
                    state["phase"] = "payer_returned"
                    record(state, "fixture-return", "Simulated payer return; not PayPal approval.")
                else:
                    try:
                        detail = paypal("/v2/checkout/orders/" + urllib.parse.quote(returned_id))
                        if not valid_approved_order(detail, state["chosen"], returned_id):
                            raise ServiceError(409, "PayPal order not APPROVED at its recorded amount.")
                    except ServiceError as exc:
                        return self.json_out(exc.status, {"error": str(exc)})
                    state["phase"] = "payer_returned"
                    record(state, "payer-return", "Sandbox order APPROVED and amount verified. Not captured.")
            return self.redirect("/")

    def redirect(self, destination):
        self.send_response(303)
        self.send_header("Location", destination)
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "session_id", None):
            self.send_header("Set-Cookie", f"cw={self.session_id}; HttpOnly; SameSite=Lax; Path=/")
        self.end_headers()

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        if route not in ("/api/plan", "/api/order", "/api/capture", "/api/reset"):
            return self.json_out(404, {"error": "Unknown action."})
        state = session_for(self)
        origin = self.headers.get("Origin", "")
        if origin not in (ORIGIN, f"http://localhost:{PORT}"):
            return self.json_out(403, {"error": "Same-origin browser request required."})
        if not hmac.compare_digest(self.headers.get("X-CSRF", ""), state["csrf"]):
            return self.json_out(403, {"error": "Session CSRF token missing."})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.json_out(415, {"error": "JSON required."})
        try:
            length = int(self.headers.get("Content-Length", "-1"))
            if not 0 <= length <= 4096:
                raise ServiceError(413, "JSON input exceeds 4 KB or has missing length.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ServiceError(400, "JSON object required.")
            with LOCK:
                result = self.action(route, payload, state)
            return self.json_out(200, result)
        except ServiceError as exc:
            return self.json_out(exc.status, {"error": str(exc)})
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.json_out(400, {"error": "Invalid JSON input."})

    def action(self, route, body, state):
        if route == "/api/reset":
            csrf = state["csrf"]
            generation = state["generation"]
            revision = state["revision"] + 1
            state.clear()
            state.update({"csrf": csrf, "phase": "idle", "audit": [],
                          "generation": generation, "revision": revision})
            return summarize(state)
        if route == "/api/plan":
            if state["phase"] not in ("idle", "planned", "cancelled", "fixture_completed", "completed"):
                raise ServiceError(409, "Complete or cancel the current checkout first.")
            prompt = body.get("prompt", "")
            if not isinstance(prompt, str) or not 8 <= len(prompt.strip()) <= 350:
                raise ServiceError(400, "Describe the shopping goal in 8–350 characters.")
            budget = budget_cents(body.get("budget", "0"))
            affordable = [p for p in CATALOG if p["cents"] <= budget]
            if not affordable:
                raise ServiceError(422, "No catalogue product within budget.")
            choice, reason, method = ai_selection(prompt, budget, affordable)
            state.update({"phase": "planned", "chosen": choice, "plan": {
                "sku": choice["sku"], "name": choice["name"], "usd": money(choice["cents"]),
                "reason": reason, "method": method, "budget_usd": money(budget)},
                "order_id": None, "approval_url": None, "fixture_order": False,
                "order_request_id": str(uuid.uuid4())})
            record(state, "plan", f"{method}: {choice['sku']}; server-priced {money(choice['cents'])} USD.")
            return summarize(state)
        if route == "/api/order":
            if state["phase"] == "approval_pending":
                return summarize(state)
            if state["phase"] != "planned" or body.get("approved") is not True:
                raise ServiceError(409, "Explicit buyer consent to the selected item and price is required.")
            require_current_consent(body, state)
            chosen = state["chosen"]
            if FIXTURE and not PAYPAL_READY:
                oid = "FIXTURE-" + uuid.uuid4().hex[:14]
                url = "/api/return?token=" + urllib.parse.quote(oid)
                state["fixture_order"] = True
            else:
                # A timeout can follow successful provider-side creation. Retry
                # this *same* plan with its original PayPal-Request-Id.
                order = paypal("/v2/checkout/orders", method="POST", request_id=state["order_request_id"],
                    payload={"intent": "CAPTURE", "purchase_units": [
                        {"reference_id": chosen["sku"], "description": chosen["name"],
                         "amount": {"currency_code": "USD", "value": money(chosen["cents"])}}],
                        "payment_source": {"paypal": {"experience_context": {
                            "return_url": ORIGIN + "/api/return",
                            "cancel_url": ORIGIN + "/api/cancel",
                            "shipping_preference": "NO_SHIPPING", "user_action": "PAY_NOW"}}}})
                oid = order.get("id")
                if not isinstance(oid, str) or not re.fullmatch(r"[A-Z0-9]{8,32}", oid):
                    raise ServiceError(502, "Unexpected PayPal sandbox order ID.")
                url = approval_url(order)
                state["fixture_order"] = False
            state.update({"phase": "approval_pending", "order_id": oid, "approval_url": url,
                          "capture_request_id": str(uuid.uuid4())})
            record(state, "order", "Fixture only (no money)." if state["fixture_order"]
                   else "PayPal sandbox order created; payer approval pending.")
            return summarize(state)
        if route == "/api/capture":
            if state["phase"] in ("fixture_completed", "completed"):
                return summarize(state)
            if state["phase"] != "payer_returned" or body.get("confirmed") is not True:
                raise ServiceError(409, "Buyer must return from approval and explicitly confirm capture.")
            require_current_consent(body, state, for_capture=True)
            if state["fixture_order"]:
                state["phase"] = "fixture_completed"
                record(state, "fixture-capture", "Local fake capture; NOT an actual PayPal payment.")
                return summarize(state)
            oid = state["order_id"]
            chosen = state["chosen"]
            detail = paypal("/v2/checkout/orders/" + urllib.parse.quote(oid))
            if not valid_approved_order(detail, chosen, oid):
                raise ServiceError(409, "Sandbox order not approved at original item and amount.")
            captured = paypal("/v2/checkout/orders/" + urllib.parse.quote(oid) + "/capture",
                              method="POST", payload={}, request_id=state["capture_request_id"])
            if not valid_capture(captured, chosen, oid):
                raise ServiceError(409, "Capture response did not prove COMPLETED at original amount.")
            state["phase"] = "completed"
            record(state, "sandbox-capture", "PayPal sandbox capture COMPLETED; no live money.")
            return summarize(state)
        raise ServiceError(404, "Unknown action.")


if __name__ == "__main__":
    if not FIXTURE and (not PAYPAL_READY or not AI_READY):
        print("Keys missing: sandbox checkout and model require PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, OPENAI_API_KEY.")
        print("For an explicitly labelled offline walkthrough: DEMO_FIXTURE=1 python3 server.py")
    print(f"CartWitness local-only: {ORIGIN} | sandbox configured={PAYPAL_READY} | model configured={AI_READY}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
