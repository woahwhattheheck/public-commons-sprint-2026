"""Receive exact client briefing follow-up into an existing editable field plan."""
from __future__ import annotations
import copy
import hashlib
from pathlib import Path
from .common import identifier, read_json, verify_file
from .implementation import ImplementationStore, ImplementationError, RevisionConflict
from .implementation_schema import canonical_bytes, document_digest, load_json, validate_plan, _date, MAX_JSON_BYTES
from .implementation import _atomic_bytes
from .client_briefing import _binding, EDITION, NOTES_SCHEMA

PREVIEW_SCHEMA = "upstate.implementation-briefing-preview/v1"
IMPORT_SCHEMA = "upstate.implementation-briefing-import/v1"
METHOD = "2026-10-13-report-bound-follow-up-1"

def _copy(value):
    return copy.deepcopy(value)

def _sha(raw):
    return hashlib.sha256(raw).hexdigest()

def _id(prefix, value):
    return prefix + "_" + _sha(canonical_bytes(value))[:32]

def _field(value, label, maximum=20000, empty=True):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        raise ImplementationError(label + " must contain valid text")
    return value

def _original(path, label):
    path = Path(path)
    raw = path.read_bytes()
    return raw, load_json(raw), {"filename": path.name, "bytes": len(raw), "sha256": _sha(raw), "label": label}

def delivery_catalog(workspace):
    """Read only saved delivery metadata; selected originals are verified on open."""
    rows = []
    for path in sorted((Path(workspace.root) / "deliveries").glob("*/delivery-state.json")):
        record = read_json(path)
        files = record.get("files", {})
        available = all(name in files for name in ("client_report_model", "client_report_briefing_index"))
        rows.append({"id": record["id"], "title": record.get("selection", {}).get("title") or record.get("title") or record["id"],
                     "state": record.get("state"), "available": available,
                     "reason": "" if available else "Generate the original client report and briefing first"})
    for path in sorted((Path(workspace.root) / "watershed-context-exports").glob("*/export.json")):
        record = read_json(path)
        files = record.get("files", {})
        if all(name in files for name in ("source-context-report-model.json", "source-context-report-briefing.json")):
            rows.append({"id": record["id"], "choice_key": "source-context:" + record["id"],
                         "title": record.get("title") or record["id"],
                         "state": record.get("state"), "available": True,
                         "kind": "source_context", "reason": ""})
    from .scientific_briefing import KIND as scientific_kind
    for path in sorted((Path(workspace.root) / scientific_kind).glob("*/briefing.json")):
        record = read_json(path)
        if record.get("state") == "complete":
            rows.append({"id": record["id"], "choice_key": "scientific-briefing:" + record["id"],
                         "title": record["title"], "state": "complete", "available": True,
                         "kind": "scientific_report", "reason": ""})
    return {"reports": rows}

def delivery_sources(workspace, delivery_id):
    key = identifier(delivery_id)
    directory = Path(workspace.root) / "deliveries" / key
    if directory.is_symlink() or not directory.resolve().is_relative_to(Path(workspace.root).resolve()):
        raise ImplementationError("Select a delivery in this workspace")
    record = read_json(directory / "delivery-state.json")
    if record.get("id") != key:
        raise ImplementationError("The saved delivery identity changed")
    paths = {}
    for role, field in (("report", "client_report_model"), ("index", "client_report_briefing_index")):
        if field not in record.get("files", {}):
            raise ImplementationError("Generate the original client report and briefing before receiving its notes")
        paths[role] = verify_file(directory, record["files"][field])
    return paths

def source_context_sources(workspace, export_id):
    """Open the exact exported source briefing and its original selection."""
    key = identifier(export_id)
    directory = Path(workspace.root) / "watershed-context-exports" / key
    if directory.is_symlink() or not directory.resolve().is_relative_to(Path(workspace.root).resolve()):
        raise ImplementationError("Select a source export in this workspace")
    record = read_json(directory / "export.json")
    if record.get("id") != key or record.get("state") != "complete":
        raise ImplementationError("Select the completed original source export")
    names = {"report": "source-context-report-model.json",
             "index": "source-context-report-briefing.json",
             "selection": "selected-watersheds.json"}
    if any(name not in record.get("files", {}) for name in names.values()):
        raise ImplementationError("Export this watershed selection with its source briefing first")
    paths = {role: verify_file(directory, record["files"][name]) for role, name in names.items()}
    report = read_json(paths["report"])
    original = paths["selection"].read_bytes()
    if (report.get("schema") != "upstate.source-context-report/v1"
            or report.get("source_binding", {}).get("sha256") != _sha(original)
            or report["source_binding"].get("bytes") != len(original)):
        raise ImplementationError("The source briefing and retained selected watershed file differ")
    return {"report": paths["report"], "index": paths["index"]}

def scientific_sources(workspace, briefing_id):
    from .scientific_briefing import notes_sources
    return notes_sources(workspace, identifier(briefing_id))


def source_bundle(report_path, index_path, notes_path):
    """Verify the retained historical slide index instead of regenerating page IDs."""
    originals, values, descriptors = {}, {}, {}
    for role, path in (("report", report_path), ("index", index_path), ("notes", notes_path)):
        originals[role], values[role], descriptors[role] = _original(path, role)
    report, index, notes = (values[key] for key in ("report", "index", "notes"))
    binding = index.get("binding")
    if index.get("schema") != EDITION or not isinstance(binding, dict):
        raise ImplementationError("Choose the original client briefing page index")
    method = binding.get("report_digest_method")
    if method not in ("sha256-original-report-model-bytes", "sha256-canonical-json-utf8"):
        raise ImplementationError("The briefing report digest method is unsupported")
    expected = _binding(report, originals["report"] if method == "sha256-original-report-model-bytes" else None)
    if binding != expected or notes.get("schema") != NOTES_SCHEMA or notes.get("binding") != binding:
        raise ImplementationError("Meeting notes, page index and original client report must name the same complete edition")
    chapters, slides = {}, {}
    for row in index.get("chapters", []):
        if not isinstance(row, dict):
            raise ImplementationError("Retain the original briefing chapter index")
        key = _field(row.get("id"), "chapter ID", 100, False)
        if key in chapters:
            raise ImplementationError("Original chapter identities repeat")
        chapters[key] = row
    sections = {row["id"]: row for row in report["sections"]}
    for row in index.get("slides", []):
        if not isinstance(row, dict):
            raise ImplementationError("Retain the original briefing slide index")
        key = _field(row.get("id"), "slide ID", 100, False)
        if key in slides or row.get("chapter") not in chapters:
            raise ImplementationError("The original slide index has an ambiguous chapter or page")
        section_id = row.get("source_section")
        if section_id is not None and section_id not in sections:
            raise ImplementationError("A briefing page refers to an absent original report section")
        table_index = row.get("source_table")
        if table_index is not None:
            tables = sections[section_id].get("tables", []) if section_id in sections else []
            if type(table_index) is not int or not 0 <= table_index < len(tables):
                raise ImplementationError("A briefing page refers to an absent original report table")
            start, count = row.get("row_start"), row.get("row_count")
            if type(start) is not int or type(count) is not int or min(start, count) < 0 or start + count > len(tables[table_index]["rows"]):
                raise ImplementationError("A briefing page row range exceeds its original report table")
        slides[key] = row
    if not slides or not chapters or index.get("notes_schema") != NOTES_SCHEMA:
        raise ImplementationError("The original briefing page index is incomplete")
    meeting = notes.get("meeting")
    if not isinstance(meeting, dict):
        raise ImplementationError("Retain the complete original meeting fields")
    for key in ("title", "date", "participants", "purpose"):
        _field(meeting.get(key), "meeting " + key)
    if meeting["date"]:
        _date(meeting["date"])
    entries = notes.get("entries")
    if not isinstance(entries, list) or len(entries) > 500:
        raise ImplementationError("Retain at most 500 original meeting entries")
    seen = set()
    for row in entries:
        if not isinstance(row, dict):
            raise ImplementationError("A meeting entry must be an object")
        key = _field(row.get("id"), "entry ID", 100, False)
        if key in seen or row.get("slide_id") not in slides:
            raise ImplementationError("A meeting entry has a repeated identity or another report page")
        seen.add(key)
        if row.get("kind") not in ("question", "decision", "action") or row.get("status") not in ("open", "in-progress", "complete"):
            raise ImplementationError("Retain the original entry kind and status")
        for name, maximum in (("body", 20000), ("owner", 500), ("due", 500)):
            _field(row.get(name), "entry " + name, maximum)
        if row["due"]:
            _date(row["due"])
    agenda = notes.get("agenda")
    if not isinstance(agenda, list) or not agenda or any(key not in chapters for key in agenda):
        raise ImplementationError("Meeting agenda must name original briefing chapters")
    return {"binding": binding, "report": report, "index": index, "notes": notes,
            "slides": slides, "sections": sections, "originals": originals, "sources": descriptors}

def _source_context(bundle, entry):
    slide = bundle["slides"][entry["slide_id"]]
    section = bundle["sections"].get(slide.get("source_section"))
    return {"slide": _copy(slide), "section_id": slide.get("source_section"),
            "section_title": section.get("title") if section else None,
            "report_binding": _copy(bundle["binding"])}

def _generated(bundle, entry, link_id):
    context = _source_context(bundle, entry)
    status = {"open": "planned", "in-progress": "in_progress", "complete": "complete"}[entry["status"]]
    title = entry["body"].strip().splitlines()[0][:160]
    if not title:
        raise ImplementationError("Selected meeting entry " + entry["id"] + " has no work description")
    due = entry["due"] or None
    text = (entry["body"] + "\n\nOriginal meeting " + entry["kind"] + ": " +
            bundle["notes"]["meeting"]["title"] + "\nReport page: " +
            str(context["slide"].get("title") or entry["slide_id"]) +
            " (" + entry["slide_id"] + ")." +
            ("\nSource due date: " + due + ". This is a deadline, not a start date or duration." if due else ""))
    return {
        "title": title, "phase": "Report follow-up", "assignee": entry["owner"],
        "status": status, "notes": text, "source_due_date": due,
        "briefing_entry": {"entry_id": entry["id"], "kind": entry["kind"],
                           "source_status": entry["status"], "source_link_id": link_id,
                           "source_context": context},
    }

def _descriptor(role, source, plan_id):
    name = source["sha256"] + "-briefing-" + role + ".json"
    return {"id": "briefing_" + role + "_" + source["sha256"][:32],
            "kind": "local_file", "label": "Original briefing " + role + ": " + source["filename"],
            "reference": "implementation/plans/" + plan_id + "/attachments/" + name,
            "sha256": source["sha256"], "size_bytes": source["bytes"],
            "original_filename": source["filename"], "source_digest": source["sha256"]}

def _build(workspace, document, report_path, index_path, notes_path, *, selected_entry_ids=None):
    store = ImplementationStore(workspace)
    original = store.get(document["id"], document["revision"])
    if document_digest(original) != document_digest(document):
        raise ImplementationError("The selected plan differs from its original saved revision")
    bundle = source_bundle(report_path, index_path, notes_path)
    entries = bundle["notes"]["entries"]
    selected = ([row["id"] for row in entries if row["kind"] == "action"]
                if selected_entry_ids is None else selected_entry_ids)
    if not isinstance(selected, list) or any(not isinstance(key, str) for key in selected) or len(set(selected)) != len(selected):
        raise ImplementationError("Choose distinct original meeting entry IDs")
    if set(selected) - {row["id"] for row in entries}:
        raise ImplementationError("The selected follow-up is absent from the original notes")
    selected = [row["id"] for row in entries if row["id"] in set(selected)]
    source_links = {role: _descriptor(role, source, original["id"]) for role, source in bundle["sources"].items()}
    family = bundle["binding"]["report_sha256"]
    identity = {"method": METHOD, "plan_id": original["id"], "revision": original["revision"],
                "document_digest": document_digest(original), "report_binding": bundle["binding"],
                "sources": bundle["sources"], "selected_entry_ids": selected}
    operation_id = _sha(canonical_bytes(identity))
    prospective = _copy(original)
    history = prospective.setdefault("briefing_imports", [])
    if not isinstance(history, list):
        raise ImplementationError("The retained briefing history must be an array")
    prior_selection = next((row for row in history if row.get("report_sha256") == family
                            and row.get("selected_entry_ids") == selected
                            and all(row.get("sources", {}).get(role, {}).get("sha256") == source["sha256"]
                                    for role, source in bundle["sources"].items())), None)
    previous = next((row for row in reversed(history) if row.get("report_sha256") == family), {})
    managed = _copy(previous.get("managed_tasks", {}))
    tasks = {row["id"]: row for row in prospective["tasks"]}
    decisions, conflicts = [], []
    for entry in entries:
        row = {"entry_id": entry["id"], "kind": entry["kind"], "body": entry["body"],
               "owner": entry["owner"], "due": entry["due"], "source_status": entry["status"],
               "source_context": _source_context(bundle, entry), "selected": entry["id"] in selected}
        if entry["id"] not in selected:
            row["action"] = "source_only"
            decisions.append(row)
            continue
        key = _id("briefing_task", [family, entry["id"]])
        if prior_selection is not None:
            row.update(task_id=key, action="already_received", changed_fields=[], preserved_fields=[])
            decisions.append(row)
            continue
        generated = _generated(bundle, entry, source_links["notes"]["id"])
        old_generated = managed.get(key)
        current = tasks.get(key)
        changes, kept = [], []
        if current is None and old_generated is not None:
            row.update(task_id=key, action="preserved_local_deletion", conflicts=["task locally deleted"])
            conflicts.append({"task_id": key, "entry_id": entry["id"], "field": "task", "reason": "locally_deleted"})
            decisions.append(row)
            continue
        if current is None:
            current = {"id": key, **generated, "duration_days": None,
                       "progress_pct": 100 if generated["status"] == "complete" else 0,
                       "depends_on": [], "evidence_refs": []}
            prospective["tasks"].append(current)
            tasks[key] = current
            changes = list(generated)
            row["action"] = "create"
        elif old_generated is None:
            row.update(task_id=key, action="preserved_unmanaged_task", conflicts=["task ID already exists"])
            conflicts.append({"task_id": key, "entry_id": entry["id"], "field": "task", "reason": "unmanaged_id"})
            decisions.append(row)
            continue
        else:
            row["action"] = "update"
            for field, incoming in generated.items():
                if current.get(field) == old_generated.get(field):
                    if current.get(field) != incoming:
                        current[field] = _copy(incoming)
                        changes.append(field)
                elif current.get(field) != incoming:
                    kept.append(field)
                    conflicts.append({"task_id": key, "entry_id": entry["id"], "field": field, "reason": "locally_edited"})
            # Progress remains an explicit working observation. Update exact
            # planned/complete endpoints only when both prior status and progress
            # still match the generated status.
            old_status = old_generated.get("status")
            expected_progress = 100 if old_status == "complete" else 0
            if "status" in changes and current.get("progress_pct") == expected_progress:
                current["progress_pct"] = 100 if generated["status"] == "complete" else 0
        refs = current.setdefault("evidence_refs", [])
        for link in source_links.values():
            if link["reference"] not in refs:
                refs.append(link["reference"])
        managed[key] = generated
        row.update(task_id=key, changed_fields=changes, preserved_fields=kept,
                   action="unchanged" if row["action"] == "update" and not changes else row["action"])
        decisions.append(row)
    existing = {row["id"]: row for row in prospective["source_links"]}
    for link in source_links.values():
        if link["id"] in existing:
            old = existing[link["id"]]
            if any(old.get(k) != link.get(k) for k in ("kind", "reference", "sha256", "size_bytes", "source_digest")):
                raise ImplementationError("A briefing source ID already names different original bytes")
        else:
            prospective["source_links"].append(link)
    if prior_selection is None:
        history.append({"schema": IMPORT_SCHEMA, "operation_id": operation_id, "report_sha256": family,
                        "sources": source_links, "report_binding": bundle["binding"],
                        "base_revision": original["revision"], "base_document_digest": identity["document_digest"],
                        "applied_revision": original["revision"] + 1,
                        "selected_entry_ids": selected, "managed_tasks": managed,
                        "conflicts": conflicts, "meeting": bundle["notes"]["meeting"]})
    validate_plan(prospective)
    if len(canonical_bytes(prospective)) > MAX_JSON_BYTES - 4096:
        raise ImplementationError("The complete working plan exceeds its portable size; receive a smaller selected set into a separate plan")
    summary = {name: sum(row["action"] == name for row in decisions)
               for name in ("create", "update", "unchanged", "source_only", "preserved_local_deletion", "preserved_unmanaged_task", "already_received")}
    summary["selected_entries"] = len(selected)
    summary["conflicts"] = len(conflicts)
    preview = {"schema": PREVIEW_SCHEMA, "method": METHOD, "operation_id": operation_id,
               "plan_id": original["id"], "revision": original["revision"],
               "document_digest": identity["document_digest"], "report_binding": bundle["binding"],
               "meeting": bundle["notes"]["meeting"], "sources": bundle["sources"],
               "selected_entry_ids": selected, "rows": decisions, "summary": summary,
               "conflicts": conflicts, "can_import": bool(selected),
               "already_received": prior_selection is not None,
               "prior_applied_revision": prior_selection.get("applied_revision") if prior_selection else None}
    return {"store": store, "original": original, "plan": prospective, "bundle": bundle,
            "links": source_links, "identity": identity, "preview": preview,
            "prior_selection": prior_selection}

def preview(workspace, document, report_path, index_path, notes_path, *, selected_entry_ids=None):
    return _build(workspace, document, report_path, index_path, notes_path,
                  selected_entry_ids=selected_entry_ids)["preview"]

def receive(workspace, document, report_path, index_path, notes_path, *,
            selected_entry_ids=None, expected_operation_id, actor=""):
    context = _build(workspace, document, report_path, index_path, notes_path,
                     selected_entry_ids=selected_entry_ids)
    result = context["preview"]
    if result["operation_id"] != expected_operation_id or not result["can_import"]:
        raise ImplementationError("Preview the original source, selected entries and saved plan revision before receiving")
    store, base = context["store"], context["original"]
    with store._locked(base["id"]) as directory:
        current = store._current_record(directory)
        if current is None:
            raise ImplementationError("The working plan has no saved revision")
        if context["prior_selection"] is not None:
            if current["plan"]["revision"] != base["revision"]:
                raise RevisionConflict(base["id"], base["revision"], current["plan"]["revision"])
        applied_path = directory / "revisions" / ("%016d.json" % (base["revision"] + 1))
        applied = store._read_record(applied_path) if applied_path.exists() else None
        prior = next((row for row in (applied["plan"].get("briefing_imports", []) if applied else [])
                      if row.get("operation_id") == expected_operation_id), None)
        reconnected = prior is not None and prior.get("base_document_digest") == result["document_digest"]
        if not reconnected and current["plan"]["revision"] != base["revision"]:
            raise RevisionConflict(base["id"], base["revision"], current["plan"]["revision"])
        for role, link in context["links"].items():
            target = Path(workspace.root) / link["reference"]
            if target.is_symlink() or not target.parent.resolve().is_relative_to(directory.resolve()):
                raise ImplementationError("The original briefing file must remain inside this plan")
            raw = context["bundle"]["originals"][role]
            try:
                _atomic_bytes(target, raw)
            except FileExistsError:
                if target.read_bytes() != raw:
                    raise ImplementationError("A retained briefing attachment changed")
        if context["prior_selection"] is not None:
            return {**result, "schema": IMPORT_SCHEMA, "status": "already_received",
                    "base_revision": base["revision"], "base_document_digest": result["document_digest"],
                    "applied_revision": current["plan"]["revision"], "plan": current["plan"],
                    "current_revision": current["plan"]["revision"],
                    "source_links": list(context["links"].values())}
        if reconnected:
            saved = applied["plan"]
        else:
            store._check_frozen_sources(current["plan"], context["plan"])
            saved = store._commit(directory, context["plan"], previous=current["plan"],
                                  revision=base["revision"] + 1,
                                  operation="briefing_followup_import", actor=actor)
        return {**result, "schema": IMPORT_SCHEMA, "status": "reconnected" if reconnected else "imported",
                "base_revision": base["revision"], "base_document_digest": result["document_digest"],
                "applied_revision": saved["revision"], "plan": saved,
                "current_revision": current["plan"]["revision"] if reconnected else saved["revision"],
                "source_links": list(context["links"].values())}
