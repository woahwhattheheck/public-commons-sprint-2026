#!/usr/bin/env python3
"""Deliver the completed original county source and editable GIS workspace.

Consumes retained native results. It does not rerun the county admission,
collection export, GIS operations, or any scientific model.
"""
from __future__ import annotations

import argparse
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
from model.common import atomic_json, digest, held, identifier
from model.workspace import Workspace
from model import portable

SCHEMA = "upstate.county-source-delivery/v1"
PROJECT = "c6095eb6-b080-42e5-b89e-0d36accb98f4"


def sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def checked(path: Path, expected: dict) -> Path:
    if not path.is_file() or path.is_symlink():
        raise ValueError("A retained delivery file is missing or indirect: " + str(path))
    if path.stat().st_size != expected["bytes"] or sha256(path) != expected["sha256"]:
        raise ValueError("A retained delivery file differs from its native result: " + str(path))
    return path


def contained(root: Path, relative: str) -> Path:
    name = PurePosixPath(relative)
    if not relative or name.is_absolute() or ".." in name.parts or "\\" in relative:
        raise ValueError("Use an application-relative original member: " + str(relative))
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError("An original member leaves its retained workspace.")
    return path


def unpack(source: Path, destination: Path) -> None:
    """Extract an already-produced delivery without accepting path aliases."""
    destination.mkdir()
    with zipfile.ZipFile(source) as archive:
        names = set()
        for member in archive.infolist():
            name = PurePosixPath(member.filename)
            mode = (member.external_attr >> 16) & 0o170000
            if (name.is_absolute() or ".." in name.parts or "\\" in member.filename
                    or mode == 0o120000 or member.filename in names):
                raise ValueError("Unsafe or duplicate delivered member: " + member.filename)
            names.add(member.filename)
        archive.extractall(destination)


def inventory(root: Path) -> dict:
    return {path.relative_to(root).as_posix(): {
        "bytes": path.stat().st_size, "sha256": sha256(path)}
        for path in sorted(root.rglob("*")) if path.is_file() and path != root / "delivery.json"}


def verify_delivery(destination: Path, binding: dict) -> dict:
    manifest = json.loads((destination / "delivery.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA or manifest.get("binding") != binding:
        raise ValueError("This destination belongs to a different original county selection.")
    actual = inventory(destination)
    if actual != manifest["files"]:
        raise ValueError("The existing delivery was edited; choose a new output directory.")
    return manifest


def page(binding: dict, county_rows: list[dict], context_html: str,
         context_csv: str, has_review: bool) -> str:
    esc = html.escape
    population = sum(int(row["pop_est_2025_v2025"]) for row in county_rows)
    # The table keeps the publisher's strings, including zero-prefixed identifiers.
    columns = list(county_rows[0]) if county_rows else []
    headings = "".join("<th scope=\"col\">" + esc(key) + "</th>" for key in columns)
    rows = "".join("<tr>" + "".join("<td>" + esc(str(row.get(key, ""))) + "</td>"
                                      for key in columns) + "</tr>" for row in county_rows)
    review = ('<p><a href="vector-review/review.html">Open the original working-vector review</a></p>'
              if has_review else "")
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upstate county source and GIS handover</title><style>
:root{{color-scheme:light;font:16px/1.55 system-ui,sans-serif;color:#222;background:#f4f4f4}}
*{{box-sizing:border-box}}body{{margin:0}}header,main,footer{{max-width:1120px;margin:auto;padding:28px}}
header{{border-bottom:1px solid #999}}h1{{font-size:32px;line-height:1.2;margin:10px 0 18px}}
h2{{font-size:22px;margin:0 0 12px}}h3{{font-size:17px}}p{{max-width:86ch}}
a{{color:#222;text-underline-offset:3px}}a:focus-visible,summary:focus-visible{{outline:3px solid #333;outline-offset:4px}}
.kicker{{font-size:12px;letter-spacing:.12em;text-transform:uppercase}}.intro{{color:#444}}
.stats{{display:flex;gap:30px;flex-wrap:wrap;margin:22px 0 0}}.stat strong{{font-size:26px;display:block}}
.stat span{{font-size:13px;color:#444}}section{{background:#fff;border:1px solid #bbb;padding:24px;margin-bottom:20px}}
.actions{{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}}.action{{display:inline-block;border:1px solid #555;background:#eee;padding:10px 15px;min-height:44px;text-decoration:none}}
.action.primary{{background:#222;color:#fff}}.two{{display:grid;grid-template-columns:1fr 1fr;gap:28px}}
.table{{overflow:auto;max-height:520px;border:1px solid #ccc}}table{{border-collapse:collapse;min-width:100%;font-size:13px}}
th,td{{padding:9px 12px;border-bottom:1px solid #ddd;text-align:left;white-space:nowrap}}th{{background:#eee;position:sticky;top:0}}
pre{{overflow:auto;background:#eee;padding:15px;font-size:13px;line-height:1.6}}code{{overflow-wrap:anywhere}}
small,.muted{{color:#555}}details{{margin-top:16px}}summary{{cursor:pointer;min-height:44px;padding:9px 0}}
footer{{font-size:13px;color:#555}}@media(max-width:650px){{header,main,footer{{padding:20px}}h1{{font-size:27px}}section{{padding:18px}}.two{{grid-template-columns:1fr}}.stats{{gap:20px}}.action{{width:100%}}}}
</style></head><body><header><div class="kicker">Ecosystem Sciences / Upstate source desk</div>
<h1>County sources, ready to inspect and continue</h1>
<p class="intro">One original project carries the publisher's ten-county map, dated population context,
complete source files and an editable GIS handover. Open the map first, inspect its source files,
then continue the same working project.</p>
<div class="stats"><div class="stat"><strong>{len(county_rows)}</strong><span>Original counties</span></div>
<div class="stat"><strong>{population:,}</strong><span>2025 whole-county population estimate</span></div>
<div class="stat"><strong>QGIS + GeoPackage</strong><span>Editable geographic delivery</span></div></div></header>
<main><section><h2>Open the geographic work</h2>
<p>The offline GIS viewer exposes the working county layer, original documents, source metadata and relative project links.
The QGIS project and GeoPackage remain editable. Keep the complete extracted GIS directory together when moving it.</p>
<div class="actions"><a class="action primary" href="gis/OPEN_GIS.html">Open the county GIS viewer</a>
<a class="action" href="County_Editable_GIS.zip" download>Save the complete GIS handover</a>
<a class="action" href="gis/project.qgz" download>Open the QGIS project</a></div>{review}</section>
<section><h2>Read the original county context</h2>
<p>The population figures describe whole counties at their recorded source vintage. Watershed boundaries,
utility service areas and supplied drinking-water population remain separate geographic questions.</p>
<div class="actions"><a class="action" href="{esc(context_html, quote=True)}">Read source definitions and county context</a>
<a class="action" href="{esc(context_csv, quote=True)}" download>Download the complete original CSV</a>
<a class="action" href="sources/START.html">Inspect the complete original collection</a></div>
<details><summary>View all original county records</summary><div class="table" tabindex="0" role="region" aria-label="Complete original county context table"><table><thead><tr>{headings}</tr></thead><tbody>{rows}</tbody></table></div></details>
<p class="muted">Column names and identifier strings in the table are retained exactly from the selected source.</p></section>
<section><h2>Continue the complete working project</h2><div class="two"><div>
<h3>For a GIS analyst</h3><p>Extract <code>County_Editable_GIS.zip</code> and open <code>project.qgz</code> in QGIS.
Keep <code>layers/</code>, <code>originals/</code> and <code>documents/</code> next to the project.
Use the complete package when returning the working edition to the application's Editable GIS desk.</p></div><div>
<h3>For the application operator</h3><p><code>County_Complete_Workspace.zip</code> contains the full application and original project history.
Use the maintained restore command below in a new directory, then start the received operator.</p></div></div>
<pre>python application/model/cli.py restore County_Complete_Workspace.zip received-county
python received-county/application/operator/server.py --workspace received-county/workspace</pre>
<p>For a first installation, unpack the application folder from the workspace ZIP to access that restore command.
The received operator prints its local opening address. Keep that address within the receiving workstation.</p>
<p><a href="COUNTY_SOURCE_DELIVERY.md">Read the complete operating guide</a> · <a href="County_Original_Sources.zip" download>Save the original source collection</a></p></section>
<section><h2>Trace the saved work</h2><p>The retained course carries original source admission, complete collection receiving,
editable GIS export, independent receiving, source adoption, re-export and restart in project
<code>{esc(binding['project_id'])}</code>.</p>
<details><summary>Show technical source bindings</summary><pre>{esc(json.dumps(binding,indent=2,ensure_ascii=False))}</pre>
<p><a href="delivery.json">Complete file and source register</a></p></details></section></main>
<footer>Prepared from retained original sources and completed native operations on 13 October 2026.
Open <code>START_HERE.html</code> after extracting the review package. All review links are local.</footer></body></html>'''


def deliver(workspace: Path, result_path: Path, output: Path) -> dict:
    workspace = workspace.resolve(strict=True)
    output = output.resolve()
    result = json.loads(result_path.read_text(encoding="utf-8"))
    ws = Workspace(workspace)
    if ws.project["id"] != PROJECT or result.get("project_id") != PROJECT:
        raise ValueError("Use the original c6095 county project and its own completed receiving result.")
    gis_result = result.get("gis_receiving", {})
    collection = result.get("collection_receiving", {})
    if result.get("status") != "passed" or not gis_result.get("restart_reopened") or not collection.get("restart_same_collection"):
        raise ValueError("Finish the original county source, collection and GIS receiving course first.")
    if output.is_relative_to(workspace) or workspace.is_relative_to(output):
        raise ValueError("Keep the delivery directory separate from the working project.")
    if output.is_relative_to(APPLICATION) or APPLICATION.is_relative_to(output):
        raise ValueError("Keep the delivery directory separate from application source.")
    binding = {"project_id": PROJECT, "parent_source_collection_id": result["parent_source_collection_id"],
               "parent_source_id": result["parent_source_id"], "parent_sha256": result["parent_sha256"],
               "source_collection_id": result["source_collection_id"],
               "original_counties": result["original_counties"],
               "original_collection_id": collection["collection_id"],
               "gis_export_id": gis_result["reexport_id"],
               "gis_received_id": gis_result["received_reexport_id"],
               "receiving_result_sha256": sha256(result_path),
               "application_sha256": portable.application_digest()}
    output.parent.mkdir(parents=True, exist_ok=True)
    with held(output.parent / ("." + output.name + ".lock"), blocking=False):
        if output.exists():
            return verify_delivery(output, binding)
        staging = Path(tempfile.mkdtemp(prefix="." + output.name + ".pending-", dir=output.parent))
        try:
            gis_id = identifier(gis_result["reexport_id"])
            source_id = identifier(collection["collection_id"])
            gis_archive = checked(workspace / "gis-exports" / gis_id / "editable-gis.zip", gis_result["delivery"])
            source_archive = checked(workspace / "intelligence/source-collections" / source_id / "sources.zip", collection["zip"])
            shutil.copyfile(gis_archive, staging / "County_Editable_GIS.zip")
            shutil.copyfile(source_archive, staging / "County_Original_Sources.zip")
            unpack(gis_archive, staging / "gis")
            unpack(source_archive, staging / "sources")
            contexts = [row for row in result["admitted_sources"] if row.get("role") == "dated_county_context"]
            if len(contexts) != 1:
                raise ValueError("The original admission must identify one dated county context.")
            path, entry = ws.source_file(result["source_collection_id"], contexts[0]["source_id"])
            checked(path, entry["body"])
            with path.open(encoding="utf-8", newline="") as stream:
                county_rows = list(csv.DictReader(stream))
            if len(county_rows) != len(result["original_counties"]):
                raise ValueError("The retained county context is incomplete.")
            context = staging / "county-context"
            context.mkdir()
            filename = "upstate_county_population_v2025.csv"
            shutil.copyfile(path, context / filename)
            for item in entry.get("companions", []):
                source = checked(contained(workspace, item["object"]), item)
                member = PurePosixPath(item["filename"])
                if len(member.parts) != 1 or member.name in {".", ".."} or "\\" in str(member):
                    raise ValueError("Unexpected county context companion name.")
                target = context / member.name
                if target.exists():
                    raise ValueError("Duplicate county context companion name.")
                shutil.copyfile(source, target)
            context_html = "county-context/county-population-context.html"
            if not (staging / context_html).is_file():
                raise ValueError("The original human-readable county context is missing.")
            review_id = gis_result.get("vector_review_id")
            has_review = False
            if review_id:
                from model import gis_vector_review
                review = gis_vector_review.inspect(ws, identifier(review_id))
                if review["selection"]["receipt_id"] != gis_result["received_id"]:
                    raise ValueError("The vector review belongs to another received county edition.")
                review_root = staging / "vector-review"
                review_root.mkdir()
                for name, descriptor in review["files"].items():
                    source = checked(contained(workspace, descriptor["path"]), descriptor)
                    if name not in {"review.json", "feature-changes.csv", "review.html", "vector-review.zip"}:
                        raise ValueError("Unexpected original vector-review member.")
                    shutil.copyfile(source, review_root / name)
                has_review = True
            guide = APPLICATION / "COUNTY_SOURCE_DELIVERY.md"
            shutil.copyfile(guide, staging / guide.name)
            shutil.copyfile(result_path, staging / "native-receiving-result.json")
            (staging / "START_HERE.html").write_text(
                page(binding, county_rows, context_html, "county-context/" + filename, has_review), encoding="utf-8")
            workspace_archive = portable.backup(ws, staging / "County_Complete_Workspace.zip")
            # Original path values remain provenance. The delivered entry is relative.
            workspace_archive["path"] = "County_Complete_Workspace.zip"
            manifest = {"schema": SCHEMA, "id": digest(binding), "binding": binding,
                        "entry": "START_HERE.html", "workspace_archive": workspace_archive,
                        "files": inventory(staging)}
            atomic_json(staging / "delivery.json", manifest)
            os.rename(staging, output)
            return manifest
        except BaseException:
            # Retain partial native products for continuation and diagnosis.
            print("Retained unfinished delivery: " + str(staging), file=sys.stderr)
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True,
                        help="Completed original-county-admission-result.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = deliver(args.workspace, args.result, args.output)
    print(json.dumps({"id": manifest["id"], "entry": str(args.output / "START_HERE.html"),
                      "files": len(manifest["files"]),
                      "workspace_archive": manifest["workspace_archive"]}, indent=2))


if __name__ == "__main__":
    main()
