"""Portable CSV exports and the self-contained, offline operator report."""
from __future__ import annotations
import csv
import io
import json
from pathlib import Path
import zipfile

from .landcover_ledger import SCHEMA, LedgerError, sha256_file, atomic_json


def _csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for record in rows:
            # Keep external zone/name labels from becoming spreadsheet formulae.
            safe = {k: ("'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v)
                    for k, v in record.items()}
            writer.writerow(safe)


def _source_edition_rows(report: dict) -> list[dict]:
    """Bind readable annual-source labels to the actual retained raster inputs."""
    editions = report.get("source_editions")
    if editions is None:
        return []
    if not isinstance(editions, dict) or (editions.get("schema") != "upstate.landcover-source-editions/v1"
            or editions.get("input_mode") != "sources"
            or editions.get("area_method") != "fractional_polygon_overlap"
            or editions.get("binding_file") != "input-editions.json"):
        raise LedgerError("Unsupported original source-edition metadata")
    baseline, alternatives = editions.get("baseline"), editions.get("alternatives")
    if not isinstance(baseline, dict) or not isinstance(alternatives, list) or any(not isinstance(row, dict) for row in alternatives):
        raise LedgerError("Retain the original baseline and alternative source editions")
    if baseline.get("key") != "baseline" or [row.get("key") for row in alternatives] != report["scenarios"]:
        raise LedgerError("Source-edition labels differ from the original comparison order")
    inputs = {row["role"]: row for row in report["inputs"]}
    rows = []
    for role, edition in [("baseline", baseline), *(("alternative", row) for row in alternatives)]:
        key = edition["key"]
        raster = edition.get("raster")
        retained = inputs.get("baseline" if role == "baseline" else "scenario:" + key)
        if (not isinstance(raster, dict) or retained is None
                or any(raster.get(field) != retained.get(field) for field in ("bytes", "sha256"))):
            raise LedgerError("Source-edition metadata differs from its retained raster input")
        for field in ("label", "source_collection_id", "source_id"):
            if not isinstance(edition.get(field), str) or not edition[field]:
                raise LedgerError("A source edition is missing its original " + field)
        if isinstance(edition.get("band"), bool) or not isinstance(edition.get("band"), int) or edition["band"] < 1:
            raise LedgerError("A source edition must retain its original positive band number")
        for field in ("source_time", "source_crs", "units", "source_uri"):
            if edition.get(field) is not None and not isinstance(edition[field], str):
                raise LedgerError("Source-edition " + field + " must retain original text")
        rows.append({
            "role": role, "comparison_key": key, "label": edition["label"],
            "source_time": edition.get("source_time") or "",
            "source_collection_id": edition["source_collection_id"],
            "source_id": edition["source_id"], "band": edition["band"],
            "source_crs": edition.get("source_crs") or "",
            "units": edition.get("units") or "", "source_uri": edition.get("source_uri") or "",
            "raster_bytes": raster["bytes"], "raster_sha256": raster["sha256"],
        })
    return rows


def _interval_exports(root: Path, report: dict) -> dict | None:
    """Retain exact accounts, spreadsheet tables and one reopenable data file."""
    if report.get("timeline") is None:
        return None
    from .landcover_change_accounts import derive_accounts
    accounts = derive_accounts(report)
    quantities = ["opening_ha", "retained_ha", "gained_ha", "lost_ha", "closing_ha", "net_ha"]
    prefix = ["zone_id", "zone_name", "analysis_ha", "covered_ha", "from_year", "to_year", "gap_years"]
    tables = []
    for kind, identity in (("classes", ["code", "name"]), ("groups", ["name", "codes"])):
        records = []
        for zone in accounts["rows"]:
            for interval in zone["intervals"]:
                common = {key: zone[key] for key in prefix[:4]}
                common.update({key: interval[key] for key in prefix[4:]})
                for account in interval[kind]:
                    item = {**common, **{key: account[key] for key in identity + quantities}}
                    if kind == "groups":
                        item["codes"] = " ".join(str(code) for code in item["codes"])
                    records.append(item)
        filename = "timeline-interval-" + kind + ".csv"
        _csv(root / filename, prefix + identity + quantities, records)
        # Preserve csv.writer's complete original bytes, including CRLF, in the
        # self-contained HTML and the complete editable report-data handover.
        tables.append({"path": filename, "content": (root / filename).read_bytes().decode("utf-8")})
    atomic_json(root / "timeline-change-accounts.json", accounts)
    payload = {"accounts": accounts, "tables": tables}
    atomic_json(root / "timeline-report.json",
                {"schema": "upstate.landcover-interval-report/v1", "ledger": report, **payload})
    return payload


def export_interval_copy(source: Path | str, destination: Path | str) -> dict:
    """Create a separate presentation edition; never rewrite a computed edition."""
    import shutil
    import tempfile
    original, target = Path(source).expanduser().resolve(strict=True), Path(destination).expanduser().resolve()
    if not original.is_dir() or target.exists() or target.is_symlink():
        raise LedgerError("Choose an original report directory and a new account-report destination")
    if target.is_relative_to(original) or original.is_relative_to(target):
        raise LedgerError("Account-report destination must be separate from the original edition and its ancestors")
    manifest_path = original / "export-manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise LedgerError("Retain the original export manifest")
    original_manifest = manifest_path.read_bytes()
    manifest = json.loads(original_manifest)
    if manifest.get("schema") != "upstate.landcover-export/1" or not isinstance(manifest.get("files"), list):
        raise LedgerError("Unsupported original export manifest")
    declared = {}
    for item in manifest["files"]:
        name = item.get("path")
        if (not isinstance(name, str) or not name or name in (".", "..", "export-manifest.json")
                or Path(name).name != name or "\\" in name or name in declared
                or not isinstance(item.get("bytes"), int) or isinstance(item["bytes"], bool)
                or item["bytes"] < 0):
            raise LedgerError("Original export member inventory is invalid")
        member = original / name
        if (member.is_symlink() or not member.is_file() or member.stat().st_size != item["bytes"]
                or sha256_file(member) != item.get("sha256")):
            raise LedgerError("Original export member changed: " + name)
        declared[name] = item
    if "ledger.json" not in declared:
        raise LedgerError("Retain the complete original ledger")
    report = json.loads((original / "ledger.json").read_bytes())
    if (report.get("schema") != SCHEMA or report.get("complete") is not True
            or report.get("signature") != manifest.get("signature") or report.get("timeline") is None):
        raise LedgerError("Select the complete original observed timeline edition")
    # Validate the scientific account before creating a new presentation directory.
    from .landcover_change_accounts import derive_accounts
    derive_accounts(report)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".landcover-accounts-", dir=target.parent))
    try:
        for name, item in declared.items():
            shutil.copyfile(original / name, temporary / name)
            copied = temporary / name
            if copied.stat().st_size != item["bytes"] or sha256_file(copied) != item["sha256"]:
                raise LedgerError("Original export changed during receiving: " + name)
        if manifest_path.read_bytes() != original_manifest:
            raise LedgerError("Original export manifest changed during receiving")
        provenance = {"schema": "upstate.landcover-presentation-source/v1",
                      "ledger_signature": report["signature"],
                      "original_manifest": manifest,
                      "original_manifest_bytes": len(original_manifest),
                      "original_manifest_sha256": __import__("hashlib").sha256(original_manifest).hexdigest(),
                      "ledger": declared["ledger.json"],
                      "interpretation": "Separate presentation copy; original scientific edition and member bytes remain unchanged."}
        atomic_json(temporary / "presentation-source.json", provenance)
        result = export_report(temporary)
        if sha256_file(temporary / "ledger.json") != declared["ledger.json"]["sha256"]:
            raise LedgerError("Presentation export altered the original scientific ledger")
        target.mkdir()
        try:
            for member in temporary.iterdir():
                member.replace(target / member.name)
        except BaseException:
            shutil.rmtree(target)
            raise
        return {"schema": "upstate.landcover-interval-copy/v1", "path": str(target),
                "source": str(original), "signature": report["signature"],
                "original_ledger": declared["ledger.json"], "manifest": result}
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def export_report(output: Path | str) -> dict:
    root = Path(output)
    report = json.loads((root / "ledger.json").read_text(encoding="utf-8"))
    if report.get("schema") != SCHEMA or report.get("complete") is not True:
        raise LedgerError("Only complete land-cover ledgers may produce an operator report")
    source_rows = _source_edition_rows(report)
    if source_rows:
        binding_path = root / "input-editions.json"
        if not binding_path.is_file():
            raise LedgerError("Retain input-editions.json with the complete source comparison")
        identity = (binding_path.stat().st_size, sha256_file(binding_path))
        if not any(item.get("role") == "context" and
                   (item.get("bytes"), item.get("sha256")) == identity for item in report["inputs"]):
            raise LedgerError("The portable source binding differs from the computed ledger context")
        _csv(root / "source-editions.csv", list(source_rows[0]), source_rows)
    summary, transitions, groups, coverage, unknowns = [], [], [], [], []
    for row in report["rows"]:
        key = {k: row[k] for k in ("zone_id", "zone_name", "scenario")}
        summary.append({**key, **{k: row[k] for k in ("changed_ha", "unchanged_ha", "changed_pct_of_analysis", "analysis_coverage_pct")}, **row["support"]})
        for t in row["transitions"]:
            transitions.append({**key, **t, "from_class": report["classes"][str(t["from_code"])],
                                "to_class": report["classes"][str(t["to_code"])]})
        for group, values in row["groups"].items():
            groups.append({**key, "group": group, **values})
        coverage.append({**key, **row["support"]})
        for code, hectares in row["unknown_classes_ha"].items():
            side, value = code.split(":", 1)
            unknowns.append({**key, "side": side, "code": value, "ha": hectares})
    prefix = ["zone_id", "zone_name", "scenario"]
    _csv(root / "watershed-summary.csv", list(summary[0]), summary)
    _csv(root / "transitions.csv", prefix + ["from_code", "from_class", "to_code", "to_class", "ha", "intersecting_cells"], transitions)
    _csv(root / "landcover-groups.csv", prefix + ["group", "baseline_ha", "scenario_ha", "gained_ha", "lost_ha", "net_ha"], groups)
    _csv(root / "coverage.csv", list(coverage[0]), coverage)
    _csv(root / "unknown-classes.csv", prefix + ["side", "code", "ha"], unknowns)
    _csv(root / "zone-extent.csv", list(report["zones"][0]), report["zones"])
    if report.get("timeline") is not None:
        from .landcover_temporal import export_csv
        export_csv(root, report)
    interval_payload = _interval_exports(root, report)
    template = Path(__file__).with_name("landcover_report.html").read_text(encoding="utf-8")
    # JSON is parsed as data; escapes prevent external names closing the script.
    payload = json.dumps(report, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    interval_data = json.dumps(interval_payload, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    if template.count("__LEDGER_DATA__") != 1 or template.count("__INTERVAL_DATA__") != 1:
        raise LedgerError("The complete report template has changed its data placeholders")
    # Replace all original placeholders in a single pass so source labels cannot
    # be interpreted as a second template substitution.
    import re
    html = re.sub(r"__LEDGER_DATA__|__INTERVAL_DATA__", lambda match:
                  payload if match.group(0) == "__LEDGER_DATA__" else interval_data, template)
    (root / "report.html").write_text(html, encoding="utf-8")
    files = sorted([p for p in root.iterdir() if p.is_file() and p.suffix in (".json", ".csv", ".html", ".geojson", ".tif") and p.name not in ("export-manifest.json", "status.json")])
    manifest = {"schema": "upstate.landcover-export/1", "signature": report["signature"],
                "files": [{"path": p.name, "bytes": p.stat().st_size, "sha256": sha256_file(p)} for p in files]}
    atomic_json(root / "export-manifest.json", manifest)
    return manifest


def make_portable(output: Path | str, destination: Path | str) -> dict:
    root, dest = Path(output).resolve(), Path(destination).resolve()
    manifest = export_report(root)
    if dest.exists():
        raise LedgerError(f"Portable destination already exists: {dest}")
    if dest.parent == root:
        raise LedgerError("Place portable ZIP outside its source ledger directory")
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(dest.name + ".partial")
    try:
        with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for item in manifest["files"]:
                archive.write(root / item["path"], item["path"])
            archive.write(root / "export-manifest.json", "export-manifest.json")
        temp.replace(dest)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    return {"path": str(dest), "bytes": dest.stat().st_size, "sha256": sha256_file(dest)}


def receive_portable(archive_path: Path | str, destination: Path | str) -> dict:
    """Create-only receiving, verifying every declared member before publication."""
    import tempfile
    import shutil
    destination = Path(destination).resolve()
    if destination.exists():
        raise LedgerError("Receiving never overwrites an existing directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".landcover-receive-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            names = [i.filename for i in infos]
            if len(names) != len(set(names)):
                raise LedgerError("Duplicate portable archive members")
            for name in names:
                if not name or name != Path(name).name or "\\" in name:
                    raise LedgerError(f"Unsafe portable member: {name!r}")
            manifest = json.loads(archive.read("export-manifest.json"))
            if manifest.get("schema") != "upstate.landcover-export/1":
                raise LedgerError("Unsupported portable schema")
            expected = {item["path"]: item for item in manifest["files"]}
            if len(expected) != len(manifest["files"]) or set(names) != set(expected) | {"export-manifest.json"}:
                raise LedgerError("Portable member inventory mismatch")
            for name, entry in expected.items():
                if archive.getinfo(name).file_size != entry["bytes"]:
                    raise LedgerError(f"Portable member length mismatch: {name}")
                with archive.open(name) as source, (temp / name).open("wb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
                if sha256_file(temp / name) != entry["sha256"]:
                    raise LedgerError(f"Portable member digest mismatch: {name}")
            atomic_json(temp / "export-manifest.json", manifest)
            report = json.loads((temp / "ledger.json").read_text())
            if report.get("schema") != SCHEMA or report.get("complete") is not True or report.get("signature") != manifest["signature"]:
                raise LedgerError("Portable report identity mismatch")
        # mkdir reservation keeps a concurrent receiver from replacing a winner.
        destination.mkdir()
        try:
            for path in temp.iterdir():
                path.replace(destination / path.name)
        except BaseException:
            shutil.rmtree(destination)
            raise
        return {"path": str(destination), "signature": manifest["signature"], "files": len(names)}
    finally:
        shutil.rmtree(temp, ignore_errors=True)
