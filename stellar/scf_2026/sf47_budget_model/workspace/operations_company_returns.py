"""Company-only returned packages in the original Grant Operations owner.

Read and compare complete original bytes here; native source.add, receiving
review, owner decisions and Installation save remain the existing commands.
"""
from __future__ import annotations
import base64
from copy import deepcopy
import hashlib
import re
from model import Problem
import operations_installations as installations
import operations_installation_returns as returns
from company_returns import customer_return as packages

SCHEMA = "stellar-forge.sf47-company-return-intake.v1"
MAX_PACKAGE = 8 * 1024 * 1024


def fail(message, code="INVALID_COMPANY_RETURN", status=422):
    raise Problem(message, status, code)


def fields(body, allowed):
    if not isinstance(body, dict) or set(body) - set(allowed):
        fail("Use the complete declared company-return selection.")
    return body


def sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        fail("Select the complete original package SHA-256.")
    return value


def unpack(raw, expected):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_PACKAGE:
        fail("Select one complete company return ZIP within the native 8 MiB source limit.",
             "COMPANY_RETURN_SIZE", 413)
    try:
        # The maintained reader verifies every member, original report, exact
        # returned JSON, predecessor and independently reconstructed comparison.
        return packages.read_return(raw, sha(expected))
    except (packages.R.ReportError, KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, Problem):
            raise
        fail(str(exc))


def original(ops, context, selected):
    binding = selected["returned"]["binding"]
    baseline = returns.selected_baseline(ops, context, {
        "installationId": binding["installation_id"], "revision": binding["revision"],
        "sha256": binding["native_installation_sha256"]})
    if not packages.R.equal(baseline["preview"]["document"], selected["report"]["document"]):
        fail("The company report differs from this case's complete original saved Installation.",
             "COMPANY_RETURN_BASELINE", 409)
    # Compare the complete immutable native document, not the display-only
    # current flag supplied by a later case read.
    return baseline


def description(context, selected, baseline, raw, source_id=None):
    submission = packages.submission(raw, hashlib.sha256(raw).hexdigest(), source_id)
    return {
        "schema": SCHEMA, "caseId": context["program"]["id"],
        "source": installations._source(context),
        "package": {"sha256": submission["archive_sha256"], "bytes": len(raw),
                    "manifestSha256": hashlib.sha256(selected["archive"].read("manifest.json")).hexdigest(),
                    "returnId": submission["return_id"],
                    "reportSha256": submission["report_sha256"],
                    "returnedJsonSha256": submission["returned_json_sha256"],
                    "previousReturnSha256": selected["returned"]["previous_return_sha256"],
                    "binding": deepcopy(submission["binding"]),
                    "members": [{"path": name, "bytes": len(selected["archive"].read(name)),
                                 "sha256": hashlib.sha256(selected["archive"].read(name)).hexdigest()}
                                for name in sorted(selected["archive"].entries)]},
        "baseline": returns.ref(baseline), "baselineName": baseline["preview"]["document"]["name"],
        "checks": [{key: deepcopy(check[key]) for key in returns.DEFINITION_KEYS}
                   for check in baseline["preview"]["document"]["checks"]],
        "inputs": deepcopy(submission["inputs"]), "comparison": deepcopy(submission["comparison"]),
        "returnedSource": deepcopy(submission["source"]),
        "sourceLinkPolicy": submission["source_link_policy"],
        "state": "PROPOSED_FOR_NATIVE_OWNER_REVIEW",
    }


def inspect_package(ops, context, body):
    fields(body, ("expectedVersion", "archiveBase64", "archiveSourceId", "archiveSha256"))
    installations._current(context, body.get("expectedVersion"))
    retained = None
    if ("archiveBase64" in body) == ("archiveSourceId" in body):
        fail("Select either complete package bytes or one retained package source.")
    if "archiveSourceId" in body:
        source_id = body["archiveSourceId"]
        if not isinstance(source_id, str) or not re.fullmatch(r"source-[a-f0-9]{32}", source_id):
            fail("Select the actual retained package source.")
        retained, raw = ops.source(context["program"]["id"], source_id)
    else:
        encoded = body.get("archiveBase64")
        if not isinstance(encoded, str) or len(encoded) > ((MAX_PACKAGE + 2) // 3) * 4:
            fail("Select the complete bounded company return ZIP.", "COMPANY_RETURN_SIZE", 413)
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise Problem("The original package encoding is invalid.", 422, "INVALID_COMPANY_RETURN") from exc
    selected = unpack(raw, body.get("archiveSha256"))
    baseline = original(ops, context, selected)
    result = description(context, selected, baseline, raw)
    result["retainedArchive"] = deepcopy(retained)
    # A cold received case retains these originals as ordinary source records.
    # Offer exact-byte matches for explicit selection, never infer acceptance.
    result["returnedSourceCandidates"] = []
    expected_raw = selected["files"]["RETURN.json"]
    expected_sha = hashlib.sha256(expected_raw).hexdigest()
    for metadata in context["sources"].values():
        if metadata["sha256"] == expected_sha and metadata["bytes"] == len(expected_raw):
            actual, candidate = ops.source(context["program"]["id"], metadata["id"])
            if candidate == expected_raw:
                result["returnedSourceCandidates"].append(deepcopy(actual))
    return result


def linked_package(ops, context, body):
    fields(body, ("expectedVersion", "archiveSourceId", "returnSourceId", "archiveSha256"))
    installations._current(context, body.get("expectedVersion"))
    for key in ("archiveSourceId", "returnSourceId"):
        if not isinstance(body.get(key), str) or not re.fullmatch(r"source-[a-f0-9]{32}", body[key]):
            fail("Select the actual retained original source identities.")
    archive_metadata, raw = ops.source(context["program"]["id"], body["archiveSourceId"])
    selected = unpack(raw, body.get("archiveSha256"))
    baseline = original(ops, context, selected)
    returned_metadata, returned_raw = ops.source(context["program"]["id"], body["returnSourceId"])
    expected_raw = selected["files"]["RETURN.json"]
    if returned_raw != expected_raw or returned_metadata["sha256"] != hashlib.sha256(expected_raw).hexdigest():
        fail("The retained returned JSON differs from the exact company package.",
             "COMPANY_RETURN_SOURCE_CHANGED", 409)
    if archive_metadata["sha256"] != hashlib.sha256(raw).hexdigest():
        fail("The retained package source differs.", "COMPANY_RETURN_SOURCE_CHANGED", 409)
    result = description(context, selected, baseline, raw, body["returnSourceId"])
    # Validate the linked proposal through the original native normalizer. It
    # also orders every observation against its original definition roster.
    native = returns.evaluate_return(context, baseline, result["inputs"])
    result["inputs"] = deepcopy(native["inputs"])
    result["nativePreview"] = native
    result["retainedSources"] = {"archive": deepcopy(archive_metadata), "returnedJson": deepcopy(returned_metadata)}
    return result
