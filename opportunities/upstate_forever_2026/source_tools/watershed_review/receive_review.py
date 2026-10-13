#!/usr/bin/env python3
"""Receive an original watershed review desk and resume its native plan handoff.

The exact input selection is frozen before source or plan mutation. Repeating the
same command reconciles the original attachment/report without replacing current
plan edits. Use another output directory for a separately selected report edition.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import datetime

SELECTION_SCHEMA = "upstate.watershed-review-intake/v2"


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def ordinary(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Original member must be an ordinary file: " + str(path))
    return path


def identity(path):
    path = ordinary(path)
    return {"bytes": path.stat().st_size, "sha256": sha(path)}


def read(path):
    return json.loads(ordinary(path).read_text(encoding="utf-8"))


def delivery_inventory(delivery):
    rows = []
    for path in sorted(delivery.rglob("*")):
        if path.is_symlink():
            raise ValueError("Original delivery must not contain symlinks: " + str(path))
        if path.is_file() and path.relative_to(delivery).as_posix() != "native-sources.json":
            rows.append({"path": path.relative_to(delivery).as_posix(), **identity(path)})
    if not any(row["path"] == "Upper_Savannah_Watershed_Review.html" for row in rows):
        raise ValueError("Complete original HTML body is absent")
    return rows


def make_review_plan(args, selected, data, collection, source_id, project_sha, plan_id, as_of):
    from model.implementation import make_plan
    title=args.title or 'Upper Savannah saved watershed review queue'
    plan=make_plan(plan_id,title,as_of,description='Editable desktop-review and field-planning tasks from the selected saved review. Recorded notes are retained exactly; due dates, visits, costs, access and sampling designs remain unset until actually chosen.')
    source_link={'id':'retained-review-source','kind':'workspace_source_collection','label':'Original watershed review source edition','reference':'urn:upstate:source-collection:'+collection['id'],'source_id':source_id,'source_digest':collection['id']}
    plan['source_links']=[source_link]
    plan['watershed_review']={'schema':'upstate.native-review-link/v1','source_collection_id':collection['id'],'source_id':source_id,'original_project_sha256':project_sha,'source_edition':data['edition'],'settings':selected['settings'],'review_saved_at':selected['saved_at'],'interpretation':'Review preferences and recorded questions; no native modeled-benefit field is inferred from a preference score.'}
    rows={r['huc12']:r for r in data['rows']}
    for h,n in selected['notes'].items():
        if not n['queued']:continue
        row=rows[h];cid='huc-'+h
        plan['candidates'].append({'id':cid,'label':row['name']+' ('+h+')','area_ha':row['area_ha'],'source':{'source_link_id':source_link['id'],'source_id':source_id,'source_digest':collection['id'],'source_kind':'workspace_source_collection','original_huc12':h,'original_profile':row},'modeled_benefits':[],'review_disposition':n['status']})
        plan['tasks'].append({'id':'review-'+h,'title':n['question'] or 'Review original sources for '+row['name'],'candidate_id':cid,'phase':'field-planning' if n['status']=='Field follow-up' else 'desktop-review','assignee':n['reviewer'],'status':'planned','duration_days':None,'progress_pct':0,'depends_on':[],'evidence_refs':[source_link['id']],'notes':n['notes'],'original_huc12':h,'review_disposition':n['status'],'original_review_updated_at':n['updated_at']})
    return plan


def verify_plan(ws, store, plan_id, project_sha, collection_id, source_id, edition, dataset_identity):
    plan = store.get(plan_id)
    link = plan.get("watershed_review", {})
    wanted = {"original_project_sha256": project_sha, "source_id": source_id,
              "source_edition": edition}
    if any(link.get(key) != value for key, value in wanted.items()):
        raise ValueError("Native plan belongs to another original review/source")
    if link.get("source_collection_id") != collection_id:
        # A maintained desk/UI upgrade changes the source collection even when
        # the exact original scientific dataset and saved review are unchanged.
        # Keep the plan's original source; verify the complete original dataset
        # instead of silently rebinding that frozen native provenance.
        _, original_source = ws.source_file(link["source_collection_id"], source_id)
        matches = [item for item in original_source["companions"]
                   if item.get("view_path", item.get("filename")) == "data/dataset.json"]
        if len(matches) != 1 or {key: matches[0][key] for key in ("bytes", "sha256")} != dataset_identity:
            raise ValueError("Updated desk has another original scientific dataset")
    return plan


def attachment(store, plan, original, project_sha):
    # attach_file itself is idempotent by the original SHA and enforces the current
    # revision. A concurrent edit produces a normal conflict; the next intake
    # fetches that current revision and preserves its whole document.
    original = ordinary(original)
    if sha(original) != project_sha:
        raise ValueError("Retained original review bytes changed")
    # A later manual edit may remove a visible attachment link. Its original
    # committed attachment event and retained bytes remain sufficient; replay
    # must not re-add a deliberately removed link to the current document.
    for event in reversed(store.history(plan["id"])):
        historical = store.get(plan["id"], event["revision"])
        link = next((row for row in historical["source_links"]
                     if row.get("id") == "file_" + project_sha[:24]), None)
        if link is None:
            continue
        if (link.get("kind") != "local_file" or link.get("sha256") != project_sha or
                link.get("size_bytes") != original.stat().st_size):
            raise ValueError("Original attachment source binding differs")
        reference = Path(link["reference"])
        bank = store.root / "implementation" / "plans" / plan["id"] / "attachments"
        path = store.root / reference
        if (reference.is_absolute() or ".." in reference.parts or
                path.parent != bank or path.is_symlink() or bank.is_symlink()):
            raise ValueError("Original attachment left its native bank")
        from model.common import atomic_bytes
        atomic_bytes(path, original.read_bytes(), immutable=True)
        if identity(path) != {"bytes": link["size_bytes"], "sha256": project_sha}:
            raise ValueError("Original attached review bytes differ")
        return store.get(plan["id"])
    result = store.attach_file(
        plan["id"], original, expected_revision=plan["revision"],
        actor="ECO-CLOUD-REVIEW13", label="Original saved watershed review project")
    item = result["source_link"]
    retained = ordinary(Path(result["file_ref"]))
    if item.get("sha256") != project_sha or identity(retained) != {
            "bytes": item.get("size_bytes"), "sha256": project_sha}:
        raise ValueError("Native original-review attachment differs")
    return result["plan"]


def report_sources(app):
    return [{"path": "model/" + name, **identity(app / "model" / name)}
            for name in ("implementation.py", "implementation_schema.py",
                         "implementation_reporting.py")]


def selected_report(store, out, app, plan, as_of):
    from model.common import atomic_json, read_json, digest
    from model.implementation import document_digest
    from model.portable_implementation import report_edition
    selection_path = out / "report-selection.json"
    target = out / "native-plan-report"
    if selection_path.exists():
        selected = read(selection_path)
        frozen = store.get(selected["plan_id"], selected["revision"])
        if (selected.get("schema") != "upstate.watershed-review-report/v1" or
                selected["plan_id"] != plan["id"] or selected["as_of"] != as_of or
                selected["document_digest"] != document_digest(frozen)):
            raise ValueError("Original report selection differs")
    elif (target / "manifest.json").exists():
        # Original v1 receiving outputs already have a fully bound native report.
        # Adopt its actual revision rather than the later editable plan head.
        old = report_edition(store, target)
        if old["plan_id"] != plan["id"] or old["as_of"] != as_of:
            raise ValueError("Existing report belongs to another original selection")
        selected = {"schema": "upstate.watershed-review-report/v1",
                    "plan_id": old["plan_id"], "revision": old["revision"],
                    "document_digest": old["document_digest"], "as_of": as_of,
                    "renderer_sources": None}
        atomic_json(selection_path, selected, immutable=True)
    else:
        selected = {"schema": "upstate.watershed-review-report/v1",
                    "plan_id": plan["id"], "revision": plan["revision"],
                    "document_digest": document_digest(plan), "as_of": as_of,
                    "renderer_sources": report_sources(app)}
        atomic_json(selection_path, selected, immutable=True)

    if not (target / "manifest.json").exists():
        if selected["renderer_sources"] != report_sources(app):
            raise ValueError("Resume the original unfinished report with its retained application source")
        if target.exists():
            if target.is_symlink() or not target.is_dir():
                raise ValueError("Partial report is not an ordinary directory")
            # Native report() publishes its manifest last. Keep every incomplete
            # byte under the owned output, then retry the same frozen revision.
            members = [{"path": p.relative_to(target).as_posix(), **identity(p)}
                       for p in sorted(target.rglob("*")) if p.is_file() or p.is_symlink()]
            retired = Path(tempfile.mkdtemp(prefix="incomplete-report-", dir=out))
            atomic_json(retired / "members.json", members, immutable=True)
            os.rename(target, retired / "report")
        store.report(selected["plan_id"], target, as_of=as_of,
                     revision=selected["revision"])
    inspected = report_edition(store, target)
    for key in ("plan_id", "revision", "as_of", "document_digest"):
        if inspected[key] != selected[key]:
            raise ValueError("Completed native report differs from its frozen selection")
    retained = store.retain_report(target)
    export = out / "native-plan.json"
    from model.implementation import canonical_bytes
    from model.common import atomic_bytes
    atomic_bytes(export, canonical_bytes(store.get(
        selected["plan_id"], selected["revision"])) + b"\n", immutable=True)
    return inspected, retained


def intake(args):
    app = args.application.resolve(strict=True)
    delivery = args.delivery.resolve(strict=True)
    raw_out = args.output.expanduser().absolute()
    if raw_out.is_symlink():
        raise ValueError("Receiving output must not be a symlink")
    out = raw_out.resolve()
    if out == delivery or out.is_relative_to(delivery) or delivery.is_relative_to(out):
        raise ValueError("Receiving output and original delivery must be separate directories")
    sys.path.insert(0, str(app))
    from model.workspace import Workspace
    from model.implementation import ImplementationStore, validate_plan
    from model.common import atomic_bytes, atomic_json, digest, held
    ws = Workspace(args.workspace.resolve(strict=True))
    store = ImplementationStore(ws)
    original_project = dict(ws.project)
    data = read(delivery / "data/dataset.json")
    members = delivery_inventory(delivery)
    project_body = None
    project_sha = None
    selected = None
    as_of = args.as_of
    if args.review_project:
        project_body = ordinary(args.review_project.resolve(strict=True)).read_bytes()
        project_sha = hashlib.sha256(project_body).hexdigest()
        selected = json.loads(project_body)
        if as_of is None:
            as_of = datetime.fromisoformat(selected["saved_at"].replace("Z", "+00:00")).date().isoformat()
    if as_of is not None:
        datetime.strptime(as_of, "%Y-%m-%d")
    wanted = {"schema": SELECTION_SCHEMA, "project_id": ws.project["id"],
              "workspace": str(ws.root.resolve()), "output": str(out),
              "source_edition": data["edition"], "delivery_members": members,
              "review": None if project_body is None else
                  {"bytes": len(project_body), "sha256": project_sha},
              "title": args.title, "as_of": as_of}
    out.mkdir(parents=True, exist_ok=True)
    with held(out / ".native-intake.lock", blocking=False):
        selection_path = out / "intake-selection.json"
        if selection_path.exists():
            frozen = read(selection_path)
            if frozen.get("request") != wanted:
                raise ValueError("This receiving output belongs to a different original selection")
        else:
            allowed = {".native-intake.lock", "native-receiving.json",
                       "native-plan.json", "native-plan-report"}
            if any(p.name not in allowed for p in out.iterdir()):
                raise ValueError("Existing output has no matching original receiving selection")
            # Adopt an original completed result only after matching its original
            # source/project/review. An empty original v1 output can resume too.
            if (out / "native-receiving.json").exists():
                previous = read(out / "native-receiving.json")
                if (previous.get("schema") != "upstate.watershed-review-native-receiving/v1" or
                        previous.get("project_id") != ws.project["id"] or
                        previous.get("source_edition") != data["edition"] or
                        (previous.get("plan") or {}).get("saved_project_sha256") != project_sha):
                    raise ValueError("Original receiving result belongs to another selection")
            frozen = {"request": wanted,
                      "original_plans": {p["id"]: p["revision"] for p in store.list_plans()}}
            atomic_json(selection_path, frozen, immutable=True)
        if project_body is not None:
            project = out / "original-review.json"
            atomic_bytes(project, project_body, immutable=True)
            code = """import fs from 'node:fs';import{pathToFileURL}from'node:url';
const{restoreProject}=await import(pathToFileURL(process.argv[1]));
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const p=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const r=restoreProject(p,d);console.log(JSON.stringify({...p,settings:r.state,notes:r.notes}));"""
            validated = subprocess.run(
                ["node", "--input-type=module", "-e", code,
                 str(delivery / "source/review_core.mjs"),
                 str(delivery / "data/dataset.json"), str(project)],
                check=True, capture_output=True, text=True, timeout=30)
            selected = json.loads(validated.stdout)
            if not any(note["queued"] for note in selected["notes"].values()):
                raise ValueError("Saved project has no queued review records; receive the desk without --review-project")
        # Freeze and recheck every original source byte before source/plan mutation.
        if delivery_inventory(delivery) != members:
            raise ValueError("Original delivery changed during receiving")
        source_id = "upper-savannah-watershed-review-desk-20261013"
        primary = "Upper_Savannah_Watershed_Review.html"
        by_name = {row["path"]: row for row in members}
        sources = {"schema": "upstate.sources/v1",
                   "title": "Upper Savannah 217 watershed review desk and complete original context",
                   "captured_at": "2026-10-13",
                   "scope": {"source_edition": data["edition"], "reference_huc12_count": 217,
                             "classification_years": [2023, 2025],
                             "assessment_edition": "South Carolina 2026 draft"},
                   "notes": ["Analyst preferences over retained mapped classifications; source observations and existing native model quantities remain distinct.",
                             "All original table, geometry, implementation source, completed preference analyses and saved receiving examples remain retained."],
                   "entries": [{"id": source_id, "kind": "document",
                                "title": "Upper Savannah watershed review desk",
                                "uri": "urn:sha256:" + by_name[primary]["sha256"],
                                "vintage": "2023 and 2025 classification; retained 2026 draft context; 2026-10-13 review edition",
                                "path": primary, "sha256": by_name[primary]["sha256"],
                                "source_edition": data["edition"],
                                "purpose": "Editable analyst review, questions and fieldwork preparation",
                                "companions": [{"path": row["path"], "sha256": row["sha256"]}
                                               for row in members if row["path"] != primary]}]}
        manifest = delivery / "native-sources.json"
        expected = json.dumps(sources, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        atomic_bytes(manifest, expected.encode("utf-8"), immutable=True)
        collection = ws.import_sources(manifest)
        source_view, source = ws.source_file(collection["id"], source_id)
        if identity(source_view) != {key: by_name[primary][key] for key in ("bytes", "sha256")}:
            raise ValueError("Retained desk body differs from its original")
        result = {"schema": "upstate.watershed-review-native-receiving/v1",
                  "project_id": ws.project["id"], "source_edition": data["edition"],
                  "source_collection_id": collection["id"], "source_id": source_id,
                  "source_view": str(source_view), "source_sha256": sha(source_view),
                  "source_member_count": len(members), "original_plans": frozen["original_plans"]}
        if selected is not None:
            plan_id = "watershed-review-" + project_sha[:24]
            # Serialize only this original saved-review intake across outputs.
            # ImplementationStore keeps its own short native revision locks.
            with held(ws.root / "implementation" / (".review-" + project_sha + ".lock"), blocking=False):
                exists = next((p for p in store.list_plans() if p["id"] == plan_id), None)
                if exists is None:
                    plan = make_review_plan(args, selected, data, collection,
                                            source_id, project_sha, plan_id, as_of)
                    plan = store.create(validate_plan(plan), actor="ECO-CLOUD-REVIEW13")
                plan = verify_plan(ws, store, plan_id, project_sha, collection["id"], source_id, data["edition"],
                                   {key: by_name["data/dataset.json"][key] for key in ("bytes", "sha256")})
                plan = attachment(store, plan, project, project_sha)
                inspected, retained = selected_report(store, out, app, plan, as_of)
                reported = store.get(plan_id, inspected["revision"])
                result["plan"] = {
                    "id": plan_id, "revision": reported["revision"],
                    "original_source_collection_id": reported["watershed_review"]["source_collection_id"],
                    "action": "received_original_preserving_current_edits",
                    "task_count": len(reported["tasks"]),
                    "candidate_count": len(reported["candidates"]),
                    "report_id": retained["id"], "report_directory": inspected["directory"],
                    "retained_report_directory": retained["directory"],
                    "saved_project_sha256": project_sha}
        if ws.project != original_project:
            raise ValueError("Original project identity changed during additive intake")
        complete = out / "native-receiving.json"
        if complete.exists():
            previous = read(complete)
            # Preserve original v1 action wording and selected revision verbatim.
            for key in ("project_id", "source_edition", "source_collection_id", "source_id",
                        "source_sha256", "source_member_count"):
                if previous.get(key) != result[key]:
                    raise ValueError("Retained native result differs from the original source")
            if bool(previous.get("plan")) != bool(result.get("plan")):
                raise ValueError("Retained native result has another plan selection")
            if result.get("plan"):
                for key in ("id", "revision", "report_id", "saved_project_sha256"):
                    if previous["plan"].get(key) != result["plan"][key]:
                        raise ValueError("Retained native result has another original report")
            return previous
        atomic_json(complete, result, immutable=True)
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("application", "workspace", "delivery", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--review-project", type=Path)
    parser.add_argument("--title")
    parser.add_argument("--as-of")
    arguments = parser.parse_args()
    try:
        print(json.dumps(intake(arguments), ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as exc:
        print("Review intake stopped: " + str(exc), file=sys.stderr)
        if isinstance(exc, subprocess.CalledProcessError) and exc.stderr:
            print(exc.stderr, file=sys.stderr)
        raise SystemExit(1)
