"""Saved human decisions over exact retained original-source vector comparisons."""
from __future__ import annotations

import csv
import html
import hashlib
import io
import json
from pathlib import Path
import zipfile

from . import gis_project as gis
from . import gis_vector_review as reviews
from .common import identifier, file_digest

SCHEMA = "upstate.gis-review-decisions/v1"
DOCUMENT = "upstate.gis-review-decisions-transfer/v1"
FOLDER = "gis-review-decisions"
VERSION = "original-source-decisions-v1"
DISPOSITIONS = ("unreviewed", "accepted", "follow_up", "rejected")
LABELS = {"unreviewed": "Not reviewed", "accepted": "Accepted",
          "follow_up": "Follow up", "rejected": "Rejected"}


def _text(value, name, *, required=False, limit=16000):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(name + " must be text within " + str(limit) + " characters.")
    if required and not value.strip():
        raise ValueError("Enter " + name.lower() + ".")
    return value


def reference(workspace, review_id):
    summary = reviews.inspect(workspace, identifier(review_id))
    report = gis.load(gis.local(workspace.root, summary["files"]["review.json"]["path"]))
    # Project/root/receipt registration can change on an independent receiving
    # workspace. The full scientific comparison and received edition cannot.
    selection = report["selection"]
    binding = {"schema": report["schema"], "algorithm": selection["algorithm"],
               "received_edition_id": selection["received_edition_id"],
               "received_fingerprint": selection["received_fingerprint"],
               "layer_ids": selection["layer_ids"], "layers": report["layers"]}
    comparison_sha = gis.fingerprint(binding)
    rows = []
    for layer in report["layers"]:
        for row in layer["rows"]:
            key = gis.fingerprint({"layer_id": layer["layer_id"], "comparison": row})
            rows.append({"key": key, "layer_id": layer["layer_id"], "layer_title": layer["title"],
                         "comparison": row})
        # Layer schema/CRS findings get their own explicit decision. They must
        # remain reviewable even when every feature's XY/value comparison agrees.
        finding = {"status": "layer_definition", "fields": layer["fields"], "crs": layer["crs"],
                   "identity_field_missing": layer["identity_field_missing"],
                   "source_identity_field": layer["source_identity_field"]}
        rows.append({"key": gis.fingerprint({"layer_id": layer["layer_id"], "comparison": finding}),
                     "layer_id": layer["layer_id"], "layer_title": layer["title"], "comparison": finding})
    if len({row["key"] for row in rows}) != len(rows):
        raise ValueError("The retained comparison has ambiguous decision-row identities.")
    return {"summary": summary, "report": report, "comparison_sha256": comparison_sha, "rows": rows}


def normalize_decisions(value, ref):
    if not isinstance(value, list):
        raise ValueError("Choose a list of original comparison decisions.")
    keys = {row["key"] for row in ref["rows"]}
    seen, result = set(), []
    for row in value:
        if not isinstance(row, dict) or set(row) != {"key", "disposition", "note"}:
            raise ValueError("Each decision needs its exact key, disposition and note.")
        key = row["key"]
        if not isinstance(key, str) or key not in keys or key in seen:
            raise ValueError("A decision is duplicated or belongs to another scientific comparison.")
        seen.add(key)
        if row["disposition"] not in DISPOSITIONS:
            raise ValueError("Choose an original review disposition.")
        note = _text(row["note"], "Review note")
        if row["disposition"] != "unreviewed" or note:
            result.append({"key": key, "disposition": row["disposition"], "note": note})
    return sorted(result, key=lambda row: row["key"])


def _reviewer(value, decisions):
    reviewer = _text(value, "Reviewer label", limit=300)
    if any(row["disposition"] != "unreviewed" for row in decisions) and not reviewer.strip():
        raise ValueError("Enter a reviewer label for recorded review dispositions.")
    return reviewer


def _public(summary):
    return {key: summary[key] for key in
            ("id", "title", "reviewer", "review_id", "comparison_sha256", "previous_id",
             "counts", "imported_from")}


def catalog(workspace):
    result = []
    for path in sorted((workspace.root / FOLDER).glob("*/summary.json")):
        value = gis.load(path)
        _summary(workspace, value, path.parent.name)
        result.append(_public(value))
    return result


def _summary(workspace, value, key):
    if (value.get("schema") != SCHEMA or value.get("id") != key or
            value.get("project_id") != workspace.project["id"] or
            gis.fingerprint(value.get("identity")) != key or
            value.get("state") != "complete"):
        raise ValueError("The saved GIS review decision identity changed.")
    identity = value["identity"]
    for name in ("review_id", "comparison_sha256", "title", "reviewer", "previous_id", "imported_from"):
        if value.get(name) != identity.get(name):
            raise ValueError("The saved GIS decision summary changed: " + name)
    if identity.get("project_id") != workspace.project["id"] or identity.get("version") != VERSION:
        raise ValueError("This saved decision revision belongs to another original project or algorithm.")


def inspect(workspace, key, *, ref=None):
    key = identifier(key)
    root = workspace.root / FOLDER / key
    summary = gis.load(root / "summary.json")
    _summary(workspace, summary, key)
    expected = {"decisions.json", "comparison.json", "decisions.csv", "review.html",
                "MANIFEST.json", "review-decisions.zip"}
    if set(summary["files"]) != expected:
        raise ValueError("The complete saved review file set changed.")
    for name, row in summary["files"].items():
        if row["path"] != (Path(FOLDER) / key / name).as_posix():
            raise ValueError("A saved review member has another retained path.")
        gis.checked(workspace.root, row)
    ref = ref or reference(workspace, summary["review_id"])
    if ref["summary"]["id"] != summary["review_id"] or ref["comparison_sha256"] != summary["comparison_sha256"]:
        raise ValueError("Saved decisions belong to another original scientific comparison.")
    document = gis.load(root / "decisions.json")
    decisions = _document(document, ref)
    if (gis.fingerprint(decisions) != summary["identity"]["decisions_sha256"]
            or document["origin"]["snapshot_id"] != key
            or document["title"] != summary["title"] or document["reviewer"] != summary["reviewer"]
            or gis.load(root / "comparison.json") != ref["report"]
            or summary["counts"] != _counts(ref, decisions)
            or document["origin"]["project_id"] != workspace.project["id"]
            or document["origin"]["review_id"] != summary["review_id"]):
        raise ValueError("The saved review decision content changed.")
    return {**summary, "decisions": decisions, "document": document}


def _document(document, ref):
    if (not isinstance(document, dict) or document.get("schema") != DOCUMENT
            or document.get("comparison_sha256") != ref["comparison_sha256"]):
        raise ValueError("Import decisions for this exact original scientific comparison.")
    _text(document.get("title"), "Review title", required=True, limit=300)
    _text(document.get("reviewer"), "Reviewer label", limit=300)
    origin = document.get("origin")
    if not isinstance(origin, dict) or any(not isinstance(origin.get(k), str)
                                          for k in ("project_id", "review_id", "snapshot_id")):
        raise ValueError("The decision document needs its retained origin identities.")
    decisions = normalize_decisions(document.get("decisions"), ref)
    _reviewer(document["reviewer"], decisions)
    return decisions


def view(workspace, review_id, snapshot_id=None):
    ref = reference(workspace, review_id)
    saved = inspect(workspace, snapshot_id, ref=ref) if snapshot_id else None
    return {"review": ref["summary"], "comparison_sha256": ref["comparison_sha256"],
            "rows": ref["rows"], "snapshot": saved, "dispositions": LABELS,
            "revisions": [row for row in catalog(workspace) if row["review_id"] == ref["summary"]["id"]]}


def feature(workspace, review_id, row_key):
    """Read selected original features only, retaining native IDs and coordinates."""
    import fiona
    ref = reference(workspace, review_id)
    rows = [row for row in ref["rows"] if row["key"] == row_key]
    if len(rows) != 1:
        raise ValueError("Choose one exact retained comparison row.")
    selected = rows[0]
    row = selected["comparison"]
    if row["status"] == "layer_definition":
        return {**selected, "original": [], "working": [], "crs": row["crs"]}
    selection = ref["summary"]["selection"]
    root, project, layers, _ = reviews._selection(workspace, {
        "receipt_id": selection["receipt_id"], "layer_ids": selection["layer_ids"]})
    layer = layers[selected["layer_id"]]
    request = reviews._binding(project, layer)

    def identities(side):
        if side + "_feature_id" in row:
            return [row[side + "_feature_id"]]
        if side in row:
            return [row[side]["feature_id"]]
        return [item["feature_id"] for item in row.get(side + "_features", [])]

    def read(path, name, ids):
        if not ids:
            return []
        result = []
        with fiona.open(path, layer=name) as collection:
            for key in ids:
                try:
                    item = collection.get(key)
                except (KeyError, TypeError, ValueError):
                    item = next((f for f in collection if str(f.id) == key), None)
                if item is None:
                    item = next((f for f in collection if str(f.id) == key), None)
                if item is None or str(item.id) != key:
                    raise ValueError("The selected retained native feature cannot be reopened: " + key)
                geometry = item["geometry"]
                geo = geometry.__geo_interface__ if geometry is not None else None
                result.append({"feature_id": str(item.id),
                               "properties": {k: reviews._value(v) for k, v in dict(item["properties"]).items()},
                               "geometry": reviews._value(geo)})
        return result
    original = read(gis._vector_path(gis.local(root, layer["originals"][0]["path"])),
                    request.get("layer"), identities("original"))
    working = read(gis.local(root, layer["working_path"]), layer["data"]["layer"], identities("working"))
    layer_report = next(item for item in ref["report"]["layers"] if item["layer_id"] == layer["id"])
    return {**selected, "original": original, "working": working, "crs": layer_report["crs"],
            "source_field_map": layer_report["source_field_map"],
            "source_identity_field": layer_report["source_identity_field"]}


def _counts(ref, decisions):
    index = {row["key"]: row for row in decisions}
    counts = {value: 0 for value in DISPOSITIONS}
    for row in ref["rows"]:
        counts[index.get(row["key"], {}).get("disposition", "unreviewed")] += 1
    return {**counts, "total": len(ref["rows"]),
            "notes": sum(bool(row["note"]) for row in decisions)}


def _csv_cell(value):
    """Keep editable JSON literal while making human spreadsheet exports inert."""
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _html(document, ref):
    esc = lambda value: html.escape(str(value), quote=True)
    index = {row["key"]: row for row in document["decisions"]}
    rows = []
    for item in ref["rows"]:
        comparison = item["comparison"]
        choice = index.get(item["key"], {"disposition": "unreviewed", "note": ""})
        identity = comparison.get("source_id")
        identity = "(missing identity)" if identity is None else identity
        if comparison["status"] == "layer_definition":
            identity = "Layer schema and CRS"
        rows.append("<tr><td>" + esc(item["layer_title"]) + "<br><code>" + esc(identity) +
                    "</code></td><td>" + esc(comparison["status"].replace("_", " ")) + "</td><td>" +
                    esc(LABELS[choice["disposition"]]) + "</td><td><pre>" + esc(choice["note"]) +
                    "</pre></td><td><details><summary>Original comparison</summary><pre>" +
                    esc(json.dumps(comparison, ensure_ascii=False, indent=2)) + "</pre></details></td></tr>")
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" '
            'content="width=device-width,initial-scale=1"><title>' + esc(document["title"]) +
            '</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;'
            'margin:0;padding:24px}main{max-width:1200px;margin:auto}h1{font-size:26px;line-height:1.2}'
            'a{color:inherit}code,pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}'
            'table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;'
            'padding:10px;border:1px solid #ccc}th{background:#eee}td pre{margin:0}.scroll{overflow:auto}'
            '.meta{max-width:80ch}@media(max-width:640px){body{padding:14px}table{min-width:640px}}'
            '@media print{body{padding:0}details{display:block}tr{break-inside:avoid}}</style><main>'
            '<h1>' + esc(document["title"]) + '</h1><p>Reviewer label: ' +
            esc(document["reviewer"] or "Not supplied") + '</p><p class="meta">These saved human decisions '
            'refer to the complete retained original-source comparison. They do not change its geometry, '
            'attributes or source-adoption selection. Missing and ambiguous identities remain visible. CSV cells starting with spreadsheet formula prefixes receive an apostrophe; editable JSON retains the exact text.</p>'
            '<p><a href="decisions.json" download>Editable decision JSON</a> · '
            '<a href="decisions.csv" download>Complete decision CSV</a> · '
            '<a href="comparison.json" download>Complete original comparison</a></p>'
            '<details><summary>Source identity</summary><pre>' +
            esc(json.dumps({"comparison_sha256": document["comparison_sha256"],
                            "origin": document["origin"]}, indent=2)) + '</pre></details>'
            '<div class="scroll"><table><thead><tr><th>Layer / feature</th><th>Finding</th>'
            '<th>Decision</th><th>Review note</th><th>Original evidence</th></tr></thead><tbody>' +
            "".join(rows) + '</tbody></table></div></main></html>')


def save(workspace, payload, *, imported_from=None):
    if not isinstance(payload, dict) or set(payload) - {"review_id", "previous_id", "title", "reviewer", "decisions"}:
        raise ValueError("Choose the original comparison and review decisions.")
    ref = reference(workspace, payload.get("review_id"))
    title = _text(payload.get("title"), "Review title", required=True, limit=300)
    reviewer = _text(payload.get("reviewer", ""), "Reviewer label", limit=300)
    previous = payload.get("previous_id") or None
    if previous:
        prior = inspect(workspace, previous, ref=ref)
        if prior["review_id"] != ref["summary"]["id"]:
            raise ValueError("The previous decision revision uses another comparison.")
    decisions = normalize_decisions(payload.get("decisions"), ref)
    reviewer = _reviewer(reviewer, decisions)
    identity = {"version": VERSION, "project_id": workspace.project["id"],
                "review_id": ref["summary"]["id"], "comparison_sha256": ref["comparison_sha256"],
                "title": title, "reviewer": reviewer, "previous_id": previous,
                "decisions_sha256": gis.fingerprint(decisions), "imported_from": imported_from}
    key = gis.fingerprint(identity)
    root = workspace.root / FOLDER / key
    root.mkdir(parents=True, exist_ok=True)
    with gis.locked(root / ".decisions.lock"):
        if (root / "summary.json").is_file():
            return inspect(workspace, key, ref=ref)
        document = {"schema": DOCUMENT, "comparison_sha256": ref["comparison_sha256"],
                    "title": title, "reviewer": reviewer, "decisions": decisions,
                    "origin": {"project_id": workspace.project["id"],
                               "review_id": ref["summary"]["id"], "snapshot_id": key}}
        gis.save(root / "decisions.json", document)
        gis.save(root / "comparison.json", ref["report"])
        index = {row["key"]: row for row in decisions}
        with (root / "decisions.csv").open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=("key", "layer_id", "source_id", "finding",
                                                        "disposition", "note", "comparison_sha256"))
            writer.writeheader()
            for item in ref["rows"]:
                row = item["comparison"]
                chosen = index.get(item["key"], {"disposition": "unreviewed", "note": ""})
                writer.writerow({"key": item["key"], "layer_id": item["layer_id"],
                    "source_id": _csv_cell(row.get("source_id")), "finding": row["status"],
                    "disposition": chosen["disposition"], "note": _csv_cell(chosen["note"]),
                    "comparison_sha256": ref["comparison_sha256"]})
        (root / "review.html").write_text(_html(document, ref), encoding="utf-8")
        names = ("decisions.json", "comparison.json", "decisions.csv", "review.html")
        manifest = {"schema": "upstate.gis-review-decisions-archive/v1", "version": VERSION,
                    "comparison_sha256": ref["comparison_sha256"],
                    "files": {name: gis.record(root, root / name) for name in names}}
        gis.save(root / "MANIFEST.json", manifest)
        with zipfile.ZipFile(root / "review-decisions.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in (*names, "MANIFEST.json"):
                item = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                item.compress_type = zipfile.ZIP_DEFLATED
                item.external_attr = 0o100644 << 16
                archive.writestr(item, (root / name).read_bytes())
        summary = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"], "state": "complete",
                   "identity": identity, **{k: identity[k] for k in
                     ("review_id", "comparison_sha256", "title", "reviewer", "previous_id", "imported_from")},
                   "counts": _counts(ref, decisions),
                   "files": {name: gis.record(workspace.root, root / name)
                             for name in (*names, "MANIFEST.json", "review-decisions.zip")}}
        gis.save(root / "summary.json", summary)
        return {**summary, "decisions": decisions, "document": document}


def read_transfer(path, *, extraction_limit=64 * 1024 * 1024):
    path = Path(path)
    maximum = min(int(extraction_limit), 64 * 1024 * 1024)
    if maximum <= 0:
        raise ValueError("The receiving limit must be positive.")
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            expected = {"decisions.json", "comparison.json", "decisions.csv", "review.html", "MANIFEST.json"}
            if (set(names) != expected or len(names) != len(expected)
                    or sum(item.file_size for item in infos) > maximum
                    or any(item.is_dir() or item.flag_bits & 1 for item in infos)):
                raise ValueError("Receive the complete saved review ZIP within the native extraction limit.")
            bodies = {name: archive.read(name) for name in names}
            manifest = json.loads(bodies["MANIFEST.json"])
            if (manifest.get("schema") != "upstate.gis-review-decisions-archive/v1"
                    or manifest.get("version") != VERSION
                    or set(manifest.get("files", {})) != expected - {"MANIFEST.json"}):
                raise ValueError("The review archive manifest changed.")
            for name, descriptor in manifest["files"].items():
                if (descriptor.get("path") != name or len(bodies[name]) != descriptor.get("bytes")
                        or hashlib.sha256(bodies[name]).hexdigest() != descriptor.get("sha256")):
                    raise ValueError("An exported review member differs from its manifest: " + name)
            document = json.loads(bodies["decisions.json"])
            comparison = json.loads(bodies["comparison.json"])
            if manifest.get("comparison_sha256") != document.get("comparison_sha256"):
                raise ValueError("The review archive declares different comparison identities.")
            return document, comparison
    if path.stat().st_size > maximum:
        raise ValueError("The decision JSON exceeds the receiving limit.")
    return json.loads(path.read_text(encoding="utf-8-sig")), None


def validate_transfer(document, comparison, ref):
    decisions = _document(document, ref)
    if comparison is not None:
        candidate = {"schema": comparison.get("schema"),
                     "algorithm": comparison.get("selection", {}).get("algorithm"),
                     "received_edition_id": comparison.get("selection", {}).get("received_edition_id"),
                     "received_fingerprint": comparison.get("selection", {}).get("received_fingerprint"),
                     "layer_ids": comparison.get("selection", {}).get("layer_ids"),
                     "layers": comparison.get("layers")}
        if gis.fingerprint(candidate) != ref["comparison_sha256"]:
            raise ValueError("The imported complete comparison differs from the selected native review.")
    return decisions


def receive(workspace, path, payload, *, extraction_limit=64 * 1024 * 1024):
    ref = reference(workspace, payload.get("review_id"))
    document, comparison = read_transfer(path, extraction_limit=extraction_limit)
    decisions = validate_transfer(document, comparison, ref)
    origin = {"upload_sha256": file_digest(path), "declared_origin": document["origin"],
              "format": "zip" if comparison is not None else "json"}
    return save(workspace, {"review_id": ref["summary"]["id"],
        "previous_id": payload.get("previous_id"), "title": document["title"],
        "reviewer": document["reviewer"], "decisions": decisions}, imported_from=origin)
