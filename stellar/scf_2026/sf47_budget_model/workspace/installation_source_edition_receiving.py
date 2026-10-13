"""Complete edition -> native preparation -> optional original case attachment.

The caller owns the existing Workspace/client and artifact publication. This
module starts no process, server or second store. Every mutation is completely
prepared before its first call and reuses the same original request on resume.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
from model import Problem, canonical, digest
from installation_source_desk_client import prepare_command, validate_operation
from operations_installation_sources import json_bytes
from operations_installation_source_editions import PLAN, unseal, same

COURSE = "stellar-forge.installation-source-edition-course.v1"
RESULT = "stellar-forge.installation-source-edition-receiving.v1"
MAPPING_COURSE = "stellar-forge.installation-source-mapping-course.v1"
MAPPING_RESULT = "stellar-forge.installation-source-mapping-receiving.v1"


def need(ok, message):
    if not ok:
        raise Problem(message, 422, "INSTALLATION_EDITION_COURSE_INVALID")


def preparation_id(draft_id, request_id, selection):
    raw_sha = hashlib.sha256(json_bytes(selection)).hexdigest()
    return "preparation-" + digest({"draft": draft_id, "requestId": request_id,
                                   "selectionSha256": raw_sha}), raw_sha


def prepare_course(client, plan, *, request_prefix, actor, note="", attach_version=None, mapping=False):
    """Freeze actual source/model/profile selections; write no business record."""
    if mapping:
        from operations_installation_mapping_reconciliation import verify_plan
        value = verify_plan(client.desk, client.case_id, client.draft_id, plan)["editionPlan"]
    else:
        value = unseal(plan, PLAN)
    need(value["caseId"] == client.case_id and value["target"]["draftId"] == client.draft_id,
         "Use this existing client's original target edition.")
    # Reproduce before creating the immutable course; apply repeats this under CAS.
    rebuilt = client.edition_preview({key: value[key] for key in ("source", "target", "files", "mapping")})
    need(same(rebuilt, value if mapping else plan), "The complete original edition preview differs.")
    selected = value["selection"]
    need(isinstance(selected, dict) and isinstance(selected.get("cases"), list) and selected["cases"],
         "Select a complete original customer mapping before preparing a native course.")
    catalogue = client.desk.profiles()
    engine = next((x["engine"] for x in catalogue["sourceFormats"] if x["schema"] == selected.get("schema")), None)
    need(engine is not None, "Select the original installed Workshare packet or saved-handover reader.")
    profiles = {x["id"]: x for x in catalogue["profiles"]}
    pins = {}
    for case in selected["cases"]:
        need(isinstance(case, dict) and case.get("profile") in profiles,
             "Select an installed complete profile for every actual customer.")
        pins[case["profile"]] = profiles[case["profile"]]["sha256"]
    need(isinstance(request_prefix, str) and 1 <= len(request_prefix) <= 80,
         "Keep one stable original request prefix of at most 80 characters.")
    revision = value["target"]["revision"]
    prepare = client.prepare_mapping if mapping else client.prepare_edition
    edition = prepare(plan, actor=actor, request_id=request_prefix + "-edition", note=note)
    native = prepare_command(client.case_id, client.draft_id,
        {"requestId": request_prefix + "-prepare", "expectedRevision": revision + 1,
         "actor": actor, "note": note, "action": "prepare", "data": {
             "expectedEngineSha256": engine["sha256"], "expectedSelectionSha256": digest(selected),
             "expectedProfiles": pins}}, workspace_directory=client.workspace_directory)
    ident, selection_sha = preparation_id(client.draft_id, native["request"]["requestId"], selected)
    attach = None
    if attach_version is not None:
        need(type(attach_version) is int and attach_version >= 0, "Select the actual original case version.")
        attach = prepare_command(client.case_id, client.draft_id,
            {"requestId": request_prefix + "-attach", "expectedRevision": revision + 2,
             "actor": actor, "note": note, "action": "attach", "data": {
                 "preparationId": ident, "expectedSelectionSha256": selection_sha,
                 "expectedVersion": attach_version}}, workspace_directory=client.workspace_directory)
    result = {"schema": MAPPING_COURSE if mapping else COURSE, "caseId": client.case_id, "draftId": client.draft_id,
              "source": deepcopy(value["source"]), "target": deepcopy(value["target"]),
              "preparationId": ident, "selectionSha256": selection_sha,
              "engine": deepcopy(engine), "profiles": [deepcopy(profiles[key]) for key in sorted(pins)],
              "operations": {"edition": edition, "prepare": native, "attach": attach}}
    result["sha256"] = digest(result)
    return validate_course(result, client)


def validate_course(course, client):
    need(isinstance(course, dict), "Retain the full original edition course.")
    value = deepcopy(course)
    sha = value.pop("sha256", None)
    need(set(value) == {"schema", "caseId", "draftId", "source", "target", "preparationId",
                        "selectionSha256", "engine", "profiles", "operations"}
         and value["schema"] in (COURSE, MAPPING_COURSE) and sha == digest(value)
         and value["caseId"] == client.case_id and value["draftId"] == client.draft_id,
         "The complete original edition course changed identity or target.")
    operations = value["operations"]
    need(isinstance(operations, dict) and set(operations) == {"edition", "prepare", "attach"},
         "Retain every selected original course operation.")
    verified = {}
    for key, operation in operations.items():
        if key == "attach" and operation is None:
            continue
        verified[key] = validate_operation(operation, case_id=client.case_id, draft_id=client.draft_id,
                                           workspace_directory=client.workspace_directory)
    edition, native = verified["edition"]["request"], verified["prepare"]["request"]
    mapping = value["schema"] == MAPPING_COURSE
    need(edition["action"] == ("mapping.apply" if mapping else "edition.apply") and set(edition["data"]) == {"plan"}
         and native["action"] == "prepare", "Use the original edition and preparation actions.")
    if mapping:
        from operations_installation_mapping_reconciliation import verify_plan
        plan = verify_plan(client.desk, client.case_id, client.draft_id,
                           edition["data"]["plan"])["editionPlan"]
    else:
        plan = unseal(edition["data"]["plan"], PLAN)
    need(same(plan["source"], value["source"]) and same(plan["target"], value["target"])
         and plan["caseId"] == client.case_id and plan["target"]["draftId"] == client.draft_id
         and edition["expectedRevision"] == value["target"]["revision"]
         and native["expectedRevision"] == edition["expectedRevision"] + 1,
         "Preserve the exact consecutive original draft selections.")
    ident, selection_sha = preparation_id(client.draft_id, native["requestId"], plan["selection"])
    need(ident == value["preparationId"] and selection_sha == value["selectionSha256"],
         "The native original preparation selection changed.")
    profiles = value["profiles"]
    need(isinstance(profiles, list) and all(isinstance(x, dict) for x in profiles)
         and len({x["id"] for x in profiles}) == len(profiles),
         "Retain the complete original selected profile records.")
    need(same(native["data"], {
        "expectedEngineSha256": value["engine"]["sha256"],
        "expectedSelectionSha256": digest(plan["selection"]),
        "expectedProfiles": {x["id"]: x["sha256"] for x in profiles}}),
        "Preserve the original complete reader, source and profile pins.")
    if "attach" in verified:
        attached = verified["attach"]["request"]
        need(attached["action"] == "attach" and attached["expectedRevision"] == edition["expectedRevision"] + 2
             and set(attached["data"]) == {"preparationId", "expectedSelectionSha256", "expectedVersion"}
             and attached["data"]["preparationId"] == ident
             and attached["data"]["expectedSelectionSha256"] == selection_sha,
             "Preserve the exact original complete cohort attachment.")
    need(value["target"]["revision"] + len(verified) <= 10000,
         "Keep every selected successor within the original draft revision capacity.")
    ids = [x["request"]["requestId"] for x in verified.values()]
    need(len(ids) == len(set(ids)), "Each different original command keeps a distinct stable request ID.")
    value["sha256"] = sha
    need(len(canonical(value).encode("utf-8")) <= 24 * 1024 * 1024,
         "Keep the complete selected course within its 24 MiB receiving bound.")
    return value


def execute_course(client, course):
    """Resume same original IDs; return full original records and every ZIP byte."""
    course = validate_course(course, client)
    operations = course["operations"]
    edition = client.execute(operations["edition"])
    native = client.execute(operations["prepare"])
    prepared = native.get("result")
    need(isinstance(prepared, dict) and prepared.get("state") == "PREPARED_SOURCE"
         and prepared.get("id") == course["preparationId"]
         and prepared.get("selectionSha256") == course["selectionSha256"],
         "The accepted original native preparation differs from the complete course.")
    attached = client.execute(operations["attach"]) if operations["attach"] else None
    # Read and verify every full native output and the actual complete export.
    full = client.desk.preparation(client.case_id, client.draft_id, course["preparationId"])
    need(same(full, prepared), "The complete original preparation changed after receipt.")
    outputs = []
    for file in full["files"]:
        metadata, raw = client.desk.output(client.case_id, client.draft_id, full["id"], file["filename"])
        need(same(metadata, file) and len(raw) == file["bytes"]
             and hashlib.sha256(raw).hexdigest() == file["sha256"],
             "An original full native preparation output changed.")
        outputs.append(deepcopy(metadata))
    archive = client.desk.export(client.case_id, client.draft_id, full["id"])
    with client.desk.workspace.mutex:
        head_before = client.read()
        replay = client.execute(operations["edition"])
        head_after = client.read()
        need(same(replay, edition) and same(head_before, head_after),
             "Original edition replay must preserve the current complete customer head.")
        accepted = attached or native
        historical = client.read(accepted["draft"]["revision"])
        need(same(historical, accepted["draft"]),
             "Reopen the exact accepted historical successor, preserving later customer revisions.")
    report = {"schema": MAPPING_RESULT if course["schema"] == MAPPING_COURSE else RESULT,
              "state": "COMPLETE", "courseSha256": course["sha256"],
              "caseId": client.case_id, "draftId": client.draft_id,
              "source": deepcopy(course["source"]), "target": deepcopy(course["target"]),
              "edition": edition, "preparation": native, "attachment": attached,
              "acceptedHistoricalDraft": historical,
              "originalRequestReplay": replay, "currentDraft": head_after,
              "outputs": outputs,
              "archive": {"filename": full["id"] + ".zip", "bytes": len(archive),
                          "sha256": hashlib.sha256(archive).hexdigest()}}
    report["sha256"] = digest(report)
    return report, archive


def verify_result(client, course, report, archive):
    """Adopt complete output only against all original recorded requests/files."""
    course = validate_course(course, client)
    need(isinstance(report, dict), "Keep the complete original receiving report.")
    body = deepcopy(report)
    sha = body.pop("sha256", None)
    need(set(body) == {"schema", "state", "courseSha256", "caseId", "draftId", "source", "target",
                       "edition", "preparation", "attachment", "acceptedHistoricalDraft",
                       "originalRequestReplay", "currentDraft", "outputs", "archive"}
         and body["schema"] == (MAPPING_RESULT if course["schema"] == MAPPING_COURSE else RESULT)
         and body["state"] == "COMPLETE" and digest(body) == sha
         and body["courseSha256"] == course["sha256"] and body["caseId"] == client.case_id
         and body["draftId"] == client.draft_id and same(body["source"], course["source"])
         and same(body["target"], course["target"]),
         "The complete receiving result differs from its original course.")
    with client.desk.workspace.mutex:
        receipts = {}
        for key, report_key in (("edition", "edition"), ("prepare", "preparation"), ("attach", "attachment")):
            operation = course["operations"][key]
            if operation is None:
                need(body[report_key] is None, "The original course did not select an attachment.")
                continue
            lookup = client.reconcile(operation)
            need(lookup["state"] == "RECORDED" and same(lookup["result"], body[report_key]),
                 "The complete result lacks its exact accepted original request receipt.")
            receipts[key] = lookup["result"]
        prepared = client.desk.preparation(client.case_id, client.draft_id, course["preparationId"])
        need(same(prepared, receipts["prepare"]["result"]) and same(body["outputs"], prepared["files"])
             and same(body["originalRequestReplay"], receipts["edition"]),
             "The complete original preparation or request replay changed.")
        accepted = receipts.get("attach", receipts["prepare"])["draft"]
        need(same(body["acceptedHistoricalDraft"], accepted)
             and type(body["currentDraft"].get("revision")) is int
             and body["currentDraft"]["revision"] >= accepted["revision"]
             and same(client.read(accepted["revision"]), accepted)
             and same(client.read(body["currentDraft"]["revision"]), body["currentDraft"]),
             "Reopen the exact retained historical editions without replacing the later customer head.")
        need(isinstance(archive, bytes) and len(archive) == body["archive"]["bytes"]
             and hashlib.sha256(archive).hexdigest() == body["archive"]["sha256"]
             and body["archive"]["filename"] == prepared["id"] + ".zip"
             and archive == client.desk.export(client.case_id, client.draft_id, prepared["id"]),
             "The complete original source/native receiving ZIP differs from its exact preparation.")
    return report
