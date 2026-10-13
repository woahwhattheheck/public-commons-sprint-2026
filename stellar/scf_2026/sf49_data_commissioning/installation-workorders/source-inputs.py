#!/usr/bin/env python3
"""Prepare complete original customer Workshares for the maintained Installation receiver.

This only receives local source files. Native case attachment, preview, save and
whole-case import remain in receive.mjs and the original Operations workspace.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from decimal import Decimal
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile

SCHEMA = "stellar-forge.installation-source-selection.v1"
RECEIVING = "stellar-forge.installation-workshare-receiving.v1"
PROFILE_SCHEMA = "stellar-forge.installation-workorder-profile.v1"
PROFILE_ID = re.compile(r"^[a-z][a-z0-9-]+$")
MAX_FILE = 8 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
PREFIX = re.compile(r"^[A-Za-z0-9_-]{1,70}$")
MEDIA_TYPE = re.compile(r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$")
RESERVED = {"SOURCE_SELECTION.json", "Supplier_Workshare_Commissioning.json",
            "Supplier_Complete_Receiving_Packets.json", "SUPPLIER_RECEIVING.json",
            "SOURCE_PREPARATION.json", "source-preparation.lock"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def exact_keys(value, allowed, required, label):
    require(isinstance(value, dict) and not set(value) - set(allowed)
            and set(required) <= set(value), "Use the complete declared " + label + " fields.")
    return value


def json_object(raw, label):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON member in " + label + ": " + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError("Use finite JSON values in " + label + ": " + value)
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique, parse_constant=constant)
    require(isinstance(value, dict), "Use a complete JSON object for " + label + ".")
    return value


def stable_file(path, maximum=MAX_FILE, *, sync=False):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= maximum,
                "Use the complete regular source within the native file limit: " + str(path))
        chunks, count = [], 0
        while True:
            part = os.read(descriptor, min(65536, maximum + 1 - count))
            if not part:
                break
            chunks.append(part)
            count += len(part)
            require(count <= maximum, "The original source exceeds its declared bound: " + str(path))
        after = os.fstat(descriptor)
        named = os.lstat(path)
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        require(all(getattr(before, key) == getattr(after, key) for key in fields)
                and (named.st_dev, named.st_ino) == (after.st_dev, after.st_ino)
                and count == before.st_size, "The original source changed while being read: " + str(path))
        if sync:
            os.fsync(descriptor)
        return b"".join(chunks)
    finally:
        os.close(descriptor)



def installed_profile(identifier):
    """Select the same complete installed ID.json source as profiles.mjs."""
    require(isinstance(identifier, str) and PROFILE_ID.fullmatch(identifier) is not None,
            "Select a maintained installed workorder profile ID.")
    path = Path(__file__).resolve().parent / (identifier + ".json")
    try:
        raw = stable_file(path, maximum=2 * 1024 * 1024)
    except FileNotFoundError as error:
        raise ValueError("Unknown installation profile: " + identifier
                         + ". Run prepare.mjs profiles to see the installed choices.") from error
    value = json_object(raw, "installed profile " + identifier)
    require(value.get("schema") == PROFILE_SCHEMA and value.get("id") == identifier
            and isinstance(value.get("title"), str) and bool(value["title"].strip())
            and all(isinstance(value.get(key), dict) for key in ("task", "source", "receiving"))
            and isinstance(value.get("steps"), list) and bool(value["steps"])
            and all(isinstance(step, dict)
                    and isinstance(step.get("title"), str) and bool(step["title"].strip())
                    and isinstance(step.get("result"), str) and bool(step["result"].strip())
                    for step in value["steps"])
            and isinstance(value.get("inputs"), list) and isinstance(value.get("sourceFiles"), list),
            "Retain the matching complete installed profile, task, source, receiving and implementation: "
            + str(path))
    return {"id": identifier, "title": value["title"], "path": str(path),
            "bytes": len(raw), "sha256": sha(raw)}


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def private_directory(path):
    path = Path(os.path.abspath(path))
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077
            and path.resolve() == path and info.st_uid == os.getuid(),
            "Use a private owned 0700 output directory without symbolic-link ancestors.")
    # Replay also completes any parent-directory flush interrupted after mkdir.
    current = path
    while True:
        sync_directory(current)
        if current.parent == current:
            break
        current = current.parent
    return path


def retain(path, raw):
    require(len(raw) <= MAX_FILE, "A prepared file exceeds the original receiver's 8 MiB input limit: " + path.name)
    try:
        existing = stable_file(path, sync=True)
    except FileNotFoundError:
        existing = None
    if existing is not None:
        require(existing == raw, "The retained original output differs: " + str(path))
        sync_directory(path.parent)
    else:
        fd, temporary = tempfile.mkstemp(prefix=".source-input-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as target:
                target.write(raw)
                target.flush()
                os.fsync(target.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                require(stable_file(path, sync=True) == raw, "A concurrent original output differs: " + str(path))
            sync_directory(path.parent)
        finally:
            os.unlink(temporary)
            sync_directory(path.parent)
    return {"filename": path.name, "bytes": len(raw), "sha256": sha(raw)}


def decimal(value, label):
    require(not isinstance(value, bool) and isinstance(value, (str, int, float)),
            "Use the original numeric source for " + label + ".")
    result = Decimal(str(value))
    require(result.is_finite() and result >= 0, "Use a finite nonnegative original " + label + ".")
    return result


def pointer(value, path):
    require(isinstance(path, str) and path.startswith("/") and len(path) <= 2000,
            "Select an exact JSON Pointer inside the original Workshare plan.")
    for encoded in path.split("/")[1:]:
        require(not re.search(r"~(?![01])", encoded), "Use an escaped original JSON Pointer.")
        key = encoded.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict):
            require(key in value, "The original plan does not contain " + path)
            value = value[key]
        elif isinstance(value, list):
            require(re.fullmatch(r"0|[1-9][0-9]*", key) is not None and int(key) < len(value),
                    "Select an original array element in " + path)
            value = value[int(key)]
        else:
            raise ValueError("The original plan path ends before " + path)
    return value


def original_intake():
    # Use the same maintained source as operations_workshare_installations.py.
    path = Path(__file__).resolve().parents[2] / "sf47_budget_model" / "workspace" / "workshare_intake.py"
    raw = stable_file(path)
    spec = importlib.util.spec_from_file_location("installation_original_workshare_intake", path)
    require(spec is not None and spec.loader is not None, "Retain the original Workshare intake module.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    require(stable_file(path) == raw, "The selected original Workshare intake changed during preparation.")
    return module, {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}


def source_descriptor(root, selected, known, total):
    exact_keys(selected, ("path", "filename", "bytes", "sha256", "sourceUrl", "observedAt", "mediaType"),
               ("path", "filename", "bytes", "sha256", "sourceUrl", "observedAt"), "original file selection")
    name = selected["filename"]
    require(isinstance(name, str) and FILENAME.fullmatch(name) is not None and name not in RESERVED,
            "Select an explicit native receiving filename with letters, numbers, dots, underscores or hyphens.")
    relative = selected["path"]
    require(isinstance(relative, str) and relative and not Path(relative).is_absolute()
            and all(part not in ("", ".", "..") for part in relative.split("/"))
            and "\\" not in relative, "Select a relative original path inside the source directory.")
    path = root / relative
    require(path.resolve() == path and root in path.parents,
            "Keep original source files within the declared directory without symbolic links.")
    require(isinstance(selected["bytes"], int) and not isinstance(selected["bytes"], bool)
            and 0 <= selected["bytes"] <= MAX_FILE and isinstance(selected["sha256"], str)
            and SHA256.fullmatch(selected["sha256"]) is not None,
            "Retain each original file's exact byte count and SHA-256.")
    require(isinstance(selected["sourceUrl"], str) and 0 < len(selected["sourceUrl"]) <= 4000,
            "Retain each original file's source URL.")
    from datetime import datetime
    stamp = selected["observedAt"]
    require(isinstance(stamp, str), "Retain the actual source observation time.")
    try:
        observed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Use the original source observation with its timezone.") from error
    require(observed.utcoffset() is not None, "Keep the source observation's timezone.")
    raw = stable_file(path)
    require(len(raw) == selected["bytes"] and sha(raw) == selected["sha256"],
            "The complete selected original file differs: " + relative)
    media_type = selected.get("mediaType", "application/json")
    require(isinstance(media_type, str) and len(media_type) <= 200
            and MEDIA_TYPE.fullmatch(media_type) is not None, "Select the original file media type.")
    record = {"filename": name, "bytes": len(raw), "sha256": sha(raw),
              "sourceUrl": selected["sourceUrl"], "observedAt": stamp, "mediaType": media_type}
    if name in known:
        require(known[name]["raw"] == raw and known[name]["record"] == record,
                "Two different original source selections use the same receiving filename: " + name)
    else:
        total[0] += len(raw)
        require(total[0] <= MAX_TOTAL, "The selected complete source exceeds 64 MiB.")
        known[name] = {"raw": raw, "record": record, "path": relative}
    return raw, record


def effort_value(plan, selected, documents, label):
    path = selected["sourcePointer"]
    filename = selected.get("sourceFile")
    if filename is None:
        source, basis = plan, {"source": "original-workshare-plan"}
    else:
        require(isinstance(filename, str) and filename in documents,
                "Select an original JSON file from this customer's complete source list.")
        original = documents[filename]
        source = json_object(original["raw"], filename)
        basis = {"source": "original-file", "filename": filename,
                 "bytes": original["record"]["bytes"], "sha256": original["record"]["sha256"]}
    require(selected["unit"] in ("hours", "minutes"), "Name the original effort unit as hours or minutes.")
    amount = pointer(source, path)
    native = decimal(amount, label)
    hours = native if selected["unit"] == "hours" else native / Decimal(60)
    require(isinstance(selected["hours"], str) and decimal(selected["hours"], label) == hours,
            "Selected hours must equal the complete original source value in its declared unit.")
    return hours, {**basis, "pointer": path, "unit": selected["unit"], "value": amount}


def phase_effort(plan, rows, total_selection, documents):
    require(isinstance(rows, list) and 0 < len(rows) <= 100,
            "Select the original effort for every commercial phase.")
    phases = {item["id"]: item for item in plan["phases"]}
    require(len(phases) == len(plan["phases"]), "Keep each original commercial phase identity once.")
    result, used_phases, used_paths, hours_sum = [], set(), set(), Decimal(0)
    for row in rows:
        exact_keys(row, ("phaseId", "hours", "sourcePointer", "sourceFile", "unit", "basis"),
                   ("phaseId", "hours", "sourcePointer", "unit", "basis"), "phase effort selection")
        ident = row["phaseId"]
        path_key = (row.get("sourceFile"), row["sourcePointer"])
        require(ident in phases and ident not in used_phases and path_key not in used_paths,
                "Map every original phase and original effort value once.")
        hours, basis = effort_value(plan, row, documents, "phase effort")
        require(isinstance(row["basis"], str) and 0 < len(row["basis"]) <= 4000,
                "Retain the explicit phase-to-effort mapping basis.")
        used_phases.add(ident)
        used_paths.add(path_key)
        hours_sum += hours
        result.append({"phase_id": ident, "hours": row["hours"],
                       "basis": {**basis, "mapping": row["basis"]}})
    require(used_phases == set(phases), "Keep every complete original Workshare phase.")
    exact_keys(total_selection, ("hours", "sourcePointer", "sourceFile", "unit"),
               ("hours", "sourcePointer", "unit"), "complete effort source")
    original_total, total_basis = effort_value(plan, total_selection, documents, "complete quoted effort")
    require(hours_sum == original_total, "Every selected phase must sum to the original complete quoted effort.")
    return result, {"hours": total_selection["hours"], "basis": total_basis}


def selected_packet(original, original_file, amendment, known, generated, observed_at):
    if amendment is None:
        return original, original_file, None
    exact_keys(amendment, ("mapping", "reason", "sourceUrl", "selectedFilename"),
               ("mapping", "reason", "sourceUrl", "selectedFilename"), "phase identity amendment")
    mapping, name = amendment["mapping"], amendment["selectedFilename"]
    require(isinstance(mapping, dict) and mapping
            and all(isinstance(key, str) and isinstance(value, str) and key and value and key != value
                    and len(key) <= 500 and len(value) <= 500 for key, value in mapping.items())
            and len(set(mapping.values())) == len(mapping),
            "Use the exact accepted old-to-new phase identity mapping.")
    require(isinstance(name, str) and FILENAME.fullmatch(name) is not None
            and name not in RESERVED and name not in known and name not in generated,
            "Give the selected amended packet a distinct receiving filename.")
    for key in ("reason", "sourceUrl"):
        require(isinstance(amendment[key], str) and 0 < len(amendment[key]) <= 4000,
                "Retain the original phase amendment's reason and source URL.")
    require("installation_phase_id_amendment" not in original,
            "Select the complete unmodified original packet as the amendment source.")
    value, edits = deepcopy(original), []
    phases = value["workshare_input"]["plan"]["phases"]
    ids = [phase["id"] for phase in phases]
    require(set(mapping) <= set(ids) and len(set(mapping.get(ident, ident) for ident in ids)) == len(ids),
            "The selected phase mapping must preserve distinct complete original phases.")
    for index, phase in enumerate(phases):
        old = phase["id"]
        if old in mapping:
            phase["id"] = mapping[old]
            edits.append({"path": "/workshare_input/plan/phases/" + str(index) + "/id",
                          "original": old, "selected": phase["id"]})
        for offset, dependency in enumerate(phase.get("depends_on", [])):
            if dependency in mapping:
                phase["depends_on"][offset] = mapping[dependency]
                edits.append({"path": "/workshare_input/plan/phases/" + str(index)
                              + "/depends_on/" + str(offset),
                              "original": dependency, "selected": mapping[dependency]})
    reversed_value = deepcopy(value)
    reverse = {new: old for old, new in mapping.items()}
    for phase in reversed_value["workshare_input"]["plan"]["phases"]:
        phase["id"] = reverse.get(phase["id"], phase["id"])
        phase["depends_on"] = [reverse.get(ident, ident) for ident in phase.get("depends_on", [])]
    require(reversed_value == original, "The selected amendment must change only the declared phase identities and references.")
    receipt = {"schema": "stellar-forge.installation-phase-id-amendment.v1",
               "original": original_file, "sourceUrl": amendment["sourceUrl"],
               "reason": amendment["reason"], "mapping": mapping, "edits": edits}
    value["installation_phase_id_amendment"] = receipt
    raw = json_bytes(value)
    require(len(raw) <= MAX_FILE, "The complete selected amended packet exceeds 8 MiB.")
    metadata = {"filename": name, "bytes": len(raw), "sha256": sha(raw),
                "sourceUrl": amendment["sourceUrl"], "observedAt": observed_at,
                "mediaType": "application/json"}
    generated[name] = {"raw": raw, "record": metadata}
    return value, metadata, receipt


def customer_programme(value, documents, known):
    """Retain complete source files consumed by the original Installation programme."""
    exact_keys(value, ("schema", "calendarFile", "selectionFile", "taskBudgetFile", "nativeChangeFile"),
               ("schema", "calendarFile"), "customer programme selection")
    require(value["schema"] == "stellar-forge.installation-customer-programme.v1",
            "Use the complete original customer programme selection.")
    available = {row["filename"]: row for row in documents}
    for key in ("calendarFile", "selectionFile", "taskBudgetFile", "nativeChangeFile"):
        if key not in value:
            continue
        filename = value[key]
        require(isinstance(filename, str) and filename in available and filename in known,
                "Retain the complete selected " + key + " among this customer's original source files.")
        require(available[filename].get("mediaType", "application/json") == "application/json",
                "Retain the selected " + key + " as complete original JSON.")
        parsed = json_object(known[filename]["raw"], key)
        if key == "calendarFile":
            require(parsed.get("schema") == "tjlabs.scf-purchase-calendar-input.v1",
                    "Select the complete original recurring calendar input.")
        elif key == "selectionFile":
            require(parsed.get("schema") == "tjlabs.scf-recurring-commissioning.v1",
                    "Select the complete original recurring commercial selections.")
        elif key == "nativeChangeFile":
            require(parsed.get("schema") == "stellar-forge.installation-programme-change.v1",
                    "Retain the complete original native programme change.")
    return deepcopy(value)


def prepare(selection_path, source_root, destination):
    selection_path = Path(os.path.abspath(selection_path))
    source_root = Path(os.path.abspath(source_root))
    require(source_root.resolve() == source_root and source_root.is_dir(),
            "Use the complete original source directory without symbolic-link ancestors.")
    selected_raw = stable_file(selection_path)
    selected = json_object(selected_raw, "source selection")
    exact_keys(selected, ("schema", "operationId", "requestPrefix", "receivingName", "sourceUrl", "observedAt", "cases"),
               ("schema", "operationId", "requestPrefix", "receivingName", "sourceUrl", "observedAt", "cases"), "source selection")
    require(selected["schema"] == SCHEMA and isinstance(selected["operationId"], str)
            and PREFIX.fullmatch(selected["operationId"]) is not None
            and isinstance(selected["requestPrefix"], str)
            and PREFIX.fullmatch(selected["requestPrefix"]) is not None,
            "Retain the original source operation and receiving request prefix.")
    require(isinstance(selected["receivingName"], str) and 0 < len(selected["receivingName"]) <= 300,
            "Name the internal complete-case receiving operation.")
    require(isinstance(selected["sourceUrl"], str) and 0 < len(selected["sourceUrl"]) <= 4000,
            "Retain the actual complete selection source URL.")
    from datetime import datetime
    require(isinstance(selected["observedAt"], str)
            and datetime.fromisoformat(selected["observedAt"].replace("Z", "+00:00")).utcoffset() is not None,
            "Retain the actual complete selection observation with its timezone.")
    cases = selected["cases"]
    require(isinstance(cases, list) and 0 < len(cases) <= 20, "Select one to twenty complete original cases.")
    known, generated, total, case_ids, original_rows, packets, customer_rows, summaries = {}, {}, [0], set(), [], [], [], []
    profiles = {}
    for case in cases:
        exact_keys(case, ("caseId", "profile", "packet", "planSha256", "productionEffort", "effortTotal", "files", "bindings", "phaseIdAmendment", "programme"),
                   ("caseId", "profile", "packet", "planSha256", "productionEffort", "effortTotal", "files"), "customer selection")
        ident = case["caseId"]
        require(isinstance(ident, str) and 0 < len(ident) <= 500 and ident not in case_ids,
                "Select each original commercial case once.")
        selected_profile = installed_profile(case["profile"])
        if selected_profile["id"] in profiles:
            require(profiles[selected_profile["id"]] == selected_profile,
                    "The original installed profile changed during source preparation.")
        else:
            profiles[selected_profile["id"]] = selected_profile
        require(isinstance(case["planSha256"], str) and SHA256.fullmatch(case["planSha256"]) is not None,
                "Select the original canonical Workshare plan SHA-256.")
        require(isinstance(case["files"], list), "Retain the complete selected original document list.")
        raw, packet_file = source_descriptor(source_root, case["packet"], known, total)
        packet = json_object(raw, ident + " receiving packet")
        workshare = packet.get("workshare_input")
        require(isinstance(packet.get("prepared_case"), dict) and packet["prepared_case"].get("id") == ident
                and isinstance(workshare, dict) and isinstance(workshare.get("source"), dict)
                and isinstance(workshare.get("plan"), dict) and workshare["source"].get("case_id") == ident,
                "The complete original packet and Workshare source must select the same case.")
        packet, selected_file, amendment = selected_packet(packet, packet_file, case.get("phaseIdAmendment"), known, generated, selected["observedAt"])
        workshare = packet["workshare_input"]
        plan = workshare["plan"]
        require(plan.get("version") == "dealscout.workshare-plan.v1"
                and sha(canonical(plan).encode("utf-8")) == case["planSha256"],
                "The selected original Workshare plan differs: " + ident)
        documents = [packet_file]
        if selected_file["filename"] != packet_file["filename"]:
            documents.append(selected_file)
        for file in case["files"]:
            _, metadata = source_descriptor(source_root, file, known, total)
            require(metadata["filename"] not in {item["filename"] for item in documents},
                    "Select each original customer source file once.")
            documents.append(metadata)
        customer_sources = {file["filename"]: known[file["filename"]] for file in documents if file["filename"] in known}
        effort, complete_effort = phase_effort(plan, case["productionEffort"], case["effortTotal"], customer_sources)
        original_rows.append({"case_id": ident, "workshare_input": workshare,
                              "plan_sha256": case["planSha256"], "production_effort": effort,
                              "original_packet": packet_file, "selected_packet": selected_file,
                              "phase_id_amendment": amendment, "complete_effort": complete_effort})
        packets.append(packet)
        customer = {"profile": case["profile"], "workshareCaseId": ident,
                    "planSha256": case["planSha256"], "files": documents}
        if "bindings" in case:
            require(isinstance(case["bindings"], dict), "Use explicit original customer bindings.")
            customer["bindings"] = case["bindings"]
        if "programme" in case:
            customer["programme"] = customer_programme(case["programme"], documents, known)
        customer_rows.append(customer)
        summaries.append({"caseId": ident, "profile": case["profile"], "planSha256": case["planSha256"],
                          "commercial": plan["commercial"], "schedule": plan["schedule"],
                          "phaseIds": [phase["id"] for phase in plan["phases"]],
                          "productionEffort": effort, "completeEffort": complete_effort,
                          "originalPacket": packet_file, "selectedPacket": selected_file,
                          "phaseIdAmendment": amendment})
        case_ids.add(ident)
    commissioning = {"version": "dealscout.workshare-commissioning-inputs.v1",
                     "operation_id": selected["operationId"],
                     "source": {"selection_sha256": sha(selected_raw), "original_files": [
                         value["record"] for value in known.values()],
                                "selected_files": [value["record"] for value in generated.values()],
                                "source_url": selected["sourceUrl"], "observed_at": selected["observedAt"]},
                     "cases": original_rows}
    packet_group = {"version": "dealscout.workshare-receiving-packets.v1", "packets": packets}
    module, native_source = original_intake()
    verified = module.load_workshares(commissioning, packet_group, require_proposed_usd=False)
    require([row["caseId"] for row in verified] == [row["caseId"] for row in summaries],
            "The original native Workshare reader selected different cases.")
    require(all(row["planSha256"] == summary["planSha256"] for row, summary in zip(verified, summaries)),
            "The original native Workshare plan identities differ.")
    commissioning_bytes, packet_bytes = json_bytes(commissioning), json_bytes(packet_group)
    require(max(len(commissioning_bytes), len(packet_bytes)) <= MAX_FILE,
            "The complete commissioning and packet files must each fit the original receiver\'s 8 MiB bound.")
    require(not set(known) & set(generated), "Keep original and derived source filenames distinct.")
    for selected_profile in profiles.values():
        require(installed_profile(selected_profile["id"]) == selected_profile,
                "The selected installed profile changed before retaining the complete source.")
    output = private_directory(destination)
    descriptor = os.open(output / "source-preparation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(descriptor)
        named = os.lstat(output / "source-preparation.lock")
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077
                and info.st_uid == os.getuid() and (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino),
                "Retain the private original source preparation lease.")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Freeze the full request before publishing its deterministically derived files.
        outputs = [retain(output / "SOURCE_SELECTION.json", selected_raw)]
        for value in [*known.values(), *generated.values()]:
            outputs.append(retain(output / value["record"]["filename"], value["raw"]))
        commissioning_file = retain(output / "Supplier_Workshare_Commissioning.json", commissioning_bytes)
        packets_file = retain(output / "Supplier_Complete_Receiving_Packets.json", packet_bytes)
        outputs.extend((commissioning_file, packets_file))
        for customer in customer_rows:
            customer["files"] = [
                {**commissioning_file, "role": "commissioning", "sourceUrl": selected["sourceUrl"],
                 "observedAt": selected["observedAt"], "mediaType": "application/json"},
                {**packets_file, "role": "packet", "sourceUrl": selected["sourceUrl"],
                 "observedAt": selected["observedAt"], "mediaType": "application/json"},
                *[{**file, "role": "source"} for file in customer["files"]]]
        receiving = {"schema": RECEIVING, "requestPrefix": selected["requestPrefix"],
                     "receivingName": selected["receivingName"], "customers": customer_rows}
        outputs.append(retain(output / "SUPPLIER_RECEIVING.json", json_bytes(receiving)))
        report = {"schema": "stellar-forge.installation-source-preparation.v1", "state": "PREPARED_SOURCE",
                  "operationId": selected["operationId"],
                  "sourceSelection": {"bytes": len(selected_raw), "sha256": sha(selected_raw)},
                  "originalIntake": native_source, "profiles": list(profiles.values()), "cases": summaries,
                  "nativeWorkshares": [{"caseId": row["caseId"], "planSha256": row["planSha256"],
                                       "hours": row["hours"], "phaseCount": row["phaseCount"],
                                       "packetPresent": row["packetPresent"]} for row in verified],
                  "outputs": outputs}
        receipt = retain(output / "SOURCE_PREPARATION.json", json_bytes(report))
        return {**report, "output": {**receipt, "path": str(output / receipt["filename"])}}
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True, help="Complete original source selection JSON")
    parser.add_argument("--source-root", required=True, help="Directory containing every exact selected original file")
    parser.add_argument("--out", required=True, help="Private create-only preparation directory")
    args = parser.parse_args()
    print(json.dumps(prepare(args.selection, args.source_root, args.out), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
