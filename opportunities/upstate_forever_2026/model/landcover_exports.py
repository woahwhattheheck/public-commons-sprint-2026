"""Portable CSV exports and the self-contained, offline operator report."""
from __future__ import annotations
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import uuid
import zipfile

from . import portable_fs as _fs
from .landcover_ledger import SCHEMA, LedgerError, sha256_file, atomic_json


MANIFEST = "export-manifest.json"
BLOCK = 1024 * 1024


def _write_bytes(path: Path, body: bytes) -> None:
    path = _fs.native_path(path)
    pending = path.with_name(".landcover-record-" + uuid.uuid4().hex)
    try:
        with os.fdopen(_fs.open_file(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        _fs.replace(pending, path)
        _fs.sync_directory(path.parent)
    finally:
        pending.unlink(missing_ok=True)


def _read_bytes(path: Path) -> bytes:
    with os.fdopen(_fs.open_file(path, os.O_RDONLY), "rb") as stream:
        return stream.read()


def _csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for record in rows:
        # Keep external zone/name labels from becoming spreadsheet formulae.
        safe = {k: ("'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v)
                for k, v in record.items()}
        writer.writerow(safe)
    _write_bytes(path, stream.getvalue().encode("utf-8"))


def _inventory(raw: bytes) -> tuple[dict, dict]:
    manifest = json.loads(raw)
    if (not isinstance(manifest, dict) or manifest.get("schema") != "upstate.landcover-export/1"
            or not isinstance(manifest.get("signature"), str)
            or not isinstance(manifest.get("files"), list)):
        raise LedgerError("Unsupported portable export manifest")
    entries = {}
    for item in manifest["files"]:
        if not isinstance(item, dict):
            raise LedgerError("Invalid original export member")
        name = item.get("path")
        if (not isinstance(name, str) or "/" in name or name == MANIFEST or name in entries
                or not isinstance(item.get("bytes"), int) or isinstance(item["bytes"], bool)
                or item["bytes"] < 0 or not isinstance(item.get("sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None):
            raise LedgerError("Invalid original export member inventory")
        entries[name] = item
    _fs.validate_members([*entries, MANIFEST], portable=True)
    if "ledger.json" not in entries:
        raise LedgerError("Retain the complete original scientific ledger")
    return manifest, entries


def _report_identity(report: dict, manifest: dict, entries: dict) -> None:
    if (not isinstance(report, dict) or report.get("schema") != SCHEMA
            or report.get("complete") is not True or report.get("signature") != manifest["signature"]):
        raise LedgerError("Portable report identity mismatch")
    if _source_edition_rows(report):
        binding = entries.get("input-editions.json")
        if binding is None or not any(
                row.get("role") == "context" and all(row.get(k) == binding[k] for k in ("bytes", "sha256"))
                for row in report["inputs"]):
            raise LedgerError("Retain the exact original source binding with this report")


def _copy_checked(incoming, outgoing, entry: dict) -> None:
    digest, size = hashlib.sha256(), 0
    while block := incoming.read(BLOCK):
        size += len(block)
        if size > entry["bytes"]:
            raise LedgerError("Original member grew during receiving: " + entry["path"])
        digest.update(block)
        if outgoing is not None:
            outgoing.write(block)
    if size != entry["bytes"] or digest.hexdigest() != entry["sha256"]:
        raise LedgerError("Original member bytes changed: " + entry["path"])


def _verified_directory(root: Path, raw: bytes | None = None, *, exact: bool = False) -> tuple[bytes, dict]:
    root = _fs.native_path(root)
    if root.is_symlink() or not root.is_dir():
        raise LedgerError("Choose an original regular report directory")
    actual = _read_bytes(root / MANIFEST)
    if raw is not None and actual != raw:
        raise LedgerError("Existing destination belongs to another original export")
    manifest, entries = _inventory(actual)
    if exact and {path.name for path in root.iterdir()} != set(entries) | {MANIFEST}:
        raise LedgerError("Existing receiving directory has a different member inventory")
    for name, entry in entries.items():
        member = root / name
        if member.is_symlink() or not member.is_file() or member.stat().st_size != entry["bytes"]:
            raise LedgerError("Original export member length or type changed: " + name)
        if sha256_file(member) != entry["sha256"]:
            raise LedgerError("Original export member changed: " + name)
    _report_identity(json.loads(_read_bytes(root / "ledger.json")), manifest, entries)
    if _read_bytes(root / MANIFEST) != actual:
        raise LedgerError("Original export manifest changed during inspection")
    return actual, manifest


def _archive_inventory(archive: zipfile.ZipFile) -> tuple[bytes, dict, dict]:
    infos = archive.infolist()
    names = [info.filename for info in infos]
    if len(names) != len(set(names)):
        raise LedgerError("Duplicate portable archive members")
    _fs.validate_members(names, portable=True)
    for info in infos:
        mode = stat.S_IFMT(info.external_attr >> 16)
        if "/" in info.filename or info.is_dir() or mode not in (0, stat.S_IFREG):
            raise LedgerError("Portable member is not an original flat regular file: " + info.filename)
    raw = archive.read(MANIFEST)
    manifest, entries = _inventory(raw)
    if set(names) != set(entries) | {MANIFEST}:
        raise LedgerError("Portable member inventory mismatch")
    for name, entry in entries.items():
        if archive.getinfo(name).file_size != entry["bytes"]:
            raise LedgerError("Portable member length mismatch: " + name)
    _report_identity(json.loads(archive.read("ledger.json")), manifest, entries)
    return raw, manifest, entries


def _verified_archive(path: Path, expected: bytes) -> None:
    with os.fdopen(_fs.open_file(path, os.O_RDONLY), "rb") as stream, zipfile.ZipFile(stream) as archive:
        raw, _, entries = _archive_inventory(archive)
        if raw != expected:
            raise LedgerError("Existing archive belongs to another original export")
        for name, entry in entries.items():
            with archive.open(name) as incoming:
                _copy_checked(incoming, None, entry)


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
        if isinstance(edition.get("band"), bool) or not isinstance(edition["band"], int) or edition["band"] < 1:
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
    original = _fs.native_path(Path(source).expanduser().resolve(strict=True))
    target = _fs.native_path(Path(destination).expanduser().resolve())
    if not original.is_dir() or target.exists() or target.is_symlink():
        raise LedgerError("Choose an original report directory and a new account-report destination")
    if target.is_relative_to(original) or original.is_relative_to(target):
        raise LedgerError("Account-report destination must be separate from the original edition and its ancestors")
    original_manifest, manifest = _verified_directory(original)
    _, declared = _inventory(original_manifest)
    report = json.loads(_read_bytes(original / "ledger.json"))
    if report.get("timeline") is None:
        raise LedgerError("Select the complete original observed timeline edition")
    # Validate the scientific account before creating a new presentation directory.
    from .landcover_change_accounts import derive_accounts
    derive_accounts(report)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = _fs.native_path(tempfile.mkdtemp(prefix=".landcover-accounts-", dir=target.parent))
    try:
        for name, item in declared.items():
            with os.fdopen(_fs.open_file(original / name, os.O_RDONLY), "rb") as incoming:
                with os.fdopen(_fs.open_file(temporary / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as copied:
                    _copy_checked(incoming, copied, item)
                    copied.flush()
                    os.fsync(copied.fileno())
        if _read_bytes(original / MANIFEST) != original_manifest:
            raise LedgerError("Original export manifest changed during receiving")
        provenance = {"schema": "upstate.landcover-presentation-source/v1",
                      "ledger_signature": report["signature"],
                      "original_manifest": manifest,
                      "original_manifest_bytes": len(original_manifest),
                      "original_manifest_sha256": hashlib.sha256(original_manifest).hexdigest(),
                      "ledger": declared["ledger.json"],
                      "interpretation": "Separate presentation copy; original scientific edition and member bytes remain unchanged."}
        atomic_json(temporary / "presentation-source.json", provenance)
        result = export_report(temporary)
        if sha256_file(temporary / "ledger.json") != declared["ledger.json"]["sha256"]:
            raise LedgerError("Presentation export altered the original scientific ledger")
        _fs.sync_directory(temporary)
        _fs.publish_directory(temporary, target)
        return {"schema": "upstate.landcover-interval-copy/v1", "path": str(target),
                "source": str(original), "signature": report["signature"],
                "original_ledger": declared["ledger.json"], "manifest": result}
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def export_report(output: Path | str) -> dict:
    root = _fs.native_path(Path(output).expanduser().resolve(strict=True))
    report = json.loads(_read_bytes(root / "ledger.json"))
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
    html = re.sub(r"__LEDGER_DATA__|__INTERVAL_DATA__", lambda match:
                  payload if match.group(0) == "__LEDGER_DATA__" else interval_data, template)
    _write_bytes(root / "report.html", html.encode("utf-8"))
    files = sorted([p for p in root.iterdir() if p.is_file() and p.suffix in (".json", ".csv", ".html", ".geojson", ".tif") and p.name not in (MANIFEST, "status.json")])
    _fs.validate_members([p.name for p in files] + [MANIFEST], portable=True)
    # Temporal CSVs use the original producer; close and flush these too before
    # publishing the complete export manifest.
    for path in files:
        descriptor = _fs.open_file(path, os.O_RDWR)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    manifest = {"schema": "upstate.landcover-export/1", "signature": report["signature"],
                "files": [{"path": p.name, "bytes": p.stat().st_size, "sha256": sha256_file(p)} for p in files]}
    atomic_json(root / MANIFEST, manifest)
    return manifest


def make_portable(output: Path | str, destination: Path | str) -> dict:
    root = _fs.native_path(Path(output).expanduser().resolve(strict=True))
    dest = _fs.native_path(Path(destination).expanduser().resolve())
    if dest.parent == root:
        raise LedgerError("Place portable ZIP outside its source ledger directory")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with _fs.locked(root / ".writer.lock"):
        # Existing computed/report editions are immutable inputs to transport.
        # Explicit `report` remains the original presentation regeneration path.
        if not (root / MANIFEST).exists():
            export_report(root)
        original_manifest, manifest = _verified_directory(root)
        if dest.exists() or dest.is_symlink():
            _verified_archive(dest, original_manifest)
            return {"path": str(dest), "bytes": dest.stat().st_size, "sha256": sha256_file(dest)}
        pending = dest.with_name(".landcover-pack-" + uuid.uuid4().hex + ".partial")
        try:
            with os.fdopen(_fs.open_file(pending, os.O_RDWR | os.O_CREAT | os.O_EXCL), "w+b") as target:
                with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                    for item in manifest["files"]:
                        with os.fdopen(_fs.open_file(root / item["path"], os.O_RDONLY), "rb") as incoming:
                            with archive.open(item["path"], "w", force_zip64=True) as outgoing:
                                _copy_checked(incoming, outgoing, item)
                    archive.writestr(MANIFEST, original_manifest)
                target.flush()
                os.fsync(target.fileno())
            if _read_bytes(root / MANIFEST) != original_manifest:
                raise LedgerError("Original export manifest changed during packing")
            try:
                _fs.publish_file(pending, dest)
            except FileExistsError:
                _verified_archive(dest, original_manifest)
            _fs.sync_directory(dest.parent)
        finally:
            pending.unlink(missing_ok=True)
    return {"path": str(dest), "bytes": dest.stat().st_size, "sha256": sha256_file(dest)}


def receive_portable(archive_path: Path | str, destination: Path | str) -> dict:
    """Verify original members and publish the complete directory create-only."""
    destination = _fs.native_path(Path(destination).expanduser().resolve())
    archive_path = _fs.native_path(Path(archive_path).expanduser().resolve(strict=True))
    if archive_path.is_relative_to(destination):
        raise LedgerError("Keep the original archive outside its receiving directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = _fs.native_path(tempfile.mkdtemp(prefix=".landcover-receive-", dir=destination.parent))
    try:
        with os.fdopen(_fs.open_file(archive_path, os.O_RDONLY), "rb") as original:
            with zipfile.ZipFile(original) as archive:
                raw, manifest, entries = _archive_inventory(archive)
                for name, entry in entries.items():
                    with archive.open(name) as source:
                        with os.fdopen(_fs.open_file(temp / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL), "wb") as target:
                            _copy_checked(source, target, entry)
                            target.flush()
                            os.fsync(target.fileno())
                _write_bytes(temp / MANIFEST, raw)
        _verified_directory(temp, raw, exact=True)
        _fs.sync_directory(temp)
        try:
            _fs.publish_directory(temp, destination)
        except FileExistsError:
            _verified_directory(destination, raw, exact=True)
            _fs.sync_directory(destination.parent)
        return {"path": str(destination), "signature": manifest["signature"], "files": len(entries) + 1}
    finally:
        shutil.rmtree(temp, ignore_errors=True)
