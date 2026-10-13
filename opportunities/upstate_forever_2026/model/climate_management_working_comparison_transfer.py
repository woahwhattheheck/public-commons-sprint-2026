"""Selected-Study closure for exact saved Management draft comparisons."""
from copy import deepcopy
from .common import digest, identifier
from . import climate_management_working_comparison as comparisons

KIND = comparisons.KIND


def visit(closure, kind, key, value, reason):
    if kind != KIND:
        return False
    record = comparisons.get_report(closure.workspace, identifier(key), verify=False)
    if {**value, "id": key} != record:
        raise ValueError("The selected saved-design comparison changed during capture")
    for side in ("before", "after"):
        revision = record["identity"]["selection"][side + "_revision_id"]
        closure.need("climate-management-working", revision,
                     "Complete original " + side + " design and all bound source families")
    for item in record["files"].values():
        closure.add_file(item["path"], item)
    records = getattr(closure, "management_working_comparison_records", None)
    if records is None:
        records = {}
        closure.management_working_comparison_records = records
    records[key] = {"id": key, "preview_id": record["preview_id"],
                    "before_revision_id": record["identity"]["selection"]["before_revision_id"],
                    "after_revision_id": record["identity"]["selection"]["after_revision_id"],
                    "before_history_sha256": digest(record["identity"]["before"]),
                    "after_history_sha256": digest(record["identity"]["after"]),
                    "files": deepcopy(record["files"])}
    closure.nodes[(kind, key)].update(title=record["result"]["title"], state="complete",
                                     changed_design_fields=record["result"]["changed_design_fields"])
    return True


def receipt(closure):
    return [deepcopy(value) for _, value in sorted(getattr(closure, "management_working_comparison_records", {}).items())]


def verify_receipt(closure, expected):
    if receipt(closure) != expected:
        raise ValueError("The received Study changed its original saved-design comparison")


def catalogue(workspace):
    return [{"kind": KIND, "id": row["id"], "title": row["title"], "state": "complete",
             "updated_at": "", "selection": {key: row[key] for key in ("before_revision_id", "after_revision_id")}}
            for row in comparisons.list_reports(workspace)]
