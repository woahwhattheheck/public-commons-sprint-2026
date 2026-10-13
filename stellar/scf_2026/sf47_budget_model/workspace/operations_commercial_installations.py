"""Receive accepted SF74 quotation editions into the original Customer Installation.

Merchant Support owns quotations, customer responses and agreed implementation
scope. Grant Operations owns its saved Installation, deployment/payment choices,
receiving observations and history. This adapter joins those original records.
"""
from __future__ import annotations

from copy import deepcopy
from html import escape
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading

from model import Problem, canonical, digest
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-commercial-installation.v1"
SOURCE_SCHEMA = "stellar-forge.sf47-commercial-installation-source.v1"
MAX_SOURCE = 8 * 1024 * 1024
MAX_RESPONSE = 16 * 1024 * 1024
SOURCE_FIELDS = ("sourceId", "expectedSourceSha256")
QUOTE_FIELDS = ("quoteId", "quoteSha256", "acceptanceId", "acceptanceSha256")
BINDING_FIELDS = ("schema", "sourceId", "sourceSha256", "caseKey",
                  "quoteId", "quoteSha256", "acceptanceId", "acceptanceSha256",
                  "scopeSha256", "taskChecks", "sourceFiles")
MERGE_FIELDS = ("name", "task.name", "task.purpose", "task.request",
                "task.completeOutput", "source.reference", "source.authority",
                "source.changePolicy", "receiving.acceptanceRule",
                "assignments.commercialRef")
_HELPER = Path(__file__).resolve().with_name("commercial_installation_source.mjs")
_READER = threading.BoundedSemaphore(1)


def fail(message, code="INVALID_COMMERCIAL_INSTALLATION", status=422):
    raise Problem(message, status, code)


def exact(value, keys, label):
    if not isinstance(value, dict) or set(value) - set(keys):
        fail("Use the complete " + label + " with its original field names.")
    return value


def original_id(value, label):
    if not isinstance(value, str) or not value or len(value) > 500 or any(ord(char) < 32 for char in value):
        fail("Select the original " + label + ".")
    return value


def source_selection(context, raw):
    ident = raw.get("sourceId")
    domain.reference_list([ident], context["sources"], "Original accepted quotation source")
    expected = domain.sha(raw.get("expectedSourceSha256"), "Original commercial source", False)
    metadata = context["sources"][ident]
    if metadata["sha256"] != expected:
        fail("The selected original commercial attachment differs.",
             "COMMERCIAL_SOURCE_CONFLICT", 409)
    return {"sourceId": ident, "expectedSourceSha256": expected}


def quote_selection(raw, required=True):
    values = [raw.get(key) for key in QUOTE_FIELDS]
    if not required and all(value is None for value in values):
        return None
    return {
        "quoteId": original_id(raw.get("quoteId"), "quotation"),
        "quoteSha256": domain.sha(raw.get("quoteSha256"), "Original quotation", False),
        "acceptanceId": original_id(raw.get("acceptanceId"), "customer response"),
        "acceptanceSha256": domain.sha(raw.get("acceptanceSha256"), "Original customer response", False),
    }


def native_read(raw, selection=None):
    """Read the original format through its installed SF74 validator."""
    selected = os.environ.get("SF47_SUPPORT_NODE") or shutil.which("node")
    if not selected or not Path(selected).is_absolute() or not Path(selected).is_file():
        fail("The original Merchant Support source reader needs its configured Node executable.",
             "COMMERCIAL_NODE_UNAVAILABLE", 503)
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_SOURCE:
        fail("Select a complete original merchant workspace or Support handoff up to 8 MiB.",
             "COMMERCIAL_SOURCE_SIZE", 413)
    if not _READER.acquire(blocking=False):
        fail("Another original commercial source is being read. Continue this selection when it finishes.",
             "COMMERCIAL_READER_BUSY", 409)
    try:
        command = [selected, "--max-old-space-size=192", str(_HELPER)]
        if selection is not None:
            command.extend(["--selection", canonical(selection)])
        try:
            completed = subprocess.run(command, input=raw, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, timeout=30, check=False)
        except subprocess.TimeoutExpired as exc:
            raise Problem("The original commercial source reader timed out. The retained source is unchanged.",
                          503, "COMMERCIAL_READER_TIMEOUT") from exc
        except OSError as exc:
            raise Problem("The original commercial source reader could not start.", 503,
                          "COMMERCIAL_READER_UNAVAILABLE") from exc
        if len(completed.stdout) > MAX_RESPONSE:
            fail("The complete commercial source read exceeds its receiving bound.",
                 "COMMERCIAL_REVIEW_SIZE", 413)
        try:
            response = json.loads(completed.stdout)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The original reader returned no complete commercial source result.",
                          503, "COMMERCIAL_READER_UNAVAILABLE") from exc
        if not isinstance(response, dict) or response.get("ok") is not True:
            error = response.get("error", {}) if isinstance(response, dict) else {}
            code = error.get("code", "COMMERCIAL_SOURCE_INVALID")
            if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,100}", code):
                code = "COMMERCIAL_SOURCE_INVALID"
            fail(str(error.get("message", "The original commercial source is invalid."))[:1200],
                 code, error.get("status") if error.get("status") in (409, 413) else 422)
        if completed.returncode != 0:
            fail("The original commercial source read did not complete.",
                 "COMMERCIAL_READER_UNAVAILABLE", 503)
        native = response.get("result")
        if not isinstance(native, dict) or native.get("schema") != SOURCE_SCHEMA:
            fail("The native commercial source result has a different schema.",
                 "COMMERCIAL_READER_UNAVAILABLE", 503)
        expected = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        if any(native.get("source", {}).get(key) != value for key, value in expected.items()):
            fail("The native reader returned a result for another original file.",
                 "COMMERCIAL_SOURCE_CONFLICT", 409)
        if selection is not None:
            original_id(native.get("caseKey"), "commercial case identity")
            accepted = native.get("selected")
            if not isinstance(accepted, dict) or any(accepted.get(key) != value for key, value in selection.items()):
                fail("The original quotation or customer response changed.",
                     "COMMERCIAL_SELECTION_CONFLICT", 409)
            domain.sha(accepted.get("scopeSha256"), "Original accepted scope", False)
            if not isinstance(accepted.get("scope"), dict):
                fail("The original accepted implementation scope is missing.")
        return native
    finally:
        _READER.release()


def read_source(operations, context, raw, reader=None, required=True):
    selection = source_selection(context, raw)
    quote = quote_selection(raw, required)
    read = reader or (lambda ident: operations.source(context["program"]["id"], ident)[1])
    value = read(selection["sourceId"])
    metadata = context["sources"][selection["sourceId"]]
    if (not isinstance(value, bytes) or len(value) != metadata["bytes"]
            or hashlib.sha256(value).hexdigest() != metadata["sha256"]):
        fail("The complete original commercial attachment differs from its saved bytes.",
             "COMMERCIAL_SOURCE_CONFLICT", 409)
    native = native_read(value, quote)
    return {"selection": selection, "native": native, "selected": native.get("selected")}


def source_files(context, original, retained=None):
    """Keep every external original file required by the complete portable case."""
    expected = original["native"].get("externalFiles", [])
    if not isinstance(expected, list):
        fail("The original source file inventory is incomplete.")
    available = context["sources"]
    chosen = None
    if retained is not None:
        if not isinstance(retained, list) or len(retained) > 200:
            fail("Keep the complete original commercial file bindings.")
        chosen = {}
        for row in retained:
            exact(row, ("name", "sha256", "bytes", "sourceId"), "original commercial file")
            key = (row.get("name"), row.get("sha256"), row.get("bytes"))
            if key in chosen:
                fail("Keep each original commercial file once.")
            chosen[key] = row.get("sourceId")
    result, used = [], set()
    for row in expected:
        name = original_id(row.get("name"), "referenced source filename")
        sha = domain.sha(row.get("sha256"), "Original referenced source", False)
        size = domain.integer(row.get("bytes"), "Original referenced file size", 0, MAX_SOURCE)
        key = (name, sha, size)
        if key in used:
            continue
        used.add(key)
        ids = ([chosen[key]] if chosen is not None and key in chosen else []
               if chosen is not None else sorted(ident for ident, meta in available.items()
                                                  if meta["sha256"] == sha and meta["bytes"] == size))
        if not ids:
            fail("Attach the complete referenced original file " + name + " (" + sha +
                 ") in this case Sources, then read the accepted quotation again.",
                 "COMMERCIAL_SOURCE_FILE_MISSING", 409)
        ident = ids[0]
        domain.reference_list([ident], available, "Original referenced commercial source")
        if available[ident]["sha256"] != sha or available[ident]["bytes"] != size:
            fail("A retained original commercial file differs.", "COMMERCIAL_SOURCE_CONFLICT", 409)
        result.append({"name": name, "sha256": sha, "bytes": size, "sourceId": ident})
    if chosen is not None and set(chosen) != used:
        fail("The complete original commercial file selection changed.", "COMMERCIAL_SOURCE_CONFLICT", 409)
    return sorted(result, key=lambda row: (row["name"], row["sha256"], row["sourceId"]))


def inventory(operations, context, body):
    exact(body, ("expectedVersion", *SOURCE_FIELDS), "commercial source selection")
    from operations_installations import _current, _source
    _current(context, body.get("expectedVersion"))
    original = read_source(operations, context, body, required=False)
    missing = []
    for row in original["native"].get("externalFiles", []):
        if not any(meta["sha256"] == row["sha256"] and meta["bytes"] == row["bytes"] for meta in context["sources"].values()):
            missing.append(deepcopy(row))
    return {"schema": SCHEMA, "source": _source(context), "missingFiles": missing,
            "selection": original["selection"], "original": original["native"]}


def task_check_id(case_key, task_id):
    return "quotation-" + hashlib.sha256((case_key + "\0" + task_id).encode("utf-8")).hexdigest()[:32]


def normalize_binding(context, raw):
    value = exact(deepcopy(raw), BINDING_FIELDS, "accepted quotation binding")
    if value.get("schema") != SCHEMA:
        fail("Use the original accepted quotation binding.")
    selected = source_selection(context, {"sourceId": value.get("sourceId"),
                                         "expectedSourceSha256": value.get("sourceSha256")})
    quote = quote_selection(value)
    case_key = original_id(value.get("caseKey"), "commercial case")
    rows = value.get("taskChecks")
    if not isinstance(rows, list) or not rows or len(rows) > 100:
        fail("Bind every accepted implementation task to its original Installation check.")
    seen_tasks, seen_checks, checks = set(), set(), []
    for row in rows:
        exact(row, ("taskId", "checkId", "definitionSha256"), "accepted task binding")
        task_id = original_id(row.get("taskId"), "accepted task")
        check_id = original_id(row.get("checkId"), "Installation check")
        if check_id != task_check_id(case_key, task_id):
            fail("Keep the stable check identity for this original commercial task.")
        if task_id in seen_tasks or check_id in seen_checks:
            fail("Keep each original accepted task and Installation check once.")
        seen_tasks.add(task_id)
        seen_checks.add(check_id)
        checks.append({"taskId": task_id, "checkId": check_id,
                       "definitionSha256": domain.sha(row.get("definitionSha256"), "Accepted task definition", False)})
    return {"schema": SCHEMA, "sourceId": selected["sourceId"],
            "sourceSha256": selected["expectedSourceSha256"], "caseKey": case_key,
            **quote, "scopeSha256": domain.sha(value.get("scopeSha256"), "Accepted scope", False),
            "taskChecks": checks, "sourceFiles": deepcopy(value.get("sourceFiles", []))}


def binding_input(binding):
    return {"sourceId": binding["sourceId"], "expectedSourceSha256": binding["sourceSha256"],
            **{key: binding[key] for key in QUOTE_FIELDS}}


def resolve_binding(operations, context, binding, reader=None):
    value = normalize_binding(context, binding)
    original = read_source(operations, context, binding_input(value), reader)
    selected = original["selected"]
    if original["native"]["caseKey"] != value["caseKey"] or selected["scopeSha256"] != value["scopeSha256"]:
        fail("This Installation selects a different original commercial case or accepted scope.",
             "COMMERCIAL_SCOPE_CONFLICT", 409)
    tasks = selected["scope"].get("tasks")
    if not isinstance(tasks, list) or not tasks:
        fail("The accepted scope has no complete implementation tasks.")
    actual = {row["id"]: row for row in tasks}
    if len(actual) != len(tasks) or set(actual) != {row["taskId"] for row in value["taskChecks"]}:
        fail("Retain every original accepted implementation task.")
    for row in value["taskChecks"]:
        if actual[row["taskId"]]["definitionSha256"] != row["definitionSha256"]:
            fail("The original accepted task definition changed.", "COMMERCIAL_SCOPE_CONFLICT", 409)
    value["sourceFiles"] = source_files(context, original, value["sourceFiles"])
    read = reader or (lambda ident: operations.source(context["program"]["id"], ident)[1])
    for row in value["sourceFiles"]:
        raw = read(row["sourceId"])
        if not isinstance(raw, bytes) or len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
            fail("The original referenced file differs: " + row["name"], "COMMERCIAL_SOURCE_CONFLICT", 409)
    return {**original, "binding": value}


def workorder_document(original):
    scope, binding = original["selected"]["scope"], original["binding"]
    return {"sourceId": binding["sourceId"],
            "reference": scope["reference"], "payer": scope["payer"],
            "scope": scope["summary"], "terms": scope["terms"]}


def verify_document(operations, context, document, reader=None):
    binding = document.get("commercial")
    if binding is None:
        return None
    if document.get("workshare") is not None:
        fail("One Installation keeps one original commercial workorder source. Use separate Installations for distinct cases.",
             "COMMERCIAL_WORKORDER_CONFLICT", 409)
    original = resolve_binding(operations, context, binding, reader)
    scope = original["selected"]["scope"]
    checks = {row["id"]: row for row in document["checks"]}
    for task in scope["tasks"]:
        check_id = task_check_id(binding["caseKey"], task["id"])
        check = checks.get(check_id)
        if (check is None or check["title"] != task["title"] or check["criterion"] != task["acceptance"]
                or not check["required"] or binding["sourceId"] not in check["sourceIds"]):
            fail("Preserve the accepted quotation task and its original criterion; record receiving in its native check.")
    if document["workorder"] != workorder_document(original):
        fail("Keep this accepted quotation's original reference, payer, scope and commercial terms. "
             "Receive the accepted source revision to change them.", "COMMERCIAL_WORKORDER_CONFLICT", 409)
    return original


def verify_transition(operations, context, previous, document, reader=None, original=None):
    if previous is None:
        return
    before = previous["preview"]["document"]
    old_binding = before.get("commercial")
    if old_binding is None:
        return
    binding = document.get("commercial")
    if binding is None or old_binding["caseKey"] != binding["caseKey"]:
        fail("Keep this Installation attached to its original commercial case.",
             "COMMERCIAL_CASE_CONFLICT", 409)
    if binding == old_binding:
        return
    read = reader or (lambda ident: operations.source(context["program"]["id"], ident)[1])
    old = verify_document(operations, previous["preview"]["snapshot"], before, read)
    current = original or verify_document(operations, context, document, read)
    old_selected, selected = old["selected"], current["selected"]
    if old_selected["quoteId"] != selected["quoteId"] and old_selected["quoteId"] not in selected["ancestorQuoteIds"]:
        fail("The new accepted quotation must continue this Installation's original quotation lineage.",
             "COMMERCIAL_QUOTE_LINEAGE_CONFLICT", 409)
    old_tasks = {row["id"]: row for row in old_selected["scope"]["tasks"]}
    old_checks = {row["id"]: row for row in before["checks"]}
    checks = {row["id"]: row for row in document["checks"]}
    def observation(row):
        return {**{key: row.get(key) for key in ("operator", "observedAt", "note")},
                **{key: sorted(row.get(key, [])) for key in ("workIds", "purchaseIds", "outcomeIds")}}
    for task in selected["scope"]["tasks"]:
        prior = old_tasks.get(task["id"])
        if prior is None or prior["definitionSha256"] == task["definitionSha256"]:
            continue
        check_id = task_check_id(binding["caseKey"], task["id"])
        check, old_check = checks[check_id], old_checks[check_id]
        if check["state"] == "ACCEPTED" and observation(check) == observation(old_check):
            fail("The accepted task changed: " + task["title"] + ". Record new receiving for that task "
                 "or keep it open; the earlier observation stays in the previous saved edition.",
                 "COMMERCIAL_ACCEPTANCE_CONFLICT", 409)


def field_get(document, path):
    value = document
    for key in path.split("."):
        value = value[key]
    return deepcopy(value)


def field_put(document, path, value):
    parts = path.split(".")
    target = document
    for key in parts[:-1]:
        target = target[key]
    target[parts[-1]] = deepcopy(value)


def source_fields(original):
    scope = original["selected"]["scope"]
    values = scope.get("fields", {})
    if not isinstance(values, dict) or set(values) - set(MERGE_FIELDS):
        fail("The original source contains an unsupported commissioning field.")
    for key, value in values.items():
        if not isinstance(value, str) or len(value) > 8000:
            fail("The original commissioning field is not complete text: " + key)
    return values


def merge_fields(document, old_original, original, resolutions, initial=None):
    exact(resolutions, MERGE_FIELDS, "commercial field choices")
    if any(value not in ("current", "accepted") for value in resolutions.values()):
        fail("Choose the current operator field or accepted source for each displayed conflict.")
    previous = source_fields(old_original) if old_original else {}
    following = source_fields(original)
    conflicts, changes, used = [], [], set()
    for key, accepted in following.items():
        current = field_get(document, key)
        base = previous.get(key, field_get(initial, key) if initial is not None else "")
        if current == accepted:
            continue
        if current == base or current == "":
            chosen = accepted
        elif accepted == base:
            chosen = current
        else:
            choice = resolutions.get(key)
            used.add(key)
            conflicts.append({"key": key, "base": base, "current": current,
                              "accepted": accepted, "resolution": choice})
            chosen = accepted if choice == "accepted" else current
        if current != chosen:
            changes.append({"field": key, "before": current, "after": chosen})
            field_put(document, key, chosen)
    if set(resolutions) - used:
        fail("A saved field choice no longer refers to a current conflict. Review this exact source again.",
             "COMMERCIAL_RESOLUTION_CONFLICT", 409)
    return conflicts, changes


def seed(operations, context, body):
    """Prepare the full editable native document; installation.save owns commit."""
    exact(body, ("expectedVersion", *SOURCE_FIELDS, *QUOTE_FIELDS, "installationId",
                 "expectedRevision", "document", "resolutions"), "accepted scope selection")
    import operations_installations as installations
    installations._current(context, body.get("expectedVersion"))
    ident = body.get("installationId")
    number = installations.revision(body.get("expectedRevision", 0), True)
    previous = None
    if ident is not None:
        previous = installations.get(operations, context["program"]["id"], ident)
        if previous["revision"] != number:
            fail("Reopen the Installation's current edition before receiving accepted scope.",
                 "INSTALLATION_CONFLICT", 409)
    elif number != 0:
        fail("Use edition zero for a new Installation.")
    original = read_source(operations, context, body)
    selected, native = original["selected"], original["native"]
    if body.get("document") is not None:
        document = installations.normalized(context, body["document"])
    elif previous is not None:
        document = deepcopy(previous["preview"]["document"])
    else:
        document = installations.seed(context)
    if document.get("workshare") is not None:
        fail("This Installation already belongs to its original company Workshare. "
             "Create a separate Installation for this SF74 quotation.", "COMMERCIAL_WORKORDER_CONFLICT", 409)
    old_binding = document.get("commercial")
    old_original = verify_document(operations, context, document) if old_binding is not None else None
    if old_binding is not None:
        if old_binding["caseKey"] != native["caseKey"]:
            fail("Create a separate Installation for another original commercial case.",
                 "COMMERCIAL_CASE_CONFLICT", 409)
        if (old_binding["quoteId"] != selected["quoteId"]
                and old_binding["quoteId"] not in selected["ancestorQuoteIds"]):
            fail("Select an accepted later edition of this original quotation.",
                 "COMMERCIAL_QUOTE_LINEAGE_CONFLICT", 409)
    initial = installations.seed(context) if previous is None and body.get("document") is None else None
    conflicts, plan_changes = merge_fields(document, old_original, original, body.get("resolutions") or {}, initial)
    previous_tasks = {} if old_original is None else {row["id"]: row for row in old_original["selected"]["scope"]["tasks"]}
    current_tasks = {row["id"]: row for row in selected["scope"]["tasks"]}
    old_checks = {row["id"]: row for row in document["checks"]}
    owned_checks = set() if old_binding is None else {row["checkId"] for row in old_binding["taskChecks"]}
    document["checks"] = [row for row in document["checks"] if row["id"] not in owned_checks]
    bindings, added, changed, unchanged, removed = [], [], [], [], []
    for task_id, task in current_tasks.items():
        check_id = task_check_id(native["caseKey"], task_id)
        if any(row["id"] == check_id for row in document["checks"]):
            fail("The original task check collides with an independent Installation check.")
        prior = previous_tasks.get(task_id)
        same = prior is not None and prior["definitionSha256"] == task["definitionSha256"]
        existing = old_checks.get(check_id) if same else None
        if existing is None:
            check = {"id": check_id, "title": task["title"], "criterion": task["acceptance"],
                     "tranche": None, "required": True, "state": "OPEN", "operator": "",
                     "observedAt": None, "note": task.get("description", ""),
                     "sourceIds": [], "workIds": [], "purchaseIds": [], "outcomeIds": []}
        else:
            check = deepcopy(existing)
        check["sourceIds"] = list(dict.fromkeys([*check["sourceIds"], original["selection"]["sourceId"]]))
        document["checks"].append(check)
        bindings.append({"taskId": task_id, "checkId": check_id,
                         "definitionSha256": task["definitionSha256"]})
        summary = {"taskId": task_id, "checkId": check_id, "title": task["title"],
                   "before": prior, "after": task,
                   "previousState": old_checks.get(check_id, {}).get("state")}
        (unchanged if same else changed if prior is not None else added).append(summary)
    for task_id, prior in previous_tasks.items():
        if task_id not in current_tasks:
            removed.append({"taskId": task_id, "title": prior["title"], "before": prior,
                            "checkId": task_check_id(native["caseKey"], task_id)})
    binding = {"schema": SCHEMA, "sourceId": original["selection"]["sourceId"],
               "sourceSha256": original["selection"]["expectedSourceSha256"],
               "caseKey": native["caseKey"], **{key: selected[key] for key in QUOTE_FIELDS},
               "scopeSha256": selected["scopeSha256"], "taskChecks": bindings,
               "sourceFiles": source_files(context, original)}
    document["commercial"] = binding
    original["binding"] = binding
    document["workorder"] = workorder_document(original)
    for section, key in (("source", "sourceIds"), ("payment", "termsSourceIds")):
        document[section][key] = list(dict.fromkeys([*document[section][key], binding["sourceId"],
            *[row["sourceId"] for row in binding["sourceFiles"]]]))
    import operations_dispatch as dispatch
    dispatch.reconcile_checks(document)
    document = installations.normalized(context, document)
    verify_document(operations, context, document)
    ready = all(row["resolution"] in ("current", "accepted") for row in conflicts)
    candidate = {"schema": SCHEMA, "source": installations._source(context),
                 "installationId": ident, "expectedRevision": number, "document": document,
                 "canApply": ready, "conflicts": conflicts, "resolutions": deepcopy(body.get("resolutions") or {}),
                 "changes": {"fields": plan_changes, "added": added, "changed": changed,
                             "unchanged": unchanged, "removed": removed},
                 "original": {"source": native["source"], "caseKey": native["caseKey"],
                              "case": native.get("case"), "selected": selected},
                 "sourceChanges": installations.differences(previous["preview"]["document"], document) if previous else []}
    candidate["reviewSha256"] = digest(candidate)
    return candidate


def html_section(original):
    if original is None:
        return ""
    selected, binding = original["selected"], original["binding"]
    scope = selected["scope"]
    e = lambda value: escape(str(value if value is not None else ""), quote=True)
    result = "<h2>Accepted customer quotation</h2><p>" + e(scope["title"]) + "</p><p>" + e(scope["reference"]) + \
        " · " + e(scope["payer"]) + "</p><p>" + e(scope["summary"]) + "</p><pre>" + e(scope["terms"]) + "</pre>"
    result += "<p>Original quotation " + e(binding["quoteId"]) + " · " + e(binding["quoteSha256"]) + \
        "<br>Customer response " + e(binding["acceptanceId"]) + " · " + e(binding["acceptanceSha256"]) + "</p>"
    result += "<table><thead><tr><th>Accepted task</th><th>Original acceptance criterion</th></tr></thead><tbody>"
    for task in scope["tasks"]:
        result += "<tr><td>" + e(task["title"]) + "</td><td>" + e(task["acceptance"]) + "</td></tr>"
    result += "</tbody></table><details><summary>Original accepted quotation and recorded customer response</summary><pre>" + \
        e(json.dumps({"quotation": selected["quote"], "response": selected["acceptance"]},
                     ensure_ascii=False, indent=2)) + "</pre></details>"
    return result
