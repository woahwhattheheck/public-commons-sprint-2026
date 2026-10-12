"""Original SF74 implementation evidence in the existing SF47 review transaction.

This module receives and links observations. The SF74 producer owns task,
measurement and receiving semantics; the SF47 domain owns work, purchases,
installations, cash and issuer outcomes.
"""
from __future__ import annotations

import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import html
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid
import zipfile

from model import Problem, canonical, digest, now, text, csv_bytes, MAX_BUNDLE
import operations_domain as domain
import operations_installations as installations

SCHEMA = "stellar-forge.sf47-implementation-evidence.v1"
SOURCE_SCHEMA = "stellar-forge.sf47-implementation-source.v1"
PURPOSE = "IMPLEMENTATION_EVIDENCE"
MAX_SOURCE = 8 * 1024 * 1024
MAX_READER_OUTPUT = 16 * 1024 * 1024
MAX_REVIEW = 8 * 1024 * 1024
MAX_REVIEWS = 200
MAX_SELECTIONS = 200
MAX_FILE_REFS = 5000
KINDS = {"task": "tasks", "receiving": "receiving", "measurement": "measurements"}
LINKS = {"deploymentIds": "deployments", "workIds": "work",
         "purchaseIds": "purchases", "outcomeIds": "outcomes"}
INPUTS = ("name", "sourceId", "sourceSha256", "asOfAt", "tranche",
          "installationRefs", "originalFileRefs", "selections", "note")
_HELPER = Path(__file__).resolve().with_name("implementation_handoff.mjs")
_READER = threading.BoundedSemaphore(1)


def fail(message, code="INVALID_IMPLEMENTATION_EVIDENCE", status=422):
    raise Problem(message, status, code)


def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        fail("Use the declared " + label + ".")
    return value


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def instant(value, label="UTC observation cutoff"):
    value = text(value, label, 40, True)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0 or \
                parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z") != value:
            raise ValueError()
    except (ValueError, AttributeError) as exc:
        raise Problem("Use a UTC time including milliseconds for " + label + ".", 422,
                      "IMPLEMENTATION_CUTOFF") from exc
    return value


def at(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def scalar_id(value, label="Original implementation identity"):
    value = text(value, label, 160, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", value):
        fail("Use the retained " + label.lower() + ".")
    return value


def _typed_equal(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left) == set(right) and all(_typed_equal(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(_typed_equal(a, b) for a, b in zip(left, right))
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    return type(left) is type(right) and left == right


def original_state(raw):
    """Unwrap original bytes, without re-rendering or executing their contents."""
    try:
        document = json.loads(raw.decode("utf-8"))
        schema = document["schema"]
        if schema == "stellar-forge.merchant-commissioning.v1":
            state, format_name = document, "commissioning"
        elif schema == "stellar-forge.merchant-workspace.v1":
            state, format_name = document["commissioning"], "workspace"
        elif schema == "stellar-forge.merchant-support-handoff.v1":
            workspace = document["workspaceText"].encode("utf-8")
            support = document["supportText"].encode("utf-8")
            if hashlib.sha256(workspace).hexdigest() != document["sha256"]["workspace"] or \
                    hashlib.sha256(support).hexdigest() != document["sha256"]["support"]:
                fail("The original Support source hashes differ.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
            state = json.loads(document["workspaceText"])["commissioning"]
            format_name = "support-handoff"
        else:
            fail("Select the original implementation, merchant workspace or Support handoff.",
                 "IMPLEMENTATION_SOURCE_KIND")
        if not isinstance(state, dict) or state.get("schema") != "stellar-forge.merchant-commissioning.v1":
            fail("The source contains no original implementation.", "IMPLEMENTATION_NOT_PRESENT")
        if not isinstance(state.get("blobs"), dict):
            fail("The original implementation file store is missing.")
        return document, state, format_name
    except (ValueError, UnicodeError, KeyError, TypeError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("The complete original implementation source is unreadable.", 422,
                      "IMPLEMENTATION_SOURCE_INVALID") from exc


def original_files(raw):
    _, state, _ = original_state(raw)
    result = {}
    for sha, blob in state["blobs"].items():
        domain.sha(sha, "Original file SHA-256", False)
        if not isinstance(blob, dict) or set(blob) != {"bytes", "data"} or \
                not isinstance(blob["bytes"], int) or isinstance(blob["bytes"], bool) or \
                not isinstance(blob["data"], str):
            fail("The original file descriptor changed.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
        try:
            value = base64.b64decode(blob["data"], validate=True)
        except (ValueError, TypeError) as exc:
            raise Problem("An original file encoding changed.", 409, "IMPLEMENTATION_SOURCE_CHANGED") from exc
        if base64.b64encode(value).decode("ascii") != blob["data"] or len(value) != blob["bytes"] or \
                hashlib.sha256(value).hexdigest() != sha:
            fail("An original implementation file differs from its retained hash.",
                 "IMPLEMENTATION_SOURCE_CHANGED", 409)
        result[sha] = value
    return result


def validate_native(native, metadata, raw=None):
    if not isinstance(native, dict) or native.get("schema") != SOURCE_SCHEMA or \
            not isinstance(native.get("state"), dict) or not isinstance(native.get("originalState"), dict):
        fail("The retained native implementation projection is incomplete.")
    instant(native.get("asOfAt"))
    if native.get("source", {}).get("sha256") != metadata["sha256"] or \
            native.get("source", {}).get("bytes") != metadata["bytes"]:
        fail("The implementation projection identifies another source.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
    domain.sha(native.get("projectionSha256"), "Original Node projection digest", False)
    if not isinstance(native.get("reader"), dict) or not native["reader"]:
        fail("Retain the original native reader identities.")
    for value in native["reader"].values():
        domain.sha(value, "Original reader source SHA-256", False)
    state = native["state"]
    for key in ("tasks", "receiving", "measurements", "materials", "editions", "events"):
        rows = state.get(key)
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            fail("The original implementation " + key + " are incomplete.")
        ids = [scalar_id(row.get("id")) for row in rows]
        if len(set(ids)) != len(ids):
            fail("The native source repeats an original " + key + " identity.")
    for key, source_key in (("receivingStatus", "receiving"), ("measurementStatus", "measurements")):
        statuses = native.get(key)
        if not isinstance(statuses, list) or len(statuses) != len(state[source_key]) or \
                {row.get("id") for row in statuses} != {row["id"] for row in state[source_key]}:
            fail("The native observation-status projection is incomplete.")
        for row in statuses:
            if not isinstance(row.get("withinCutoff"), bool) or not isinstance(row.get("activeEdition"), bool):
                fail("Retain explicit original observation status.")
    if not isinstance(native.get("comparisons"), list) or not isinstance(native.get("summary"), dict) or \
            not isinstance(native.get("currentSummary"), dict) or not isinstance(native.get("originalReportHtml"), str):
        fail("The complete producer calculation and readable original report are required.")
    for key in ("originalFiles", "sourceBundles", "externalFiles"):
        if not isinstance(native.get(key), list):
            fail("Retain the producer's complete original source-bundle inventory.")
    external = {}
    for row in native["externalFiles"]:
        if not isinstance(row, dict) or not isinstance(row.get("sourceFile"), dict):
            fail("An original external file reference is missing.")
        sha = domain.sha(row.get("sha256"), "External original SHA-256", False)
        size = domain.integer(row.get("bytes"), "External original bytes", 0, 1024 * 1024 * 1024)
        if sha in external and external[sha] != size:
            fail("The original source inventory reuses a digest with different bytes.")
        external[sha] = size
    if raw is not None:
        if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
            fail("The original implementation bytes changed.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
        document, source_state, format_name = original_state(raw)
        projected = deepcopy(source_state)
        projected.pop("blobs")
        if not _typed_equal(projected, native["originalState"]) or \
                native.get("origin", {}).get("format") != format_name or document["schema"] != native["source"]["schema"]:
            fail("The frozen projection does not retain its original source fields.",
                 "IMPLEMENTATION_SOURCE_CHANGED", 409)
        expected = deepcopy(projected)
        # The producer fills omitted plan strings; all original supplied fields stay exact.
        if isinstance(expected.get("plan"), dict) and isinstance(state.get("plan"), dict):
            expected["plan"] = {key: expected["plan"].get(key, "") for key in state["plan"]}
        if not _typed_equal(expected, state):
            fail("The normalized implementation differs from its original source.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
        files = original_files(raw)
        expected_files = [{"sha256": sha, "bytes": len(value)} for sha, value in sorted(files.items())]
        if native.get("files") != expected_files:
            fail("The original implementation file inventory is incomplete.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
    return native


def inspect(raw, as_of):
    import os
    as_of = instant(as_of)
    selected = os.environ.get("SF47_SUPPORT_NODE") or shutil.which("node")
    if not selected or not Path(selected).is_absolute() or not Path(selected).is_file():
        fail("The installed original Support reader needs its configured Node executable.",
             "IMPLEMENTATION_NODE_UNAVAILABLE", 503)
    if not raw or len(raw) > MAX_SOURCE:
        fail("Select a complete original source up to 8 MiB.", "IMPLEMENTATION_SOURCE_SIZE", 413)
    if not _READER.acquire(blocking=False):
        fail("Another implementation source is being read. Continue this same source selection when it finishes.",
             "IMPLEMENTATION_READER_BUSY", 409)
    try:
        try:
            completed = subprocess.run([selected, "--max-old-space-size=192", str(_HELPER), "--as-of", as_of],
                input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
        except subprocess.TimeoutExpired as exc:
            raise Problem("The original source reader timed out. Its saved source remains available.",
                          503, "IMPLEMENTATION_READER_TIMEOUT") from exc
        except OSError as exc:
            raise Problem("The installed original reader could not start.", 503,
                          "IMPLEMENTATION_READER_UNAVAILABLE") from exc
        if len(completed.stdout) > MAX_READER_OUTPUT:
            fail("The complete native projection exceeds the receiving bound.", "IMPLEMENTATION_REVIEW_SIZE", 413)
        try:
            result = json.loads(completed.stdout)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The native reader did not return a complete source projection.", 503,
                          "IMPLEMENTATION_READER_UNAVAILABLE") from exc
        if not isinstance(result, dict) or result.get("ok") is not True:
            error = result.get("error", {}) if isinstance(result, dict) else {}
            code = error.get("code", "IMPLEMENTATION_SOURCE_INVALID")
            if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,100}", code):
                code = "IMPLEMENTATION_SOURCE_INVALID"
            fail(str(error.get("message", "The selected source is invalid."))[:1200], code,
                 413 if error.get("status") == 413 else 422)
        if completed.returncode:
            fail("The native source read did not finish.", "IMPLEMENTATION_READER_UNAVAILABLE", 503)
        metadata = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
        return validate_native(result.get("result"), metadata, raw)
    finally:
        _READER.release()


def verify_projection(native, metadata, raw):
    """Reopen the exact source through the maintained producer before using it."""
    validate_native(native, metadata, raw)
    actual = inspect(raw, native["asOfAt"])
    if actual.get("reader") != native.get("reader"):
        fail("The installed implementation reader differs from this frozen review. Retain its historical projection and use the original published reader release to verify it.",
             "IMPLEMENTATION_READER_PROVENANCE_MISMATCH", 409)
    if not _typed_equal(actual, native):
        fail("The frozen implementation projection differs from the producer's actual read of the exact original source and cutoff.",
             "IMPLEMENTATION_PROJECTION_MISMATCH", 409)
    return actual


def verify_review(review, read_source):
    validate_review(review)
    native = review["implementation"]["native"]
    metadata, raw = read_source(review["implementation"]["inputs"]["sourceId"])
    verify_projection(native, metadata, raw)
    for source in review["implementation"]["bindings"]["sources"]:
        actual, original = read_source(source["id"])
        if actual["sha256"] != source["sha256"] or len(original) != source["bytes"] or hashlib.sha256(original).hexdigest() != source["sha256"]:
            fail("A frozen original evidence file is unavailable or changed.", "IMPLEMENTATION_ORIGINAL_FILE_CHANGED", 409)
    return review


def normalize(context, native, value):
    value = obj(value, INPUTS, "implementation evidence input")
    source_id = value.get("sourceId")
    if source_id not in context["sources"]:
        fail("Select an original source retained in this case.", "IMPLEMENTATION_SOURCE_NOT_FOUND", 404)
    source = context["sources"][source_id]
    if domain.sha(value.get("sourceSha256"), "Selected source SHA-256", False) != source["sha256"] or \
            native["source"]["sha256"] != source["sha256"]:
        fail("The selected original source changed.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
    cutoff = instant(value.get("asOfAt"))
    if cutoff != native["asOfAt"]:
        fail("The native projection uses another observation cutoff.", "IMPLEMENTATION_PREVIEW_CONFLICT", 409)
    tranche = domain.integer(value.get("tranche"), "Evidence tranche", 1, 3, True)
    selections = value.get("selections", [])
    if not isinstance(selections, list) or len(selections) > MAX_SELECTIONS:
        fail("Select at most two hundred original observations.", "IMPLEMENTATION_SELECTION_LIMIT", 413)
    selected, seen = [], set()
    source_maps = {kind: {row["id"]: row for row in native["state"][key]} for kind, key in KINDS.items()}
    targets = {kind: {row["id"]: row for row in context["records"][kind]} for kind in LINKS.values()}
    for item in selections:
        obj(item, ("kind", "id", "use", *LINKS, "note"), "original observation link")
        kind = domain.enum(item.get("kind"), tuple(KINDS), "Original observation kind")
        ident = scalar_id(item.get("id"))
        if ident not in source_maps[kind] or (kind, ident) in seen:
            fail("Select each retained original observation once.")
        seen.add((kind, ident))
        row = {"kind": kind, "id": ident,
               "use": domain.enum(item.get("use", "EVIDENCE"), ("EVIDENCE", "CONTEXT"), "Review use"),
               "note": text(item.get("note", ""), "Linking observation", 12000)}
        for field, target in LINKS.items():
            row[field] = domain.reference_list(item.get(field, []), targets[target], "Linked " + target, 100)
        selected.append(row)
    refs = value.get("installationRefs", [])
    if not isinstance(refs, list) or len(refs) > 20:
        fail("Select at most twenty original installation editions.")
    normalized_refs, seen_refs = [], set()
    for row in refs:
        obj(row, ("id", "revision", "sha256"), "selected installation edition")
        ident = installations.identity(row.get("id"))
        number = installations.revision(row.get("revision"))
        if (ident, number) in seen_refs:
            fail("Select an installation edition once.")
        seen_refs.add((ident, number))
        normalized_refs.append({"id": ident, "revision": number,
                                "sha256": domain.sha(row.get("sha256"), "Installation edition SHA-256", False)})
    external = {row["sha256"]: row["bytes"] for row in native["externalFiles"]}
    file_refs = value.get("originalFileRefs", [])
    if not isinstance(file_refs, list) or len(file_refs) > MAX_FILE_REFS:
        fail("Select at most five thousand exact original source-file bindings.", "IMPLEMENTATION_FILE_LIMIT", 413)
    normalized_files, seen_files = [], set()
    for row in file_refs:
        obj(row, ("sha256", "sourceId"), "original source-file binding")
        sha = domain.sha(row.get("sha256"), "Original file SHA-256", False)
        original = context["sources"].get(row.get("sourceId"))
        if sha in seen_files or sha not in external:
            fail("Bind each declared external original file once.")
        if not original or original["sha256"] != sha or original["bytes"] != external[sha]:
            fail("Select the exact retained original file with its declared byte count and SHA-256.",
                 "IMPLEMENTATION_ORIGINAL_FILE_CHANGED", 409)
        seen_files.add(sha)
        normalized_files.append({"sha256": sha, "sourceId": original["id"]})
    return {"name": text(value.get("name"), "Evidence review name", 500, True),
            "sourceId": source_id, "sourceSha256": source["sha256"], "asOfAt": cutoff, "tranche": tranche,
            "installationRefs": normalized_refs, "originalFileRefs": normalized_files, "selections": selected,
            "note": text(value.get("note", ""), "Review basis", 12000)}


def select_installations(rows, refs):
    available = {(row["id"], row["revision"]): row for row in rows}
    selected = []
    for ref in refs:
        row = available.get((ref["id"], ref["revision"]))
        if row is None or row["sha256"] != ref["sha256"]:
            fail("The exact selected installation edition is unavailable.", "IMPLEMENTATION_INSTALLATION_CHANGED", 409)
        selected.append(deepcopy(row))
    return selected


def seed(context, metadata, native):
    validate_native(native, metadata)
    return {"schema": SCHEMA + ".seed", "caseId": context["program"]["id"], "version": context["program"]["version"],
            "source": deepcopy(metadata), "native": native,
            "inputs": {"name": (native["state"]["plan"].get("title") or native["origin"]["name"] or "Implementation evidence")[:500],
                       "sourceId": metadata["id"], "sourceSha256": metadata["sha256"], "asOfAt": native["asOfAt"],
                       "tranche": None, "installationRefs": [], "originalFileRefs": [], "selections": [], "note": ""}}


def bindings(context, inputs, selected_installations):
    records, source_ids = {}, {inputs["sourceId"], *(row["sourceId"] for row in inputs["originalFileRefs"])}
    for field, kind in LINKS.items():
        ids = {ident for row in inputs["selections"] for ident in row[field]}
        available = {row["id"]: row for row in context["records"][kind]}
        records[kind] = [deepcopy(available[ident]) for ident in sorted(ids)]
        for row in records[kind]:
            source_ids.update(row.get("sourceIds", []))
    for row in selected_installations:
        source_ids.update(row["preview"]["snapshot"]["sources"])
    return {"records": records, "installations": deepcopy(selected_installations),
            "sources": [deepcopy(context["sources"][ident]) for ident in sorted(source_ids)]}


def evaluate(context, native, supplied, selected_installations):
    inputs = normalize(context, native, supplied)
    validate_native(native, context["sources"][inputs["sourceId"]])
    if [{"id": row["id"], "revision": row["revision"], "sha256": row["sha256"]}
            for row in selected_installations] != inputs["installationRefs"]:
        fail("The selected installation snapshots differ from the reviewed references.")
    linked = bindings(context, inputs, selected_installations)
    maps = {kind: {row["id"]: row for row in native["state"][collection]} for kind, collection in KINDS.items()}
    receive_status = {row["id"]: row for row in native["receivingStatus"]}
    measurement_status = {row["id"]: row for row in native["measurementStatus"]}
    comparison = {row["measurementId"]: row for row in native["comparisons"]}
    issues, selected = [], []
    def finding(code, message, item=None, blocking=False):
        issues.append({"code": code, "message": message, "kind": item["kind"] if item else None,
                       "id": item["id"] if item else None, "blocking": blocking})
    if not inputs["selections"]:
        finding("NO_SELECTION", "Select the original observations that this review will retain.", blocking=True)
    external = {row["sha256"]: row for row in native["externalFiles"]}
    bound_files = {row["sha256"]: row for row in inputs["originalFileRefs"]}
    for sha, original_file in external.items():
        if sha not in bound_files:
            finding("ORIGINAL_FILE_UNAVAILABLE", "Retain and select the exact original source-bundle file " +
                    original_file["name"] + " (" + sha + ") before using the complete evidence package.", blocking=True)
    for item in inputs["selections"]:
        original = maps[item["kind"]][item["id"]]
        status = receive_status.get(item["id"], {}) if item["kind"] == "receiving" else \
                 measurement_status.get(item["id"], {}) if item["kind"] == "measurement" else {}
        row = {"link": deepcopy(item), "original": deepcopy(original), "status": deepcopy(status)}
        evidence = item["use"] == "EVIDENCE"
        if item["kind"] == "task":
            historical = original["retired"] or original["status"] == "retired" or \
                         original["editionId"] not in (None, native["state"]["activeEditionId"])
            row["status"] = {"historical": historical, "state": original["status"]}
            if historical:
                finding("HISTORICAL_TASK", "This task belongs to historical or retired work in the selected source.",
                        item, evidence)
            finding("TASK_DEFINITION", "A saved task definition or Done status is separate from technical and customer receiving.", item)
        else:
            if not status["withinCutoff"]:
                finding("AFTER_CUTOFF", "The original observed or recorded time follows the selected cutoff.", item, evidence)
            if status.get("supersededBy"):
                finding("CORRECTED_OBSERVATION", "The selected observation was corrected by " + status["supersededBy"] + " by this cutoff.", item, evidence)
            if status.get("currentSupersededBy") and status["currentSupersededBy"] != status.get("supersededBy"):
                finding("LATER_CORRECTION", "A correction after the cutoff remains in the selected source history.", item)
            if not status["activeEdition"]:
                finding("HISTORICAL_EDITION", "This observation belongs to another retained workorder edition.", item)
            if item["kind"] == "receiving":
                if not status.get("subjectMatches"):
                    finding("RECEIVING_SUBJECT_CHANGED", "The received task definition or delivered file set differs from the selected source's current definition.", item, evidence)
                if status["withinCutoff"] and not status.get("supersededBy") and not status.get("latestTaskIds"):
                    finding("LATER_RECEIVING", "A later observation is effective for these tasks and receiving kind at this cutoff.", item, evidence)
                if original["outcome"] != "accepted":
                    finding("RECORDED_RECEIVING_RESULT", "Original " + original["kind"] + " receiving records " + original["outcome"] + ".", item)
            else:
                row["comparison"] = deepcopy(comparison.get(item["id"]))
                if original["phase"] != "baseline" and not (row["comparison"] or {}).get("comparable"):
                    finding("NO_COMPARABLE_BASELINE", "The producer has no earlier comparable baseline for this selected task, output and unit.", item)
        if not any(item[field] for field in LINKS):
            finding("NO_RECORD_LINK", "This source observation has no selected Operations record link.", item)
        for purchase in linked["records"]["purchases"]:
            if purchase["id"] not in item["purchaseIds"]:
                continue
            material_ids = original.get("materialIds", [])
            materials = [m for m in native["state"]["materials"] if m["id"] in material_ids]
            if purchase.get("deliveredSha256") and purchase["deliveredSha256"] not in {m["sha256"] for m in materials}:
                finding("PURCHASE_LINK_ONLY", "The selected purchase is an explicit operator association; its output hash is not one of this observation's selected material hashes.", item)
        selected.append(row)
    if native["origin"].get("exportedAt") and at(native["origin"]["exportedAt"]) > at(inputs["asOfAt"]):
        finding("LATER_SOURCE_EXPORT", "This source was exported after the observation cutoff. Its complete selected task definitions remain the definition basis; no earlier task state is inferred.")
    selected_evidence = [row for row in selected if row["link"]["use"] == "EVIDENCE"]
    summary = {"selected": len(selected), "evidence": len(selected_evidence),
               "context": len(selected) - len(selected_evidence),
               "tasks": sum(row["link"]["kind"] == "task" for row in selected),
               "measurements": sum(row["link"]["kind"] == "measurement" for row in selected),
               "technicalAcceptedTasks": len({ident for row in selected_evidence
                   if row["link"]["kind"] == "receiving" and row["original"]["kind"] == "technical"
                   for ident in row["status"].get("currentAcceptedTaskIds", [])}),
               "customerAcceptedTasks": len({ident for row in selected_evidence
                   if row["link"]["kind"] == "receiving" and row["original"]["kind"] == "customer"
                   for ident in row["status"].get("currentAcceptedTaskIds", [])}),
               "comparisons": sum(bool(row.get("comparison", {}).get("comparable")) for row in selected if row.get("comparison")),
               "linkedInstallations": len(selected_installations), "externalOriginalFiles": len(external),
               "boundOriginalFiles": len(bound_files), "missingOriginalFiles": len(external) - len(bound_files)}
    result = {"schema": SCHEMA, "source": {"programId": context["program"]["id"],
              "version": context["program"]["version"], "sourceId": inputs["sourceId"],
              "sha256": inputs["sourceSha256"], "bytes": native["source"]["bytes"],
              "nativeSha256": digest(native)}, "inputs": inputs, "native": deepcopy(native),
              "bindings": linked, "selected": selected, "summary": summary, "issues": issues,
              "ready": not any(row["blocking"] for row in issues)}
    result["previewSha256"] = digest(result)
    return result


def prepare(ops, context, data, actor, version):
    obj(data, ("inputs", "expectedPreviewSha256"), "implementation preparation")
    inputs = data.get("inputs")
    if not isinstance(inputs, dict):
        fail("Use the selected original evidence inputs.")
    metadata, raw = ops.source(context["program"]["id"], inputs.get("sourceId"))
    native = inspect(raw, inputs.get("asOfAt"))
    selected = select_installations(installations.load(ops, context["program"]["id"]), inputs.get("installationRefs", []))
    candidate = evaluate(context, native, inputs, selected)
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed evidence preview", False):
        fail("The original source, selection or linked case changed. Preview the retained draft again.",
             "IMPLEMENTATION_PREVIEW_CONFLICT", 409)
    if context["program"]["mode"] != "WALKTHROUGH" and at(candidate["inputs"]["asOfAt"]) > at(utc_now()):
        fail("A future cutoff remains a plan. Freeze an actual observation cutoff.",
             "IMPLEMENTATION_FUTURE_CUTOFF", 409)
    if not candidate["inputs"]["selections"]:
        fail("Select the original observations before freezing this review.")
    count = ops.db.execute("SELECT COUNT(*) FROM ops_reviews WHERE program_id=?",
                           (context["program"]["id"],)).fetchone()[0]
    if count >= MAX_REVIEWS:
        fail("The original case has reached its retained-review bound.", "IMPLEMENTATION_REVIEW_LIMIT", 413)
    snapshot = ops._business(context)
    row = {"id": "review-" + uuid.uuid4().hex, "version": version, "createdAt": now(), "actor": actor,
           "note": candidate["inputs"]["note"] or candidate["inputs"]["name"],
           "businessSha256": digest(snapshot), "snapshot": snapshot, "report": domain.report(**context),
           "purpose": PURPOSE, "implementation": candidate}
    if len(canonical(row).encode("utf-8")) > MAX_REVIEW:
        fail("The complete evidence review exceeds 8 MiB. Preserve its original source and select a smaller review scope.",
             "IMPLEMENTATION_REVIEW_SIZE", 413)
    ops.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)", (context["program"]["id"], row["id"], canonical(row)))
    return {"before": None, "after": {key: row[key] for key in ("id", "version", "purpose", "businessSha256")} |
            {"evidenceSha256": candidate["previewSha256"]}, "kind": "review", "recordId": row["id"],
            "unchanged": False, "previewSha256": candidate["previewSha256"], "evidenceReady": candidate["ready"]}


def validate_review(review):
    if review.get("purpose") != PURPOSE:
        fail("Select an original implementation evidence review.", "IMPLEMENTATION_REVIEW_NOT_FOUND", 404)
    candidate, snapshot = review.get("implementation"), review.get("snapshot")
    if not isinstance(candidate, dict) or not isinstance(snapshot, dict) or digest(snapshot) != review.get("businessSha256"):
        fail("The original evidence review snapshot changed.", "IMPLEMENTATION_REVIEW_CHANGED", 409)
    if candidate.get("schema") != SCHEMA or candidate.get("source", {}).get("version") != review["version"] - 1:
        fail("The evidence review no longer joins its source case version.")
    if digest(candidate.get("native")) != candidate["source"].get("nativeSha256"):
        fail("The original producer projection changed.", "IMPLEMENTATION_REVIEW_CHANGED", 409)
    context = {**snapshot, "program": {**snapshot["program"], "version": review["version"] - 1},
               "sources": {row["id"]: row for row in snapshot["sources"]}}
    actual = evaluate(context, candidate["native"], candidate["inputs"], candidate["bindings"]["installations"])
    if not _typed_equal(actual, candidate):
        fail("The evidence review differs from its original source and explicit links.", "IMPLEMENTATION_REVIEW_CHANGED", 409)
    return review


def current_binding(context, candidate):
    differences = []
    for kind, rows in candidate["bindings"]["records"].items():
        current = {row["id"]: row for row in context["records"][kind]}
        for row in rows:
            if not _typed_equal(current.get(row["id"]), row):
                differences.append({"kind": kind, "id": row["id"], "reason": "The linked original record changed after this review."})
    refs = {row["id"]: row for row in context.get("installationRefs", [])}
    for row in candidate["bindings"]["installations"]:
        expected = {"id": row["id"], "revision": row["revision"], "sha256": row["sha256"]}
        if refs.get(row["id"]) != expected:
            differences.append({"kind": "installation", "id": row["id"], "reason": "The selected installation is a retained earlier edition."})
    for source in candidate["bindings"]["sources"]:
        current = context["sources"].get(source["id"])
        if not current or (current["sha256"], current["bytes"]) != (source["sha256"], source["bytes"]):
            differences.append({"kind": "source", "id": source["id"], "reason": "The exact original source is unavailable."})
    return {"current": not differences, "differences": differences,
            "definitionBasis": candidate["native"]["definitionBasis"]}


def summary(review, context=None):
    candidate = review["implementation"]
    result = {"implementationName": candidate["inputs"]["name"], "implementationTranche": candidate["inputs"]["tranche"],
              "implementationSourceId": candidate["inputs"]["sourceId"], "implementationSourceSha256": candidate["inputs"]["sourceSha256"],
              "implementationAsOfAt": candidate["inputs"]["asOfAt"], "evidenceReady": candidate["ready"],
              "evidenceSummary": candidate["summary"], "evidenceSha256": candidate["previewSha256"]}
    if context is not None:
        result["implementationCurrent"] = current_binding(context, candidate)
    return result


def validate_import(context, reviews, events, saved_installations, files):
    ids = set()
    available_installations = {(row["id"], row["revision"], row["sha256"]): row for row in saved_installations}
    record_states = installations._record_matches(events, context["records"])
    for review in reviews:
        if review.get("purpose") != PURPOSE:
            continue
        validate_review(review)
        ids.add(review["id"])
        candidate = review["implementation"]
        source_id = candidate["inputs"]["sourceId"]
        metadata = context["sources"].get(source_id)
        if not metadata:
            fail("The complete case is missing its original implementation source.")
        verify_projection(candidate["native"], metadata, files["sources/" + source_id])
        for row in candidate["bindings"]["installations"]:
            if available_installations.get((row["id"], row["revision"], row["sha256"])) != row or row["version"] >= review["version"]:
                fail("The evidence review lost its exact earlier installation edition.")
        for rows in candidate["bindings"]["records"].values():
            for row in rows:
                if row["version"] >= review["version"] or digest(row) not in record_states.get((row["id"], row["version"]), set()):
                    fail("A linked evidence record is missing from the original case history.")
        for source in candidate["bindings"]["sources"]:
            current = context["sources"].get(source["id"])
            if not current or current["sha256"] != source["sha256"] or current["bytes"] != source["bytes"]:
                fail("An evidence source is missing from the complete case.")
        event = events[review["version"] - 1]
        if event.get("action") != "implementation.prepare" or event.get("recordId") != review["id"] or \
                event.get("after", {}).get("evidenceSha256") != candidate["previewSha256"] or \
                event.get("after", {}).get("businessSha256") != review["businessSha256"]:
            fail("The evidence review does not retain its original preparation event.")
    if {row.get("recordId") for row in events if row.get("action") == "implementation.prepare"} != ids:
        fail("The complete case is missing an original implementation evidence review.")


def completion_evidence(context, reviews, tranche, as_of):
    items, issues = [], []
    for review in reviews:
        validate_review(review)
        candidate = review["implementation"]
        binding = current_binding(context, candidate)
        items.append({"reviewId": review["id"], "previewSha256": candidate["previewSha256"],
                      "sourceCurrent": binding["current"], "ready": candidate["ready"],
                      "tranche": candidate["inputs"]["tranche"], "review": deepcopy(review)})
        reasons = []
        if not binding["current"]:
            reasons.append("The linked original delivery records or installation edition changed after this evidence review.")
        if candidate["inputs"]["tranche"] != tranche:
            reasons.append("The selected evidence review has not been assigned to this tranche.")
        if candidate["inputs"]["asOfAt"][:10] > as_of or review["createdAt"][:10] > as_of:
            reasons.append("The evidence review or observation cutoff follows this completion date.")
        if not candidate["ready"]:
            reasons.append("The selected evidence review retains unresolved current-versus-historical source findings.")
        for reason in reasons:
            issues.append({"code": "IMPLEMENTATION_EVIDENCE", "costId": None, "reviewId": review["id"], "message": reason})
    return items, issues


def _table(title, columns, rows):
    escape = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    header = "".join("<th>" + escape(label) + "</th>" for key, label in columns)
    body = "".join("<tr>" + "".join("<td>" + escape(canonical(row.get(key)) if isinstance(row.get(key), (dict, list)) else row.get(key)) + "</td>"
                                  for key, label in columns) + "</tr>" for row in rows)
    return "<h2>" + escape(title) + "</h2><table><thead><tr>" + header + "</tr></thead><tbody>" + body + "</tbody></table>"


def html_document(review):
    candidate = review["implementation"]
    escape = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    sections = [
        _table("Selected original observations", (("kind", "Kind"), ("id", "Original ID"), ("use", "Review use"),
                ("deploymentIds", "Deployments"), ("workIds", "Work"), ("purchaseIds", "Purchases"), ("outcomeIds", "Outcomes"), ("note", "Operator link")),
               candidate["inputs"]["selections"]),
        _table("Preserved source findings", (("code", "Finding"), ("kind", "Kind"), ("id", "Original ID"),
                ("message", "Observation"), ("blocking", "Needs review")), candidate["issues"]),
        _table("Original task measurements", (("id", "ID"), ("phase", "Phase"), ("observedAt", "Observed"),
                ("taskDefinition", "Task"), ("inputDescription", "Input"), ("outputDescription", "Output"),
                ("unit", "Unit"), ("units", "Quantity"), ("activeMinutes", "Active minutes"),
                ("elapsedMinutes", "Elapsed minutes"), ("manualCorrections", "Manual corrections"),
                ("actor", "Recorded by"), ("supersedesId", "Corrects")), candidate["native"]["state"]["measurements"]),
        _table("Original comparisons at the selected cutoff", (("measurementId", "Observation"), ("baselineId", "Baseline"),
                ("comparable", "Comparable"), ("sameVolume", "Same volume"), ("values", "Recorded total comparison"),
                ("perUnit", "Per-unit comparison"), ("reason", "Unresolved basis")), candidate["native"]["comparisons"]),
        _table("Technical and customer receiving", (("id", "ID"), ("kind", "Receiving kind"), ("outcome", "Recorded outcome"),
                ("observedAt", "Observed"), ("taskIds", "Original tasks"), ("materialIds", "Original files"),
                ("actor", "Receiver"), ("reference", "Reference"), ("notes", "Observation"),
                ("supersedesId", "Corrects")), candidate["native"]["state"]["receiving"]),
        _table("Observation effectiveness", (("id", "ID"), ("withinCutoff", "By cutoff"), ("activeEdition", "Selected edition"),
                ("subjectMatches", "Matches selected source definition"), ("supersededBy", "Corrected by cutoff"),
                ("currentSupersededBy", "Current correction"), ("effectiveTaskIds", "Effective selected tasks")),
               candidate["native"]["receivingStatus"])]
    page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + escape(candidate["inputs"]["name"]) + '</title><style>body{font:16px system-ui;max-width:1250px;margin:2rem auto;padding:0 1rem;color:#222}table{width:100%;border-collapse:collapse;font-size:.85rem}td,th{padding:.55rem;border:1px solid #bbb;text-align:left;vertical-align:top;overflow-wrap:anywhere}p,td{white-space:pre-wrap}small{color:#555}@media print{thead{display:table-header-group}tr{break-inside:avoid}body{max-width:none;font-size:11pt}}</style></head><body><h1>' + escape(candidate["inputs"]["name"]) + '</h1><p>' + escape(review["snapshot"]["program"]["name"]) + ' · ' + escape(review["snapshot"]["program"]["mode"]) + '</p><p>Observation cutoff: ' + escape(candidate["inputs"]["asOfAt"]) + '</p><p>' + escape(candidate["native"]["definitionBasis"]) + '</p><p>This is a review of original implementation evidence and explicit record associations. Technical receiving, customer receiving, work approval, purchase settlement and issuer acceptance retain their own original records. Missing measurements remain blank; recorded zero remains zero. No payment or external acceptance is created by this review.</p><p>Original source: ' + escape(candidate["inputs"]["sourceId"]) + ' · SHA-256 ' + escape(candidate["inputs"]["sourceSha256"]) + '</p><p>' + escape(candidate["inputs"]["note"]) + '</p>' + "".join(sections) + '<p>The complete frozen review, all linked original record snapshots, native reader identities, full source JSON and every embedded original file are included in this package. Producer receiving/report.html is the complete current-source report; this document records the chosen observation cutoff and evidence scope.</p><small>' + escape(review["id"]) + ' · ' + escape(review["createdAt"]) + ' · ' + escape(review["actor"]) + '</small></body></html>'
    return page.encode("utf-8")


def file_map(review, read_source):
    validate_review(review)
    candidate = review["implementation"]
    native = candidate["native"]
    source_id = candidate["inputs"]["sourceId"]
    metadata, source_raw = read_source(source_id)
    verify_projection(native, metadata, source_raw)
    files = {"implementation-review.json": (canonical(review) + "\n").encode("utf-8"),
             "implementation.html": html_document(review),
             "producer-receiving/report.html": native["originalReportHtml"].encode("utf-8"),
             "original-files.json": (canonical({"sourceId": source_id, "files": native["files"],
                "editions": native["state"]["editions"], "materials": native["state"]["materials"],
                "originalFiles": native["originalFiles"], "externalFileBindings": candidate["inputs"]["originalFileRefs"]}) + "\n").encode("utf-8")}
    for sha, raw in original_files(source_raw).items():
        files["original-files/" + sha] = raw
    bound_files = {row["sha256"]: row["sourceId"] for row in candidate["inputs"]["originalFileRefs"]}
    for original in native["externalFiles"]:
        sha = original["sha256"]
        if sha not in bound_files:
            fail("The frozen evidence retains an unavailable original source-bundle file: " + original["name"],
                 "IMPLEMENTATION_ORIGINAL_FILE_UNAVAILABLE", 409)
        actual, raw = read_source(bound_files[sha])
        if actual["sha256"] != sha or len(raw) != original["bytes"] or hashlib.sha256(raw).hexdigest() != sha:
            fail("The retained original source-bundle member changed.", "IMPLEMENTATION_ORIGINAL_FILE_CHANGED", 409)
        files["original-files/" + sha] = raw
    files["source-bundles.json"] = (canonical(native["sourceBundles"]) + "\n").encode("utf-8")
    for source in candidate["bindings"]["sources"]:
        actual, raw = read_source(source["id"])
        if actual["sha256"] != source["sha256"] or len(raw) != source["bytes"] or hashlib.sha256(raw).hexdigest() != source["sha256"]:
            fail("An original evidence source changed.", "IMPLEMENTATION_SOURCE_CHANGED", 409)
        files["sources/" + source["id"]] = raw
    for name, rows, columns in (
        ("links", candidate["inputs"]["selections"], ["kind", "id", "use", *LINKS, "note"]),
        ("tasks", native["state"]["tasks"], ["id", "editionId", "title", "acceptance", "owner", "dueOn", "status", "retired", "dependencies", "notes"]),
        ("receiving", native["state"]["receiving"], ["id", "editionId", "kind", "outcome", "observedAt", "recordedAt", "taskIds", "materialIds", "actor", "reference", "notes", "subjectSha256", "supersedesId"]),
        ("receiving-status", native["receivingStatus"], ["id", "withinCutoff", "activeEdition", "subjectMatches", "supersededBy", "currentSupersededBy", "latestTaskIds", "effectiveTaskIds"]),
        ("measurements", native["state"]["measurements"], ["id", "editionId", "phase", "comparisonKey", "taskDefinition", "inputDescription", "outputDescription", "unit", "units", "activeMinutes", "elapsedMinutes", "manualCorrections", "observedAt", "recordedAt", "actor", "materialIds", "reference", "notes", "supersedesId"]),
        ("measurement-status", native["measurementStatus"], ["id", "withinCutoff", "activeEdition", "supersededBy", "currentSupersededBy"]),
        ("comparisons", native["comparisons"], ["measurementId", "baselineId", "comparable", "sameVolume", "values", "perUnit", "reason"]),
        ("findings", candidate["issues"], ["code", "kind", "id", "message", "blocking"])):
        files[name + ".csv"] = csv_bytes(columns, [{key: canonical(value) if isinstance(value, (dict, list)) else value
                                                  for key, value in row.items()} for row in rows])
    return files


def review_files(review, read_source):
    files = file_map(review, read_source)
    manifest = {"schema": SCHEMA + ".bundle", "reviewId": review["id"],
                "previewSha256": review["implementation"]["previewSha256"],
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                          for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode("utf-8")
    if sum(map(len, files.values())) > MAX_BUNDLE:
        fail("The complete selected evidence package exceeds the original 32 MiB export bound.",
             "IMPLEMENTATION_EXPORT_SIZE", 413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_BUNDLE:
        fail("The compressed evidence package exceeds the supported bound.", "IMPLEMENTATION_EXPORT_SIZE", 413)
    return raw
