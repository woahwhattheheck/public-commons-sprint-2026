"""Maintained standalone scientific report rendering and original Workspace receiving."""
from __future__ import annotations

from pathlib import Path
from .common import (atomic_bytes, atomic_json, describe_file, digest, held,
                     read_json, relative_file, verify_file)
from . import portable, observed_context, scientific_report
from .workspace import Workspace


def prepare(workspace, choices, *, title=None, contact=None, manifest_paths=None):
    """Bind an ordered selection of already retained original scientific reports."""
    if not isinstance(choices, list) or not choices:
        raise ValueError("Choose one or more retained scientific report sources")
    selection = {"source_roles": {"OBSERVED_CONTEXT": choices[0]}}
    if len(choices) > 1:
        selection["observed_context_sources"] = choices
    choices = observed_context.source_choices(selection)
    if title is not None and (not isinstance(title, str) or not title.strip()):
        raise ValueError("Enter a nonempty report title")
    if manifest_paths is not None and len(manifest_paths) != len(choices):
        raise ValueError("Retain one original manifest path per selected report")
    sources, records = [], []
    for index, choice in enumerate(choices):
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        source = {**choice, "title": entry["title"], "vintage": entry["vintage"],
                  "uri": entry["uri"], "body_bytes": entry["body"]["bytes"],
                  "body_sha256": entry["body"]["sha256"]}
        if manifest_paths is not None:
            source["manifest_path"] = str(manifest_paths[index])
        sources.append(source)
        role = "OBSERVED_CONTEXT" if index == 0 else "OBSERVED_CONTEXT_%03d" % (index + 1)
        record = {"id": role, "source_id": entry["id"], "title": entry["title"],
                  "vintage": entry["vintage"], "uri": entry["uri"],
                  "sha256": entry["body"]["sha256"]}
        if len(choices) > 1:
            record["selection"] = choice
        records.append(record)
    bound = observed_context.bind(workspace, selection)
    if bound is None:
        raise ValueError("The original observed-report source was not selected")
    selection["observed_context_binding"] = bound
    resolved_title = title.strip() if title is not None else (
        sources[0]["title"] if len(sources) == 1
        else "Observed science: " + "; ".join(source["title"] for source in sources))
    if contact is None:
        contact = {"name": "Upper Savannah project team",
                   "organization": "Internal scientific review", "email": ""}
    if (not isinstance(contact, dict)
            or any(not isinstance(contact.get(key, ""), str)
                   for key in ("name", "organization", "email"))):
        raise ValueError("Report contact details must be text")
    identity = {"schema": "upstate.observed-report-native/v1", "workspace": str(workspace.root),
                "selection": selection, "binding": bound, "contact": contact,
                "report_version": scientific_report.REPORT_VERSION}
    # Preserve the original CLI's historical single-report identity.
    if len(choices) > 1 or title is not None:
        identity["title"] = resolved_title
    return {"schema": "upstate.observed-report-preview/v1", "state": "preview",
            "title": resolved_title, "source_count": len(sources), "sources": sources,
            "selection": selection, "binding": bound, "workspace": str(workspace.root),
            "render_identity": identity, "operation_id": "observed-report-" + digest(identity)[:20],
            "source_records": records}


def render(ws, preview, output):
    """Render or resume the original PDF, HTML, Markdown, figures and source data."""
    identity = preview["render_identity"]
    selection, bound = preview["selection"], preview["binding"]
    sources, title = preview["sources"], preview["title"]
    choices = observed_context.source_choices(selection)
    records = preview["source_records"]
    contact = identity["contact"]
    output = Path(output).resolve()
    if observed_context.bind(ws, selection) != bound:
        raise ValueError("The chosen report sources changed after preview")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".observed-report.lock"):
        atomic_json(output / "selection.json", identity, immutable=True)
        operation_path = output / "operation.json"
        if operation_path.exists():
            result = read_json(operation_path)
            if result.get("state") != "complete" or any(result.get(key) != value for key, value in identity.items()):
                raise ValueError("Resume the same completed report selection in its original directory")
            if result.get("operation_id") != "observed-report-" + digest(identity)[:20]:
                raise ValueError("The original completed report operation identity differs")
            for item in result["files"].values():
                verify_file(output, item)
        else:
            state = {"files": {}}
            product = observed_context.collect(ws, selection, output, state)
            if product is None or product["binding"] != bound:
                raise ValueError("The rendered source differs from the original selection")
            files = dict(product["files"])
            for item in files.values():
                verify_file(output, item)
            scientific_report.report_pdf(output / "report.pdf", title, product["sections"],
                                         contact=contact, source_records=records)
            files.update(scientific_report.write_companions(
                output, title, product["sections"], contact=contact, source_records=records,
                binding={"observed_context": bound, "workspace": str(ws.root), "selection": selection}))
            files["report_pdf"] = describe_file(output, output / "report.pdf")
            files["selection"] = describe_file(output, output / "selection.json")
            for item in files.values():
                verify_file(output, item)
            result = {
                **identity, "state": "complete", "operation_id": "observed-report-" + digest(identity)[:20],
                "source_collection_id": choices[0]["source_collection_id"], "source_id": choices[0]["source_id"],
                "source_count": len(sources), "sources": sources,
                "section_count": len(product["sections"]),
                "figure_count": sum(isinstance(block, dict) and block.get("kind") == "figure"
                                    for _, blocks in product["sections"] for block in blocks),
                "output": str(output), "files": files,
            }
            atomic_json(output / "operation.json", result)

    return result


def archive_report(workspace, directory, result, archive_path, receive_path=None, *, app_root=None):
    """Continue the original report with the maintained complete project transport."""
    app = Path(app_root or Path(__file__).resolve().parents[1]).resolve(strict=True)
    archive_path = Path(archive_path).expanduser().resolve()
    receive_path = Path(receive_path).expanduser().resolve() if receive_path else None
    for root in (workspace.root, directory, app):
        if archive_path.is_relative_to(root):
            raise ValueError("Keep the archive outside its captured Workspace, report and application")
        if receive_path and (receive_path.is_relative_to(root) or root.is_relative_to(receive_path)):
            raise ValueError("Restore into an independent directory outside the original source")
    if receive_path and (archive_path.is_relative_to(receive_path) or receive_path == archive_path):
        raise ValueError("Keep the original archive outside its receiving directory")
    key = digest({name: value for name, value in result.items()
                  if name not in ("files", "output")})
    relative = Path("observed-reports") / key
    retained = workspace.root / relative
    selected = dict(result["files"])
    if "operation" in selected or "capture" in selected:
        raise ValueError("Original report file roles conflict with its receiving records")
    selected["operation"] = describe_file(directory, directory / "operation.json")
    # The report is an observed report, not a modeled delivery. Retain its exact
    # ordinary files inside the Workspace without creating a delivery record.
    with held(workspace.root / ".workspace.lock"):
        for item in selected.values():
            verify_file(directory, item)
            source = relative_file(directory, item["path"])
            target = retained / item["path"]
            if target.is_symlink() or any(parent.is_symlink()
                                         for parent in target.parents
                                         if parent.is_relative_to(workspace.root)):
                raise ValueError("Keep retained report members as regular Workspace files")
            atomic_bytes(target, source.read_bytes(), immutable=True)
            verify_file(retained, item)
            verify_file(directory, item)
        captured = {"schema": "upstate.observed-report-capture/v1",
                    "operation_id": result["operation_id"],
                    "project_id": workspace.project["id"],
                    "report_binding": result["binding"],
                    "selection": result["selection"], "files": selected}
        atomic_json(retained / "capture.json", captured, immutable=True)
    selected["capture"] = describe_file(retained, retained / "capture.json")
    wanted = {"workspace/" + relative.as_posix() + "/" + item["path"]: item
              for item in selected.values()}
    if not archive_path.exists():
        workspace.backup(archive_path)
    manifest = portable.inspect_archive(archive_path, verify=True)
    if manifest["project"] != workspace.project:
        raise ValueError("The retained archive belongs to another original Workspace")
    for name, expected in wanted.items():
        member = manifest["members"].get(name)
        if member is None or any(member[field] != expected[field] for field in ("bytes", "sha256")):
            raise ValueError("The archive does not retain this exact completed report: " + name)
    archive_identity = describe_file(archive_path.parent, archive_path)
    completed = {"schema": "upstate.observed-report-receiving/v1",
                 "operation_id": result["operation_id"],
                 "project_id": workspace.project["id"],
                 "archive": {**archive_identity, "path": str(archive_path)},
                 "report_directory": relative.as_posix(),
                 "archive_members": len(manifest["members"])}
    receipt_path = archive_path.with_name(archive_path.name + ".observed-report.json")
    atomic_json(receipt_path, completed, immutable=True)
    if receive_path:
        if not receive_path.exists():
            portable.restore(archive_path, receive_path)
        else:
            # A process may stop after native restore's final rename and before
            # the receiving receipt. Reconcile that original directory in place.
            for name, item in manifest["members"].items():
                verify_file(receive_path, {**item, "path": name})
        received = Workspace(receive_path / "workspace")
        if received.project != workspace.project:
            raise ValueError("Independent reopening changed the original project identity")
        restored_report = received.root / relative
        for item in selected.values():
            verify_file(restored_report, item)
        if read_json(restored_report / "operation.json") != result:
            raise ValueError("Independent reopening changed the original report operation")
        if read_json(restored_report / "capture.json") != captured:
            raise ValueError("Independent reopening changed the original report selection")
        choices = result["selection"].get("observed_context_sources") or [
            result["selection"]["source_roles"]["OBSERVED_CONTEXT"]]
        for choice in choices:
            received.source_file(choice["source_collection_id"], choice["source_id"])
        completed["received"] = {
            "directory": str(receive_path), "workspace": str(received.root),
            "report_directory": str(restored_report),
            "files": {role: {**item, "path": str(restored_report / item["path"])}
                      for role, item in result["files"].items()},
            "identity": "MATCH",
        }
        receive_receipt = receive_path / "observed-report-receiving.json"
        atomic_json(receive_receipt, completed, immutable=True)
        completed["receiving_receipt"] = str(receive_receipt)
    return {**completed, "receipt": str(receipt_path)}
