"""Persistent land-priority studies and spatially explicit conservation portfolios.

Native quantitative studies read the original InVEST 3.20 NDR/SDR registry.
Source-context studies operate retained boundaries before a native run is selected.
"""
from __future__ import annotations

from contextlib import ExitStack
import csv
import html
import io
import json
import math
from pathlib import Path
import zipfile

from .common import (
    INVEST_VERSION, atomic_bytes, atomic_json, canonical, describe_file, digest,
    finite, held, identifier, now, read_json, verify_file,
)
from . import rasters
from .source_lineage import source_snapshot
from . import conservation_reporting

VERSION = 1
POLLUTANTS = {
    "nitrogen_export": ("ndr", "n_total_export", "kg/year"),
    "phosphorus_export": ("ndr", "p_surface_export", "kg/year"),
    "sediment_export": ("sdr", "sed_export", "metric_tonnes/year"),
}
GUIDES = {
    "ndr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
    "sdr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
}
CONTEXT_NAMES = ("protected_lands", "drinking_water", "high_quality_waters")
CONTEXT_AXES = ("source_water_fraction", "unprotected_fraction", "high_quality_context")
METHOD = {
    "native_units": "InVEST 3.20 native NDR kg/ha/year and SDR metric tonnes/ha/year.",
    "native_selection": "Each original run selects NDR, SDR or both. Omitted models retains historical combined behavior; unselected pollutant quantities and native support remain null with explicit reasons.",
    "comparison_selection": "Alternative quantities retain their own model selection. A paired delta requires that pollutant in both original cases before common-cell support is computed.",
    "aggregation": "Native cell rate multiplied by the polygon-cell intersection area in hectares.",
    "within_cell_assumption": "The rate is uniform over each original native cell; boundary allocation changes area weights, not the retained model resolution.",
    "stream_support": "Original NoData coincident with a verified same-stage stream cell is retained as a structural omission; no mass is added.",
    "comparison_support": "Scenario deltas use cells valid in both runs. Common structural omissions contribute coverage, without adding mass.",
    "scenario_direction": "delta = alternative minus baseline; reduction = baseline minus alternative.",
    "scenario_scope": "Each spatial delta is the selected-footprint contribution within the full modeled scenario. A selected-action result comes from running a scenario whose actual change mask is the selected portfolio.",
    "portfolio": "Model quantities and context areas are recomputed on the geometric union of the selected reporting-area footprints.",
    "context": "Fractions describe overlap with the selected retained source editions and their declared relation.",
    "ranking": "Selected physical or context scores retain their normalization; published practice scores retain their criterion points, prerequisites and exact source bindings.",
    "references": GUIDES,
}


def _copy(value):
    return json.loads(canonical(value))


def _text(value, name, *, default=None):
    if value is None and default is not None:
        return default
    if not isinstance(value, str) or not value.strip():
        raise ValueError(name + " needs nonempty text")
    return value.strip()


def _number(value, name, *, minimum=0, maximum=None):
    result = finite(value, name, minimum=minimum)
    if maximum is not None and result > maximum:
        raise ValueError(name + " exceeds " + str(maximum))
    return result


def _choice(value, name):
    if not isinstance(value, dict):
        raise ValueError("Select the retained " + name + " source")
    result = _copy(value)
    result["source_collection_id"] = identifier(result.get("source_collection_id"))
    result["source_id"] = _text(result.get("source_id"), name + " source ID")
    if result.get("where") is not None and not isinstance(result["where"], dict):
        raise ValueError(name + " where must map native field names to exact typed values")
    for key in ("id_field", "label_field", "layer", "reference", "meaning", "relation"):
        if key in result and result[key] is not None:
            result[key] = _text(result[key], name + " " + key)
    if "buffer_m" in result:
        result["buffer_m"] = _number(result["buffer_m"], name + " buffer")
    return result


def _spec(value):
    if not isinstance(value, dict):
        raise ValueError("Supply a conservation study selection")
    result = _copy(value)
    result.pop("id", None)
    result.pop("schema", None)
    result["title"] = _text(result.get("title"), "Study title")
    mode = result.get("mode") or ("native_model" if result.get("baseline_run_id") else "source_context")
    if mode not in ("native_model", "source_context"):
        raise ValueError("Mode must be source_context or native_model")
    result["mode"] = mode
    result["purpose"] = result.get("purpose", "screening")
    if result["purpose"] not in ("screening", "protection", "restoration"):
        raise ValueError("Purpose must be screening, protection or restoration")
    result["unit_type"] = result.get("unit_type", "parcel")
    if result["unit_type"] not in ("parcel", "watershed", "management_unit"):
        raise ValueError("Unit type must be parcel, watershed or management_unit")
    result["planning_unit_label"] = _text(
        result.get("planning_unit_label"), "Planning unit label",
        default={"parcel": "Parcels", "watershed": "Watersheds", "management_unit": "Management units"}[result["unit_type"]],
    )
    result["parcels"] = _choice(result.get("parcels"), "planning units")
    alts = result.get("alternative_run_ids", [])
    if not isinstance(alts, list) or len(set(alts)) != len(alts):
        raise ValueError("Alternative run IDs must be a list without duplicates")
    result["alternative_run_ids"] = [identifier(x) for x in alts]
    if mode == "native_model":
        result["baseline_run_id"] = identifier(result.get("baseline_run_id"))
        if result["baseline_run_id"] in alts:
            raise ValueError("Baseline and alternatives must be distinct")
    else:
        if result.get("baseline_run_id") or alts:
            raise ValueError("Choose native_model mode when selecting model runs")
        result["baseline_run_id"] = None
        result["reporting_area"] = _choice(result.get("reporting_area"), "reporting area")
        result["analysis_crs"] = _text(result.get("analysis_crs"), "Analysis CRS", default="EPSG:5070")
    contexts = result.get("contexts", {})
    if not isinstance(contexts, dict) or set(contexts) - set(CONTEXT_NAMES):
        raise ValueError("Context sources must use protected_lands, drinking_water or high_quality_waters")
    result["contexts"] = {key: _choice(value, key) for key, value in contexts.items() if value is not None}
    rules = {
        "minimum_coverage_fraction": .95, "maximum_protected_fraction": 1,
        "minimum_source_water_fraction": 0, "minimum_area_ha": 0,
        "require_high_quality_context": False, "excluded_ids": [],
        **result.get("rules", {}),
    }
    for key in ("minimum_coverage_fraction", "maximum_protected_fraction", "minimum_source_water_fraction"):
        rules[key] = _number(rules[key], key, maximum=1)
    rules["minimum_area_ha"] = _number(rules["minimum_area_ha"], "minimum_area_ha")
    if not isinstance(rules["require_high_quality_context"], bool):
        raise ValueError("require_high_quality_context must be true or false")
    if not isinstance(rules["excluded_ids"], list) or not all(isinstance(x, str) for x in rules["excluded_ids"]):
        raise ValueError("excluded_ids must list original text feature identities")
    rules["excluded_ids"] = sorted(set(rules["excluded_ids"]))
    if rules["maximum_protected_fraction"] < 1 and "protected_lands" not in result["contexts"]:
        raise ValueError("The protected-area rule needs its selected source")
    if rules["minimum_source_water_fraction"] > 0 and "drinking_water" not in result["contexts"]:
        raise ValueError("The source-water rule needs its selected polygon source")
    if rules["require_high_quality_context"] and "high_quality_waters" not in result["contexts"]:
        raise ValueError("The high-quality-water rule needs its selected designation source")
    result["rules"] = rules
    score = {"basis": "context" if mode == "source_context" else "current_export", "scale": "total",
             **result.get("score", {})}
    if score["basis"] not in ("context", "current_export", "scenario_reduction", "disturbance_increase", "published_method"):
        raise ValueError("Choose context, current_export, scenario_reduction, disturbance_increase or published_method")
    if score["scale"] not in ("total", "per_hectare"):
        raise ValueError("Score scale must be total or per_hectare")
    if mode == "source_context" and score["basis"] not in ("context", "published_method"):
        raise ValueError("A physical score requires a selected native model run")
    if score["basis"] in ("scenario_reduction", "disturbance_increase"):
        score["alternative_run_id"] = identifier(score.get("alternative_run_id"))
        if score["alternative_run_id"] not in alts:
            raise ValueError("Select the scoring alternative among this study's retained alternative runs")
    if score["basis"] == "published_method":
        from .keowee_priority import normalize_score
        score = normalize_score(score, result)
    elif score["basis"] == "context":
        weights = {key: 0 for key in CONTEXT_AXES}
        weights.update(score.get("context_weights", {}))
        if set(weights) != set(CONTEXT_AXES):
            raise ValueError("Context weights must use the declared three context axes")
        for key, weight in weights.items():
            weights[key] = _number(weight, key + " weight")
            needed = {"source_water_fraction": "drinking_water", "unprotected_fraction": "protected_lands",
                      "high_quality_context": "high_quality_waters"}[key]
            if weights[key] > 0 and needed not in result["contexts"]:
                raise ValueError(key + " scoring needs its selected source")
        score["context_weights"] = weights
    else:
        weights = score.get("weights", {key: 1 for key in POLLUTANTS})
        if not isinstance(weights, dict) or set(weights) != set(POLLUTANTS):
            raise ValueError("Supply separate nitrogen, phosphorus and sediment weights")
        score["weights"] = {key: _number(value, key + " weight") for key, value in weights.items()}
        if sum(score["weights"].values()) <= 0:
            raise ValueError("At least one pollutant weight must be positive")
        if score.get("caps") is not None:
            if set(score["caps"]) != set(POLLUTANTS):
                raise ValueError("Explicit normalization caps must cover all three pollutants")
            score["caps"] = {key: _number(value, key + " cap") for key, value in score["caps"].items()}
        score["percentile"] = _number(score.get("percentile", 95), "Normalization percentile", maximum=100)
        if score["percentile"] <= 0:
            raise ValueError("Normalization percentile must be positive")
    result["score"] = score
    if result.get("costs") is not None:
        costs = _choice(result["costs"], "cost table")
        for key in ("id_column", "value_column", "currency", "reference"):
            costs[key] = _text(costs.get(key), "Cost " + key)
        result["costs"] = costs
    return result


def _source(workspace, choice, *, kind="vector"):
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if entry["kind"] != kind:
        raise ValueError("Source " + choice["source_id"] + " must be " + kind)
    return path, {
        **source_snapshot(entry, choice),
        "reference": choice.get("reference"), "meaning": choice.get("meaning"),
        "relation": choice.get("relation", "Intersection with the selected retained source geometry"),
    }


def _selected_models(selection):
    """Use the maintained selection contract, including original combined runs."""
    from . import common
    normalizer = getattr(common, "selected_models", None)
    if normalizer is not None:
        return normalizer(selection)
    # The addon also opens the original combined-model Workspace edition.
    # Its saved selections omit models; later explicit selections use the same
    # validated names and stable order as the maintained core.
    values = selection.get("models", ["ndr", "sdr"])
    if (not isinstance(values, (list, tuple)) or not values
            or any(not isinstance(value, str) for value in values)):
        raise ValueError("Select a nonempty native model list containing ndr, sdr")
    names = [value.strip().lower() for value in values]
    if len(names) != len(set(names)) or set(names) - {"ndr", "sdr"}:
        raise ValueError("Select each native model once from ndr, sdr")
    return [name for name in ("ndr", "sdr") if name in names]


def _selected_outputs(selection):
    models = _selected_models(selection)
    return [key for key, (model, _, _) in POLLUTANTS.items() if model in models]



def _native_execution(run, *, require_supported=True):
    """Resolve the maintained per-model provenance for this rate-unit adapter."""
    from .native_versions import POLICY, model_versions, native_version
    selected = _selected_models(run["selection"])
    versions = model_versions(run, selected)
    supported = all(row["comparison_version"] == INVEST_VERSION for row in versions.values())
    result = {
        "policy": POLICY, "unit_contract_version": INVEST_VERSION,
        "supported": supported, "run_version": native_version(run),
        "model_versions": versions, "runtime_history": _copy(run.get("runtime_history", [])),
    }
    if require_supported and not supported:
        incompatible = [
            name.upper() + "=" + str(row["comparison_version"]) + " (" + row["basis"] + ")"
            for name, row in versions.items() if row["comparison_version"] != INVEST_VERSION
        ]
        raise ValueError(
            "Conservation's native rate-unit adapter requires InVEST " + INVEST_VERSION +
            " for each selected model; run " + str(run.get("id", "")) + " has " +
            ", ".join(incompatible) + ". The retained requested version is " +
            str(run.get("selection", {}).get("invest_version")) + ".")
    return result


def _bound_native_execution(workspace, state, *, require_supported=True):
    """Reopen original run registries without changing a saved study's identity."""
    result = {}
    for key, bound in state["selection"]["bindings"]["runs"].items():
        run = workspace.inspect_run(key)
        if run["state"] != "complete" or run["selection"] != bound["selection"]:
            raise ValueError("The completed native case differs from the original study: " + key)
        execution = _native_execution(run, require_supported=require_supported)
        if bound.get("execution") is not None and bound["execution"] != execution:
            raise ValueError("The completed model execution provenance differs from the bound study: " + key)
        expected = set(_selected_outputs(run["selection"]))
        if set(bound["outputs"]) != expected:
            raise ValueError("The bound output inventory differs from the original model selection: " + key)
        for pollutant, output in bound["outputs"].items():
            stage = run.get("stages", {}).get(output["stage"]) or {}
            if not isinstance(stage.get("files"), dict):
                raise ValueError("The original completed stage output registry is absent: " + key)
            pairs = (
                (stage["files"].get(output["output_id"]), output["rate"]),
                (stage["files"].get(output["stream_id"]), output["stream"]),
                (stage.get("arguments"), output["arguments"]),
            )
            if any(not isinstance(current, dict) or any(
                    current.get(field) != retained.get(field)
                    for field in ("path", "bytes", "sha256")) for current, retained in pairs):
                raise ValueError("The native output registry differs from the bound original run: " + key)
            if (output.get("execution") is not None
                    and output["execution"] != execution["model_versions"][output["stage"]]):
                raise ValueError("The output execution version differs from its original model stage: " + key)
        result[key] = execution
    return result

def _native(workspace, spec):
    result, grid = {}, None
    if spec["mode"] == "source_context":
        return result, grid
    if INVEST_VERSION != "3.20.0":
        raise ValueError("Conservation quantities require the original InVEST 3.20.0 output-unit contract")
    for key in [spec["baseline_run_id"]] + spec["alternative_run_ids"]:
        run = workspace.inspect_run(key)
        if run["state"] != "complete":
            raise ValueError("Complete native run " + key + " before selecting its quantitative results")
        execution = _native_execution(run)
        selected_grid = workspace.get_grid(run["selection"]["grid_id"])
        if grid is not None and selected_grid["id"] != grid["id"]:
            raise ValueError("Baseline and alternatives must share the same retained reporting/model grid")
        grid = selected_grid
        root = workspace.root / "runs" / key
        outputs, arguments_by_stage, verified = {}, {}, set()
        for pollutant in _selected_outputs(run["selection"]):
            stage_name, output_id, unit = POLLUTANTS[pollutant]
            stage = run.get("stages", {}).get(stage_name)
            if not isinstance(stage, dict) or "arguments" not in stage or "files" not in stage:
                raise ValueError("Completed selected native " + stage_name.upper() + " stage is missing from run " + key)
            if stage_name not in arguments_by_stage:
                arguments_by_stage[stage_name] = read_json(verify_file(root, stage["arguments"]))
            arguments = arguments_by_stage[stage_name]
            stream_id = "stream_and_drainage" if stage_name == "sdr" and arguments.get("drainage_path") else "stream"
            for name in (output_id, stream_id):
                if name not in stage["files"]:
                    raise ValueError("Native " + stage_name + " registry is missing " + name)
                item = stage["files"][name]
                identity = (item["path"], item["bytes"], item["sha256"])
                if identity not in verified:
                    verify_file(root, item)
                    verified.add(identity)
            outputs[pollutant] = {
                "stage": stage_name, "output_id": output_id, "rate": stage["files"][output_id],
                "stream_id": stream_id, "stream": stage["files"][stream_id],
                "arguments": stage["arguments"], "unit": unit,
                "execution": _copy(execution["model_versions"][stage_name]),
            }
        result[key] = {
            "id": key, "selection": run["selection"], "completed_at": run.get("completed_at"),
            "runtime": run.get("runtime"), "execution": execution, "outputs": outputs,
        }
    return result, grid

def prepare(workspace, value):
    """Bind a reusable immutable selection to original source and native identities."""
    spec = _spec(value)
    native, grid = _native(workspace, spec)
    if native and spec["score"]["basis"] not in ("context", "published_method"):
        available = set(native[spec["baseline_run_id"]]["outputs"])
        if spec["score"]["basis"] in ("scenario_reduction", "disturbance_increase"):
            available &= set(native[spec["score"]["alternative_run_id"]]["outputs"])
        if not available:
            raise ValueError("The selected scoring cases have no shared native pollutant outputs; choose compatible cases or a context score")
        if "weights" not in value.get("score", {}):
            spec["score"]["weights"] = {key: 1 if key in available else 0 for key in POLLUTANTS}
        unavailable = [key for key, weight in spec["score"]["weights"].items()
                       if weight > 0 and key not in available]
        if unavailable:
            raise ValueError("Positive score weights require selected native outputs in every scoring case; set these weights to zero or select matching models: "
                             + ", ".join(unavailable))
    if native and spec["score"]["basis"] == "published_method":
        required = set(spec["score"]["native_required_pollutants"])
        missing = required - set(native[spec["baseline_run_id"]]["outputs"])
        if missing:
            raise ValueError("The selected published export criteria require these baseline native outputs: "
                             + ", ".join(sorted(missing)))
    sources = {}
    for name, choice in [("parcels", spec["parcels"])] + list(spec["contexts"].items()):
        _, sources[name] = _source(workspace, choice)
    if spec["mode"] == "source_context":
        _, sources["reporting_area"] = _source(workspace, spec["reporting_area"])
    else:
        verify_file(workspace.root / "grids" / grid["id"], grid["files"]["reporting_area"])
    if spec.get("costs"):
        _, sources["costs"] = _source(workspace, spec["costs"], kind="table")
    bindings = {"sources": sources, "runs": native,
                "grid": {"id": grid["id"], "grid": grid["grid"], "reporting_area": grid["files"]["reporting_area"]}
                if grid else None}
    if spec["score"]["basis"] == "published_method":
        from .keowee_priority import bind
        bindings["published_method"] = bind(workspace, spec)
        if bindings["published_method"].get("criteria_source"):
            sources["priority_metrics"] = bindings["published_method"]["criteria_source"]
    selection = {"version": VERSION, "spec": spec, "bindings": bindings}
    key = digest(selection)
    directory = workspace.root / "conservation" / key
    with held(workspace.root / ".workspace.lock", blocking=False):
        path = directory / "study.json"
        if path.exists():
            return inspect(workspace, key, include_candidates=False)
        state = {
            "schema": "upstate.conservation-study/v1", "id": key, "title": spec["title"],
            "mode": spec["mode"], "metric_state": "modeled" if native else "context_only",
            "purpose": spec["purpose"], "unit_type": spec["unit_type"],
            "planning_unit_label": spec["planning_unit_label"], "state": "prepared",
            "created_at": now(), "selection": selection, "spec": spec, "method": METHOD, "files": {},
        }
        atomic_json(path, state, immutable=True)
        return state


def _read_state(workspace, key):
    key = identifier(key)
    state = read_json(workspace.root / "conservation" / key / "study.json")
    if state.get("id") != key or digest(state.get("selection")) != key:
        raise ValueError("Retained conservation selection changed")
    return state


def inspect(workspace, key, *, include_candidates=True):
    state = _read_state(workspace, key)
    state["spec"] = state["selection"]["spec"]
    state["native_execution"] = _bound_native_execution(workspace, state, require_supported=False)
    if include_candidates and state["state"] == "complete":
        path = verify_file(workspace.root, state["files"]["candidates"])
        state = {**state, "candidates": read_json(path)["candidates"]}
    return state


def overview(workspace):
    def short(row):
        return {key: row.get(key) for key in (
            "id", "title", "state", "mode", "metric_state", "purpose", "unit_type",
            "planning_unit_label", "created_at", "completed_at", "study_id", "summary", "progress", "error",
        )}
    studies = [_read_state(workspace, p.parent.name)
               for p in sorted((workspace.root / "conservation").glob("*/study.json"))]
    plans = [get_plan(workspace, p.parent.name)
             for p in sorted((workspace.root / "conservation-plans").glob("*/plan.json"))]
    return {"schema": "upstate.conservation-overview/v1",
            "studies": [short(x) for x in studies], "plans": [short(x) for x in plans]}


def _typed_match(properties, where):
    for field, expected in (where or {}).items():
        if field not in properties:
            return False
        actual = properties[field]
        if isinstance(expected, bool) or isinstance(actual, bool):
            if type(actual) is not type(expected) or actual != expected:
                return False
        elif actual != expected:
            return False
    return True


def _vector(workspace, choice, source, crs):
    path, current = _source(workspace, choice)
    if current["body"]["sha256"] != source["body"]["sha256"]:
        raise ValueError("Selected source edition changed")
    rows = None
    # Reuse the original domain parser for the retained Esri polygon source.
    # Raw rings, native coordinate axes and exact input bytes remain in Workspace.
    if path.name.endswith((".json", ".json.gz")):
        import gzip
        from pyproj import CRS, Transformer
        from shapely.ops import transform
        from source.capture_upstream_network import esri_polygon
        with path.open("rb") as stream:
            zipped = stream.read(2) == b"\x1f\x8b"
        body = gzip.open(path, "rt", encoding="utf-8") if zipped else path.open(encoding="utf-8")
        with body:
            document = json.load(body)
        if (isinstance(document, dict) and document.get("geometryType") == "esriGeometryPolygon"
                and isinstance(document.get("features"), list)):
            reference = document.get("spatialReference") or {}
            if reference.get("wkt"):
                native = CRS.from_wkt(reference["wkt"])
            else:
                wkid = reference.get("latestWkid") or reference.get("wkid")
                if wkid in (102100, 102113):
                    wkid = 3857
                if wkid is None:
                    raise ValueError("The original Esri polygon source has no coordinate reference")
                native = CRS.from_epsg(wkid)
            projection = Transformer.from_crs(native, crs, always_xy=True).transform
            oid = source.get("id_field") or document.get("objectIdFieldName") or document.get("objectIdField")
            if oid is None:
                oid = next((field["name"] for field in document.get("fields", [])
                            if field.get("type") == "esriFieldTypeOID"), None)
            rows = []
            for index, feature in enumerate(document["features"]):
                attributes = feature.get("attributes", {})
                if not _typed_match(attributes, choice.get("where")):
                    continue
                identity = str(attributes.get(oid)) if oid else str(index)
                original_geometry = feature.get("geometry")
                if original_geometry is None:
                    continue
                if original_geometry.get("spatialReference"):
                    member_ref = original_geometry["spatialReference"]
                    member_wkid = member_ref.get("latestWkid") or member_ref.get("wkid")
                    if member_wkid is not None:
                        if member_wkid in (102100, 102113):
                            member_wkid = 3857
                        if CRS.from_epsg(member_wkid) != native:
                            raise ValueError("Esri feature CRS differs from its retained collection")
                corrections = []
                planar = {**original_geometry, "rings": [
                    [coordinate[:2] for coordinate in ring]
                    for ring in original_geometry.get("rings", [])
                ]}
                geometry = esri_polygon(planar, corrections, identity)
                if native != crs:
                    geometry = transform(projection, geometry)
                if geometry.is_empty:
                    continue
                rows.append({
                    "id": identity, "properties": attributes, "geometry": geometry,
                    "geometry_corrections": corrections, "source_array_index": index,
                    "source_axes": {"hasZ": document.get("hasZ"), "hasM": document.get("hasM"),
                                    "analysis_axes": "XY", "native_spatial_reference": reference},
                })
    if rows is None:
        rows, _ = rasters.vector_geometry(path, layer=source.get("layer"), target_crs=crs)
        rows = [r for r in rows if _typed_match(r["properties"], choice.get("where"))]
    if not rows:
        raise ValueError("The selected native source filter has no features: " + source["id"])
    return rows


def _polygon(geometry):
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    if geometry.is_empty:
        return GeometryCollection()
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry
    if geometry.geom_type == "GeometryCollection":
        parts = [_polygon(x) for x in geometry.geoms]
        return unary_union([x for x in parts if not x.is_empty])
    return GeometryCollection()


def _geometry_inputs(workspace, state):
    from pyproj import CRS
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    selection = state["selection"]
    spec, bindings = selection["spec"], selection["bindings"]
    if bindings["grid"]:
        grid = bindings["grid"]
        crs = CRS.from_user_input(grid["grid"]["crs"])
        boundary = verify_file(workspace.root / "grids" / grid["id"], grid["reporting_area"])
        rows, _ = rasters.vector_geometry(boundary, target_crs=crs)
    else:
        crs = CRS.from_user_input(spec["analysis_crs"])
        rows = _vector(workspace, spec["reporting_area"], bindings["sources"]["reporting_area"], crs)
    factors = [axis.unit_conversion_factor for axis in crs.axis_info[:2]]
    if crs.to_epsg() == 3857:
        raise ValueError("Use the study equal-area or suitable local metric CRS for areal quantities; reproject the retained Web Mercator source")
    if not crs.is_projected or len(factors) != 2 or any(abs(x - 1) > 1e-8 for x in factors):
        raise ValueError("Select a projected analysis CRS with metre axes for areas and distances")
    reporting = rasters.polygon_union(rows)
    units = _vector(workspace, spec["parcels"], bindings["sources"]["parcels"], crs)
    field = bindings["sources"]["parcels"].get("id_field")
    label_field = spec["parcels"].get("label_field")
    records, seen = [], set()
    for row in units:
        geometry = row["geometry"]
        if geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Planning units require retained polygon boundaries")
        if not geometry.is_valid:
            raise ValueError("Planning unit geometry requires an explicit source correction")
        key_value = row["properties"].get(field) if field else row["id"]
        if key_value is None or isinstance(key_value, bool):
            raise ValueError("Planning unit identity must be a non-null native text or numeric key")
        key = str(key_value)
        if key in seen:
            raise ValueError("Planning unit identities repeat; select the unique native feature key")
        seen.add(key)
        clipped = _polygon(geometry.intersection(reporting))
        if clipped.is_empty or clipped.area <= 0:
            continue
        label = row["properties"].get(label_field) if label_field else None
        records.append({
            "id": key, "label": str(label) if label is not None else key,
            "properties": row["properties"], "geometry": geometry, "clipped": clipped,
            "geometry_corrections": row.get("geometry_corrections", []),
            "source_axes": row.get("source_axes"), "source_array_index": row.get("source_array_index"),
        })
    if not records:
        raise ValueError("No selected planning unit has positive area in the reporting boundary")
    contexts, context_metadata = {}, {}
    for name, choice in spec["contexts"].items():
        source = bindings["sources"][name]
        selected = _vector(workspace, choice, source, crs)
        union = unary_union([row["geometry"] for row in selected])
        if name in ("protected_lands", "drinking_water") and union.geom_type not in ("Polygon", "MultiPolygon"):
            if choice.get("buffer_m", 0) <= 0:
                raise ValueError(name + " area coverage needs polygons or an explicit metric buffer and relation")
        if choice.get("buffer_m", 0):
            if not choice.get("relation"):
                raise ValueError("Describe the geographic relation represented by the selected context buffer")
            union = union.buffer(choice["buffer_m"])
        contexts[name] = union.intersection(reporting) if union.intersects(reporting) else GeometryCollection()
        context_metadata[name] = {
            **source, "selected_feature_count": len(selected), "buffer_m": choice.get("buffer_m", 0),
            "native_geometry_types": sorted({r["geometry"].geom_type for r in selected}),
        }
    return crs, reporting, sorted(records, key=lambda x: x["id"]), contexts, context_metadata


def _cost_table(workspace, state):
    spec = state["selection"]["spec"]
    if not spec.get("costs"):
        return {}
    choice = spec["costs"]
    path, source = _source(workspace, choice, kind="table")
    if source["body"]["sha256"] != state["selection"]["bindings"]["sources"]["costs"]["body"]["sha256"]:
        raise ValueError("The original cost table changed")
    with path.open(encoding="utf-8-sig", newline="") as f:
        table = csv.DictReader(f)
        required = {choice["id_column"], choice["value_column"]}
        if not table.fieldnames or required - set(table.fieldnames):
            raise ValueError("The original cost table lacks its selected identity or value column")
        values = {}
        for row in table:
            key = row[choice["id_column"]]
            if not key or key in values:
                raise ValueError("Cost records need unique nonempty original planning-unit identities")
            raw = row[choice["value_column"]]
            values[key] = None if raw is None or not raw.strip() else _number(raw, "Cost for " + key)
    return values


def _open_native(workspace, state, stack):
    import rasterio
    _bound_native_execution(workspace, state)
    opened, result, reference = {}, {}, None
    for key, run in state["selection"]["bindings"]["runs"].items():
        root = workspace.root / "runs" / key
        result[key] = {"_profile_changed": run["selection"]["profile_id"] != state["selection"]["bindings"]["runs"][state["selection"]["spec"]["baseline_run_id"]]["selection"]["profile_id"]}
        for pollutant, output in run["outputs"].items():
            row = {}
            for role in ("rate", "stream"):
                path = verify_file(root, output[role])
                if path not in opened:
                    opened[path] = stack.enter_context(rasterio.open(path))
                row[role] = opened[path]
                if reference is None:
                    reference = opened[path]
                rasters.check_same_grid(reference, opened[path])
            result[key][pollutant] = row
    if reference is not None:
        if (reference.count != 1 or reference.transform.b != 0 or reference.transform.d != 0
                or reference.transform.a <= 0 or reference.transform.e >= 0):
            raise ValueError("Conservation aggregation needs the original north-up single-band model grid")
        grid = state["selection"]["bindings"]["grid"]["grid"]
        resolution = _number(grid["resolution_m"], "Retained native grid resolution")
        if resolution <= 0:
            raise ValueError("The retained native grid resolution must be positive")
        if (not math.isclose(reference.transform.a, resolution, rel_tol=1e-9, abs_tol=1e-7)
                or not math.isclose(-reference.transform.e, resolution, rel_tol=1e-9, abs_tol=1e-7)):
            raise ValueError("Native outputs must preserve the original selected model grid's cell size")
    return reference, result


def _area_windows(reference, geometry):
    """Block sums for interiors; exact polygon-cell intersections at boundaries."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask, geometry_window
    from rasterio.errors import WindowError
    from rasterio.windows import Window
    from shapely.geometry import box, mapping
    try:
        window = geometry_window(reference, [mapping(geometry)])
    except WindowError:
        return
    bh, bw = reference.block_shapes[0]
    pixel_area = abs(reference.transform.a * reference.transform.e)
    for row in range(int(window.row_off) // bh * bh, math.ceil(window.row_off + window.height), bh):
        for col in range(int(window.col_off) // bw * bw, math.ceil(window.col_off + window.width), bw):
            block = Window(col, row, min(bw, reference.width - col), min(bh, reference.height - row))
            transform = reference.window_transform(block)
            height, width = int(block.height), int(block.width)
            xmin, ymax = transform * (0, 0)
            xmax, ymin = transform * (width, height)
            footprint = box(xmin, ymin, xmax, ymax)
            if not geometry.intersects(footprint):
                continue
            if geometry.covers(footprint):
                yield block, np.full((height, width), pixel_area, dtype="float64")
                continue
            shape = (height, width)
            inside = geometry_mask([mapping(geometry)], out_shape=shape, transform=transform,
                                   invert=True, all_touched=False)
            boundary = geometry_mask([mapping(geometry.boundary)], out_shape=shape, transform=transform,
                                     invert=True, all_touched=True)
            weights = inside.astype("float64") * pixel_area
            rr, cc = np.nonzero(boundary)
            # Full pixels use the rasterizer fast path. Only actual boundary
            # pixels invoke exact GEOS intersections, preserving small polygons.
            for r, c in zip(rr.tolist(), cc.tolist()):
                x0, y0 = transform * (c, r)
                x1, y1 = transform * (c + 1, r + 1)
                weights[r, c] = geometry.intersection(box(x0, y1, x1, y0)).area
            if np.any(weights > 0):
                yield block, np.clip(weights, 0, pixel_area)


def _context_metrics(geometry, contexts):
    area = geometry.area
    value = {}
    for name, output in (("protected_lands", "protected"), ("drinking_water", "source_water")):
        source = contexts.get(name)
        covered = geometry.intersection(source).area if source is not None and geometry.intersects(source) else (
            0.0 if source is not None else None)
        value[output + "_area_ha"] = covered / 10000 if covered is not None else None
        value[output + "_fraction"] = min(1., max(0., covered / area)) if covered is not None and area > 0 else None
    source = contexts.get("high_quality_waters")
    if source is None:
        value.update(high_quality_context=None, high_quality_overlap_area_ha=None, high_quality_contact_length_m=None)
    else:
        intersection = geometry.intersection(source)
        value.update(
            high_quality_context=bool(intersection.area > 0 or intersection.length > 0),
            high_quality_overlap_area_ha=intersection.area / 10000,
            high_quality_contact_length_m=intersection.length if source.geom_type in ("LineString", "MultiLineString") else None,
        )
    return value


def _empty_pollutants(area_ha):
    return {
        key: {"unit": row[2], "availability": "unbound", "baseline": None,
              "coverage_fraction": None, "valid_area_ha": None, "selected_area_ha": area_ha,
              "structural_stream_area_ha": None, "missing_area_ha": None, "alternatives": {}}
        for key, row in POLLUTANTS.items()
    }


def _aggregate(reference, datasets, geometry, spec):
    import numpy as np
    area = geometry.area
    if reference is None:
        if spec["mode"] == "native_model":
            raise ValueError("The native study has no retained selected model outputs")
        return _empty_pollutants(area / 10000)
    baseline = spec["baseline_run_id"]
    ids = [baseline] + spec["alternative_run_ids"]
    present = {key: set(datasets[key]) & set(POLLUTANTS) for key in ids}
    totals = {key: {pollutant: {"mass": 0., "valid": 0., "structural": 0., "observed": False}
                    for pollutant in present[key]} for key in ids}
    paired = {key: {pollutant: {"baseline": 0., "alternative": 0., "valid": 0., "structural": 0., "observed": False}
                    for pollutant in present[baseline] & present[key]} for key in spec["alternative_run_ids"]}
    for window, weights in _area_windows(reference, geometry):
        inside = weights > 0
        hectares = weights / 10000
        for pollutant in POLLUTANTS:
            cells = {}
            for key in ids:
                if pollutant not in present[key]:
                    continue
                rate = datasets[key][pollutant]["rate"].read(1, window=window, masked=True)
                stream = datasets[key][pollutant]["stream"].read(1, window=window, masked=True)
                raw = np.ma.getdata(rate)
                masked = np.ma.getmaskarray(rate)
                valid = inside & ~masked & np.isfinite(raw)
                if np.any(raw[valid] < 0):
                    raise ValueError("Native export contains negative rates: " + key + " " + pollutant)
                structural = (inside & masked & ~np.ma.getmaskarray(stream)
                              & np.isfinite(stream.data) & (stream.data == 1))
                total = totals[key][pollutant]
                total["mass"] += float(np.sum(raw[valid] * hectares[valid], dtype="float64"))
                total["valid"] += float(np.sum(weights[valid], dtype="float64"))
                total["structural"] += float(np.sum(weights[structural], dtype="float64"))
                total["observed"] = total["observed"] or bool(np.any(valid))
                cells[key] = (raw, valid, structural)
            if baseline not in cells:
                continue
            base, base_valid, base_structural = cells[baseline]
            for key in spec["alternative_run_ids"]:
                if key not in cells:
                    continue
                other, other_valid, other_structural = cells[key]
                common = base_valid & other_valid
                common_structural = base_structural & other_structural
                pair = paired[key][pollutant]
                pair["baseline"] += float(np.sum(base[common] * hectares[common], dtype="float64"))
                pair["alternative"] += float(np.sum(other[common] * hectares[common], dtype="float64"))
                pair["valid"] += float(np.sum(weights[common], dtype="float64"))
                pair["structural"] += float(np.sum(weights[common_structural], dtype="float64"))
                pair["observed"] = pair["observed"] or bool(np.any(common))

    def coverage(row):
        return min(1., max(0., (row["valid"] + row["structural"]) / area)) if area > 0 else None

    def missing_reason(key, pollutant):
        role = "baseline" if key == baseline else "alternative"
        return POLLUTANTS[pollutant][0].upper() + " was not selected in " + role + " run " + key

    def quantity(key, pollutant, field):
        row = totals[key].get(pollutant)
        value = {
            "availability": "modeled" if row is not None else "not_selected",
            "availability_reason": None if row is not None else missing_reason(key, pollutant),
            field: row["mass"] if row is not None and row["observed"] else None,
            "coverage_fraction": coverage(row) if row is not None else None,
            "valid_area_ha": row["valid"] / 10000 if row is not None else None,
            "selected_area_ha": area / 10000,
            "structural_stream_area_ha": row["structural"] / 10000 if row is not None else None,
            "missing_area_ha": max(0., area - row["valid"] - row["structural"]) / 10000 if row is not None else None,
        }
        return value

    result = {}
    for pollutant, (_, _, unit) in POLLUTANTS.items():
        value = {"unit": unit, **quantity(baseline, pollutant, "baseline"), "alternatives": {}}
        for key in spec["alternative_run_ids"]:
            pair = paired[key].get(pollutant)
            observed = pair is not None and pair["observed"]
            delta = pair["alternative"] - pair["baseline"] if observed else None
            missing = [missing_reason(run_id, pollutant) for run_id in (baseline, key)
                       if pollutant not in present[run_id]]
            value["alternatives"][key] = {
                **quantity(key, pollutant, "value"),
                "comparison_availability": "modeled" if pair is not None else "not_shared",
                "comparison_availability_reason": "; ".join(missing) if missing else None,
                "delta": delta, "reduction": -delta if delta is not None else None,
                "common_baseline": pair["baseline"] if observed else None,
                "common_alternative": pair["alternative"] if observed else None,
                "common_coverage_fraction": coverage(pair) if pair is not None else None,
                "common_valid_area_ha": pair["valid"] / 10000 if pair is not None else None,
                "common_structural_stream_area_ha": pair["structural"] / 10000 if pair is not None else None,
                "profile_changed": datasets[key].get("_profile_changed", False),
            }
        result[pollutant] = value
    return result

def _eligibility(candidate, spec):
    rules, score = spec["rules"], spec["score"]
    reasons = []
    if candidate["id"] in rules["excluded_ids"]:
        reasons.append("Excluded by the saved unit selection")
    if candidate["reporting_area_ha"] < rules["minimum_area_ha"]:
        reasons.append("Reporting area is below the selected minimum")
    protected = candidate["protected_fraction"]
    if rules["maximum_protected_fraction"] < 1 and (protected is None or protected > rules["maximum_protected_fraction"]):
        reasons.append("Selected protected-source coverage exceeds the limit or is unavailable")
    source_water = candidate["source_water_fraction"]
    if rules["minimum_source_water_fraction"] > 0 and (source_water is None or source_water < rules["minimum_source_water_fraction"]):
        reasons.append("Selected source-water overlap is below the required fraction")
    if rules["require_high_quality_context"] and candidate["high_quality_context"] is not True:
        reasons.append("The selected high-quality-water relation is absent")
    if spec["mode"] == "native_model":
        if score["basis"] == "published_method":
            required = {key: 1 for key in score["native_required_pollutants"]}
        elif score["basis"] == "context":
            required = {key: 1 for key, metric in candidate["pollutants"].items()
                        if metric["availability"] == "modeled"}
        else:
            required = score["weights"]
        for key, weight in required.items():
            if weight <= 0:
                continue
            metrics = candidate["pollutants"][key]
            if score["basis"] in ("scenario_reduction", "disturbance_increase"):
                pair = metrics["alternatives"][score["alternative_run_id"]]
                coverage, available = pair["common_coverage_fraction"], pair["delta"]
            else:
                coverage, available = metrics["coverage_fraction"], metrics["baseline"]
            if available is None:
                reason = (pair.get("comparison_availability_reason")
                          if score["basis"] in ("scenario_reduction", "disturbance_increase")
                          else metrics.get("availability_reason"))
                reasons.append(reason or key + " has no valid selected native export cells")
            if coverage is None or coverage + 1e-12 < rules["minimum_coverage_fraction"]:
                reasons.append(key + " coverage is below the selected minimum")
    return reasons


def _quantity(candidate, pollutant, score):
    metrics = candidate["pollutants"][pollutant]
    if score["basis"] == "current_export":
        value = metrics["baseline"]
    else:
        alternative = metrics["alternatives"][score["alternative_run_id"]]
        delta = alternative["delta"]
        value = None if delta is None else max(0., -delta if score["basis"] == "scenario_reduction" else delta)
    if value is not None and score["scale"] == "per_hectare":
        value /= candidate["reporting_area_ha"]
    return value


def _rank(candidates, spec, *, workspace=None, bindings=None):
    if spec["score"]["basis"] == "published_method":
        from .keowee_priority import rank
        return rank(workspace, candidates, spec, bindings["published_method"], bindings)
    import numpy as np
    setting = spec["score"]
    caps = {}
    if setting["basis"] != "context":
        for key in POLLUTANTS:
            values = [_quantity(row, key, setting) for row in candidates if row["eligible"]]
            values = [x for x in values if x is not None and math.isfinite(x) and x > 0]
            caps[key] = (
                setting["caps"][key] if setting.get("caps") is not None
                else float(np.percentile(values, setting["percentile"])) if values else 0.
            )
            if caps[key] == 0 and values and setting.get("caps") is not None and setting["weights"][key] > 0:
                raise ValueError("A zero active normalization cap cannot represent positive " + key + " quantities")
    for row in candidates:
        components, numerator, weight_sum, missing = {}, 0., 0., False
        if setting["basis"] == "context":
            values = {
                "source_water_fraction": row["source_water_fraction"],
                "unprotected_fraction": 1 - row["protected_fraction"] if row["protected_fraction"] is not None else None,
                "high_quality_context": float(row["high_quality_context"]) if row["high_quality_context"] is not None else None,
            }
            for key, weight in setting["context_weights"].items():
                raw = values[key]
                components[key] = {"value": raw, "normalized": raw, "weight": weight}
                if weight > 0:
                    missing |= raw is None
                    numerator += (raw or 0.) * weight
                    weight_sum += weight
        else:
            for key, weight in setting["weights"].items():
                raw = _quantity(row, key, setting)
                normalized = min(1., max(0., raw / caps[key])) if raw is not None and caps[key] > 0 else (
                    0. if raw == 0 else None)
                components[key] = {
                    "value": raw, "normalized": normalized, "cap": caps[key], "weight": weight,
                    "unit": POLLUTANTS[key][2] + ("/ha" if setting["scale"] == "per_hectare" else ""),
                }
                if weight > 0:
                    missing |= normalized is None
                    numerator += (normalized or 0.) * weight
                    weight_sum += weight
        row["score"] = numerator / weight_sum if weight_sum > 0 and not missing else None
        row["score_components"] = components
    ordering = sorted(candidates, key=lambda row: (row["score"] is None, -(row["score"] or 0), row["id"]))
    rank = 0
    for row in ordering:
        if row["eligible"] and row["score"] is not None:
            rank += 1
            row["rank"] = rank
        else:
            row["rank"] = None
    return {
        "basis": setting["basis"], "scale": setting["scale"], "caps": caps,
        "percentile": setting.get("percentile") if not setting.get("caps") else None,
        "weights": setting.get("weights"), "context_weights": setting.get("context_weights"),
        "normalization_population": "Eligible units in this retained reporting-area source selection",
        "formula": "sum(weight * clip(selected quantity / cap, 0, 1)) / sum(weights)"
                   if setting["basis"] != "context" else "sum(weight * context fraction or indicator) / sum(weights)",
        "context_unprotected_meaning": "One minus overlap with the selected protected-source footprint",
    }


def _csv_value(value):
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        value = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _csv_rows(candidates, alternatives):
    fields = [
        "id", "label", "rank", "eligible", "score", "area_ha", "reporting_area_ha",
        "protected_fraction", "source_water_fraction", "high_quality_context",
        "cost", "currency", "exclusion_reasons", "score_unit", "point_priority", "point_score",
    ]
    for pollutant in POLLUTANTS:
        fields += [pollutant + "_" + key for key in (
            "baseline", "unit", "availability", "availability_reason",
            "coverage_fraction", "valid_area_ha", "structural_stream_area_ha", "missing_area_ha")]
        for alternative in alternatives:
            fields += [pollutant + "_" + alternative + "_" + key for key in (
                "value", "availability", "availability_reason", "coverage_fraction",
                "valid_area_ha", "structural_stream_area_ha", "missing_area_ha",
                "delta", "reduction", "comparison_availability", "comparison_availability_reason",
                "common_baseline", "common_alternative", "common_coverage_fraction",
                "common_valid_area_ha", "common_structural_stream_area_ha", "profile_changed")]
    fields += conservation_reporting.csv_fields()
    fields += ["score_components", "original_attributes"]
    rows = []
    for candidate in candidates:
        row = {key: candidate.get(key) for key in fields}
        row.update(conservation_reporting.flat_values(candidate))
        for pollutant, metric in candidate["pollutants"].items():
            for key in ("baseline", "unit", "availability", "availability_reason",
            "coverage_fraction", "valid_area_ha", "structural_stream_area_ha", "missing_area_ha"):
                row[pollutant + "_" + key] = metric.get(key)
            for alternative, comparison in metric["alternatives"].items():
                for key in ("value", "availability", "availability_reason", "coverage_fraction",
                "valid_area_ha", "structural_stream_area_ha", "missing_area_ha",
                "delta", "reduction", "comparison_availability", "comparison_availability_reason",
                "common_baseline", "common_alternative", "common_coverage_fraction",
                "common_valid_area_ha", "common_structural_stream_area_ha", "profile_changed"):
                    row[pollutant + "_" + alternative + "_" + key] = comparison.get(key)
        rows.append(row)
    return fields, rows


def _write_csv(path, candidates, alternatives):
    fields, rows = _csv_rows(candidates, alternatives)
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields)
    writer.writeheader()
    writer.writerows({key: _csv_value(row.get(key)) for key in fields} for row in rows)
    atomic_bytes(path, buffer.getvalue().encode("utf-8"))


def _multipolygon(geometry):
    from shapely.geometry import MultiPolygon
    return geometry if geometry.geom_type == "MultiPolygon" else MultiPolygon([geometry])


def _write_gpkg(path, crs, candidates, geometries, *, selected=None, union=None):
    import fiona
    from shapely import wkb
    from shapely.geometry import mapping
    schema = {"geometry": "MultiPolygon", "properties": {
        "unit_id": "str", "label": "str", "selected": "int", "eligible": "int",
        "score": "float", "area_ha": "float", "reporting_ha": "float",
        "protected_frac": "float", "sourcewater_frac": "float",
        "n_kg_year": "float", "p_kg_year": "float", "sed_t_year": "float",
        "metrics_json": "str", "source_attributes": "str", "score_unit": "str",
        "point_priority": "str", "point_score": "str",
        **conservation_reporting.gis_fields(),
    }}
    path.unlink(missing_ok=True)
    selected = set(selected) if selected is not None else None
    with rasters.vector_environment():
        for layer, geometry_key in (("planning_units", "original"), ("reporting_footprints", "reporting")):
            with fiona.open(path, "w", driver="GPKG", layer=layer, crs_wkt=crs.to_wkt(), schema=schema) as dst:
                for row in candidates:
                    props = {
                        "unit_id": row["id"], "label": row["label"],
                        "selected": int(row["id"] in selected) if selected is not None else 0,
                        "eligible": int(row["eligible"]), "score": row["score"],
                        "area_ha": row["area_ha"], "reporting_ha": row["reporting_area_ha"],
                        "protected_frac": row["protected_fraction"], "sourcewater_frac": row["source_water_fraction"],
                        "n_kg_year": row["pollutants"]["nitrogen_export"]["baseline"],
                        "p_kg_year": row["pollutants"]["phosphorus_export"]["baseline"],
                        "sed_t_year": row["pollutants"]["sediment_export"]["baseline"],
                        "metrics_json": json.dumps(row["pollutants"], sort_keys=True, ensure_ascii=False),
                        "source_attributes": json.dumps(row["original_attributes"], sort_keys=True, ensure_ascii=False),
                        "score_unit": row.get("score_unit"), "point_priority": row.get("point_priority"),
                        "point_score": json.dumps(row["point_score"], sort_keys=True, ensure_ascii=False) if row.get("point_score") else None,
                    }
                    props.update(conservation_reporting.flat_values(row))
                    geometry = wkb.loads(bytes.fromhex(geometries[row["id"]][geometry_key]))
                    dst.write({"geometry": mapping(_multipolygon(geometry)), "properties": props})
        if union is not None and not union.is_empty:
            union_schema = {"geometry": "MultiPolygon", "properties": {"title": "str", "area_ha": "float"}}
            with fiona.open(path, "w", driver="GPKG", layer="selected_union", crs_wkt=crs.to_wkt(), schema=union_schema) as dst:
                dst.write({"geometry": mapping(_multipolygon(union)),
                           "properties": {"title": "Selected reporting-area union", "area_ha": union.area / 10000}})


def _display(value, *, digits=4):
    if value is None:
        return "Unavailable"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        return format(value, ",." + str(digits) + "f").rstrip("0").rstrip(".")
    return html.escape(str(value))


def _base_report(state, candidates, *, plan=None):
    spec = state["selection"]["spec"]
    selected = set(plan["selected_ids"]) if plan else None
    title = plan["title"] if plan else state["title"]
    summary = plan["summary"] if plan else state["summary"]
    rows = []
    for row in candidates:
        if selected is not None and row["id"] not in selected:
            continue
        metrics = row["pollutants"]
        rows.append("<tr><td>" + html.escape(row["id"]) + "</td><td>" + html.escape(row["label"]) + "</td>"
                    + "".join("<td>" + _display(v) + "</td>" for v in (
                        row["reporting_area_ha"], row["score"], metrics["nitrogen_export"]["baseline"],
                        metrics["phosphorus_export"]["baseline"], metrics["sediment_export"]["baseline"],
                        metrics["nitrogen_export"]["coverage_fraction"],
                        metrics["phosphorus_export"]["coverage_fraction"],
                        metrics["sediment_export"]["coverage_fraction"],
                    )) + "<td>" + html.escape("; ".join(row["exclusion_reasons"]) or "Eligible") + "</td></tr>")
    published = state.get("normalization", {}) if spec["score"]["basis"] == "published_method" else None
    point_intro = ""
    if published:
        point_intro = ("<p><strong>" + html.escape(published["title"]) + "</strong>: "
                       + str(published["maximum"]) + " possible points. The candidate CSV and GIS layers retain "
                       + "every criterion, its source binding, the practice prerequisite and the published priority range. "
                       + "<a href=\"" + html.escape(published["source_uri"], quote=True) + "\">Published method</a>.</p>")
    sources = []
    for name, source in state["selection"]["bindings"]["sources"].items():
        uri = source["uri"]
        link = '<a href="' + html.escape(uri, quote=True) + '">' + html.escape(source["title"]) + "</a>" if uri.startswith(
            ("https://", "http://")) else html.escape(source["title"])
        sources.append("<tr><td>" + html.escape(name) + "</td><td>" + link + "</td><td>"
                       + html.escape(str(source["vintage"])) + "</td><td>"
                       + html.escape(source.get("relation") or "") + "</td><td><code>"
                       + source["body"]["sha256"] + "</code></td></tr>")
    mode_text = (
        "This source-context study uses the retained planning-unit, reporting and context boundaries. "
        "Select a completed native model run to create a quantitative successor study."
        if state["mode"] == "source_context" else
        "This study aggregates each selected original InVEST 3.20 native output over the actual planning-unit boundaries. Each case retains its own selected NDR/SDR models and output availability."
    )
    area_rows = [
        ("Planning units", summary.get("units")),
        ("Unique reporting footprint (ha)", summary.get("union_area_ha", summary.get("unit_footprint_area_ha"))),
        ("Reporting boundary (ha)", state.get("reporting_area_ha")),
        ("Selected protected-source overlap (ha)", summary.get("protected_area_ha")),
        ("Selected source-water context overlap (ha)", summary.get("source_water_area_ha")),
    ]
    if state["selection"]["bindings"]["grid"] is not None:
        native_grid = state["selection"]["bindings"]["grid"]["grid"]
        area_rows += [
            ("Original native cell size (m)", native_grid["resolution_m"]),
            ("Full native cell area (ha)", native_grid["pixel_area_ha"]),
        ]
    if plan:
        area_rows += [
            ("Unique whole-unit footprint (ha)", summary["whole_unit_union_area_ha"]),
            ("Overlapping reporting area counted once (ha)", summary["overlap_area_ha"]),
            ("Budget area basis", summary["area_budget_basis"]),
            ("Supplied full-unit cost (" + str(summary.get("currency") or "currency unselected") + ")", summary["cost_total"]),
        ]
    area_table = "<table><tbody>" + "".join(
        "<tr><th>" + html.escape(name) + "</th><td>" + _display(value) + "</td></tr>"
        for name, value in area_rows) + "</tbody></table>"
    quantity_rows, case_rows = [], []
    for pollutant, metric in summary.get("pollutants", {}).items():
        quantity_rows.append("<tr><th>" + html.escape(pollutant.replace("_export", "").title()) + "</th>"
                             + "".join("<td>" + _display(value) + "</td>" for value in (
                                 metric["baseline"], metric["unit"], metric["coverage_fraction"],
                                 metric["valid_area_ha"], metric["structural_stream_area_ha"],
                                 metric.get("availability_reason") or metric.get("availability", "modeled"),
                             )) + "</tr>")
        for case_id, case in metric["alternatives"].items():
            case_rows.append("<tr><td><code>" + case_id + "</code></td><td>"
                             + html.escape(pollutant.replace("_export", "").title()) + "</td>"
                             + "".join("<td>" + _display(value) + "</td>" for value in (
                                 case["value"], case["delta"], metric["unit"], case["coverage_fraction"],
                                 case["common_coverage_fraction"], case["profile_changed"],
                                 case.get("availability_reason") or case.get("availability", "modeled"),
                                 case.get("comparison_availability_reason") or case.get("comparison_availability", "modeled"),
                             )) + "</tr>")
    quantity_table = "<table><thead><tr><th>Pollutant</th><th>Baseline</th><th>Annual unit</th><th>Support fraction</th><th>Valid area (ha)</th><th>Structural stream area (ha)</th><th>Availability</th></tr></thead><tbody>" + "".join(quantity_rows) + "</tbody></table>"
    cases_table = (
        "<h2>Selected modeled cases</h2><p>Each delta is alternative minus baseline on common native support within the selected footprint. A model omitted from either case has no paired difference; an available alternative quantity keeps its own coverage.</p>"
        "<div class='scroll'><table><thead><tr><th>Original run</th><th>Pollutant</th><th>Alternative</th><th>Delta</th><th>Annual unit</th><th>Alternative support fraction</th><th>Common support fraction</th><th>Profile changed</th><th>Alternative availability</th><th>Comparison availability</th></tr></thead><tbody>"
        + "".join(case_rows) + "</tbody></table></div>" if case_rows else ""
    )
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>""" + html.escape(title) + """</title><style>
body{font:15px/1.55 system-ui,sans-serif;color:#1d2226;background:#f5f6f7;margin:0;padding:32px}
main{max-width:1280px;margin:auto;background:white;padding:32px;border:1px solid #cbd0d4}
h1,h2{line-height:1.2}h1{font-size:28px}h2{font-size:20px;margin-top:32px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase}.scroll{overflow:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border:1px solid #cbd0d4;padding:8px}
th{background:#e9ecef}code{word-break:break-all}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
a{color:#203948}footer{border-top:1px solid #cbd0d4;margin-top:30px;padding-top:12px}
@media print{body{padding:0;background:white}main{border:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}}
</style><main><p class="eyebrow">TokenJunkieLabs · Upper Savannah · """ + html.escape(
        spec["purpose"] + " · " + spec["planning_unit_label"]) + "</p><h1>" + html.escape(title) + "</h1><p>" + mode_text + """</p>
<p><a href="candidates.csv">Complete candidate table</a> · <a href="geodata.gpkg">Editable GIS layers</a> ·
<a href="selection.json">Original selections and source lineage</a></p>
<h2>Selected geography</h2>""" + area_table + """<h2>Modeled annual contributions</h2>""" + quantity_table + cases_table + """
<h2>Planning units</h2><p>Annual model quantities retain their own units. Coverage fractions include valid native cells and identified structural stream omissions. The full candidate table carries each alternative, common-support delta, eligibility reason and original attribute.</p>
<div class="scroll"><table><thead><tr><th>Original ID</th><th>Unit</th><th>Reporting ha</th><th>Score</th>
<th>N kg/year</th><th>P kg/year</th><th>Sediment t/year</th><th>N coverage</th><th>P coverage</th><th>Sediment coverage</th><th>Eligibility</th>
</tr></thead><tbody>""" + "".join(rows) + """</tbody></table></div>
<h2>Scoring and decision rules</h2>""" + point_intro + """<p>The saved purpose, ordering and thresholds determine this selection. Costs represent the supplied whole-unit amounts. Ranked selection follows a deterministic greedy order and checks actual union area as it proceeds.</p><details><summary>Inspect complete weights, normalization and limits</summary><pre>""" + html.escape(json.dumps({
        "purpose": spec["purpose"], "score": state["normalization"], "rules": spec["rules"],
        "plan": plan["selection"] if plan else None,
    }, indent=2, ensure_ascii=False)) + """</pre></details>
<h2>Original sources</h2><div class="scroll"><table><thead><tr><th>Role</th><th>Publisher source</th><th>Edition</th><th>Selected relation</th><th>Source SHA-256</th></tr></thead><tbody>""" + "".join(sources) + """</tbody></table></div>
<h2>Methods and interpretation</h2><details><summary>Inspect original output units, geometry method and scenario interpretation</summary><pre>""" + html.escape(json.dumps(state.get("method", METHOD), indent=2)) + """</pre></details>
<p>Spreadsheet-safe CSV text is prefixed when it begins with a formula control; original typed attributes remain in JSON and GeoPackage.</p>
<footer>Study <code>""" + state["id"] + "</code>" + (
        " · Portfolio <code>" + plan["id"] + "</code>" if plan else "") + "</footer></main></html>"


def _report(state, candidates, *, plan=None):
    return conservation_reporting.extend_report(
        _base_report(state, candidates, plan=plan), state, candidates, plan=plan)


def build(workspace, selection):
    """Compute or resume a whole retained candidate study and its complete exports."""
    state = prepare(workspace, selection) if isinstance(selection, dict) else _read_state(workspace, selection)
    key = state["id"]
    directory = workspace.root / "conservation" / key
    with held(workspace.root / ".workspace.lock", blocking=False), held(directory / ".build.lock", blocking=False):
        state = _read_state(workspace, key)
        _bound_native_execution(workspace, state)
        if state["state"] == "complete":
            for item in state["files"].values():
                verify_file(workspace.root, item)
            return {**state, "reused": True}
        state.update(state="running", updated_at=now())
        state.pop("error", None)
        atomic_json(directory / "study.json", state)
        try:
            spec = state["selection"]["spec"]
            crs, reporting, units, contexts, context_metadata = _geometry_inputs(workspace, state)
            costs = _cost_table(workspace, state)
            state["progress"] = {"stage": "candidate quantities", "completed": 0, "total": len(units)}
            state["analysis_crs"] = crs.to_wkt()
            state["reporting_area_ha"] = reporting.area / 10000
            state["context_sources"] = context_metadata
            atomic_json(directory / "study.json", state)
            candidates, geometries = [], {}
            with ExitStack() as stack:
                reference, datasets = _open_native(workspace, state, stack)
                if reference is not None and reference.crs != crs:
                    from pyproj import CRS
                    if CRS.from_user_input(reference.crs) != crs:
                        raise ValueError("Native output CRS differs from the retained geometry analysis grid")
                for index, unit in enumerate(units):
                    checkpoint = directory / "rows" / (digest(unit["id"]) + ".json")
                    if checkpoint.exists():
                        retained = read_json(checkpoint)
                        if retained["study_id"] != key or retained["candidate"]["id"] != unit["id"]:
                            raise ValueError("Retained candidate checkpoint differs")
                        candidate, geometry = retained["candidate"], retained["geometry"]
                        if geometry["reporting"] != unit["clipped"].wkb_hex or geometry["original"] != unit["geometry"].wkb_hex:
                            raise ValueError("Original planning-unit geometry differs from its checkpoint")
                    else:
                        context = _context_metrics(unit["clipped"], contexts)
                        candidate = {
                            "id": unit["id"], "label": unit["label"],
                            "source_identity": {
                                "source_collection_id": spec["parcels"]["source_collection_id"],
                                "source_id": spec["parcels"]["source_id"], "native_id": unit["id"],
                            },
                            "unit_type": spec["unit_type"], "metric_state": state["metric_state"],
                            "area_ha": unit["geometry"].area / 10000,
                            "reporting_area_ha": unit["clipped"].area / 10000,
                            "pollutants": _aggregate(reference, datasets, unit["clipped"], spec),
                            "cost": costs.get(unit["id"]), "currency": spec["costs"]["currency"] if spec.get("costs") else None,
                            "original_attributes": unit["properties"],
                            "geometry_corrections": unit["geometry_corrections"], "source_axes": unit["source_axes"],
                            "source_array_index": unit["source_array_index"], **context,
                        }
                        candidate["exclusion_reasons"] = _eligibility(candidate, spec)
                        candidate["eligible"] = not candidate["exclusion_reasons"]
                        geometry = {"reporting": unit["clipped"].wkb_hex, "original": unit["geometry"].wkb_hex}
                        atomic_json(checkpoint, {
                            "study_id": key, "candidate": candidate, "geometry": geometry,
                        }, immutable=True)
                    candidates.append(candidate)
                    geometries[candidate["id"]] = geometry
                    state["progress"]["completed"] = index + 1
                    if index == len(units) - 1 or (index + 1) % 25 == 0:
                        atomic_json(directory / "study.json", state)
                from shapely.ops import unary_union
                footprint = unary_union([unit["clipped"] for unit in units])
                total_pollutants = _aggregate(reference, datasets, footprint, spec)
            state["normalization"] = _rank(candidates, spec, workspace=workspace, bindings=state["selection"]["bindings"])
            if spec["score"]["basis"] == "published_method":
                state["method"] = {**METHOD, "published_priority": state["normalization"]}
            candidates.sort(key=lambda row: (row["rank"] is None, row["rank"] or 0, row["id"]))
            state["summary"] = {
                "units": len(candidates), "eligible_units": sum(row["eligible"] for row in candidates),
                "scored_units": sum(row["score"] is not None for row in candidates),
                "reporting_area_ha": reporting.area / 10000, "unit_footprint_area_ha": footprint.area / 10000,
                "unit_reporting_coverage_fraction": min(1., footprint.area / reporting.area),
                "uncovered_reporting_area_ha": max(0., reporting.area - footprint.area) / 10000,
                "overlapping_unit_area_ha": max(0., sum(row["reporting_area_ha"] for row in candidates) - footprint.area / 10000),
                "pollutants": total_pollutants, "costs_available": sum(row["cost"] is not None for row in candidates),
                "currency": spec["costs"]["currency"] if spec.get("costs") else None,
                **_context_metrics(footprint, contexts),
            }
            state["progress"]["stage"] = "exports"
            atomic_json(directory / "study.json", state)
            atomic_json(directory / "candidates.json", {"schema": "upstate.conservation-candidates/v1",
                                                       "study_id": key, "candidates": candidates})
            atomic_json(directory / "geometries.json", {"schema": "upstate.conservation-geometries/v1",
                                                       "study_id": key, "analysis_crs": crs.to_wkt(), "units": geometries})
            atomic_json(directory / "selection.json", {"selection": state["selection"], "method": METHOD,
                                                      "normalization": state["normalization"], "context_sources": context_metadata})
            _write_csv(directory / "candidates.csv", candidates, spec["alternative_run_ids"])
            _write_gpkg(directory / "geodata.gpkg", crs, candidates, geometries)
            atomic_bytes(directory / "index.html", _report(state, candidates).encode("utf-8"))
            state["files"] = {name: describe_file(workspace.root, directory / file) for name, file in (
                ("candidates", "candidates.json"), ("geometries", "geometries.json"), ("selection", "selection.json"),
                ("candidates_csv", "candidates.csv"), ("geopackage", "geodata.gpkg"), ("report", "index.html"),
            )}
            state["files"].update(conservation_reporting.write_supplements(
                workspace, directory, state, candidates))
            state.update(state="complete", completed_at=now(), updated_at=now(),
                         progress={"stage": "complete", "completed": len(candidates), "total": len(candidates)})
            atomic_json(directory / "study.json", state)
            return state
        except Exception as error:
            state.update(state="failed", updated_at=now(), error={"type": type(error).__name__, "message": str(error)})
            atomic_json(directory / "study.json", state)
            raise


def _plan_spec(value, state):
    if not isinstance(value, dict):
        raise ValueError("Supply a portfolio selection")
    result = _copy(value)
    result.pop("id", None)
    result.pop("schema", None)
    result["title"] = _text(result.get("title"), "Portfolio title")
    result["study_id"] = identifier(result.get("study_id"))
    if result["study_id"] != state["id"]:
        raise ValueError("Portfolio study selection differs")
    result["mode"] = result.get("mode", "manual")
    if result["mode"] not in ("manual", "ranked"):
        raise ValueError("Portfolio mode must be manual or ranked")
    result["objective"] = result.get("objective", "score")
    if result["objective"] not in ("score", "score_per_hectare", "score_per_cost", "area"):
        raise ValueError("Choose score, score_per_hectare, score_per_cost or area ordering")
    selected = result.get("selected_ids", [])
    if not isinstance(selected, list) or not all(isinstance(x, str) for x in selected) or len(set(selected)) != len(selected):
        raise ValueError("Selected IDs must list unique original text unit identities")
    if result["mode"] == "manual" and not selected:
        raise ValueError("Select at least one planning unit")
    result["selected_ids"] = selected
    if result["mode"] == "ranked" and selected:
        raise ValueError("Ranked mode derives its selection; use manual mode to select explicit units")
    result["include_ineligible"] = result.get("include_ineligible", False)
    if not isinstance(result["include_ineligible"], bool):
        raise ValueError("include_ineligible must be true or false")
    limits = result.get("limits", {})
    if not isinstance(limits, dict) or set(limits) - {
        "maximum_area_ha", "maximum_cost", "maximum_parcels", "area_basis",
    }:
        raise ValueError("Portfolio limits must name area, cost, unit count and area basis")
    normalized = {"area_basis": limits.get("area_basis", "whole_units")}
    if normalized["area_basis"] not in ("whole_units", "reporting"):
        raise ValueError("Area budget basis must be whole_units or reporting")
    for name in ("maximum_area_ha", "maximum_cost"):
        if limits.get(name) is not None:
            normalized[name] = _number(limits[name], name)
    if limits.get("maximum_parcels") is not None:
        number = limits["maximum_parcels"]
        if isinstance(number, bool) or not isinstance(number, int) or number <= 0:
            raise ValueError("maximum_parcels must be a positive whole unit count")
        normalized["maximum_parcels"] = number
    if "maximum_cost" in normalized and not state["selection"]["spec"].get("costs"):
        raise ValueError("A cost budget requires the original cost table and currency")
    if result["objective"] == "score_per_cost" and not state["selection"]["spec"].get("costs"):
        raise ValueError("Cost efficiency ordering requires the original cost table and currency")
    result["limits"] = normalized
    return result


def _objective(row, objective):
    if objective == "area":
        return row["reporting_area_ha"]
    score = row["score"]
    if score is None:
        return None
    if objective == "score":
        return score
    if objective == "score_per_hectare":
        return score / row["reporting_area_ha"]
    if row["cost"] is None:
        return None
    if row["cost"] == 0:
        return math.inf if score > 0 else 0.
    return score / row["cost"]


def get_plan(workspace, key):
    key = identifier(key)
    value = read_json(workspace.root / "conservation-plans" / key / "plan.json")
    if value.get("id") != key or digest(value.get("selection")) != key:
        raise ValueError("Retained conservation portfolio selection changed")
    return value


def save_plan(workspace, value):
    """Select and retain a spatial portfolio with recomputed union quantities."""
    from shapely import wkb
    from shapely.geometry import GeometryCollection
    from pyproj import CRS
    state = inspect(workspace, identifier(value.get("study_id")), include_candidates=True)
    if state["state"] != "complete":
        raise ValueError("Complete the candidate study before saving a portfolio")
    _bound_native_execution(workspace, state)
    spec = _plan_spec(value, state)
    selection = {"version": VERSION, **spec, "candidates_sha256": state["files"]["candidates"]["sha256"],
                 "geometries_sha256": state["files"]["geometries"]["sha256"]}
    key = digest(selection)
    directory = workspace.root / "conservation-plans" / key
    with held(workspace.root / ".workspace.lock", blocking=False), held(directory / ".plan.lock", blocking=False):
        if (directory / "plan.json").exists():
            previous = get_plan(workspace, key)
            if previous["state"] == "complete":
                for item in previous["files"].values():
                    verify_file(workspace.root, item)
                return {**previous, "reused": True}
        plan = {
            "schema": "upstate.conservation-plan/v1", "id": key, "title": spec["title"],
            "study_id": state["id"], "state": "running", "created_at": now(),
            "mode": state["mode"], "metric_state": state["metric_state"], "purpose": state["purpose"],
            "unit_type": state["unit_type"], "planning_unit_label": state["planning_unit_label"],
            "selection": selection, "analysis_crs": state["analysis_crs"], "files": {},
        }
        atomic_json(directory / "plan.json", plan)
        try:
            candidates = state["candidates"]
            by_id = {row["id"]: row for row in candidates}
            unknown = set(spec["selected_ids"]) - set(by_id)
            if unknown:
                raise ValueError("Selected native unit IDs are absent: " + ", ".join(sorted(unknown)))
            geometry_data = read_json(verify_file(workspace.root, state["files"]["geometries"]))
            geometries = geometry_data["units"]
            selected, skipped, details = [], [], []
            reporting_union, original_union = GeometryCollection(), GeometryCollection()
            total_cost, missing_costs = 0., 0
            if spec["mode"] == "manual":
                ordering = [by_id[x] for x in spec["selected_ids"]]
            else:
                ordering = sorted(candidates, key=lambda row: (
                    _objective(row, spec["objective"]) is None,
                    -(_objective(row, spec["objective"]) or 0.), row["id"],
                ))
            for row in ordering:
                reasons = []
                if not row["eligible"] and not spec["include_ineligible"]:
                    reasons += row["exclusion_reasons"]
                if spec["mode"] == "ranked" and _objective(row, spec["objective"]) is None:
                    reasons.append("The selected ranking quantity or supplied cost is unavailable")
                reporting_geometry = wkb.loads(bytes.fromhex(geometries[row["id"]]["reporting"]))
                original_geometry = wkb.loads(bytes.fromhex(geometries[row["id"]]["original"]))
                marginal_reporting = reporting_geometry.difference(reporting_union)
                if spec["mode"] == "ranked" and marginal_reporting.area <= 1e-8:
                    reasons.append("Already covered by the selected unit union")
                next_reporting = reporting_union.union(reporting_geometry)
                next_original = original_union.union(original_geometry)
                area_geometry = next_original if spec["limits"]["area_basis"] == "whole_units" else next_reporting
                if ("maximum_area_ha" in spec["limits"]
                        and area_geometry.area / 10000 > spec["limits"]["maximum_area_ha"] + 1e-9):
                    reasons.append("The selected union would exceed the area budget")
                if "maximum_parcels" in spec["limits"] and len(selected) >= spec["limits"]["maximum_parcels"]:
                    reasons.append("The selected unit count would exceed the limit")
                if "maximum_cost" in spec["limits"]:
                    if row["cost"] is None:
                        reasons.append("Cost feasibility requires this unit's original supplied cost")
                    elif total_cost + row["cost"] > spec["limits"]["maximum_cost"] + 1e-9:
                        reasons.append("The selected full-unit costs would exceed the cost budget")
                if reasons:
                    if spec["mode"] == "manual":
                        raise ValueError("Selected unit " + row["id"] + ": " + "; ".join(reasons))
                    skipped.append({"id": row["id"], "reasons": reasons})
                    continue
                selected.append(row["id"])
                details.append({
                    "id": row["id"], "marginal_reporting_area_ha": marginal_reporting.area / 10000,
                    "selected_reporting_union_ha": next_reporting.area / 10000,
                    "selected_whole_unit_union_ha": next_original.area / 10000,
                })
                reporting_union, original_union = next_reporting, next_original
                if row["cost"] is None:
                    missing_costs += 1
                else:
                    total_cost += row["cost"]
            if not selected:
                raise ValueError("No planning unit meets the saved selection and limits; adjust the explicit rules or limits")
            crs, _, _, contexts, _ = _geometry_inputs(workspace, state)
            with ExitStack() as stack:
                reference, datasets = _open_native(workspace, state, stack)
                pollutants = _aggregate(reference, datasets, reporting_union, state["selection"]["spec"])
            selected_rows = [by_id[x] for x in selected]
            report_area = reporting_union.area / 10000
            whole_area = original_union.area / 10000
            summed_report = sum(row["reporting_area_ha"] for row in selected_rows)
            summed_whole = sum(row["area_ha"] for row in selected_rows)
            plan.update(
                selected_ids=selected, skipped=skipped, selection_steps=details,
                algorithm="manual" if spec["mode"] == "manual" else "deterministic ranked greedy",
                algorithm_detail=(
                    "Candidate ordering uses the saved objective and original ID tie-break; each added unit is checked "
                    "against actual union area, supplied whole-unit cost and count. Fully covered units are skipped in ranked mode."
                ),
                summary={
                    "parcels": len(selected), "units": len(selected), "union_area_ha": report_area,
                    "whole_unit_union_area_ha": whole_area, "summed_parcel_area_ha": summed_report,
                    "summed_whole_unit_area_ha": summed_whole, "overlap_area_ha": max(0., summed_report - report_area),
                    "whole_unit_overlap_area_ha": max(0., summed_whole - whole_area),
                    "budget_area_ha": whole_area if spec["limits"]["area_basis"] == "whole_units" else report_area,
                    "area_budget_basis": spec["limits"]["area_basis"],
                    "cost_total": total_cost if missing_costs == 0 else None,
                    "known_cost_subtotal": total_cost, "units_without_cost": missing_costs,
                    "currency": state["summary"]["currency"], "pollutants": pollutants,
                    "quantitative_scope": ("Selected geographic footprint and retained source-context intersections"
                                           if state["mode"] == "source_context" else
                                           "Selected-footprint contributions within each complete modeled case"),
                    **_context_metrics(reporting_union, contexts),
                },
            )
            _write_csv(directory / "candidates.csv", candidates, state["selection"]["spec"]["alternative_run_ids"])
            _write_csv(directory / "portfolio.csv", selected_rows, state["selection"]["spec"]["alternative_run_ids"])
            _write_gpkg(directory / "geodata.gpkg", crs, candidates, geometries, selected=selected, union=reporting_union)
            atomic_json(directory / "selection.json", {
                "study_selection": state["selection"], "plan_selection": selection, "selected_ids": selected,
                "method": METHOD, "normalization": state["normalization"],
            })
            atomic_json(directory / "portfolio.json", {
                "schema": "upstate.conservation-portfolio/v1", "id": key, "study_id": state["id"],
                "selected_ids": selected, "summary": plan["summary"], "selected_candidates": selected_rows,
                "skipped": skipped, "selection_steps": details,
            })
            atomic_bytes(directory / "index.html", _report(state, candidates, plan=plan).encode("utf-8"))
            plan["files"] = {name: describe_file(workspace.root, directory / filename) for name, filename in (
                ("candidates_csv", "candidates.csv"), ("portfolio_csv", "portfolio.csv"),
                ("geopackage", "geodata.gpkg"), ("selection", "selection.json"),
                ("portfolio", "portfolio.json"), ("report", "index.html"),
            )}
            plan["files"].update(conservation_reporting.write_supplements(
                workspace, directory, state, candidates, plan=plan))
            plan["files"]["footprint"] = {
                **plan["files"]["geopackage"], "layer": "selected_union",
                "crs": crs.to_wkt(), "geometry_role": "Selected reporting-area union",
            }
            plan.update(state="complete", completed_at=now())
            atomic_json(directory / "plan.json", plan)
            return plan
        except Exception as error:
            plan.update(state="failed", updated_at=now(), error={"type": type(error).__name__, "message": str(error)})
            atomic_json(directory / "plan.json", plan)
            raise


def export_packet(workspace, study_id, plan_id=None):
    """Export a complete portable decision packet with original study selections."""
    state = inspect(workspace, study_id, include_candidates=False)
    if state["state"] != "complete":
        raise ValueError("Complete the conservation study before exporting")
    execution = _bound_native_execution(workspace, state)
    plan = get_plan(workspace, plan_id) if plan_id is not None else None
    if plan is not None and (plan["state"] != "complete" or plan["study_id"] != study_id):
        raise ValueError("Choose a completed portfolio from this exact study")
    subject = plan if plan else state
    root = workspace.root
    presentation = conservation_reporting.identity()
    # Rebuilt presentation has its own identity; prior study/plan bytes stay retained.
    packet_selection = {"version": VERSION, "study_id": study_id, "plan_id": plan_id,
                        "files": subject["files"], "presentation": presentation}
    if execution:
        packet_selection["native_execution"] = execution
    key = digest(packet_selection)
    directory = root / "conservation-exports" / key
    with held(root / ".workspace.lock", blocking=False), held(directory / ".export.lock", blocking=False):
        record = directory / "export.json"
        if record.exists():
            previous = read_json(record)
            if previous.get("id") != key:
                raise ValueError("Retained conservation export differs")
            verify_file(root, previous)
            return {**previous, "reused": True}
        members = {}
        if execution:
            execution_path = directory / "native-execution.json"
            atomic_json(execution_path, {"schema": "upstate.conservation-native-execution/v1",
                                        "study_id": study_id, "runs": execution}, immutable=True)
            members["native-execution.json"] = (execution_path, describe_file(root, execution_path))
        for role, descriptor in subject["files"].items():
            if role == "footprint":
                continue
            source = verify_file(root, descriptor)
            name = source.name
            if name in members:
                raise ValueError("Conservation packet member names collide")
            members[name] = (source, descriptor)
        # Always carry the complete machine-readable candidate selection and
        # study, even when the selected portfolio is the report's front page.
        candidate_source = verify_file(root, state["files"]["candidates"])
        members["candidates.json"] = (candidate_source, state["files"]["candidates"])
        study_path = root / "conservation" / study_id / "study.json"
        members["study.json"] = (study_path, describe_file(root, study_path))
        if plan is not None:
            plan_path = root / "conservation-plans" / plan["id"] / "plan.json"
            members["plan.json"] = (plan_path, describe_file(root, plan_path))
        candidates = read_json(candidate_source)["candidates"]
        members.update(conservation_reporting.presentation_members(
            workspace, directory, state, candidates, plan=plan))
        manifest = {
            "presentation": presentation,
            "schema": "upstate.conservation-packet/v1", "id": key, "study_id": study_id, "plan_id": plan_id,
            "entrypoint": "index.html", "members": {
                name: {"bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
                for name, (_, descriptor) in members.items()
            },
            "receiving": "Open index.html; editable layers are in geodata.gpkg. Reopen the original full Workspace archive to recompute with its retained native sources.",
        }
        manifest_bytes = canonical(manifest) + b"\n"
        target = directory / ("conservation-portfolio.zip" if plan else "conservation-study.zip")
        pending = directory / ".export.pending.zip"
        pending.unlink(missing_ok=True)
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=5, allowZip64=True) as archive:
            for name, (source, descriptor) in sorted(members.items()):
                archive.write(source, name)
                if describe_file(root, source)["sha256"] != descriptor["sha256"]:
                    raise ValueError("A conservation packet member changed during export")
            archive.writestr("packet-manifest.json", manifest_bytes)
        pending.replace(target)
        result = {
            **describe_file(root, target), "schema": "upstate.conservation-export/v1", "id": key,
            "study_id": study_id, "plan_id": plan_id, "filename": target.name,
            "files": manifest["members"], "entrypoint": "index.html", "created_at": now(),
            "presentation": presentation,
        }
        atomic_json(record, result, immutable=True)
        return result
