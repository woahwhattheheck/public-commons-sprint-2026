#!/usr/bin/env python3
"""Save and receive one reviewed original table through the maintained workbench API.

TokenJunkieLabs. Reuses the existing task queue, file receiver and Study format.
The private opening JSON is read in memory; capabilities never enter the output.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import zipfile
from urllib.parse import quote

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.common import atomic_bytes, atomic_json, canonical, digest, file_digest, held, read_json
from model.client_source_files import checked_selection
from model.client_source_inspection_report import retained_table_preview

SCHEMA = "upstate.saved-source-reference-receiving/v1"
PREVIEW_KEYS = ("sample_records", "original_fields", "original_worksheet",
                "original_header_row", "original_preamble", "reading_options",
                "source_format", "sample_limit", "more_rows", "formula_mode",
                "preview_basis")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def api_class():
    path = APPLICATION / "operator" / "workbench_client.py"
    require(path.is_file(), "Install the existing maintained operator/workbench_client.py API family.")
    spec = importlib.util.spec_from_file_location("eco_saved_source_api", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.WorkbenchClient, module.APIError


def undecorated(value):
    return {k: v for k, v in value.items() if not k.startswith("_")}


def documents(args):
    """Read exact retained records, optionally straight from their original ZIP."""
    if args.original_delivery:
        candidates = []
        with zipfile.ZipFile(args.original_delivery) as archive:
            names = archive.namelist()
            require(len(names) == len(set(names)), "The original delivery has duplicate archive members.")
            for info in archive.infolist():
                if not info.filename.lower().endswith(".json") or info.file_size > 16 * 1024 * 1024:
                    continue
                try:
                    value = json.loads(archive.read(info))
                except (ValueError, UnicodeError):
                    continue
                if isinstance(value, dict):
                    candidates.append(value)
                    if isinstance(value.get("result"), dict):
                        candidates.append(value["result"])
        inspections = [undecorated(v) for v in candidates if
                       v.get("schema") == "upstate.client-source-operation/v1"
                       and v.get("action") == "client-source.inspect"
                       and v.get("state") == "complete" and v.get("id") == args.inspection_id]
        selections = [v for v in candidates if
                      v.get("schema") == "upstate.client-source-selection/v1"
                      and v.get("inspection_id") == args.inspection_id]
        inspections = {digest(v): v for v in inspections}
        selections = {digest(v): v for v in selections}
        require(len(inspections) == 1, "Select the original ZIP containing this one completed inspection.")
        require(len(selections) == 1, "Select the ZIP's one original reviewed selection; use explicit JSON files if it has several.")
        return next(iter(inspections.values())), next(iter(selections.values()))
    require(args.inspection and args.reviewed_selection, "Supply both original inspection and reviewed-selection JSON files.")
    inspection = read_json(args.inspection)
    if inspection.get("schema") == "upstate.operator-task/v1":
        inspection = inspection.get("result") or {}
    inspection = undecorated(inspection)
    require(inspection.get("id") == args.inspection_id, "The selected original inspection ID differs.")
    return inspection, read_json(args.reviewed_selection)


def original_choice(inspection, reviewed, args):
    require(inspection.get("action") == "client-source.inspect" and inspection.get("state") == "complete",
            "Use the already completed original inspection.")
    require(reviewed.get("schema") == "upstate.client-source-selection/v1"
            and reviewed.get("inspection_id") == inspection["id"]
            and reviewed.get("project_id") == inspection.get("project_id")
            and reviewed.get("inspection_sha256") == digest(inspection),
            "The reviewed selection must belong to the complete original inspection.")
    choices = [x for x in reviewed.get("selections", []) if
               x.get("file_index") == args.file_index and x.get("part_index") == args.part_index]
    require(len(choices) == 1, "Choose one original reviewed file/part pair.")
    original = deepcopy(choices[0])
    checked_selection(original, inspection)
    selected = deepcopy(original)
    selected.update(role="CONTEXT", mapping={}, title=args.title)
    selected.pop("conversion", None)
    selected, file, part = checked_selection(selected, inspection)
    require(part.get("kind") == "table", "This reference receiver saves original reviewed tables and worksheets.")
    require(file["inspection"].get("format") in {"xlsx", "xlsm", "xls", "csv", "tsv", "txt"},
            "Choose an original supported native table format.")
    return original, selected, file, part


def projection(info):
    return {k: deepcopy(info[k]) for k in PREVIEW_KEYS if k in info}


def check_preview(info, file, part, selection):
    source = info.get("source") or {}
    require(source.get("kind") == "table" and source.get("role") == "CONTEXT",
            "The native result is not the selected original CONTEXT table.")
    require(not source.get("field_projection")
            and source.get("body", {}).get("sha256") == file["original"]["sha256"],
            "The reference must keep the unchanged original file.")
    client = source.get("client_source") or {}
    require(client.get("selection") == selection, "The source changed the explicit reviewed selection.")
    require(info.get("preview_basis") == "retained-original-native-inspection"
            and info.get("sample_records") == part.get("rows", [])
            and info.get("original_fields") == part.get("fields", [])
            and info.get("original_worksheet") == part.get("sheet")
            and info.get("original_header_row") == part.get("header_row")
            and info.get("original_preamble") == part.get("preamble", [])
            and info.get("reading_options") == file["options"],
            "The received worksheet preview differs from its original rows, columns or reading choices.")
    require(("more_rows" in info) == ("more_rows" in part)
            and info.get("more_rows") == part.get("more_rows"),
            "The native end-of-preview state changed.")
    return projection(info)


class Course:
    def __init__(self, output, identity):
        self.root, self.path = output, output / "operation.json"
        if self.path.exists():
            self.state = read_json(self.path)
            require(self.state.get("schema") == SCHEMA and self.state.get("identity") == identity,
                    "Resume the original receiving output with exactly the same reviewed inputs.")
        else:
            self.state = {"schema": SCHEMA, "identity": identity, "tasks": {}, "phase": "prepared"}
        self.save()

    def save(self, **values):
        self.state.update(values)
        atomic_json(self.path, self.state)

    def phase(self, name, **values):
        self.save(phase=name, **values)
        print(json.dumps({"phase": name, **values}, ensure_ascii=False), flush=True)

    def task(self, client, api_error, name, action, payload, seconds, resume_failed):
        operation_id = "source-reference-" + digest({"identity": self.state["identity"], "phase": name})[:48]
        request_path = self.root / (name + "-request.json")
        request = client.freeze(action, payload, request_path, operation_id=operation_id)
        predicted = digest({"workspace": client.workspace, "operation_id": operation_id})
        prior = self.state["tasks"].get(name)
        if prior:
            require(prior["request_sha256"] == digest(request)
                    and prior["workspace"] == client.workspace,
                    "The retained task request changed.")
        else:
            prior = {"id": predicted, "workspace": client.workspace,
                     "operation_id": operation_id, "request_sha256": digest(request),
                     "state": "prepared"}
            self.state["tasks"][name] = prior
            self.save()
        try:
            task = client.task(prior["id"])
        except api_error as error:
            # An authoritative missing original task can safely use the SAME
            # frozen operation ID; submit() binds and deduplicates it natively.
            if error.status != 404 or error.code not in {"SOURCE_MISSING", "TASK_MISSING"}:
                raise
            require(not prior.get("accepted"), "The accepted native task is missing; reconnect its original operator state.")
            prior["state"] = "submitting"
            self.save()
            task = client.submit(request)
        require(task.get("operation_id") == operation_id and task.get("action") == action
                and task.get("workspace") == client.workspace and task.get("payload") == payload,
                "The native task handle belongs to another original operation.")
        prior.update(id=task["id"], accepted=True, state=task["state"])
        self.save()
        atomic_json(self.root / (name + "-task.json"), task)
        if task["state"] == "interrupted" or (resume_failed and task["state"] == "failed"):
            prior["state"] = "resuming-original"
            self.save()
            task = client.resume(task["id"])
            prior["state"] = task["state"]
            self.save()
        deadline = time.monotonic() + seconds
        while task["state"] in {"queued", "running"}:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.phase(name + "-active", task_id=task["id"], task_state=task["state"])
                raise TimeoutError("The original native task is still active. Reinvoke this exact command to continue observing it.")
            task = client.wait(task["id"], seconds=min(20, remaining), interval=1)
            prior["state"] = task["state"]
            atomic_json(self.root / (name + "-task.json"), task)
            self.save()
        require(task["state"] == "complete",
                "Original " + name + " task " + task["id"] + ": " + json.dumps(task.get("error") or task["state"]))
        self.phase(name + "-complete", task_id=task["id"])
        return task


def receive_tickets(client, tickets, target):
    """Use the maintained checksum/range receiver and keep ordinary filenames."""
    target.mkdir(parents=True, exist_ok=True)
    output = []
    for i, ticket in enumerate(tickets, 1):
        filename = ticket.get("filename") or "retained-file"
        require(Path(filename).name == filename and filename not in {".", ".."}
                and not any(c in filename for c in "\\/\r\n\x00"),
                "A native ticket has an unsafe original filename.")
        destination = target / (str(i).zfill(4) + "__" + filename)
        result = client.download(ticket, destination)
        output.append({**result, "filename": filename,
                       "label": ticket.get("label") or filename,
                       "kind": ticket.get("kind"), "role": ticket.get("role")})
    atomic_json(target / "files.json", output)
    return output


def cold_verify(args):
    expected = read_json(args.expect)
    from model.workspace import Workspace
    workspace = Workspace(args.received_workspace)
    require(workspace.project["id"] == expected["project_id"], "Fresh receiving opened another project.")
    path, source = workspace.source_file(expected["collection_id"], expected["source_id"])
    require(file_digest(path) == expected["original_sha256"], "Fresh receiving changed the original workbook.")
    require(not (workspace.root / "client-source-intake").exists(),
            "The selected-source receiving unexpectedly includes the donor intake tree.")
    preview = retained_table_preview(workspace, source)
    require(projection(preview) == expected["projection"], "Fresh receiving changed original worksheet cells or choices.")
    from model.study_transfer import verify_received_studies
    verify_received_studies(workspace)
    result = {"schema": SCHEMA, "state": "complete", "project_id": workspace.project["id"],
              "collection_id": expected["collection_id"], "source_id": expected["source_id"],
              "original_sha256": file_digest(path), "projection": projection(preview),
              "application": str(APPLICATION), "workspace": str(workspace.root)}
    atomic_json(args.result, result)
    print(json.dumps({"phase": "cold-reopen-complete", "source_id": source["id"]}), flush=True)
    return 0


def start_page(root, state, source_info, downloads, archive):
    part = source_info
    links = []
    for row in downloads + [archive]:
        path = Path(row["path"]).resolve()
        relative = path.relative_to(root).as_posix()
        links.append('<li><a href="' + html.escape(quote(relative, safe="/"), quote=True) + '">' +
                     html.escape(str(row.get("label") or row.get("filename") or path.name)) + "</a></li>")
    text = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved source reference</title><style>
body{font:16px system-ui,sans-serif;color:#222;background:white;margin:2rem auto;padding:0 1rem;max-width:60rem}
h1{font-size:1.6rem}p,li{line-height:1.55}a{color:inherit;overflow-wrap:anywhere}li{margin:.7rem 0}
</style><h1>""" + html.escape(state["identity"]["title"]) + "</h1><p>" + html.escape(
        "Original worksheet: " + str(part.get("original_worksheet") or "delimited table") +
        ". Header row: " + str(part.get("original_header_row")) +
        ". Native preview rows: " + str(len(part.get("sample_records", []))) +
        ". Original columns: " + str(len(part.get("original_fields", []))) +
        ". The original workbook and reviewed source meaning are retained together.") + "</p><ul>" + "".join(links) + """</ul>
<p>The selected source package reopens independently with its original worksheet cells, reading choices and source identity.
Open the readable report and original workbook above, then use the received project in the maintained workbench.</p></html>"""
    atomic_bytes(root / "START_HERE.html", text.encode("utf-8"))


def run(args):
    output = args.output.expanduser().resolve()
    require(output != APPLICATION and APPLICATION not in output.parents and output not in APPLICATION.parents,
            "Keep receiving output separate from the maintained application.")
    output.mkdir(parents=True, exist_ok=True)
    inspection, reviewed = documents(args)
    original, selected, file, part = original_choice(inspection, reviewed, args)
    identity = {"project_id": inspection["project_id"], "inspection_id": inspection["id"],
                "inspection_sha256": digest(inspection), "reviewed_selection_sha256": digest(reviewed),
                "original_selection": original, "selection": selected, "title": args.title}
    Client, APIError = api_class()
    with held(output / ".source-reference.lock", blocking=False):
        course = Course(output, identity)
        atomic_json(output / "original-inspection.json", inspection, immutable=True)
        atomic_json(output / "original-reviewed-selection.json", reviewed, immutable=True)
        atomic_json(output / "reference-selection.json", selected, immutable=True)
        client = Client(args.connection, workspace=args.workspace, timeout=60)
        who = client.request("/api/whoami")
        candidates = [w for w in who.get("workspaces", []) if w.get("project_id") == inspection["project_id"]
                      and w.get("available", True)]
        pinned = course.state.get("source_workspace")
        if pinned:
            require(any(w["id"] == pinned for w in candidates), "Reconnect the original received Gura workspace.")
            client = Client(args.connection, workspace=pinned, timeout=60)
        elif args.workspace:
            require(any(w["id"] == client.workspace for w in candidates), "The selected workspace is not the original inspection project.")
        elif len(candidates) == 1:
            client = Client(args.connection, workspace=candidates[0]["id"], timeout=60)
        elif len(candidates) > 1:
            raise ValueError("Select the intended already-registered original project with --workspace.")
        else:
            require(args.workspace_archive, "Provide the complete original Workspace archive to this existing operator.")
            archive_sha = file_digest(args.workspace_archive)
            if args.expected_workspace_sha256:
                require(archive_sha == args.expected_workspace_sha256, "The original Workspace archive hash differs.")
            uploaded = course.state.get("original_upload")
            if uploaded is None:
                uploaded = client.upload(args.workspace_archive)
                require(uploaded["sha256"] == archive_sha, "The original workspace upload identity differs.")
                course.save(original_upload=uploaded)
            require(uploaded["sha256"] == archive_sha, "Resume the same original workspace archive.")
            restored = course.task(client, APIError, "restore-original", "workspace.restore",
                                   {"upload_id": uploaded["id"]}, args.seconds, args.resume_failed)
            require(restored["result"]["project"]["id"] == inspection["project_id"],
                    "The restored archive contains another original project.")
            client = Client(args.connection, workspace=restored["result"]["workspace_key"], timeout=60)
        course.save(source_workspace=client.workspace)
        remote = client.query("/api/client-source/result", id=inspection["id"])
        require(undecorated(remote) == inspection, "The native completed inspection differs from its retained original.")
        commit = course.task(client, APIError, "save-reference", "client-source.commit",
                             {"inspection_id": inspection["id"], "title": args.title, "selections": [selected]},
                             args.seconds, args.resume_failed)
        result = client.query("/api/client-source/result", id=commit["id"])
        require(result.get("state") == "complete" and len(result.get("source_ids", [])) == 1,
                "The original reference task did not return exactly one selected source.")
        collection_id, source_id = result["source_collection_id"], result["source_ids"][0]
        info = client.query("/api/source-info", collection=collection_id, source=source_id)
        expected_projection = check_preview(info, file, part, selected)
        atomic_json(output / "source-info.json", info)
        downloads = receive_tickets(client, result["_downloads"], output / "source-files")
        original_file = client.download(info["download"], output / file["filename"])
        require(original_file["sha256"] == file["original"]["sha256"], "The downloaded original workbook changed.")
        downloads.append({**original_file, "label": "Original " + file["filename"]})
        require(any(row.get("role") == "source-inspection-report" for row in downloads),
                "The current native report ticket is missing.")
        selection = {"title": args.title, "roots": [{"kind": "sources", "id": collection_id}],
                     "include_related_results": False}
        exported = course.task(client, APIError, "export-reference", "study.export", selection,
                               args.seconds, args.resume_failed)
        tickets = exported.get("_downloads", [])
        require(len(tickets) == 1, "The selected Study did not return its single original archive.")
        archive = client.download(tickets[0], output / "saved-source-reference.study.zip")
        archive["label"] = "Editable saved source package"
        uploaded = course.state.get("study_upload")
        if uploaded is None:
            uploaded = client.upload(archive["path"])
            require(uploaded["sha256"] == archive["sha256"], "The selected Study upload differs from its download.")
            course.save(study_upload=uploaded)
        require(uploaded["sha256"] == archive["sha256"], "Resume the same original source Study.")
        received = course.task(client, APIError, "restore-reference", "workspace.restore",
                               {"upload_id": uploaded["id"]}, args.seconds, args.resume_failed)["result"]
        other = Client(args.connection, workspace=received["workspace_key"], timeout=60)
        reopened = other.query("/api/source-info", collection=collection_id, source=source_id)
        require(check_preview(reopened, file, part, selected) == expected_projection,
                "The received source preview differs from the donor's selected original.")
        atomic_json(output / "received-source-info.json", reopened)
        expect = {"project_id": inspection["project_id"], "collection_id": collection_id,
                  "source_id": source_id, "original_sha256": file["original"]["sha256"],
                  "projection": expected_projection}
        atomic_json(output / "cold-expect.json", expect, immutable=True)
        target = Path(received["application"]) / "source_tools" / "receive_saved_source_reference.py"
        require(target.is_file(), "The selected Study must include this maintained receiving command.")
        command = [sys.executable, "-I", "-B", str(target), "--verify-received",
                   "--received-workspace", received["workspace"], "--expect", str(output / "cold-expect.json"),
                   "--result", str(output / "cold-reopen.json")]
        with (output / "cold-reopen.log").open("ab") as log:
            outcome = subprocess.run(command, cwd=received["application"], stdout=log, stderr=subprocess.STDOUT)
        require(outcome.returncode == 0, "Fresh source receiving failed; read cold-reopen.log.")
        cold = read_json(output / "cold-reopen.json")
        require(cold.get("state") == "complete" and cold.get("projection") == expected_projection,
                "The fresh original receiver did not return matching source data.")
        course.save(collection_id=collection_id, source_id=source_id,
                    downloads=downloads, source_package=archive, receiving=received,
                    cold_reopen=cold, phase="complete")
        start_page(output, course.state, info, downloads, archive)
        print("Saved source reference complete: " + str(output / "START_HERE.html"), flush=True)
        return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", type=Path, help="Existing private native opening JSON.")
    parser.add_argument("--workspace", help="Existing registered original Workspace key, when ambiguous.")
    parser.add_argument("--inspection", type=Path)
    parser.add_argument("--reviewed-selection", type=Path)
    parser.add_argument("--original-delivery", type=Path, help="Original ZIP containing inspection and reviewed-selection JSON.")
    parser.add_argument("--inspection-id")
    parser.add_argument("--file-index", type=int)
    parser.add_argument("--part-index", type=int)
    parser.add_argument("--title")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--workspace-archive", type=Path, help="Original complete Workspace, only if not already registered.")
    parser.add_argument("--expected-workspace-sha256")
    parser.add_argument("--seconds", type=float, default=900)
    parser.add_argument("--resume-failed", action="store_true", help="After repairing the actual cause, resume each same failed task once.")
    parser.add_argument("--verify-received", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--received-workspace", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--expect", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--result", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.verify_received:
        require(args.received_workspace and args.expect and args.result, "Keep the complete original cold-reopen arguments.")
        return cold_verify(args)
    require(args.connection and args.inspection_id and args.title and args.output
            and args.file_index is not None and args.part_index is not None,
            "Supply connection, original inspection ID, file/part positions, title and output.")
    require(args.seconds > 0, "Use a positive task observation window.")
    require(not (args.original_delivery and (args.inspection or args.reviewed_selection)),
            "Select the original ZIP or the two exact JSON files.")
    return run(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
