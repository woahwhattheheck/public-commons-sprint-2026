"""Prepare the field/laboratory continuation of the one simulated headwaters case.

These are teaching inputs. Original model results and real WQP records are not
modified. Run through model.simulated_fieldwork only with the existing native
Workspace selected by the main demonstration owner.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import tempfile

DEMO_ID = "upstate-simulated-piedmont-headwaters-v1"
SCHEMA = "upstate.simulated-fieldwork-inputs/v1"
LABEL = "SIMULATED DEMONSTRATION INPUTS"
METHOD = "EPA 365.1 Revision 2.0 — simulated total-phosphorus result"
COLLECTION = "Simulated whole-water grab collection"
PARAMETER = "Phosphorus"
BASIS = "as P"
UNIT = "mg/L"
FRACTION = "Total"
ACTOR = "Demonstration reviewer"
AS_OF = "2026-10-13"
METHOD_URL = "https://www.epa.gov/sites/default/files/2015-08/documents/method_365-1_1993.pdf"
QC_URL = "https://www.epa.gov/sites/production/files/2016-04/documents/epa-ne-edr-supplement.pdf"

def _raw(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")

def _sha(raw):
    return hashlib.sha256(raw).hexdigest()

def _write(path, raw):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Input destination must be an ordinary file")
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError("An existing prepared input differs: " + str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".field-input-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(name, path)
        except FileExistsError:
            if path.read_bytes() != raw:
                raise ValueError("Concurrent prepared input differs: " + str(path))
    finally:
        Path(name).unlink(missing_ok=True)

def _csv(rows):
    columns = ["observation_id", "activity_id", "sample_id", "site_id", "collected_at",
               "parameter", "result_type", "value", "original_text", "unit", "basis",
               "fraction", "qualifier", "method", "qa_status", "quantitation_limit", "notes"]
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")

def prepare(recipe_path, destination):
    """Create complete editable field inputs bound to the actual supplied recipe."""
    from pyproj import Transformer
    recipe_path = Path(recipe_path).resolve(strict=True)
    recipe_bytes = recipe_path.read_bytes()
    recipe = json.loads(recipe_bytes.decode("utf-8-sig"))
    if (recipe.get("schema") != "upstate.simulated-input-recipe/v1"
            or recipe.get("demo_id") != DEMO_ID
            or recipe.get("classification") != LABEL):
        raise ValueError("Select the original explicitly simulated headwaters recipe")
    grid = recipe["grid"]
    width, height = grid["width"], grid["height"]
    if (type(width) is not int or type(height) is not int or width < 12 or height < 12
            or width * height > 10000000):
        raise ValueError("The original demonstration grid has unsupported dimensions")
    transform = grid["transform"]
    if (len(transform) != 6 or any(type(x) not in (int, float) or not math.isfinite(x) for x in transform)
            or transform[0] <= 0 or transform[4] >= 0 or transform[1] != 0 or transform[3] != 0):
        raise ValueError("The headwaters recipe requires its original north-up affine")
    dem = recipe["arrays"]["DEM"]
    if len(dem) != width * height or any(type(x) not in (int, float) or not math.isfinite(x) for x in dem):
        raise ValueError("The complete original DEM input is required")
    converter = Transformer.from_crs(grid["crs"], "EPSG:4326", always_xy=True)
    # Explicit planned field sites: the lowest original DEM cell in each
    # tributary at 40% down the grid, then the lowest trunk cell at 85%.
    # The native model's computed stream mask remains its separate result.
    upper, lower = int(height * .4), int(height * .85)
    choices = [
        ("SIM_FIELD_LEFT", "Simulated western tributary", upper, range(0, width // 2)),
        ("SIM_FIELD_RIGHT", "Simulated eastern tributary", upper, range(width // 2, width)),
        ("SIM_FIELD_OUTLET", "Simulated downstream trunk", lower, range(width)),
    ]
    sites, positions = [], []
    for key, title, row, columns in choices:
        col = min(columns, key=lambda c: (dem[row * width + c], c))
        x = transform[0] * (col + .5) + transform[2]
        y = transform[4] * (row + .5) + transform[5]
        lon, lat = converter.transform(x, y)
        if not all(math.isfinite(v) for v in (lon, lat)) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError("Original recipe coordinates could not be transformed")
        position = dict(id=key, row=row, column=col, x=x, y=y, crs=grid["crs"],
                        dem_input_elevation_m=dem[row * width + col], longitude=lon, latitude=lat)
        positions.append(position)
        sites.append(dict(id=key, label=title, latitude=lat, longitude=lon,
                          source_ref="simulated-field-design", simulated=True,
                          original_grid_position=position))
    recipe_sha = _sha(recipe_bytes)
    plan_id = "sim-field-" + recipe_sha[:24]
    first_times = {
        "SIM_FIELD_LEFT": "2026-10-01T09:00:00-04:00",
        "SIM_FIELD_RIGHT": "2026-10-01T10:00:00-04:00",
        "SIM_FIELD_OUTLET": "2026-10-01T11:00:00-04:00",
    }
    observations = [
        ("sim-tp-left-01", "sim-left-01", "SIM_FIELD_LEFT", "0.055", "numeric", ""),
        ("sim-tp-right-01", "sim-right-01", "SIM_FIELD_RIGHT", "0.120", "numeric", ""),
        ("sim-tp-right-dup-01", "sim-right-dup-01", "SIM_FIELD_RIGHT", "0.200", "numeric", ""),
        ("sim-tp-outlet-01", "sim-outlet-01", "SIM_FIELD_OUTLET", "0.150", "numeric", ""),
        ("sim-tp-blank-01", "sim-blank-01", "SIM_FIELD_RIGHT", "<0.010", "censored", "<"),
    ]
    repeats = [
        ("sim-tp-right-02", "sim-right-02", "SIM_FIELD_RIGHT", "0.125", "numeric", ""),
        ("sim-tp-right-dup-02", "sim-right-dup-02", "SIM_FIELD_RIGHT", "0.130", "numeric", ""),
    ]
    visits = [
        dict(id="visit-" + key.lower(), site_id=key, monitoring_plan_id="sim-monitor",
             planned_date="2026-10-01", visited_at=when, status="complete",
             observer="Simulated field team", notes=LABEL, evidence_refs=["simulated-field-design"])
        for key, when in first_times.items()
    ]
    visits.append(dict(id="visit-repeat-right", site_id="SIM_FIELD_RIGHT", monitoring_plan_id="sim-monitor",
                       planned_date="2026-10-08", status="planned", observer="Simulated field team",
                       notes=LABEL + "; the repeated collection is completed in the follow-up phase.",
                       evidence_refs=["simulated-field-design"]))
    activities, initial_rows, repeat_rows = [], [], []
    for is_repeat, source_rows in ((False, observations), (True, repeats)):
        for obs, activity, site, value, result_type, qualifier in source_rows:
            when = "2026-10-08T10:00:00-04:00" if is_repeat else first_times[site]
            is_blank = activity == "sim-blank-01"
            sample_id = "SIM-SAMPLE-" + activity.upper()
            act = dict(id=activity, visit_id="visit-repeat-right" if is_repeat else "visit-" + site.lower(),
                       site_id=site, kind="sample", sample_id=sample_id, method=COLLECTION,
                       custody_ref="SIM-COC-02" if is_repeat else "SIM-COC-01",
                       notes=LABEL + ("; documented field reagent-water blank" if is_blank else ""),
                       evidence_refs=["simulated-field-design"])
            if not is_repeat:
                act["collected_at"] = when
            activities.append(act)
            row = dict(observation_id=obs, activity_id=activity, sample_id=sample_id, site_id=site,
                       collected_at=when, parameter=PARAMETER, result_type=result_type,
                       value=value if result_type == "numeric" else "", original_text=value,
                       unit=UNIT, basis=BASIS, fraction=FRACTION, qualifier=qualifier, method=METHOD,
                       qa_status="", quantitation_limit="0.010",
                       notes=LABEL + "; authored teaching input, retained unchanged by the native importer.")
            (repeat_rows if is_repeat else initial_rows).append(row)
    design = dict(
        schema="upstate.simulated-field-design/v1", demo_id=DEMO_ID, classification=LABEL,
        recipe_sha256=recipe_sha, original_grid=grid, site_positions=positions,
        coordinate_operation=dict(source_crs=grid["crs"], target_crs="EPSG:4326",
                                  always_xy=True, definition=converter.definition,
                                  accuracy_m=converter.accuracy),
        criterion=dict(metric="rpd_percent", maximum=20.0, minimum_quantitation_multiple=5.0,
                       source="Authored demonstration project criterion in field-design.json",
                       applicability="Two explicitly collected whole-water field duplicates with identical definitions; "
                                     "both numeric and at least five times their original 0.010 mg/L quantitation limit."),
        relationships=[
            dict(id="right-initial-duplicate", kind="duplicate", relationship="field_duplicate",
                 observation_ids=["sim-tp-right-01", "sim-tp-right-dup-01"],
                 relationship_basis="SIM-COC-01 declares two separately collected co-located whole-water samples "
                                    "from the same simulated eastern tributary visit."),
            dict(id="initial-field-blank", kind="blank", relationship="field_blank",
                 observation_ids=["sim-tp-blank-01"],
                 associated_observation_ids=["sim-tp-right-01", "sim-tp-right-dup-01"],
                 relationship_basis="SIM-COC-01 declares reagent water handled at the same simulated field visit. "
                                    "Its original result is censored and remains nonnumeric."),
            dict(id="right-repeat-duplicate", kind="duplicate", relationship="field_duplicate",
                 observation_ids=["sim-tp-right-02", "sim-tp-right-dup-02"],
                 relationship_basis="SIM-COC-02 declares the two new co-located repeat-collection samples."),
        ],
        assumptions=[
            "Every sample, time, concentration, limit, control relationship and field action here is simulated input.",
            "The 20% RPD and five-quantitation-limit conditions are demonstration project choices, not EPA acceptance limits.",
            "The TP definition uses whole-water total phosphorus and mg/L as P. Method 365.1 supplies the analytical "
            "definition; the demonstration does not reproduce or certify laboratory processing.",
            "The blank is a censored <0.010 mg/L result; no concentration is substituted and no blank subtraction occurs.",
            "Instantaneous simulated concentrations are not annual NDR export and cannot validate the model or establish "
            "conservation effectiveness. Recollection illustrates precision and decision follow-through only.",
            "Planned site cells come from the original terrain input. Inspect the computed native stream map separately "
            "when explaining where samples would be collected.",
        ],
        primary_references=[
            dict(title="EPA Method 365.1 Revision 2.0 (1993)", url=METHOD_URL,
                 use="Total-phosphorus and dissolved-phosphorus analytical definitions; original method scope."),
            dict(title="EPA New England Environmental Data Review Supplement (2013), section 2.8", url=QC_URL,
                 use="Field duplicates and project-specific data-quality interpretation."),
        ],
    )
    stamp = "2026-10-01T00:00:00Z"
    seed = dict(
        schema="upstate.implementation-plan/v1", id=plan_id, revision=0,
        title="SIMULATED — headwaters field and laboratory follow-through",
        description="One original simulated headwaters case: laboratory intake, precision review, "
                    "repeat collection and retained corrective work.",
        start_date="2026-10-01", target_date=AS_OF, currency="USD",
        working_days=[1, 2, 3, 4, 5], holidays=[], created_at=stamp, updated_at=stamp,
        source_links=[dict(id="simulated-field-design", kind="simulated_field_design",
                           label=LABEL + " — original field design",
                           reference="field-design.json", source_digest=_sha(_raw(design)),
                           snapshot=design)],
        candidates=[], tasks=[], budget_lines=[], sites=sites,
        monitoring_plans=[dict(id="sim-monitor", title="Simulated headwater TP sampling",
                               objective="Demonstrate retained sample precision and original corrective work.",
                               notes=LABEL, site_ids=[s["id"] for s in sites], parameters=[PARAMETER],
                               method_ref=METHOD_URL, frequency="Two explicitly simulated visits")],
        visits=visits, activities=activities, observations=[],
        simulated_fieldwork=dict(schema=SCHEMA, demo_id=DEMO_ID, recipe_sha256=recipe_sha),
    )
    mapping = dict(
        schema="upstate.implementation-lab-mapping/v1", delimiter=",", encoding="utf-8-sig",
        columns={key: key for key in initial_rows[0]}, constants={}, decimal_separator=".",
        result_type_values={}, row_actions={}, fallback_columns={},
        fill_missing_collection_times=True,
    )
    evidence = (
        "# SIMULATED repeat-collection field record\n\n"
        "Case: " + DEMO_ID + "\n\n"
        "SIM-COC-02 records an authored repeat visit on 2026-10-08 at the same eastern tributary site. "
        "The field team inspected handling and collected two new whole-water samples under the same declared method. "
        "The two new laboratory results are in repeat-lab-results.csv; use the application's calculated second "
        "QC review to interpret precision. Original SIM-COC-01 results and their review remain retained. "
        "This is simulated operating input, with no asserted real collection or observed restoration benefit.\n"
    ).encode("utf-8")
    files = {
        "original-model-input-recipe.json": recipe_bytes,
        "field-design.json": _raw(design), "seed-plan.json": _raw(seed),
        "initial-lab-results.csv": _csv(initial_rows), "repeat-lab-results.csv": _csv(repeat_rows),
        "lab-mapping.json": _raw(mapping), "repeat-field-record.md": evidence,
    }
    manifest = dict(schema=SCHEMA, demo_id=DEMO_ID, classification=LABEL, plan_id=plan_id,
                    recipe_sha256=recipe_sha, as_of=AS_OF, actor=ACTOR,
                    initial_result_count=len(initial_rows), repeat_result_count=len(repeat_rows),
                    files=[dict(path=name, bytes=len(raw), sha256=_sha(raw)) for name, raw in sorted(files.items())])
    dest = Path(destination).expanduser().resolve()
    if dest == recipe_path or recipe_path.is_relative_to(dest):
        raise ValueError("Select a separate prepared field-input directory")
    dest.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        _write(dest / name, raw)
    _write(dest / "field-inputs.json", _raw(manifest))
    return dict(directory=str(dest), manifest="field-inputs.json", **manifest)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.recipe, args.output), ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
