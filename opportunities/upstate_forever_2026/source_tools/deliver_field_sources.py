#!/usr/bin/env python3
"""Deliver the completed original Eighteenmile laboratory and field workspace.

Reuses retained report editions, original evidence packages and native receiving
results. It does not recompute observations, imports or reconciliation exercises.
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.common import atomic_json, digest, file_digest, held, identifier, read_json
from model.implementation import ImplementationStore, document_digest
from model.implementation_evidence import read_package
from model.portable_implementation import report_edition
from model.workspace import Workspace
from model import portable

SCHEMA = "upstate.field-source-delivery/v1"
PROJECT_ID = "dc92b8b9-6eda-4362-b12d-3cf2ef6c9007"
LAB_PLAN_ID = "eighteenmile-2023-original-lake-samples"


def relative_file(root: Path, name: str) -> Path:
    part = PurePosixPath(name)
    if (not name or part.is_absolute() or part.as_posix() != name
            or ".." in part.parts or "\\" in name or "\0" in name):
        raise ValueError("Use an ordinary retained relative member: " + repr(name))
    path = root.joinpath(*part.parts)
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
        raise ValueError("The selected original file is unavailable: " + name)
    return path


def verify(path: Path, size: int, checksum: str) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ValueError("The original file is unavailable: " + str(path))
    if path.stat().st_size != size or file_digest(path) != checksum:
        raise ValueError("The original file differs from its retained identity: " + str(path))
    return path


def inventory(root: Path) -> dict:
    return {path.relative_to(root).as_posix(): {
        "bytes": path.stat().st_size, "sha256": file_digest(path)}
        for path in sorted(root.rglob("*"))
        if path.is_file() and path != root / "delivery.json"}


def copy_report(store: ImplementationStore, selected: dict, output: Path) -> dict:
    original = Path(selected["directory"])
    inspected = report_edition(store, original)
    if inspected != selected:
        raise ValueError("The retained field report changed during selection.")
    output.mkdir()
    for name in inspected["members"]:
        shutil.copyfile(original / name, output / name)
    copied = report_edition(store, output)
    if copied != {**inspected, "directory": str(output)}:
        raise ValueError("The delivered field report differs from the original edition.")
    return {**inspected, "directory": output.name}


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def table(headers: list[str], records: list[list[str]], *, table_id: str) -> str:
    esc = html.escape
    head = "".join('<th scope="col">' + esc(name) + '</th>' for name in headers)
    body = "".join('<tr>' + ''.join('<td>' + esc(str(cell)) + '</td>' for cell in row)
                   + '</tr>' for row in records)
    return (f'<div class="table-wrap" tabindex="0" role="region" aria-label="{esc(table_id, quote=True)}">'
            f'<table id="{table_id}"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')


def entry_page(lab_plan: dict, visit_plan: dict, laboratory_rows: list[dict],
               station_rows: list[dict], source_rows: list[dict], binding: dict) -> str:
    esc = html.escape
    types = collections.Counter(row["result_type"] for row in lab_plan["observations"])
    display_columns = ["site_label", "collected_at", "parameter", "result_type", "original_text",
                       "value", "unit", "fraction", "qualifier", "detection_limit",
                       "quantitation_limit", "method", "qa_status"]
    observations = table(
        ["Station", "Collected at", "Parameter", "Type", "Original text", "Numeric value",
         "Unit", "Fraction", "Qualifier", "Detection limit", "Quantitation limit", "Method", "Status"],
        [[row.get(column, "") for column in display_columns] for row in laboratory_rows],
        table_id="laboratory-records")
    stations = table(
        ["Original station", "Description", "Latitude", "Longitude", "Declared datum"],
        [[row[name] for name in ("MonitoringLocationIdentifier", "MonitoringLocationDescriptionText",
                                "LatitudeMeasure", "LongitudeMeasure",
                                "HorizontalCoordinateReferenceSystemDatumName")]
         for row in station_rows], table_id="original-stations")
    source_links = ''.join(
        '<p><a href="' + esc(row['path'], quote=True) + '" download>' + esc(row['filename'])
        + '</a><br><small>' + str(row['bytes']) + ' original bytes; SHA256 <code>'
        + row['sha256'] + '</code></small></p>' for row in source_rows)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eighteenmile field and laboratory handover</title><style>
:root{{color-scheme:light;font:16px/1.5 system-ui,sans-serif;color:#222;background:#f3f3f3}}*{{box-sizing:border-box}}
body{{margin:0}}header,main,footer{{max-width:1180px;margin:auto;padding:28px}}header{{border-bottom:1px solid #999}}
.kicker{{font-size:12px;letter-spacing:.1em;text-transform:uppercase}}h1{{font-size:32px;line-height:1.2;margin:12px 0 18px}}
h2{{font-size:22px;margin-top:0}}h3{{font-size:17px}}p{{max-width:90ch}}a{{color:inherit;text-underline-offset:3px}}
.stats{{display:flex;gap:32px;flex-wrap:wrap;margin-top:22px}}.stats strong{{font-size:27px;display:block}}.stats span{{font-size:13px;color:#444}}
section{{background:white;border:1px solid #bbb;padding:24px;margin-bottom:20px}}.two{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}
.actions{{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 8px}}.action,button{{display:inline-block;min-height:44px;border:1px solid #555;padding:10px 14px;background:#eee;color:#222;font:inherit;text-decoration:none;cursor:pointer}}
.action.primary{{background:#222;color:white}}a:focus-visible,input:focus-visible,button:focus-visible,summary:focus-visible{{outline:3px solid #333;outline-offset:3px}}
.table-wrap{{overflow:auto;max-height:540px;border:1px solid #ccc}}table{{border-collapse:collapse;min-width:100%;font-size:13px}}
th,td{{padding:10px 12px;text-align:left;white-space:nowrap;border-bottom:1px solid #ddd}}th{{background:#eee;position:sticky;top:0;z-index:1}}
.filter{{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:16px 0}}.filter label{{flex:1;min-width:200px}}input{{display:block;margin-top:6px;width:100%;min-height:44px;padding:9px 12px;border:1px solid #888;font:inherit}}
small,.muted{{color:#555}}code{{overflow-wrap:anywhere}}pre{{overflow:auto;background:#eee;padding:16px;font-size:13px}}details{{margin-top:14px}}summary{{padding:9px 0;min-height:44px;cursor:pointer}}
footer{{font-size:13px;color:#555}}[hidden]{{display:none!important}}@media(max-width:650px){{header,main,footer{{padding:20px}}h1{{font-size:27px}}section{{padding:18px}}.two{{grid-template-columns:1fr}}.action{{width:100%}}.stats{{gap:20px}}}}
</style></head><body><header><div class="kicker">Ecosystem Sciences / Eighteenmile source desk</div>
<h1>Field records and laboratory originals, together</h1>
<p>The saved 2023 lake-sampling study and its original station and collection-event files travel in one complete working project.
Read either retained report, inspect every laboratory result, or reopen the application with its full source history.</p>
<div class="stats"><div><strong>{len(lab_plan['observations'])}</strong><span>Original laboratory results</span></div>
<div><strong>{len(visit_plan['sites'])}</strong><span>Original stations</span></div>
<div><strong>{len(visit_plan['visits'])}</strong><span>Recorded collection events</span></div>
<div><strong>{types.get('censored', 0)}</strong><span>Censored results retained</span></div></div></header>
<main><section><h2>Open the retained reports</h2><div class="two"><div><h3>Laboratory study</h3>
<p>The complete laboratory plan contains {types.get('numeric', 0)} numeric and {types.get('censored', 0)} censored results.
Original measurement text, units, fractions, qualifiers, methods and available limits stay attached to their records.</p>
<div class="actions"><a class="action primary" href="laboratory-report/report.html">Open laboratory report</a>
<a class="action" href="Eighteenmile_Original_Laboratory_Evidence.zip" download>Save plan and original laboratory files</a></div></div>
<div><h3>Station and collection-event register</h3>
<p>The separate onboarding plan retains all 88 original activity rows as 48 station/date/time events.
Its full audit also carries the 40 repeated event rows. Both plans describe the same original source course from different working views.</p>
<div class="actions"><a class="action" href="station-visit-report/report.html">Open station and visit report</a>
<a class="action" href="Eighteenmile_Original_Station_and_Visit_Evidence.zip" download>Save plan and original station/visit files</a></div></div></div></section>
<section><h2>Inspect all original laboratory records</h2><p>Filter the complete retained table by station, parameter, date, unit or qualifier.
Filtering changes only this view; the downloads always contain every original record. Read each result with its own method and fraction.</p>
<div class="filter"><label for="record-search">Search original laboratory records<input id="record-search" type="search" placeholder="Station, parameter, date or qualifier" autocomplete="off"></label>
<button id="clear-search" type="button">Clear search</button><span id="record-count" role="status" aria-live="polite">{len(laboratory_rows)} of {len(laboratory_rows)} records</span></div>
{observations}<div class="actions"><a class="action" href="laboratory-report/observations.csv" download>Download complete native results table</a>
<a class="action" href="sources/three-lake-results-2023-original.csv" download>Download unchanged original results CSV</a></div>
<p class="muted">Blank original cells remain blank. Censored records retain their original condition and available limits rather than becoming zero-valued measurements.</p></section>
<section><h2>Keep geography and collection time explicit</h2>{stations}
<p>These are the original published geographic coordinates in NAD83, retained natively as EPSG:4269.
The activity file declares EST; its saved collection times retain that fixed UTC-05:00 offset, including summer dates.</p>
<div class="actions"><a class="action" href="station-visit-report/visits.csv" download>Download all 48 collection events</a>
<a class="action" href="source-receiving/original-event-groups.json" download>Inspect all original event groupings</a></div>
<details><summary>Open the three unchanged original source files</summary>{source_links}</details></section>
<section><h2>Continue the complete working project</h2>
<div class="actions"><a class="action primary" href="Eighteenmile_Complete_Workspace.zip" download>Download complete editable project</a></div>
<p><code>Eighteenmile_Complete_Workspace.zip</code> contains the full application and original workspace, both retained plans,
all saved revisions, both report editions, original attachments and completed import history. Extract its <code>application/</code>
folder first to access the maintained receiving command, then restore into a new directory:</p>
<pre>python application/model/cli.py restore Eighteenmile_Complete_Workspace.zip received-field
python received-field/application/operator/server.py --workspace received-field/workspace</pre>
<p>The operator prints its local opening address. Use that address on the receiving workstation and choose the saved Implementation plan.
The evidence ZIPs also carry the unchanged plan and original files for the maintained evidence-import API.</p>
<p><a href="FIELD_SOURCE_DELIVERY.md">Read the complete handover guide</a> · <a href="delivery.json">Open the complete source and file register</a></p>
<details><summary>Show exact saved plan selections</summary><pre>{esc(json.dumps(binding['plans'], indent=2))}</pre></details></section></main>
<footer>Original 2023 source records, retained within project <code>{PROJECT_ID}</code>. Report dates remain those of their selected native editions.</footer>
<script>
(() => {{
 const search=document.getElementById('record-search');
 const rows=Array.from(document.querySelectorAll('#laboratory-records tbody tr'));
 const searchable=rows.map(row=>row.textContent.toLocaleLowerCase());
 function filter(){{const query=search.value.toLocaleLowerCase().trim();let shown=0;
  rows.forEach((row,index)=>{{row.hidden=Boolean(query)&&!searchable[index].includes(query);if(!row.hidden)shown++;}});
  document.getElementById('record-count').textContent=shown+' of '+rows.length+' records';}}
 search.addEventListener('input',filter);
 document.getElementById('clear-search').addEventListener('click',()=>{{search.value='';filter();search.focus();}});
}})();
</script></body></html>'''


def deliver(workspace: Path, onboarding_result: Path, evidence_directory: Path,
            output: Path, laboratory_report: str | None = None,
            station_visit_report: str | None = None) -> dict:
    workspace = workspace.resolve(strict=True)
    evidence_directory = evidence_directory.resolve(strict=True)
    output = output.resolve()
    ws = Workspace(workspace)
    if ws.project["id"] != PROJECT_ID:
        raise ValueError("Select the original dc92 Eighteenmile Workspace.")
    selected = read_json(onboarding_result)
    operation_id = identifier(selected["operation_id"])
    retained_result = workspace / "implementation/site-visit-receiving" / operation_id / "result.json"
    onboarding = read_json(retained_result)
    if (selected.get("project_id") != PROJECT_ID or onboarding.get("project_id") != PROJECT_ID
            or {k: v for k, v in selected.items() if k != "current_revision"} != onboarding):
        raise ValueError("Select the completed original site/visit receiving result.")
    if (onboarding["site_count"], onboarding["visit_count"], onboarding["original_activity_rows"],
            onboarding["repeated_event_rows_retained"]) != (3, 48, 88, 40):
        raise ValueError("The selected original station and event coverage differs.")
    evidence_path = evidence_directory / "receiving-result.json"
    evidence = read_json(evidence_path)
    if evidence.get("schema") != "upstate.field-evidence-receiving/v1":
        raise ValueError("Select the completed original evidence receiving directory.")
    records = evidence["results"]
    if len(records) != 2 or {row["plan_id"] for row in records} != {LAB_PLAN_ID, onboarding["plan_id"]}:
        raise ValueError("Deliver both original laboratory and station/visit plans exactly once.")
    store = ImplementationStore(ws)
    plans, packages = {}, {}
    for row in records:
        if row["project_id"] != PROJECT_ID or row["import_status"] not in {"created", "imported", "unchanged", "duplicate"}:
            raise ValueError("An evidence result is not a completed receiving operation in this project.")
        plan = store.get(row["plan_id"], row["exported_revision"])
        if document_digest(plan) != row["document_digest"]:
            raise ValueError("An evidence result identifies another native plan edition.")
        source = verify(relative_file(evidence_directory, row["archive"]), row["archive_bytes"], row["archive_sha256"])
        package = read_package(source)
        if document_digest(package["plan"]) != document_digest(plan):
            raise ValueError("The evidence ZIP differs from its selected native plan.")
        verify(relative_file(workspace, row["retained_import_archive"]), row["archive_bytes"], row["archive_sha256"])
        plans[row["plan_id"]] = plan
        packages[row["plan_id"]] = (row, package, source)
    lab_plan, visit_plan = plans[LAB_PLAN_ID], plans[onboarding["plan_id"]]
    if len(lab_plan["observations"]) != 88 or document_digest(visit_plan) != onboarding["document_digest"]:
        raise ValueError("The retained original results and onboarding edition do not match.")
    reports = [row for row in store.list_reports(LAB_PLAN_ID)
               if row["document_digest"] == document_digest(lab_plan)
               and (laboratory_report is None or row["id"] == laboratory_report)]
    if len(reports) != 1:
        raise ValueError("Select one retained laboratory report with --laboratory-report.")
    lab_report = reports[0]
    visit_report = report_edition(store, relative_file(workspace, onboarding["report"]["directory"] + "/manifest.json").parent)
    if visit_report != {**onboarding["report"], "directory": str(workspace / onboarding["report"]["directory"])}:
        raise ValueError("The original onboarding report selection differs.")
    if station_visit_report is not None:
        current_reports = [row for row in store.list_reports(onboarding["plan_id"])
                           if row["id"] == station_visit_report
                           and row["document_digest"] == document_digest(visit_plan)]
        if len(current_reports) != 1:
            raise ValueError("Select one retained station/visit report for the original plan edition.")
        visit_report = current_reports[0]
    binding = {"project_id": PROJECT_ID, "application_sha256": portable.application_digest(),
               "onboarding_operation_id": operation_id, "onboarding_result_sha256": file_digest(retained_result),
               "evidence_result_sha256": file_digest(evidence_path),
               "plans": {name: {"revision": plan["revision"], "document_digest": document_digest(plan)}
                         for name, plan in plans.items()},
               "reports": {"laboratory": lab_report["id"], "station_visit": visit_report["id"]}}
    for root in (workspace, APPLICATION, evidence_directory):
        if output.is_relative_to(root) or root.is_relative_to(output):
            raise ValueError("Keep the delivery separate from its source directories.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with held(output.parent / ("." + output.name + ".lock"), blocking=False):
        if output.exists():
            existing = read_json(output / "delivery.json")
            if existing.get("schema") != SCHEMA or existing.get("binding") != binding or existing["files"] != inventory(output):
                raise ValueError("The existing delivery differs; use a new output directory.")
            return existing
        staging = Path(tempfile.mkdtemp(prefix="." + output.name + ".pending-", dir=output.parent))
        try:
            copy_report(store, lab_report, staging / "laboratory-report")
            copy_report(store, visit_report, staging / "station-visit-report")
            sources = staging / "sources"
            sources.mkdir()
            source_rows = []
            seen_sources = set()
            for plan_id in (LAB_PLAN_ID, onboarding["plan_id"]):
                row, package, archive_path = packages[plan_id]
                shutil.copyfile(archive_path, staging / archive_path.name)
                with zipfile.ZipFile(archive_path) as archive:
                    for item in package["manifest"]["files"]:
                        filename = item["original_filename"]
                        if not filename.endswith(".csv"):
                            continue
                        if PurePosixPath(filename).name != filename or "\\" in filename:
                            raise ValueError("The original CSV filename is not a simple name.")
                        target = sources / filename
                        if filename in seen_sources:
                            verify(target, item["size_bytes"], item["sha256"])
                            continue
                        with archive.open(item["path"]) as source, target.open("xb") as destination:
                            shutil.copyfileobj(source, destination, 1024 * 1024)
                        verify(target, item["size_bytes"], item["sha256"])
                        seen_sources.add(filename)
                        source_rows.append({"filename": filename, "path": "sources/" + filename,
                                            "bytes": item["size_bytes"], "sha256": item["sha256"]})
            if seen_sources != {"three-lake-results-2023-original.csv", "three-lake-stations-original.csv",
                                "three-lake-activities-2023-original.csv"}:
                raise ValueError("The complete three original source tables are required.")
            receiving = staging / "source-receiving"
            receiving.mkdir()
            for name in ("result.json", "mappings.json", "original-event-groups.json"):
                shutil.copyfile(retained_result.parent / name, receiving / name)
            shutil.copyfile(evidence_path, receiving / "evidence-receiving-result.json")
            shutil.copyfile(APPLICATION / "FIELD_SOURCE_DELIVERY.md", staging / "FIELD_SOURCE_DELIVERY.md")
            laboratory_rows = read_csv(staging / "laboratory-report/observations.csv")
            station_rows = read_csv(sources / "three-lake-stations-original.csv")
            if len(laboratory_rows) != 88 or len(station_rows) != 3:
                raise ValueError("The delivered original table coverage differs.")
            (staging / "START_HERE.html").write_text(
                entry_page(lab_plan, visit_plan, laboratory_rows, station_rows, source_rows, binding), encoding="utf-8")
            workspace_archive = portable.backup(ws, staging / "Eighteenmile_Complete_Workspace.zip")
            workspace_archive["path"] = "Eighteenmile_Complete_Workspace.zip"
            if portable.application_digest() != binding["application_sha256"]:
                raise ValueError("The application changed during delivery; retain this staging and select the new source.")
            manifest = {"schema": SCHEMA, "id": digest(binding), "entry": "START_HERE.html", "binding": binding,
                        "original_sources": source_rows, "workspace_archive": workspace_archive,
                        "files": inventory(staging)}
            atomic_json(staging / "delivery.json", manifest)
            os.rename(staging, output)
            return manifest
        except BaseException:
            print("Retained unfinished delivery: " + str(staging), file=sys.stderr)
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--onboarding-result", type=Path, required=True)
    parser.add_argument("--evidence-directory", type=Path, required=True)
    parser.add_argument("--laboratory-report")
    parser.add_argument("--station-visit-report",
                        help="Retained report edition for the unchanged original station/visit plan")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = deliver(args.workspace, args.onboarding_result, args.evidence_directory,
                       args.output, args.laboratory_report, args.station_visit_report)
    print(json.dumps({"id": manifest["id"], "entry": str(args.output / "START_HERE.html"),
                      "files": len(manifest["files"]), "binding": manifest["binding"],
                      "workspace_archive": manifest["workspace_archive"]}, indent=2))


if __name__ == "__main__":
    main()
