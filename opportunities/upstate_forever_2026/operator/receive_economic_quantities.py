"""Exercise quantity authoring through the unchanged full Economic receiving course.

The supplied recipe contains actual chosen source IDs and explicit user
assumptions. This wrapper uses the original browser, queue and complete
save/reopen/edition/download/independent receive journey.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quantity-recipe", required=True)
    parser.add_argument("--application", required=True)
    ours, original = parser.parse_known_args(argv)
    application = Path(ours.application).resolve(strict=True)
    recipe_path = Path(ours.quantity_recipe).resolve(strict=True)
    raw = recipe_path.read_text(encoding="utf-8-sig")
    recipe = json.loads(raw)
    required = {"report_id", "zone_id", "run_id", "footprint_id", "lines", "planning"}
    if not required <= set(recipe) or not recipe["lines"]:
        raise ValueError("Use a complete actual selected-source quantity recipe.")
    if any(flag in original for flag in ("--selection", "--phase", "--resume-journey", "--cost-review")):
        raise ValueError("This additive authoring course starts the original all-phase receiving journey; retain its other established modes unchanged.")
    source = application / "operator" / "economic_receive.py"
    spec = importlib.util.spec_from_file_location("original_quantity_economic_receive", source)
    course = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(course)
    original_fill = course.fill_default_inputs
    original_journal = course.Journal
    active = {"journal": None, "estimate": None}

    class JoinedJournal(original_journal):
        def __init__(self, root, token, record):
            super().__init__(root, token, record)
            active["journal"] = self
            (root / "quantity-recipe-original.json").write_text(raw, encoding="utf-8")
            record["quantity_recipe"] = course.descriptor(root / "quantity-recipe-original.json", root)

    def fill(page, notes):
        original_fill(page, notes)
        journal = active["journal"]
        with journal.stage("author_source_bound_intervention_quantities") as step:
            panel = page.locator("[data-quantity-editor]")
            panel.wait_for(state="visible")
            panel.locator('[data-q-view="run_id"]').select_option(recipe["run_id"])
            panel.locator('[data-q-action="footprints"]').click()
            page.wait_for_function("(id)=>Array.from(document.querySelector('[data-q-view=footprint_id]')?.options||[]).some(row=>row.value===id)", arg=recipe["footprint_id"])
            panel.locator('[data-q-view="footprint_id"]').select_option(recipe["footprint_id"])
            panel.locator('[data-q-action="new"]').click()
            panel.locator('[data-q-action="add"]').wait_for(state="visible")
            for supplied in recipe["lines"]:
                panel.locator('[data-q-action="add"]').click()
                row = panel.locator("[data-q-line]").last
                row.locator('[data-q-field="title"]').fill(supplied.get("title", ""))
                row.locator('[data-q-field="catalogue_id"]').select_option(supplied["catalogue_id"])
                row = panel.locator("[data-q-line]").last
                row.locator('[data-q-field="row_id"]').select_option(supplied["row_id"])
                quantity = supplied["quantity"]
                row.locator('[data-q-field="quantity.kind"]').select_option(quantity["kind"])
                row = panel.locator("[data-q-line]").last
                if quantity["kind"] == "native":
                    row.locator('[data-q-field="quantity.key"]').select_option(quantity["key"])
                else:
                    for key in ("value", "reason"):
                        row.locator('[data-q-field="quantity.' + key + '"]').fill(str(quantity[key]))
                    row.locator('[data-q-field="quantity.unit"]').select_option(quantity["unit"])
                row.locator('[data-q-field="classification"]').select_option(supplied["classification"])
                row = panel.locator("[data-q-line]").last
                for key in ("applicability_reason", "annual_occurrences", "recurrence_reason", "scope_group", "overlap_reason"):
                    if key in supplied:
                        row.locator('[data-q-field="' + key + '"]').fill(str(supplied[key]))
                if supplied.get("rate_override"):
                    row.locator("details summary").click()
                    for key, value in supplied["rate_override"].items():
                        row.locator('[data-q-field="override.' + key + '"]').fill(str(value))
            for key, value in recipe["planning"].items():
                panel.locator('[data-q-planning="' + key + '"]').fill(str(value))
            panel.locator('[data-q-action="calculate"]').click()
            page.screenshot(path=str(journal.root / "quantity-authoring-desktop.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            page.screenshot(path=str(journal.root / "quantity-authoring-narrow.png"), full_page=True)
            page.set_viewport_size({"width": 1440, "height": 1000})
            with page.expect_download() as saved:
                panel.locator('[data-q-action="download"]').click()
            target = journal.root / "quantity-estimate-original.json"
            saved.value.save_as(str(target))
            estimate = json.loads(target.read_text(encoding="utf-8"))
            course.require(estimate["context"]["binding"]["run_id"] == recipe["run_id"]
                           and estimate["context"]["binding"]["footprint_id"] == recipe["footprint_id"],
                           "The entered estimate selected another original source.")
            course.require(len(estimate["lines"]) == len(recipe["lines"]), "The entered estimate lost an original line.")
            active["estimate"] = estimate
            panel.locator('[data-q-action="worksheet"]').click()
            page.locator("[data-worksheet-preview]").wait_for(state="visible")
            course.require(page.locator('[data-econ="worksheet-apply"]').is_enabled(),
                           "Correct the actual source/planning assumptions shown in the worksheet before applying.")
            page.screenshot(path=str(journal.root / "quantity-original-worksheet-preview.png"), full_page=True)
            page.locator('[data-econ="worksheet-apply"]').click()
            step.update(estimate=course.descriptor(target, journal.root),
                        source_binding=estimate["context"]["binding"],
                        original_lines=len(estimate["lines"]))

    course.Journal = JoinedJournal
    course.fill_default_inputs = fill
    original += ["--application", str(application), "--report-id", recipe["report_id"],
                 "--zone-id", recipe["zone_id"], "--run-id", recipe["run_id"]]
    code = course.main(original)
    journal = active["journal"]
    if code == 0:
        if journal is None or active["estimate"] is None:
            raise ValueError("The original receiving course did not execute quantity authoring.")
        edition = json.loads((journal.root / "operator-edition.json").read_text(encoding="utf-8"))
        selection = edition["input"]["selection"]
        course.require(active["estimate"] in selection["quantity_estimates"],
                       "The saved/reopened native edition changed the complete editable estimate.")
        originals = [json.loads(row["original_text"]) for row in selection.get("cost_worksheets", [])
                     if row.get("format") == "json"]
        course.require(any(any(row.get("run_id") == recipe["run_id"] for row in document.get("rows", []))
                           for document in originals),
                       "The native edition lost the original reviewed cost worksheet.")
        # The original receiver already completed all package member checks,
        # independent offline receiving and optional Implementation handoff.
        print(json.dumps({"status": "quantity_course_complete",
                          "journey": str(journal.root / "operator-journey.json"),
                          "edition_id": edition["id"],
                          "visual_review": "Producing worker must open both exact screenshots and all actual outgoing files; captured images alone are not visual inspection."}))
    return code

if __name__ == "__main__":
    raise SystemExit(main())
