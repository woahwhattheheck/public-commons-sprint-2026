"""Apply an actual customer response to the original profile review history.

Captures use ordinary source collections and model.reviews. Profile status is an
explicit operator action through profile_editions.review; native admission and
manual review remain unchanged.
"""
from __future__ import annotations

from copy import deepcopy
import datetime as dt
import html
import json
from pathlib import Path

from . import profile_editions, reviews
from .common import (INVEST_SOURCE, INVEST_VERSION, atomic_bytes, atomic_json,
                     describe_file, digest, file_digest, held, identifier, now,
                     read_json, verify_file)
from .model_selection import selected
from .setup_review import _copy_verified, _descriptor_path, _portable_name

KIND = "profile-customer-reviews"
APPLICATION_KIND = "profile-customer-review-applications"
IMPLEMENTATION = "profile-customer-review-v1"
PROFILE_SOURCE = "reviewed-profile-definition"
TABLE_SOURCE = "reviewed-coefficient-table"
SHEET_SOURCE = "profile-scientific-sheet"
REQUIREMENTS = (
    {"id": "profile.method", "title": "Selected models and exact parameters",
     "detail": "Review the saved model selection, implementation version, NDR/SDR parameters and parameter references for the stated purpose."},
    {"id": "profile.coefficients", "title": "Original coefficient table",
     "detail": "Review each applicable land-cover class, coefficient, unit and interpretation against the retained original table and selected models."},
    {"id": "profile.sources", "title": "Source edition and transformations",
     "detail": "Review the source edition, date, coverage, original companions, declared units and transformations. Identify any required clarification."},
    {"id": "profile.scope", "title": "Fitness for the stated scientific purpose",
     "detail": "Review the model period, geographic/application scope, assumptions, limitations and evidence represented by the saved profile for this exact purpose."},
)


def _text(value, label, *, required=False, limit=20000):
    if value is None:
        value = ""
    if not isinstance(value, str) or "\0" in value or len(value) > limit:
        raise ValueError(label + " must be text within its declared limit")
    value = value.strip()
    if required and not value:
        raise ValueError("Provide " + label)
    return value


def _object(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(label + " has unsupported fields")
    return deepcopy(value)


def _selection(value):
    value = _object(value, ("profile_id", "title", "purpose", "notes"), "Profile review capture")
    notes = value.get("notes", [])
    if not isinstance(notes, list):
        raise ValueError("Capture notes must be a list of text")
    return {"profile_id": identifier(value.get("profile_id")),
            "title": _text(value.get("title"), "review title", required=True, limit=300),
            "purpose": _text(value.get("purpose"), "scientific purpose", required=True),
            "notes": [_text(item, "capture note") for item in notes]}


def _response_selection(value, *, applying=False):
    allowed = {"capture_id", "response_id", "reviewer_role"}
    if applying:
        allowed.add("expected_profile_review_id")
    value = _object(value, allowed, "Customer response application")
    result = {"capture_id": identifier(value.get("capture_id")),
              "response_id": identifier(value.get("response_id")),
              "reviewer_role": _text(value.get("reviewer_role"), "reviewer role", limit=300)}
    if applying:
        if "expected_profile_review_id" not in value:
            raise ValueError("Retain the current profile review identity, including null for an unreviewed profile")
        expected = value["expected_profile_review_id"]
        result["expected_profile_review_id"] = identifier(expected) if expected is not None else None
    return result


def _operation(value, fallback):
    if value is None:
        return digest(fallback)
    return digest({"operation_id": _text(value, "operation identity", required=True, limit=2000)})


def _timestamp(value):
    value = now() if value is None else _text(value, "capture creation time", required=True, limit=80)
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Capture creation time needs a UTC offset")
    return value


def _profile(ws, profile_id):
    detail = profile_editions.inspect(ws, identifier(profile_id))
    profile, table = detail["profile"], detail["table"]
    if table["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("The saved profile and its original coefficient table differ")
    return detail


def render_html(spec):
    def display(value):
        if value is None or value == "":
            return "Not declared"
        return json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else str(value)
    e = lambda value: html.escape(display(value), quote=True)
    def table(headings, rows):
        return ("<table><thead><tr>" + "".join("<th>" + e(x) + "</th>" for x in headings) +
                "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + e(x) + "</td>" for x in row) +
                "</tr>" for row in rows) + "</tbody></table>")
    profile, coefficients, source = spec["profile"], spec["table"], spec["source"]
    return "\n".join([
        "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'>",
        "<title>" + e(spec["title"]) + "</title>",
        "<style>body{font:15px/1.5 system-ui,sans-serif;color:#222;background:white;margin:2rem auto;padding:0 1rem;max-width:1100px}"
        "h2{margin-top:2rem;border-bottom:1px solid #bbb}table{border-collapse:collapse;width:100%;margin:1rem 0}"
        "th,td{border:1px solid #bbb;padding:.5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
        "th{background:#eee}a{color:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}"
        "@media print{body{font-size:10px;margin:0;max-width:none}tr{break-inside:avoid}}</style>",
        "<main><h1>" + e(spec["title"]) + "</h1>",
        "<p><strong>Project:</strong> " + e(spec["project"]["title"]) + " · " + e(spec["created_at"]) + "</p>",
        "<h2>Scientific purpose</h2><p>" + e(spec["purpose"]) + "</p>",
        "<h2>Exact saved profile</h2>",
        table(["Field", "Retained value"], [
            ("Profile", {"id": profile["id"], "title": profile["title"]}),
            ("Selected models", spec["selected_models"]), ("InVEST version", spec["model"]["version"]),
            ("Implementation source", spec["model"]["source"]), ("Model period", profile.get("model_period")),
            ("NDR parameters", profile.get("ndr")), ("SDR parameters", profile.get("sdr")),
            ("References", profile.get("references")), ("Profile notes", profile.get("notes")),
            ("Source collection", profile["source_collection_id"]), ("Coefficient source", profile["biophysical_source_id"]),
            ("Original table SHA-256", coefficients["sha256"])]),
        "<h2>Original coefficient source</h2>",
        table(["Field", "Original declaration"], [(key, source.get(key)) for key in
              ("title", "uri", "vintage", "units", "coverage", "scope", "source_crs", "intended_use",
               "conversion", "transformations", "derivation", "metadata")]),
        "<p>Coefficient cells below preserve the original CSV text and column order.</p>",
        table(coefficients["columns"], [[row[column] for column in coefficients["columns"]] for row in coefficients["rows"]]),
        "<h2>Required scientific decisions</h2>",
        table(["Requirement", "Review question"], [(row["title"], row["detail"]) for row in spec["requirements"]]),
        "<p>Record each decision and any consolidated corrections in the accompanying customer-review response. "
        "The operator can then explicitly apply that response to this saved profile's existing review history.</p>",
        "<h2>Retained originals</h2><ul>" +
        "".join("<li><a href='" + html.escape(row["path"], quote=True) + "'>" + e(row["path"]) +
                "</a> · " + e(row["sha256"]) + "</li>" for row in spec["retained_files"]) + "</ul>",
        "<p><a href='specification.json'>Complete machine-readable scientific specification</a></p>",
        "<h2>Capture notes</h2><pre>" + e(spec["notes"]) + "</pre></main></html>", ""])


def _capture(ws, selection, directory, created_at):
    current = _profile(ws, selection["profile_id"])
    profile, table = current["profile"], current["table"]
    collection = ws._get("sources", profile["source_collection_id"])
    primary, entry = ws.source_file(collection["id"], profile["biophysical_source_id"])
    source = {key: deepcopy(value) for key, value in entry.items() if key not in ("body", "companions")}
    files = []
    def copy(path, relative, *, body=None):
        target = directory / _portable_name(relative)
        _copy_verified(path, target, sha256=body["sha256"] if body else None,
                       size=body["bytes"] if body else None)
        descriptor = describe_file(directory, target)
        files.append(descriptor)
        return descriptor
    profile_file = copy(ws.root / "profiles" / (profile["id"] + ".json"), "originals/profile.json")
    copy(ws.root / "sources" / (collection["id"] + ".json"), "originals/source-collection.json")
    original_manifest = collection["original_manifest"]
    copy(_descriptor_path(ws, original_manifest), "originals/source-manifest.json", body=original_manifest)
    table_files = []
    for body in [entry["body"], *entry.get("companions", [])]:
        relative = "originals/table/" + _portable_name(body.get("view_path") or body["filename"])
        descriptor = copy(_descriptor_path(ws, body), relative, body=body)
        table_files.append(descriptor)
    if table_files[0]["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("Captured coefficient bytes differ from the selected profile")
    spec = {"schema": "upstate.profile-customer-review-specification/v1", "implementation": IMPLEMENTATION,
            "project": ws.project, "created_at": created_at, **selection,
            "profile": profile, "selected_models": list(selected(profile)),
            "model": {"version": INVEST_VERSION, "source": INVEST_SOURCE},
            "table": {key: deepcopy(table[key]) for key in ("columns", "rows", "sha256", "bytes", "validation")},
            "source": source, "requirements": deepcopy(list(REQUIREMENTS)), "retained_files": files,
            "profile_file": profile_file, "table_file": table_files[0]}
    atomic_json(directory / "specification.json", spec, immutable=True)
    atomic_bytes(directory / "index.html", render_html(spec).encode("utf-8"), immutable=True)
    # Each required primary has its own artifact decision. The readable sheet
    # also retains all original paths so links work in ordinary review packets.
    common = {"uri": "urn:upstate:profile:" + profile["id"], "vintage": created_at,
              "metadata": {"role": "PROFILE_CUSTOMER_REVIEW", "profile_id": profile["id"]}}
    all_paths = [row["path"] for row in files] + ["specification.json"]
    manifest = {"schema": "upstate.sources/v1", "title": selection["title"], "captured_at": created_at,
                "scope": {"profile_id": profile["id"], "purpose": selection["purpose"]},
                "notes": selection["notes"], "entries": [
        {**common, "id": PROFILE_SOURCE, "title": "Exact saved profile: " + profile["title"],
         "kind": "document", "path": profile_file["path"], "sha256": profile_file["sha256"]},
        {**common, "id": TABLE_SOURCE, "title": "Original coefficients: " + entry["title"],
         "kind": "table", "path": table_files[0]["path"], "sha256": table_files[0]["sha256"],
         "original_source": source,
         "companions": [{"path": row["path"], "sha256": row["sha256"]} for row in table_files[1:]]},
        {**common, "id": SHEET_SOURCE, "title": selection["title"], "kind": "document",
         "path": "index.html", "sha256": file_digest(directory / "index.html"),
         "companions": [{"path": name, "sha256": file_digest(directory / name)} for name in all_paths]}]}
    atomic_json(directory / "sources.json", manifest, immutable=True)
    return spec


def _requirements(review, source_collection_id):
    artifacts = []
    by_id = {PROFILE_SOURCE: "Saved profile definition", TABLE_SOURCE: "Original coefficient table",
             SHEET_SOURCE: "Scientific purpose and source sheet"}
    for item in review["artifacts"]:
        locator = item["locator"]
        if (locator.get("kind") == "source-entry" and locator.get("id") == source_collection_id
                and locator.get("part") == 0 and locator.get("source_id") in by_id):
            artifacts.append({"id": item["id"], "source_id": locator["source_id"],
                              "title": by_id[locator["source_id"]], "sha256": item["sha256"]})
    if {row["source_id"] for row in artifacts} != set(by_id):
        raise ValueError("The original review does not contain each required profile artifact")
    return artifacts


def create(ws, value, *, operation_id=None, created_at=None):
    selection = _selection(value)
    operation = _operation(operation_id, {"project_id": ws.project["id"], "selection": selection})
    directory = ws.root / "profile-customer-review-packages" / operation
    with held(ws.root / "profile-customer-review-packages" / (operation + ".lock")):
        with held(ws.root / ".workspace.lock", blocking=False):
            directory.mkdir(parents=True, exist_ok=True)
            journal_path = directory / "operation.json"
            if journal_path.exists():
                journal = read_json(journal_path)
                if journal["selection"] != selection or journal["project_id"] != ws.project["id"]:
                    raise ValueError("This capture operation belongs to another selection")
                if journal.get("capture_id"):
                    return inspect(ws, journal["capture_id"])
            else:
                journal = {"schema": "upstate.profile-customer-review-operation/v1", "project_id": ws.project["id"],
                           "selection": selection, "created_at": _timestamp(created_at), "operation_id": operation}
                atomic_json(journal_path, journal)
            if (directory / "sources.json").exists():
                spec = read_json(directory / "specification.json")
                if (spec["profile_id"] != selection["profile_id"] or spec["purpose"] != selection["purpose"]
                        or spec["created_at"] != journal["created_at"]):
                    raise ValueError("Retained capture no longer matches its operation")
            else:
                spec = _capture(ws, selection, directory, journal["created_at"])
            collection = ws.import_sources(directory / "sources.json")
        review = reviews.create_review(ws, {
            "schema": reviews.SELECTION_SCHEMA, "title": selection["title"], "purpose": selection["purpose"],
            "source_collection_ids": [collection["id"]], "run_ids": [], "delivery_ids": [], "spatial_export_ids": [],
            "requirements": spec["requirements"], "notes": selection["notes"]}, created_at=journal["created_at"])
        artifacts = _requirements(review, collection["id"])
        with held(ws.root / ".workspace.lock", blocking=False):
            capture = ws._save(KIND, {
                **selection, "project_id": ws.project["id"], "created_at": journal["created_at"],
                "operation_id": operation, "implementation": IMPLEMENTATION,
                "source_collection_id": collection["id"], "customer_review_id": review["id"],
                "specification_sha256": file_digest(directory / "specification.json"),
                "profile_file_sha256": spec["profile_file"]["sha256"], "table_sha256": spec["table"]["sha256"],
                "required_artifacts": artifacts, "required_requirements": spec["requirements"]})
            atomic_json(journal_path, {**journal, "capture_id": capture["id"]})
    return inspect(ws, capture["id"])


def _bound(ws, capture_id):
    capture = ws._get(KIND, identifier(capture_id))
    if capture["project_id"] != ws.project["id"]:
        raise ValueError("This profile review capture belongs to another project")
    current = _profile(ws, capture["profile_id"])
    profile = current["profile"]
    if (current["table"]["sha256"] != capture["table_sha256"] or
            file_digest(ws.root / "profiles" / (profile["id"] + ".json")) != capture["profile_file_sha256"]):
        raise ValueError("Profile or coefficient source differs from the exact reviewed edition")
    primary, entry = ws.source_file(capture["source_collection_id"], SHEET_SOURCE)
    # The source importer reconstructs every relative companion beneath this root.
    body = next((row for row in entry["companions"] if row.get("view_path") == "specification.json"), None)
    if body is None:
        raise ValueError("The captured scientific specification is missing")
    path = _descriptor_path(ws, body)
    if file_digest(path) != capture["specification_sha256"]:
        raise ValueError("Captured scientific specification changed")
    spec = read_json(path)
    if (spec["profile"] != profile or spec["table"]["sha256"] != capture["table_sha256"]
            or spec["purpose"] != capture["purpose"]):
        raise ValueError("Scientific specification and saved profile binding differ")
    packet = reviews.show_review(ws, capture["customer_review_id"], previews=False)
    if (_requirements(packet["review"], capture["source_collection_id"]) != capture["required_artifacts"]
            or packet["review"]["requirements"] != capture["required_requirements"]
            or packet["review"]["purpose"] != capture["purpose"]):
        raise ValueError("Original customer review and profile capture differ")
    return capture, current, spec, packet


def inspect(ws, capture_id):
    capture, current, spec, packet = _bound(ws, capture_id)
    applications = [row for row in ws._list(APPLICATION_KIND) if row["capture_id"] == capture["id"]]
    files = []
    collection = ws._get("sources", capture["source_collection_id"])
    for entry in collection["entries"]:
        for part, body in enumerate([entry["body"], *entry.get("companions", [])]):
            files.append({"source_id": entry["id"], "part": part,
                          "path": body.get("view_path") or body["filename"],
                          "bytes": body["bytes"], "sha256": body["sha256"],
                          "label": entry["title"] if part == 0 else body.get("view_path") or body["filename"]})
    return {"capture_id": capture["id"], "profile_id": capture["profile_id"],
            "files": files,
            "customer_review_id": capture["customer_review_id"], "source_collection_id": capture["source_collection_id"],
            "created_at": capture["created_at"], "title": capture["title"], "purpose": capture["purpose"],
            "profile": current["profile"], "table": current["table"], "capture": capture,
            "specification": spec, "review": packet, "latest_response_id": packet["latest_response_id"],
            "profile_review_state": current["review_state"], "applications": applications,
            "requirements": capture["required_requirements"], "artifacts": capture["required_artifacts"]}


def catalog(ws, profile_id=None):
    if profile_id is not None:
        profile_id = identifier(profile_id)
    profiles = profile_editions.catalog(ws)["profiles"]
    profiles = [row for row in profiles if profile_id is None or row["id"] == profile_id]
    captures = []
    for row in ws._list(KIND):
        if profile_id is not None and row["profile_id"] != profile_id:
            continue
        current = inspect(ws, row["id"])
        captures.append({key: current[key] for key in ("capture_id", "profile_id", "customer_review_id",
                        "title", "purpose", "created_at", "latest_response_id", "profile_review_state")})
        captures[-1]["application_count"] = len(current["applications"])
    return {"project": ws.project,
            "profiles": [{"profile_id": row["id"], "title": row["title"], "selected_models": list(selected(row)),
                          "review_state": row["review_state"], "table_sha256": row["table_summary"]["sha256"]}
                         for row in profiles],
            "captures": captures}


def preview(ws, value):
    selection = _response_selection(value)
    capture, current, spec, packet = _bound(ws, selection["capture_id"])
    response_record = next((row for row in packet["responses"] if row["id"] == selection["response_id"]), None)
    if response_record is None:
        raise ValueError("Choose an actual response in this capture's original customer review history")
    response = response_record["response"]
    reviewer = response["reviewer"]
    role = reviewer.get("role", "").strip() or selection["reviewer_role"]
    role_origin = "original_customer_response" if reviewer.get("role", "").strip() else (
        "explicit_operator_input" if role else "missing")
    reasons, checks = [], []
    def reason(code, message):
        reasons.append({"code": code, "message": message})
    latest = packet["latest_response_id"] == response_record["id"]
    if not latest:
        reason("RESPONSE_HEAD_CHANGED", "A later customer response exists; select its actual current response before applying a decision.")
    artifacts = {row["artifact_id"]: row for row in response["artifact_decisions"]}
    requirements = {row["requirement_id"]: row for row in response["requirement_decisions"]}
    for row in capture["required_artifacts"]:
        item = artifacts[row["id"]]
        checks.append({"id": row["id"], "title": row["title"], "kind": "artifact",
                       "accepted": item["decision"] == "accepted", **deepcopy(item)})
    for row in capture["required_requirements"]:
        item = requirements[row["id"]]
        checks.append({"id": row["id"], "title": row["title"], "kind": "requirement",
                       "accepted": item["decision"] == "accepted", **deepcopy(item)})
    changes = (response["disposition"] == "changes-requested" or
               any(row["decision"] == "changes-requested" for row in [*artifacts.values(), *requirements.values()]) or
               any(row["state"] == "open" for row in response["corrections"]))
    if changes:
        status = "changes_requested"
    elif response["disposition"] == "ready-for-purpose" and all(row["accepted"] for row in checks):
        status = "reviewed"
    else:
        status = "working"
    role_conflict = bool(reviewer.get("role", "").strip() and selection["reviewer_role"]
                         and selection["reviewer_role"] != reviewer["role"].strip())
    if role_conflict:
        reason("ORIGINAL_REVIEWER_ROLE", "Use the reviewer role already authored in the original customer response.")
    if not role:
        reason("REVIEWER_ROLE_REQUIRED", "The customer response has no reviewer role. Enter the actual role explicitly; the original response remains retained.")
    existing = [row for row in ws._list(APPLICATION_KIND)
                if row["capture_id"] == capture["id"] and row["response_id"] == response_record["id"]]
    if existing:
        reason("RESPONSE_ALREADY_APPLIED", "This customer response is already linked to the profile review history.")
    explanation = ("The selected response requests scientific corrections." if status == "changes_requested" else
                   "The current response accepts every required scientific decision and original artifact for the stated purpose."
                   if status == "reviewed" else
                   "The selected response remains in review or leaves a required scientific decision unaccepted; its profile status is working.")
    return {"capture_id": capture["id"], "profile_id": capture["profile_id"],
            "customer_review_id": capture["customer_review_id"], "response_id": response_record["id"],
            "current_response_id": packet["latest_response_id"], "response_is_latest": latest,
            "current_profile_review_id": current["review_state"]["review_id"], "derived_status": status,
            "status_explanation": explanation, "can_apply": latest and bool(role) and not existing and not role_conflict,
            "reasons": reasons, "checks": checks, "reviewer": deepcopy(reviewer),
            "reviewer_role": role, "reviewer_role_origin": role_origin, "requires_reviewer_role": not bool(reviewer.get("role", "").strip()),
            "response": deepcopy(response_record), "already_applied": existing[0] if existing else None}


def apply(ws, value, *, operation_id=None):
    selection = _response_selection(value, applying=True)
    operation = _operation(operation_id, {"project_id": ws.project["id"], "application": selection})
    directory = ws.root / "profile-customer-review-operations"
    journal_path = directory / (operation + ".json")
    response_key = digest({"capture_id": selection["capture_id"], "response_id": selection["response_id"]})
    with held(directory / ("response-" + response_key + ".lock")), held(directory / (operation + ".lock")):
        with held(ws.root / ".workspace.lock", blocking=False):
            resume_journal = None
            response_index = directory / ("response-" + response_key + ".json")
            if response_index.exists():
                prior_operation = read_json(response_index)["operation_id"]
                if prior_operation != operation:
                    prior_journal_path = directory / (identifier(prior_operation) + ".json")
                    prior_journal = read_json(prior_journal_path)
                    if (prior_journal["selection"]["capture_id"] != selection["capture_id"] or
                            prior_journal["selection"]["response_id"] != selection["response_id"]):
                        raise ValueError("Response application index belongs to another selection")
                    if prior_journal.get("application_id"):
                        return _application_result(ws, prior_journal["application_id"])
                    # Recover a history write that completed before its link,
                    # even when a different operator task received the retry.
                    prior_profile = prior_journal["native_selection"]["profile_id"]
                    native_operation = digest({"operation_id": prior_journal["native_operation_id"]})
                    prior_state = profile_editions.inspect(ws, prior_profile)
                    committed = [row for row in prior_state["reviews"]
                                 if row.get("operation_id") == native_operation]
                    if committed:
                        application = _save_application(ws, prior_journal, committed[0]["id"])
                        atomic_json(prior_journal_path, {**prior_journal, "application_id": application["id"]})
                        return _application_result(ws, application["id"])
                    original_events = [row for row in ws._list("profile-reviews")
                                       if row.get("operation_id") == native_operation]
                    if original_events and (
                            prior_state["review_state"]["review_id"] ==
                            prior_journal["native_selection"]["expected_review_id"]):
                        # A saved event can precede its head publication. Resume
                        # the original review API outside this lock; it validates
                        # the original request and publishes that same event.
                        resume_journal = prior_journal
                        journal_path = prior_journal_path
                        selection = prior_journal["selection"]
                        operation = prior_operation
            if resume_journal is not None:
                journal = resume_journal
            elif journal_path.exists():
                journal = read_json(journal_path)
                if journal["selection"] != selection or journal["project_id"] != ws.project["id"]:
                    raise ValueError("This application operation belongs to another response or profile review head")
                if journal.get("application_id"):
                    return _application_result(ws, journal["application_id"])
            else:
                proposed = preview(ws, {key: selection[key] for key in ("capture_id", "response_id", "reviewer_role")})
                if not proposed["can_apply"]:
                    raise ValueError("; ".join(row["message"] for row in proposed["reasons"]))
                if proposed["current_profile_review_id"] != selection["expected_profile_review_id"]:
                    raise ValueError("Another profile review was saved; reopen the profile and preview this response again")
                reference = "customer-review:" + proposed["customer_review_id"] + "/response:" + proposed["response_id"] + "/capture:" + proposed["capture_id"]
                native_selection = {
                    "profile_id": proposed["profile_id"], "status": proposed["derived_status"],
                    "reviewer": proposed["reviewer"]["name"], "reviewer_role": proposed["reviewer_role"],
                    "reference": reference, "expected_review_id": selection["expected_profile_review_id"],
                    "notes": proposed["status_explanation"] + "\nScientific purpose: " +
                             ws._get(KIND, proposed["capture_id"])["purpose"]}
                journal = {"schema": "upstate.profile-customer-review-application-operation/v1",
                           "project_id": ws.project["id"], "operation_id": operation, "selection": selection,
                           "created_at": now(), "native_selection": native_selection,
                           "preview": proposed, "native_operation_id": "profile-customer-review:" + operation}
                atomic_json(journal_path, journal)
            atomic_json(response_index, {"operation_id": operation, "capture_id": selection["capture_id"],
                                         "response_id": selection["response_id"], "project_id": ws.project["id"]})
        def before_commit():
            # profile_editions invokes this while holding its original Workspace
            # and profile-history locks. Do not acquire either lock here.
            proposed = preview(ws, {key: selection[key] for key in ("capture_id", "response_id", "reviewer_role")})
            if not proposed["can_apply"]:
                raise ValueError("; ".join(row["message"] for row in proposed["reasons"]))
            if (proposed["derived_status"] != journal["native_selection"]["status"] or
                    proposed["reviewer"]["name"] != journal["native_selection"]["reviewer"] or
                    proposed["reviewer_role"] != journal["native_selection"]["reviewer_role"]):
                raise ValueError("The selected customer response binding changed before application")
        # The original operation receipt recovers a committed event before the
        # callback, including interruption after history save and before this link.
        event = profile_editions.review(ws, journal["native_selection"],
                                        operation_id=journal["native_operation_id"], before_commit=before_commit)
        with held(ws.root / ".workspace.lock", blocking=False):
            application = _save_application(ws, journal, event["review_id"])
            atomic_json(journal_path, {**journal, "application_id": application["id"]})
    return _application_result(ws, application["id"])


def _save_application(ws, journal, profile_review_id):
    """Caller holds the original Workspace lock; link a committed history event."""
    selection, proposed = journal["selection"], journal["preview"]
    capture = ws._get(KIND, selection["capture_id"])
    event = ws._get("profile-reviews", identifier(profile_review_id))
    if (event["request_sha256"] != digest(journal["native_selection"]) or
            event["operation_id"] != digest({"operation_id": journal["native_operation_id"]})):
        raise ValueError("Recovered profile event does not match its original application operation")
    return ws._save(APPLICATION_KIND, {
        "project_id": ws.project["id"], "operation_id": journal["operation_id"], "created_at": journal["created_at"],
        "capture_id": capture["id"], "profile_id": capture["profile_id"],
        "customer_review_id": capture["customer_review_id"], "response_id": selection["response_id"],
        "response_request_sha256": proposed["response"]["request_sha256"],
        "profile_review_id": event["id"], "profile_table_sha256": capture["table_sha256"],
        "purpose": capture["purpose"], "derived_status": proposed["derived_status"],
        "reviewer": proposed["reviewer"], "reviewer_role": proposed["reviewer_role"],
        "reviewer_role_origin": proposed["reviewer_role_origin"], "checks": proposed["checks"],
        "native_operation_id": journal["native_operation_id"], "native_selection": journal["native_selection"]})


def _application_result(ws, application_id):
    application = ws._get(APPLICATION_KIND, identifier(application_id))
    event = ws._get("profile-reviews", application["profile_review_id"])
    if (application["project_id"] != ws.project["id"] or event["profile_id"] != application["profile_id"] or
            event["table_sha256"] != application["profile_table_sha256"] or event["status"] != application["derived_status"]):
        raise ValueError("Customer response application and original profile history differ")
    expected = application["native_selection"]
    if (event["request_sha256"] != digest(expected) or
            event["operation_id"] != digest({"operation_id": application["native_operation_id"]}) or
            event["reviewer"] != expected["reviewer"].strip() or
            event["reviewer_role"] != expected["reviewer_role"].strip()):
        raise ValueError("Applied profile event differs from the retained original history request")
    detail = inspect(ws, application["capture_id"])
    if (application["profile_id"] != detail["profile_id"] or
            application["customer_review_id"] != detail["customer_review_id"] or
            application["purpose"] != detail["purpose"]):
        raise ValueError("Applied response scope differs from its retained scientific capture")
    actual = next((row for row in detail["review"]["responses"] if row["id"] == application["response_id"]), None)
    if actual is None or actual["request_sha256"] != application["response_request_sha256"]:
        raise ValueError("The originally applied customer response is missing or changed")
    if actual["response"]["reviewer"] != application["reviewer"]:
        raise ValueError("Applied reviewer identity differs from the actual customer response")
    original_role = actual["response"]["reviewer"].get("role", "").strip()
    if (original_role and (application["reviewer_role"] != original_role or
                          application["reviewer_role_origin"] != "original_customer_response")):
        raise ValueError("Applied reviewer role differs from the authored response")
    if not original_role and (not application["reviewer_role"] or
                              application["reviewer_role_origin"] != "explicit_operator_input"):
        raise ValueError("The missing original reviewer role needs retained explicit operator input")
    history = profile_editions.inspect(ws, application["profile_id"])["reviews"]
    if not any(row["id"] == event["id"] for row in history):
        raise ValueError("Applied event is absent from the original profile review history")
    return {"application_id": application["id"], "capture_id": application["capture_id"],
            "profile_id": application["profile_id"], "customer_review_id": application["customer_review_id"],
            "response_id": application["response_id"], "profile_review_id": application["profile_review_id"],
            "application": application, "profile_review": event,
            "profile_review_state": detail["profile_review_state"], "capture": detail}


def verify_all(ws):
    captures = []
    for row in ws._list(KIND):
        current = inspect(ws, row["id"])
        captures.append({"capture_id": current["capture_id"], "customer_review_id": current["customer_review_id"],
                         "profile_id": current["profile_id"], "table_sha256": row["table_sha256"]})
    applications = []
    for row in ws._list(APPLICATION_KIND):
        result = _application_result(ws, row["id"])
        applications.append({key: result[key] for key in ("application_id", "capture_id", "profile_id",
                                                          "customer_review_id", "response_id", "profile_review_id")})
    return {"captures": captures, "applications": applications,
            "capture_count": len(captures), "application_count": len(applications)}
