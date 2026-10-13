"""Receive a retained merchant commissioning capture in its original Installation.

The existing Source Desk owns uploads, the Operations transaction and request
replay. This module verifies the complete original files and appends reviewed
source references through the original source and Installation writers.
"""
from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import json
import re

from model import Problem, digest
import operations_installations as installations
import operations_workshare_installations as workshares

SCHEMA = "stellar-forge.installation-commissioning-receiving.v1"
CAPTURE = "stellar-forge.commissioning-collections-capture.v1"
MANIFEST = "stellar-forge.commissioning-collections-manifest.v1"
REVIEW = "stellar-forge.commissioning-collections-review.v1"
SOURCE = "stellar-forge.commissioning-workshares.v1"
REQUIRED = ("commissioning-capture.json", "commissioning-manifest.json",
            "commissioning-review.json", "commissioning-source.json", "original-workshares.json")
REPORTS = ("commissioning-review.json", "commissioning-projects.csv",
           "commissioning-milestones.csv", "commissioning-cash.csv",
           "commissioning-findings.csv", "commissioning-handover.html")
SNAPSHOT = "commissioning-account-snapshot.json"
SHA = re.compile(r"[a-f0-9]{64}")
INSPECT_FIELDS = ("expectedRevision", "captureFileId", "fileIds")
SELECTION_FIELDS = ("captureFileId", "fileIds", "expectedVersion", "projectId",
                    "installationId", "expectedInstallationRevision",
                    "milestonePhases", "includeAccountSnapshot")
COPY_FIELDS = ("schema", "id", "sourceId", "sourceSha256", "label", "asOf",
               "createdAt", "actor", "workspaceId", "projectIds", "customerIds",
               "xeroCycleIds", "baselineCaptureId", "previewSha256",
               "sourceFingerprint", "status", "counts")


def fail(message, code="INSTALLATION_COMMISSIONING_INVALID", status=422):
    raise Problem(message, status, code)


def need(condition, message, code="INSTALLATION_COMMISSIONING_INVALID", status=422):
    if not condition:
        fail(message, code, status)


def exact(value, allowed, required=()):
    need(isinstance(value, dict) and not set(value) - set(allowed)
         and set(required) <= set(value), "Use the complete original commissioning receiving fields.")
    return value


def whole(value, label, minimum=0, maximum=10000000):
    need(isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum,
         "Use the original whole " + label + ".")
    return value


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def object_json(raw, label):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, "The original " + label + " repeats a JSON field.")
            result[key] = value
        return result
    def invalid(value):
        fail("The original " + label + " has an invalid JSON numeric token: " + value)
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique, parse_constant=invalid)
    except (ValueError, UnicodeError) as error:
        raise Problem("Retain the complete original " + label + " JSON.", 422,
                      "INSTALLATION_COMMISSIONING_JSON") from error
    need(isinstance(value, dict), "Retain the complete original " + label + " object.")
    return value


def _state(desk, case_id, draft_id, expected):
    state = desk._state(case_id, draft_id)
    whole(expected, "source draft revision", 1, 10000)
    need(state["revision"] == expected, "The original source draft changed. Reopen its current edition.",
         "INSTALLATION_SOURCE_CONFLICT", 409)
    return state


def _bundle(desk, state, value):
    selected = value.get("fileIds")
    need(isinstance(selected, list) and 5 <= len(selected) <= 200
         and all(isinstance(item, str) for item in selected)
         and len(set(selected)) == len(selected),
         "Select the complete original capture and each report or source file once.")
    by_id = {row["id"]: row for row in state["files"]}
    need(all(ident in by_id for ident in selected), "Keep every selected file in this original source draft.",
         "INSTALLATION_SOURCE_CHANGED", 409)
    capture_id = value.get("captureFileId")
    need(capture_id in selected, "Select the original commissioning-capture.json file.")
    metadata = [deepcopy(by_id[ident]) for ident in sorted(selected)]
    bodies = {row["filename"]: desk._blob(state["caseId"], state["id"], row["sha256"]) for row in metadata}
    return verify_bundle(metadata, bodies, capture_id)


def verify_bundle(metadata, bodies, capture_id):
    """Verify original capture members, preserving any retained archive member name."""
    by_id = {row["id"]: row for row in metadata}
    by_name = {row.get("originalMemberName", row["filename"]): row for row in metadata}
    need(len(by_name) == len(metadata) and len(by_id) == len(metadata),
         "Select one complete original file for each receiving filename.")
    need(all(name in by_name for name in REQUIRED),
         "Include commissioning-capture.json, commissioning-manifest.json, commissioning-review.json, "
         "commissioning-source.json and original-workshares.json.")
    need(capture_id in by_id and by_id[capture_id].get("originalMemberName", by_id[capture_id]["filename"]) ==
         "commissioning-capture.json", "The capture selector must name the original commissioning-capture.json.")
    for row in metadata:
        raw = bodies.get(row["filename"])
        need(isinstance(raw, bytes) and len(raw) == row["bytes"] and sha(raw) == row["sha256"],
             "A complete original file differs from its retained byte identity.", "INSTALLATION_SOURCE_CHANGED", 409)
    capture = object_json(bodies[by_name["commissioning-capture.json"]["filename"]], "saved capture")
    manifest = object_json(bodies[by_name["commissioning-manifest.json"]["filename"]], "capture manifest")
    review = object_json(bodies[by_name["commissioning-review.json"]["filename"]], "commissioning review")
    source = object_json(bodies[by_name["commissioning-source.json"]["filename"]], "workshare normalization")
    need(capture.get("schema") == CAPTURE and manifest.get("schema") == MANIFEST
         and review.get("schema") == REVIEW and source.get("schema") == SOURCE,
         "Select complete files from the original merchant commissioning product.")
    need(isinstance(manifest.get("capture"), dict)
         and all(capture.get(key) == manifest["capture"].get(key) for key in COPY_FIELDS),
         "The original capture and manifest select different saved records.", "INSTALLATION_COMMISSIONING_CHANGED", 409)
    need(isinstance(manifest.get("files"), list) and all(isinstance(row, dict) for row in manifest["files"]),
         "Retain the original complete capture file inventory.")
    descriptors = {row.get("name"): row for row in manifest["files"]}
    need(len(descriptors) == len(manifest["files"]) and all(isinstance(name, str) for name in descriptors),
         "The original capture manifest repeats or omits a filename.")
    for name, record in by_name.items():
        if name == "commissioning-manifest.json":
            continue
        descriptor = descriptors.get(name)
        need(descriptor is not None and descriptor.get("sha256") == record["sha256"]
             and descriptor.get("bytes") == record["bytes"],
             "The selected complete file differs from the saved capture manifest: " + name,
             "INSTALLATION_COMMISSIONING_CHANGED", 409)
    need(isinstance(capture.get("id"), str) and isinstance(capture.get("workspaceId"), str)
         and SHA.fullmatch(capture.get("previewSha256", "")) is not None
         and SHA.fullmatch(capture.get("sourceSha256", "")) is not None
         and SHA.fullmatch(capture.get("sourceFingerprint", "")) is not None,
         "Retain the original saved capture, workspace and full source identities.")
    need(review.get("previewSha256") == capture["previewSha256"]
         and review.get("sourceFingerprint") == capture["sourceFingerprint"]
         and review.get("workspaceId") == capture["workspaceId"]
         and review.get("asOf") == capture.get("asOf")
         and review.get("selection") == capture.get("selection"),
         "The saved review and capture disagree on original source, date or selection.",
         "INSTALLATION_COMMISSIONING_CHANGED", 409)
    original = bodies[by_name["original-workshares.json"]["filename"]]
    need(isinstance(source.get("file"), dict)
         and source["file"].get("sha256") == capture["sourceSha256"]
         and source["file"].get("bytes") == len(original)
         and sha(original) == capture["sourceSha256"]
         and isinstance(review.get("source"), dict)
         and review["source"].get("sha256") == capture["sourceSha256"],
         "The complete original Workshare bytes differ from the capture source.",
         "INSTALLATION_COMMISSIONING_CHANGED", 409)
    need(isinstance(source.get("projects"), list) and isinstance(review.get("projects"), list)
         and isinstance(capture.get("selection"), dict)
         and isinstance(capture.get("projectIds"), list),
         "Retain the complete captured project and milestone populations.")
    projects = {row.get("id"): row for row in source["projects"] if isinstance(row, dict)}
    reviewed = {row.get("projectId"): row for row in review["projects"] if isinstance(row, dict)}
    need(len(projects) == len(source["projects"]) and len(reviewed) == len(review["projects"])
         and len(set(capture["projectIds"])) == len(capture["projectIds"])
         and set(capture["projectIds"]) == set(reviewed)
         and set(reviewed) <= set(projects),
         "Keep each selected original project once in this complete capture.")
    for row in metadata:
        descriptor = descriptors.get(row.get("originalMemberName", row["filename"]), {})
        row["originalRole"] = descriptor.get("role", row.get("originalRole"))
        row["originalType"] = descriptor.get("type", row.get("originalType"))
        row["containsCompleteAccount"] = row.get("originalMemberName", row["filename"]) == SNAPSHOT
    return {"capture": capture, "review": review, "source": source, "manifest": manifest,
            "projects": projects, "reviewed": reviewed, "files": metadata, "bodies": bodies,
            "captureFileSha256": by_name["commissioning-capture.json"]["sha256"],
            "manifestSha256": by_name["commissioning-manifest.json"]["sha256"],
            "reviewFileSha256": by_name["commissioning-review.json"]["sha256"]}


def _capture_view(bundle):
    value = {key: deepcopy(bundle["capture"].get(key)) for key in COPY_FIELDS}
    value.update({key: bundle[key] for key in ("captureFileSha256", "manifestSha256", "reviewFileSha256")})
    return value


def _installation_view(row):
    document = row["preview"]["document"]
    binding = document.get("workshare")
    return {**installations.summary(row), "workshare": deepcopy(binding),
            "checks": deepcopy(document["checks"]),
            "receiving": deepcopy(document["receiving"]),
            "payment": deepcopy(document["payment"])}


def inspect(desk, case_id, draft_id, body):
    exact(body, INSPECT_FIELDS, INSPECT_FIELDS)
    with desk.workspace.mutex:
        state = _state(desk, case_id, draft_id, body["expectedRevision"])
        bundle = _bundle(desk, state, body)
        context = desk.ops._context(case_id)
        return {"schema": SCHEMA, "caseId": case_id, "draftId": draft_id,
                "draftRevision": state["revision"], "version": context["program"]["version"],
                "capture": _capture_view(bundle), "files": deepcopy(bundle["files"]),
                "projects": [{"id": ident, "name": bundle["projects"][ident].get("name"),
                              "caseId": bundle["projects"][ident].get("caseId"),
                              "currency": deepcopy(bundle["projects"][ident].get("currency")),
                              "customerId": bundle["reviewed"][ident].get("customerId"),
                              "milestones": deepcopy(bundle["reviewed"][ident].get("milestones", [])),
                              "totals": deepcopy(bundle["reviewed"][ident].get("totals", {}))}
                             for ident in bundle["capture"]["projectIds"]],
                "installations": [_installation_view(row) for row in installations.load_heads(desk.ops, case_id)
                                  if row["preview"]["document"].get("workshare")],
                "optionalReports": [name for name in REPORTS if name not in bundle["bodies"]],
                "scope": "PRIVATE_CAPTURE_FILES",
                "containsCompleteAccount": SNAPSHOT in bundle["bodies"]}


def _preview(desk, state, body):
    exact(body, SELECTION_FIELDS, SELECTION_FIELDS)
    context = desk.ops._context(state["caseId"])
    expected = whole(body["expectedVersion"], "Operations case version", 1)
    need(context["program"]["version"] == expected, "The original case changed. Review its current edition.",
         "OPERATIONS_CONFLICT", 409)
    bundle = _bundle(desk, state, body)
    include = body["includeAccountSnapshot"]
    need(isinstance(include, bool), "Explicitly choose whether the complete private account snapshot is included.")
    need(SNAPSHOT not in bundle["bodies"] or include,
         "The complete account snapshot includes every retained customer and receivables record. "
         "Select includeAccountSnapshot:true to attach those private original bytes.")
    row = installations.get(desk.ops, state["caseId"], body["installationId"])
    expected_installation = whole(body["expectedInstallationRevision"], "Installation edition", 1)
    need(row["revision"] == expected_installation, "The original Installation changed. Reopen its current edition.",
         "INSTALLATION_CONFLICT", 409)
    document = row["preview"]["document"]
    need(isinstance(document.get("workshare"), dict),
         "Select an existing Installation joined to its complete original Workshare.")
    original = workshares.verify_document(desk.ops, context, document)
    ident = body["projectId"]
    need(isinstance(ident, str) and ident in bundle["reviewed"],
         "Select one project retained in this original saved commissioning capture.")
    project, reviewed = bundle["projects"][ident], bundle["reviewed"][ident]
    case = document["workshare"]["caseId"]
    need(project.get("caseId") == case and reviewed.get("sourceCaseId") == case,
         "The capture's original project case identity must equal this Installation's original Workshare case.",
         "INSTALLATION_COMMISSIONING_CASE", 409)
    need(reviewed.get("currency") == project.get("currency"),
         "The original project currency differs between normalization and saved review.")
    phases = {phase["id"]: phase for phase in original["workshare"]["plan"]["phases"]}
    checks = {check["id"]: check for check in document["checks"]}
    phase_checks = {pair["phaseId"]: pair["checkId"] for pair in document["workshare"]["phaseChecks"]}
    milestones = {item.get("index"): item for item in reviewed.get("milestones", [])}
    pairs = body["milestonePhases"]
    need(isinstance(pairs, list) and 0 < len(pairs) <= 4000,
         "Map the selected original milestone evidence to one or more original Workshare phases.")
    selected_pairs, pair_keys = [], set()
    for pair in pairs:
        exact(pair, ("milestoneIndex", "phaseId"), ("milestoneIndex", "phaseId"))
        index = whole(pair["milestoneIndex"], "original milestone index", 0, 39)
        phase_id = pair["phaseId"]
        need(index in milestones and isinstance(phase_id, str) and phase_id in phases,
             "Select the original captured milestone and original Workshare phase.")
        need((index, phase_id) not in pair_keys, "Keep each milestone-to-phase association once.")
        pair_keys.add((index, phase_id))
        check = checks[phase_checks[phase_id]]
        selected_pairs.append({"milestoneIndex": index, "phaseId": phase_id,
                               "checkId": check["id"], "phase": deepcopy(phases[phase_id]),
                               "check": deepcopy(check), "milestone": deepcopy(milestones[index])})
    selected_pairs.sort(key=lambda item: (item["milestoneIndex"], item["phaseId"]))
    # Retain the exact cross-product association as an original case source too.
    # Original case/Installation exports therefore carry the milestone-to-phase
    # mapping even when the private Source Desk draft is not exported.
    link = {"schema": SCHEMA, "kind": "REVIEWED_CAPTURE_PHASE_BINDING",
            "caseId": state["caseId"], "draftId": state["id"], "draftRevision": state["revision"],
            "capture": _capture_view(bundle), "projectId": ident,
            "workshare": deepcopy(document["workshare"]),
            "installation": {"id": row["id"], "revision": row["revision"], "sha256": row["sha256"]},
            "milestonePhases": selected_pairs,
            "sources": deepcopy(bundle["files"]),
            "includeAccountSnapshot": include}
    link_bytes = (json.dumps(link, ensure_ascii=False, sort_keys=True, indent=2,
                            allow_nan=False) + "\n").encode("utf-8")
    need(len(link_bytes) <= 8 * 1024 * 1024,
         "The complete reviewed phase association exceeds the original case source limit.", status=413)
    link_sha = sha(link_bytes)
    link_name = "Commissioning_Receiving_" + link_sha + ".json"
    need(link_name not in bundle["bodies"], "Keep the derived receiving link distinct from its original files.")
    origin = next(file for file in bundle["files"] if file["id"] == body["captureFileId"])
    link_file = {"id": None, "filename": link_name, "bytes": len(link_bytes), "sha256": link_sha,
                 "mediaType": "application/json", "sourceUrl": origin["sourceUrl"],
                 "observedAt": origin["observedAt"], "originalRole": "reviewed-commissioning-phase-binding",
                 "originalType": "application/json", "containsCompleteAccount": False, "generated": True}
    bundle["bodies"][link_name] = link_bytes
    selected_files, missing = [], []
    for file in [*bundle["files"], link_file]:
        existing = next((record for record in context["sources"].values()
                         if all(record.get(key) == file[key] for key in
                                ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt"))), None)
        if existing:
            _, raw = desk.ops.source(state["caseId"], existing["id"])
            need(raw == bundle["bodies"][file["filename"]],
                 "The existing case source differs from these complete original bytes.",
                 "SOURCE_CHANGED", 409)
        else:
            missing.append(file)
        selected_files.append({**deepcopy(file), "reusedSourceId": existing["id"] if existing else None})
    need(sum(file["bytes"] for file in context["sources"].values()) + sum(file["bytes"] for file in missing)
         <= 24 * 1024 * 1024 and len(context["sources"]) + len(missing) <= 200,
         "The complete selected capture files exceed this original case's 24 MiB / 200-source capacity. "
         "Select complete individual reports rather than the full private account archive.",
         "INSTALLATION_SOURCE_CASE_CAPACITY", 413)
    selection = {key: deepcopy(body[key]) for key in SELECTION_FIELDS}
    selection["fileIds"] = sorted(selection["fileIds"])
    selection["milestonePhases"] = [{"milestoneIndex": item["milestoneIndex"], "phaseId": item["phaseId"]}
                                   for item in selected_pairs]
    findings = [{"code": "COMMISSIONING_REPORT_UNSELECTED", "file": name,
                 "message": "This complete original report is available in the saved merchant capture but is not selected."}
                for name in REPORTS if name not in bundle["bodies"]]
    for finding in bundle["review"].get("findings", []):
        if not isinstance(finding, dict) or finding.get("projectId") not in (None, ident):
            continue
        findings.append({"code": "ORIGINAL_COMMISSIONING_FINDING", "original": deepcopy(finding)})
    preview = {"schema": SCHEMA, "caseId": state["caseId"], "draftId": state["id"],
               "draftRevision": state["revision"], "selection": selection,
               "capture": _capture_view(bundle), "project": deepcopy(reviewed),
               "installation": _installation_view(row),
               "workshare": {"caseId": case, "planSha256": document["workshare"]["planSha256"],
                             "binding": deepcopy(document["workshare"])},
               "milestonePhases": selected_pairs, "sources": selected_files,
               "newBytes": sum(file["bytes"] for file in missing), "newSourceCount": len(missing),
               "findings": findings, "scope": "PRIVATE_COMPLETE_ACCOUNT" if SNAPSHOT in bundle["bodies"] else "PRIVATE_CAPTURE_FILES",
               "changes": {"receivingSourceReferences": True,
                           "phaseSourceReferences": sorted({item["checkId"] for item in selected_pairs}),
                           "acceptanceObservations": "PRESERVED", "paymentSelections": "PRESERVED",
                           "commercialWorkshare": "PRESERVED"}}
    preview["previewSha256"] = digest(preview)
    return preview, bundle, row


def preview(desk, case_id, draft_id, body):
    exact(body, ("expectedRevision", *SELECTION_FIELDS), ("expectedRevision", *SELECTION_FIELDS))
    with desk.workspace.mutex:
        state = _state(desk, case_id, draft_id, body["expectedRevision"])
        return _preview(desk, state, {key: body[key] for key in SELECTION_FIELDS})[0]


def _preserved(before, after):
    value = deepcopy(after)
    value["receiving"]["sourceIds"] = deepcopy(before["receiving"]["sourceIds"])
    originals = {check["id"]: check for check in before["checks"]}
    for check in value["checks"]:
        need(check["id"] in originals, "Keep the original Installation check population.")
        check["sourceIds"] = deepcopy(originals[check["id"]]["sourceIds"])
    need(value == before, "Receiving must preserve every original acceptance observation, actual date, "
         "payment selection, phase criterion and commercial term.",
         "INSTALLATION_COMMISSIONING_OBSERVATION_CHANGED", 409)


def attach(desk, state, context, data):
    exact(data, (*SELECTION_FIELDS, "expectedPreviewSha256"), (*SELECTION_FIELDS, "expectedPreviewSha256"))
    view, bundle, installation = _preview(desk, state, {key: data[key] for key in SELECTION_FIELDS})
    need(SHA.fullmatch(data["expectedPreviewSha256"] or "") is not None
         and view["previewSha256"] == data["expectedPreviewSha256"],
         "The original capture, selected phase mapping or case changed. Review the current receiving plan.",
         "INSTALLATION_COMMISSIONING_REVIEW_CHANGED", 409)
    expected = view["selection"]["expectedVersion"]
    selected = []
    for file in view["sources"]:
        source_id = file["reusedSourceId"]
        if source_id is None:
            result = desk.ops.command(state["caseId"], {
                "expectedVersion": expected, "actor": context["actor"], "note": context["note"],
                "action": "source.add", "requestId": context["requestId"],
                "data": {key: file[key] for key in ("filename", "mediaType", "sourceUrl", "observedAt")} |
                        {"kind": "other", "contentBase64": base64.b64encode(
                            bundle["bodies"][file["filename"]]).decode("ascii")}}, _within_transaction=True)
            expected, source_id = result["version"], result["recordId"]
        metadata, raw = desk.ops.source(state["caseId"], source_id)
        need(len(raw) == file["bytes"] and sha(raw) == file["sha256"],
             "The original source writer returned a different complete file.", "SOURCE_CHANGED", 409)
        selected.append({**deepcopy(file), "sourceId": source_id, "reused": file["reusedSourceId"] is not None})
    original_document = installation["preview"]["document"]
    document = deepcopy(original_document)
    source_ids = [file["sourceId"] for file in selected]
    document["receiving"]["sourceIds"] = list(dict.fromkeys([*document["receiving"]["sourceIds"], *source_ids]))
    selected_checks = {pair["checkId"] for pair in view["milestonePhases"]}
    for check in document["checks"]:
        if check["id"] in selected_checks:
            check["sourceIds"] = list(dict.fromkeys([*check["sourceIds"], *source_ids]))
    _preserved(original_document, document)
    current = desk.ops._context(state["caseId"])
    native = installations.preview(desk.ops, current, {
        "expectedVersion": expected, "installationId": installation["id"],
        "expectedRevision": installation["revision"], "document": document})
    _preserved(original_document, native["document"])
    result = desk.ops.command(state["caseId"], {
        "expectedVersion": expected, "actor": context["actor"], "note": context["note"],
        "action": "installation.save", "requestId": context["requestId"],
        "data": {"installationId": installation["id"], "expectedRevision": installation["revision"],
                 "document": native["document"], "expectedPreviewSha256": native["previewSha256"]}},
        _within_transaction=True)
    saved = installations.get(desk.ops, state["caseId"], installation["id"], result["revision"])
    _preserved(original_document, saved["preview"]["document"])
    receipt = {"schema": SCHEMA, "state": "ATTACHED_COMMISSIONING",
               "caseId": state["caseId"], "draftId": state["id"],
               "version": result["version"], "previewSha256": view["previewSha256"],
               "capture": view["capture"], "projectId": data["projectId"],
               "workshare": view["workshare"], "selection": view["selection"],
               "milestonePhases": deepcopy(view["milestonePhases"]),
               "sources": selected, "scope": view["scope"], "findings": view["findings"],
               "installation": {"id": saved["id"], "revision": saved["revision"],
                                "sha256": saved["sha256"], "version": saved["version"]},
               "preserved": {"acceptanceObservations": True, "paymentSelections": True,
                             "commercialWorkshare": True}}
    state["attachments"].append(deepcopy(receipt))
    return receipt


def verify_receipt(desk, receipt):
    need(receipt.get("schema") == SCHEMA and receipt.get("state") == "ATTACHED_COMMISSIONING",
         "Keep the original complete commissioning attachment receipt.")
    for file in receipt["sources"]:
        metadata, raw = desk.ops.source(receipt["caseId"], file["sourceId"])
        need(len(raw) == file["bytes"] and sha(raw) == file["sha256"]
             and all(metadata.get(key) == file[key] for key in
                     ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt")),
             "An attached original commissioning file changed.", "SOURCE_CHANGED", 409)
    selected = receipt["installation"]
    row = installations.get(desk.ops, receipt["caseId"], selected["id"], selected["revision"])
    need(row["sha256"] == selected["sha256"] and row["version"] == selected["version"],
         "The saved original Installation edition differs from its receiving receipt.",
         "INSTALLATION_COMMISSIONING_CHANGED", 409)
    return receipt
