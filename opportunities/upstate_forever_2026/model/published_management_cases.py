"""Published treatment choices composed into the existing management-case workflow."""
from __future__ import annotations
import json
import math
from pathlib import Path
from .common import file_digest
from . import experiment_profiles, management_cases

APP = Path(__file__).resolve().parents[1]
CATALOG_PATH = APP / "source/management-practices-20261013/endale-2021-pasture-recipe.json"
CATALOG_SHA256 = "18dd011c195ff67e3a98e6fe34a788cacd94cd8dc70afe4fee4556a9c5dd86d2"
NDR_URI = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"

def recipe():
    if file_digest(CATALOG_PATH) != CATALOG_SHA256:
        raise ValueError("The retained published treatment recipe changed")
    value = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if value.get("schema") != "upstate.published-management-recipe/v1" or len(value.get("treatments", [])) != 6:
        raise ValueError("Select the original six-treatment pasture recipe")
    return value


def selection(workspace, profile_id, lucode, *, confirm_pasture, nitrogen_compartment, applicability):
    if confirm_pasture is not True or type(lucode) is not int:
        raise ValueError("Explicitly select and confirm the intended grazed pasture class")
    applicability = str(applicability or "").strip()
    if not applicability:
        raise ValueError("Explain the pasture mapping and limits of transfer to this project")
    if nitrogen_compartment not in ("existing-surface-only", "explicit-surface-only"):
        raise ValueError("Choose the existing or explicitly declared surface-only nitrogen boundary")
    original = experiment_profiles.catalog(workspace, profile_id)
    if "ndr" not in original["models"]:
        raise ValueError("The selected profile must include NDR")
    matches = [row for row in original["table_rows"] if int(row["lucode"]) == lucode]
    if len(matches) != 1:
        raise ValueError("The selected pasture code is absent from the actual profile table")
    row = matches[0]
    if any(row[field].strip() != "measured-runoff" for field in ("load_type_n", "load_type_p")):
        raise ValueError("Both nutrients must already use measured-runoff; this recipe does not "
                         "relabel or convert an application-rate profile")
    proportion = float(row["proportion_subsurface_n"])
    if not math.isfinite(proportion) or not 0 <= proportion <= 1:
        raise ValueError("Original nitrogen partition must be a finite ratio in [0,1]")
    if nitrogen_compartment == "existing-surface-only" and proportion != 0:
        raise ValueError("The original subsurface share is nonzero. Choose explicit-surface-only "
                         "to declare zero in all six literature cases, or select an appropriate "
                         "alternative source; no unmeasured total nitrogen load is inferred")
    data = recipe()
    context = (
        "Published grazed tall-fescue surface runoff at a Georgia Piedmont field edge; annual "
        "2007-2009 treatment means with author gap filling. An explicit literature scenario, "
        "not local calibration or total-catchment N. Project applicability: " + applicability)
    partition = (
        "All six literature cases use proportion_subsurface_n=0 as a surface-only scenario "
        "boundary, not a measurement of absent subsurface N. Keep original landscape routing "
        "and runoff normalization settings.")
    practices = []
    for treatment in data["treatments"]:
        changes = []
        for field, nutrient in (("load_n", "Total N"), ("load_p", "Total P")):
            changes.append({
                "lucode": lucode, "parameter": field, "value": treatment[field],
                "units": "kg/ha/year", "load_type": "measured-runoff",
                "source": {
                    "title": data["source"]["title"], "uri": data["source"]["supplement_uri"],
                    "locator": "Table S4 / " + nutrient + " / Mean / Grazed " +
                               treatment["fertilizer"] + " / " + treatment["endophyte"],
                    "period": data["source"]["period"], "applicability": context}})
        if nitrogen_compartment == "explicit-surface-only":
            changes.append({
                "lucode": lucode, "parameter": "proportion_subsurface_n",
                "value": 0.0, "units": "ratio", "load_type": "",
                "source": {
                    "title": "Explicit surface-only scenario boundary; InVEST 3.20 NDR semantics",
                    "uri": NDR_URI, "locator": "Biophysical table / proportion_subsurface_n",
                    "period": "Model version 3.20.0",
                    "applicability": partition + " This zero is a model choice, not an observed "
                                     "field-treatment coefficient."}})
        practices.append({
            "key": treatment["key"], "name": treatment["name"],
            "category": "nutrient_load", "source_mode": "coupled",
            "reason": context + " Keep this N/P pair together. " + partition,
            "changes": changes})
    selected = {
        "title": data["title"] + " / land-cover " + str(lucode),
        "reason": context + " " + partition + " Compare fertilizer treatments within each "
                  "endophyte. Preserve P-down/N-up tradeoffs; no N/P factorial or confidence interval.",
        "baseline_profile_id": original["baseline_profile_id"],
        "expected_table_sha256": original["biophysical_sha256"],
        "practices": practices, "combinations": []}
    binding = {
        "workspace_id": workspace.project["id"], "profile_id": original["baseline_profile_id"],
        "table_sha256": original["biophysical_sha256"], "lucode": lucode, "original_row": row,
        "nitrogen_compartment": nitrogen_compartment, "original_subsurface_n": proportion,
        "applicability": applicability, "recipe_sha256": CATALOG_SHA256,
        "baseline_parameters": original["baseline_parameters"]}
    return selected, binding



def catalog(workspace, profile_id):
    """Read current source/table eligibility without selecting a treatment or writing files."""
    original = experiment_profiles.catalog(workspace, profile_id)
    data = recipe()
    rows = []
    for row in original["table_rows"]:
        active = "ndr" in original["models"]
        measured = active and all(
            str(row.get(field, "")).strip() == "measured-runoff"
            for field in ("load_type_n", "load_type_p"))
        code = int(row["lucode"])
        description = next((str(row[key]).strip() for key in
                            ("LULC_desc", "lucode_name", "description", "name")
                            if row.get(key)), "")
        rows.append({
            "lucode": code, "description": description,
            "eligible": bool(measured),
            "reason": "" if measured else "Requires original NDR measured-runoff tags for both nutrients",
            "load_n": float(row["load_n"]) if active else None,
            "load_p": float(row["load_p"]) if active else None,
            "proportion_subsurface_n": float(row["proportion_subsurface_n"]) if active else None,
            "load_type_n": row.get("load_type_n", ""),
            "load_type_p": row.get("load_type_p", ""),
        })
    return {
        "id": data["id"], "title": data["title"],
        "recipe_sha256": CATALOG_SHA256, "source": data["source"],
        "context": data["context"], "measurement": data["measurement"],
        "treatments": data["treatments"], "comparisons": data["comparisons"],
        "profile_id": original["baseline_profile_id"],
        "table_sha256": original["biophysical_sha256"], "models": original["models"],
        "land_cover": rows,
        "scope": "Coefficient changes apply to every pixel of the selected land-cover class. "
                 "Use the existing mapped/reclassified scenario workflow for a spatial subset.",
        "meaning": "Published field-edge loading scenarios, not local calibration. All six N/P pairs "
                   "stay coupled; three same-endophyte contrasts preserve lower P and higher N. "
                   "Native routed stream exports are a different endpoint.",
    }


def preview(workspace, value):
    allowed = {"recipe_id", "profile_id", "expected_table_sha256", "lucode",
               "confirm_pasture", "nitrogen_compartment", "applicability"}
    if not isinstance(value, dict) or set(value) != allowed:
        raise ValueError("Choose the actual published recipe, profile/table, pasture class and scope")
    data = recipe()
    if value["recipe_id"] != data["id"]:
        raise ValueError("Select an installed published treatment source")
    selected, binding = selection(
        workspace, value["profile_id"], value["lucode"],
        confirm_pasture=value["confirm_pasture"],
        nitrogen_compartment=value["nitrogen_compartment"],
        applicability=value["applicability"])
    if value["expected_table_sha256"] != binding["table_sha256"]:
        raise ValueError("The original coefficient table changed; refresh the selected profile")
    checked = management_cases.preview(workspace, selected)
    return {
        "recipe_id": data["id"], "recipe_sha256": CATALOG_SHA256,
        "source": data["source"], "binding": binding,
        "selection": checked["selection"], "preview": checked,
    }
