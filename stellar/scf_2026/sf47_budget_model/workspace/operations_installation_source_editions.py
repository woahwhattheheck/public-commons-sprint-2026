"""Customer editions over the original Source Desk revisions and byte store.

This module opens no database, file, worker or native preparation. All reads and
writes borrow SourceDesk's original mutex/transaction. A saved edition is an
editable source draft; the existing native preparation remains authoritative.
"""
from __future__ import annotations

from copy import deepcopy
from model import Problem, canonical, digest

COMPARISON = "stellar-forge.installation-source-edition-comparison.v1"
PLAN = "stellar-forge.installation-source-edition-plan.v1"
TRANSITION = "stellar-forge.installation-source-edition-transition.v1"
MAX_SELECTED = 64 * 1024 * 1024
MAX_SELECTION = 8 * 1024 * 1024
MAX_PLAN = 12 * 1024 * 1024


def need(ok, message, code="INSTALLATION_EDITION_INVALID", status=422):
    if not ok:
        raise Problem(message, status, code)


def exact(value, keys, label):
    need(isinstance(value, dict) and set(value) == set(keys),
         "Keep all and only the declared " + label + " fields.")
    return value


def same(a, b):
    # JSON true and integer 1 must remain different original values.
    return canonical(a) == canonical(b)


def seal(value):
    return {**value, "sha256": digest(value)}


def unseal(value, schema):
    need(isinstance(value, dict) and value.get("schema") == schema,
         "Select the complete original edition " + schema + ".")
    result = deepcopy(value)
    given = result.pop("sha256", None)
    need(isinstance(given, str) and given == digest(result),
         "The complete edition object differs from its SHA-256.",
         "INSTALLATION_EDITION_CHANGED", 409)
    return result


def reference(state):
    return {"draftId": state["id"], "revision": state["revision"], "sha256": digest(state)}


def revision(value):
    need(type(value) is int and 1 <= value <= 10000,
         "Select an actual retained source draft revision.")
    return value


def pinned(desk, case_id, value, *, hashed=True):
    exact(value, ("draftId", "revision", "sha256") if hashed else ("draftId", "revision"),
          "original draft reference")
    state = desk.get(case_id, value["draftId"], revision(value["revision"]))
    if hashed:
        need(value["sha256"] == digest(state), "The selected complete source edition changed.",
             "INSTALLATION_EDITION_CHANGED", 409)
    return state


def changes(before, after):
    """Complete JSON-pointer changes; absent, null, zero and false stay distinct."""
    result, stack = [], [("", True, before, True, after)]
    while stack:
        path, bp, b, ap, a = stack.pop()
        if bp and ap and same(b, a):
            continue
        if bp and ap and isinstance(b, dict) and isinstance(a, dict):
            for key in reversed(sorted(set(b) | set(a))):
                pointer = path + "/" + key.replace("~", "~0").replace("/", "~1")
                stack.append((pointer, key in b, b.get(key), key in a, a.get(key)))
        elif bp and ap and isinstance(b, list) and isinstance(a, list):
            for index in reversed(range(max(len(b), len(a)))):
                stack.append((path + "/" + str(index), index < len(b),
                              b[index] if index < len(b) else None, index < len(a),
                              a[index] if index < len(a) else None))
        else:
            result.append({"pointer": path, "beforePresent": bp, "afterPresent": ap,
                           "before": deepcopy(b), "after": deepcopy(a)})
    return result


def file_changes(before, after):
    left, right = {x["filename"]: x for x in before}, {x["filename"]: x for x in after}
    need(len(left) == len(before) and len(right) == len(after),
         "Keep each complete receiving filename once in its original edition.")
    return [{"filename": name,
             "status": "added" if name not in left else "removed" if name not in right
                       else "same" if same(left[name], right[name]) else "changed",
             "source": deepcopy(left.get(name)), "target": deepcopy(right.get(name))}
            for name in sorted(set(left) | set(right))]


def selected_preparation(desk, state, ident):
    if ident is None:
        return None
    need(isinstance(ident, str) and any(x["id"] == ident for x in state["preparations"]),
         "Select a complete preparation retained in this exact draft revision.")
    return desk._preparation(state["caseId"], state["id"], ident)


def compare(desk, case_id, target_id, body):
    exact(body, ("source", "targetRevision", "sourcePreparationId", "targetPreparationId"),
          "edition comparison")
    with desk.workspace.mutex:
        source = pinned(desk, case_id, body["source"], hashed=False)
        target = desk.get(case_id, target_id, revision(body["targetRevision"]))
        a = selected_preparation(desk, source, body["sourcePreparationId"])
        b = selected_preparation(desk, target, body["targetPreparationId"])
        return seal({"schema": COMPARISON, "caseId": case_id,
                     "source": {"ref": reference(source), "draft": source},
                     "target": {"ref": reference(target), "draft": target},
                     "files": file_changes(source["files"], target["files"]),
                     "selectionChanges": changes(source["selection"], target["selection"]),
                     "preparations": {"source": a, "target": b,
                         "files": file_changes(a["files"] if a else [], b["files"] if b else []),
                         "reportChanges": changes(a["report"] if a else None,
                                                  b["report"] if b else None)}})


def original_file(meta):
    return {"path": meta["filename"], **{k: meta[k] for k in
            ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt")}}


def finding(rows, code, pointer, message):
    value = {"code": code, "pointer": pointer, "message": message}
    if value not in rows:
        rows.append(value)


def rewrite_selection(selection, source_files, replacements, findings):
    """Rewrite only declared native file bindings; all other values stay exact."""
    value = deepcopy(selection)
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(value.get("cases"), list):
        finding(findings, "MANUAL_MAPPING_REQUIRED", "",
                "This original format has no declared customer-file mapping. Its full selection is retained unchanged.")
        return value
    originals = {x["filename"]: x for x in source_files}

    def descriptor(item, pointer):
        if not isinstance(item, dict):
            finding(findings, "SOURCE_DESCRIPTOR_REVIEW", pointer,
                    "Keep and review this original file descriptor through the existing mapping editor.")
            return item
        source = originals.get(item.get("filename"))
        if source is None or item.get("sha256") != source["sha256"] or item.get("bytes") != source["bytes"]:
            finding(findings, "SOURCE_DESCRIPTOR_REVIEW", pointer,
                    "This retained descriptor does not select an exact original source file.")
            return item
        replacement = replacements[source["id"]]
        if replacement is None:
            finding(findings, "REMOVED_SOURCE_BINDING", pointer,
                    "This original mapped file was removed. Resolve the full customer mapping before native preparation.")
            return item
        if replacement["sha256"] != source["sha256"]:
            finding(findings, "CHANGED_MAPPED_SOURCE", pointer,
                    "The original mapped bytes changed. Review plan, phase, value pointers and effort against the new full source.")
        # Preserve every original extra descriptor field, replacing only the
        # declared native file identity/provenance fields.
        return {**item, **original_file(replacement)}

    def filename(name, pointer):
        if not isinstance(name, str) or name not in originals:
            return name
        replacement = replacements[originals[name]["id"]]
        if replacement is None:
            finding(findings, "REMOVED_FILENAME_BINDING", pointer,
                    "This explicit original filename still has a mapped role. Review that role before native preparation.")
            return name
        return replacement["filename"]

    for index, row in enumerate(value["cases"]):
        path = "/cases/" + str(index)
        if not isinstance(row, dict):
            finding(findings, "CUSTOMER_MAPPING_REVIEW", path, "Review this retained complete customer mapping.")
            continue
        for key in ("packet", "handover"):
            if key in row:
                row[key] = descriptor(row[key], path + "/" + key)
        if isinstance(row.get("files"), list):
            kept = []
            for number, item in enumerate(row["files"]):
                source = originals.get(item.get("filename")) if isinstance(item, dict) else None
                if source and item.get("sha256") == source["sha256"] and item.get("bytes") == source["bytes"] and replacements[source["id"]] is None:
                    continue
                kept.append(descriptor(item, path + "/files/" + str(number)))
            row["files"] = kept
        for number, effort in enumerate(row.get("productionEffort", []) if isinstance(row.get("productionEffort"), list) else []):
            if isinstance(effort, dict) and "sourceFile" in effort:
                effort["sourceFile"] = filename(effort["sourceFile"], path + "/productionEffort/" + str(number) + "/sourceFile")
        if isinstance(row.get("effortTotal"), dict) and "sourceFile" in row["effortTotal"]:
            row["effortTotal"]["sourceFile"] = filename(row["effortTotal"]["sourceFile"], path + "/effortTotal/sourceFile")
        if isinstance(row.get("programme"), dict):
            for key in ("calendarFile", "selectionFile", "taskBudgetFile", "nativeChangeFile"):
                if key in row["programme"]:
                    row["programme"][key] = filename(row["programme"][key], path + "/programme/" + key)
    return value


def mapping_findings(selection, files, findings):
    if selection is None:
        finding(findings, "MAPPING_ABSENT", "", "The successor has no saved mapping; use Source mapping before preparation.")
        return
    by_name = {x["filename"]: x for x in files}
    if not isinstance(selection.get("cases"), list):
        finding(findings, "ORIGINAL_FORMAT_REVIEW", "", "Use this format's original receiving and mapping workflow.")
        return
    if not selection["cases"]:
        finding(findings, "CUSTOMERS_ABSENT", "/cases", "Select actual original customers before preparation.")
    for index, row in enumerate(selection["cases"]):
        path = "/cases/" + str(index)
        if not isinstance(row, dict):
            finding(findings, "CUSTOMER_MAPPING_REVIEW", path, "Review the complete customer mapping.")
            continue
        selected = []
        for key in ("packet", "handover"):
            if key in row:
                selected.append((path + "/" + key, row[key]))
        if isinstance(row.get("files"), list):
            selected.extend((path + "/files/" + str(i), x) for i, x in enumerate(row["files"]))
        for pointer, original in selected:
            meta = by_name.get(original.get("filename")) if isinstance(original, dict) else None
            if meta is None or original.get("sha256") != meta["sha256"] or original.get("bytes") != meta["bytes"]:
                finding(findings, "MAPPING_FILE_UNRESOLVED", pointer,
                        "This full native mapping does not select a retained file with matching bytes and SHA-256.")
        if not row.get("profile"):
            finding(findings, "PROFILE_ABSENT", path + "/profile", "Select the original installed receiving profile.")
    finding(findings, "NATIVE_PREPARATION_REQUIRED", "",
            "This is an editable source edition. The original native preparation checks complete profiles, plan identities, phase pointers and exact effort.")


def preview(desk, case_id, target_id, body):
    exact(body, ("source", "target", "files", "mapping"), "edition preview")
    with desk.workspace.mutex:
        source, target = pinned(desk, case_id, body["source"]), pinned(desk, case_id, body["target"])
        need(target["id"] == target_id, "The preview target differs from its original draft route.")
        decisions = body["files"]
        need(isinstance(decisions, list) and len(decisions) == len(source["files"]),
             "Choose retain, replace or remove once for every original source file.")
        originals = {x["id"]: x for x in source["files"]}
        target_files = {x["id"]: x for x in target["files"]}
        choices, replacements, remove_ids, keep_ids, retained = {}, {}, set(), set(), []
        for decision in decisions:
            exact(decision, ("sourceFileId", "choice", "targetFileId"), "original file decision")
            ident, choice, replacement_id = decision["sourceFileId"], decision["choice"], decision["targetFileId"]
            need(isinstance(ident, str) and ident in originals and ident not in choices,
                 "Choose each exact original file once.")
            need(choice in ("retain", "replace", "remove"), "Choose retain, replace or remove explicitly.")
            if choice == "replace":
                need(isinstance(replacement_id, str) and replacement_id in target_files,
                     "Select one complete replacement already retained in the target edition.")
                replacement = target_files[replacement_id]
                keep_ids.add(replacement_id)
                remove_ids.add(ident)
            else:
                need(replacement_id is None, "A retained or removed original has no replacement target ID.")
                replacement = originals[ident] if choice == "retain" else None
                if replacement:
                    retained.append(replacement)
                    keep_ids.add(ident)
                else:
                    remove_ids.add(ident)
            choices[ident], replacements[ident] = deepcopy(decision), replacement
        result_files = [deepcopy(f) for f in target["files"]
                        if f["id"] not in remove_ids or f["id"] in keep_ids]
        by_name = {f["filename"]: f for f in result_files}
        for meta in retained:
            existing = by_name.get(meta["filename"])
            need(existing is None or same(existing, meta),
                 "A retained original and target file use the same filename with different bytes or provenance. Select the exact target replacement.",
                 "INSTALLATION_EDITION_FILENAME_CONFLICT", 409)
            if existing is None:
                result_files.append(deepcopy(meta))
                by_name[meta["filename"]] = meta
        need(sum(f["bytes"] for f in result_files) <= MAX_SELECTED,
             "The complete successor file selection exceeds the original 64 MiB bound.",
             "INSTALLATION_EDITION_CAPACITY", 413)
        mapping = body["mapping"]
        exact(mapping, ("mode", "selection"), "complete mapping choice")
        need(mapping["mode"] in ("source", "target", "explicit"), "Choose the full earlier, target or explicit mapping.")
        findings = []
        if mapping["mode"] == "explicit":
            need(mapping["selection"] is None or isinstance(mapping["selection"], dict),
                 "Supply the complete explicit mapping object, or null for an unmapped draft.")
            selection = deepcopy(mapping["selection"])
        else:
            need(mapping["selection"] is None, "Keep selection null when choosing the full saved mapping.")
            selection = rewrite_selection(source["selection"], source["files"], replacements, findings) if mapping["mode"] == "source" else deepcopy(target["selection"])
        need(len(canonical(selection).encode("utf-8")) <= MAX_SELECTION,
             "Keep the complete mapping within the original 8 MiB bound.", status=413)
        mapping_findings(selection, result_files, findings)
        result = seal({"schema": PLAN, "caseId": case_id, "source": reference(source),
                       "target": reference(target),
                       "files": [choices[f["id"]] for f in source["files"]],
                       "mapping": deepcopy(mapping), "resultFiles": result_files,
                       "selection": selection, "selectionSha256": digest(selection), "findings": findings})
        need(len(canonical(result).encode("utf-8")) <= MAX_PLAN,
             "The complete edition preview exceeds 12 MiB. Preserve it and select a smaller original cohort.",
             "INSTALLATION_EDITION_CAPACITY", 413)
        return result


def apply(desk, state, data, context):
    exact(data, ("plan",), "reviewed edition application")
    supplied = data["plan"]
    value = unseal(supplied, PLAN)
    exact(value, ("schema", "caseId", "source", "target", "files", "mapping",
                  "resultFiles", "selection", "selectionSha256", "findings"), "complete edition plan")
    need(value["caseId"] == state["caseId"] and same(value["target"], reference(state)),
         "The current target draft advanced after this complete edition preview.",
         "INSTALLATION_SOURCE_REVISION_CONFLICT", 409)
    rebuilt = preview(desk, state["caseId"], state["id"],
                      {key: value[key] for key in ("source", "target", "files", "mapping")})
    need(same(rebuilt, supplied), "The complete original edition plan cannot be reproduced unchanged.",
         "INSTALLATION_EDITION_CHANGED", 409)
    source = pinned(desk, state["caseId"], value["source"])
    source_files = {f["id"]: f for f in source["files"]}
    for decision in value["files"]:
        if decision["choice"] == "retain":
            file = source_files[decision["sourceFileId"]]
            raw = desk._blob(state["caseId"], source["id"], file["sha256"])
            need(len(raw) == file["bytes"], "The retained original source length changed.")
            kept = desk._keep_blob(state["caseId"], state["id"], raw)
            need(kept == {"bytes": file["bytes"], "sha256": file["sha256"]},
                 "The complete original source copy changed its identity.")
    # Every selected replacement/current file is checked again under the same
    # original transaction before the single new revision is appended.
    for file in value["resultFiles"]:
        need(len(desk._blob(state["caseId"], state["id"], file["sha256"])) == file["bytes"],
             "The selected successor file differs from its retained complete bytes.")
    state["files"], state["selection"] = deepcopy(value["resultFiles"]), deepcopy(value["selection"])
    receipt = seal({"schema": TRANSITION, "state": "EDITABLE_SOURCE_EDITION",
                    "caseId": state["caseId"], "draftId": state["id"],
                    "draftRevision": state["revision"] + 1,
                    "requestId": context["requestId"], "actor": context["actor"], "at": context["at"],
                    "source": value["source"], "target": value["target"], "planSha256": supplied["sha256"],
                    "files": deepcopy(value["files"]), "mappingMode": value["mapping"]["mode"],
                    "resultFilesSha256": digest(state["files"]), "selectionSha256": digest(state["selection"]),
                    "findings": deepcopy(value["findings"])})
    state.setdefault("editionTransitions", []).append(receipt)
    return receipt


def verify_receipt(desk, draft, receipt, *, expected_action="edition.apply"):
    value = unseal(receipt, TRANSITION)
    need(value.get("state") == "EDITABLE_SOURCE_EDITION" and value.get("caseId") == draft["caseId"]
         and value.get("draftId") == draft["id"] and value.get("draftRevision") == draft["revision"],
         "The accepted edition transition belongs to another complete draft.")
    source = pinned(desk, draft["caseId"], value["source"])
    target = pinned(desk, draft["caseId"], value["target"])
    need(target["id"] == draft["id"] and target["revision"] + 1 == draft["revision"]
         and value["resultFilesSha256"] == digest(draft["files"])
         and value["selectionSha256"] == digest(draft["selection"])
         and draft.get("editionTransitions") and same(draft["editionTransitions"][-1], receipt)
         and draft["history"][-1]["requestId"] == value["requestId"]
         and draft["history"][-1]["action"] == expected_action,
         "The accepted transition differs from its original complete source and target history.",
         "INSTALLATION_EDITION_CHANGED", 409)
    # The complete original source and prior target bytes remain independently
    # available even after later customer edits remove their active selection.
    for prior in (source, target):
        for file in prior["files"]:
            need(len(desk._blob(draft["caseId"], prior["id"], file["sha256"])) == file["bytes"],
                 "An original edition file differs from its retained byte receipt.")
    return receipt
