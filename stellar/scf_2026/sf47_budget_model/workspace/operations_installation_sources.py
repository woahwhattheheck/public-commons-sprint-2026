"""Complete source preparation inside the maintained SF47 Operations workspace.

The native source-inputs.py and Workshare/Installation writers remain the
business implementations. This adapter retains editable selections, all original
bytes, complete prepared outputs and exact request receipts in the original
workspace connection. It does not open another database or launch a child.
"""
from __future__ import annotations

import base64
import binascii
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

from model import Problem, canonical, digest, now, short_id, text
import operations_workshare_installations as workshares
import operations_installation_commissioning as merchant_commissioning
import operations_installation_commissioning_archive as commissioning_archive
import operations_installation_source_editions as source_editions
import operations_installation_mapping_reconciliation as mapping_reconciliation

SCHEMA = "stellar-forge.installation-source-desk.v1"
PREPARATION = "stellar-forge.installation-source-desk-preparation.v1"
ROOT = Path(__file__).resolve().parents[2] / "sf49_data_commissioning" / "installation-workorders"
HELPER = ROOT / "source-inputs.py"
DRAFT_ID = re.compile(r"source-desk-[a-f0-9]{32}")
FILE_ID = re.compile(r"input-[a-f0-9]{64}")
PREPARATION_ID = re.compile(r"preparation-[a-f0-9]{64}")
SHA = re.compile(r"[a-f0-9]{64}")
MAX_FILE = 8 * 1024 * 1024
MAX_INPUTS = 64 * 1024 * 1024
MAX_STORED = 256 * 1024 * 1024
MAX_REVISIONS = 10000
MAX_PREPARATIONS = 100
MAX_ZIP = 192 * 1024 * 1024
_MODULE = None


def fail(message, code="INSTALLATION_SOURCE_INVALID", status=422):
    raise Problem(message, status, code)


def need(condition, message, code="INSTALLATION_SOURCE_INVALID", status=422):
    if not condition:
        fail(message, code, status)


def raw_hash(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def identifier(value, pattern, label):
    need(isinstance(value, str) and pattern.fullmatch(value) is not None,
         "Keep the original " + label + " identity.")
    return value


def exact(value, allowed, required, label):
    need(isinstance(value, dict) and not set(value) - set(allowed)
         and set(required) <= set(value), "Use the complete declared " + label + " fields.")
    return value


def integer(value, label, minimum=0, maximum=MAX_REVISIONS):
    need(isinstance(value, int) and not isinstance(value, bool)
         and minimum <= value <= maximum, "Use the original whole " + label + ".")
    return value


def native():
    """Load and pin the complete installed original helper once."""
    global _MODULE
    descriptor = os.open(HELPER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE,
             "Retain the complete installed source-preparation helper.")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            raw = stream.read(MAX_FILE + 1)
        after, named = os.fstat(descriptor), os.lstat(HELPER)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
             and (named.st_dev, named.st_ino) == (after.st_dev, after.st_ino)
             and len(raw) == before.st_size, "The installed source-preparation helper changed.")
    finally:
        os.close(descriptor)
    receipt = {"path": str(HELPER), "bytes": len(raw), "sha256": raw_hash(raw)}
    if _MODULE is not None:
        need(_MODULE[1] == receipt, "The installed preparation source changed. Reopen the application source.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        return _MODULE
    spec = importlib.util.spec_from_file_location("sf47_original_installation_source_inputs", HELPER)
    need(spec is not None and spec.loader is not None, "Retain the installed preparation module.")
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(HELPER), "exec"), module.__dict__)
    need(module.stable_file(HELPER) == raw, "The original preparation source changed while loading.")
    _MODULE = (module, receipt)
    return _MODULE


_NATIVE_HANDOVER = None


def native_handover():
    """Pin the existing full handover adapter and its exact shared source helper."""
    global _NATIVE_HANDOVER
    source, source_receipt = native()
    path = ROOT / "handover-inputs.py"
    raw = source.stable_file(path)
    files = [source_receipt, {"path": str(path), "bytes": len(raw), "sha256": raw_hash(raw)}]
    receipt = {"kind": "delivery-handover", "files": files,
               "bytes": sum(row["bytes"] for row in files), "sha256": digest(files)}
    if _NATIVE_HANDOVER is not None:
        need(_NATIVE_HANDOVER[1] == receipt,
             "The installed handover preparation source changed. Reopen the application source.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        return _NATIVE_HANDOVER
    spec = importlib.util.spec_from_file_location("sf47_original_installation_handover_inputs", path)
    need(spec is not None and spec.loader is not None, "Retain the installed handover preparation module.")
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    need(source.stable_file(path) == raw and native()[1] == source_receipt,
         "The installed handover preparation source changed while loading.",
         "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
    # Both complete original engines use the same source reader already pinned by
    # this desk. The source adapter retains and validates its original intake.
    module.source_tools = native
    _NATIVE_HANDOVER = (module, receipt)
    return _NATIVE_HANDOVER


_NATIVE_PACKAGE = None


def native_package():
    """Pin the complete installed native package reader and its original intake."""
    global _NATIVE_PACKAGE
    paths = [Path(__file__).with_name("canadabuys_workshare_intake.py"),
             Path(__file__).with_name("canadabuys_source_package.py")]
    helper, _ = native()
    selected = [(path, helper.stable_file(path)) for path in paths]
    files = [{"path": str(path), "bytes": len(raw), "sha256": raw_hash(raw)}
             for path, raw in selected]
    receipt = {"kind": "canadabuys-native-workshare", "files": files,
               "bytes": sum(row["bytes"] for row in files), "sha256": digest(files)}
    if _NATIVE_PACKAGE is not None:
        need(_NATIVE_PACKAGE[1] == receipt,
             "The installed native source reader changed. Reopen its complete application source.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        return _NATIVE_PACKAGE
    modules = []
    for index, (path, raw) in enumerate(selected):
        spec = importlib.util.spec_from_file_location("sf47_native_source_" + str(index), path)
        need(spec is not None and spec.loader is not None, "Keep the complete installed native source reader.")
        module = importlib.util.module_from_spec(spec)
        exec(compile(raw, str(path), "exec"), module.__dict__)
        modules.append(module)
        need(helper.stable_file(path) == raw, "The installed native source reader changed while loading.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
    # The package reader uses the exact intake bytes selected in this same source
    # receipt, including when the server previously imported another module name.
    modules[1].intake = modules[0]
    _NATIVE_PACKAGE = (modules[1], receipt)
    return _NATIVE_PACKAGE


def initialize(operations):
    """Extend the original connection; it keeps the existing workspace lease."""
    with operations.workspace.mutex:
        operations.db.execute("""CREATE TABLE IF NOT EXISTS ops_installation_source_drafts (
            program_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
            body_json TEXT NOT NULL, PRIMARY KEY(program_id,id))""")
        operations.db.execute("""CREATE TABLE IF NOT EXISTS ops_installation_source_revisions (
            program_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
            body_json TEXT NOT NULL, sha256 TEXT NOT NULL,
            PRIMARY KEY(program_id,id,revision))""")
        operations.db.execute("""CREATE TABLE IF NOT EXISTS ops_installation_source_blobs (
            program_id TEXT NOT NULL, draft_id TEXT NOT NULL, sha256 TEXT NOT NULL,
            bytes INTEGER NOT NULL, content BLOB NOT NULL,
            PRIMARY KEY(program_id,draft_id,sha256))""")
        operations.db.execute("""CREATE TABLE IF NOT EXISTS ops_installation_source_preparations (
            program_id TEXT NOT NULL, draft_id TEXT NOT NULL, id TEXT NOT NULL,
            body_json TEXT NOT NULL, PRIMARY KEY(program_id,draft_id,id))""")


class SourceDesk:
    def __init__(self, operations):
        self.ops = operations
        self.workspace, self.db = operations.workspace, operations.db
        initialize(operations)

    def _case(self, case_id):
        self.ops._program(case_id)

    def _state(self, case_id, draft_id, revision=None):
        self._case(case_id)
        identifier(draft_id, DRAFT_ID, "source draft")
        if revision is None:
            row = self.db.execute("SELECT body_json FROM ops_installation_source_drafts "
                                  "WHERE program_id=? AND id=?", (case_id, draft_id)).fetchone()
        else:
            integer(revision, "source draft revision", 1)
            row = self.db.execute("SELECT body_json FROM ops_installation_source_revisions "
                                  "WHERE program_id=? AND id=? AND revision=?",
                                  (case_id, draft_id, revision)).fetchone()
        need(row is not None, "The original source draft is not retained.",
             "INSTALLATION_SOURCE_NOT_FOUND", 404)
        result = json.loads(row[0])
        need(result["schema"] == SCHEMA and result["caseId"] == case_id and result["id"] == draft_id,
             "The retained source draft identity differs.", "INSTALLATION_SOURCE_CHANGED", 409)
        return result

    def _blob(self, case_id, draft_id, sha256):
        identifier(sha256, SHA, "file SHA-256")
        row = self.db.execute("SELECT bytes,content FROM ops_installation_source_blobs "
                              "WHERE program_id=? AND draft_id=? AND sha256=?",
                              (case_id, draft_id, sha256)).fetchone()
        need(row is not None, "The complete original file is not retained.",
             "INSTALLATION_SOURCE_FILE_NOT_FOUND", 404)
        raw = bytes(row[1])
        need(len(raw) == row[0] and raw_hash(raw) == sha256,
             "The retained original file differs from its complete receipt.",
             "INSTALLATION_SOURCE_CHANGED", 409)
        return raw

    def _keep_blob(self, case_id, draft_id, raw):
        need(0 < len(raw) <= MAX_FILE, "Each complete source/output must fit the native 8 MiB file bound.",
             status=413)
        sha256 = raw_hash(raw)
        existing = self.db.execute("SELECT bytes FROM ops_installation_source_blobs "
                                   "WHERE program_id=? AND draft_id=? AND sha256=?",
                                   (case_id, draft_id, sha256)).fetchone()
        if existing:
            need(self._blob(case_id, draft_id, sha256) == raw, "An existing complete file differs.",
                 "INSTALLATION_SOURCE_CHANGED", 409)
        else:
            total = self.db.execute("SELECT COALESCE(SUM(bytes),0) FROM ops_installation_source_blobs "
                                    "WHERE program_id=? AND draft_id=?", (case_id, draft_id)).fetchone()[0]
            need(total + len(raw) <= MAX_STORED,
                 "This draft's complete retained inputs, versions and outputs exceed 256 MiB. "
                 "Keep its history and begin a separately named preparation.", status=413)
            self.db.execute("INSERT INTO ops_installation_source_blobs VALUES(?,?,?,?,?)",
                            (case_id, draft_id, sha256, len(raw), raw))
        return {"bytes": len(raw), "sha256": sha256}

    def _append(self, state, before, action, context, request_sha256):
        state = deepcopy(state)
        state["revision"] = (before["revision"] if before else 0) + 1
        need(state["revision"] <= MAX_REVISIONS, "Keep the completed draft history within 10,000 revisions.")
        state["updatedAt"] = context["at"]
        event = {"revision": state["revision"], "action": action, "actor": context["actor"],
                 "note": context["note"], "at": context["at"], "requestId": context["requestId"],
                 "requestSha256": request_sha256}
        state["history"].append(event)
        body = canonical(state)
        need(len(body.encode("utf-8")) <= 12 * 1024 * 1024,
             "The complete editable source draft exceeds 12 MiB. Keep this history and begin another named preparation.",
             "INSTALLATION_SOURCE_HISTORY_CAPACITY", 413)
        self.db.execute("INSERT INTO ops_installation_source_revisions VALUES(?,?,?,?,?)",
                        (state["caseId"], state["id"], state["revision"], body, raw_hash(body.encode())))
        self.db.execute("INSERT INTO ops_installation_source_drafts VALUES(?,?,?,?) "
                        "ON CONFLICT(program_id,id) DO UPDATE SET revision=excluded.revision,body_json=excluded.body_json",
                        (state["caseId"], state["id"], state["revision"], body))
        return state

    def list(self, case_id):
        with self.workspace.mutex:
            self._case(case_id)
            rows = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_installation_source_drafts WHERE program_id=? ORDER BY rowid DESC",
                (case_id,))]
            return {"schema": SCHEMA, "caseId": case_id, "drafts": [
                {key: row[key] for key in ("id", "revision", "title", "createdAt", "updatedAt")}
                | {"fileCount": len(row["files"]), "selectedBytes": sum(f["bytes"] for f in row["files"]),
                   "preparationCount": len(row["preparations"]), "attachmentCount": len(row["attachments"]),
                   "latestPreparation": deepcopy(row["preparations"][-1]) if row["preparations"] else None,
                   "selectionSha256": digest(row["selection"]) if row["selection"] is not None else None}
                for row in rows]}

    def get(self, case_id, draft_id, revision=None):
        with self.workspace.mutex:
            state = self._state(case_id, draft_id, revision)
            for file in state["files"]:
                raw = self._blob(case_id, draft_id, file["sha256"])
                need(len(raw) == file["bytes"], "The selected original file length differs.",
                     "INSTALLATION_SOURCE_CHANGED", 409)
            return state

    def file(self, case_id, draft_id, file_id, revision=None):
        with self.workspace.mutex:
            state = self._state(case_id, draft_id, revision)
            identifier(file_id, FILE_ID, "source file")
            row = next((f for f in state["files"] if f["id"] == file_id), None)
            need(row is not None, "Select an original file in this draft edition.",
                 "INSTALLATION_SOURCE_FILE_NOT_FOUND", 404)
            return deepcopy(row), self._blob(case_id, draft_id, row["sha256"])

    def profiles(self):
        module, receipt = native()
        result = []
        for path in sorted(ROOT.glob("*.json")):
            if module.PROFILE_ID.fullmatch(path.stem) is None:
                continue
            raw = module.stable_file(path, 2 * 1024 * 1024)
            candidate = json.loads(raw.decode("utf-8"))
            if not isinstance(candidate, dict) or candidate.get("schema") != module.PROFILE_SCHEMA:
                continue
            selected = module.installed_profile(path.stem)
            need(len(raw) == selected["bytes"] and raw_hash(raw) == selected["sha256"],
                 "The selected installed profile changed.", "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
            result.append({**selected, "profile": module.json_object(raw, path.name)})
        need(result, "Retain the complete installed profile catalogue.")
        package, package_receipt = native_package()
        handover, handover_receipt = native_handover()
        return {"schema": SCHEMA, "engine": receipt, "profiles": result,
                "sourceFormats": [
                    {"schema": module.SCHEMA, "label": "Original Workshare packets", "engine": receipt},
                    {"schema": handover.SCHEMA, "label": "Saved delivery handovers", "engine": handover_receipt}],
                "nativePackages": [{"schema": package.SCHEMA, "kind": "canadabuys-native-workshare",
                                    "profile": "canadabuys-bidder-desk", "engine": package_receipt}],
                "limits": {"fileBytes": MAX_FILE, "selectedInputBytes": MAX_INPUTS,
                           "caseSourceBytes": 24 * 1024 * 1024, "caseSourceFiles": 200}}

    def inspect(self, case_id, draft_id, file_id, revision=None, amendment=None):
        metadata, raw = self.file(case_id, draft_id, file_id, revision)
        module, receipt = native()
        value = module.json_object(raw, metadata["filename"])
        plan = value.get("workshare_input", {}).get("plan") if isinstance(value.get("workshare_input"), dict) else None
        packet_case = value.get("prepared_case", {}).get("id") if isinstance(value.get("prepared_case"), dict) else None
        amendment_receipt, handover_identity = None, None
        source_kind = "workshare-packet"
        snapshot = value.get("snapshot")
        if isinstance(snapshot, dict) and snapshot.get("version") == "dealscout.delivery-handover.v1":
            need(amendment is None, "Keep saved handover phases unchanged; select an amended original handover edition.")
            handover, receipt = native_handover()
            saved_case, saved_workshare = snapshot.get("case"), snapshot.get("workshare")
            need(isinstance(saved_case, dict) and isinstance(saved_workshare, dict)
                 and isinstance(saved_workshare.get("plan"), dict),
                 "Retain the complete original handover case and Workshare plan.")
            packet_case, plan = saved_case.get("id"), saved_workshare["plan"]
            plan_sha = raw_hash(module.canonical(plan).encode("utf-8"))
            try:
                inputs, handover_identity = handover.handover_workshare(module, raw, packet_case, plan_sha)
            except (ValueError, KeyError, TypeError, AttributeError) as error:
                raise Problem("The saved original delivery handover is unreadable: " + str(error),
                              422, "INSTALLATION_SOURCE_INVALID") from error
            plan = inputs["plan"]
            source_kind = "delivery-handover"
        if amendment is not None:
            need(isinstance(plan, dict), "Select an original complete Workshare packet before reviewing its phase amendment.")
            selected, _, amendment_receipt = module.selected_packet(
                value, {key: metadata[key] for key in ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt")},
                amendment, {metadata["filename"]: {"raw": raw, "record": metadata}}, {}, metadata["observedAt"])
            plan = selected["workshare_input"]["plan"]
        roots = [("file", value)]
        if isinstance(plan, dict):
            roots.insert(0, ("plan", plan))
        candidates, total = [], 0
        for basis, root in roots:
            pending = [("", root)]
            while pending:
                pointer, item = pending.pop()
                if isinstance(item, dict):
                    pending.extend((pointer + "/" + str(key).replace("~", "~0").replace("/", "~1"), part)
                                   for key, part in reversed(list(item.items())))
                elif isinstance(item, list):
                    pending.extend((pointer + "/" + str(index), part)
                                   for index, part in reversed(list(enumerate(item))))
                elif pointer and not isinstance(item, bool) and isinstance(item, (str, int, float)):
                    try:
                        amount = Decimal(str(item))
                        numeric = amount.is_finite() and amount >= 0
                    except (InvalidOperation, ValueError):
                        numeric = False
                    if numeric:
                        total += 1
                        if len(candidates) < 2000:
                            candidates.append({"basis": basis, "pointer": pointer, "value": item,
                                               "text": str(item)})
        return {"schema": SCHEMA, "file": metadata, "engine": receipt, "jsonText": raw.decode("utf-8"),
                "sourceKind": source_kind, "originalHandover": handover_identity,
                "packet": ({"caseId": packet_case, "plan": deepcopy(plan), "sourceKind": source_kind,
                            "planSha256": raw_hash(module.canonical(plan).encode("utf-8"))}
                           if isinstance(plan, dict) else None),
                "phaseAmendment": deepcopy(amendment), "phaseAmendmentReceipt": amendment_receipt,
                "numericCandidates": candidates, "numericCandidateCount": total,
                "candidatesLimited": total > len(candidates),
                "manualPointerAvailable": True}

    def _preparation(self, case_id, draft_id, preparation_id):
        self._state(case_id, draft_id)
        identifier(preparation_id, PREPARATION_ID, "preparation")
        row = self.db.execute("SELECT body_json FROM ops_installation_source_preparations "
                              "WHERE program_id=? AND draft_id=? AND id=?",
                              (case_id, draft_id, preparation_id)).fetchone()
        need(row is not None, "The complete preparation is not retained.",
             "INSTALLATION_SOURCE_PREPARATION_NOT_FOUND", 404)
        result = json.loads(row[0])
        for file in result["files"]:
            raw = self._blob(case_id, draft_id, file["sha256"])
            need(len(raw) == file["bytes"], "A complete prepared output changed.",
                 "INSTALLATION_SOURCE_CHANGED", 409)
        return result

    def preparation(self, case_id, draft_id, preparation_id):
        with self.workspace.mutex:
            return self._preparation(case_id, draft_id, preparation_id)

    def output(self, case_id, draft_id, preparation_id, filename):
        with self.workspace.mutex:
            result = self._preparation(case_id, draft_id, preparation_id)
            file = next((row for row in result["files"] if row["filename"] == filename), None)
            need(file is not None, "Select an original complete output from this preparation.",
                 "INSTALLATION_SOURCE_FILE_NOT_FOUND", 404)
            return deepcopy(file), self._blob(case_id, draft_id, file["sha256"])

    def export(self, case_id, draft_id, preparation_id):
        with self.workspace.mutex:
            prepared = self._preparation(case_id, draft_id, preparation_id)
            contents = [(f["filename"], self._blob(case_id, draft_id, f["sha256"])) for f in prepared["files"]]
            need(sum(len(raw) for _, raw in contents) <= MAX_ZIP,
                 "The complete preparation ZIP exceeds its 192 MiB archive bound.", status=413)
            manifest = json_bytes(prepared)
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, raw in [*contents, ("INSTALLATION_SOURCE_DESK_PREPARATION.json", manifest)]:
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.external_attr = 0o100600 << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, raw)
            return output.getvalue()

    def _prepare(self, state, context, data):
        module, source = native()
        selected = state["selection"]
        need(isinstance(selected, dict), "Save the complete original source selection before preparing.")
        if selected.get("schema") == "stellar-forge.installation-handover-selection.v1":
            engine, source = native_handover()
            original_key, kind = "handover", "delivery-handover"
        else:
            need(selected.get("schema") == module.SCHEMA, "Select a supported complete original source format.")
            engine, original_key, kind = module, "packet", "workshare-packet"
        need(data.get("expectedEngineSha256") == source["sha256"],
             "Reopen the current installed preparation source before preparing.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        selected = state["selection"]
        need(isinstance(selected, dict) and digest(selected) == data.get("expectedSelectionSha256"),
             "Review and save the complete selected source mapping before preparation.",
             "INSTALLATION_SOURCE_SELECTION_CHANGED", 409)
        need(len(state["preparations"]) < MAX_PREPARATIONS,
             "Retain this complete preparation history and start another named draft.")
        selected_raw = json_bytes(selected)
        need(len(selected_raw) <= MAX_FILE, "The complete native selection exceeds 8 MiB.", status=413)
        preparation_id = "preparation-" + digest({"draft": state["id"], "requestId": context["requestId"],
                                                 "selectionSha256": raw_hash(selected_raw)})
        root = module.private_directory(self.workspace.root / "installation-source-preparation")
        root = module.private_directory(root / state["id"])
        root = module.private_directory(root / preparation_id)
        inputs, outputs = module.private_directory(root / "inputs"), module.private_directory(root / "outputs")
        names = {file["filename"]: file for file in state["files"]}
        need(len(names) == len(state["files"]), "Keep one explicitly selected file for each receiving filename.")
        for file in state["files"]:
            module.retain(inputs / file["filename"], self._blob(state["caseId"], state["id"], file["sha256"]))
        cases = selected.get("cases")
        need(isinstance(cases, list) and 0 < len(cases) <= 20, "Select one to twenty complete original customer cases.")
        need(all(isinstance(case, dict) and isinstance(case.get("profile"), str) for case in cases),
             "Select an installed profile for every complete customer case.")
        profile_ids = {case["profile"] for case in cases}
        pins = data.get("expectedProfiles")
        need(isinstance(pins, dict) and set(pins) == profile_ids,
             "Retain the exact complete selected profile catalogue for this preparation.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        for profile_id in profile_ids:
            need(module.installed_profile(profile_id)["sha256"] == pins[profile_id],
                 "An installed selected profile changed. Reopen its complete source before preparing.",
                 "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        for case in cases:
            need(isinstance(case, dict), "Use the complete native customer selection.")
            need(isinstance(case.get("files"), list), "Select the complete original customer document list.")
            for declared in [case.get(original_key), *case["files"]]:
                need(isinstance(declared, dict) and declared.get("filename") in names,
                     "Select each full original packet/document from this draft's retained files.")
                file = names[declared["filename"]]
                need(declared.get("path") == file["filename"] and
                     all(declared.get(key) == file[key] for key in ("bytes", "sha256", "sourceUrl", "observedAt")) and
                     ("mediaType" not in declared or declared["mediaType"] == file["mediaType"]),
                     "Keep each selected source filename, exact bytes, SHA and provenance bound to this draft.",
                     "INSTALLATION_SOURCE_SELECTION_CHANGED", 409)
        frozen_path = root / "desk-request.json"
        frozen = {"caseId": state["caseId"], "draftId": state["id"], "draftRevision": state["revision"],
                  "requestId": context["requestId"], "actor": context["actor"], "note": context["note"],
                  "selectionSha256": raw_hash(selected_raw), "engineSha256": source["sha256"],
                  "profilePins": pins, "at": context["at"]}
        try:
            original = module.json_object(module.stable_file(frozen_path), "original preparation request")
        except FileNotFoundError:
            module.retain(frozen_path, json_bytes(frozen))
        else:
            need({key: value for key, value in original.items() if key != "at"} ==
                 {key: value for key, value in frozen.items() if key != "at"},
                 "Keep this preparation bound to its original complete request.",
                 "REQUEST_CONFLICT", 409)
            from operations import domain
            domain.timestamp(original["at"], "Original preparation time")
            context["at"] = original["at"]
        module.retain(root / "selection.json", selected_raw)
        report = engine.prepare(root / "selection.json", inputs, outputs)
        returned_profiles = report.get("profiles")
        need(isinstance(returned_profiles, list) and
             all(isinstance(item, dict) and isinstance(item.get("id"), str) and
                 isinstance(item.get("sha256"), str) for item in returned_profiles) and
             len(returned_profiles) == len(pins) and
             {item["id"]: item["sha256"] for item in returned_profiles} == pins,
             "The native preparation used a different complete profile selection. Keep its original outputs for reconciliation.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        current_source = native_handover()[1] if kind == "delivery-handover" else native()[1]
        need(current_source == source, "The original preparation source changed during execution.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        files = []
        for item in [*report["outputs"], report["output"]]:
            name = item["filename"]
            need(name != "INSTALLATION_SOURCE_DESK_PREPARATION.json", "Keep the receiving filename separate from the complete desk manifest.")
            raw = module.stable_file(outputs / name)
            need(len(raw) == item["bytes"] and raw_hash(raw) == item["sha256"],
                 "The native preparation output differs from its complete returned receipt.",
                 "INSTALLATION_SOURCE_CHANGED", 409)
            self._keep_blob(state["caseId"], state["id"], raw)
            files.append({"filename": name, "bytes": len(raw), "sha256": raw_hash(raw),
                          "mediaType": names[name]["mediaType"] if name in names else "application/json",
                          "sourceUrl": names[name]["sourceUrl"] if name in names else selected["sourceUrl"],
                          "observedAt": names[name]["observedAt"] if name in names else selected["observedAt"]})
        need(len({f["filename"] for f in files}) == len(files), "The native output filenames must be complete and unique.")
        result = {"schema": PREPARATION, "id": preparation_id, "caseId": state["caseId"],
                  "draftId": state["id"], "draftRevision": state["revision"],
                  "selectionSha256": raw_hash(selected_raw), "engine": source,
                  "actor": context["actor"], "preparedAt": context["at"],
                  "state": "PREPARED_SOURCE", "report": report, "files": files, "kind": kind,
                  "sourceRoles": {"commissioning": "Supplier_Workshare_Commissioning.json",
                                  "packet": None if kind == "delivery-handover" else "Supplier_Complete_Receiving_Packets.json"}}
        self.db.execute("INSERT INTO ops_installation_source_preparations VALUES(?,?,?,?)",
                        (state["caseId"], state["id"], preparation_id, canonical(result)))
        state["preparations"].append({key: deepcopy(result[key]) for key in
                                      ("id", "draftRevision", "selectionSha256", "preparedAt", "state")})
        return result

    def _receive_native(self, state, context, data):
        package, engine = native_package()
        need(data["expectedEngineSha256"] == engine["sha256"],
             "Review the current complete native source reader before receiving.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        identifier(data["fileId"], FILE_ID, "original package file")
        selected = next((row for row in state["files"] if row["id"] == data["fileId"]), None)
        need(selected is not None and selected["sha256"] == data["expectedSha256"],
             "Select the complete original retained native source ZIP.",
             "INSTALLATION_SOURCE_SELECTION_CHANGED", 409)
        need(selected["filename"].lower().endswith(".zip"),
             "Select the original complete native source-package ZIP.")
        need(len(state["preparations"]) < MAX_PREPARATIONS,
             "Keep this complete preparation history and begin another named draft.")
        module, _ = native()
        profile = module.installed_profile("canadabuys-bidder-desk")
        need(profile["sha256"] == data["expectedProfileSha256"],
             "Review the complete current installed CanadaBuys profile.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        raw = self._blob(state["caseId"], state["id"], selected["sha256"])
        try:
            verified = package.receive_archive(raw)
            review = package.review(verified)
        except (ValueError, KeyError, TypeError, OSError, zipfile.BadZipFile) as error:
            raise Problem("The complete native source package is unreadable: " + str(error),
                          422, "INSTALLATION_SOURCE_INVALID") from error
        need(selected["filename"] not in verified["files"] and
             selected["filename"] != package.MANIFEST,
             "Keep the original archive filename distinct from its complete native members.")
        need(native_package()[1] == engine and module.installed_profile(profile["id"]) == profile,
             "The installed source/profile selection changed during receiving.",
             "INSTALLATION_SOURCE_ENGINE_CHANGED", 409)
        preparation_id = "preparation-" + digest({
            "draft": state["id"], "requestId": context["requestId"],
            "kind": "canadabuys-native-workshare", "archiveSha256": selected["sha256"]})
        source = verified["source"]
        provenance = {row["filename"]: row for row in verified["preparation"]["originalSources"]}
        outputs = []
        for name, content in verified["files"].items():
            self._keep_blob(state["caseId"], state["id"], content)
            original = provenance.get(name)
            outputs.append({"filename": name, "bytes": len(content), "sha256": raw_hash(content),
                            "mediaType": "application/json",
                            "sourceUrl": original["sourceUrl"] if original else source["sourceUrl"],
                            "observedAt": original["observedAt"] if original else source["observedAt"]})
        # The original ZIP also travels with the complete desk export and case,
        # preserving the actual incoming archive and its original file receipt.
        outputs.append({key: selected[key] for key in
                        ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt")})
        report = {**deepcopy(verified["preparation"]), "nativeReview": review,
                  "profiles": [deepcopy(profile)],
                  "cases": [{"caseId": row["caseId"], "planSha256": row["planSha256"],
                             "completeEffort": {"hours": row["hours"]},
                             "profile": "canadabuys-bidder-desk"}
                            for row in verified["workshares"]]}
        state["selection"] = deepcopy(verified["selection"])
        result = {"schema": PREPARATION, "id": preparation_id, "caseId": state["caseId"],
                  "draftId": state["id"], "draftRevision": state["revision"],
                  "selectionSha256": raw_hash(verified["files"]["SOURCE_SELECTION.json"]),
                  "engine": engine, "actor": context["actor"], "preparedAt": context["at"],
                  "state": "PREPARED_SOURCE", "kind": "canadabuys-native-workshare",
                  "report": report, "files": outputs,
                  "originalArchive": deepcopy(selected),
                  "sourceRoles": {"commissioning": "CANADABUYS_NATIVE_WORKSHARES.json",
                                  "packet": source["originalPackage"]["filename"]}}
        self.db.execute("INSERT INTO ops_installation_source_preparations VALUES(?,?,?,?)",
                        (state["caseId"], state["id"], preparation_id, canonical(result)))
        state["preparations"].append({key: deepcopy(result[key]) for key in
                                      ("id", "draftRevision", "selectionSha256", "preparedAt", "state", "kind")})
        return result

    def commissioning_archive_inspect(self, case_id, draft_id, body):
        return commissioning_archive.inspect(self, case_id, draft_id, body)

    def commissioning_inspect(self, case_id, draft_id, body):
        return merchant_commissioning.inspect(self, case_id, draft_id, body)

    def commissioning_preview(self, case_id, draft_id, body):
        return merchant_commissioning.preview(self, case_id, draft_id, body)

    def _attach(self, state, context, data):
        prepared = self._preparation(state["caseId"], state["id"], data.get("preparationId"))
        need(data.get("expectedSelectionSha256") == prepared["selectionSha256"],
             "Keep the reviewed complete preparation selection.", "INSTALLATION_SOURCE_SELECTION_CHANGED", 409)
        expected = integer(data.get("expectedVersion"), "Operations case version", 1, 10000000)
        case = self.ops._context(state["caseId"])
        need(case["program"]["version"] == expected, "The original case changed. Review its current sources before attachment.",
             "OPERATIONS_CONFLICT", 409)
        needed, selected = [], []
        for file in prepared["files"]:
            existing = next((f for f in case["sources"].values() if all(f.get(key) == file[key] for key in
                             ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt"))), None)
            if existing:
                metadata, raw = self.ops.source(state["caseId"], existing["id"])
                need(raw == self._blob(state["caseId"], state["id"], file["sha256"]),
                     "The original case source differs from this complete preparation.", "SOURCE_CHANGED", 409)
                selected.append({**deepcopy(file), "sourceId": metadata["id"], "reused": True})
            else:
                needed.append(file)
        need(sum(f["bytes"] for f in case["sources"].values()) + sum(f["bytes"] for f in needed) <= 24 * 1024 * 1024
             and len(case["sources"]) + len(needed) <= 200,
             "The complete prepared cohort will not fit this original case's 24 MiB / 200-source bound. "
             "Keep the prepared files and select an appropriate original case; no partial attachment was made.",
             "INSTALLATION_SOURCE_CASE_CAPACITY", 413)
        for file in needed:
            result = self.ops.command(state["caseId"], {
                "expectedVersion": expected, "actor": context["actor"], "note": context["note"],
                "action": "source.add", "requestId": context["requestId"],
                "data": {key: file[key] for key in ("filename", "mediaType", "sourceUrl", "observedAt")} |
                        {"kind": "other", "contentBase64": base64.b64encode(
                            self._blob(state["caseId"], state["id"], file["sha256"])).decode("ascii")}},
                _within_transaction=True)
            expected = result["version"]
            metadata, raw = self.ops.source(state["caseId"], result["recordId"])
            need(raw_hash(raw) == file["sha256"] and len(raw) == file["bytes"],
                 "The original source writer returned another file.", "SOURCE_CHANGED", 409)
            selected.append({**deepcopy(file), "sourceId": metadata["id"], "reused": False})
        by_name = {row["filename"]: row for row in selected}
        roles = prepared.get("sourceRoles", {"commissioning": "Supplier_Workshare_Commissioning.json",
                                            "packet": "Supplier_Complete_Receiving_Packets.json"})
        commissioning = by_name[roles["commissioning"]]
        packets = by_name[roles["packet"]] if roles["packet"] is not None else None
        source_selection = {"expectedVersion": expected, "sourceId": commissioning["sourceId"],
                            "expectedSourceSha256": commissioning["sha256"],
                            "packetSourceId": packets["sourceId"] if packets is not None else None,
                            "expectedPacketSha256": packets["sha256"] if packets is not None else None}
        inventory = workshares.case_inventory(self.ops, self.ops._context(state["caseId"]), source_selection)
        receipt = {"schema": PREPARATION, "state": "ATTACHED_SOURCES", "caseId": state["caseId"],
                   "draftId": state["id"], "preparationId": prepared["id"],
                   "version": expected, "sources": selected, "selection": source_selection, "workshares": inventory}
        state["attachments"].append(deepcopy(receipt))
        return receipt

    def edition_compare(self, case_id, draft_id, body):
        return source_editions.compare(self, case_id, draft_id, body)

    def edition_preview(self, case_id, draft_id, body):
        return source_editions.preview(self, case_id, draft_id, body)

    def mapping_compare(self, case_id, draft_id, body):
        return mapping_reconciliation.compare(self, case_id, draft_id, body)

    def mapping_preview(self, case_id, draft_id, body):
        return mapping_reconciliation.preview(self, case_id, draft_id, body)

    def command(self, case_id, draft_id, body):
        identifier(draft_id, DRAFT_ID, "source draft")
        exact(body, ("requestId", "expectedRevision", "actor", "note", "action", "data"),
              ("requestId", "expectedRevision", "actor", "action", "data"), "source-desk request")
        request_id = short_id(body["requestId"], "Original source-desk request ID")
        actor, note = text(body["actor"], "Recording operator", 300, True), text(body.get("note", ""), "Preparation note", 12000)
        action = body["action"]
        need(action in ("create", "file.add", "file.remove", "selection.save", "prepare", "native.receive", "attach", "commissioning.attach", "commissioning.archive.receive", "edition.apply", "mapping.apply"),
             "Choose a supported original source preparation action.")
        need(isinstance(body["data"], dict), "Use the complete source action data.")
        expected = integer(body["expectedRevision"], "source draft revision")
        payload = {"schema": SCHEMA, "caseId": case_id, "draftId": draft_id, "body": body}
        request_sha256 = digest(payload)

        def apply():
            self._case(case_id)
            context = {"requestId": request_id, "actor": actor, "note": note, "at": now()}
            if action == "create":
                need(expected == 0, "A new source draft starts at revision zero.")
                need(self.db.execute("SELECT 1 FROM ops_installation_source_drafts WHERE program_id=? AND id=?",
                                     (case_id, draft_id)).fetchone() is None,
                     "This source draft already exists. Reopen its current edition.", "INSTALLATION_SOURCE_CONFLICT", 409)
                count = self.db.execute("SELECT COUNT(*) FROM ops_installation_source_drafts WHERE program_id=?",
                                        (case_id,)).fetchone()[0]
                need(count < 200, "This case already retains 200 complete source drafts.", status=413)
                exact(body["data"], ("title",), ("title",), "new source draft")
                before = None
                state = {"schema": SCHEMA, "caseId": case_id, "id": draft_id, "revision": 0,
                         "title": text(body["data"]["title"], "Preparation title", 300, True),
                         "createdAt": context["at"], "updatedAt": context["at"], "files": [],
                         "selection": None, "preparations": [], "attachments": [], "history": []}
                result = None
            else:
                before = self._state(case_id, draft_id)
                need(before["revision"] == expected, "The source draft changed. Reopen and reconcile its current edition.",
                     "INSTALLATION_SOURCE_CONFLICT", 409)
                state, data, result = deepcopy(before), body["data"], None
                if action == "file.add":
                    exact(data, ("filename", "mediaType", "sourceUrl", "observedAt", "bytes", "sha256", "contentBase64"),
                          ("filename", "mediaType", "sourceUrl", "observedAt", "bytes", "sha256", "contentBase64"), "original file")
                    module, _ = native()
                    name = data["filename"]
                    need(isinstance(name, str) and module.FILENAME.fullmatch(name) is not None and
                         name not in module.RESERVED and name != "INSTALLATION_SOURCE_DESK_PREPARATION.json",
                         "Use a native receiving filename with letters, numbers, dots, underscores or hyphens.")
                    need(isinstance(data["contentBase64"], str) and len(data["contentBase64"]) <= ((MAX_FILE + 2) // 3) * 4,
                         "The full original upload exceeds 8 MiB.", status=413)
                    try:
                        raw = base64.b64decode(data["contentBase64"], validate=True)
                    except (binascii.Error, ValueError) as error:
                        raise Problem("Send the complete original file as ordinary base64.", 422, "INSTALLATION_SOURCE_INVALID") from error
                    integer(data["bytes"], "source file byte count", 1, MAX_FILE)
                    identifier(data["sha256"], SHA, "source file SHA-256")
                    need(len(raw) == data["bytes"] and raw_hash(raw) == data["sha256"],
                         "The uploaded original file differs from its length/SHA selection.", "INSTALLATION_SOURCE_CHANGED", 409)
                    need(not any(f["filename"] == name for f in state["files"]),
                         "That receiving filename is already selected. Remove its current selection before choosing another original edition.",
                         "INSTALLATION_SOURCE_FILENAME_CONFLICT", 409)
                    need(sum(f["bytes"] for f in state["files"]) + len(raw) <= MAX_INPUTS,
                         "The complete selected original input exceeds 64 MiB.", status=413)
                    from operations import domain
                    file = {"id": "input-" + digest({"filename": name, "sha256": data["sha256"]}),
                            "filename": name, **self._keep_blob(case_id, draft_id, raw),
                            "mediaType": data["mediaType"],
                            "sourceUrl": domain.url(data["sourceUrl"], "Original source URL"),
                            "observedAt": domain.timestamp(data["observedAt"], "Source observation")}
                    need(isinstance(file["mediaType"], str) and module.MEDIA_TYPE.fullmatch(file["mediaType"]) is not None,
                         "Use the complete original MIME media type.")
                    state["files"].append(file)
                    result = {"file": file}
                elif action == "file.remove":
                    exact(data, ("fileId",), ("fileId",), "original file selection")
                    identifier(data["fileId"], FILE_ID, "source file")
                    need(any(f["id"] == data["fileId"] for f in state["files"]), "Select a file in the current draft.")
                    state["files"] = [f for f in state["files"] if f["id"] != data["fileId"]]
                elif action == "selection.save":
                    if set(data) == {"selectionJSON"}:
                        selected = mapping_reconciliation.read_selection_json(data["selectionJSON"])
                    else:
                        exact(data, ("selection",), ("selection",), "complete native source selection")
                        selected = data["selection"]
                    need(isinstance(selected, dict) and len(json_bytes(selected)) <= MAX_FILE,
                         "Keep the complete editable native selection within 8 MiB.", status=413)
                    state["selection"] = deepcopy(selected)
                elif action == "mapping.apply":
                    result = mapping_reconciliation.apply(self, state, data, context)
                elif action == "edition.apply":
                    result = source_editions.apply(self, state, data, context)
                elif action == "prepare":
                    exact(data, ("expectedEngineSha256", "expectedSelectionSha256", "expectedProfiles"),
                          ("expectedEngineSha256", "expectedSelectionSha256", "expectedProfiles"), "reviewed preparation")
                    result = self._prepare(state, context, data)
                elif action == "native.receive":
                    exact(data, ("fileId", "expectedSha256", "expectedEngineSha256", "expectedProfileSha256"),
                          ("fileId", "expectedSha256", "expectedEngineSha256", "expectedProfileSha256"),
                          "complete native source-package receiving")
                    result = self._receive_native(state, context, data)
                elif action == "commissioning.archive.receive":
                    result = commissioning_archive.receive(self, state, context, data)
                elif action == "commissioning.attach":
                    result = merchant_commissioning.attach(self, state, context, data)
                elif action == "attach":
                    exact(data, ("preparationId", "expectedSelectionSha256", "expectedVersion"),
                          ("preparationId", "expectedSelectionSha256", "expectedVersion"), "reviewed case attachment")
                    result = self._attach(state, context, data)
            saved = self._append(state, before, action, context, request_sha256)
            return {"schema": SCHEMA, "requestId": request_id, "requestSha256": request_sha256,
                    "draft": saved, "result": result}
        result = self.workspace._transaction(request_id, payload, apply)
        return self._verify_receipt(result)

    def _verify_receipt(self, result):
        with self.workspace.mutex:
            draft = result["draft"]
            for file in draft["files"]:
                raw = self._blob(draft["caseId"], draft["id"], file["sha256"])
                need(len(raw) == file["bytes"], "A retained request source differs from its original receipt.",
                     "INSTALLATION_SOURCE_CHANGED", 409)
            returned = result.get("result")
            if isinstance(returned, dict) and returned.get("state") == "PREPARED_SOURCE":
                need(self._preparation(draft["caseId"], draft["id"], returned["id"]) == returned,
                     "The complete original preparation receipt differs.", "INSTALLATION_SOURCE_CHANGED", 409)
            elif isinstance(returned, dict) and returned.get("state") == "RECONCILED_SOURCE_MAPPING":
                mapping_reconciliation.verify_receipt(self, draft, returned)
            elif isinstance(returned, dict) and returned.get("state") == "EDITABLE_SOURCE_EDITION":
                source_editions.verify_receipt(self, draft, returned)
            elif isinstance(returned, dict) and returned.get("state") == "RECEIVED_COMMISSIONING_ARCHIVE":
                commissioning_archive.verify_receipt(self, returned)
            elif isinstance(returned, dict) and returned.get("state") == "ATTACHED_COMMISSIONING":
                merchant_commissioning.verify_receipt(self, returned)
            elif isinstance(returned, dict) and returned.get("state") == "ATTACHED_SOURCES":
                for file in returned["sources"]:
                    metadata, raw = self.ops.source(draft["caseId"], file["sourceId"])
                    need(len(raw) == file["bytes"] and raw_hash(raw) == file["sha256"] and
                         all(metadata.get(key) == file[key] for key in
                             ("filename", "bytes", "sha256", "mediaType", "sourceUrl", "observedAt")),
                         "An original attached source differs from its accepted receipt.", "SOURCE_CHANGED", 409)
            return result

    def request(self, case_id, draft_id, request_id):
        with self.workspace.mutex:
            self._case(case_id)
            identifier(draft_id, DRAFT_ID, "source draft")
            short_id(request_id, "Original request ID")
            row = self.db.execute("SELECT result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if row is None:
                return {"schema": SCHEMA, "requestId": request_id, "state": "NOT_RECORDED"}
            result = json.loads(row[0])
            need(result.get("schema") == SCHEMA and result.get("draft", {}).get("caseId") == case_id and
                 result["draft"].get("id") == draft_id, "This request belongs to another original operation.",
                 "REQUEST_CONFLICT", 409)
            return {"schema": SCHEMA, "requestId": request_id, "state": "RECORDED", "result": self._verify_receipt(result)}


def register_static(static):
    static.update({
        "/operations_installation_sources.mjs": ("operations_installation_sources.mjs", "text/javascript; charset=utf-8"),
        "/operations_installation_source_editions.mjs": ("operations_installation_source_editions.mjs", "text/javascript; charset=utf-8"),
        "/operations_installation_mapping_reconciliation.mjs": ("operations_installation_mapping_reconciliation.mjs", "text/javascript; charset=utf-8"),
        "/operations_installation_source_collection.mjs": ("operations_installation_source_collection.mjs", "text/javascript; charset=utf-8"),
        "/operations_installation_commissioning.mjs": ("operations_installation_commissioning.mjs", "text/javascript; charset=utf-8"),
        "/operations_installation_sources.css": ("operations_installation_sources.css", "text/css; charset=utf-8"),
        "/operations_installation_source_hash.mjs": ("operations_installation_source_hash.mjs", "text/javascript; charset=utf-8"),
        "/installation-prepare-core.mjs": ("../../sf49_data_commissioning/installation-workorders/prepare-core.mjs", "text/javascript; charset=utf-8"),
        "/installation-workorders/customer-programme-core.mjs": ("../../sf49_data_commissioning/installation-workorders/customer-programme-core.mjs", "text/javascript; charset=utf-8"),
        "/installation-workorders/commercial-workshare-core.mjs": ("../../sf49_data_commissioning/installation-workorders/commercial-workshare-core.mjs", "text/javascript; charset=utf-8"),
        "/installation-workorders/recurring-core.mjs": ("../../sf49_data_commissioning/installation-workorders/recurring-core.mjs", "text/javascript; charset=utf-8"),
    })


def mapping_http_result(result):
    """Transport exact mapping receipt bytes; never alter the stored request result."""
    returned = result.get("result")
    draft = result.get("draft", {})
    history = draft.get("history", [])
    selected_text = bool(history and history[-1].get("action") == "selection.save")
    if (isinstance(returned, dict) and returned.get("state") == "RECONCILED_SOURCE_MAPPING") or draft.get("mappingReconciliations") or selected_text:
        return {**result, "nativeMapping": mapping_reconciliation.wire(result, include_value=False)}
    return result


def handle(handler, parsed, operations, method):
    """Join the existing authenticated handler after its original guard."""
    from urllib.parse import parse_qs, unquote
    mapping_path = re.fullmatch(
        r"/api/operations/(operation-[a-f0-9]{32})/installation-sources/"
        r"(source-desk-[a-f0-9]{32})/mappings/(compare|preview|compare-wire|preview-wire|draft-wire)", parsed.path)
    if mapping_path:
        need(method == "POST" and not parsed.query, "Read one complete original mapping comparison or preview.", status=405)
        case_id, draft_id, action = mapping_path.groups()
        desk = SourceDesk(operations)
        body = handler.json_body()
        if action == "draft-wire":
            exact(body, ("revision",), ("revision",), "exact native source draft")
            revision = body["revision"]
            need(revision is None or type(revision) is int and 1 <= revision <= 10000,
                 "Select the complete current or historical original draft.")
            value = desk.get(case_id, draft_id, revision)
        else:
            selected = desk.mapping_compare if action.startswith("compare") else desk.mapping_preview
            value = selected(case_id, draft_id, body)
        handler.send(200, mapping_reconciliation.wire(value) if action.endswith("-wire") else value)
        return True
    edition_path = re.fullmatch(
        r"/api/operations/(operation-[a-f0-9]{32})/installation-sources/"
        r"(source-desk-[a-f0-9]{32})/editions/(compare|preview)", parsed.path)
    if edition_path:
        need(method == "POST" and not parsed.query, "Read one complete original edition comparison or preview.", status=405)
        case_id, draft_id, action = edition_path.groups()
        desk = SourceDesk(operations)
        selected = desk.edition_compare if action == "compare" else desk.edition_preview
        handler.send(200, selected(case_id, draft_id, handler.json_body()))
        return True
    commissioning_path = re.fullmatch(
        r"/api/operations/(operation-[a-f0-9]{32})/installation-sources/"
        r"(source-desk-[a-f0-9]{32})/commissioning/(inspect|preview|archive-inspect)", parsed.path)
    if commissioning_path:
        need(method == "POST" and not parsed.query, "Review one original commissioning capture.", status=405)
        case_id, draft_id, action = commissioning_path.groups()
        desk = SourceDesk(operations)
        read = {"inspect": desk.commissioning_inspect, "preview": desk.commissioning_preview,
                "archive-inspect": desk.commissioning_archive_inspect}[action]
        handler.send(200, read(case_id, draft_id, handler.json_body()))
        return True
    global_path = "/api/operations/installation-source-profiles"
    match = re.fullmatch(
        r"/api/operations/(operation-[a-f0-9]{32})/installation-sources"
        r"(?:/(source-desk-[a-f0-9]{32})(?:/(files/(input-[a-f0-9]{64})(/inspect)?"
        r"|preparations/(preparation-[a-f0-9]{64})(?:/(archive|outputs/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})))?"
        r"|requests/([A-Za-z0-9][A-Za-z0-9._-]{0,99})))?)?", parsed.path)
    if parsed.path != global_path and not match:
        return False
    desk = SourceDesk(operations)
    query = parse_qs(parsed.query)
    if parsed.path == global_path:
        need(method == "GET" and not query, "Use the complete profile catalogue read.", status=405)
        handler.send(200, desk.profiles())
        return True
    case_id, draft_id, tail, file_id, inspection, preparation_id, action, filename, request_id = match.groups()
    if method == "POST" and file_id and inspection:
        need(not query, "Review one complete original source and its selected phase amendment.")
        body = handler.json_body()
        exact(body, ("revision", "phaseIdAmendment"), ("revision",), "source inspection")
        handler.send(200, desk.inspect(case_id, draft_id, file_id, body["revision"], body.get("phaseIdAmendment")))
        return True
    if method == "POST":
        need(draft_id is not None and tail is None and not query, "Post one original source-desk request.", status=405)
        handler.send(200, mapping_http_result(desk.command(case_id, draft_id, handler.json_body())))
        return True
    need(method == "GET", "Use a supported source-desk read or command.", status=405)
    revision = query.get("revision", [None])[0]
    if revision is not None:
        need(re.fullmatch(r"[1-9][0-9]*", revision) is not None, "Select an original source draft revision.")
        revision = int(revision)
    if draft_id is None:
        need(not query, "Open the complete case source-draft list.")
        handler.send(200, desk.list(case_id))
    elif tail is None:
        need(not set(query) - {"revision"}, "Select an original source draft edition.")
        handler.send(200, desk.get(case_id, draft_id, revision))
    elif file_id:
        need(not set(query) - ({"revision"} if inspection else {"revision", "expectedSha256"}),
             "Select one original source file and edition.")
        if inspection:
            handler.send(200, desk.inspect(case_id, draft_id, file_id, revision))
        else:
            metadata, raw = desk.file(case_id, draft_id, file_id, revision)
            need(query.get("expectedSha256", [None])[0] == metadata["sha256"],
                 "Keep the download bound to the selected original file SHA.",
                 "INSTALLATION_SOURCE_CHANGED", 409)
            handler.send(200, raw, metadata["mediaType"], metadata["filename"])
    elif request_id:
        need(not query, "Read the original source-desk request receipt.")
        value = desk.request(case_id, draft_id, request_id)
        if value.get("state") == "RECORDED":
            value = {**value, "result": mapping_http_result(value["result"])}
        handler.send(200, value)
    elif preparation_id and action is None:
        need(not query, "Read the complete original preparation.")
        handler.send(200, desk.preparation(case_id, draft_id, preparation_id))
    elif preparation_id and action == "archive":
        need(not set(query) - {"describe", "expectedSha256"}, "Select the complete preparation archive.")
        raw = desk.export(case_id, draft_id, preparation_id)
        receipt = {"filename": preparation_id + ".zip", "bytes": len(raw), "sha256": raw_hash(raw),
                   "mediaType": "application/zip", "preparationId": preparation_id}
        if query.get("describe", [None])[0] == "1":
            handler.send(200, receipt)
        else:
            need(query.get("expectedSha256", [None])[0] == receipt["sha256"],
                 "Keep the full archive bound to its current complete byte receipt.",
                 "INSTALLATION_SOURCE_CHANGED", 409)
            handler.send(200, raw, receipt["mediaType"], receipt["filename"])
    elif preparation_id and filename:
        need(not set(query) - {"expectedSha256"}, "Select one complete prepared output.")
        metadata, raw = desk.output(case_id, draft_id, preparation_id, unquote(filename))
        need(query.get("expectedSha256", [None])[0] == metadata["sha256"],
             "Keep the download bound to its exact complete output SHA.",
             "INSTALLATION_SOURCE_CHANGED", 409)
        handler.send(200, raw, metadata["mediaType"], metadata["filename"])
    else:
        fail("Original source-desk resource not found.", "INSTALLATION_SOURCE_NOT_FOUND", 404)
    return True
