"""Open original selected-study receipts and their editable fieldwork.

The selected Study transfer remains the capture/receive authority. This reader
lists retained receipts and opens one through its existing dependency resolver.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re

from .common import digest, identifier, read_json
from . import study_transfer
from . import scientific_report_study_transfer as reports
from . import implementation_report_transfer as fieldwork
from .portable_implementation import report_edition
from . import gauge_study_receiving
from . import ensemble_study_receiving

HEX = re.compile(r"[0-9a-f]{64}")
SCHEMA = "upstate.study-receiving-view/v1"


def _receipt(workspace, key):
    key = identifier(key)
    root = Path(workspace.root).resolve()
    bank = root / "study-transfers"
    path = bank / (key + ".json")
    if bank.is_symlink() or path.is_symlink() or not path.is_file():
        raise ValueError("Choose an original saved Study transfer in this Workspace.")
    value = read_json(path)
    identity = value.get("identity")
    if (value.get("schema") != study_transfer.RECEIPT_SCHEMA
            or value.get("id") != key or not isinstance(identity, dict)
            or digest(identity) != key or identity.get("project_id") != workspace.project["id"]):
        raise ValueError("The saved Study transfer differs from its original project identity.")
    return value


def _summary(value):
    identity = value["identity"]
    fields = identity.get("implementation_report_sources", [])
    return {
        "id": value["id"], "title": value["title"], "captured_at": value.get("captured_at"),
        "state": "saved", "source_files": value.get("source_files"),
        "source_bytes": value.get("source_bytes"),
        "report_count": len(identity.get("scientific_report_editions", [])),
        "field_source_count": len(fields),
        "editable_plan_count": len({row["native_plan"]["plan_id"] for row in fields
                                   if row.get("native_plan") is not None}),
        "selection": deepcopy(identity["selection"]),
        **gauge_study_receiving.summary(identity),
        **ensemble_study_receiving.summary(identity),
    }


def catalog(workspace, *, offset=0, limit=50):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
        raise ValueError("Use a nonnegative offset and a page size from 1 to 200.")
    bank = Path(workspace.root) / "study-transfers"
    if bank.is_symlink():
        raise ValueError("The retained Study transfer bank must be an ordinary directory.")
    rows = []
    for path in bank.glob("*.json"):
        if not HEX.fullmatch(path.stem):
            continue
        try:
            rows.append(_summary(_receipt(workspace, path.stem)))
        except (OSError, ValueError, KeyError, TypeError) as error:
            rows.append({"id": path.stem, "title": path.stem[:16], "state": "unreadable",
                         "error": str(error), "captured_at": ""})
    rows.sort(key=lambda row: (row.get("captured_at") or "", row["id"]), reverse=True)
    selected = rows[offset:offset + limit]
    end = offset + len(selected)
    return {"items": selected, "total": len(rows), "offset": offset, "limit": limit,
            "next_offset": end if end < len(rows) else None}


def detail(workspace, key):
    retained = _receipt(workspace, key)
    identity = retained["identity"]
    closure = study_transfer._Closure(
        workspace, identity["selection"],
        report_lineage="scientific_report_sources" in identity,
        implementation_lineage="implementation_report_sources" in identity,
    ).resolve(identity.get("investigation_dependencies", ()))
    captured_reports = identity.get("scientific_report_editions", [])
    captured_fields = identity.get("implementation_report_sources", [])
    reports.verify_receipt(closure, captured_reports)
    fieldwork.verify_receipt(closure, captured_fields)
    current_reports = {row["id"]: row for row in reports.receipt(closure)}
    current_fields = {(row["source_collection_id"], row["source_id"]): row
                      for row in fieldwork.receipt(closure)}
    result = {**_summary(retained), "schema": SCHEMA,
              "project": deepcopy(workspace.project), "reports": [], "field_sources": []}
    for captured in captured_reports:
        row = deepcopy(current_reports[captured["id"]])
        # Exact retained members are used for tickets; an original later ZIP can
        # coexist with the historical report without changing its selected source.
        result["reports"].append(row)
    store = None
    for captured in captured_fields:
        row = deepcopy(current_fields[(captured["source_collection_id"], captured["source_id"])])
        native = row.get("native_plan")
        row["reports"] = []
        row["deployments"] = []
        if native is not None:
            if store is None:
                store = fieldwork._OriginalStore(workspace)
            plan_id = native["plan_id"]
            report_root = store._directory(plan_id) / "reports"
            for folder in sorted(report_root.iterdir()) if report_root.exists() else []:
                if not HEX.fullmatch(folder.name):
                    continue
                edition = report_edition(store, folder)
                members = []
                manifest = read_json(folder / "manifest.json")
                for item in manifest["files"]:
                    relative = (folder / item["name"]).relative_to(closure.root).as_posix()
                    closure.add_file(relative, {"bytes": item["size_bytes"], "sha256": item["sha256"]})
                    members.append({"path": relative, "bytes": item["size_bytes"], "sha256": item["sha256"]})
                manifest_relative = (folder / "manifest.json").relative_to(closure.root).as_posix()
                closure.read(manifest_relative)
                descriptor = closure.files[manifest_relative]
                members.append({"path": manifest_relative, "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]})
                row["reports"].append({
                    "id": edition["id"], "plan_id": plan_id, "revision": edition["revision"],
                    "document_digest": edition["document_digest"], "as_of": edition.get("as_of"),
                    "selected_source_report": edition["id"] == native.get("selected_report_id"),
                    "members": members,
                })
            from .field_deployment import inspect
            for deployment_id in native.get("retained_deployment_ids", []):
                packet = inspect(workspace, plan_id, deployment_id)
                prefix = "implementation/plans/" + plan_id + "/deployments/" + deployment_id + "/"
                members = [{"path": prefix + item["path"], "bytes": item["bytes"], "sha256": item["sha256"]}
                           for item in packet["files"].values()]
                row["deployments"].append({
                    "id": deployment_id, "plan": packet["plan"],
                    "selection": packet["selection"], "summary": packet["summary"],
                    "captured_with_study": deployment_id in captured["native_plan"].get("retained_deployment_ids", []),
                    "members": members,
                })
        result["field_sources"].append(row)
    gauge_study_receiving.augment(closure, retained, result)
    ensemble_study_receiving.augment(closure, retained, result)
    # Validate the resolved file identities again after constructing this read.
    # The existing ticket service verifies actual member bytes when downloaded.
    closure.assert_unchanged()
    return result
