"""Resumable native raster measurements for an original polygon collection."""
from __future__ import annotations

import copy
from contextlib import ExitStack
import csv
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading

from .common import atomic_json, digest, file_digest, held, identifier
from .spatial import SpatialReview, _feature_shape, _integer, _scalar_matches, _scalar_text, _signature, _text
from .spatial_regions import SpatialRegions, KIND as REGION_KIND, ALGORITHM as REGION_ALGORITHM

KIND = "spatial-cohorts"
ALGORITHM = "native-feature-cohort/v1"
SORTS = {"feature_id": "feature_id", "label": "label", "status": "status",
         "primary_mean": "primary_mean", "comparison_mean": "comparison_mean",
         "paired_mean_difference": "paired_mean_difference",
         "paired_relative_change_percent": "paired_relative_change_percent"}
METRICS = ("kind", "units", "selected_cells", "valid_cells", "minimum", "maximum", "mean",
           "standard_deviation", "sum_native_pixel_values", "valid_grid_area_m2")
COLUMNS = (["feature_id", "label", "status", "reason", "region_analysis_id"] +
           [side + "_" + name for side in ("primary", "comparison") for name in METRICS] +
           ["paired_common_valid_cells", "paired_baseline_only_valid_cells",
            "paired_alternative_only_valid_cells", "paired_mean_difference", "paired_sum_difference",
            "paired_relative_change_percent", "paired_units"])


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


class _SnapshotReview:
    """Reuse the original layer catalogue while all actual source reads stay verified."""
    def __init__(self, original, layers):
        self.original, self.layers = original, layers

    def _layers(self):
        return self.layers

    def __getattr__(self, name):
        return getattr(self.original, name)


class _BatchWorkspace:
    """The batch ledger handles completed work without rescanning every region."""
    def __init__(self, original):
        self.original = original

    def _list(self, kind):
        return [] if kind == REGION_KIND else self.original._list(kind)

    def __getattr__(self, name):
        return getattr(self.original, name)


class _FeatureRegions(SpatialRegions):
    """Use a feature already resolved in the single original vector scan."""
    def __init__(self, workspace, spatial):
        super().__init__(_BatchWorkspace(workspace), spatial=spatial)
        self.original_feature = None

    def _request(self, payload):
        request, selected, descriptions = super()._request(payload)
        request["source_feature"] = copy.deepcopy(self.original_feature)
        return request, selected, descriptions


def _row(feature_id, label, result=None, *, reason="", status="complete"):
    row = dict.fromkeys(COLUMNS)
    row.update(feature_id=feature_id, label=label, status=status, reason=reason,
               region_analysis_id=result["id"] if result else None)
    if result is None:
        return row
    for side, value in result["results"].items():
        statistics = value["statistics"]
        values = {"kind": statistics["kind"], "units": value["units"],
                  "selected_cells": value["selected_native_cell_count"],
                  "valid_cells": value["valid_cell_count"],
                  "valid_grid_area_m2": value["valid_grid_area_m2"]}
        values.update({key: statistics.get(key) for key in METRICS if key not in values})
        row.update({side + "_" + key: value for key, value in values.items()})
    pair = result.get("comparison")
    if pair:
        row.update(paired_common_valid_cells=pair["common_valid_cell_count"],
                   paired_baseline_only_valid_cells=pair["baseline_only_valid_cell_count"],
                   paired_alternative_only_valid_cells=pair["alternative_only_valid_cell_count"],
                   paired_mean_difference=pair["difference"]["mean"],
                   paired_sum_difference=pair["difference"]["sum_native_pixel_values"],
                   paired_relative_change_percent=pair["relative_change_percent_of_common_baseline"],
                   paired_units=pair["units"])
    return row


def _database(path):
    connection = sqlite3.connect(str(path), timeout=60)
    connection.execute("PRAGMA journal_mode=DELETE")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("""CREATE TABLE IF NOT EXISTS rows (
        feature_id TEXT PRIMARY KEY, label TEXT NOT NULL, status TEXT NOT NULL,
        region_analysis_id TEXT, primary_mean REAL, comparison_mean REAL,
        paired_mean_difference REAL, paired_relative_change_percent REAL,
        row_json TEXT NOT NULL)""")
    connection.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    connection.commit()
    return connection


def _put(connection, row):
    names = ("feature_id", "label", "status", "region_analysis_id", "primary_mean", "comparison_mean",
             "paired_mean_difference", "paired_relative_change_percent")
    connection.execute("INSERT OR REPLACE INTO rows VALUES (?,?,?,?,?,?,?,?,?)",
                       [row.get(name) for name in names] + [_json(row)])
    connection.commit()


def _artifact(workspace, path):
    return {"path": path.relative_to(workspace.root).as_posix(),
            "bytes": path.stat().st_size, "sha256": file_digest(path)}


class SpatialCohorts:
    def __init__(self, workspace, *, spatial=None):
        self.workspace = workspace
        self.spatial = spatial or SpatialReview(workspace)
        self._verified, self._lock = {}, threading.RLock()

    def _plan(self, payload, layers):
        if not isinstance(payload, dict):
            raise ValueError("Choose a complete original vector and raster cohort")
        source_choice, source_record = self.spatial._selected(payload.get("source_selection"), layers, kind="vector")
        primary, comparisons, bindings = {}, {}, {}
        for name in ("primary", "comparison"):
            raw = payload.get(name)
            if raw is None and name == "comparison":
                primary[name] = comparisons[name] = None
                continue
            choice, record = self.spatial._selected(raw, layers, kind="raster")
            description = self.spatial._describe(choice, record)
            primary[name], comparisons[name] = choice, description
            bindings[name] = self.spatial._binding(choice, record, description["native"])
        selected_ids = payload.get("feature_ids")
        if selected_ids is not None:
            if not isinstance(selected_ids, list) or not selected_ids:
                raise ValueError("Feature IDs must be a nonempty list, or null for the whole original collection")
            if any(not isinstance(value, str) or not value or len(value) > 4096 for value in selected_ids):
                raise ValueError("Use original nonempty text feature IDs")
            selected_ids = sorted(set(selected_ids))
        touched = payload.get("all_touched", False)
        if not isinstance(touched, bool):
            raise ValueError("Native cell inclusion must be true or false")
        label_field = payload.get("label_field") or None
        if label_field is not None:
            label_field = _text(label_field, "Original label field", limit=1024)
        request = {"algorithm": ALGORITHM, "region_algorithm": REGION_ALGORITHM,
                   "project_id": self.workspace.project["id"],
                   "title": _text(payload.get("title"), "Cohort title"),
                   "notes": _text(payload.get("notes", ""), "Cohort notes", limit=16000, empty=True),
                   "source_selection": source_choice, "feature_ids": selected_ids,
                   "label_field": label_field, **primary,
                   "all_touched": touched,
                   "histogram_bins": _integer(payload.get("histogram_bins", 32), "Histogram bins", minimum=2, maximum=256),
                   "bindings": bindings}
        return request, source_choice, source_record, self.spatial._pair(comparisons["primary"], comparisons["comparison"])

    def analyze(self, payload, *, progress=None):
        from shapely.geometry import mapping
        # Resolve the original layer catalogue once. Native reads retain their usual
        # source-signature checks and all statistics remain in SpatialRegions.
        layers = self.spatial._layers()
        request, choice, record, pair = self._plan(payload, layers)
        snapshot = _SnapshotReview(self.spatial, layers)
        regions = _FeatureRegions(self.workspace, snapshot)
        counts = {"scanned": 0, "selected": 0, "completed": 0, "reused": 0, "excluded": 0, "missing": 0}
        def report(stage, **extra):
            if progress:
                progress({"stage": stage, **counts, **extra})
        report("indexing")
        connection = None
        with ExitStack() as operation:
            with self.spatial._vector(choice, record) as (source, crs, layer):
                where = self.spatial._where(source, choice)
                choice = {**choice, "layer": layer}
                request["source_selection"] = choice
                request["source_binding"] = self.spatial._binding(choice, record)
                if request["label_field"] and request["label_field"] not in source.schema["properties"]:
                    raise ValueError("Choose a label field present in the original vector layer")
                request_sha = digest(request)
                work = self.workspace.root / "spatial-cohort-work" / request_sha
                work.mkdir(parents=True, exist_ok=True)
                operation.enter_context(held(work / ".operation.lock"))
                # Recheck after acquiring the exact-request lock: a preceding worker
                # may have completed this collection while this task was waiting.
                for saved in self.workspace._list(KIND):
                    if saved.get("request_sha256") == request_sha:
                        return self.inspect(saved["id"])
                atomic_json(work / "request.json", request, immutable=True)
                connection = _database(work / "rows.sqlite")
                try:
                    original = connection.execute("SELECT value FROM metadata WHERE key='request_sha256'").fetchone()
                    if original and original[0] != request_sha:
                        raise ValueError("The retained cohort work belongs to another original selection")
                    connection.execute("INSERT OR IGNORE INTO metadata VALUES ('request_sha256',?)", (request_sha,))
                    connection.execute("CREATE TEMP TABLE seen (feature_id TEXT PRIMARY KEY)")
                    connection.commit()
                    wanted = set(request["feature_ids"]) if request["feature_ids"] is not None else None
                    for feature in source:
                        counts["scanned"] += 1
                        if counts["scanned"] % 1000 == 0:
                            report("indexing")
                        if any(not _scalar_matches(feature["properties"].get(key), value) for key, value in where.items()):
                            continue
                        feature_id = str(feature.id)
                        if wanted is not None and feature_id not in wanted:
                            continue
                        try:
                            connection.execute("INSERT INTO seen VALUES (?)", (feature_id,))
                        except sqlite3.IntegrityError as error:
                            raise ValueError("The original vector repeats feature ID " + feature_id) from error
                        counts["selected"] += 1
                        label = (_scalar_text(feature["properties"].get(request["label_field"]))
                                 if request["label_field"] else feature_id)
                        geometry = _feature_shape(feature)
                        reason = ("The original feature has no geometry" if geometry is None or geometry.is_empty else
                                  "The original feature is not a polygon" if geometry.geom_type not in {"Polygon", "MultiPolygon"} else
                                  "The original polygon requires an explicit geometry correction" if not geometry.is_valid or geometry.area <= 0 else "")
                        if reason:
                            _put(connection, _row(feature_id, label, reason=reason, status="excluded"))
                            counts["excluded"] += 1
                            report("calculating", feature_id=feature_id)
                            continue
                        region = {"crs": crs.to_string(), "geometry": mapping(geometry)}
                        regions.original_feature = {"selection": choice, "id": feature_id,
                                                    "binding": request["source_binding"]}
                        region_payload = {"title": (request["title"][:140] + " / " + label[:90]),
                                          "notes": request["notes"], "region": region,
                                          **{name: request[name] for name in ("primary", "comparison", "histogram_bins", "all_touched")}}
                        prior = connection.execute("SELECT region_analysis_id FROM rows WHERE feature_id=?", (feature_id,)).fetchone()
                        result = None
                        if prior and prior[0]:
                            result = regions.inspect(prior[0])
                            expected, _, _ = regions._request(region_payload)
                            if result["request_sha256"] != digest(expected):
                                raise ValueError("Retained feature progress no longer matches the exact original selection")
                            counts["reused"] += 1
                        if result is None:
                            def feature_progress(value):
                                report("calculating", feature_id=feature_id, native=value)
                            result = regions.analyze(region_payload, progress=feature_progress)
                        _put(connection, _row(feature_id, label, result))
                        counts["completed"] += 1
                        report("calculating", feature_id=feature_id)
                    if wanted is not None:
                        for feature_id in sorted(wanted):
                            if not connection.execute("SELECT 1 FROM seen WHERE feature_id=?", (feature_id,)).fetchone():
                                _put(connection, _row(feature_id, feature_id, status="missing",
                                                       reason="Feature ID is absent from the selected original layer and filter"))
                                counts["missing"] += 1
                    if not counts["selected"] and not counts["missing"]:
                        raise ValueError("The selected original vector filter contains no features")
                    total = connection.execute("SELECT count(*) FROM rows").fetchone()[0]
                    if total != counts["selected"] + counts["missing"]:
                        raise ValueError("The retained cohort work contains features outside this original selection")
                    # Commit a compact, independent completed row database. Final source
                    # verification occurs when the enclosing original vector read closes.
                    folder = self.workspace.root / "spatial-cohorts-data" / request_sha
                    folder.mkdir(parents=True, exist_ok=True)
                    report("retaining")
                    temporary = folder / ".rows.sqlite"
                    temporary.unlink(missing_ok=True)
                    target = sqlite3.connect(str(temporary))
                    try:
                        connection.backup(target)
                    finally:
                        target.close()
                    with temporary.open("rb") as stream:
                        os.fsync(stream.fileno())
                    os.replace(temporary, folder / "rows.sqlite")
                    files = self._tables(connection, folder, report)
                    rows_file = _artifact(self.workspace, folder / "rows.sqlite")
                    rows_file["count"] = total
                    value = {"project_id": self.workspace.project["id"], "algorithm": ALGORITHM,
                             "title": request["title"], "notes": request["notes"],
                             "request": request, "request_sha256": request_sha, "pair": pair,
                             "feature_count": total, "completed_count": counts["completed"],
                             "excluded_count": counts["excluded"], "missing_count": counts["missing"],
                             "rows_file": rows_file, "files": files, "columns": COLUMNS,
                             "sampling": {"resolution": "original native raster cells",
                                          "resampling": "none", "overlap": "each original feature measured independently; overlapping polygons are not additive",
                                          "comparison": "aligned original rasters on their shared valid native cells",
                                          "sum": "native physical pixel-value sums; no density-to-total conversion"}}
                finally:
                    connection.close()
            with held(self.workspace.root / ".workspace.lock"):
                saved = self.workspace._save(KIND, value)
            report("complete", cohort_id=saved["id"])
            return saved

    def _tables(self, connection, folder, report):
        paths = [folder / "summary.csv", folder / "categories.csv"]
        temporary = [folder / ".summary.csv", folder / ".categories.csv"]
        with temporary[0].open("w", encoding="utf-8", newline="") as summary, temporary[1].open("w", encoding="utf-8", newline="") as categories:
            writer, category_writer = csv.writer(summary), csv.writer(categories)
            writer.writerow(COLUMNS)
            category_writer.writerow(["feature_id", "label", "region_analysis_id", "series", "units",
                                      "native_category_value", "count", "fraction_of_valid"])
            for index, (body,) in enumerate(connection.execute("SELECT row_json FROM rows ORDER BY feature_id"), 1):
                row = json.loads(body)
                writer.writerow([row.get(name) for name in COLUMNS])
                if row["region_analysis_id"] and any(row.get(side + "_kind") == "categorical" for side in ("primary", "comparison")):
                    original = self.workspace._get(REGION_KIND, row["region_analysis_id"])
                    for name, result in original["results"].items():
                        for category in result["statistics"].get("categories", []):
                            category_writer.writerow([row["feature_id"], row["label"], original["id"], name,
                                                      result["units"], category["value"], category["count"],
                                                      category["fraction_of_valid"]])
                if index % 128 == 0:
                    report("retaining", rows_written=index)
            for stream in (summary, categories):
                stream.flush()
                os.fsync(stream.fileno())
        for source, destination in zip(temporary, paths):
            os.replace(source, destination)
        return [_artifact(self.workspace, path) for path in paths]

    def _file(self, metadata):
        path = self.workspace.root / metadata["path"]
        resolved = path.resolve()
        if not resolved.is_relative_to((self.workspace.root / "spatial-cohorts-data").resolve()) or path.is_symlink():
            raise ValueError("The retained cohort artifact leaves its original workspace")
        before = _signature(path)
        if before[2] != metadata["bytes"]:
            raise ValueError("The original retained cohort artifact length changed")
        key = (str(path), metadata["sha256"])
        with self._lock:
            verified = self._verified.get(key) == before
        if not verified and file_digest(path) != metadata["sha256"]:
            raise ValueError("The original retained cohort artifact changed")
        if _signature(path) != before:
            raise ValueError("The original retained cohort artifact changed during reading")
        with self._lock:
            self._verified[key] = before
        return path

    def inspect(self, key):
        value = self.workspace._get(KIND, identifier(key))
        request = value.get("request", {})
        if value.get("project_id") != self.workspace.project["id"] or value.get("algorithm") != ALGORITHM:
            raise ValueError("This cohort belongs to another original workspace or algorithm")
        if digest(request) != value.get("request_sha256"):
            raise ValueError("The retained cohort selection changed")
        layers = self.spatial._layers()
        for binding in [request["source_binding"], *request["bindings"].values()]:
            _, record = self.spatial._selected(binding["selection"], layers)
            if any(binding.get(name) != record["public"].get(name) for name in ("sha256", "bytes", "group", "owner_id", "role")):
                raise ValueError("Restore the original source edition for this cohort")
        for metadata in [value["rows_file"], *value["files"]]:
            self._file(metadata)
        return value

    def page(self, key, *, offset=0, limit=100, search="", sort="feature_id", descending=False):
        value = self.inspect(key)
        offset = _integer(offset, "Cohort row offset", minimum=0, maximum=2 ** 53 - 1)
        limit = _integer(limit, "Cohort page size", minimum=1, maximum=500)
        search = _text(search, "Cohort row search", limit=4096, empty=True)
        if sort not in SORTS or not isinstance(descending, bool):
            raise ValueError("Choose an existing cohort sort column and direction")
        path = self._file(value["rows_file"])
        before = _signature(path)
        connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            query, parameters = "", []
            if search:
                pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                query, parameters = " WHERE feature_id LIKE ? ESCAPE '\\' OR label LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\'", [pattern] * 3
            total = connection.execute("SELECT count(*) FROM rows" + query, parameters).fetchone()[0]
            column = SORTS[sort]
            ordering = " ORDER BY (" + column + " IS NULL), " + column + (" DESC" if descending else " ASC") + ", feature_id ASC"
            rows = [json.loads(row[0]) for row in connection.execute("SELECT row_json FROM rows" + query + ordering + " LIMIT ? OFFSET ?",
                                                                  parameters + [limit, offset])]
        finally:
            connection.close()
        if _signature(path) != before:
            raise ValueError("The original cohort rows changed during reading")
        return {**value, "rows": rows, "offset": offset, "limit": limit, "total": total,
                "has_more": offset + len(rows) < total, "search": search, "sort": sort, "descending": descending}

    def catalog(self):
        names = ("id", "title", "project_id", "request_sha256", "algorithm", "feature_count",
                 "completed_count", "excluded_count", "missing_count")
        return [{name: value[name] for name in names} for value in self.workspace._list(KIND)]

    def verify(self):
        count = 0
        for saved in self.workspace._list(KIND):
            value = self.inspect(saved["id"])
            path = self._file(value["rows_file"])
            connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
            try:
                total = 0
                for feature_id, analysis_id in connection.execute("SELECT feature_id, region_analysis_id FROM rows"):
                    total += 1
                    if analysis_id:
                        region = self.workspace._get(REGION_KIND, analysis_id)
                        if region["request"]["source_feature"]["id"] != feature_id:
                            raise ValueError("The cohort row references another original feature")
                if total != value["feature_count"]:
                    raise ValueError("The retained cohort feature count changed")
            finally:
                connection.close()
            count += 1
        return {"cohorts": count}
