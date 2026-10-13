"""Expose the complete original historical Three and Twenty study natively."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

if __package__:
    from . import study_context
else:
    import study_context

BUILTIN_ID = "three-twenty-historical-2021-2025"
TITLE = "Three and Twenty Creek — original historical comparison, 2021–2025"
DIRECTORY = "observations/three_twenty_history_2021_2025"
MANIFEST = "three_twenty_historical.sources.json"
ROOT = "application-context/three-twenty-historical"
FAMILY_SHA256 = "50696a7fcdf510e9e002d37610b0d75bce775adddb4ba0806ffb338d2dd3e175"
FAMILY = {
    "studies": (BUILTIN_ID,),
    "retained_root": ROOT,
    "prefixes": (
        DIRECTORY + "/", "source/three-twenty-history-20261013/",
        "source/three-twenty-water-quality-20261013/",
        "source/sv833-water-quality-20261013/",
    ),
    "paths": ("source/eighteenmile-stream-nutrients-20261013/original/seneca-nutrient-stations.csv",),
}


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("Retain a canonical relative original source path.")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or value == "." or ".." in path.parts:
        raise ValueError("The original source must remain inside the application.")
    return value


def _read(application, relative):
    target = (application / _relative(relative)).resolve(strict=True)
    if not target.is_relative_to(application) or not target.is_file():
        raise ValueError("Original source path escapes the application: " + relative)
    return target.read_bytes()


def source_files(application=None):
    """Return all 73 unchanged members of the publisher's complete family."""
    app = (Path(application) if application is not None else Path(__file__).resolve().parents[1]).resolve(strict=True)
    family_path = DIRECTORY + "/family.json"
    raw_family = _read(app, family_path)
    if _sha(raw_family) != FAMILY_SHA256:
        raise ValueError("Receive the complete original PR4110 historical source edition.")
    family = json.loads(raw_family.decode("utf-8"))
    if family.get("schema") != "commons.file-inventory/v1" or len(family.get("files", [])) != 72:
        raise ValueError("The historical family must retain its 72 original members plus its inventory.")
    files = {}
    for descriptor in family["files"]:
        name = _relative(descriptor["path"])
        if name == family_path or name in files:
            raise ValueError("The historical source inventory repeats or lists itself.")
        raw = _read(app, name)
        if type(descriptor.get("bytes")) is not int or len(raw) != descriptor["bytes"] or _sha(raw) != descriptor.get("sha256"):
            raise ValueError("Historical original source identity changed: " + name)
        files[name] = raw
    files[family_path] = raw_family
    native = json.loads(files[MANIFEST].decode("utf-8"))
    if native.get("schema") != "upstate.sources/v1" or len(native.get("entries", [])) != 5:
        raise ValueError("Retain all five original historical native sources.")
    ids = set()
    referenced = {MANIFEST}
    for entry in native["entries"]:
        if not isinstance(entry.get("id"), str) or entry["id"] in ids:
            raise ValueError("Historical original native IDs must be distinct.")
        ids.add(entry["id"])
        for descriptor in [entry, *entry.get("companions", [])]:
            name = _relative(descriptor["path"])
            raw = files.get(name)
            if raw is None or len(raw) != descriptor.get("bytes") or _sha(raw) != descriptor.get("sha256"):
                raise ValueError("Historical manifest companion identity changed: " + name)
            referenced.add(name)
    if referenced != set(files) - {family_path}:
        raise ValueError("The native historical manifest must close the complete scientific source family.")
    return files


def catalog_entry(application=None):
    app = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    if not (app / MANIFEST).is_file():
        return None
    return {"id": BUILTIN_ID, "title": TITLE,
            "publication": "Original 2021–2025 samples; retained 2026-10-13 edition",
            "counts": {"stations": 3, "original_result_rows": 1502,
                       "original_activity_count": 120, "statistical_result_rows": 1501,
                       "statistically_excluded_rows": 1, "paired_characteristic_contrasts": 275}}


def build_files(application=None):
    originals = source_files(application)
    prefix = DIRECTORY + "/native-study/"
    native = {name[len(prefix):]: raw for name, raw in originals.items() if name.startswith(prefix)}
    if len(native) != 29:
        raise ValueError("Retain all 29 original historical native-study members.")
    inventory = json.loads(native["study-files.json"])
    if (inventory.get("schema") != "upstate.study-file-inventory/v1"
            or {row["path"] for row in inventory.get("files", [])} != set(native) - {"study-files.json"}
            or len(inventory["files"]) != 28):
        raise ValueError("Retain the original 28-body native inventory and its own file.")
    for descriptor in inventory["files"]:
        raw = native[_relative(descriptor["path"])]
        if len(raw) != descriptor.get("bytes") or _sha(raw) != descriptor.get("sha256"):
            raise ValueError("The original historical native body changed.")
    index = json.loads(native["observation-sources.json"])
    selected = json.loads(native["result-selection.json"])
    study = json.loads(native["study.json"])
    if (index.get("record_count") != 1588 or index.get("activity_count") != 126
            or selected.get("record_count") != 1502 or selected.get("activity_count") != 120
            or selected.get("date_start") != "2021-01-06" or selected.get("date_end") != "2025-12-02"
            or study.get("study_id") != BUILTIN_ID):
        raise ValueError("The original historical selection or source census changed.")
    study["observation_statistical_exclusions"] = {
        "schema": "upstate.original-statistical-exclusions/v1",
        "observation_index_sha256": _sha(native["observation-sources.json"]),
        "original_record_count": 1588,
        "records": [{
            "original_source_path": "original/sv833-physical-narrow-result-identifiers-2021-20261013-original.csv",
            "original_source_sha256": "712edf7bc92d9900b178f39db78ce7af7668da64a9d835107292d94863e128ed",
            "source_csv_row": 158,
            "monitoring_location_id": "21SC60WQ_WQX-SV-833",
            "activity_id": "21SC60WQ_WQX-AF12080",
            "original_result_identifier": "STORET-1104042240",
            "reason": (
                "The original pH value 724 on 2023-11-29 is retained verbatim. "
                "The source-owned historical analysis flags this exact result as outside "
                "its pH review range and excludes it from statistical summaries; "
                "no corrected value is inferred."
            ),
        }],
    }
    study["content_counts"]["statistical_result_rows"] = 1501
    study["content_counts"]["statistically_excluded_rows"] = 1
    study["observation_selection_notes"].append(
        "All 1,502 original historical results remain available. Statistical summaries "
        "use 1,501 results after the exact source-bound pH 724 exclusion."
    )
    native["study.json"] = _json(study)
    if __package__:
        from .published_studies import _observation_rows
        from .source_observations import load_observations, statistical_rows
    else:
        from published_studies import _observation_rows
        from source_observations import load_observations, statistical_rows
    rows = load_observations(native, _observation_rows)
    if (len(rows) != 1502 or len({row["original_result_identifier"] for row in rows}) != 1502
            or len({row["activity_id"] for row in rows}) != 120
            or {row["site_id"] for row in rows} != {"SV-735", "SV-111", "SV-833"}
            or sum("reporting_limit" in row.get("metadata_source_records", {}) for row in rows) != 1492):
        raise ValueError("Native import differs from the original 1502-result / 120-activity / 1492-limit historical cohort.")
    eligible = statistical_rows(rows, study)
    excluded = {row["original_result_identifier"] for row in rows} - {
        row["original_result_identifier"] for row in eligible}
    if len(eligible) != 1501 or excluded != {"STORET-1104042240"}:
        raise ValueError("Historical native statistics must exclude exactly the declared original pH 724 result.")
    files = {name: raw for name, raw in native.items() if name != "study-files.json"}
    files.update({ROOT + "/" + name: raw for name, raw in originals.items()})
    application_root = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    context_manifests = []
    for context_name in study_context.manifest_names(BUILTIN_ID):
        if context_name == MANIFEST or not (application_root / context_name).is_file():
            continue
        retained = study_context.retained_files(application_root, application_root / context_name)
        for name, raw in retained.items():
            if name in files and files[name] != raw:
                raise ValueError("An original station-network context conflicts at " + name)
            files[name] = raw
        context_manifests.append(context_name)
    if context_manifests:
        study["related_context_manifests"] = context_manifests
        study["observation_selection_notes"].append(
            "The original four-station river-network companion retains all four location representations, "
            "65 downstream whole reaches, 45 upstream whole reaches, six geometric station-pair distances, "
            "and its full interactive report and source code. This geographic context retains its own "
            "four-station scope; the observation cohort, dates, result identities and statistics remain unchanged."
        )
        files["study.json"] = _json(study)
    original_manifest = json.loads(originals[MANIFEST])
    entry = next(item for item in original_manifest["entries"] if item["id"] == "three-twenty-historical-report")
    report_name = ROOT + "/" + entry["path"]
    report = files[report_name]
    files["model-sources.json"] = _json({
        "schema": "upstate.sources/v1", "title": TITLE, "entries": [{
            "id": "three-twenty-historical-published-study-report",
            "title": TITLE + " — source-owned paired analysis",
            "kind": "document", "role": "ORIGINAL_STUDY_REPORT", "path": report_name,
            "uri": entry["uri"], "vintage": entry["vintage"],
            "bytes": len(report), "sha256": _sha(report),
            "companions": [{"path": name, "bytes": len(raw), "sha256": _sha(raw)}
                           for name, raw in sorted(files.items()) if name != report_name],
            "metadata": {"media_type": "text/html", "original_report_source_id": entry["id"],
                         "original_result_count": 1502, "original_activity_count": 120,
                         "statistical_result_count": 1501, "statistically_excluded_count": 1,
                         "source_manifest": ROOT + "/" + MANIFEST,
                         "source_manifest_sha256": _sha(originals[MANIFEST])},
        }]})
    files["study-files.json"] = _json({
        "schema": "upstate.study-file-inventory/v1",
        "files": [{"path": name, "bytes": len(raw), "sha256": _sha(raw)}
                  for name, raw in sorted(files.items())],
    })
    return files


def builtin_companion(application=None):
    files = build_files(application)
    return _json({"schema": "upstate.published-study-files/v1", "files": [
        {"path": name, "bytes": len(raw), "sha256": _sha(raw),
         "encoding": "utf-8", "content": raw.decode("utf-8")}
        for name, raw in sorted(files.items())]}), {}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    body, _ = builtin_companion(args.application)
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and output.read_bytes() != body:
        raise ValueError("Choose a new destination for the changed historical source edition.")
    if not output.exists():
        with output.open("xb") as destination:
            destination.write(body)
    print(json.dumps({"study_id": BUILTIN_ID, "path": str(output), "bytes": len(body),
                      "sha256": _sha(body), "original_results": 1502, "statistical_results": 1501,
                      "statistically_excluded_results": 1, "activities": 120}))


if __name__ == "__main__":
    main()
