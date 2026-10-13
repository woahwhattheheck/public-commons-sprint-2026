"""Expose a retained PRISM AN archive in the original source-preparation desk.

The existing period engine owns metadata validation, native clipping, units and
derivation. This adapter only retains the chosen original and binds one explicit
calendar year to that engine; it never acquires a replacement or runs a model.
"""
from __future__ import annotations

from pathlib import Path

from model.common import atomic_json, digest, read_json
from source_tools import prism_period


def method_schema(input_field, option, domain_options):
    return {
        "id": "prism-annual", "title": "PRISM annual precipitation archive",
        "role": "PRECIPITATION",
        "description": "Prepare one original annual AN precipitation archive for its explicit year and complete upstream domain.",
        "inputs": [
            input_field("archive", "Original annual PRISM ZIP", required=True,
                        help="Select the complete retained AN archive. Its original metadata must match the selected year and resolution."),
            input_field("domain", "Complete upstream model domain", required=True, kinds=["vector"],
                        help="Keep the original contributing polygon and its companions; a reporting mask is a separate selection."),
            input_field("provenance", "Original acquisition or transfer record",
                        help="Optional original receipt or source record. It is retained unchanged with the selected files."),
        ],
        "options": [
            {**option("year", "Calendar year", "integer", required=True,
                      help="The original annual total covers January 1 through January 1 of the following year, exclusive."),
             "min": 1895, "max": 9998},
            option("resolution", "Original PRISM resolution", "choice", required=True,
                   choices=[{"value": "", "label": "Select original resolution…"},
                            {"value": "800m", "label": "800 m / 30 arcseconds"},
                            {"value": "4km", "label": "4 km / 2.5 arcminutes"}],
                   help="Select the original archive product. Local clipping keeps its native resolution."),
            *[dict(field) for field in domain_options],
            option("maximum_clip_pixels", "Maximum local source cells", "integer", default=4000000,
                   help="The complete selected domain and buffer must fit this native source-window capacity."),
        ],
    }


def prepare_entry(owner, workspace, task, native, record, files, snapshots, options):
    year = options["year"]
    if type(year) is not int or not 1895 <= year <= 9998:
        raise ValueError("Select the original calendar year between 1895 and 9998")
    period_options = {
        "domain": files["domain"], "start": f"{year:04d}-01-01",
        "end": f"{year + 1:04d}-01-01", "resolution": options["resolution"],
        "maximum_clip_pixels": options.get("maximum_clip_pixels", 4000000),
        **owner._domain_options(options, snapshots["domain"]),
    }
    selected = prism_period.plan(**period_options)
    if len(selected["periods"]) != 1 or selected["periods"][0]["months"] != 12:
        raise ValueError("Select one complete original calendar-year archive")
    period = selected["periods"][0]
    # The original metadata, not a renamed upload, establishes the AN product.
    prism_period._package(files["archive"], period, selected)
    snapshot = snapshots["archive"]
    original = next(row for row in snapshot["files"] if row["path"] == snapshot["main"])
    retained = owner._object(workspace, files["archive"], original)
    output = Path(native) / "prepared"
    owner._link_object(workspace, retained, output / "original" / period["archive"])
    # This is a local original-file selection, never an invented HTTP receipt.
    atomic_json(output / "original" / "archive-selection.json", {
        "schema": "upstate.prism-annual-original-selection/v1",
        "task_id": task["id"], "request_sha256": task["request_sha256"],
        "input_snapshot_sha256": digest(snapshot), "original_filename": original["path"],
        "bytes": retained["bytes"], "sha256": retained["sha256"],
        "selected_period": period, "source": "retained-original-input",
        "publisher_request_issued": False,
    }, immutable=True)
    owner._stage(workspace, record, "Preparing the retained PRISM annual source", lambda:
                 prism_period.prepare(output, **period_options, download=False))
    return read_json(output / "source-entry.json")
