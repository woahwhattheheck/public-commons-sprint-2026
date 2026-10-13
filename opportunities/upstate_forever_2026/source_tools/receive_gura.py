"""Receive original InVEST Gura archives into the maintained scientific workspace.

Run from the delivered product root. The two archives and the separate current biophysical CSVs are retained intact.
The receiver joins original nutrient and sediment table columns by lucode, then
uses the existing Workspace for source intake, grid preparation, and selections.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
import shutil
import sys
import zipfile

from model.common import atomic_bytes, atomic_json, file_digest
from model.workspace import Workspace

TITLE = "Gura — original InVEST example"
SCHEMA = "upstate.gura-original-receiving/v1"
RELEASE_SOURCE = "https://github.com/natcap/invest/tree/3.20.0/sample_datastacks"
ARCHIVE_URLS = {
    "ndr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.16.1/data/NDR.zip",
    "sdr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.16.1/data/SDR.zip",
}
TABLE_URLS = {
    "ndr": "https://bitbucket.org/natcap/invest-sample-data/raw/master/NDR/biophysical_table_gura.csv",
    "sdr": "https://bitbucket.org/natcap/invest-sample-data/raw/master/SDR/biophysical_table_Gura.csv",
}
COLUMNS = (
    "lucode", "load_n", "load_p", "load_type_n", "load_type_p", "eff_n",
    "eff_p", "crit_len_n", "crit_len_p", "proportion_subsurface_n",
    "usle_c", "usle_p",
)
NDR_PARAMS = {
    "threshold_flow_accumulation": 1000, "k_param": 2,
    "flow_dir_algorithm": "mfd", "subsurface_critical_length_n": 200,
    "subsurface_eff_n": 0.8,
}
SDR_PARAMS = {
    "threshold_flow_accumulation": 1000, "k_param": 2,
    "flow_dir_algorithm": "mfd", "sdr_max": 0.8, "ic_0_param": 0.5,
    "l_max": 122,
}


def _copy_original(path: Path, destination: Path) -> dict:
    path = path.resolve(strict=True)
    digest = file_digest(path)
    if destination.exists():
        if file_digest(destination) != digest:
            raise ValueError("Retained original source changed: " + str(destination))
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".receiving")
        shutil.copyfile(path, temporary)
        if file_digest(temporary) != digest:
            raise ValueError("Original source changed while receiving")
        temporary.replace(destination)
    return {"path": str(destination), "bytes": destination.stat().st_size, "sha256": digest}


def _members(archive: Path, target: Path, wanted: set[str]) -> dict[str, Path]:
    """Extract only the selected original files, checking names and ZIP CRCs."""
    chosen = {}
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            native = PurePosixPath(member.filename)
            if native.is_absolute() or ".." in native.parts:
                raise ValueError("Unsafe original ZIP member: " + member.filename)
            basename = native.name.lower()
            if member.is_dir() or basename not in wanted:
                continue
            if basename in chosen:
                raise ValueError("Duplicate selected native ZIP member: " + basename)
            if member.file_size > 512 * 1024 * 1024:
                raise ValueError("Selected example member exceeds receiving capacity")
            destination = target / native.name
            if destination.exists():
                # A resumed intake must not stage another full original member.
                # Reading through ZipExtFile also verifies the original ZIP CRC.
                original_sha256 = hashlib.sha256()
                with bundle.open(member) as incoming:
                    for block in iter(lambda: incoming.read(1024 * 1024), b""):
                        original_sha256.update(block)
                if file_digest(destination) != original_sha256.hexdigest():
                    raise ValueError("Retained original member changed: " + str(destination))
                chosen[basename] = destination
                continue
            target.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix(destination.suffix + ".receiving")
            with bundle.open(member) as incoming, temporary.open("wb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
            if destination.exists() and file_digest(destination) != file_digest(temporary):
                temporary.unlink()
                raise ValueError("Retained original member changed: " + str(destination))
            temporary.replace(destination)
            chosen[basename] = destination
    return chosen


def _require(members: dict, name: str) -> Path:
    try:
        return members[name.lower()]
    except KeyError:
        raise ValueError("Original selected archive does not contain " + name) from None


def _table(path: Path) -> tuple[list[str], dict[int, dict]]:
    with path.open(encoding="utf-8-sig", newline="") as incoming:
        reader = csv.DictReader(incoming)
        fields = list(reader.fieldnames or [])
        if "lucode" not in fields:
            raise ValueError("Original table needs its native lucode column")
        rows = {}
        for row in reader:
            raw = str(row["lucode"]).strip()
            try:
                value = Decimal(raw)
                if not value.is_finite() or value != value.to_integral_value():
                    raise ValueError("Original lucode is not an integer")
                code = int(value)
            except InvalidOperation:
                raise ValueError("Original lucode is not an integer") from None
            if code in rows:
                raise ValueError("Duplicate original lucode in " + str(path))
            rows[code] = row
    if not rows:
        raise ValueError("Original biophysical table is empty")
    return fields, rows


def _combined_table(ndr: Path, sdr: Path, target: Path) -> dict:
    n_fields, n_rows = _table(ndr)
    s_fields, s_rows = _table(sdr)
    if set(n_rows) != set(s_rows):
        raise ValueError("Original Gura nutrient/sediment tables have different lucode selections")
    required_n = set(COLUMNS) - {"usle_c", "usle_p"}
    if required_n - set(n_fields) or {"lucode", "usle_c", "usle_p"} - set(s_fields):
        missing = sorted((required_n - set(n_fields)) | ({"lucode", "usle_c", "usle_p"} - set(s_fields)))
        raise ValueError("Retain a native 3.20-compatible original Gura table; absent source fields: " + ", ".join(missing))
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    lineage = []
    for code in sorted(n_rows):
        row = {key: n_rows[code][key] for key in COLUMNS if key not in {"usle_c", "usle_p"}}
        row.update({key: s_rows[code][key] for key in ("usle_c", "usle_p")})
        for field in ("load_type_n", "load_type_p"):
            if row[field] not in ("application-rate", "measured-runoff"):
                raise ValueError("Unknown native " + field + " at lucode " + str(code))
        writer.writerow(row)
        lineage.append({"lucode": code, "nutrient_source": ndr.name, "sediment_source": sdr.name})
    atomic_bytes(target, buffer.getvalue().encode("utf-8"), immutable=True)
    return {"rows": len(lineage), "columns": list(COLUMNS), "lineage": lineage,
            "ndr_table_sha256": file_digest(ndr), "sdr_table_sha256": file_digest(sdr),
            "combined_table_sha256": file_digest(target)}


def _raster_identity(path: Path) -> dict:
    import rasterio
    with rasterio.open(path) as dataset:
        return {"crs": str(dataset.crs), "width": dataset.width, "height": dataset.height,
                "transform": list(dataset.transform)[:6],
                "resolution": list(dataset.res),
                "nodata": str(dataset.nodata) if dataset.nodata is not None and not math.isfinite(dataset.nodata) else dataset.nodata,
                "units": list(dataset.units)}



def _same_raster(left: Path, right: Path) -> bool:
    """Compare actual cell values and masks without depending on TIFF packing."""
    import numpy
    import rasterio
    with rasterio.open(left) as first, rasterio.open(right) as second:
        if (first.crs != second.crs or first.transform != second.transform
                or (first.width, first.height, first.count) != (second.width, second.height, second.count)):
            return False
        for band in range(1, first.count + 1):
            for _, window in first.block_windows(band):
                a = first.read(band, window=window, masked=True)
                b = second.read(band, window=window, masked=True)
                a_mask, b_mask = numpy.ma.getmaskarray(a), numpy.ma.getmaskarray(b)
                if not numpy.array_equal(a_mask, b_mask):
                    return False
                if not numpy.array_equal(a.data[~a_mask], b.data[~b_mask], equal_nan=True):
                    return False
    return True


def _validate_selection(args):
    """Validate physical selections before retaining any original input copies."""
    if not math.isfinite(args.upstream_buffer_m) or args.upstream_buffer_m < 0:
        raise ValueError("--upstream-buffer-m must retain a nonnegative finite model-context selection")
    resolution = getattr(args, "expected_resolution_m", None)
    if resolution is not None and (not math.isfinite(resolution) or resolution <= 0):
        raise ValueError("--expected-resolution-m must retain the positive finite native source cell size")


def receive(args) -> dict:
    _validate_selection(args)
    source = args.source_directory.resolve()
    source.mkdir(parents=True, exist_ok=True)
    copies = {
        "ndr": _copy_original(args.ndr_archive, source / "original" / "NDR.zip"),
        "sdr": _copy_original(args.sdr_archive, source / "original" / "SDR.zip"),
    }
    table_copies = {
        "ndr": _copy_original(args.ndr_table, source / "original" / "current-tables" / "NDR" / "biophysical_table_gura.csv"),
        "sdr": _copy_original(args.sdr_table, source / "original" / "current-tables" / "SDR" / "biophysical_table_Gura.csv"),
    }
    watershed_names = {"watershed_gura" + suffix for suffix in (".shp", ".shx", ".dbf", ".prj", ".cpg", ".qpj", ".sbn", ".sbx", ".shp.xml")}
    common = watershed_names | {"dem_gura.tif", "land_use_gura.tif"}
    ndr = _members(Path(copies["ndr"]["path"]), source / "original" / "NDR",
                   common | {"precipitation_gura.tif", "biophysical_table_gura.csv"})
    sdr = _members(Path(copies["sdr"]["path"]), source / "original" / "SDR",
                   common | {"erodibility_gura.tif", "erosivity_gura.tif", "biophysical_table_gura.csv"})
    actual = {
        "DEM": _require(ndr, "DEM_gura.tif"),
        "NLCD": _require(ndr, "land_use_gura.tif"),
        "PRECIPITATION": _require(ndr, "precipitation_gura.tif"),
        "R_FACTOR": _require(sdr, "erosivity_gura.tif"),
        "K_FACTOR": _require(sdr, "erodibility_gura.tif"),
    }
    shapes = [_require(ndr, "watershed_gura" + suffix) for suffix in (".shp", ".shx", ".dbf", ".prj")]
    # The tagged 3.20 datastacks use separate original table URLs. Their
    # raster ZIPs retain an older edition and are not the current table source.
    table_n = Path(table_copies["ndr"]["path"])
    table_s = Path(table_copies["sdr"]["path"])
    identities = {key: _raster_identity(path) for key, path in actual.items()}
    import rasterio
    with rasterio.open(actual["NLCD"]) as reference:
        if not reference.crs or not reference.crs.is_projected:
            raise ValueError("The retained native land-cover grid must be projected in metres")
        if str(reference.crs.linear_units).lower() not in ("metre", "meter", "metres", "meters"):
            raise ValueError("The native land-cover grid must use metre units")
        x_resolution, y_resolution = map(float, reference.res)
        if (not math.isfinite(x_resolution) or not math.isfinite(y_resolution)
                or x_resolution <= 0 or y_resolution <= 0
                or not math.isclose(x_resolution, y_resolution, rel_tol=1e-9, abs_tol=1e-8)):
            raise ValueError("Original Gura land cover must retain finite square metre cells")
        expected_resolution = getattr(args, "expected_resolution_m", None)
        resolution_m = x_resolution if expected_resolution is None else float(expected_resolution)
        if not math.isfinite(resolution_m) or resolution_m <= 0:
            raise ValueError("Select a positive finite native source cell size")
        if (not math.isclose(x_resolution, resolution_m, rel_tol=1e-9, abs_tol=1e-8)
                or not math.isclose(y_resolution, resolution_m, rel_tol=1e-9, abs_tol=1e-8)):
            raise ValueError("Original Gura land-cover resolution differs from the selected source edition: "
                             + str(reference.res) + "; expected " + str(resolution_m) + " metres")
        affine = reference.transform
        native_grid = {
            "resolution_m": resolution_m,
            "source_resolution_m": [x_resolution, y_resolution],
            "source_transform": list(affine)[:6],
            "source_crs": str(reference.crs),
            "source_pixel_area_ha": abs(affine.a * affine.e - affine.b * affine.d) / 10000,
            "pixel_area_ha": resolution_m * resolution_m / 10000,
            "upstream_buffer_m": args.upstream_buffer_m,
        }
    # The two model archives must describe the same original terrain/land cover.
    equivalence = {}
    for filename in ("DEM_gura.tif", "land_use_gura.tif"):
        left = _require(ndr, filename)
        right = _require(sdr, filename)
        equivalence[filename] = {"ndr_sha256": file_digest(left), "sdr_sha256": file_digest(right)}
        equivalence[filename]["cell_values_and_masks_match"] = (
            equivalence[filename]["ndr_sha256"] == equivalence[filename]["sdr_sha256"]
            or _same_raster(left, right))
        if not equivalence[filename]["cell_values_and_masks_match"]:
            raise ValueError("Select matching original Gura NDR and SDR source editions: " + filename)
    combined = source / "gura-biophysical-combined.csv"
    table_lineage = _combined_table(table_n, table_s, combined)
    table_lineage["original_tables"] = {
        "ndr": {**table_copies["ndr"], "uri": args.ndr_table_source_uri},
        "sdr": {**table_copies["sdr"], "uri": args.sdr_table_source_uri},
    }
    table_lineage["selection_reference"] = RELEASE_SOURCE
    lineage_path = source / "gura-biophysical-lineage.json"
    atomic_json(lineage_path, table_lineage, immutable=True)
    entries = []
    units = {"DEM": "m", "NLCD": "class", "PRECIPITATION": "mm/year",
             "R_FACTOR": "MJ*mm/(ha*h*year)", "K_FACTOR": "t*ha*h/(ha*MJ*mm)"}
    for role, path in actual.items():
        model = "ndr" if role in ("DEM", "NLCD", "PRECIPITATION") else "sdr"
        entries.append({"id": "GURA_" + role, "title": TITLE + ": " + role,
                        "uri": args.ndr_source_uri if model == "ndr" else args.sdr_source_uri,
                        "vintage": args.source_edition, "kind": "raster",
                        "path": str(path.relative_to(source)), "sha256": file_digest(path),
                        "units": units[role], "resampling": "nearest" if role == "NLCD" else "bilinear"})
    companions = sorted(path for name, path in ndr.items()
                        if name.startswith("watershed_gura.") and path.suffix.lower() != ".shp")
    entries.append({"id": "GURA_WATERSHED", "title": TITLE + ": original watershed",
                    "uri": args.ndr_source_uri, "vintage": args.source_edition, "kind": "vector",
                    "path": str(shapes[0].relative_to(source)), "sha256": file_digest(shapes[0]),
                    "companions": [{"path": str(path.relative_to(source)), "sha256": file_digest(path)}
                                   for path in companions]})
    for label, path, uri in (("NDR_TABLE", table_n, args.ndr_table_source_uri),
                             ("SDR_TABLE", table_s, args.sdr_table_source_uri),
                             ("BIOPHYSICAL", combined, RELEASE_SOURCE),
                             ("BIOPHYSICAL_LINEAGE", lineage_path, RELEASE_SOURCE)):
        entries.append({"id": "GURA_" + label, "title": TITLE + ": " + label,
                        "uri": uri, "vintage": args.source_edition,
                        "kind": "document" if path.suffix == ".json" else "table",
                        "path": str(path.relative_to(source)), "sha256": file_digest(path)})
    for model, members in (("ndr", ndr), ("sdr", sdr)):
        archived_table = members.get("biophysical_table_gura.csv")
        if archived_table is not None:
            entries.append({
                "id": "GURA_ARCHIVED_" + model.upper() + "_TABLE",
                "title": TITLE + ": original archived " + model.upper() + " table",
                "uri": args.ndr_source_uri if model == "ndr" else args.sdr_source_uri,
                "vintage": args.source_edition, "kind": "table",
                "path": str(archived_table.relative_to(source)),
                "sha256": file_digest(archived_table),
            })
    for model, copied in copies.items():
        entries.append({"id": "GURA_ORIGINAL_" + model.upper() + "_ZIP",
                        "title": TITLE + ": intact " + model.upper() + " archive",
                        "uri": args.ndr_source_uri if model == "ndr" else args.sdr_source_uri,
                        "vintage": args.source_edition, "kind": "document",
                        "path": str(Path(copied["path"]).relative_to(source)), "sha256": copied["sha256"]})
    manifest_path = source / "sources.json"
    atomic_json(manifest_path, {"schema": "upstate.sources/v1", "entries": entries}, immutable=True)
    ws = Workspace(args.workspace, create=True, title=TITLE)
    collection = ws.import_sources(manifest_path)
    profile = ws.save_profile({
        "title": TITLE + ": original native example parameters",
        "references": [RELEASE_SOURCE + "/ndr_gura.invs.json", RELEASE_SOURCE + "/sdr_gura.invs.json",
                       args.ndr_source_uri, args.sdr_source_uri,
                       args.ndr_table_source_uri, args.sdr_table_source_uri],
        "source_collection_id": collection["id"], "biophysical_source_id": "GURA_BIOPHYSICAL",
        "ndr": NDR_PARAMS, "sdr": SDR_PARAMS})
    scenario = ws.save_scenario({
        "title": TITLE + ": original land cover", "reason": "Receive the original native example into the maintained product",
        "kind": "baseline", "source_collection_id": collection["id"], "patches": []})
    grid_spec = {
        "title": TITLE + ": retained native " + format(resolution_m, "g") + " m grid",
        "source_collection_id": collection["id"],
        "input_sources": {role: "GURA_" + role for role in actual},
        "reporting_area": {"source_id": "GURA_WATERSHED"},
        "model_domain": {"source_id": "GURA_WATERSHED"},
        "upstream_buffer_m": args.upstream_buffer_m,
    }
    # Omitted resolution preserves the original 30 m project identity.
    # Other editions retain their actual source cell size independently of
    # the model-context buffer. The native flow threshold remains unchanged.
    if resolution_m != 30.0:
        grid_spec["resolution_m"] = resolution_m
    grid = ws.prepare_grid(grid_spec)
    selection = {
        "schema": "upstate.compute-programme-selection/v1", "title": TITLE,
        "grid_id": grid["id"], "baseline_run": "original-gura",
        "runs": [{"key": "original-gura", "title": TITLE + ": original baseline",
                  "profile_id": profile["id"], "scenario_id": scenario["id"]}],
        "source_reference": args.source_reference}
    selection_path = source / "programme-selection.json"
    atomic_json(selection_path, selection, immutable=True)
    from model.compute_programme import ComputeProgrammes
    programme = ComputeProgrammes(ws).create(selection)
    result = {"schema": SCHEMA, "study": TITLE, "workspace": str(ws.root),
              "source_directory": str(source), "source_edition": args.source_edition,
              "archives": copies, "original_tables": table_copies,
              "table_source_uris": {"ndr": args.ndr_table_source_uri, "sdr": args.sdr_table_source_uri},
              "raster_identities": identities, "native_grid": native_grid, "shared_rasters": equivalence,
              "table_lineage": table_lineage, "source_manifest_sha256": file_digest(manifest_path),
              "source_collection_id": collection["id"], "profile_id": profile["id"],
              "scenario_id": scenario["id"], "grid_id": grid["id"],
              "programme_id": programme["programme_id"], "selection_path": str(selection_path)}
    atomic_json(source / "receiving.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--source-directory", type=Path, required=True)
    parser.add_argument("--ndr-archive", type=Path, required=True)
    parser.add_argument("--sdr-archive", type=Path, required=True)
    parser.add_argument("--ndr-table", type=Path, required=True,
                        help="Original separate NDR CSV referenced by the tagged datastack")
    parser.add_argument("--sdr-table", type=Path, required=True,
                        help="Original separate SDR CSV referenced by the tagged datastack")
    parser.add_argument("--ndr-table-source-uri", default=TABLE_URLS["ndr"])
    parser.add_argument("--sdr-table-source-uri", default=TABLE_URLS["sdr"])
    parser.add_argument("--ndr-source-uri", default=ARCHIVE_URLS["ndr"])
    parser.add_argument("--sdr-source-uri", default=ARCHIVE_URLS["sdr"])
    parser.add_argument("--source-edition", default="Original Gura rasters, watersheds and separate biophysical CSV sources referenced by tagged InVEST 3.20.0 datastacks")
    parser.add_argument("--source-reference", required=True)
    parser.add_argument("--expected-resolution-m", type=float,
                        help="Optional expected native cell size; otherwise read the original land-cover raster")
    parser.add_argument("--upstream-buffer-m", type=float, required=True,
                        help="Original nonnegative context distance; zero adds no upstream buffer")
    args = parser.parse_args(argv)
    try:
        _validate_selection(args)
    except ValueError as error:
        parser.error(str(error))
    try:
        print(json.dumps(receive(args), ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, ImportError, RuntimeError, zipfile.BadZipFile) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
