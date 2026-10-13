"""Complete private application editions in the existing standards workspace.

This module uses retained project sources and the existing transaction/request
history. It prepares documents; applicant decisions and signatures remain
explicit supplied records.
"""
from __future__ import annotations

import hashlib
from copy import deepcopy

if __package__:
    from . import engine, application_intake
else:
    import engine, application_intake

OPERATIONS = ("application.save", "application.freeze")
COLLECTIONS = ("application_drafts", "application_editions")
INPUT_SCHEMA = "standards-prime-application-input/v1"
RENDERER_EDITION = "standards-application-renderer/0.4.0"


def _object(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(label + " has unsupported or missing object fields.")
    return value


def _sources(state, source_ids, read_source):
    bindings = []
    for source_id in sorted(set(source_ids)):
        source = engine.record(state, "sources", source_id)
        raw, meta = read_source(source_id)
        actual = hashlib.sha256(raw).hexdigest()
        if (source.get("source_file_id") != meta.get("id") or
                source.get("sha256") != actual or meta.get("sha256") != actual or
                meta.get("bytes") != len(raw)):
            raise ValueError("An application source differs from its retained original.")
        bindings.append({"source_id": source_id, "source": deepcopy(source),
                         "file": deepcopy(meta)})
    return bindings


def inspect(state, payload, read_source):
    _object(payload, {"selection", "reviewed", "include_source_ids"}, "Application inspection")
    selection = deepcopy(payload.get("selection", {}))
    reviewed = deepcopy(payload.get("reviewed", {}))
    if not isinstance(selection, dict) or not isinstance(reviewed, dict):
        raise ValueError("Application source selection and reviewed inputs must be objects.")
    attachments = payload.get("include_source_ids", [])
    if (not isinstance(attachments, list) or len(attachments) > 256 or
            any(not isinstance(v, str) for v in attachments) or len(set(attachments)) != len(attachments)):
        raise ValueError("Select each additional private attachment source once.")
    used = set(attachments)

    def selected_read(source_id):
        engine.identity(source_id, "Application source")
        used.add(source_id)
        return read_source(source_id)

    intake = application_intake.inspect_application_input(state, selection, selected_read)
    if not reviewed:
        reviewed = deepcopy(intake["default_reviewed"])
    used.update(intake.get("source_ids", []))
    renderer_inputs = application_intake.prepare_renderer_inputs(intake, reviewed)
    # Explicit evidence source IDs supplied by the review travel with the same
    # original source selection. The mapper validates their semantic roles.
    for source_id in renderer_inputs.get("source_ids", []):
        selected_read(source_id)
    edition_id = selection.get("edition_id")
    edition = engine.record(state, "editions", edition_id)
    bindings = _sources(state, used, read_source)
    snapshot = {"schema": INPUT_SCHEMA, "project_id": state["id"],
                "project_revision": state["revision"],
                "edition_id": edition_id, "edition_sha256": edition["sha256"],
                "selection": selection, "intake": intake, "reviewed": reviewed,
                "renderer_inputs": renderer_inputs, "renderer_edition": RENDERER_EDITION,
                "source_bindings": bindings}
    return {"revision": state["revision"], "input_snapshot": snapshot,
            "input_sha256": engine.digest(snapshot),
            "source_ids": [row["source_id"] for row in bindings]}


def save_draft(state, payload, record_id, read_source):
    _object(payload, {"id", "title", "selection", "reviewed", "include_source_ids",
                      "predecessor_id"}, "Application draft")
    if any(row["id"] == record_id for row in state.get("application_drafts", [])):
        raise ValueError("This application draft identity is already saved; create a successor draft.")
    predecessor_id = payload.get("predecessor_id", "")
    if predecessor_id:
        engine.record(state, "application_drafts", predecessor_id)
    result = inspect(state, {key: payload[key] for key in
                            ("selection", "reviewed", "include_source_ids") if key in payload},
                     read_source)
    value = {"id": record_id, "title": engine.text(payload.get("title"),
             "Application title", True, 300), "edition_id": result["input_snapshot"]["edition_id"],
             "predecessor_id": predecessor_id, "recorded_at": engine.now(),
             "input_snapshot": result["input_snapshot"],
             "input_sha256": result["input_sha256"], "source_ids": result["source_ids"]}
    return engine.validate_record("application_drafts", value, state)


def freeze_application(state, payload, record_id):
    _object(payload, {"id", "draft_id", "title", "review_note"}, "Application edition")
    if any(row["id"] == record_id for row in state.get("application_editions", [])):
        raise ValueError("This application edition identity is already frozen; select its existing record.")
    draft = engine.record(state, "application_drafts", payload.get("draft_id"))
    value = {"id": record_id, "draft_id": draft["id"],
             "title": engine.text(payload.get("title") or draft["title"],
                                  "Application edition title", True, 300),
             "edition_id": draft["edition_id"], "frozen_at": engine.now(),
             "review_note": engine.text(payload.get("review_note", ""), "Review note"),
             "input_snapshot": deepcopy(draft["input_snapshot"]),
             "input_sha256": draft["input_sha256"],
             "source_ids": list(draft["source_ids"])}
    return engine.validate_record("application_editions", value, state)


def validate_state(state):
    if state.get("application_drafts"):
        engine._cycle(state, "application_drafts", "predecessor_id")
    for collection in COLLECTIONS:
        for row in state.get(collection, []):
            snap = row["input_snapshot"]
            if (not isinstance(snap, dict) or snap.get("schema") != INPUT_SCHEMA or
                    snap.get("project_id") != state["id"] or
                    snap.get("edition_id") != row["edition_id"] or
                    engine.digest(snap) != row["input_sha256"]):
                raise ValueError("The retained application input edition differs.")
            edition = engine.record(state, "editions", row["edition_id"])
            if edition["sha256"] != snap.get("edition_sha256"):
                raise ValueError("Application and original standard edition differ.")
            intake = snap.get("intake")
            selected = deepcopy(snap.get("selection", {}))
            selected.setdefault("evidence_source_ids", [])
            if (not isinstance(intake, dict) or intake.get("project_id") != state["id"] or
                    intake.get("selection") != selected or
                    intake.get("edition") != edition or
                    snap.get("renderer_edition") != RENDERER_EDITION):
                raise ValueError("The application intake identifies different original selections.")
            prepared = application_intake.prepare_renderer_inputs(intake, snap.get("reviewed"))
            if engine.canonical(prepared) != engine.canonical(snap.get("renderer_inputs")):
                raise ValueError("The rendered application differs from its complete reviewed inputs.")
            bindings = snap.get("source_bindings")
            if not isinstance(bindings, list):
                raise ValueError("Application source bindings must be complete.")
            if ([b["source_id"] for b in bindings] != row["source_ids"] or
                    len(set(row["source_ids"])) != len(row["source_ids"]) or
                    not set(intake["source_ids"]).issubset(row["source_ids"])):
                raise ValueError("Application attachment selection differs.")
            bound = {binding["source_id"]: binding for binding in bindings}
            for original in intake["bindings"].values():
                chosen = bound[original["source"]["id"]]
                if chosen["source"] != original["source"] or chosen["file"] != original["file"]:
                    raise ValueError("The reviewed application lost an original intake binding.")
            for binding in bindings:
                source = engine.record(state, "sources", binding["source_id"])
                meta = binding["file"]
                original = next((f for f in state["files"] if f["id"] == meta["id"]), None)
                if (original != meta or source["source_file_id"] != meta["id"] or
                        source["sha256"] != meta["sha256"]):
                    raise ValueError("An application source was replaced; retain a successor source.")
            if collection == "application_editions":
                draft = engine.record(state, "application_drafts", row["draft_id"])
                if draft["input_sha256"] != row["input_sha256"]:
                    raise ValueError("The frozen application identifies a different draft.")
    return state


def validate_originals(state, originals):
    """Reconcile the frozen parsed intake against its complete original answer bytes."""
    for collection in COLLECTIONS:
        for row in state.get(collection, []):
            intake = row["input_snapshot"]["intake"]
            binding = intake["bindings"]["answers"]
            meta = binding["file"]
            raw = originals.get(meta["id"])
            if (raw is None or len(raw) != meta["bytes"] or
                    hashlib.sha256(raw).hexdigest() != meta["sha256"]):
                raise ValueError("The original application answers are incomplete.")
            parsed = application_intake.parse_authoring(raw)
            if engine.canonical(parsed) != engine.canonical(intake["input"]):
                raise ValueError("The parsed application intake differs from its original answer file.")
    return state


def status(state):
    def summary(row):
        snap = row["input_snapshot"]
        return {key: deepcopy(row[key]) for key in row if key != "input_snapshot"} | {
            "applicant": deepcopy(snap["renderer_inputs"].get("inputProvenance", {}).get("reviewed", {}).get("applicant", {})),
            "financial": deepcopy(snap["renderer_inputs"].get("financial", {})),
            "unresolved": deepcopy(snap["renderer_inputs"].get("inputProvenance", {}).get("findings", [])),
            "narrative_reviewed": bool(snap["renderer_inputs"].get("inputProvenance", {}).get("narrativeReviewed", False))}
    return {"revision": state["revision"],
            "drafts": [summary(r) for r in state.get("application_drafts", [])],
            "editions": [summary(r) for r in state.get("application_editions", [])]}


def application_files(state, application_id, originals):
    if __package__:
        from . import application_renderer
    else:
        import application_renderer
    validate_originals(state, originals)
    record = engine.record(state, "application_editions", application_id)
    snap = record["input_snapshot"]
    if engine.digest(snap) != record["input_sha256"]:
        raise ValueError("Application input identity differs.")
    binding_by_id = {b["source_id"]: b for b in snap["source_bindings"]}

    def retained_source(source_id):
        if source_id not in binding_by_id:
            raise ValueError("The renderer requested a source outside the frozen application.")
        meta = binding_by_id[source_id]["file"]
        raw = originals.get(meta["id"])
        if (raw is None or len(raw) != meta["bytes"] or
                hashlib.sha256(raw).hexdigest() != meta["sha256"]):
            raise ValueError("The original application source is incomplete.")
        return raw, deepcopy(meta)

    generated = application_renderer.render_application(
        deepcopy(snap["renderer_inputs"]), retained_source)
    if not isinstance(generated, dict) or not generated:
        raise ValueError("The application renderer returned no complete documents.")
    files = {"application/" + path: raw for path, raw in generated.items()}
    files["application/selected-application.json"] = (
        engine.canonical(record) + "\n").encode()
    files["application/selected-renderer-inputs.json"] = (
        engine.canonical(snap["renderer_inputs"]) + "\n").encode()
    for source_id, binding in binding_by_id.items():
        raw, meta = retained_source(source_id)
        files["originals/" + meta["id"] + "/" + meta["filename"]] = raw
    files["OPEN_APPLICATION.txt"] = (
        "Open the application documents in application/. The selected source files "
        "and complete input edition accompany these documents. Applicant details "
        "and recorded review status are explicit in that edition.\n\n"
        "To continue editable project work, use the separate complete private "
        "workspace export from the same operator. This selected application "
        "contains its chosen source materials; the private workspace retains "
        "all project history and earlier application editions.\n").encode()
    return files, record
