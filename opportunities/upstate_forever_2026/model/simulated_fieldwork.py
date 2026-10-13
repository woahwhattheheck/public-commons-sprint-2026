"""Original simulated headwaters case: complete native field/laboratory follow-through.

The input concentrations, dates, control relationships and reviewer decisions
are explicitly authored demonstration inputs. Calculations and retained native
reports are produced by the maintained Implementation, laboratory and QC APIs.
This module never creates a Workspace or launches a scientific model.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re

from .implementation import ImplementationStore, _atomic_bytes, _file_lock
from .implementation_schema import (ImplementationError, RevisionConflict,
    canonical_bytes, document_digest, load_json, validate_plan)
from . import implementation_lab_results as lab
from . import implementation_qc as qc
from . import implementation_qc_actions as actions
from . import implementation_observations as observed

SCHEMA = "upstate.simulated-fieldwork/v1"
INPUT_SCHEMA = "upstate.simulated-fieldwork-inputs/v1"
DEMO_ID = "upstate-simulated-piedmont-headwaters-v1"
LABEL = "SIMULATED DEMONSTRATION INPUTS"
PHASES = ("intake", "review", "repeat", "closeout")
INPUT_NAMES = {
    "original-model-input-recipe.json", "field-design.json", "seed-plan.json",
    "initial-lab-results.csv", "repeat-lab-results.csv", "lab-mapping.json",
    "repeat-field-record.md",
}
HEX = re.compile(r"[a-f0-9]{64}")
STEPS = (
    "01-create-plan", "02-attach-design", "03-initial-lab",
    "04-initial-qc", "05-open-corrective-action",
    "06-attach-repeat-evidence", "07-repeat-visit", "08-repeat-lab",
    "09-repeat-qc", "10-complete-field-task", "11-close-initial-review",
    "12-close-repeat-review", "13-observation-context",
    "14-initial-qc-source", "15-repeat-qc-source",
    "16-initial-action-source", "17-repeat-action-source",
)

def _hash(raw):
    return hashlib.sha256(raw).hexdigest()

def _clone(value):
    return copy.deepcopy(value)

def _safe(root, name, *, exists=False):
    root = Path(root).resolve()
    part = Path(name)
    if part.is_absolute() or not part.parts or any(p in ("", ".", "..") for p in part.parts):
        raise ImplementationError("Use an original workspace-relative member.")
    result = root / part
    current = root
    for segment in part.parts:
        current = current / segment
        if current.is_symlink():
            raise ImplementationError("The simulated field case must not follow symlinks.")
    if not result.resolve().is_relative_to(root):
        raise ImplementationError("The simulated field member escaped its original root.")
    if exists and not result.is_file():
        raise ImplementationError("A retained field member is missing: " + name)
    return result

def _read(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ImplementationError("Read an ordinary retained field file: " + str(path))
    return load_json(path.read_bytes())

def _put(path, value):
    raw = canonical_bytes(value) + b"\n"
    _bytes(path, raw)
    return value

def _bytes(path, raw):
    path = Path(path)
    try:
        _atomic_bytes(path, raw)
    except FileExistsError:
        if path.is_symlink() or not path.is_file() or path.read_bytes() != raw:
            raise ImplementationError("A retained original field file differs: " + str(path))

def _descriptor(root, path):
    raw = Path(path).read_bytes()
    return dict(path=Path(path).relative_to(root).as_posix(), bytes=len(raw), sha256=_hash(raw))

def _verify(root, item):
    name = item.get("path")
    if not isinstance(name, str):
        raise ImplementationError("A retained field member has no original path.")
    path = _safe(root, name, exists=True)
    raw = path.read_bytes()
    size = item.get("bytes", item.get("size_bytes"))
    if len(raw) != size or _hash(raw) != item.get("sha256"):
        raise ImplementationError("A retained field member changed: " + name)
    return path

def _inputs(directory):
    directory = Path(directory).expanduser().resolve(strict=True)
    raw = _safe(directory, "field-inputs.json", exists=True).read_bytes()
    manifest = load_json(raw)
    if (manifest.get("schema") != INPUT_SCHEMA or manifest.get("demo_id") != DEMO_ID
            or manifest.get("classification") != LABEL):
        raise ImplementationError("Select the original explicitly simulated field input edition.")
    files = manifest.get("files")
    if (not isinstance(files, list) or len(files) != len(INPUT_NAMES)
            or {row.get("path") for row in files} != INPUT_NAMES):
        raise ImplementationError("The field-input edition requires its seven complete original files.")
    for item in files:
        _verify(directory, item)
    recipe = _read(directory / "original-model-input-recipe.json")
    recipe_sha = _hash((directory / "original-model-input-recipe.json").read_bytes())
    design = _read(directory / "field-design.json")
    seed = validate_plan(_read(directory / "seed-plan.json"))
    if (recipe.get("demo_id") != DEMO_ID or recipe.get("classification") != LABEL
            or recipe_sha != manifest.get("recipe_sha256")
            or design.get("recipe_sha256") != recipe_sha
            or design.get("classification") != LABEL
            or seed.get("simulated_fieldwork", {}).get("recipe_sha256") != recipe_sha
            or seed["id"] != manifest.get("plan_id") or seed["revision"] != 0):
        raise ImplementationError("The field plan, design and original simulated model recipe differ.")
    if seed["observations"] or seed["tasks"]:
        raise ImplementationError("The original seed must precede laboratory intake and corrective tasks.")
    return directory, manifest, raw, design, seed

def _operation(workspace, directory):
    original, manifest, raw, design, seed = _inputs(directory)
    identity = dict(schema=SCHEMA, demo_id=DEMO_ID,
                    original_project_id=workspace.project["id"],
                    inputs_sha256=_hash(raw), plan_id=manifest["plan_id"],
                    recipe_sha256=manifest["recipe_sha256"])
    operation_id = _hash(canonical_bytes(identity))
    root = Path(workspace.root).resolve()
    operation = _safe(root, "implementation/simulated-fieldwork/" + operation_id)
    operation.mkdir(parents=True, exist_ok=True)
    # Original input names and bytes, including the actual native recipe, travel
    # in the ordinary whole-workspace archive. No sender-absolute paths persist.
    for item in manifest["files"]:
        target = _safe(operation, "inputs/" + item["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        member = _verify(original, item).read_bytes()
        if len(member) != item["bytes"] or _hash(member) != item["sha256"]:
            raise ImplementationError("The original prepared source changed while receiving.")
        _bytes(target, member)
    _bytes(operation / "inputs" / "field-inputs.json", raw)
    _put(operation / "identity.json", identity)
    return operation_id, operation, manifest, design, seed

def _semantic(plan):
    value = _clone(plan)
    value.pop("revision", None)
    value.pop("updated_at", None)
    return value

def _create(store, seed, actor):
    path = store.base / seed["id"] / "revisions" / "0000000000000001.json"
    if path.exists():
        original = store.get(seed["id"], 1)
        if _semantic(original) != _semantic(seed):
            raise ImplementationError("The original simulated plan ID belongs to another seed edition.")
        return dict(plan_id=original["id"], revision=1, plan_sha256=document_digest(original))
    saved = store.create(seed, actor=actor)
    return dict(plan_id=saved["id"], revision=saved["revision"], plan_sha256=document_digest(saved))

def _native_save(store, request):
    """Recover an exact old-revision save after lost response without replay."""
    target = validate_plan(request["plan"])
    base = store.get(target["id"], request["expected_revision"])
    if target["revision"] != base["revision"]:
        raise ImplementationError("The retained edit no longer names its original revision.")
    if document_digest(target) == document_digest(base):
        return dict(plan_id=base["id"], revision=base["revision"], plan_sha256=document_digest(base))
    directory = store._directory(base["id"])
    following = directory / "revisions" / ("%016d.json" % (base["revision"] + 1))
    if following.exists():
        record = store._read_record(following)
        saved = record["plan"]
        if (record["event"].get("previous_document_digest") != document_digest(base)
                or _semantic(saved) != _semantic(target)):
            raise RevisionConflict(base["id"], base["revision"], store.get(base["id"])["revision"])
    else:
        saved = store.save(target, expected_revision=base["revision"], actor=request["actor"])
    return dict(plan_id=saved["id"], revision=saved["revision"], plan_sha256=document_digest(saved))

def _attach(store, operation, request):
    source = _safe(operation, "inputs/" + request["filename"], exists=True)
    expected = _hash(source.read_bytes())
    source_id = "file_" + expected[:24]
    current = store.get(request["plan_id"])
    present = next((row for row in current["source_links"] if row["id"] == source_id), None)
    if present is not None:
        if present.get("sha256") != expected:
            raise ImplementationError("Original native attachment identity differs.")
        _verify(store.root, dict(path=present["reference"], sha256=expected, bytes=source.stat().st_size))
        return dict(plan_id=current["id"], revision=current["revision"],
                    source_link_id=source_id, attachment=_descriptor(store.root, store.root / present["reference"]))
    if current["revision"] != request["expected_revision"]:
        raise RevisionConflict(current["id"], request["expected_revision"], current["revision"])
    result = store.attach_file(current["id"], source, expected_revision=current["revision"],
                               actor=request["actor"], label=LABEL + " — " + request["filename"])
    return dict(plan_id=current["id"], revision=result["plan"]["revision"], source_link_id=source_id,
                attachment=_descriptor(store.root, Path(result["file_ref"])))

def _qc_ref(result):
    return dict(plan_id=result["plan_id"], revision=result["revision"],
                report_id=result["report_id"], review_id=result["review_id"])

def _action_ref(result):
    return dict(plan_id=result["plan_id"], revision=result["revision"],
                report_id=result["report_id"], action_report_id=result["action_report_id"],
                receipt=result["receipt"])

def _lab(workspace, operation, request):
    store = ImplementationStore(workspace)
    plan = store.get(request["plan_id"], request["revision"])
    path = _safe(operation, "inputs/" + request["filename"], exists=True)
    mapping = _read(operation / "inputs" / "lab-mapping.json")
    preview = lab.preview_lab_results(workspace, plan, path, mapping, filename=request["filename"])
    _put(operation / (request["step"] + ".native-preview.json"), preview)
    if not preview["can_import"]:
        raise ImplementationError("Original laboratory intake needs review: " + json.dumps(preview["issues"], ensure_ascii=False))
    result = lab.import_lab_results(workspace, plan, path, mapping,
                                   expected_operation_id=preview["operation_id"],
                                   actor=request["actor"], filename=request["filename"])
    return {key: value for key, value in result.items()
            if key not in ("plan", "status", "current_revision")}

def _step(operation, name, request_factory, apply):
    if name not in STEPS:
        raise ImplementationError("Unknown original field phase step.")
    request_path, result_path = operation / (name + ".request.json"), operation / (name + ".result.json")
    request = _read(request_path) if request_path.exists() else _put(request_path, request_factory())
    if result_path.exists():
        result = _read(result_path)
        if result.get("request_sha256") != _hash(canonical_bytes(request)):
            raise ImplementationError("The original field phase request changed.")
        return result["result"]
    result = apply(request)
    _put(result_path, dict(schema=SCHEMA, step=name,
                          request_sha256=_hash(canonical_bytes(request)), result=result))
    return result

def _qc_selection(plan, design, manifest, group_ids, title):
    groups = []
    for key in group_ids:
        original = next((row for row in design["relationships"] if row["id"] == key), None)
        if original is None:
            raise ImplementationError("The original field design lacks relationship " + key)
        selected = {**_clone(original), "accepted_qualifiers": [""], "accepted_qa_statuses": [""],
                    "notes": LABEL}
        if original["kind"] == "duplicate":
            selected["criterion"] = _clone(design["criterion"])
        groups.append(selected)
    return dict(schema=qc.SELECTION_SCHEMA, plan_id=plan["id"], revision=plan["revision"],
                title=LABEL + " — " + title, purpose="Retained field precision and corrective-work demonstration",
                reviewer=manifest["actor"], as_of=manifest["as_of"], notes=LABEL, groups=groups)

def _decision(group_id, decision, reason, *, task_ids=None, evidence=None,
              closed=False, closure="", create_task=None):
    result = dict(group_id=group_id, decision=decision,
                  use_scope="Explicitly simulated field-precision teaching case; no annual-load or model-validation use",
                  reason=reason, state="closed" if closed else "open",
                  task_ids=task_ids or [], evidence_refs=evidence or [], closure_note=closure)
    if create_task:
        result["create_task"] = create_task
    return result

def _action_selection(plan, report_id, manifest, decisions):
    return dict(schema=actions.SELECTION_SCHEMA, plan_id=plan["id"], report_id=report_id,
                expected_revision=plan["revision"], actor=manifest["actor"],
                as_of=manifest["as_of"], decisions=decisions)

def _group(workspace, reference, group_id):
    review = qc.inspect(workspace, reference["plan_id"], reference["report_id"])["review"]
    return next(row for row in review["groups"] if row["id"] == group_id)

def _check_outcome(workspace, reference, group_id, expected):
    actual = _group(workspace, reference, group_id)
    if actual["outcome"] != expected:
        raise ImplementationError("Original native QC returned " + actual["outcome"] + " for " + group_id
                                  + "; inspect its actual reasons before continuing the scripted reviewer decision.")
    return actual

def continue_campaign(workspace, prepared_directory, *, through="closeout"):
    """Continue the same existing Workspace; stop at a useful original UI chapter.

    The four phases accumulate: intake, review, repeat, closeout. Same-input
    retries reopen retained original operations. Concurrent human edits are
    preserved and a changed native revision is surfaced, never overwritten.
    """
    if through not in PHASES:
        raise ImplementationError("Choose intake, review, repeat or closeout.")
    operation_id, operation, manifest, design, seed = _operation(workspace, prepared_directory)
    store = ImplementationStore(workspace)
    plan_id, actor = manifest["plan_id"], manifest["actor"]
    def current_plan():
        # Only new scripted requests call this guard. A completed original
        # operation can still be inspected after ordinary later human edits.
        current = store.get(plan_id)
        available = {row["observation_id"]: row for row in qc.records(current)}
        for name in (STEPS[2], STEPS[7]):
            path = operation / (name + ".result.json")
            if not path.exists():
                continue
            receipt = _read(path)["result"]
            original = store.get(plan_id, receipt["applied_revision"])
            for row in qc.records(original):
                if row["original"].get("lab_source", {}).get("operation_id") != receipt["operation_id"]:
                    continue
                if available.get(row["observation_id"]) != row:
                    raise ImplementationError("An original imported field record or its collection context changed: "
                        + row["observation_id"] + ". Review the saved plan in the ordinary editor before "
                        "continuing the scripted teaching decisions; the retained original review remains available.")
        return current
    with _file_lock(operation / "operation.lock"):
        _step(operation, STEPS[0], lambda: dict(seed=seed, actor=actor),
              lambda q: _create(store, q["seed"], q["actor"]))
        design_file = _step(operation, STEPS[1],
            lambda: dict(plan_id=plan_id, expected_revision=current_plan()["revision"],
                         filename="field-design.json", actor=actor),
            lambda q: _attach(store, operation, q))
        _step(operation, STEPS[2],
            lambda: dict(plan_id=plan_id, revision=current_plan()["revision"],
                         filename="initial-lab-results.csv", actor=actor, step=STEPS[2]),
            lambda q: _lab(workspace, operation, q))
        if through == "intake":
            return inspect_campaign(workspace, operation_id)
        initial = _step(operation, STEPS[3],
            lambda: _qc_selection(current_plan(), design, manifest,
                                  ["right-initial-duplicate", "initial-field-blank"], "initial sampling review"),
            lambda q: _qc_ref(qc.save(workspace, q)))
        _check_outcome(workspace, initial, "right-initial-duplicate", "exceeds_entered_criterion")
        _check_outcome(workspace, initial, "initial-field-blank", "not_evaluated")
        opened = _step(operation, STEPS[4],
            lambda: _action_selection(current_plan(), initial["report_id"], manifest, [
                _decision("right-initial-duplicate", "follow_up_required",
                    "The native calculated initial precision exceeds the entered demonstration criterion. "
                    "Retain both original results and investigate collection/handling through repeat collection.",
                    evidence=[design_file["source_link_id"]], create_task=dict(
                        title="SIMULATED — inspect handling and repeat eastern tributary collection",
                        assignee="Simulated field team", phase="Quality follow-up", duration_days=1,
                        start_not_before="2026-10-08", notes=LABEL + "; keep both original results and all source QA.")),
                _decision("initial-field-blank", "restricted_use",
                    "The original blank is censored <0.010 mg/L. It supplies an upper-bound context; "
                    "no exact blank concentration or blank correction is inferred.",
                    evidence=[design_file["source_link_id"]], closed=True,
                    closure="Reviewer has documented the censored limitation and its restricted teaching use."),
            ]),
            lambda q: _action_ref(actions.save(workspace, q)))
        task_ids = opened["receipt"]["created_task_ids"]
        if len(task_ids) != 1:
            raise ImplementationError("The original demonstration corrective receipt must contain its one field task.")
        if through == "review":
            return inspect_campaign(workspace, operation_id)
        evidence = _step(operation, STEPS[5],
            lambda: dict(plan_id=plan_id, expected_revision=current_plan()["revision"],
                         filename="repeat-field-record.md", actor=actor),
            lambda q: _attach(store, operation, q))
        def visit_request():
            plan = current_plan()
            visit = next(row for row in plan["visits"] if row["id"] == "visit-repeat-right")
            if visit["status"] != "planned":
                raise ImplementationError("The original repeat visit was edited; review its saved current state.")
            visit.update(status="complete", visited_at="2026-10-08T10:00:00-04:00",
                         notes=LABEL + "; original repeat-collection evidence retained.")
            if evidence["source_link_id"] not in visit["evidence_refs"]:
                visit["evidence_refs"].append(evidence["source_link_id"])
            return dict(plan=plan, expected_revision=plan["revision"], actor=actor)
        _step(operation, STEPS[6], visit_request, lambda q: _native_save(store, q))
        _step(operation, STEPS[7],
            lambda: dict(plan_id=plan_id, revision=current_plan()["revision"],
                         filename="repeat-lab-results.csv", actor=actor, step=STEPS[7]),
            lambda q: _lab(workspace, operation, q))
        repeat = _step(operation, STEPS[8],
            lambda: _qc_selection(current_plan(), design, manifest,
                                  ["right-repeat-duplicate"], "repeat sampling review"),
            lambda q: _qc_ref(qc.save(workspace, q)))
        _check_outcome(workspace, repeat, "right-repeat-duplicate", "within_entered_criterion")
        if through == "repeat":
            return inspect_campaign(workspace, operation_id)
        def completed_request():
            plan = current_plan()
            task = next((row for row in plan["tasks"] if row["id"] == task_ids[0]), None)
            if task is None or task["status"] == "cancelled":
                raise ImplementationError("Review the original corrective task before completing this phase.")
            task.update(status="complete", progress_pct=100)
            if evidence["source_link_id"] not in task["evidence_refs"]:
                task["evidence_refs"].append(evidence["source_link_id"])
            return dict(plan=plan, expected_revision=plan["revision"], actor=actor)
        _step(operation, STEPS[9], completed_request, lambda q: _native_save(store, q))
        closed_initial = _step(operation, STEPS[10],
            lambda: _action_selection(current_plan(), initial["report_id"], manifest, [
                _decision("right-initial-duplicate", "exclude_from_selected_use",
                    "Keep the original exceeded precision result and exclude that original pair from this "
                    "teaching case's selected concentration interpretation. The repeat pair is separate new evidence.",
                    task_ids=task_ids, evidence=[evidence["source_link_id"]], closed=True,
                    closure="The original field task is complete. Inspect the separate native repeat QC report "
                            + repeat["report_id"] + "; no original result, qualifier or laboratory QA was changed."),
            ]),
            lambda q: _action_ref(actions.save(workspace, q)))
        closed_repeat = _step(operation, STEPS[11],
            lambda: _action_selection(current_plan(), repeat["report_id"], manifest, [
                _decision("right-repeat-duplicate", "use_as_reviewed",
                    "The native repeated pair meets the explicitly entered demonstration precision criterion. "
                    "Use only within this simulated concentration/precision case; this is not evidence of model accuracy.",
                    task_ids=task_ids, evidence=[evidence["source_link_id"]], closed=True,
                    closure="Repeated collection evidence and original completed field task are linked; "
                            "source values and prior review remain retained."),
            ]),
            lambda q: _action_ref(actions.save(workspace, q)))
        def observed_request():
            plan = current_plan()
            preview = observed.preview_observation_context(workspace, plan)
            return dict(plan_id=plan_id, revision=plan["revision"],
                        expected_operation_id=preview["operation_id"])
        _step(operation, STEPS[12], observed_request,
            lambda q: observed.import_observation_context(workspace, store.get(q["plan_id"], q["revision"]),
                                                          expected_operation_id=q["expected_operation_id"]))
        for name, reference, source_api, id_key in (
            (STEPS[13], initial, qc.scientific_source, "report_id"),
            (STEPS[14], repeat, qc.scientific_source, "report_id"),
            (STEPS[15], closed_initial, actions.scientific_source, "action_report_id"),
            (STEPS[16], closed_repeat, actions.scientific_source, "action_report_id"),
        ):
            _step(operation, name, lambda ref=reference, key=id_key: dict(plan_id=plan_id, report_id=ref[key]),
                  lambda q, api=source_api: api(workspace, q["plan_id"], q["report_id"]))
        result = inspect_campaign(workspace, operation_id)
        if not (operation / "completed.json").exists():
            _put(operation / "completed.json", dict(schema=SCHEMA, operation_id=operation_id,
                 original_project_id=workspace.project["id"], plan_id=plan_id,
                 revision_at_completion=result["current_revision"], completed_steps=list(STEPS)))
        return result

def inspect_campaign(workspace, operation_id):
    """Reopen the exact retained chapter, including after whole-project receiving."""
    if not isinstance(operation_id, str) or not HEX.fullmatch(operation_id):
        raise ImplementationError("Select an original simulated field operation ID.")
    root = Path(workspace.root).resolve()
    directory = _safe(root, "implementation/simulated-fieldwork/" + operation_id)
    identity = _read(directory / "identity.json")
    if _hash(canonical_bytes(identity)) != operation_id:
        raise ImplementationError("The original simulated field operation identity changed.")
    _, manifest, raw, design, seed = _inputs(directory / "inputs")
    if (identity["original_project_id"] != workspace.project["id"]
            or identity["inputs_sha256"] != _hash(raw)
            or identity["plan_id"] != manifest["plan_id"]):
        raise ImplementationError("Select the original project and complete field input edition.")
    store = ImplementationStore(workspace)
    plan = store.get(identity["plan_id"])
    if plan.get("simulated_fieldwork") != seed["simulated_fieldwork"]:
        raise ImplementationError("The original simulated plan binding changed.")
    results = {}
    for name in STEPS:
        path = directory / (name + ".result.json")
        if not path.exists():
            break
        request = _read(directory / (name + ".request.json"))
        retained = _read(path)
        if (retained.get("step") != name or retained.get("schema") != SCHEMA
                or retained.get("request_sha256") != _hash(canonical_bytes(request))):
            raise ImplementationError("An original native field request or result changed.")
        result = retained["result"]
        if "plan_sha256" in result:
            selected = store.get(result["plan_id"], result["revision"])
            if document_digest(selected) != result["plan_sha256"]:
                raise ImplementationError("A retained native plan revision changed.")
        if "attachment" in result:
            _verify(root, result["attachment"])
        if name in (STEPS[2], STEPS[7]):
            native = _read(_safe(root, result["receipt_path"], exists=True))
            if native != result:
                raise ImplementationError("The original laboratory receipt changed.")
            for item in result["files"]:
                _verify(root, item)
            selected = store.get(result["plan_id"], result["applied_revision"])
            if document_digest(selected) != result["applied_document_digest"]:
                raise ImplementationError("The original imported laboratory revision changed.")
        if name in (STEPS[3], STEPS[8]):
            actual = qc.inspect(workspace, result["plan_id"], result["report_id"])
            if _qc_ref(actual) != result:
                raise ImplementationError("The original native QC report identity changed.")
        if name in (STEPS[4], STEPS[10], STEPS[11]):
            actual = actions.inspect(workspace, result["plan_id"], result["action_report_id"])
            if _action_ref(actual) != result:
                raise ImplementationError("The original native quality-action report changed.")
        for item in result.get("files", []):
            _verify(root, item)
        results[name] = result
    phase = ("closeout" if len(results) == len(STEPS) else
             "repeat" if STEPS[8] in results else "review" if STEPS[4] in results
             else "intake" if STEPS[2] in results else "preparing")
    qc_reports = []
    for name in (STEPS[3], STEPS[8]):
        if name in results:
            reference = results[name]
            actual = qc.inspect(workspace, reference["plan_id"], reference["report_id"])
            qc_reports.append(dict(**reference, groups=actual["review"]["groups"],
                                   files=actual["files"], title=actual["review"]["title"]))
    action_reports = []
    for name in (STEPS[4], STEPS[10], STEPS[11]):
        if name in results:
            ref = results[name]
            actual = actions.inspect(workspace, ref["plan_id"], ref["action_report_id"])
            action_reports.append(dict(**ref, files=actual["files"]))
    task_ids = results.get(STEPS[4], {}).get("receipt", {}).get("created_task_ids", [])
    actual_tasks = [row for row in plan["tasks"] if row["id"] in task_ids]
    if len(actual_tasks) != len(task_ids):
        raise ImplementationError("An original demonstration corrective task is missing from the current plan.")
    source_reports = [
        dict(step=name, report_source=results[name].get("report_source"),
             delivery_selection=results[name].get("delivery_selection"))
        for name in STEPS[13:] if name in results
    ]
    return dict(schema=SCHEMA, operation_id=operation_id, demo_id=DEMO_ID, classification=LABEL,
                original_project_id=identity["original_project_id"], recipe_sha256=identity["recipe_sha256"],
                plan_id=plan["id"], current_revision=plan["revision"], phase=phase,
                completed_steps=list(results), directory=directory.relative_to(root).as_posix(),
                record_counts={key: len(plan[key]) for key in ("sites", "visits", "activities", "observations", "tasks")},
                original_observations=_clone(plan["observations"]), corrective_tasks=_clone(actual_tasks),
                qc_reports=qc_reports, action_reports=action_reports, scientific_reports=source_reports,
                observation_context=results.get(STEPS[12]),
                operating_notes=design["assumptions"],
                open_saved_plan=dict(plan_id=plan["id"], revision=plan["revision"]),
                input_files=[_descriptor(root, directory / "inputs" / item["path"]) for item in manifest["files"]])

def attach_to_delivery(workspace, operation_id, delivery_selection):
    """Append all five original field sources to the existing ordered delivery.

    Existing model runs, source roles, report order, maps and contact settings
    remain in the selected document. The maintained binder verifies the full
    new report set before the caller builds its next ordinary delivery edition.
    """
    from . import observed_context
    result = inspect_campaign(workspace, operation_id)
    if result["phase"] != "closeout":
        raise ImplementationError("Complete the original field closeout before selecting its full delivery chapter.")
    selected = _clone(delivery_selection)
    choices = observed_context.source_choices(selected)
    original = result["observation_context"]["report_source"]
    additions = [{key: original[key] for key in ("source_collection_id", "source_id")}]
    additions.extend(row["report_source"] for row in result["scientific_reports"])
    for choice in additions:
        if not isinstance(choice, dict):
            raise ImplementationError("A native field report lacks its original source selection.")
        normalized = {key: choice[key] for key in ("source_collection_id", "source_id")}
        workspace.source_file(normalized["source_collection_id"], normalized["source_id"])
        if normalized not in choices:
            choices.append(normalized)
    selected.setdefault("source_roles", {})[observed_context.ROLE] = choices[0]
    selected["observed_context_sources"] = choices
    selected.pop("observed_context_binding", None)
    selected["observed_context_binding"] = observed_context.bind(workspace, selected)
    return selected


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--inputs")
    group.add_argument("--inspect")
    parser.add_argument("--through", choices=PHASES, default="closeout")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    result = (inspect_campaign(workspace, args.inspect) if args.inspect
              else continue_campaign(workspace, args.inputs, through=args.through))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))

if __name__ == "__main__":
    main()
