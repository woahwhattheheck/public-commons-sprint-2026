"""Scientific catalog records and optional retained-file inspection.

Catalog normalization is metadata-only. It never scans a directory, opens a
raster, profiles a table, derives model outputs, or guesses scientific units.
The inspection functions are explicit operations over one retained source.
"""
from __future__ import annotations

import csv
import hashlib
import io
import math
import os
from collections.abc import Mapping, Sequence
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from .common import IntelligenceError, file_digest

FORMAT = "eco-intelligence-catalog-v1"
TABLES = {"dataset": "datasets", "job": "jobs",
          "aoi": "aois", "ensemble": "ensembles"}
SCIENCE_FIELDS = (
    "units", "unit", "native_units", "column_units", "band_units",
    "nodata", "nodatavals", "nodata_policy", "crs", "crs_name", "crs_wkt",
    "transform", "gdal_transform", "width", "height", "resolution_m",
    "pixel_area_ha", "bounds", "resampling", "conversion", "vintage",
    "valid_cells", "sum", "sum_units", "model_version", "reporting_mask",
    "source_id", "source_sha256", "source_uri", "input_signature",
    "reference_alignment", "reference_normalization", "native_output",
)


class CatalogError(IntelligenceError):
    """Invalid catalog content or unavailable retained source."""


def _copy(value: Any, location: str = "catalog") -> Any:
    """Copy metadata; represent IEEE non-finite values explicitly in strict JSON."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return {"nonfinite": "NaN" if math.isnan(value) else
                    ("+Infinity" if value > 0 else "-Infinity")}
        return value
    if isinstance(value, Mapping):
        result = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise CatalogError(f"{location} contains a non-string object key")
            result[key] = _copy(item, f"{location}.{key}")
        return result
    if isinstance(value, (list, tuple)):
        return [_copy(item, f"{location}[{index}]")
                for index, item in enumerate(value)]
    raise CatalogError(f"{location} contains unsupported {type(value).__name__}")


def _object(value: Any, location: str) -> Mapping:
    if not isinstance(value, Mapping):
        raise CatalogError(f"{location} must be an object")
    return value


def _identifier(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise CatalogError(f"{location} must be a nonempty string")
    return value


def _path_text(value: Any, location: str) -> str:
    try:
        value = os.fspath(value)
    except TypeError as exc:
        raise CatalogError(f"{location} must be a retained file path") from exc
    if not isinstance(value, str) or not value or "\x00" in value:
        raise CatalogError(f"{location} must be a nonempty path string")
    if "://" in value:
        raise CatalogError(f"{location} must identify a retained local file")
    return value


def _sha256(value: Any, location: str) -> str:
    if (not isinstance(value, str) or len(value) != 64
            or any(char not in "0123456789abcdefABCDEF" for char in value)):
        raise CatalogError(f"{location} must be a 64-character SHA-256")
    return value.lower()


def scientific_metadata(descriptor: Mapping) -> dict:
    """Return explicitly declared display fields from one native descriptor.

    The caller selects the descriptor being described. Parent units and
    native_units remain distinct, and native_output is retained as supplied.
    Nested paths/hashes are preserved for the normal repository redactor.
    """
    descriptor = _object(descriptor, "scientific descriptor")
    return {key: _copy(descriptor[key], key)
            for key in SCIENCE_FIELDS if key in descriptor}


def normalize_artifact(artifact: Mapping, tenant_id: str,
                       job_id: str) -> dict:
    tenant_id = _identifier(tenant_id, "tenant_id")
    job_id = _identifier(job_id, "job_id")
    source = dict(_object(artifact, f"job {job_id} artifact"))
    member = _identifier(source.get("member"), f"job {job_id} artifact.member")
    parts = member.split("/")
    if (member.startswith("/") or "\\" in member
            or any(part in ("", ".", "..") for part in parts)):
        raise CatalogError(f"job {job_id} artifact member is not a relative file name")
    if PurePosixPath(member).is_absolute():
        raise CatalogError(f"job {job_id} artifact member is absolute")
    if "tenant_id" in source and source["tenant_id"] != tenant_id:
        raise CatalogError(f"job {job_id} artifact belongs to another tenant", 403)
    if "job_id" in source and source["job_id"] != job_id:
        raise CatalogError(f"job {job_id} artifact has a different job_id", 409)
    source["path"] = _path_text(source.get("path"),
                                f"job {job_id} artifact {member}.path")
    if source.get("sha256") is not None:
        source["sha256"] = _sha256(source["sha256"], f"artifact {member}.sha256")
    if "metadata" in source:
        _object(source["metadata"], f"artifact {member}.metadata")
    return _copy(source, f"job {job_id} artifact {member}")


def normalize_record(record: Mapping, tenant_id: str,
                     kind: str = "dataset") -> dict:
    tenant_id = _identifier(tenant_id, "tenant_id")
    if kind not in TABLES:
        raise CatalogError(f"unsupported catalog record kind: {kind}")
    source = dict(_object(record, f"{kind} record"))
    record_id = _identifier(source.get("id"), f"{kind}.id")
    if "tenant_id" in source and source["tenant_id"] != tenant_id:
        raise CatalogError(f"{kind} {record_id} belongs to another tenant", 403)
    # The enclosing tenant is an explicit source scope, not an inferred identity.
    source["tenant_id"] = tenant_id
    if kind == "dataset":
        source["path"] = _path_text(source.get("path"),
                                    f"dataset {record_id}.path")
    if source.get("sha256") is not None:
        source["sha256"] = _sha256(source["sha256"], f"{kind} {record_id}.sha256")
    if "metadata" in source:
        _object(source["metadata"], f"{kind} {record_id}.metadata")
    if kind == "job":
        artifacts = source.get("artifacts", [])
        if not isinstance(artifacts, (list, tuple)):
            raise CatalogError(f"job {record_id}.artifacts must be an array")
        normalized, members = [], set()
        for artifact in artifacts:
            item = normalize_artifact(artifact, tenant_id, record_id)
            if item["member"] in members:
                raise CatalogError(f"job {record_id} repeats artifact {item['member']}", 409)
            members.add(item["member"])
            normalized.append(item)
        source["artifacts"] = normalized
    return _copy(source, f"{kind} {record_id}")


def normalize_catalog(document: Mapping) -> dict:
    """Validate a v1 projection, retaining original roots, paths and metadata.

    Missing collections become empty arrays. No record, model, pollutant, unit,
    timestamp, NoData sentinel or source hash is synthesized.
    """
    source = dict(_object(document, "catalog"))
    if source.get("format") != FORMAT:
        raise CatalogError(f"catalog.format must be {FORMAT}")
    tenants = _object(source.get("tenants"), "catalog.tenants")
    normalized_tenants = {}
    for tenant_id, tenant in tenants.items():
        _identifier(tenant_id, "catalog tenant key")
        state = dict(_object(tenant, f"tenant {tenant_id}"))
        state["root"] = _path_text(state.get("root"), f"tenant {tenant_id}.root")
        for kind, table in TABLES.items():
            records = state.get(table, [])
            if not isinstance(records, (list, tuple)):
                raise CatalogError(f"tenant {tenant_id}.{table} must be an array")
            normalized, identifiers = [], set()
            for record in records:
                item = normalize_record(record, tenant_id, kind)
                if item["id"] in identifiers:
                    raise CatalogError(
                        f"tenant {tenant_id} repeats {kind} id {item['id']}", 409)
                identifiers.add(item["id"])
                normalized.append(item)
            state[table] = normalized
        normalized_tenants[tenant_id] = _copy(state, f"tenant {tenant_id}")
    source["tenants"] = normalized_tenants
    return _copy(source)


class NativeCatalog:
    """Snapshot callbacks for an exported catalog, without native-store enumeration.

    Native Workspace bindings can keep using their live callbacks. This facade
    only receives explicit v1 projections. Root remaps are local receiver settings
    and do not alter the retained document returned by as_dict().
    """

    def __init__(self, document: Mapping, *, base_dir: str | Path | None = None,
                 root_overrides: Mapping[str, str | Path] | None = None):
        self._document = normalize_catalog(document)
        self._base_dir = Path(base_dir).resolve() if base_dir is not None else Path.cwd()
        self._roots = {}
        for tenant_id, root in (root_overrides or {}).items():
            if tenant_id not in self._document["tenants"]:
                raise CatalogError(f"root override names unknown tenant {tenant_id}")
            self._roots[tenant_id] = _path_text(root, f"root override {tenant_id}")

    def _tenant(self, tenant_id: str) -> dict:
        try:
            return self._document["tenants"][tenant_id]
        except (KeyError, TypeError) as exc:
            raise CatalogError("catalog tenant not found", 404) from exc

    def tenant_root(self, tenant_id: str) -> Path:
        state = self._tenant(tenant_id)
        value = self._roots.get(tenant_id, state["root"])
        if os.name != "nt" and (PureWindowsPath(value).drive or "\\" in value):
            raise CatalogError(
                f"tenant {tenant_id} needs a local root override for its retained Windows root")
        root = Path(value)
        return root if root.is_absolute() else self._base_dir / root

    def _receiver_path(self, tenant_id: str, row: dict) -> dict:
        if tenant_id not in self._roots or "path" not in row:
            return row
        original_root = self._tenant(tenant_id)["root"]
        flavor = (PureWindowsPath if PureWindowsPath(original_root).drive
                  or "\\" in original_root else PurePosixPath)
        original_path = flavor(row["path"])
        if original_path.is_absolute():
            try:
                receiver_path = original_path.relative_to(flavor(original_root))
            except ValueError as exc:
                raise CatalogError(
                    "retained absolute path is outside its declared catalog root", 403) from exc
        else:
            receiver_path = original_path
        retained_path = row["path"]
        row["path"] = receiver_path.as_posix()
        if row["path"] != retained_path:
            metadata = dict(row.get("metadata", {}))
            metadata["catalog_retained_path"] = retained_path
            row["metadata"] = metadata
        return row

    def records(self, tenant_id: str, kind: str) -> list[dict]:
        if kind not in TABLES:
            raise CatalogError(f"unsupported catalog record kind: {kind}")
        rows = _copy(self._tenant(tenant_id)[TABLES[kind]])
        for row in rows:
            if kind == "dataset":
                self._receiver_path(tenant_id, row)
            elif kind == "job":
                row["artifacts"] = [
                    self._receiver_path(tenant_id, item) for item in row["artifacts"]]
        return rows

    def artifacts(self, tenant_id: str, job_id: str) -> list[dict]:
        for job in self._tenant(tenant_id)["jobs"]:
            if job["id"] == job_id:
                return [self._receiver_path(tenant_id, item)
                        for item in _copy(job["artifacts"])]
        raise CatalogError("catalog job not found", 404)

    def as_dict(self) -> dict:
        return _copy(self._document)

    def repository(self):
        from .adapters import StoreBackedRepository
        return StoreBackedRepository(self.records, self.artifacts, self.tenant_root)


def resolve_scoped_path(path: str | Path, tenant_root: str | Path) -> Path:
    """Resolve a local retained file using the repository's tenant-root rule."""
    value = _path_text(path, "source.path")
    root_value = _path_text(tenant_root, "tenant_root")
    if os.name != "nt" and any(
            PureWindowsPath(item).drive or "\\" in item for item in (value, root_value)):
        raise CatalogError("source inspection needs paths in the local filesystem format")
    try:
        root = Path(root_value).resolve(strict=True)
        candidate = Path(value)
        candidate = (root / candidate if not candidate.is_absolute() else candidate).resolve(
            strict=True)
    except (OSError, RuntimeError) as exc:
        raise CatalogError(f"retained source is unavailable: {exc}", 404) from exc
    if not candidate.is_relative_to(root):
        raise CatalogError("retained source is outside its tenant root", 403)
    if not candidate.is_file():
        raise CatalogError("retained source is not a file", 404)
    return candidate


def _identity(stat_result) -> tuple:
    return (stat_result.st_dev, stat_result.st_ino, stat_result.st_size,
            stat_result.st_mtime_ns)


def _same_file(path: Path, before) -> None:
    if _identity(path.stat()) != _identity(before):
        raise CatalogError("retained source changed during inspection", 409)


class _DigestReader(io.RawIOBase):
    """Hash exact source bytes while the CSV decoder consumes a single stream."""

    def __init__(self, source):
        super().__init__()
        self.source = source
        self.hasher = hashlib.sha256()
        self.byte_count = 0

    def readable(self):
        return True

    def readinto(self, buffer):
        count = self.source.readinto(buffer)
        if count:
            self.hasher.update(memoryview(buffer)[:count])
            self.byte_count += count
        return count


def inspect_csv(path: str | Path, *, tenant_root: str | Path,
                delimiter: str = ",", encoding: str = "utf-8-sig",
                units: Mapping[str, Any] | None = None,
                nodata_tokens: Mapping[str, Sequence[str]] | None = None,
                expected_sha256: str | None = None) -> dict:
    """Inspect every logical record of a retained CSV/TSV using one byte stream.

    Delimiter and NoData tokens are explicit. Empty fields are counted separately;
    NA, NULL, -9999 and whitespace are ordinary values unless declared otherwise.
    Numeric extrema use Decimal and are returned as decimal strings, so a large
    identifier or integer is not rounded to binary floating point. Parseability
    is descriptive and does not assign a measurement type to a column.
    """
    retained = _path_text(path, "source.path")
    resolved = resolve_scoped_path(retained, tenant_root)
    if not isinstance(delimiter, str) or len(delimiter) != 1 or delimiter in "\r\n\x00":
        raise CatalogError("CSV delimiter must be one non-newline character")
    declared_units = _copy(_object({} if units is None else units, "CSV units"))
    null_tokens = {}
    for column, values in _object({} if nodata_tokens is None else nodata_tokens, "CSV nodata_tokens").items():
        if not isinstance(column, str) or isinstance(values, str) or not isinstance(
                values, (list, tuple)):
            raise CatalogError("CSV nodata_tokens maps column names to arrays of strings")
        if any(not isinstance(value, str) for value in values):
            raise CatalogError(f"CSV NoData tokens for {column} must be strings")
        null_tokens[column] = list(dict.fromkeys(values))
    expected = (_sha256(expected_sha256, "expected_sha256")
                if expected_sha256 is not None else None)
    rows = 0
    blank_records = 0
    before = resolved.stat()
    try:
        with resolved.open("rb", buffering=0) as binary:
            if _identity(os.fstat(binary.fileno())) != _identity(before):
                raise CatalogError("retained source changed before inspection", 409)
            digest_reader = _DigestReader(binary)
            with io.TextIOWrapper(io.BufferedReader(digest_reader),
                                  encoding=encoding, newline="") as stream:
                reader = csv.reader(stream, delimiter=delimiter, strict=True)
                header = []
                for candidate_header in reader:
                    if candidate_header == []:
                        blank_records += 1
                        continue
                    header = candidate_header
                    break
                if any(not name for name in header) or len(set(header)) != len(header):
                    raise CatalogError("CSV header contains an empty or repeated column name")
                unknown = (set(declared_units) | set(null_tokens)) - set(header)
                if unknown:
                    raise CatalogError(f"CSV declarations name absent columns: {sorted(unknown)}")
                columns = []
                extrema = []
                token_sets = []
                for name in header:
                    item = {"name": name, "empty_count": 0, "nodata_count": 0,
                            "finite_numeric_count": 0, "nonfinite_count": 0,
                            "non_numeric_count": 0}
                    if name in declared_units:
                        item["declared_units"] = declared_units[name]
                    if name in null_tokens:
                        item["nodata_tokens"] = null_tokens[name]
                    columns.append(item)
                    extrema.append([None, None])
                    token_sets.append(set(null_tokens.get(name, [])))
                for row in reader:
                    if row == []:
                        blank_records += 1
                        continue
                    rows += 1
                    if len(row) != len(header):
                        raise CatalogError(
                            f"CSV record {rows} ending at line {reader.line_num} has "
                            f"{len(row)} fields; header has {len(header)}")
                    for index, value in enumerate(row):
                        column = columns[index]
                        if value == "":
                            column["empty_count"] += 1
                        elif value in token_sets[index]:
                            column["nodata_count"] += 1
                        else:
                            try:
                                number = Decimal(value)
                            except (InvalidOperation, ValueError):
                                column["non_numeric_count"] += 1
                                continue
                            if not number.is_finite():
                                column["nonfinite_count"] += 1
                                continue
                            column["finite_numeric_count"] += 1
                            low, high = extrema[index]
                            extrema[index] = [
                                number if low is None or number < low else low,
                                number if high is None or number > high else high]
                if _identity(os.fstat(binary.fileno())) != _identity(before):
                    raise CatalogError("retained source changed during inspection", 409)
                source_sha256 = digest_reader.hasher.hexdigest()
                byte_count = digest_reader.byte_count
        _same_file(resolved, before)
    except (OSError, UnicodeError, csv.Error, LookupError) as exc:
        raise CatalogError(f"CSV inspection failed: {exc}") from exc
    if byte_count != before.st_size:
        raise CatalogError("CSV source was not completely consumed", 409)
    if expected is not None and source_sha256 != expected:
        raise CatalogError("CSV source SHA-256 differs from its retained descriptor", 409)
    for column, (low, high) in zip(columns, extrema):
        column["observed_count"] = rows
        if low is not None:
            column["numeric_minimum"] = str(low)
            column["numeric_maximum"] = str(high)
    return {
        "format": "eco-source-csv-inspection-v1",
        "source": {"path": retained, "bytes": byte_count, "sha256": source_sha256},
        "delimiter": delimiter, "encoding": encoding,
        "row_count": rows, "blank_record_count": blank_records,
        "column_count": len(header), "columns": columns,
        "numeric_extrema_encoding": "decimal-string",
        "null_policy": {"empty_field": "separate_count", "token_matching": "exact"},
        "coverage": "complete_file",
    }


def _json_number(value: Any) -> Any:
    """Keep raster NaN NoData expressible in strict JSON without treating it as zero."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    number = float(value)
    if math.isnan(number):
        return {"nonfinite": "NaN"}
    if math.isinf(number):
        return {"nonfinite": "+Infinity" if number > 0 else "-Infinity"}
    return number


def _hash_stable_file(path: Path) -> tuple[str, int]:
    before = path.stat()
    digest = file_digest(path)
    _same_file(path, before)
    return digest, before.st_size


def raster_unit_declarations(raster, band: int) -> dict:
    """Resolve only explicit units for the current stored raster representation.

    In native model exports, dataset tags carry units while GDAL band units may
    be empty. native_units describes the upstream representation and is not a
    declaration for the current pixels. No unit spelling or scale is converted.
    """
    if isinstance(band, bool) or not isinstance(band, int) or not 1 <= band <= raster.count:
        raise CatalogError("Raster band does not exist")
    declarations = {}
    candidates = (
        ("band.units", raster.units[band - 1]),
        ("band.tags.units", raster.tags(band).get("units")),
        ("dataset.tags.units", raster.tags().get("units")),
    )
    for origin, value in candidates:
        if value is None or value == "":
            continue
        if not isinstance(value, str):
            raise CatalogError(f"Raster {origin} must be a unit string")
        if value.strip():
            declarations[origin] = value
    values = set(declarations.values())
    if len(values) > 1:
        detail = ", ".join(f"{origin}={value!r}"
                           for origin, value in declarations.items())
        raise CatalogError(f"Raster band {band} has conflicting explicit units: {detail}", 409)
    return {"unit": next(iter(values), None), "declarations": declarations}


def inspect_raster(path: str | Path, *, tenant_root: str | Path,
                   declared_metadata: Mapping | None = None,
                   expected_sha256: str | None = None,
                   hash_content: bool = False) -> dict:
    """Read native raster headers and optional exact source/dependency hashes.

    Pixel arrays and statistics are never requested. Stored tags, band units,
    NoData, masks, scales, offsets and transforms are described separately from
    caller declarations. Pixel area remains in native CRS units squared.
    """
    retained = _path_text(path, "source.path")
    resolved = resolve_scoped_path(retained, tenant_root)
    declared = _copy(_object({} if declared_metadata is None else declared_metadata,
                             "raster declared_metadata"))
    expected = (_sha256(expected_sha256, "expected_sha256")
                if expected_sha256 is not None else None)
    try:
        import rasterio
    except ImportError as exc:
        raise CatalogError("Raster header inspection requires rasterio in the host runtime",
                           503) from exc
    before = resolved.stat()
    try:
        with rasterio.open(resolved) as raster:
            affine = raster.transform
            bands = []
            for index in range(raster.count):
                unit_info = raster_unit_declarations(raster, index + 1)
                band = {
                    "band": index + 1, "dtype": raster.dtypes[index],
                    "units": unit_info["unit"],
                    "unit_declarations": unit_info["declarations"],
                    "nodata": _json_number(raster.nodatavals[index]),
                    "scale": _json_number(raster.scales[index]),
                    "offset": _json_number(raster.offsets[index]),
                    "stored_units": raster.units[index],
                    "description": raster.descriptions[index],
                    "mask_flags": [flag.name for flag in raster.mask_flag_enums[index]],
                    "color_interpretation": raster.colorinterp[index].name,
                    "stored_tags": dict(raster.tags(index + 1)),
                }
                bands.append(band)
            metadata = {
                "driver": raster.driver, "width": raster.width, "height": raster.height,
                "band_count": raster.count,
                "crs": raster.crs.to_string() if raster.crs else None,
                "crs_wkt": raster.crs.to_wkt() if raster.crs else None,
                "affine_transform": [_json_number(value) for value in tuple(affine)[:6]],
                "affine_order": ["a", "b", "c", "d", "e", "f"],
                "gdal_transform": [_json_number(value) for value in affine.to_gdal()],
                "bounds": {name: _json_number(getattr(raster.bounds, name))
                           for name in ("left", "bottom", "right", "top")},
                "resolution_crs_units": [_json_number(value) for value in raster.res],
                "pixel_area_crs_units_squared": _json_number(
                    abs(affine.a * affine.e - affine.b * affine.d)),
                "stored_tags": dict(raster.tags()), "bands": bands,
            }
            dependencies = list(dict.fromkeys([str(resolved), *raster.files]))
        _same_file(resolved, before)
        sources = []
        for dependency in dependencies:
            dependency_path = Path(dependency)
            if not dependency_path.is_absolute():
                dependency_path = resolved.parent / dependency_path
            source_path = resolve_scoped_path(dependency_path, tenant_root)
            item = {"path": str(source_path.relative_to(Path(tenant_root).resolve())),
                    "bytes": source_path.stat().st_size}
            if hash_content:
                item["sha256"], item["bytes"] = _hash_stable_file(source_path)
            sources.append(item)
        _same_file(resolved, before)
    except CatalogError:
        raise
    except Exception as exc:
        raise CatalogError(f"Raster header inspection failed: {exc}") from exc
    source = {"path": retained, "bytes": before.st_size}
    if hash_content:
        source["sha256"] = sources[0]["sha256"]
        if expected is not None and source["sha256"] != expected:
            raise CatalogError("Raster source SHA-256 differs from its retained descriptor", 409)
    elif expected is not None:
        source["declared_sha256"] = expected
    return {
        "format": "eco-source-raster-inspection-v1",
        "source": source, "raster": metadata, "source_files": sources,
        "declared_metadata": declared,
        "inspection": {"scope": "raster_headers",
                       "content_hashes": "computed" if hash_content else "not_requested"},
    }
