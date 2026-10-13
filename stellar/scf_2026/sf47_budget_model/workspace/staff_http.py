"""Apply named staff permissions before the existing SF47 HTTP writers."""
from __future__ import annotations

from http.cookies import SimpleCookie, CookieError
import hmac
import re
from urllib.parse import parse_qs, unquote, urlsplit

from model import Problem
from staff_access import SCHEMA, MEMBER_ID, owner_principal, fail
from operations_agenda_http import ROUTE as DELIVERY_AGENDA_ROUTE, selection as agenda_selection

FINANCE_COMMANDS = {
    "source.add", "contributor.save", "work.save", "work.submit",
    "invoice.save", "invoice.review", "invoice.dispute", "invoice.reopen", "invoice.void",
    "cash.record", "cash.void", "statement.receive", "statement-setup.save", "forecast.save", "portfolio.save",
    "work-intake.upload", "work-intake.save", "work-intake.apply",
    "workbook.prepare", "workbook.save", "workbook.return", "supplier-statement.save",
    "engagement.prepare", "engagement.receiving",
    "expense.receive", "expense.save", "expense.review", "expense.reopen", "expense.void",
}
REVIEW_COMMANDS = {"review", "work.accept", "work.reopen",
                   "implementation.prepare", "cohort.prepare", "completion.prepare", "completion.corrections.save"}
READ_POSTS = {
    "gravitee/inspect", "gravitee/member", "gravitee/template", "gravitee/prepare",
    "risk-register-seed", "risk-register-preview", "risk-register-request",
    "installation-return-seed", "installation-return-preview", "installation-return-review-seed",
    "installation-return-review-preview",
    "workbook-preview", "workbook-return-preview",
    "supplier-statements/seed", "supplier-statements/preview", "supplier-statements/source", "supplier-statements/request",
    "work-intake-preview", "ledger-intake-inspect", "ledger-intake-preview", "statement-inspect", "statement-preview",
    "implementation-source", "implementation-preview", "cohort-seed", "cohort-preview",
    "installation-workflows", "installation-workflow-seed", "installation-workshares",
    "installation-workshare-seed", "installation-seed", "installation-preview",
    "installation-effort-seed", "installation-effort-selection",
    "installation-commissioning-seed", "installation-commissioning-review",
    "completion-installations", "completion-installations-preview", "completion-seed", "completion-preview", "completion-corrections-seed", "completion-corrections-preview", "support-preview", "buyer-preview",
    "forecast-preview", "portfolio-preview", "portfolio-seed", "portfolio-selection",
    "expense-preview", "expense-request",
    "engagement-seed", "engagement-preview", "engagement-forecast", "engagement-portfolio", "engagement-request",
    "cash-correction-preview", "amendment-preview", "amendment-calendar-export",
    "installation-commercial", "installation-commercial-seed",
    "funding-seed", "funding-preview", "award-terms-seed", "award-terms-preview",
    "award-terms-plan-seed", "award-terms-plan-preview", "issuer-correspondence-inspect",
    "task-outcomes-seed", "task-outcomes-preview", "customer-use-calendar",
    "customer-use-calendar-expand", "customer-use-calendar-cohort", "account-reconciliation-preview",
}


def register_static(static):
    static.update({"/team": ("staff.html", "text/html; charset=utf-8"),
                   "/staff.mjs": ("staff.mjs", "text/javascript; charset=utf-8"),
                   "/staff-session.mjs": ("staff-session.mjs", "text/javascript; charset=utf-8"),
                   "/staff-recovery.mjs": ("staff-recovery.mjs", "text/javascript; charset=utf-8"),
                   "/staff-desk-recovery.mjs": ("staff-desk-recovery.mjs", "text/javascript; charset=utf-8"),
                   "/staff-recovery.css": ("staff-recovery.css", "text/css; charset=utf-8"),
                   "/FINANCIAL_DESK_RECOVERY.md": ("FINANCIAL_DESK_RECOVERY.md", "text/markdown; charset=utf-8"),
                   "/staff.css": ("staff.css", "text/css; charset=utf-8")})


def cookie_token(handler):
    cookie = SimpleCookie()
    try:
        cookie.load(handler.headers.get("Cookie", ""))
        item = cookie.get(handler.server.staff.cookie_name)
        return item.value if item else None
    except CookieError:
        return None


def cookie_header(handler, token="", clear=False):
    # The original server binds only to loopback; remote staff use an SSH tunnel.
    # Cookies have an installation-specific name because cookies are not port-scoped.
    return (handler.server.staff.cookie_name + "=" + token
            + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + ("0" if clear else "28800"))


def authenticate(handler):
    access = handler.server.staff
    authorization = handler.headers.get("Authorization")
    if authorization is not None:
        if not hmac.compare_digest(authorization.encode(), ("Bearer " + handler.server.token).encode()):
            fail("Sign in with your staff profile or original private owner link.", "ACCESS_REQUIRED", 401)
        handler.staff_session = None
        handler.staff_cookie = None
        return owner_principal()
    handler.staff_cookie = cookie_token(handler)
    handler.staff_session = access.session(handler.staff_cookie)
    return handler.staff_session["principal"] if handler.staff_session else None


def require_csrf(handler):
    if not getattr(handler, "staff_session", None):
        return
    supplied = handler.headers.get("X-CSRF-Token", "")
    expected = handler.staff_session["csrfToken"]
    if (handler.headers.get("Origin") not in handler.server.allowed_origins
            or not hmac.compare_digest(supplied.encode(), expected.encode())):
        fail("Reopen this staff session before saving.", "STAFF_CSRF")


def operations(handler):
    import operations_http
    return operations_http.store(handler)


def bind_actor(handler, body):
    principal = handler.principal
    if principal["role"] != "owner":
        if (handler.headers.get("X-Grant-Staff") is not None and "actor" in body
                and (not isinstance(body["actor"], str) or body["actor"].strip() != principal["actor"])):
            fail("This retained request belongs to its original recording operator. "
                 "Keep it and receive it with that operator.", "STAFF_REQUEST_ACTOR_CHANGED", 403)
        # Keep the original command journal and its replay fingerprint. The stable
        # actor assigned on enrollment survives later display-name edits.
        body["actor"] = principal["actor"]
    return body


def require_context(handler):
    """Keep an open desk with its original installation and named principal."""
    expected = {}
    for name, pattern in (("X-Grant-Staff", MEMBER_ID),
                          ("X-Grant-Installation", re.compile(r"[0-9a-f]{32}"))):
        values = handler.headers.get_all(name, [])
        if not values:
            continue
        if (len(values) != 1 or not isinstance(values[0], str)
                or not pattern.fullmatch(values[0])):
            fail("Use one original ASCII staff or installation ID in each context header.",
                 "STAFF_CONTEXT_INVALID", 403)
        expected[name] = values[0]
    if not expected:
        return
    principal = handler.principal
    if principal is None:
        fail("Sign in as the original staff member to continue this desk.",
             "ACCESS_REQUIRED", 401)
    installation_id = expected.get("X-Grant-Installation")
    if installation_id is not None and not hmac.compare_digest(
            installation_id, handler.server.staff.installation_id):
        fail("This desk belongs to another installation. Reopen the selected installation before continuing.",
             "STAFF_INSTALLATION_CHANGED", 403)
    member_id = expected.get("X-Grant-Staff")
    if member_id is not None and not hmac.compare_digest(member_id, principal["id"]):
        fail("This desk belongs to another sign-in. Reopen it as the original staff member or open a separate desk.",
             "STAFF_IDENTITY_CHANGED", 403)


def authorize(handler):
    parsed = urlsplit(handler.path)
    path, method = parsed.path, handler.command
    handler.principal = authenticate(handler)
    require_context(handler)
    if (method in ("GET", "HEAD") and path == "/api/staff/session"
            or method == "POST" and path == "/api/staff/login"):
        return
    principal = handler.principal
    if principal is None:
        fail("Sign in with your staff ID and access code.", "ACCESS_REQUIRED", 401)
    if method == "POST":
        require_csrf(handler)
    if principal["role"] == "owner":
        return
    if unquote(path) != path:
        fail("Use the original workspace route.", "STAFF_ROUTE", 422)
    if path.startswith("/api/staff/"):
        if path in ("/api/staff/session", "/api/staff/logout", "/api/staff/workboard"):
            return
        if not principal["administrator"]:
            fail("An installation administrator manages staff and whole-workspace recovery.")
        return
    access, role = handler.server.staff, principal["role"]
    if path == "/api/access":
        return
    if path == "/api/plans" and method in ("GET", "HEAD"):
        if role == "contributor":
            fail("Open the contributor work desk at /team.")
        return
    if path in ("/api/source-tables/workbook/inspect", "/api/source-tables/workbook/project"):
        if role == "contributor":
            fail("Use the contributor desk for this person's source attachments.")
        # These original parser routes only inspect the workbook supplied in the
        # request; they do not read or change a saved plan or another case.
        return
    plan = re.fullmatch(r"/api/plans/(plan-[a-f0-9]{32})(?:/(.*))?", path)
    if plan:
        if role == "contributor" or not access.plan_allowed(principal, plan[1]):
            fail("This plan is outside the staff profile's selected cases.")
        # The comparison can include another plan. Apply the same case selection
        # before the original calculator reads either side.
        query = parse_qs(parsed.query)
        for key, values in query.items():
            for value in values:
                if re.fullmatch(r"plan-[a-f0-9]{32}", value) and not access.plan_allowed(principal, value):
                    fail("Select comparison plans available to this staff profile.")
        if method == "POST" and plan[2] == "clone" and principal["caseIds"] != ["*"]:
            fail("An installation-wide lead creates planning alternatives.")
        if method in ("GET", "HEAD") or plan[2] == "estimate" or role == "lead":
            return
        fail("A delivery lead saves planning revisions.")
    if path.startswith("/api/operations/commercial-connections"):
        if principal["administrator"] or method in ("GET", "HEAD") and role in ("lead", "finance"):
            if method == "POST":
                bind_actor(handler, handler.json_body())
            return
        fail("A lead or finance operator uses the installation's accounting directory.")
    if DELIVERY_AGENDA_ROUTE.fullmatch(path) and method in ("GET", "HEAD"):
        if role == "contributor":
            fail("Open the contributor work desk at /team.")
        identities, _as_of, _versions = agenda_selection(parse_qs(parsed.query, keep_blank_values=True))
        if any(not access.case_allowed(principal, ident) for ident in identities):
            fail("Select agenda cases available to this staff profile.")
        return
    if path in ("/api/operations", "/api/operations/installation-source-profiles") and method in ("GET", "HEAD"):
        if role == "contributor":
            fail("Open the contributor work desk at /team.")
        return
    case = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})(?:/(.*))?", path)
    if case:
        case_id, action = case[1], case[2] or ""
        if not access.case_allowed(principal, case_id):
            fail("This case is outside the staff profile's selection.")
        if method in ("GET", "HEAD"):
            if role != "contributor":
                return
            source = re.fullmatch(r"sources/(source-[a-f0-9]{32})", action)
            if source and access.contributor_source(principal, operations(handler), case_id, source[1]):
                return
            fail("The contributor desk shows this person's work, invoices and attachments.")
        body = handler.json_body()
        if action == "command":
            if role == "contributor":
                access.contributor_command(principal, operations(handler), case_id, body)
            elif role == "finance" and body.get("action") not in FINANCE_COMMANDS:
                fail("This command belongs to a delivery lead or reviewer.")
            elif role == "reviewer" and body.get("action") not in REVIEW_COMMANDS:
                fail("This reviewer can accept work and prepare original case reviews.")
            bind_actor(handler, body)
            return
        if role == "contributor":
            fail("Use the contributor desk's original work and invoice commands.")
        if (action in READ_POSTS or re.fullmatch(
                r"installation-sources/source-desk-[a-f0-9]{32}/files/input-[a-f0-9]{64}/inspect", action) or re.fullmatch(
                r"installation-sources/source-desk-[a-f0-9]{32}/editions/(compare|preview)", action) or re.fullmatch(
                r"installation-sources/source-desk-[a-f0-9]{32}/mappings/(compare|preview|compare-wire|preview-wire|draft-wire)", action)):
            if action == "installation-commissioning-review":
                bind_actor(handler, body)
            return
        if role == "lead" or role == "finance" and (
                action in ("ledger-intake-apply", "cash-correction", "account-reconciliation", "workbook-apply") or action.startswith(("commercial/", "expense-billing/", "work-billing/"))):
            # Commercial preview bodies use the original actor where supplied.
            if "actor" in body or action in ("ledger-intake-apply", "cash-correction", "account-reconciliation", "workbook-apply"):
                bind_actor(handler, body)
            return
        fail("This staff role cannot apply this operating change.")
    if (role == "lead" and principal["caseIds"] == ["*"]
            and path in ("/api/import-bundle", "/api/import-scenario", "/api/operations",
                         "/api/operations/import", "/api/operations/intake")):
        if path in ("/api/operations", "/api/operations/intake"):
            bind_actor(handler, handler.json_body())
        return
    fail("This route is outside the staff profile's operating access.")


def filter_response(handler, status, body):
    principal = getattr(handler, "principal", None)
    if status != 200 or not principal or principal["role"] == "owner" or not isinstance(body, dict):
        return body
    path, access = urlsplit(handler.path).path, handler.server.staff
    if handler.command == "GET" and path == "/api/plans":
        return {**body, "plans": [row for row in body["plans"] if access.plan_allowed(principal, row["id"])]}
    if handler.command == "GET" and path == "/api/operations":
        return {**body, "cases": [row for row in body["cases"] if access.case_allowed(principal, row["id"])]}
    if path == "/api/access":
        return {k: v for k, v in body.items() if k not in ("launch", "managedLaunch")} | {"principal": principal}
    return body


def record_operation(handler, status, body):
    principal = getattr(handler, "principal", None)
    if (handler.command != "POST" or not principal or principal["role"] == "owner"
            or not 200 <= status < 300 or urlsplit(handler.path).path.startswith("/api/staff/")):
        return
    supplied = getattr(handler, "_json_cache", {})
    result = body if isinstance(body, dict) else {}
    handler.server.staff.event(principal["actor"], "operation", principal["id"],
        {"path": urlsplit(handler.path).path, "action": supplied.get("action"),
         "requestId": supplied.get("requestId") or handler.headers.get("X-Request-ID"),
         "id": result.get("id"), "version": result.get("version", result.get("revision"))})


def read(handler, parsed):
    path, access = parsed.path, handler.server.staff
    if not path.startswith("/api/staff/"):
        return False
    if path == "/api/staff/session":
        result = handler.staff_session or (
            {"authenticated": True, "principal": handler.principal, "csrfToken": None}
            if handler.principal else {"authenticated": False})
        if result.get("authenticated"):
            result = {**result, "installationId": access.installation_id}
    elif path == "/api/staff/workboard":
        result = access.contributor_board(handler.principal, operations(handler))
    elif path == "/api/staff/members":
        result = {"schema": SCHEMA, "members": access.members()}
    elif path == "/api/staff/catalog":
        ops = operations(handler)
        result = {"cases": [{**case, "contributors": [
            {"id": row["id"], "name": row["name"], "kind": row["kind"]}
            for row in ops.read(case["id"])["records"]["contributors"]]} for case in ops.list()]}
    elif path == "/api/staff/events":
        query = parse_qs(parsed.query)
        try:
            after, limit = int(query.get("after", ["0"])[0]), int(query.get("limit", ["100"])[0])
        except ValueError:
            fail("Use the original staff-event cursor and a whole-number page size.", "STAFF_EVENT_CURSOR", 422)
        result = access.events(after, limit)
    elif path == "/api/staff/installation/export.zip":
        from staff_installation import export_installation
        raw, _manifest = export_installation(handler.server.workspace)
        handler.send(200, raw, "application/zip", "grant-team-installation.zip")
        return True
    else:
        raise Problem("Staff page not found.", 404, "NOT_FOUND")
    handler.send(200, result)
    return True


def write(handler, parsed):
    path, access = parsed.path, handler.server.staff
    if not path.startswith("/api/staff/"):
        return False
    if path == "/api/staff/login":
        body = handler.json_body()
        if set(body) != {"staffId", "accessCode"}:
            fail("Enter the staff ID and access code.", "STAFF_INPUT", 422)
        result, token = access.login(body["staffId"], body["accessCode"])
        handler.send(200, {**result, "installationId": access.installation_id},
                     headers={"Set-Cookie": cookie_header(handler, token)})
    elif path == "/api/staff/owner-session":
        if not handler.headers.get("Authorization") or handler.principal["role"] != "owner":
            fail("Use the original private owner key for owner sign-in.", "ACCESS_REQUIRED", 401)
        handler.json_body()
        result, token = access.start_session(owner_principal())
        handler.send(200, {**result, "installationId": access.installation_id},
                     headers={"Set-Cookie": cookie_header(handler, token)})
    elif path == "/api/staff/logout":
        handler.json_body()
        access.logout(handler.staff_cookie, handler.principal)
        handler.send(200, {"authenticated": False}, headers={"Set-Cookie": cookie_header(handler, clear=True)})
    else:
        match = re.fullmatch(r"/api/staff/members/(create|update|rotate|revoke|sign-out)", path)
        if not match:
            raise Problem("Staff command not found.", 404, "NOT_FOUND")
        handler.send(200, access.control(handler.principal, match[1], handler.json_body()))
    return True
