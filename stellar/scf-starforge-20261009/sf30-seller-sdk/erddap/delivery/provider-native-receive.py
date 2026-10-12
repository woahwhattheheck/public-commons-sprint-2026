#!/usr/bin/env python3
"""MIT. Continue one original ERDDAP provider handoff through independent receiving.

The selected source capture, direct reviewed profile, original dataset operation,
provider review history and customer receipt survive process interruption. This
owner never acquires NOAA data and never starts a paid buyer. Its optional NDBC
reference profile is restricted to the five exact published 2023 source bodies.
"""
from __future__ import annotations
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile

SCHEMA = "stellar-forge.erddap-provider-native-receiving.v1"
REFERENCE = {
    "metadata.json": (27486, "49f85fbc755c175e222373c3e0b64e6e3278b4206ccfcf12e6fd364088e12001"),
    "dataset.dds": (650, "3f1cd1c441616e4e2707aa1c2137900c046665c6e00c037c85924eb5a5cb36d4"),
    "dataset.das": (17775, "d697fcd27ee8134977f77ecf57b173df0586bcb2c3de5e1c5cd2891098747935"),
    "data.json": (12798, "522cbe07e2ebd9774c5478ad0b655eafb3d5474e3cfefbfdba736d51ab98e11e"),
    "data.csv": (9526, "cd599a295ebaa45cb763eddfd029e0bba7334a261067518ed85c7bde1c7cca25"),
}
SOURCE_NAMES = (
    "erddap_source.py", "erddap_workspace.py", "provider_handoff.py",
    "provider_handoff_workspace.py", "provider_handoff_cli.py",
    "delivery/native-receive.py", "delivery/provider-native-receive.py",
)

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def file_bytes(path, maximum):
    path = Path(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as inp:
        info = os.fstat(inp.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
            raise ValueError("Select an original regular file within the declared budget: " + str(path))
        raw = inp.read(maximum + 1)
        end = os.fstat(inp.fileno())
        if len(raw) > maximum or (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) != (
            end.st_dev, end.st_ino, end.st_size, end.st_mtime_ns) or len(raw) != end.st_size:
            raise ValueError("Original selected file changed while reading: " + str(path))
    return raw

def byte_identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

def file_identity(path, maximum=1024 * 1024 * 1024):
    return byte_identity(file_bytes(path, maximum))

def directory(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ValueError("Use an original regular operation directory: " + str(path))
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("The native operation directory must be private to its owner")
    return path

def atomic_bytes(path, raw):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            os.fchmod(out.fileno(), 0o600)
            out.write(raw); out.flush(); os.fsync(out.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def atomic(path, value):
    atomic_bytes(path, encode(value))

def retain(path, raw):
    path = Path(path)
    if path.exists():
        if file_bytes(path, max(len(raw), 1)) != raw:
            raise ValueError("The original retained input or output differs: " + str(path))
    else:
        atomic_bytes(path, raw)
    return {"file": str(path), **byte_identity(raw)}

def read_json(path, default=None):
    return json.loads(file_bytes(path, 16 * 1024 * 1024)) if Path(path).exists() else default

def reference_profile(c, handoff):
    """Author the explicit reviewed public reference without inventing a contact."""
    if c.manifest["protocol"] != "tabledap" or c.manifest["datasetId"] != "cwwcNDBCMet":
        raise ValueError("The named NDBC reference requires the original cwwcNDBCMet table")
    for name, expected in REFERENCE.items():
        raw = c.originals.get(name)
        if raw is None or (len(raw), hashlib.sha256(raw).hexdigest()) != expected:
            raise ValueError("The named 144-row reference requires the unchanged original " + name)
    if len(c.table["rows"]) != 144 or c.names != [
        "station", "longitude", "latitude", "time", "WD", "WSPD", "WVHT", "ATMP", "WTMP"
    ]:
        raise ValueError("The named reference has a different original observation selection")
    station_slot, time_slot = c.slots["station"], c.slots["time"]
    if {str(row[station_slot]) for row in c.table["rows"]} != {"46042"}:
        raise ValueError("The original reference station changed")
    if any(not isinstance(row[time_slot], str) or not row[time_slot].startswith("2023-06-01T")
           or not row[time_slot].endswith("Z") for row in c.table["rows"]):
        raise ValueError("The original reference day or returned UTC time representation changed")
    p = handoff.draft_profile(c)
    globals_ = {key: value.get("value") for key, value in c.meta["globalAttributes"].items()}
    by_name = {value["name"]: value for value in c.meta["variables"] + c.meta["dimensions"]}
    def text_attr(name):
        value = globals_.get(name)
        return value if isinstance(value, str) else ""
    p["title"] = "NOAA NDBC station 46042 — original 2023-06-01 public reference"
    p["reviewedBy"] = "Token Junkie Labs — original public-source review, 2026-10-12"
    p["license"].update(attribution="NOAA NDBC; NOAA NMFS SWFSC ERD. " + text_attr("infoUrl"), reviewed=True)
    p["contacts"]["technical"]["notes"] = (
        "Published creator contact retained from NC_GLOBAL creator_name and creator_email. "
        "This reference does not assert a new vendor relationship or individual project appointment.")
    p["contacts"]["scientific"]["notes"] = (
        "The captured dataset supplies no separately named scientific point of contact. "
        "A provider must supply that appointment before a ready intake is approved.")
    p["access"]["refresh"] = (
        "The retained provider summary describes updates every five minutes. The original history "
        "describes monthly historical-file refresh and realtime source ingestion; this is a fixed "
        "historical selection, not a promise that its edition will never change.\n\n" + text_attr("history"))
    p["access"]["preprocessing"] = (
        "This handoff preserves all 144 returned rows, every original numeric spelling and null. "
        "No interpolation, averaging, unit conversion, duplicate removal or quality masking is added. "
        "The original provider reformats and lightly edits NDBC source, selects the most non-missing "
        "row at duplicate station/time keys and inserts missing rows for gaps.\n\n" + text_attr("summary"))
    p["access"]["documentation"] = (
        text_attr("infoUrl") + "\n" + c.manifest["server"] + "info/" + c.manifest["datasetId"] + "/index.html"
        + "\nExact metadata/DDS/DAS and JSON/CSV are inside the retained capture.")
    p["time"].update(
        originalTimezone="The actual ERDDAP JSON and CSV time column declares UTC and returns ISO timestamps ending Z. Upstream station clock conventions beyond that response are not separately supplied.",
        calendar="standard",
        daylightSaving="No daylight-saving offset is applied to the returned UTC timestamps. The captured source does not separately specify historical station-local daylight-saving practices.",
        notes="Use the actual response String/UTC representation; do not replace it with the metadata's numeric epoch description or infer a local timezone.",
        reviewed=True,
    )
    for variable in p["variables"]:
        attributes = by_name[variable["source"]].get("attributes", {})
        details = []
        for key in ["long_name", "comment", "standard_name", "units", "_FillValue", "missing_value"]:
            item = attributes.get(key)
            if item is not None:
                value = item.get("value") if isinstance(item, dict) else item
                if isinstance(value, (str, int, float)):
                    details.append(key + ": " + str(value))
        variable["description"] = "\n".join(details) or variable["description"]
        variable["reviewed"] = True
    for station in p["stations"]:
        if station["sourceValue"] != "46042" or station["latitude"] != "36.789" or station["longitude"] != "-122.404":
            raise ValueError("Historical station coordinates differ from the reviewed original rows")
        station.update(
            name="NDBC station 46042",
            platformType="NDBC moored buoy — retained dataset collection classification",
            expectedStart="2023-06-01T00:00:00Z",
            expectedEnd="2023-06-02T00:00:00Z",
            attribution="NOAA NDBC and NOAA NMFS SWFSC ERD",
            links=text_attr("infoUrl") + "\nhttps://www.ndbc.noaa.gov/station_history.php?station=46042",
            previousDeployments="No separate historical deployment catalogue was supplied in this capture.",
            notes="The expected range is this explicitly selected observation window, with an exclusive end; it is not a claimed deployment lifetime. Coordinates are the actual 2023 response values. Historical sensor depth is not supplied: WTMP metadata directs readers to the hull description, so the current station page's depth is not substituted.",
            reviewed=True,
        )
    p["quality"].update(
        processing=p["access"]["preprocessing"],
        requested="none",
        checks="The captured provider summary distinguishes quality-controlled historical source from less-controlled realtime source and says some impossible values were removed. This selection contains no per-value QC flag columns or retained QARTOD results. No additional scientific quality tests are claimed.",
        notes="Nulls, gap rows and all declared missing sentinels remain visible. WD is circular direction and has not been averaged. WTMP is the actual degree_C surface-temperature field; historical sensor depth remains unknown.\n\n" + text_attr("summary"),
        reviewed=True,
    )
    p["notes"] = (
        "This is the unchanged one-day, 144-row 2023 NDBC public reference selected after the original "
        "2025 observation URLs returned 404. It does not replace the retained 2025 errors or the distinct "
        "three-day 432-row coastal selection. The exact original source receipts identify the actual "
        "Notion public-HTTPS import/download transport; upstream HTTP headers are not invented. "
        "All source content and the published license remain inside the bundle. The public creator "
        "contact is retained, and the separately appointed scientific contact remains an explicit "
        "provider question. The review bundle is usable with that disclosed outstanding item; ready "
        "export follows the unchanged source-owned readiness decision."
    )
    return handoff.normalize_profile(p, c)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--operation-root", type=Path, required=True)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--workspace", type=Path)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--profile", type=Path)
    group.add_argument("--ndbc-2023-reference", action="store_true")
    parser.add_argument("--temporary-root", type=Path)
    args = parser.parse_args(argv)
    def interrupted(signum, frame):
        raise KeyboardInterrupt("Original provider-native owner interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    source_root = args.source_root.resolve(strict=True)
    if not (source_root / "provider_handoff.py").is_file():
        raise ValueError("Select the complete maintained provider handoff source")
    operation = directory(args.operation_root)
    output = directory(operation / "provider-native")
    original = (args.workspace or operation / "workspace").absolute()
    receiving = operation / "provider-receiving-workspace"
    if original.resolve() == receiving.resolve():
        raise ValueError("Customer receiving requires its own original workspace")
    lock_path = output / "owner.lock"
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lock_fd)
        raise RuntimeError("This original provider receiving operation already has an owner")
    lock = os.fdopen(lock_fd, "a+b")
    os.environ.setdefault("SF30_XML_NODE", os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node") or "node")
    sys.path.insert(0, str(source_root))
    import erddap_source as src
    from erddap_workspace import Workspace
    import provider_handoff as handoff
    from provider_handoff_workspace import HandoffStore
    try:
        capture_raw = file_bytes(args.capture, 2 * src.MAX_SOURCE)
        capture = handoff.Capture(capture_raw)
        profile_raw = file_bytes(args.profile, handoff.MAX_PROFILE) if args.profile else encode(reference_profile(capture, handoff))
        selected_profile = handoff.normalize_profile(json.loads(profile_raw), capture)
        canonical_profile = encode(selected_profile)
        selected_capture = retain(output / "original-capture.erddap.zip", capture_raw)
        retain(output / "profile-input.json", profile_raw)
        profile_output = retain(operation / "handoff-profile.json", canonical_profile)
        definition = {"schema": SCHEMA, "source": byte_identity(capture_raw),
            "profileInput": byte_identity(profile_raw), "profile": byte_identity(canonical_profile),
            "workspace": str(original), "receiverWorkspace": str(receiving),
            "reference": "ndbc-46042-2023-06-01-144" if args.ndbc_2023_reference else None}
        retain(output / "operation.json", encode(definition))
        result_path = output / "provider-result.json"
        report = read_json(result_path, {"schema": SCHEMA, "definition": definition, "phases": {}, "generations": []})
        if report.get("schema") != SCHEMA or report.get("definition") != definition:
            raise ValueError("Existing provider continuation belongs to another source/profile/workspace")
        if report.get("status") == "ERDDAP_PROVIDER_NATIVE_RECEIVING_COMPLETE":
            for item in report.get("artifacts", []):
                if file_identity(item["file"]) != {k: item[k] for k in ["bytes", "sha256"]}:
                    raise ValueError("A completed original provider artifact changed")
            print(json.dumps({"status": report["status"], "result": str(result_path),
                "sourceId": capture.id, "profile": profile_output["file"], "ready": report["review"]["ready"]}), flush=True)
            return 0
        generation = {"startedAt": now(), "pid": os.getpid(), "state": "starting",
            "sourceFiles": {name: file_identity(source_root / name) for name in SOURCE_NAMES}}
        report["generations"].append(generation); report["status"] = "RUNNING"
        atomic(result_path, report)
        def phase(name, request, action):
            old = report["phases"].get(name)
            fingerprint = hashlib.sha256(encode(request)).hexdigest()
            if old and old["requestSha256"] != fingerprint:
                raise ValueError("A retained phase request changed: " + name)
            if old and old["state"] == "complete":
                return old["result"]
            report["phases"][name] = {"state": "prepared", "request": request, "requestSha256": fingerprint, "preparedAt": old.get("preparedAt") if old else now()}
            atomic(result_path, report)
            value = action()
            report["phases"][name].update(state="complete", result=value, completedAt=now())
            atomic(result_path, report)
            return value
        temporary_root = args.temporary_root.resolve(strict=True) if args.temporary_root else directory(output / "temporary")
        child = None
        try:
            with tempfile.TemporaryDirectory(prefix="erddap-provider-", dir=temporary_root) as scratch:
                os.environ["TMPDIR"] = scratch; os.environ["SQLITE_TMPDIR"] = scratch; tempfile.tempdir = scratch
                def native_dataset():
                    nonlocal child
                    command = [sys.executable, "-B", str(source_root / "delivery/native-receive.py"),
                        "--source-root", str(source_root), "--operation-root", str(operation),
                        "--workspace", str(original), "--source-packet", selected_capture["file"],
                        "--temporary-root", str(temporary_root)]
                    with (output / "dataset-native.log").open("ab") as log:
                        child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                        code = child.wait()
                    child = None
                    if code != 0:
                        raise RuntimeError("The original dataset receiving continuation returned " + str(code) + "; its saved native result remains in " + str(operation / "native"))
                    value = read_json(operation / "native/native-result.json")
                    if not value or value.get("status") != "ERDDAP_NATIVE_RECEIVING_COMPLETE":
                        raise ValueError("Original dataset receiving did not retain its complete result")
                    entries = [item for item in value["sources"] if item["source"] == capture.id]
                    if len(entries) != 1 or entries[0]["rowCount"] != len(capture.table["rows"]):
                        raise ValueError("Native receiving does not match this original capture")
                    return {"file": str(operation / "native/native-result.json"),
                        "sourceId": capture.id, "build": entries[0]["build"]["id"],
                        "rowCount": entries[0]["rowCount"], "query": entries[0]["query"],
                        "receiverWorkspace": value["receiverWorkspace"]}
                report["dataset"] = phase("original_dataset_receiving", {"source": capture.id, "workspace": str(original)}, native_dataset)
                with Workspace(original) as workspace:
                    store = HandoffStore(workspace)
                    draft = handoff.draft_profile(capture)
                    if encode(draft) == canonical_profile:
                        raise ValueError("The reviewed profile must explicitly complete or disclose the original draft fields")
                    first = phase("save_original_draft", {"profile": draft, "expectedHead": None},
                        lambda: store.save(capture.id, draft, None))
                    original_export = phase("original_review_bundle", {"revision": first["id"], "mode": "review"},
                        lambda: store.export(first["id"], "review"))
                    preview = phase("review_selected_profile", {"profile": selected_profile},
                        lambda: store.preview(capture.id, selected_profile))
                    saved = phase("save_reviewed_profile", {"profile": selected_profile, "expectedHead": first["id"]},
                        lambda: store.save(capture.id, selected_profile, first["id"]))
                    retried = store.save(capture.id, selected_profile, first["id"])
                    if retried != saved:
                        raise ValueError("The exact original save retry changed its review record")
                    def stale_save():
                        try:
                            store.save(capture.id, selected_profile, None)
                        except src.InputError as error:
                            if getattr(error, "status", None) != 409 or getattr(error, "current_revision", None) != saved["id"]:
                                raise
                            return {"status": 409, "currentRevision": error.current_revision, "message": str(error)}
                        raise ValueError("A stale review save unexpectedly changed the original head")
                    phase("same_source_head_conflict", {"profile": selected_profile, "expectedHead": None, "current": saved["id"]}, stale_save)
                    history = store.history(capture.id)
                    if history["head"] != saved["id"] or [row["id"] for row in history["revisions"]] != [saved["id"], first["id"]]:
                        raise ValueError("Original two-revision provider history differs")
                    report["review"] = saved["review"]; report["revision"] = saved["id"]
                    report["history"] = history
                    selected_export = phase("reviewed_bundle", {"revision": saved["id"], "mode": "review"},
                        lambda: store.export(saved["id"], "review"))
                    exports = [original_export, selected_export]
                    if saved["review"]["ready"]:
                        exports.append(phase("ready_bundle", {"revision": saved["id"], "mode": "ready"},
                            lambda: store.export(saved["id"], "ready")))
                        report["readyExport"] = {"status": "ready", "sha256": exports[-1]["sha256"]}
                    else:
                        def retain_readiness():
                            try:
                                store.export(saved["id"], "ready")
                            except src.InputError as error:
                                if str(error) != "Complete the reported intake fields before creating a ready bundle":
                                    raise
                                return {"status": "review_required", "message": str(error),
                                    "issues": saved["review"]["issues"]}
                            raise ValueError("The native readiness decision changed without a reviewed profile")
                        report["readyExport"] = phase("actual_ready_export_decision",
                            {"revision": saved["id"], "ready": False}, retain_readiness)
                    report["exports"] = exports
                    atomic(result_path, report)
                with Workspace(receiving, create=not (receiving / "workspace.json").exists()) as customer_workspace:
                    customer = HandoffStore(customer_workspace)
                    accepted = []
                    for bundle in report["exports"]:
                        raw = file_bytes(bundle["path"], handoff.MAX_HANDOFF)
                        if byte_identity(raw) != {k: bundle[k] for k in ["bytes", "sha256"]}:
                            raise ValueError("The retained original bundle changed before customer receiving")
                        receipt = phase("receive_" + bundle["sha256"], {"bundle": bundle["sha256"], "bytes": len(raw)},
                            lambda raw=raw: customer.receive(raw))
                        if customer.receive(raw) != receipt:
                            raise ValueError("The original customer retry changed its receipt")
                        detail = customer.received(receipt["sha256"])
                        if detail["receipt"] != receipt or detail["profile"]["sourceId"] != capture.id or detail["source"]["id"] != capture.id:
                            raise ValueError("Customer received detail lost original source/profile identity")
                        if detail["profile"] != (draft if bundle["revision"] == first["id"] else selected_profile):
                            raise ValueError("Customer received another reviewed profile")
                        returned = file_bytes(customer.received_path(receipt["sha256"]), handoff.MAX_HANDOFF)
                        if returned != raw:
                            raise ValueError("Customer redownload differs from the exact original bundle")
                        target = output / ("received-" + bundle["sha256"] + ".zip")
                        retained = retain(target, returned)
                        accepted.append({"receipt": receipt, "profile": detail["profile"], "source": detail["source"]["id"], "returned": retained})
                    report["receiving"] = accepted
                    state = customer.state()
                    if state["heads"]:
                        raise ValueError("Receiving inserted an unreviewed local provider head")
                with Workspace(original) as reopened:
                    current = HandoffStore(reopened)
                    if current.get(saved["id"]) != saved or current.history(capture.id) != report["history"]:
                        raise ValueError("Closed source workspace changed original review/history")
                    for bundle in report["exports"]:
                        if current.export(bundle["revision"], bundle["mode"]) != bundle:
                            raise ValueError("Closed source export changed its retained identity")
                with Workspace(receiving) as reopened_customer:
                    current = HandoffStore(reopened_customer)
                    for entry in report["receiving"]:
                        receipt = entry["receipt"]; detail = current.received(receipt["sha256"])
                        if detail["receipt"] != receipt or detail["profile"] != entry["profile"]:
                            raise ValueError("Closed customer workspace changed its original received profile")
                        if file_identity(current.received_path(receipt["sha256"])) != {k: receipt[k] for k in ["bytes", "sha256"]}:
                            raise ValueError("Closed customer receiving changed original bundle bytes")
                report["artifacts"] = [profile_output, selected_capture] + [
                    {"file": item["path"], **{k: item[k] for k in ["bytes", "sha256"]}} for item in report["exports"]
                ] + [item["returned"] for item in report["receiving"]]
                report.update(status="ERDDAP_PROVIDER_NATIVE_RECEIVING_COMPLETE", sourceId=capture.id,
                    workspace=str(original), receiverWorkspace=str(receiving), profile=profile_output,
                    sourceSummary=capture.summary(), completedAt=now())
                generation.update(state="complete", completedAt=now())
                atomic(output / "provider-history.json", report["history"])
                atomic(output / "provider-review.json", report["review"])
                atomic(result_path, report)
                print(json.dumps({"status": report["status"], "result": str(result_path), "sourceId": capture.id,
                    "rowCount": len(capture.table["rows"]), "revisions": len(report["history"]["revisions"]),
                    "bundles": len(report["exports"]), "ready": report["review"]["ready"],
                    "workspace": str(original), "receiverWorkspace": str(receiving), "profile": profile_output["file"]}), flush=True)
                return 0
        except BaseException as error:
            if child is not None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    child.wait(timeout=8)
                except ProcessLookupError:
                    pass
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL); child.wait()
            generation.update(state="failed", failedAt=now(), error={"type": type(error).__name__, "message": str(error)[:2000]})
            report["status"] = "RETAINED_FOR_CONTINUATION"
            atomic(result_path, report)
            raise
    finally:
        lock.close()

if __name__ == "__main__":
    raise SystemExit(main())
