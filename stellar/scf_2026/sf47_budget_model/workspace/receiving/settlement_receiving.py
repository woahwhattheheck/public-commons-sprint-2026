#!/usr/bin/env python3
"""Operate and receive the original paid SCF settlement case, preserving its native requests."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import traceback
import uuid
import zipfile

SCHEMA = "scf.grantops.settlement-operating-receiving.v1"
OPERATION = "SCF-GRANTOPS-SETTLEMENT-RECEIVING-20261012-F3BE"
INPUT_SHA256 = "90424a4c8de5652cc589bb42046efea3c564f47888da000fbc0eb928f93df217"
INPUT_BYTES = 801356
PAID_ARCHIVE_SHA256 = "a32b26a32a8d70b08025d22cfb3c0caf7203d4d93bb225813638dbdd48d1029b"
PERIOD_ARCHIVE_SHA256 = "5a203656b68b8772cc04327674ef88da3c7e521727b42938fb1a0e66a35abc03"
EVENT_ID = "ca74acb159186d71591b2967c1bf214c9c2a5cc0d6586574ac15f2448fc3eba6"
OBSERVED_DATE = "2026-10-11"
PREFIX = Path("stellar/scf_2026/sf47_budget_model")
ACTOR = "Original settlement receiving operator"
UNIT_NOTE = ("Original Stellar testnet XLM uses seven decimal places: 50,000 stroops "
             "is exactly 0.005 XLM. The retained evidence is the original recovered "
             "transfer; the dated observation is 2026-10-11.")
BASIS_NOTE = ("The source records an original testnet transfer and its recovery observation. "
              "This case retains that evidence and the reviewed cash classification.")

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")

def read_json(path):
    return json.loads(Path(path).read_bytes())

def safe(root, relative):
    root = Path(root).resolve()
    require(isinstance(relative, str) and relative, "A retained relative path is required.")
    parts = PurePosixPath(relative)
    require(not parts.is_absolute() and str(parts) == relative
            and all(part not in ("", ".", "..") for part in parts.parts),
            "A retained path is not a plain relative file.")
    current = root
    for part in parts.parts:
        current = current / part
        require(not current.is_symlink(), "A retained path contains a symlink: " + relative)
    return current

def regular_bytes(path):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        first = os.fstat(descriptor)
        require(stat.S_ISREG(first.st_mode), "Expected a regular retained file: " + str(path))
        with os.fdopen(os.dup(descriptor), "rb") as handle:
            raw = handle.read()
        last = os.fstat(descriptor)
        require((first.st_dev, first.st_ino, first.st_size, first.st_mtime_ns)
                == (last.st_dev, last.st_ino, last.st_size, last.st_mtime_ns),
                "The selected file changed while being read: " + str(path))
        return raw
    finally:
        os.close(descriptor)

def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def immutable(path, raw):
    """Reuse exact completed bytes before allocating another temporary file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() or path.is_symlink():
        require(regular_bytes(path) == raw, "The retained selection changed: " + str(path))
        return path
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent,
                                         prefix=path.name + ".", suffix=".pending",
                                         delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o600)
        try:
            os.link(temporary, path, follow_symlinks=False)
            fsync_directory(path.parent)
        except FileExistsError:
            require(regular_bytes(path) == raw, "The retained selection changed: " + str(path))
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path

def replace_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent,
                                         prefix=path.name + ".", suffix=".pending",
                                         delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(encoded(value))
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, path)
        temporary = None
        fsync_directory(path.parent)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def describe(path, root=None):
    path = Path(path)
    raw = regular_bytes(path)
    return {"path": str(path.relative_to(root)) if root else str(path),
            "bytes": len(raw), "sha256": digest(raw)}

def file_receipt(path, raw, root):
    immutable(path, raw)
    return describe(path, root)

def identity_bytes(value, label):
    require(isinstance(value, dict) and value.get("encoding") == "base64",
            "The original encoded source is required: " + label)
    raw = base64.b64decode(value["content_base64"], validate=True)
    require(len(raw) == value["bytes"] and digest(raw) == value["sha256"],
            "The original source identity differs: " + label)
    return raw

def complete_source(source_root, source_manifest):
    """Verify the selected complete repository-relative application/import closure."""
    source_root = Path(source_root).resolve()
    raw = regular_bytes(source_manifest)
    manifest = json.loads(raw)
    require(manifest.get("schema") == "scf.grantops.settlement-source-selection.v1",
            "Select the complete original GrantOps source manifest.")
    require(manifest.get("repository") == "woahwhattheheck/tjlabs-stellar-merchant-workspace",
            "The original GrantOps repository identity differs.")
    require(re.fullmatch(r"[0-9a-f]{40}", manifest.get("source_ref", "")),
            "Select the exact coherent GrantOps source revision.")
    files = manifest.get("files")
    require(isinstance(files, list) and files, "The complete source member census is required.")
    seen, total = set(), 0
    for entry in files:
        relative = entry["path"]
        require(relative not in seen, "The source selection repeats a file.")
        seen.add(relative)
        body = regular_bytes(safe(source_root, relative))
        require(len(body) == entry["bytes"] and digest(body) == entry["sha256"],
                "The original source member differs: " + relative)
        total += len(body)
    required = [str(PREFIX / "sf10_current_candidate.json"),
                str(PREFIX / "workspace/model.py"),
                str(PREFIX / "workspace/operations.py"),
                str(PREFIX / "workspace/merchant_settlement_handoff.mjs")]
    require(all(path in seen for path in required),
            "The complete source selection omits an original operating entrypoint.")
    return {"repository": manifest["repository"], "sourceRef": manifest["source_ref"],
            "sourceManifest": describe(source_manifest), "files": len(files),
            "bytes": total, "manifestSha256": digest(raw)}

def prepare_inputs(frame_path, directory):
    frame = regular_bytes(frame_path)
    require(len(frame) == INPUT_BYTES and digest(frame) == INPUT_SHA256,
            "Select the retained complete original paid + paid-period source frame.")
    packet = json.loads(frame)
    require(packet.get("schema") == "commons.original-merchant-accountant-source.v1",
            "The original accountant source frame schema differs.")
    members, metadata = {}, {}
    for entry in packet["files"]:
        path = entry["path"]
        require(path not in members, "The original source frame repeats a member.")
        safe(directory, path)
        members[path] = identity_bytes(entry, path)
        metadata[path] = {"path": path, "bytes": entry["bytes"], "sha256": entry["sha256"]}
    require(len(members) == 67 and sum(map(len, members.values())) == 328467,
            "The original complete source census differs.")
    profiles = {row["selection"]: row for row in packet["profiles"]}
    require(profiles["paid"]["archive_sha256"] == PAID_ARCHIVE_SHA256,
            "The original paid accountant archive selection differs.")
    original_container = identity_bytes(packet["archive"], "original accountant container")
    with zipfile.ZipFile(io.BytesIO(original_container)) as archive:
        candidates = [info for info in archive.infolist()
                      if not info.is_dir() and PurePosixPath(info.filename).name
                         == "paid-accountant-handoff.tar"]
        require(len(candidates) == 1, "The original paid accountant TAR is not unique.")
        original_paid = archive.read(candidates[0])
    require(digest(original_paid) == PAID_ARCHIVE_SHA256,
            "The exact original paid accountant TAR differs.")
    selection = {path.removeprefix("paid/"): body for path, body in members.items()
                 if path.startswith("paid/") and not path.startswith("paid/accounting-output/")}
    require(len(selection) == 16 and len([x for x in selection if x.startswith("sources/")]) == 7,
            "Keep the original nine packet members and seven bound original source members.")
    original_manifest = json.loads(selection["packet-manifest.json"])
    # The merchant engine performs the original packet, source and transfer validation.
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, body in sorted(selection.items()):
            safe(directory, name)
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(body), 0o600, 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            archive.addfile(info, io.BytesIO(body))
    paid = output.getvalue()
    period = identity_bytes(profiles["paid-period"]["original_close_archive"],
                            "original paid-period close TAR")
    require(len(period) == 61440 and digest(period) == PERIOD_ARCHIVE_SHA256,
            "The unchanged complete paid-period TAR differs.")
    original_dir = directory / "original"
    original_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    selected = {
        "schema": SCHEMA + ".source-selection",
        "operation": OPERATION,
        "sourceFrame": {"bytes": len(frame), "sha256": digest(frame)},
        "sourceObservationDate": OBSERVED_DATE,
        "eventId": EVENT_ID, "network": "stellar:testnet", "amountAtomic": "50000",
        "paid": {
            "originalArchive": file_receipt(original_dir / "paid-accountant-original.tar",
                                           original_paid, directory),
            "selectedArchive": file_receipt(original_dir / "paid-accountant-with-sources.tar",
                                           paid, directory),
            "construction": "Exact nine original accountant members plus seven manifest-bound original source members in a plain TAR.",
            "members": [{"path": path, "bytes": len(body), "sha256": digest(body)}
                        for path, body in sorted(selection.items())],
            "runId": profiles["paid"]["run_id"],
            "handoffId": profiles["paid"]["handoff_id"],
            "returnId": profiles["paid"]["return_id"]
        },
        "paidPeriod": {
            "selectedArchive": file_receipt(original_dir / "paid-period-close-original.tar",
                                           period, directory),
            "runId": profiles["paid-period"]["run_id"],
            "handoffId": profiles["paid-period"]["handoff_id"],
            "close": deepcopy(profiles["paid-period"]["close"]),
        },
    }
    immutable(directory / "SOURCE_SELECTION.json", encoded(selected))
    return selected

class Programme:
    """Retain only this programme's selections; native cases own every domain transaction."""
    def __init__(self, directory, selection):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.requests = self.directory / "requests"
        self.receipts = self.directory / "receipts"
        self.requests.mkdir(exist_ok=True, mode=0o700)
        self.receipts.mkdir(exist_ok=True, mode=0o700)
        immutable(self.directory / "PROGRAMME.json", encoded(selection))
        self.selection_sha256 = digest(encoded(selection))

    def request_id(self, phase):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, OPERATION + ":" + phase))

    def receipt(self, phase):
        path = self.receipts / (phase + ".json")
        if not path.exists():
            return None
        value = read_json(path)
        require(value.get("operation") == OPERATION
                and value.get("selectionSha256") == self.selection_sha256
                and value.get("phase") == phase, "The original phase receipt changed.")
        return value

    def phase(self, phase, produce):
        saved = self.receipt(phase)
        if saved is not None:
            return deepcopy(saved["result"])
        print(json.dumps({"operation": OPERATION, "phase": phase, "state": "running",
                          "at": now()}, sort_keys=True), flush=True)
        result = produce()
        value = {"schema": SCHEMA + ".phase", "operation": OPERATION,
                 "selectionSha256": self.selection_sha256, "phase": phase,
                 "completedAt": now(), "result": result}
        immutable(self.receipts / (phase + ".json"), encoded(value))
        print(json.dumps({"operation": OPERATION, "phase": phase, "state": "complete",
                          "at": value["completedAt"]}, sort_keys=True), flush=True)
        return deepcopy(result)

    def request(self, phase, prepare, invoke):
        def run():
            path = self.requests / (phase + ".json")
            if path.exists():
                body = read_json(path)
            else:
                body = prepare(self.request_id(phase))
                immutable(path, encoded(body))
            return {"requestId": self.request_id(phase), "requestSha256": digest(encoded(body)),
                    "result": invoke(deepcopy(body))}
        return self.phase(phase, run)["result"]

    def completed(self):
        result = []
        for path in sorted(self.receipts.glob("*.json")):
            value = self.receipt(path.stem)
            result.append({"phase": value["phase"], "completedAt": value["completedAt"],
                           "receipt": describe(path, self.directory)})
        return result

def unit_choice():
    return {"currency": "XLM", "decimals": 7, "unitSourceIds": [], "unitNote": UNIT_NOTE}

def cash_choice(category):
    return {**unit_choice(), "date": OBSERVED_DATE, "usdValue": None,
            "valuationSourceIds": [], "valuationNote": "", "category": category,
            "tranche": None, "allocations": []}

def source_body(selection, key, directory):
    relative = selection[key]["selectedArchive"]["path"]
    raw = regular_bytes(safe(directory, relative))
    require(digest(raw) == selection[key]["selectedArchive"]["sha256"],
            "The selected original merchant archive changed.")
    return {"filename": Path(relative).name,
            "contentBase64": base64.b64encode(raw).decode("ascii")}

def original_payment(preview):
    rows = [row for row in preview["rows"] if row.get("eventId") == EVENT_ID]
    require(len(rows) == 1, "The selected original transfer is not unique.")
    row = rows[0]
    require(row.get("kind") == "PAYMENT" and row.get("canRecordCash") is True,
            "The original merchant engine did not accept the transfer evidence.")
    transfer = row.get("transfer") or {}
    require(transfer.get("network") == "stellar:testnet"
            and str(transfer.get("amountAtomic")) == "50000",
            "The original network or atomic transfer amount differs.")
    return row

def selected_preview(ops, case_id, version, source, name, selections):
    body = {**source, "expectedVersion": version, "name": name, "selections": selections}
    preview = ops.preview_settlement(case_id, body)
    require(preview.get("proposed", {}).get("canApply") is True,
            "The native settlement preview requires an unresolved decision: "
            + json.dumps(preview.get("proposed", {}), sort_keys=True))
    return preview

def review_for_request(ops, case_id, request_id):
    found = []
    for summary in ops.settlements(case_id)["items"]:
        retained = ops.settlement(case_id, summary["id"])
        if retained["review"].get("requestId") == request_id:
            found.append(retained)
    require(len(found) == 1, "The original command must retain exactly one settlement review.")
    return found[0]

def command(ops, case_id, request_id, action, version, data, note):
    return ops.command(case_id, {"requestId": request_id, "expectedVersion": version,
        "actor": ACTOR, "note": note, "action": action, "data": data})

def receive_source(programme, ops, case_id, input_selection, key, name,
                   decision, original_cash_id=None):
    phase = "receive-paid" if key == "paid" else "receive-paid-period"
    source = source_body(input_selection, key, programme.directory)
    def prepare(request_id):
        version = ops.settlements(case_id)["version"]
        initial = ops.preview_settlement(case_id, {**source, "expectedVersion": version})
        row = original_payment(initial)
        cash = cash_choice("CUSTOMER") if decision == "RECORD_CASH" else unit_choice()
        selection = {"rowId": row["rowId"], "decision": decision,
            "reason": ("Record the original recovered testnet transfer with an explicit XLM unit and observation date."
                       if decision == "RECORD_CASH" else
                       "This complete paid-period source describes the already received original transfer; link its exact current cash."),
            "cash": cash, "deploymentIds": [], "workIds": []}
        if decision == "LINK_CASH":
            require(isinstance(original_cash_id, str), "Select the first edition's original cash.")
            selection["cashId"] = original_cash_id
        reviewed = selected_preview(ops, case_id, version, source, name, [selection])
        immutable(programme.directory / "reviewed" / (phase + ".json"), encoded(reviewed))
        return {"requestId": request_id, "expectedVersion": version, "actor": ACTOR,
                "note": BASIS_NOTE, "action": "settlement.receive",
                "data": {**source, "name": name, "selections": [selection],
                         "expectedPreviewSha256": reviewed["previewSha256"]}}
    programme.request(phase, prepare, lambda body: ops.command(case_id, body))
    selected = programme.phase(phase + "-retained", lambda:
        review_for_request(ops, case_id, programme.request_id(phase)))
    row = original_payment(selected)
    require(row.get("cashId"), "The original receiving review did not retain its selected cash.")
    require(row["cash"].get("currency") == "XLM" and row["cash"].get("decimals") == 7,
            "The explicit original transfer unit changed.")
    return selected

def correct_first_cash(programme, ops, case_id, paid):
    row = original_payment(paid)
    phase = "correct-paid-cash"
    def prepare(request_id):
        version = ops.settlements(case_id)["version"]
        data = {"reviewId": paid["review"]["id"], "rowId": row["rowId"],
                "expectedCashId": row["cashId"], "decision": "CORRECT_CASH",
                "reason": "Retain the original testnet transfer as OTHER after cash classification review; preserve its exact quantity and dated recovery evidence.",
                "cash": cash_choice("OTHER"), "deploymentIds": [], "workIds": []}
        reviewed = ops.preview_settlement_correction(case_id, {**data, "expectedVersion": version})
        require(reviewed.get("proposed", {}).get("canApply") is True,
                "The original cash correction still needs review: "
                + json.dumps(reviewed.get("proposed", {}), sort_keys=True))
        immutable(programme.directory / "reviewed" / (phase + ".json"), encoded(reviewed))
        return {"requestId": request_id, "expectedVersion": version, "actor": ACTOR,
                "note": "Reviewed category correction on the original source-linked cash.",
                "action": "settlement.correct",
                "data": {**data, "expectedPreviewSha256": reviewed["previewSha256"]}}
    programme.request(phase, prepare, lambda body: ops.command(case_id, body))
    selected = programme.phase(phase + "-retained", lambda:
        review_for_request(ops, case_id, programme.request_id(phase)))
    replacement = original_payment(selected)
    require(replacement["cashId"] != row["cashId"], "The native correction must retain a replacement cash identity.")
    return selected

def correct_second_link(programme, ops, case_id, period, replacement):
    row = original_payment(period)
    replacement_id = original_payment(replacement)["cashId"]
    phase = "link-paid-period-to-replacement"
    def prepare(request_id):
        version = ops.settlements(case_id)["version"]
        data = {"reviewId": period["review"]["id"], "rowId": row["rowId"],
                "expectedCashId": row["cashId"], "decision": "LINK_CASH",
                "reason": "The first source's reviewed category correction replaced the original cash. Retain this second source edition and link the same original transfer to that replacement.",
                "cashId": replacement_id, "cash": unit_choice(),
                "deploymentIds": [], "workIds": []}
        reviewed = ops.preview_settlement_correction(case_id, {**data, "expectedVersion": version})
        require(reviewed.get("proposed", {}).get("canApply") is True,
                "The second original source cannot yet link the reviewed replacement: "
                + json.dumps(reviewed.get("proposed", {}), sort_keys=True))
        effect = reviewed["proposed"]["effects"][0]
        require(effect.get("previousCashId") == row["cashId"]
                and effect.get("cashId") == replacement_id,
                "The reviewed link must name the original cash and exact replacement.")
        immutable(programme.directory / "reviewed" / (phase + ".json"), encoded(reviewed))
        return {"requestId": request_id, "expectedVersion": version, "actor": ACTOR,
                "note": "Reviewed second-source link to the existing corrected cash.",
                "action": "settlement.correct",
                "data": {**data, "expectedPreviewSha256": reviewed["previewSha256"]}}
    programme.request(phase, prepare, lambda body: ops.command(case_id, body))
    return programme.phase(phase + "-retained", lambda:
        review_for_request(ops, case_id, programme.request_id(phase)))

def assert_retained_case(ops, case_id, ids):
    paid = ops.settlement(case_id, ids["paidReview"])
    period = ops.settlement(case_id, ids["periodReview"])
    corrected = ops.settlement(case_id, ids["correctedPaidReview"])
    linked = ops.settlement(case_id, ids["correctedPeriodReview"])
    first, second = original_payment(corrected), original_payment(linked)
    require(first["rowId"] == second["rowId"]
            and first["transfer"]["transferKey"] == second["transfer"]["transferKey"],
            "Both retained source editions must preserve the one original transfer identity.")
    require(first["cashId"] == second["cashId"] == ids["replacementCash"],
            "Both latest source editions must select the one current replacement cash.")
    require(first["cashSnapshot"]["id"] == second["cashSnapshot"]["id"] == ids["replacementCash"],
            "Both latest source histories must retain the exact selected cash snapshot.")
    require(corrected["latestReviewId"] == ids["correctedPaidReview"]
            and linked["latestReviewId"] == ids["correctedPeriodReview"],
            "The corrected native reviews are not the latest original source editions.")
    require([row["id"] for row in corrected["history"]] == [ids["paidReview"], ids["correctedPaidReview"]]
            and [row["id"] for row in linked["history"]] == [ids["periodReview"], ids["correctedPeriodReview"]],
            "The two complete original review lineages must remain ordered and unchanged.")
    old_cash = {row["id"]: row for row in paid["currentCash"]}
    current_cash = {row["id"]: row for review in (corrected, linked) for row in review["currentCash"]}
    require(old_cash[ids["originalCash"]]["state"] == "VOID",
            "The original cash correction must retain its void history.")
    require(set(current_cash) == {ids["replacementCash"]}
            and current_cash[ids["replacementCash"]]["state"] == "OBSERVED",
            "The retained original transfer must have one active source-linked cash.")
    cash = current_cash[ids["replacementCash"]]
    require(cash["currency"] == "XLM" and cash["network"] == "stellar:testnet"
            and Decimal(str(cash["amount"])) == Decimal("0.005")
            and cash["date"] == OBSERVED_DATE and cash["usdValue"] is None
            and cash["category"] == "OTHER",
            "The current cash must preserve exact XLM quantity, observation date and reviewed category.")
    require(first["cash"]["decimals"] == second["cash"]["decimals"] == 7,
            "The two original source editions must retain seven-decimal unit choices.")
    require(corrected["review"]["previousReviewId"] == ids["paidReview"]
            and linked["review"]["previousReviewId"] == ids["periodReview"]
            and linked["review"]["selectionInputs"]["expectedCashId"] == ids["originalCash"]
            and linked["review"]["selectionInputs"]["cashId"] == ids["replacementCash"]
            and linked["review"]["cashChanges"] == [],
            "The second link correction must preserve the prior link without another cash mutation.")
    require(paid["review"]["rows"][0]["cashId"] == ids["originalCash"]
            and period["review"]["rows"][0]["cashId"] == ids["originalCash"],
            "The accepted original receive editions must preserve their original cash selection.")
    return {"caseId": case_id, "version": linked["version"], "sourceEditions": 2,
        "reviewEditions": 4, "eventId": EVENT_ID, "transferKey": first["transfer"]["transferKey"],
        "originalCashId": ids["originalCash"], "replacementCashId": ids["replacementCash"],
        "activeTransferCash": 1, "amountAtomic": "50000", "amount": cash["amount"],
        "currency": "XLM", "decimals": 7, "network": "stellar:testnet",
        "observationDate": OBSERVED_DATE, "usdValue": None, "category": cash["category"],
        "sourceHashes": [corrected["source"]["sha256"], linked["source"]["sha256"]],
        "reviews": [{"id": review["review"]["id"], "sha256": review["review"]["sha256"],
                     "sourceSha256": review["source"]["sha256"],
                     "previousReviewId": review["review"]["previousReviewId"]}
                    for review in (paid, period, corrected, linked)]}

def check_zip(raw, label):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(archive.testzip() is None, "The selected native ZIP is incomplete: " + label)
        names = archive.namelist()
        require(len(names) == len(set(names)), "The native ZIP repeats a member: " + label)
        for name in names:
            parts = PurePosixPath(name)
            require(not parts.is_absolute() and all(part not in ("", ".", "..") for part in parts.parts),
                    "The native ZIP has an invalid retained path: " + label)
        manifests = [name for name in names if PurePosixPath(name).name in ("MANIFEST.json", "manifest.json")]
        require(manifests, "The native ZIP must retain its original manifest: " + label)
        verified = []
        for name in manifests:
            value = json.loads(archive.read(name))
            listed = value.get("files")
            if not isinstance(listed, list):
                continue
            root = str(PurePosixPath(name).parent)
            for item in listed:
                if not isinstance(item, dict):
                    continue
                relative = item.get("path") or item.get("name")
                if not isinstance(relative, str) or "sha256" not in item:
                    continue
                member = relative if relative in names else (root + "/" + relative if root != "." else relative)
                require(member in names, "A native manifest member is missing: " + member)
                body = archive.read(member)
                require(digest(body) == item["sha256"]
                        and ("bytes" not in item or len(body) == item["bytes"]),
                        "A native manifest member differs: " + member)
                verified.append(member)
        return {"bytes": len(raw), "sha256": digest(raw), "members": len(names),
                "verifiedManifestMembers": len(set(verified))}

def retained_native_export(programme, key, relative, producer, identity, kind):
    """Recover each completed native export before invoking its timestamped producer."""
    path = safe(programme.directory, relative)
    selection_path = programme.requests / (key + "-export-selection.json")
    if selection_path.exists():
        selected = read_json(selection_path)
        require(selected.get("kind") == kind and selected.get("path") == relative,
                "The retained native export selection changed.")
    else:
        selected = {"kind": kind, "path": relative, "original": identity()}
        immutable(selection_path, encoded(selected))
    raw = regular_bytes(path) if path.exists() else producer()
    checked = check_zip(raw, key)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if kind == "case":
            document_raw = archive.read("operations.json")
            document = json.loads(document_raw)
            for field, value in selected["original"].items():
                require(document.get(field) == value,
                        "The retained original case export differs at " + field + ".")
            source_rows = []
            for source in document["sources"]:
                body = archive.read("sources/" + source["id"])
                require(len(body) == source["bytes"] and digest(body) == source["sha256"],
                        "The original exported source bytes differ.")
                source_rows.append({"id": source["id"], "bytes": len(body), "sha256": digest(body)})
            provenance = {"caseId": document["program"]["id"],
                          "operationsSha256": digest(document_raw),
                          "summarySha256": digest(archive.read("summary.json")),
                          "planContentSha256": document["plan"]["contentSha256"],
                          "sourceFiles": source_rows}
        else:
            document_raw = archive.read("settlement-review.json")
            document = json.loads(document_raw)
            require(document == selected["original"],
                    "The retained selected review differs from its original selection.")
            provenance = {"caseId": document["caseId"], "reviewId": document["review"]["id"],
                          "reviewSha256": document["review"]["sha256"],
                          "selectedDocumentSha256": digest(document_raw),
                          "sourceSha256": digest(archive.read("original-merchant-source.tar"))}
    return {**file_receipt(path, raw, programme.directory), "nativeZip": checked, **provenance}

def case_export_identity(ops, case_id):
    state = ops.read(case_id)
    result = {key: deepcopy(state[key]) for key in ("program", "plan", "records", "sources")}
    # The public read adds this current-plan observer; the native export retains its original program fields.
    result["program"].pop("currentPlanRevision", None)
    return result

def operate_case(programme, source_root, input_selection):
    from model import Workspace
    from operations import Operations
    workspace = Workspace(programme.directory / "workspace", source_root / PREFIX / "sf10_current_candidate.json")
    try:
        ops = Operations(workspace)
        def selected_plan():
            plans = workspace.list()
            require(len(plans) == 1, "The programme requires its original fresh plan workspace.")
            plan = workspace.read(plans[0]["id"], plans[0]["revision"])
            require(plan["revision"] == plans[0]["revision"], "The selected original plan revision differs.")
            return {"id": plan["id"], "revision": plan["revision"],
                    "contentSha256": plan["contentSha256"],
                    "source": deepcopy(plan["source"]), "name": plan["name"]}
        plan = programme.phase("original-plan", selected_plan)
        created = programme.request("create-case", lambda request_id: {
            "requestId": request_id, "actor": ACTOR,
            "name": "Original merchant settlement receiving",
            "mode": "OPERATIONS", "planId": plan["id"],
            "selectedRevision": plan["revision"],
            "expectedContentSha256": plan["contentSha256"],
            "calendarStart": OBSERVED_DATE},
            ops.create)
        case_id = created["id"]
        require(created["action"] == "create", "The original Operations case was not created.")
        paid = receive_source(programme, ops, case_id, input_selection, "paid",
                              "Original paid accountant source", "RECORD_CASH")
        original_cash_id = original_payment(paid)["cashId"]
        period = receive_source(programme, ops, case_id, input_selection, "paidPeriod",
                                "Original complete paid-period source", "LINK_CASH", original_cash_id)
        replacement = correct_first_cash(programme, ops, case_id, paid)
        linked = correct_second_link(programme, ops, case_id, period, replacement)
        ids = {
            "caseId": case_id, "planId": plan["id"],
            "paidReview": paid["review"]["id"], "periodReview": period["review"]["id"],
            "correctedPaidReview": replacement["review"]["id"],
            "correctedPeriodReview": linked["review"]["id"],
            "originalCash": original_cash_id,
            "replacementCash": original_payment(replacement)["cashId"],
        }
        immutable(programme.directory / "CASE_IDS.json", encoded(ids))
        current = assert_retained_case(ops, case_id, ids)
        cash_rows = ops.read(case_id)["records"]["cash"]
        original_reference = original_payment(replacement)["transfer"]["externalRef"]
        matching = [row for row in cash_rows if row.get("externalRef") == original_reference]
        require(len(matching) == 2
                and sum(row["state"] == "OBSERVED" for row in matching) == 1
                and sum(row["state"] == "VOID" for row in matching) == 1,
                "The original native case ledger must retain one voided and one active transfer observation.")
        programme.phase("corrected-original-case", lambda: current)
        def export_all():
            result = {}
            for key, review in (("paid", ids["correctedPaidReview"]),
                                ("paidPeriod", ids["correctedPeriodReview"])):
                relative = "delivery/" + ("Original-Paid-Settlement.zip" if key == "paid"
                                          else "Original-Paid-Period-Settlement.zip")
                result[key] = retained_native_export(programme, "original-" + key, relative,
                    lambda selected=review: ops.export_settlement(case_id, selected),
                    lambda selected=review: ops.settlement(case_id, selected), "settlement")
            result["case"] = retained_native_export(programme, "original-case",
                "delivery/Original-Settlement-Case.zip", lambda: ops.export(case_id),
                lambda: case_export_identity(ops, case_id), "case")
            return result
        exports = programme.phase("native-exports", export_all)
        for row in exports.values():
            raw = regular_bytes(safe(programme.directory, row["path"]))
            require(len(raw) == row["bytes"] and digest(raw) == row["sha256"],
                    "The retained native export changed.")
        return {"plan": plan, "ids": ids, "current": current, "exports": exports}
    finally:
        workspace.close()

def restore_case(programme, source_root, case):
    from model import Workspace
    from operations import Operations
    root = programme.directory / "receiving-workspace"
    workspace = Workspace(root, source_root / PREFIX / "sf10_current_candidate.json")
    try:
        ops = Operations(workspace)
        archive_path = safe(programme.directory, case["exports"]["case"]["path"])
        raw = regular_bytes(archive_path)
        require(digest(raw) == case["exports"]["case"]["sha256"], "The original whole-case export changed.")
        body = {"archiveSha256": digest(raw), "archiveBytes": len(raw),
                "name": "Received original merchant settlement case",
                "actor": ACTOR}
        imported = programme.request("restore-complete-case",
            lambda request_id: {**body, "requestId": request_id},
            lambda request: ops.import_bundle(raw, request["name"], request["requestId"], request["actor"]))
        require(imported["action"] == "import", "The original editable case was not restored.")
        restored_ids = {**case["ids"], "caseId": imported["id"], "planId": imported["planId"]}
        current = assert_retained_case(ops, imported["id"], restored_ids)
        require(current["reviews"] == case["current"]["reviews"]
                and current["replacementCashId"] == case["current"]["replacementCashId"]
                and current["sourceHashes"] == case["current"]["sourceHashes"],
                "Native restore must retain original source, review and cash identities.")
        replay = ops.import_bundle(raw, body["name"], programme.request_id("restore-complete-case"), ACTOR)
        require(replay == imported, "The original import request did not recover its accepted receipt.")
        snapshot = ops.read(imported["id"])
        programme.phase("restored-original-case", lambda: {
            "import": imported, "current": current,
            "plan": deepcopy(snapshot["plan"]),
            "program": deepcopy(snapshot["program"]),
            "caseIds": restored_ids})
        # Source-byte receiving uses the original public source accessor.
        retained = ops.settlement(imported["id"], restored_ids["correctedPeriodReview"])
        metadata, retained_raw = ops.source(imported["id"], retained["downloadSourceId"])
        require(digest(retained_raw) == PERIOD_ARCHIVE_SHA256 and len(retained_raw) == 61440,
                "The received editable case did not preserve the exact original paid-period TAR.")
        programme.phase("restored-original-source", lambda: {
            "sourceId": metadata["id"], "bytes": len(retained_raw), "sha256": digest(retained_raw)})
        # A complete exported received case is directly usable by the original import command.
        def export_received():
            return retained_native_export(programme, "received-case",
                "delivery/Received-Settlement-Case.zip", lambda: ops.export(imported["id"]),
                lambda: case_export_identity(ops, imported["id"]), "case")
        received_export = programme.phase("received-case-export", export_received)
        def export_received_selection():
            review_id = restored_ids["correctedPeriodReview"]
            return retained_native_export(programme, "received-selected",
                "delivery/Received-Paid-Period-Settlement.zip",
                lambda: ops.export_settlement(imported["id"], review_id),
                lambda: ops.settlement(imported["id"], review_id), "settlement")
        selected_export = programme.phase("received-selected-export", export_received_selection)
        with zipfile.ZipFile(io.BytesIO(regular_bytes(archive_path))) as original_zip:
            original_document = json.loads(original_zip.read("operations.json"))
        with zipfile.ZipFile(io.BytesIO(regular_bytes(safe(programme.directory, received_export["path"])))) as received_zip:
            received_document = json.loads(received_zip.read("operations.json"))
        for field in ("records", "sources", "events", "reviews", "forecasts", "portfolios",
                      "completionPlans", "installations", "commercialReceivables", "workIntakes"):
            require(received_document.get(field) == original_document.get(field),
                    "Original case restore changed retained " + field + " bodies.")
        for field in ("revision", "scenario", "planning", "contentSha256"):
            require(received_document["plan"].get(field) == original_document["plan"].get(field),
                    "Original restore changed the selected plan's " + field + ".")
        programme.phase("restored-export-original-bodies", lambda: {
            "originalOperationsSha256": case["exports"]["case"]["operationsSha256"],
            "receivedOperationsSha256": received_export["operationsSha256"],
            "sameRecordsSourcesEventsReviews": True,
            "planContentSha256": received_document["plan"]["contentSha256"]})
        return {"caseIds": restored_ids, "import": imported, "current": current,
                "workspace": str(root), "export": received_export,
                "selectedExport": selected_export}
    finally:
        workspace.close()

def verify_result_artifacts(programme, result):
    """Reopen every accepted source/output/phase before packaging a completed result."""
    descriptors = []
    inputs = result["inputs"]
    descriptors.extend([inputs["paid"]["originalArchive"], inputs["paid"]["selectedArchive"],
                        inputs["paidPeriod"]["selectedArchive"]])
    descriptors.extend(result["originalCase"]["exports"].values())
    descriptors.extend([result["receivedCase"]["export"], result["receivedCase"]["selectedExport"],
                        result["browser"]["result"]])
    descriptors.extend(result["browser"]["artifacts"])
    descriptors.extend([result["cli"]["list"]["output"], result["cli"]["selected"]["output"],
                        result["cli"]["selectedExport"]["output"]])
    descriptors.extend(row["receipt"] for row in result["phases"])
    seen = {}
    for row in descriptors:
        relative = row["path"]
        actual = regular_bytes(safe(programme.directory, relative))
        require(len(actual) == row["bytes"] and digest(actual) == row["sha256"],
                "The accepted original receiving artifact changed: " + relative)
        if relative in seen:
            require(seen[relative] == (row["bytes"], row["sha256"]),
                    "Accepted original artifact identities disagree.")
        seen[relative] = (row["bytes"], row["sha256"])
    require(regular_bytes(programme.directory / "CASE_IDS.json") == encoded(result["originalCase"]["ids"])
            and regular_bytes(programme.directory / "SOURCE_SELECTION.json") == encoded(inputs)
            and digest(regular_bytes(programme.directory / "SOURCE_MANIFEST.json"))
                == result["source"]["manifestSha256"]
            and digest(regular_bytes(programme.directory / "PROGRAMME.json"))
                == result["selectionSha256"] == programme.selection_sha256,
            "The completed original source/case/operation selection changed.")
    for phase in result["phases"]:
        receipt = programme.receipt(phase["phase"])
        value = receipt["result"]
        if isinstance(value, dict) and "requestSha256" in value:
            body = read_json(programme.requests / (phase["phase"] + ".json"))
            require(digest(encoded(body)) == value["requestSha256"],
                    "An accepted original native request body changed.")
    browser = read_json(safe(programme.directory, result["browser"]["result"]["path"]))
    require(browser.get("passed") is True and browser.get("pageErrors") == [],
            "The accepted original browser result changed.")
    return seen


def executable(value, name):
    located = shutil.which(value) if value and "/" not in value else value
    require(located, "Select the installed " + name + " executable.")
    path = Path(located).expanduser().resolve()
    require(path.is_file() and os.access(path, os.X_OK),
            "The selected " + name + " executable is unavailable: " + str(path))
    return path

def client_browser(programme, source_root, source_identity, case, received, args):
    output = programme.directory / "delivery" / "operator"
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    restore = read_json(programme.requests / "restore-complete-case.json")
    selection = {
        "schema": "scf.grantops.settlement-client-browser-receiving.v1.selection",
        "operation": OPERATION,
        "sourceRoot": str(source_root),
        "sourceManifestSha256": source_identity["manifestSha256"],
        "workspace": received["workspace"], "output": str(output),
        "python": str(Path(sys.executable).resolve()),
        "playwright": str(args.playwright), "chromium": str(args.chromium),
        "caseIds": deepcopy(received["caseIds"]),
        "originalCaseArchive": str(safe(programme.directory, case["exports"]["case"]["path"])),
        "expectedSelectedExportSha256": received["selectedExport"]["sha256"],
        "restore": {"name": restore["name"], "requestId": restore["requestId"],
                    "actor": restore["actor"], "result": deepcopy(received["import"])},
    }
    selection_path = programme.directory / "CLIENT_BROWSER_SELECTION.json"
    immutable(selection_path, encoded(selection))
    result_path = output / "CLIENT_BROWSER_RESULT.json"
    def receive():
        if not result_path.exists():
            completed = subprocess.run([str(args.node), str(args.browser_driver), str(selection_path)],
                                       cwd=source_root, env=os.environ.copy())
            require(completed.returncode == 0,
                    "The original client/browser receiving did not complete; keep this same programme directory.")
        result = read_json(result_path)
        require(result.get("passed") is True and result.get("operation") == OPERATION
                and result.get("selectionSha256") == digest(encoded(selection)),
                "The original client/browser result does not match its retained selection.")
        require(result.get("pageErrors") == [], "The original operator browser reported an error.")
        for row in result.get("artifacts", []):
            raw = regular_bytes(safe(output, row["path"]))
            require(len(raw) == row["bytes"] and digest(raw) == row["sha256"],
                    "An original client/browser output changed: " + row["path"])
        return {"result": describe(result_path, programme.directory),
                "caseId": result["caseId"], "phases": deepcopy(result["phases"]),
                "artifacts": [{**row, "path": str((output / row["path"]).relative_to(programme.directory))}
                              for row in result["artifacts"]],
                "serviceClose": deepcopy(result["serviceClose"]), "finalState": deepcopy(result["finalState"])}
    return programme.phase("native-client-browser-receiving", receive)

def cli_receiving(programme, source_root, received):
    directory = programme.directory / "delivery" / "cli"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    base = [str(Path(sys.executable).resolve()), "-B",
            str(source_root / PREFIX / "workspace" / "cli.py"),
            "operations", "--workspace", received["workspace"],
            "--scenario", str(source_root / PREFIX / "sf10_current_candidate.json")]
    case_id = received["caseIds"]["caseId"]
    review_id = received["caseIds"]["correctedPeriodReview"]
    result = {}
    def read_command(phase, arguments, filename):
        def run():
            argv = base + arguments
            immutable(programme.requests / (phase + ".json"), encoded({"argv": argv}))
            completed = subprocess.run(argv, cwd=source_root, capture_output=True,
                                       env=os.environ.copy())
            require(completed.returncode == 0,
                    "The original CLI read did not complete: "
                    + completed.stderr.decode("utf-8", "replace")[-4000:])
            value = json.loads(completed.stdout)
            path = directory / filename
            return {"argv": argv, "output": file_receipt(path, completed.stdout, programme.directory),
                    "value": value}
        retained = programme.phase(phase, run)
        row = retained["output"]
        raw = regular_bytes(safe(programme.directory, row["path"]))
        require(len(raw) == row["bytes"] and digest(raw) == row["sha256"],
                "The retained original CLI read changed.")
        return retained
    listed = read_command("cli-list-settlements",
                          ["settlements", "--case", case_id], "settlements.json")
    require(len(listed["value"]["items"]) == 4, "The original CLI must retain all four settlement reviews.")
    shown = read_command("cli-read-selected-settlement",
                         ["settlement-show", "--case", case_id, "--review", review_id],
                         "selected-settlement.json")
    require(shown["value"]["review"]["id"] == review_id
            and shown["value"]["currentCash"][0]["id"] == received["caseIds"]["replacementCash"],
            "The original CLI returned a different selected review or cash.")
    output = directory / "selected-settlement.zip"
    def export():
        argv = base + ["settlement-export", "--case", case_id, "--review", review_id,
                       "--output", str(output)]
        immutable(programme.requests / "cli-export-selected-settlement.json", encoded({
            "argv": argv, "expectedSha256": received["selectedExport"]["sha256"]}))
        if not output.exists():
            completed = subprocess.run(argv, cwd=source_root, capture_output=True,
                                       env=os.environ.copy())
            require(completed.returncode == 0,
                    "The original CLI selected export did not complete: "
                    + completed.stderr.decode("utf-8", "replace")[-4000:])
            json.loads(completed.stdout)
            immutable(directory / "selected-export-command.json", completed.stdout)
        raw = regular_bytes(output)
        require(digest(raw) == received["selectedExport"]["sha256"],
                "The original CLI selected export differs from its native review.")
        return {"argv": argv, "output": describe(output, programme.directory),
                "nativeZip": check_zip(raw, "original CLI selected export")}
    result["selectedExport"] = programme.phase("cli-export-selected-settlement", export)
    result["list"] = {"output": listed["output"], "reviews": len(listed["value"]["items"])}
    result["selected"] = {"output": shown["output"], "reviewId": review_id}
    return result

def final_guide(result):
    case = result["originalCase"]
    received = result["receivedCase"]
    ids = case["ids"]
    restored = received["caseIds"]
    fence = chr(96) * 3
    return f"""# Original merchant settlement receiving

This package contains the completed original SCF Grant Operations settlement programme, its full selected application source, exact original input archives, native exports, receiving results, command records and browser screenshots.

## Completed operating result

The original recovered Stellar testnet transfer is **50,000 stroops = 0.005 XLM**, using the explicitly reviewed **seven decimal places**. Its dated recovery observation is **2026-10-11**. The programme received two authentic source editions for that one transfer: the original paid accountant packet with all seven source members, followed by the unchanged complete paid-period close TAR.

The first received cash was classified CUSTOMER. Its explicit reviewed correction retained the original record as VOID and created the OTHER replacement. The second source then received an explicit LINK_CASH correction to that same replacement, with no further cash mutation. All four original receiving/correction reviews, both original source archives and the old cash history remain available.

| Retained identity | Value |
| --- | --- |
| Original operation | {OPERATION} |
| Original case | {ids["caseId"]} |
| Received case | {restored["caseId"]} |
| Original cash retained as VOID | {ids["originalCash"]} |
| Current OBSERVED replacement cash | {ids["replacementCash"]} |
| Corrected paid review | {ids["correctedPaidReview"]} |
| Corrected paid-period review | {ids["correctedPeriodReview"]} |
| Original event | {EVENT_ID} |
| Whole-case export SHA-256 | {case["exports"]["case"]["sha256"]} |
| Received selected-review export SHA-256 | {received["selectedExport"]["sha256"]} |
| Complete selected source manifest SHA-256 | {result["source"]["manifestSha256"]} |

The active transfer count is one. No USD valuation was supplied. The source date is the original recovery observation, not the programme execution date. The programme records source and review data and performs no new payment.

## Open the useful outputs

- RESULT.json is the complete native completion receipt, with actual source, case, review, cash, command and artifact identities.
- delivery/Original-Settlement-Case.zip is the original full editable case export.
- delivery/Received-Settlement-Case.zip is the full editable export after original native restore.
- delivery/Original-Paid-Settlement.zip and delivery/Original-Paid-Period-Settlement.zip are the two selected corrected reviews with complete original source.
- delivery/Received-Paid-Period-Settlement.zip is the selected review in the restored case; its bytes match the actual client, CLI and browser downloads.
- delivery/operator/01-saved-source-editions.png, 02-corrected-period-current-cash.png and 03-original-cash-history.png show the actual native operator views.
- delivery/operator/ contains the original client JSON, actual browser download and exact original source download.
- delivery/cli/ contains actual original command outputs.
- original/ retains the unchanged original accountant TAR, its source-complete 16-member selection and the unchanged paid-period close TAR.
- SOURCE_SELECTION.json identifies every original input and the exact first-edition source composition.
- SOURCE_MANIFEST.json and DELIVERY_MANIFEST.json pin all source and deliverable members.

The source checkout is under source/. The complete original application entry is source/stellar/scf_2026/sf47_budget_model/workspace/cli.py. The original source includes the native merchant reader and its declared import closure.

## Receive the editable case on Linux

Use Python 3.11 or later and Node 24 or later. Set SF47_SETTLEMENT_NODE and SF47_BUYER_NODE to the same installed Node executable. The native browser receiving additionally uses an existing Playwright module and Chrome/Chromium executable; their exact observed selections are recorded in PROGRAMME.json.

Choose one private receiving directory outside this extracted package. Close a running workspace service before issuing headless commands against the same directory. From the package directory:

{fence}sh
export SF47_SETTLEMENT_NODE=/absolute/path/to/node
export SF47_BUYER_NODE=/absolute/path/to/node
python3 -B source/stellar/scf_2026/sf47_budget_model/workspace/cli.py init --workspace /absolute/path/to/private-receiving --scenario source/stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json
python3 -B source/stellar/scf_2026/sf47_budget_model/workspace/cli.py operations --workspace /absolute/path/to/private-receiving --scenario source/stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json import --file delivery/Original-Settlement-Case.zip --name "Received original merchant settlement case" --actor "Receiving operator" --request-id "original-settlement-receiving"
python3 -B source/stellar/scf_2026/sf47_budget_model/workspace/cli.py serve --workspace /absolute/path/to/private-receiving --scenario source/stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json
{fence}

Keep the same archive, name, actor and request ID when continuing an interrupted import. The original native request journal returns the accepted import receipt before reading or importing again. Restore assigns the documented new case and plan IDs while retaining source, cash, review and event bodies. Use the case and plan IDs returned by that original command.

Open the original private browser URL, select the received plan and case, choose Delivery operations, then Merchant settlements. Open either corrected review to see the shared current cash; open the first paid-period review to see its retained VOID cash history. Download the selected review or original source directly from that view.

## Programme continuation and source

receiving/settlement_receiving.py is the complete operating programme and receiving/settlement_browser.mjs is its native client/browser continuation. Their original selected command and executable identities are retained in PROGRAMME.json. The programme uses one persistent output directory and immutable exact request bodies before each original mutation. A phase receipt is written only after the original operation returns. A lost response therefore resumes through the original Workspace request journal. No independent payment ledger or replacement archive/import engine is added.

The raw private workspace databases and access fragments are not required to receive this deliverable. The complete editable native exports, source, selections and recorded original results are included.
"""

def package_receiving(programme, source_root, source_manifest, result, browser_driver):
    """Package the exact operating source and selected noncredential outputs."""
    verify_result_artifacts(programme, result)
    files = {}
    def add(name, raw):
        safe(programme.directory, name)
        require(name not in files, "The delivery member is repeated: " + name)
        files[name] = raw
    manifest = read_json(source_manifest)
    for entry in manifest["files"]:
        raw = regular_bytes(safe(source_root, entry["path"]))
        require(len(raw) == entry["bytes"] and digest(raw) == entry["sha256"],
                "The selected operating source changed before delivery: " + entry["path"])
        add("source/" + entry["path"], raw)
    for directory in ("original", "delivery", "receipts", "requests", "reviewed"):
        root = programme.directory / directory
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            require(not path.is_symlink(), "A retained delivery member contains a symlink.")
            if (path.is_file() and not path.name.endswith(".pending") and ".pending-" not in path.name
                    and path.name != "CLIENT_BROWSER_FAILURE.json"):
                add(path.relative_to(programme.directory).as_posix(), regular_bytes(path))
    for name in ("SOURCE_SELECTION.json", "SOURCE_MANIFEST.json", "PROGRAMME.json",
                 "CASE_IDS.json", "RESULT.json", "START_HERE.md"):
        add(name, regular_bytes(programme.directory / name))
    add("receiving/settlement_receiving.py", regular_bytes(Path(__file__).resolve()))
    add("receiving/settlement_browser.mjs", regular_bytes(browser_driver))
    inventory = [{"path": name, "bytes": len(raw), "sha256": digest(raw)}
                 for name, raw in sorted(files.items())]
    delivery_manifest = {"schema": SCHEMA + ".delivery", "operation": OPERATION,
                         "resultSha256": digest(encoded(result)),
                         "sourceManifestSha256": result["source"]["manifestSha256"],
                         "files": inventory}
    manifest_raw = encoded(delivery_manifest)
    add("DELIVERY_MANIFEST.json", manifest_raw)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 10, 12, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = buffer.getvalue()
    destination = programme.directory / "SCF-Original-Settlement-Receiving.zip"
    immutable(destination, raw)
    immutable(programme.directory / "DELIVERY_MANIFEST.json", manifest_raw)
    return {**describe(destination, programme.directory), "members": len(files),
            "manifestSha256": digest(manifest_raw)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--input-frame", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True, type=Path)
    parser.add_argument("--chromium", required=True)
    parser.add_argument("--browser-driver", type=Path,
                        default=Path(__file__).with_name("settlement_browser.mjs"))
    args = parser.parse_args()
    require(sys.platform.startswith("linux"), "Use the original Linux native receiving workflow.")
    args.source_root = args.source_root.expanduser().resolve()
    args.source_manifest = args.source_manifest.expanduser().resolve()
    args.input_frame = args.input_frame.expanduser().resolve()
    args.directory = args.directory.expanduser().resolve()
    args.node = executable(args.node, "Node")
    args.chromium = executable(args.chromium, "Chromium")
    args.playwright = args.playwright.expanduser().resolve()
    args.browser_driver = args.browser_driver.expanduser().resolve()
    require(args.playwright.is_file() and args.browser_driver.is_file(),
            "Select the retained browser driver and installed Playwright module.")
    require(args.directory != args.source_root and args.source_root not in args.directory.parents,
            "Choose a persistent private programme directory outside the source checkout.")
    source_identity = complete_source(args.source_root, args.source_manifest)
    raw_input = regular_bytes(args.input_frame)
    require(len(raw_input) == INPUT_BYTES and digest(raw_input) == INPUT_SHA256,
            "The complete original input frame changed.")
    version = subprocess.run([str(args.node), "--version"], capture_output=True, text=True, check=True).stdout.strip()
    require(version.startswith("v") and int(version[1:].split(".")[0]) >= 24,
            "Select an installed Node 24 or later.")
    os.environ["SF47_SETTLEMENT_NODE"] = str(args.node)
    os.environ["SF47_BUYER_NODE"] = str(args.node)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    args.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = args.directory / "programme.lock"
    lock_descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("The original settlement programme is already owned by its live process.")
        selection = {
            "schema": SCHEMA + ".selection", "operation": OPERATION,
            "source": source_identity, "input": describe(args.input_frame),
            "directory": str(args.directory),
            "python": str(Path(sys.executable).resolve()), "node": str(args.node),
            "nodeVersion": version, "playwright": str(args.playwright),
            "chromium": str(args.chromium), "browserDriver": describe(args.browser_driver),
            "programmeSource": describe(Path(__file__).resolve())}
        programme = Programme(args.directory, selection)
        immutable(args.directory / "SOURCE_MANIFEST.json", regular_bytes(args.source_manifest))
        result_path = args.directory / "RESULT.json"
        if result_path.exists():
            result = read_json(result_path)
            require(result.get("passed") is True and result.get("operation") == OPERATION
                    and result.get("selectionSha256") == programme.selection_sha256,
                    "The completed result does not match this retained programme.")
            immutable(args.directory / "START_HERE.md", final_guide(result).encode("utf-8"))
            delivery = package_receiving(programme, args.source_root, args.source_manifest,
                                         result, args.browser_driver)
            immutable(args.directory / "DELIVERY.json", encoded(delivery))
            print(json.dumps({"operation": OPERATION, "passed": True, "reused": True,
                              "result": str(result_path), "delivery": delivery}, sort_keys=True), flush=True)
            return 0
        started = now()
        sys.path.insert(0, str(args.source_root / PREFIX / "workspace"))
        inputs = prepare_inputs(args.input_frame, args.directory)
        def original_native_stage():
            case = operate_case(programme, args.source_root, inputs)
            received = restore_case(programme, args.source_root, case)
            cli = cli_receiving(programme, args.source_root, received)
            return {"case": case, "received": received, "cli": cli}
        stage = programme.phase("original-native-case-restore-cli", original_native_stage)
        case, received, cli = stage["case"], stage["received"], stage["cli"]
        # The native stage is committed before any service opens. An interrupted
        # browser therefore reuses these exports and reaches the original client
        # without reopening a Workspace already held by that original service.
        stage_artifacts = [*case["exports"].values(), received["export"], received["selectedExport"],
                           cli["list"]["output"], cli["selected"]["output"], cli["selectedExport"]["output"]]
        for row in stage_artifacts:
            raw = regular_bytes(safe(programme.directory, row["path"]))
            require(len(raw) == row["bytes"] and digest(raw) == row["sha256"],
                    "The completed original native stage artifact changed: " + row["path"])
        require(regular_bytes(programme.directory / "CASE_IDS.json") == encoded(case["ids"]),
                "The completed original native case selection changed.")
        browser = client_browser(programme, args.source_root, source_identity, case, received, args)
        final_observation = browser["finalState"]
        cash = final_observation["cash"]
        require(final_observation["caseId"] == received["caseIds"]["caseId"]
                and final_observation["version"] == received["current"]["version"]
                and final_observation["reviewId"] == received["caseIds"]["correctedPeriodReview"]
                and cash["id"] == received["caseIds"]["replacementCash"]
                and cash["state"] == "OBSERVED" and cash["currency"] == "XLM"
                and Decimal(str(cash["amount"])) == Decimal("0.005")
                and cash["date"] == OBSERVED_DATE and cash["category"] == "OTHER"
                and cash["usdValue"] is None,
                "The final original native client state differs from the retained received case.")
        final_state = {**deepcopy(received["current"]), "nativeClient": final_observation}
        result = {
            "schema": SCHEMA, "operation": OPERATION, "passed": True,
            "selectionSha256": programme.selection_sha256,
            "startedAt": started, "completedAt": now(), "source": source_identity,
            "inputs": inputs, "originalCase": case, "receivedCase": received,
            "browser": browser, "cli": cli, "finalState": final_state,
            "phases": programme.completed()}
        immutable(args.directory / "START_HERE.md", final_guide(result).encode("utf-8"))
        immutable(result_path, encoded(result))
        delivery = package_receiving(programme, args.source_root, args.source_manifest,
                                     result, args.browser_driver)
        immutable(args.directory / "DELIVERY.json", encoded(delivery))
        print(json.dumps({"operation": OPERATION, "passed": True, "result": str(result_path),
                          "resultSha256": digest(encoded(result)), "delivery": delivery},
                         sort_keys=True), flush=True)
        return 0
    except Exception as error:
        replace_json(args.directory / "FAILURE.json", {
            "schema": SCHEMA + ".failure", "operation": OPERATION, "at": now(),
            "error": {"type": type(error).__name__, "message": str(error)},
            "traceback": traceback.format_exc()})
        raise
    finally:
        os.close(lock_descriptor)

if __name__ == "__main__":
    raise SystemExit(main())
