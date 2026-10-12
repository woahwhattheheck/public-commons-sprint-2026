#!/usr/bin/env python3
"""MIT. Operate a complete PMEL programme through the original IATI engines."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import html
import importlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile

PLAN = "tjlabs.pmel.programme-plan.v1"
RUN = "tjlabs.pmel.programme-run.v1"
RUNTIME = "tjlabs.pmel.runtime-selection.v1"
HANDOVER = "tjlabs.pmel.programme-handover.v1"
SOURCE_FILES = ("programme.py", "START.py", "GUIDE.md", "LICENSE")
ALIAS = re.compile(r"[A-Za-z][A-Za-z0-9._-]{0,47}\Z")
REQUEST = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,89}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
MAX_JSON = 64 * 1024 * 1024


class ProgrammeError(ValueError):
    pass


def check(condition, message):
    if not condition:
        raise ProgrammeError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        check(key not in result, "Duplicate JSON field: " + key)
        result[key] = value
    return result


def read_json(path):
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_JSON + 1)
    check(len(data) <= MAX_JSON, "JSON exceeds the original 64 MiB input capacity")
    return json.loads(data, object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ProgrammeError("Non-finite JSON number: " + value)))


def fields(value, allowed, required=(), label="object"):
    check(isinstance(value, dict), label + " must be an object")
    check(not set(value) - set(allowed),
          label + " has unsupported fields: " + ", ".join(sorted(set(value) - set(allowed))))
    check(set(required) <= set(value), label + " lacks required fields")
    return value


def alias(value, label="alias"):
    check(isinstance(value, str) and ALIAS.fullmatch(value), "Invalid " + label)
    return value


def relative(value):
    check(isinstance(value, str) and value and "\\" not in value,
          "Use a nonempty portable relative member path")
    path = PurePosixPath(value)
    check(not path.is_absolute() and all(p not in {"", ".", ".."} for p in value.split("/")),
          "Member path leaves its selected directory")
    return path.as_posix()


def absolute(value):
    path = Path(value).expanduser()
    check(path.is_absolute(), "Choose an absolute directory or file: " + str(path))
    return path


def private_directory(path, *, create=False):
    path = absolute(path)
    if create:
        path.mkdir(mode=0o700)
    check(path.is_dir() and not path.is_symlink() and path.resolve() == path,
          "Choose an original directory without aliases: " + str(path))
    info = path.stat()
    if os.name == "posix":
        check(info.st_uid == os.getuid() and not info.st_mode & 0o077,
              "Keep the selected directory private and operator-owned: " + str(path))
    return path


def identity(path, *, links=1):
    path = Path(path)
    before = path.lstat()
    check(stat.S_ISREG(before.st_mode) and before.st_nlink == links,
          "Select an original regular file: " + str(path))
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    h = hashlib.sha256()
    size = 0
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        check((before.st_dev, before.st_ino) == (opened.st_dev, opened.st_ino),
              "The selected file was replaced before reading: " + str(path))
        while block := stream.read(1024 * 1024):
            size += len(block)
            h.update(block)
        finished = os.fstat(stream.fileno())
    after = path.lstat()
    stamp = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
                           value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    check(stamp(before) == stamp(opened) == stamp(finished) == stamp(after) and size == before.st_size,
          "The selected file changed while being read: " + str(path))
    return {"bytes": size, "sha256": h.hexdigest()}


def completed_output(path, expected, prefix):
    """Recover only this exact completed file's remaining owned temporary link."""
    path = Path(path)
    info = path.lstat()
    if info.st_nlink == 1:
        check(identity(path) == expected, "An existing completed output differs: " + str(path))
        return
    private_directory(path.parent)
    check(stat.S_ISREG(info.st_mode) and info.st_nlink == 2 and
          info.st_uid == os.getuid() and not info.st_mode & 0o077,
          "An existing output has unrelated links or ownership: " + str(path))
    aliases = []
    for candidate in path.parent.iterdir():
        if candidate.name == path.name or not candidate.name.startswith(prefix):
            continue
        observed = candidate.lstat()
        if (observed.st_dev, observed.st_ino) == (info.st_dev, info.st_ino):
            check(stat.S_ISREG(observed.st_mode) and observed.st_uid == os.getuid(),
                  "The retained temporary output is not an original owned file")
            aliases.append(candidate)
    check(len(aliases) == 1 and identity(path, links=2) == expected,
          "The completed output lacks its exact owned temporary link: " + str(path))
    temporary = aliases[0]
    current = temporary.lstat()
    check((current.st_dev, current.st_ino, current.st_nlink) == (info.st_dev, info.st_ino, 2),
          "The retained temporary output changed before completion")
    temporary.unlink()
    sync_dir(path.parent)
    check(identity(path) == expected, "The recovered completed output differs: " + str(path))


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def immutable_bytes(path, data):
    """Publish this exact completed file without replacing any earlier output."""
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        completed_output(path, {"bytes": len(data), "sha256": digest(data)}, ".programme-write-")
        return path
    descriptor, name = tempfile.mkstemp(prefix=".programme-write-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            completed_output(path, {"bytes": len(data), "sha256": digest(data)}, ".programme-write-")
        sync_dir(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def immutable_json(path, value):
    return immutable_bytes(path, encoded(value))


def copy_original(source, destination, expected):
    check(identity(source) == expected, "Selected source identity differs: " + str(source))
    destination = Path(destination)
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        completed_output(destination, expected, ".programme-copy-")
        return
    descriptor, name = tempfile.mkstemp(prefix=".programme-copy-", dir=destination.parent)
    temporary = Path(name)
    try:
        with Path(source).open("rb") as inp, os.fdopen(descriptor, "wb") as out:
            os.fchmod(out.fileno(), 0o600)
            shutil.copyfileobj(inp, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        check(identity(temporary) == expected, "Source changed during complete copy")
        try:
            os.link(temporary, destination)
        except FileExistsError:
            completed_output(destination, expected, ".programme-copy-")
        sync_dir(destination.parent)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def operation_lock(root):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    private_directory(root)
    path = root / "operation.lock"
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        check(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid(),
              "Original operation lock is not an owned regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ProgrammeError("This same programme operation is already running") from error
        yield
    finally:
        os.close(descriptor)


def load_runtime(iati):
    iati = absolute(iati).resolve(strict=True)
    check((iati / "iati_workspace.py").is_file() and (iati / "results" / "workspace.py").is_file(),
          "Select the complete original IATI runtime with Results")
    for name in ("iati_workspace", "results"):
        existing = sys.modules.get(name)
        if existing is not None and getattr(existing, "__file__", None):
            check(Path(existing.__file__).resolve().is_relative_to(iati),
                  "Another IATI source selection is already loaded in this process")
    sys.path.insert(0, str(iati))
    module = importlib.import_module("iati_workspace")
    check(Path(module.__file__).resolve() == iati / "iati_workspace.py",
          "Python loaded a different original IATI source")
    return module.IatiWorkspace



@contextmanager
def programme_workspace(Workspace, workspace, opened_workspace=None):
    """Share the caller's actual native host lifetime, or own one CLI lifetime."""
    selected = absolute(workspace)
    if opened_workspace is None:
        with Workspace(str(selected)) as ws:
            yield ws
    else:
        check(isinstance(opened_workspace, Workspace) and
              opened_workspace.root.resolve(strict=True) == selected.resolve(strict=True),
              "Use the host's existing original Workspace for this same programme")
        yield opened_workspace

def source_inputs(plan, parent):
    rows, names = [], set()
    check(isinstance(plan["sources"], list) and plan["sources"], "Select original source files")
    for row in plan["sources"]:
        fields(row, ("alias", "path", "bytes", "sha256", "label", "provenance"),
               ("alias", "path", "bytes", "sha256", "provenance"), "source")
        name = alias(row["alias"], "source alias")
        check(name not in names, "Duplicate source alias")
        names.add(name)
        check(type(row["bytes"]) is int and row["bytes"] > 0 and
              isinstance(row["sha256"], str) and SHA.fullmatch(row["sha256"]),
              "Retain the exact complete source byte count and SHA256")
        check(isinstance(row["provenance"], dict) and row["provenance"],
              "Retain the actual source representation and provenance")
        path = Path(row["path"]).expanduser()
        if not path.is_absolute():
            path = parent / path
        path = path.absolute()
        check(identity(path) == {"bytes": row["bytes"], "sha256": row["sha256"]},
              "Original source differs from the selected input: " + name)
        rows.append((row, path))
    return rows


def validate_plan(plan):
    fields(plan, ("schema", "operationId", "programme", "sources", "attachments", "publisherSteps",
                  "editions", "comparisons"),
           ("schema", "operationId", "programme", "sources", "editions"), "programme plan")
    check(plan["schema"] == PLAN, "Unsupported programme plan schema")
    check(isinstance(plan["operationId"], str) and REQUEST.fullmatch(plan["operationId"]),
          "Use a stable original operationId of at most 90 ASCII characters")
    fields(plan["programme"], ("id", "name", "activityIds", "notes", "inventorySource"),
           ("id", "name", "activityIds"), "programme selection")
    check(all(isinstance(plan["programme"][key], str) and plan["programme"][key].strip()
              for key in ("id", "name")), "Name the actual selected programme or activity")
    activities = plan["programme"]["activityIds"]
    check(isinstance(activities, list) and activities and
          all(isinstance(x, str) and x.strip() for x in activities) and len(activities) == len(set(activities)),
          "List the complete selected activity identities without duplicates")
    check(isinstance(plan["editions"], list) and plan["editions"],
          "Select at least one complete reporting edition")
    seen = set()
    for item in plan["editions"]:
        fields(item, ("alias", "after", "project", "sourceRefs", "definition"),
               ("alias", "sourceRefs", "definition"), "reporting edition")
        name = alias(item["alias"], "edition alias")
        check(name not in seen, "Duplicate edition alias")
        check(not ("after" in item and "project" in item), "Choose a prior edition or an existing project")
        if "after" in item:
            check(item["after"] in seen, "An edition must follow an earlier selected edition")
        if "project" in item:
            fields(item["project"], ("id", "revision"), ("id", "revision"), "existing project")
            check(type(item["project"]["revision"]) is int and item["project"]["revision"] > 0,
                  "Choose an original positive project revision")
        seen.add(name)
        check(isinstance(item["sourceRefs"], list) and item["sourceRefs"],
              "Select the complete original sources for each edition")
        check(isinstance(item["definition"], dict) and
              not {"requestId", "id", "expectedRevision", "sources"} & set(item["definition"]),
              "Edition definition contains fields owned by the original operation")
        selection = item["definition"].get("selection", {})
        check(isinstance(selection, dict), "Original Results selection must be an object")
        selected_activities = selection.get("activityIds", activities)
        check(isinstance(selected_activities, list) and set(selected_activities) == set(activities),
              "Every edition must select the entire agreed activity inventory")
    publishers = plan.get("publisherSteps", [])
    check(isinstance(publishers, list), "publisherSteps must be a list")
    seen = set()
    for item in publishers:
        fields(item, ("alias", "action", "after", "project", "sourceRef", "input"),
               ("alias", "action", "input"), "publisher step")
        name = alias(item["alias"], "publisher step alias")
        check(name not in seen, "Duplicate publisher step alias")
        check(item["action"] in {"create", "correct", "candidate"},
              "Programme operations support original publisher create, correct and candidate")
        check(not ("after" in item and "project" in item), "Choose one original publisher predecessor")
        if "after" in item:
            check(item["after"] in seen, "A publisher step must follow an earlier selected step")
        check(isinstance(item["input"], dict) and
              not {"id", "expectedRevision", "requestId", "sourceId", "expectedPreviewSha256"} &
              set(item["input"]), "Publisher input contains fields owned by the original operation")
        if item["action"] == "create":
            check("after" not in item and "project" not in item and "sourceRef" in item,
                  "A publisher create selects its original source")
            check(set(item["input"].get("activityIds", [])) == set(activities),
                  "Publisher project must include the complete selected activity inventory")
        else:
            check("after" in item or "project" in item, "Select the original publisher edition")
        if item["action"] == "candidate":
            check("sourceRef" in item, "A candidate selects an actual retained replacement source")
        seen.add(name)
    comparisons = plan.get("comparisons", [])
    check(isinstance(comparisons, list), "comparisons must be a list")
    comparison_names = set()
    for item in comparisons:
        fields(item, ("alias", "before", "after", "pairs"), ("alias", "before", "after"), "comparison")
        name = alias(item["alias"], "comparison alias")
        check(name not in comparison_names, "Duplicate comparison alias")
        comparison_names.add(name)
        check(item["before"] in {e["alias"] for e in plan["editions"]} and
              item["after"] in {e["alias"] for e in plan["editions"]},
              "Compare actual selected reporting editions")
    attachments = plan.get("attachments", [])
    check(isinstance(attachments, list), "attachments must be a list")
    attachment_names = set()
    for row in attachments:
        fields(row, ("alias", "path", "bytes", "sha256", "label"),
               ("alias", "path", "bytes", "sha256"), "programme attachment")
        name = alias(row["alias"], "attachment alias")
        check(name not in attachment_names, "Duplicate programme attachment alias")
        attachment_names.add(name)
        check(isinstance(row["path"], str) and type(row["bytes"]) is int and row["bytes"] >= 0 and
              isinstance(row["sha256"], str) and SHA.fullmatch(row["sha256"]),
              "Retain the exact original attachment identity")
    return plan


def source_reference(name, sources, publishers):
    check(isinstance(name, str) and ":" in name, "Use source:alias or publisher:alias")
    kind, selected = name.split(":", 1)
    if kind == "source":
        check(selected in sources, "Unknown original source: " + selected)
        return sources[selected]["id"]
    if kind == "publisher":
        check(selected in publishers, "Unknown original publisher candidate: " + selected)
        return publishers[selected]["candidateSource"]
    raise ProgrammeError("Unknown source reference kind: " + kind)


def predecessor(item, records):
    if "after" in item:
        check(item["after"] in records, "Original predecessor is missing")
        previous = records[item["after"]]
        return {"id": previous["id"], "expectedRevision": previous["revision"]}
    if "project" in item:
        value = fields(item["project"], ("id", "revision"), ("id", "revision"), "original project")
        return {"id": value["id"], "expectedRevision": value["revision"]}
    return {}


def native_input(root, kind, name, make):
    path = root / "inputs" / (kind + "-" + name + ".json")
    if path.exists():
        return read_json(path)
    value = make()
    immutable_json(path, value)
    return value


def run_programme(workspace, iati, plan_path, *, opened_workspace=None):
    plan_path = absolute(plan_path)
    plan = validate_plan(read_json(plan_path))
    original_sources = source_inputs(plan, plan_path.parent)
    attachments = []
    for row in plan.get("attachments", []):
        path = Path(row["path"]).expanduser()
        if not path.is_absolute():
            path = plan_path.parent / path
        expected = {"bytes": row["bytes"], "sha256": row["sha256"]}
        check(identity(path) == expected, "Programme attachment differs: " + row["alias"])
        attachments.append((row, path, expected))
    Workspace = load_runtime(iati)
    with programme_workspace(Workspace, workspace, opened_workspace) as ws:
        root = ws.root / "programme-operations" / digest(plan["operationId"].encode())
        with operation_lock(root):
            inventory = ws.results.inventory()
            selection = {"schema": PLAN, "workspaceId": inventory["workspaceId"], "plan": plan}
            immutable_json(root / "original-plan.json", selection)
            sources, publishers, editions, comparisons = {}, {}, {}, {}
            for row, path, expected in attachments:
                extension = path.suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,12}", path.suffix) else ".bin"
                copy_original(path, root / "attachments" / (row["alias"] + extension), expected)
            for row, path in original_sources:
                with path.open("rb") as stream:
                    retained = ws.add_source(stream, row.get("label", row["alias"]), path.name)
                check(retained["id"] == row["sha256"] and retained["bytes"] == row["bytes"],
                      "Native retained source differs from its selected bytes")
                projection = ws.results.project_source(retained["id"])
                sources[row["alias"]] = retained
                immutable_json(root / "sources" / (row["alias"] + ".json"),
                               {"source": retained, "projection": projection, "provenance": row["provenance"]})
            for item in plan.get("publisherSteps", []):
                name = item["alias"]
                def prepare_publisher():
                    value = {**item["input"], **predecessor(item, publishers),
                             "requestId": plan["operationId"] + ":publisher:" + name}
                    if "sourceRef" in item:
                        value["sourceId"] = source_reference(item["sourceRef"], sources, publishers)
                    if item["action"] == "correct":
                        preview = ws.publishing.preview(value["id"], value["patches"], value["expectedRevision"])
                        value["expectedPreviewSha256"] = preview["previewSha256"]
                        immutable_json(root / "previews" / (name + ".json"), preview)
                    return value
                value = native_input(root, "publisher", name, prepare_publisher)
                method = {"create": ws.publishing.create, "correct": ws.publishing.correct,
                          "candidate": ws.publishing.replace_candidate}[item["action"]]
                publishers[name] = method(value)
                immutable_json(root / "publishers" / (name + ".json"), publishers[name])
            for item in plan["editions"]:
                name = item["alias"]
                def prepare_edition():
                    definition = dict(item["definition"])
                    definition["selection"] = {**definition.get("selection", {}),
                                               "activityIds": plan["programme"]["activityIds"]}
                    definition["sources"] = [source_reference(x, sources, publishers) for x in item["sourceRefs"]]
                    preview = ws.results.preview(definition)
                    covered = {activity["activityId"] for activity in preview["report"]["activities"]}
                    missing = sorted(set(plan["programme"]["activityIds"]) - covered)
                    check(not missing, "This reporting edition lacks agreed activities: " + ", ".join(missing))
                    immutable_json(root / "previews" / ("results-" + name + ".json"), preview)
                    return {**definition, **predecessor(item, editions),
                            "requestId": plan["operationId"] + ":results:" + name}
                value = native_input(root, "results", name, prepare_edition)
                editions[name] = ws.results.save(value)
                immutable_json(root / "editions" / (name + ".json"), editions[name])
            for item in plan.get("comparisons", []):
                name = item["alias"]
                before, after = editions[item["before"]], editions[item["after"]]
                check(before["id"] == after["id"], "A Results comparison selects editions of the same project")
                value = native_input(root, "comparison", name, lambda: {
                    "requestId": plan["operationId"] + ":comparison:" + name, "id": before["id"],
                    "beforeRevision": before["revision"], "afterRevision": after["revision"],
                    "pairs": item.get("pairs", [])})
                comparisons[name] = ws.results.compare(value)
                immutable_json(root / "comparisons" / (name + ".json"), comparisons[name])
            result = {"schema": RUN, "operationId": plan["operationId"],
                      "workspaceId": inventory["workspaceId"], "planSha256": digest(encoded(plan)),
                      "programme": plan["programme"], "sources": sources,
                      "publisherSteps": publishers, "editions": editions, "comparisons": comparisons}
            immutable_json(root / "result.json", result)
            return {"resultFile": str(root / "result.json"), "operationId": plan["operationId"],
                    "workspaceId": inventory["workspaceId"],
                    "editions": {name: {"id": row["id"], "revision": row["revision"],
                                       "sha256": row["sha256"], "counts": row["report"]["counts"]}
                                 for name, row in editions.items()},
                    "publisherSteps": len(publishers), "comparisons": len(comparisons)}


def select_programme(workspace, iati, selection_path, *, opened_workspace=None):
    """Capture the staff UI's actual saved editions without another native save."""
    selection_path = absolute(selection_path)
    selection = read_json(selection_path)
    fields(selection, ("schema", "operationId", "programme", "editions", "publisherProjects", "attachments", "notes"),
           ("schema", "operationId", "programme", "editions"), "saved programme selection")
    check(selection["schema"] == "tjlabs.pmel.programme-selection.v1",
          "Unsupported saved programme selection")
    check(isinstance(selection["operationId"], str) and REQUEST.fullmatch(selection["operationId"]),
          "Use a stable original operationId of at most 90 ASCII characters")
    programme = fields(selection["programme"], ("id", "name", "activityIds", "notes", "inventorySource"),
                       ("id", "name", "activityIds"), "programme inventory")
    check(all(isinstance(programme[key], str) and programme[key].strip() for key in ("id", "name")),
          "Name the actual selected programme")
    activities = programme["activityIds"]
    check(isinstance(activities, list) and activities and
          all(isinstance(value, str) and value.strip() for value in activities) and
          len(activities) == len(set(activities)), "Select the complete actual activity inventory")
    check(isinstance(selection["editions"], list) and selection["editions"],
          "Select the actual saved reporting editions")
    for key in ("editions", "publisherProjects"):
        values = selection.get(key, [])
        check(isinstance(values, list), key + " must be a list")
        names = set()
        for row in values:
            fields(row, ("alias", "id", "revision", "sha256"), ("alias", "id", "revision"), "native edition")
            name = alias(row["alias"], "native edition alias")
            check(name not in names, "Duplicate native edition alias")
            names.add(name)
            check(isinstance(row["id"], str) and row["id"] and
                  type(row["revision"]) is int and row["revision"] > 0,
                  "Select a real native project and positive original revision")
            if "sha256" in row:
                check(isinstance(row["sha256"], str) and SHA.fullmatch(row["sha256"]),
                      "Select the actual native edition SHA256")
    attachments = []
    check(isinstance(selection.get("attachments", []), list), "attachments must be a list")
    attachment_names = set()
    for row in selection.get("attachments", []):
        fields(row, ("alias", "path", "bytes", "sha256", "label"),
               ("alias", "path", "bytes", "sha256"), "programme attachment")
        name = alias(row["alias"], "attachment alias")
        check(name not in attachment_names, "Duplicate supporting file alias")
        attachment_names.add(name)
        check(isinstance(row["path"], str), "Select an actual original supporting file")
        path = Path(row["path"]).expanduser()
        if not path.is_absolute():
            path = selection_path.parent / path
        expected = {"bytes": row["bytes"], "sha256": row["sha256"]}
        check(identity(path) == expected, "Supporting file differs from its original identity")
        attachments.append((row, path, expected))
    Workspace = load_runtime(iati)
    with programme_workspace(Workspace, workspace, opened_workspace) as ws:
        workspace_id = ws.results.inventory()["workspaceId"]
        root = ws.root / "programme-operations" / digest(selection["operationId"].encode())
        with operation_lock(root):
            original = {"schema": "tjlabs.pmel.programme-selection.v1",
                        "workspaceId": workspace_id, "plan": selection}
            immutable_json(root / "original-plan.json", original)
            sources, editions, publishers, comparisons = {}, {}, {}, {}
            for row, path, expected in attachments:
                extension = path.suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,12}", path.suffix) else ".bin"
                copy_original(path, root / "attachments" / (row["alias"] + extension), expected)
            for row in selection["editions"]:
                edition = ws.results.project(row["id"], row["revision"])
                check("sha256" not in row or edition["sha256"] == row["sha256"],
                      "The selected saved reporting edition differs")
                rebuilt = ws.results.report(row["id"], row["revision"])
                check(rebuilt["report"]["reportSha256"] == edition["report"]["reportSha256"],
                      "The original saved report does not rebuild")
                covered = {activity["activityId"] for activity in rebuilt["report"]["activities"]}
                missing = sorted(set(activities) - covered)
                check(not missing, "This saved edition lacks agreed activities: " + ", ".join(missing))
                editions[row["alias"]] = edition
                immutable_json(root / "editions" / (row["alias"] + ".json"), edition)
                for source_id in edition["definition"]["sources"]:
                    sources[source_id] = ws.source(source_id)
                if row["id"] not in comparisons:
                    comparisons[row["id"]] = native_input(root, "selected-comparisons", row["alias"],
                                                         lambda: ws.results.comparisons(row["id"]))
            for row in selection.get("publisherProjects", []):
                edition = ws.publishing.project(row["id"], row["revision"])
                check("sha256" not in row or edition.get("sha256") == row["sha256"],
                      "The selected original publisher edition differs")
                publishers[row["alias"]] = edition
                immutable_json(root / "publishers" / (row["alias"] + ".json"), edition)
            result = {"schema": RUN, "selectionMode": "existing-native-editions",
                      "operationId": selection["operationId"], "workspaceId": workspace_id,
                      "planSha256": digest(encoded(selection)), "programme": programme,
                      "sources": sources, "publisherSteps": publishers,
                      "editions": editions, "comparisons": comparisons}
            immutable_json(root / "result.json", result)
            return {"resultFile": str(root / "result.json"), "operationId": selection["operationId"],
                    "workspaceId": workspace_id, "nativeSaves": 0,
                    "editions": {name: {"id": row["id"], "revision": row["revision"],
                                       "sha256": row["sha256"], "counts": row["report"]["counts"]}
                                 for name, row in editions.items()}}


def inspect_source(workspace, iati, source, programme_id, programme_name, activity_ids, provenance, out,
                   *, opened_workspace=None):
    source = absolute(source)
    source_identity = identity(source)
    out = private_directory(out, create=not Path(out).exists())
    Workspace = load_runtime(iati)
    with programme_workspace(Workspace, workspace, opened_workspace) as ws:
        with source.open("rb") as stream:
            retained = ws.add_source(stream, programme_name, source.name)
        projection = ws.results.project_source(retained["id"])
        definition = {"name": programme_name, "sources": [retained["id"]],
                      "selection": {"activityIds": activity_ids},
                      "review": {"status": "draft", "reviewer": "", "note": ""},
                      "notes": "Original programme intake; review the native indicator, period and dimension identities."}
        preview = ws.results.preview(definition)
        immutable_json(out / "native-preview.json", preview)
        immutable_json(out / "source-projection.json", projection)
        plan = {"schema": PLAN, "operationId": "programme-" + digest(encoded({
            "source": retained["id"], "activities": activity_ids, "programme": programme_id}))[:24],
                "programme": {"id": programme_id, "name": programme_name, "activityIds": activity_ids,
                              "notes": "Retain the agreed complete programme inventory and its authority here."},
                "sources": [{"alias": "original", "path": str(source), **source_identity,
                             "label": programme_name, "provenance": read_json(absolute(provenance))}],
                "publisherSteps": [], "editions": [{"alias": "baseline", "sourceRefs": ["source:original"],
                    "definition": {k: v for k, v in definition.items() if k != "sources"}}], "comparisons": []}
        immutable_json(out / "programme-plan.json", plan)
        return {"directory": str(out), "source": retained, "projection": projection,
                "counts": preview["report"]["counts"], "plan": str(out / "programme-plan.json")}


def selected_runtime(manifest_path, source_root):
    manifest = read_json(manifest_path)
    fields(manifest, ("schema", "iatiPath", "selection", "files"), ("schema", "iatiPath", "selection", "files"),
           "runtime selection")
    check(manifest["schema"] == RUNTIME, "Unsupported runtime selection schema")
    iati_path = relative(manifest["iatiPath"])
    check(isinstance(manifest["selection"], dict) and manifest["selection"],
          "Retain original repository, source editions and composition")
    check(isinstance(manifest["files"], list) and manifest["files"], "Select all original runtime files")
    seen, rows = set(), []
    source_root = absolute(source_root).resolve(strict=True)
    for row in manifest["files"]:
        fields(row, ("path", "bytes", "sha256", "role"), ("path", "bytes", "sha256"), "runtime member")
        name = relative(row["path"])
        check(name not in seen, "Duplicate selected runtime source")
        seen.add(name)
        path = source_root / name
        check(path.resolve().is_relative_to(source_root), "Selected runtime file leaves its original source root")
        expected = {"bytes": row["bytes"], "sha256": row["sha256"]}
        check(identity(path) == expected, "Original runtime source differs: " + name)
        rows.append((name, path, expected))
    for needed in ("iati_workspace.py", "results/workspace.py", "results/transfer.py",
                   "results/report.py", "results/model.py", "server.py", "cli.py"):
        check(iati_path + "/" + needed in seen, "Complete original runtime lacks " + needed)
    return manifest, rows


def overview(result, members):
    esc = lambda value: html.escape(str(value), quote=True)
    blocks = []
    for name, edition in result["editions"].items():
        counts = edition["report"]["counts"]
        rows = "".join("<tr><th>" + esc(key) + "</th><td>" + esc(value) + "</td></tr>"
                       for key, value in counts.items())
        prefix = "reports/" + name + "/"
        links = " · ".join('<a href="' + esc(prefix + filename) + '">' + esc(filename) + "</a>"
                           for filename in ("report.html", "report.json", "edition.json")
                           if prefix + filename in members)
        blocks.append("<section><h2>" + esc(name) + "</h2><p>Project " + esc(edition["id"]) +
                      " · revision " + esc(edition["revision"]) + "</p><p>" + links +
                      "</p><table>" + rows + "</table></section>")
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" "
            "content=\"width=device-width,initial-scale=1\"><title>" + esc(result["programme"]["name"]) +
            "</title><style>body{font:16px system-ui,sans-serif;color:#202020;background:#f5f5f5;"
            "max-width:1100px;margin:36px auto;padding:0 20px}section{background:white;border:1px solid #ccc;"
            "padding:20px;margin:20px 0}h1,h2{font-weight:600}a{color:#222}table{border-collapse:collapse;"
            "width:100%}td,th{text-align:left;border-bottom:1px solid #ddd;padding:7px}th{font-weight:500}"
            "code{overflow-wrap:anywhere}</style><h1>" + esc(result["programme"]["name"]) +
            "</h1><p>Agreed activity inventory: " + esc(", ".join(result["programme"]["activityIds"])) +
            "</p><p>Native reports retain source identities, periods, dimensions, exact values and review findings. "
            "Counts below come from the original Results engine.</p>" + "".join(blocks) +
            "<section><h2>Open the editable workspace</h2><p>Run <code>python3 START.py --workspace "
            "/absolute/private/programme</code> from this complete handover directory. "
            "The original application opens after all selected files and editions are received.</p></section></html>").encode()


@contextmanager
def original_packet(path):
    """Use the native export lease and recover only its exact published link."""
    path = Path(path)
    native = importlib.import_module("iati_workspace")
    with native.export_lease(path):
        stage = path.parent / ("." + path.name + ".iati-export.partial")
        if stage.exists() or stage.is_symlink():
            info = stage.lstat()
            if (stat.S_ISREG(info.st_mode) and not path.is_symlink() and
                    path.exists() and os.path.samefile(stage, path)):
                check(info.st_nlink == 2 and info.st_uid == os.getuid() and
                      not info.st_mode & 0o077, "The original published packet has unrelated links or ownership")
                stage.unlink()
                sync_dir(path.parent)
        before = identity(path)
        yield before
        check(identity(path) == before, "The original completed packet changed while receiving")


def frozen_results_packet(ws, path, selected, workspace_id):
    """Verify and reopen the native frozen archive without adopting or re-exporting it."""
    transfer = importlib.import_module("results.transfer")
    report_module = importlib.import_module("results.report")
    with original_packet(path) as packet_identity, ws.scratch() as temp:
        manifest, paths, receipt_input = transfer._read(Path(path), temp)
        check({"bytes": receipt_input["bytes"], "sha256": receipt_input["sha256"]} == packet_identity,
              "The native reader selected another completed packet")
        snapshot = read_json(paths["snapshot.json"])
        check(snapshot.get("id") == manifest["project"] == selected["id"] and
              snapshot.get("sha256") == manifest["snapshotSha256"] and
              snapshot.get("originalWorkspaceId") == workspace_id and
              snapshot.get("selectedRevision") == manifest["selectedRevision"] == selected["revision"] and
              snapshot.get("selectedSha256") == manifest["selectedEditionSha256"] == selected["sha256"],
              "The completed packet selects another original programme edition")
        sources, prior_blobs, snapshots, used = transfer._incoming_graph(snapshot, paths)
        check(sorted(sources) == manifest["sources"], "The packet changes its complete original source closure")
        for value in snapshots.values():
            check(value["id"] == snapshot["id"], "A retained history belongs to another original project")
            ws.results.validate_snapshot(value, sources)
        edition = next(row for row in snapshot["editions"] if row["revision"] == selected["revision"])
        check(edition["sha256"] == selected["sha256"] and
              edition["report"]["reportSha256"] == manifest["reportSha256"] == selected["report"]["reportSha256"],
              "The completed packet changes the selected original report")
        reports = report_module.report_files(edition, edition["report"], snapshot["comparisons"])
        for name, data in reports.items():
            member = "reports/" + name
            check(member in paths and paths[member].read_bytes() == data,
                  "The packet's readable report differs from its native edition: " + name)
            used.add(member)
        check(used == set(paths), "The completed packet has bytes outside its exact original project closure")
        return packet_identity, reports


def frozen_publisher_packet(ws, Workspace, path, selected):
    """Reopen an already released native publisher packet in a private disposable workspace."""
    with original_packet(path) as packet_identity, ws.scratch() as temp:
        with Workspace(str(temp / "publisher-receiving"), create=True) as receiving:
            receiving.publishing.receive(Path(path))
            reopened = receiving.publishing.project(selected["id"], selected["revision"])
            check(reopened["state"] == "RELEASED" and reopened["release"] and
                  reopened["id"] == selected["id"] and reopened["revision"] == selected["revision"] and
                  reopened["release"]["id"] == selected["release"]["id"] and
                  reopened["candidateSource"] == selected["candidateSource"],
                  "The released publisher packet did not reopen its original selected edition")
        return packet_identity


def build_handover(workspace, iati, result_path, runtime_manifest, runtime_root, out, *, opened_workspace=None):
    result_path = absolute(result_path)
    result = read_json(result_path)
    check(result.get("schema") == RUN, "Select a complete original programme result")
    runtime, runtime_rows = selected_runtime(absolute(runtime_manifest), runtime_root)
    Workspace = load_runtime(iati)
    check(Path(iati).resolve() == (absolute(runtime_root) / runtime["iatiPath"]).resolve(),
          "Build from the same selected original runtime used to read the programme")
    out = absolute(out)
    for selected in (absolute(workspace), absolute(runtime_root), result_path.parent):
        check(not out.is_relative_to(selected) and not selected.is_relative_to(out),
              "Keep the complete handover outside the original workspace and source")
    if out.exists():
        check((out / "BUILD.json").is_file() or not any(out.iterdir()),
              "Choose an empty handover directory or this original build")
    out.mkdir(mode=0o700, exist_ok=True)
    private_directory(out)
    original = {"schema": "tjlabs.pmel.handover-build.v1", "operationId": result["operationId"],
                "result": identity(result_path), "runtime": digest(encoded(runtime)),
                "operator": {name: identity(Path(__file__).parent / name) for name in SOURCE_FILES}}
    immutable_json(out / "BUILD.json", original)
    with operation_lock(out / ".build"):
        members = {}
        def retain_bytes(name, data):
            name = relative(name)
            immutable_bytes(out / name, data)
            members[name] = identity(out / name)
        def retain_file(name, path, expected=None):
            name = relative(name)
            expected = expected or identity(path)
            copy_original(path, out / name, expected)
            members[name] = expected
        retain_file("programme-result.json", result_path)
        original_plan = read_json(result_path.parent / "original-plan.json")
        check(original_plan["workspaceId"] == result["workspaceId"] and
              digest(encoded(original_plan["plan"])) == result["planSha256"],
              "The original programme selection differs from its completed run")
        retain_bytes("programme-plan.json", encoded(original_plan))
        attachment_root = result_path.parent / "attachments"
        if attachment_root.is_dir():
            for path in sorted(attachment_root.iterdir()):
                check(path.is_file() and not path.is_symlink(), "Original attachment is not a file")
                retain_file("attachments/" + path.name, path)
        for name in SOURCE_FILES:
            retain_file(name, Path(__file__).parent / name, original["operator"][name])
        retain_bytes("runtime-selection.json", encoded(runtime))
        for name, path, expected in runtime_rows:
            retain_file("runtime/" + name, path, expected)
        project_packets, publishing_packets = [], []
        selected_heads = {}
        for item in original_plan["plan"]["editions"]:
            selected = result["editions"][item["alias"]]
            selected_heads[selected["id"]] = {"project": selected["id"], "revision": selected["revision"],
                                               "editionSha256": selected["sha256"], "alias": item["alias"]}
        with programme_workspace(Workspace, workspace, opened_workspace) as ws:
            check(ws.results.inventory()["workspaceId"] == result["workspaceId"],
                  "This is another original workspace")
            final_publishers = {}
            publisher_order = original_plan["plan"].get("publisherSteps",
                                                        original_plan["plan"].get("publisherProjects", []))
            for item in publisher_order:
                name = alias(item["alias"], "publisher packet alias")
                selected = result["publisherSteps"][name]
                final_publishers[selected["id"]] = (name, selected)
            for ident, (name, selected) in final_publishers.items():
                current = ws.publishing.project(ident, selected["revision"])
                check(current["state"] == "RELEASED" and current.get("release") and
                      current.get("candidateSource") == selected.get("candidateSource") and
                      current.get("release") == selected.get("release"),
                      "Native publisher receiving requires an already released original revision; "
                      "select that actual revision after completing its original publishing workflow")
            (out / "data").mkdir(mode=0o700, exist_ok=True)
            for name, selected in result["editions"].items():
                alias(name, "Results packet alias")
                current = ws.results.project(selected["id"], selected["revision"])
                check(current["sha256"] == selected["sha256"], "The selected original edition differs")
                filename = "data/results-" + name + ".zip"
                if not (out / filename).exists() and not (out / filename).is_symlink():
                    ws.results.export(selected["id"], out / filename, selected["revision"])
                packet_identity, reports = frozen_results_packet(ws, out / filename, selected, result["workspaceId"])
                members[filename] = packet_identity
                for report_name, data in reports.items():
                    retain_bytes("reports/" + name + "/" + relative(report_name), data)
                project_packets.append({"alias": name, "project": selected["id"], "revision": selected["revision"],
                                        "editionSha256": selected["sha256"], "path": filename, **packet_identity})
            for ident, (name, selected) in final_publishers.items():
                filename = "data/publisher-" + name + ".zip"
                if not (out / filename).exists() and not (out / filename).is_symlink():
                    ws.publishing.export(ident, out / filename, selected["revision"])
                members[filename] = frozen_publisher_packet(ws, Workspace, out / filename, selected)
                publishing_packets.append({"alias": name, "project": ident, "revision": selected["revision"],
                                           "path": filename, **members[filename]})
        retain_bytes("index.html", overview(result, members))
        manifest = {"schema": HANDOVER, "operationId": result["operationId"],
                    "programme": result["programme"], "originalWorkspaceId": result["workspaceId"],
                    "iatiPath": "runtime/" + runtime["iatiPath"], "runtimeSelection": runtime["selection"],
                    "results": project_packets, "selectedHeads": list(selected_heads.values()),
                    "publishing": publishing_packets, "files": members}
        immutable_json(out / "HANDOVER.json", manifest)
        return {"directory": str(out), "manifest": identity(out / "HANDOVER.json"),
                "files": len(members), "bytes": sum(row["bytes"] for row in members.values()),
                "resultsPackets": len(project_packets), "publisherPackets": len(publishing_packets),
                "open": str(out / "index.html"), "start": str(out / "START.py")}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Operate complete programme editions through the original IATI application")
    parser.add_argument("--iati", required=True, type=Path, help="Absolute complete original iati source directory")
    parser.add_argument("--workspace", required=True, type=Path, help="Original private native workspace")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--source", required=True, type=Path)
    inspect.add_argument("--programme-id", required=True)
    inspect.add_argument("--name", required=True)
    inspect.add_argument("--activity", required=True, action="append")
    inspect.add_argument("--provenance", required=True, type=Path)
    inspect.add_argument("--out", required=True, type=Path)
    run = commands.add_parser("run")
    run.add_argument("--plan", required=True, type=Path)
    selected = commands.add_parser("select")
    selected.add_argument("--selection", required=True, type=Path)
    handover = commands.add_parser("handover")
    handover.add_argument("--result", required=True, type=Path)
    handover.add_argument("--runtime-manifest", required=True, type=Path)
    handover.add_argument("--runtime-root", required=True, type=Path)
    handover.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "init":
        Workspace = load_runtime(args.iati)
        with Workspace(str(absolute(args.workspace)), create=True) as ws:
            result = ws.results.inventory()
    elif args.command == "inspect":
        result = inspect_source(args.workspace, args.iati, args.source, args.programme_id,
                                args.name, args.activity, args.provenance, args.out)
    elif args.command == "run":
        result = run_programme(args.workspace, args.iati, args.plan)
    elif args.command == "select":
        result = select_programme(args.workspace, args.iati, args.selection)
    else:
        result = build_handover(args.workspace, args.iati, args.result, args.runtime_manifest,
                                args.runtime_root, args.out)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ProgrammeError, OSError, ValueError) as error:
        print("Programme: " + str(error), file=sys.stderr)
        sys.exit(1)
