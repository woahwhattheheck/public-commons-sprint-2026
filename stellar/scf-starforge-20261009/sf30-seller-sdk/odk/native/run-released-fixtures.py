#!/usr/bin/env python3
"""Run native Central receiving, both reporting periods and the approved warehouse handover."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import zipfile

OPERATION = "SCF-ODK-CENTRAL-FIELD-WORKSPACE-CB57-20261012"
HANDOVER_SCHEMA = "stellar-forge.central-complete-customer-handover.v1"

def read_json(path, private=False, maximum=1024 * 1024):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size > maximum:
        raise ValueError("Use the original regular configuration or receiving file.")
    if private and info.st_mode & 0o077:
        raise ValueError("Keep the original host configuration and connection files private.")
    return json.loads(path.read_text(encoding="utf-8"))

def file_receipt(path, root=None, expected=None):
    path = Path(path).absolute()
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink() or path.resolve() != path:
        raise ValueError("Retain each complete original regular receiving file.")
    if root is not None and not path.is_relative_to(root):
        raise ValueError("A receiving file is outside its original private work directory.")
    sha = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
            count += len(block)
    result = {"path": str(path), "bytes": count, "sha256": sha.hexdigest()}
    if expected and any(result[key] != expected[key] for key in ("bytes", "sha256") if key in expected):
        raise ValueError("A complete original receiving file differs from its retained receipt.")
    return result

def read_result(path, root, expected=None):
    receipt = file_receipt(path, root, expected)
    value = read_json(path, maximum=64 * 1024 * 1024)
    return value, receipt

def private_directory(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.is_symlink() or path.resolve() != path or info.st_mode & 0o077:
        raise ValueError("Use a canonical private receiving directory.")
    return path

def publish_file(temporary, destination):
    try:
        os.link(temporary, destination)
    except FileExistsError:
        if file_receipt(temporary)["sha256"] != file_receipt(destination)["sha256"]:
            raise ValueError("Preserve the different existing handover file.")
    directory = os.open(str(Path(destination).parent), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)

def exact_bytes(path, data):
    path = Path(path)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise ValueError("Preserve the original completed handover selection.")
        return file_receipt(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".central-handover-", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        publish_file(temporary, path)
        return file_receipt(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def exact_json(path, value):
    return exact_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

def stream_hash(stream):
    digest = hashlib.sha256()
    size = 0
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
        size += len(block)
    return {"bytes": size, "sha256": digest.hexdigest()}

def complete_zip(path, members):
    """Reuse a complete existing ZIP, or stream the original immutable members once."""
    path = Path(path)
    expected = {name: {key: item[key] for key in ("bytes", "sha256")} for name, item in members.items()}
    if path.exists():
        file_receipt(path)
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != len(expected) or set(names) != set(expected):
                raise ValueError("The original complete handover ZIP has a different member list.")
            for name, value in expected.items():
                with archive.open(name) as stream:
                    if stream_hash(stream) != value:
                        raise ValueError("An original complete handover member changed.")
        return file_receipt(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".central-handover-", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
        with zipfile.ZipFile(temporary, "w", allowZip64=True) as archive:
            for name, item in sorted(members.items()):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_STORED if name.endswith((".gz", ".zip")) else zipfile.ZIP_DEFLATED
                digest = hashlib.sha256()
                size = 0
                with Path(item["path"]).open("rb") as original, archive.open(info, "w", force_zip64=True) as destination:
                    for block in iter(lambda: original.read(1024 * 1024), b""):
                        destination.write(block)
                        digest.update(block)
                        size += len(block)
                if {"bytes": size, "sha256": digest.hexdigest()} != expected[name]:
                    raise ValueError("A selected original file changed while the handover was being written.")
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        publish_file(temporary, path)
        return file_receipt(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

def customer_handover(work, operation, profile_id):
    """Join actual producer results and complete artifacts after their owners close."""
    work = Path(work).resolve()
    programme, programme_file = read_result(work / "provider" / "programme-result.json", work)
    if programme.get("schema") != "stellar-forge.central-released-programme.v1" or programme.get("operationId") != operation:
        raise ValueError("Use the original complete released Central programme.")
    fixture, fixture_file = read_result(programme["fixture"]["path"], work, programme["fixture"])
    commissioned, commissioned_file = read_result(programme["commissioning"]["path"], work, programme["commissioning"])
    whole, whole_file = read_result(fixture["receivingResult"]["path"], work, fixture["receivingResult"])
    selection, selection_file = read_result(commissioned["warehouseRequest"]["path"], work, commissioned["warehouseRequest"])
    warehouse_root = work / "warehouse-receiving"
    warehouse, warehouse_file = read_result(warehouse_root / "result.json", work)
    workspace_id = commissioned["workspaceId"]
    if not (fixture.get("operationId") == whole.get("operationId") == commissioned.get("operationId") ==
            selection.get("operationId") == warehouse.get("operationId") == operation):
        raise ValueError("Keep one original provider, commissioning and warehouse operation.")
    if not (selection.get("schema") == "stellar-forge.central-native-warehouse-selection.v1" and
            warehouse.get("schema") == "stellar-forge.central-approved-period-receiving.v1" and
            whole.get("workspaceId") == selection.get("workspaceId") == warehouse.get("workspaceId") == workspace_id and
            selection.get("deliveryId") == warehouse.get("deliveryId") == commissioned.get("deliveryId") and
            selection.get("commissionId") == commissioned.get("commissionId") and
            selection.get("datasets") == commissioned.get("datasets") and
            selection.get("captures") == commissioned.get("captures") and
            Path(selection["sourceWorkspace"]).resolve() == work / "workspace" and
            Path(warehouse["originalDirectory"]).resolve() == work / "workspace" and
            Path(warehouse["restoredDirectory"]).resolve() == work / "warehouse-reopened" and
            warehouse.get("listenersClosed") is True):
        raise ValueError("Join the same complete original captures, delivery and closed warehouse receiving.")
    original_datasets = {item["id"]: item for item in selection["datasets"]}
    imported = warehouse["datasets"]
    if len(original_datasets) != len(selection["datasets"]) or len(imported) != len(original_datasets):
        raise ValueError("Receive every original approved dataset exactly once.")
    seen = set()
    for item in imported:
        export_id = item["exportId"]
        original = original_datasets.get(export_id)
        if not original or export_id in seen or item["period"] != original["period"] or item["captureId"] != original["captureId"]:
            raise ValueError("A warehouse edition differs from its original approved dataset.")
        index = selection["datasets"].index(original)
        for field, group in (("approvalId", "approvals"), ("reviewId", "reviews"), ("importId", "imports")):
            if item[field] != selection["requestIds"][group][index]:
                raise ValueError("Preserve the original approved-period operation identifiers.")
        seen.add(export_id)
    if len(warehouse["reports"]) != 1 or warehouse["reports"][0]["id"] != selection["requestIds"]["report"]:
        raise ValueError("Receive the original complete released-period comparison report.")
    members = {
        "native/programme-result.json": programme_file,
        "native/fixture-result.json": fixture_file,
        "native/source-receiving-result.json": whole_file,
        "native/commissioning-result.json": commissioned_file,
        "native/warehouse-selections.json": selection_file,
        "warehouse/result.json": warehouse_file,
    }
    for name in ("source-report-agreement.json", "native-period-boundary.json", "commissioning-delivery.json"):
        members["native/" + name] = file_receipt(work / "receiving" / "commissioning" / name, work)
    for item in warehouse["files"]:
        received = file_receipt(item["path"], warehouse_root, item)
        member = "warehouse/" + Path(received["path"]).relative_to(warehouse_root).as_posix()
        if member in members and members[member] != received:
            raise ValueError("An original warehouse member has conflicting receipts.")
        members[member] = received
    final_archive = file_receipt(warehouse["archive"]["path"], warehouse_root, warehouse["archive"])
    archive_member = "warehouse/" + Path(final_archive["path"]).relative_to(warehouse_root).as_posix()
    if members.get(archive_member) != final_archive:
        raise ValueError("The complete received Central archive must be present in the handover.")
    for report in warehouse["reports"]:
        record = file_receipt(report["file"]["path"], warehouse_root, report["file"])
        member = "warehouse/" + Path(record["path"]).relative_to(warehouse_root).as_posix()
        if members.get(member) != record:
            raise ValueError("Keep every complete original period report in the handover.")
    binding = warehouse.get("warehouse", {})
    if binding.get("id") != profile_id or not binding.get("warehouseId") or not binding.get("warehouseSchema"):
        raise ValueError("The complete receiving refers to another selected host profile.")
    target = private_directory(work / "customer-handover")
    manifest = {
        "schema": HANDOVER_SCHEMA, "operationId": operation, "workspaceId": workspace_id,
        "project": fixture["project"], "source": fixture["source"],
        "commissionId": commissioned["commissionId"], "deliveryId": commissioned["deliveryId"],
        "sourceCaptureId": commissioned["sourceCaptureId"], "sourceReviewId": commissioned["sourceReviewId"],
        "captures": commissioned["captures"], "periods": selection["periods"],
        "sourceIndicators": commissioned["indicators"], "datasets": imported,
        "warehouse": warehouse["warehouse"], "profileId": profile_id,
        "reports": warehouse["reports"], "archiveMember": archive_member,
        "archive": {key: final_archive[key] for key in ("bytes", "sha256")},
        "restoredDirectory": warehouse["restoredDirectory"], "listenersClosed": True,
        "completedAt": warehouse["completedAt"],
        "members": {name: {key: item[key] for key in ("bytes", "sha256")} for name, item in sorted(members.items())}
    }
    members["handover.json"] = exact_json(target / "handover.json", manifest)
    guide = (
        "# Complete Central reporting handover\n\n"
        "Operation: " + operation + "\n\n"
        "The original native Central source, both commissioned reporting periods and the approved PostgreSQL "
        "editions are complete. All source and warehouse listeners have closed. The original complete results "
        "are under native/ and warehouse/; handover.json maps every original artifact to its full byte count and SHA-256.\n\n"
        "## Open the reports\n\n"
        "The complete period comparison ZIP is in warehouse/downloads/reports/. It contains the original and typed "
        "data for both editions, changed rows, dictionaries, mappings, comparison SQL, machine-readable and HTML reports. "
        "warehouse/received-reports/ contains the same full reports received after independent workspace restore.\n\n"
        "## Reopen the complete field workspace\n\n"
        "The final archive is " + archive_member + ". Its SHA-256 is " + final_archive["sha256"] + ". "
        "Use the installed Central application's original archive restore interface with a new private destination. "
        "It restores source pages, original XML and media, accepted reviews, both period plans, datasets, reporting "
        "agreements and warehouse operation records. The native/result files retain the prior complete capture and "
        "commissioning results. Use the same archive identity when continuing an interrupted restore.\n\n"
        "The completed independent receiving directory on the original host is " + warehouse["restoredDirectory"] + ". "
        "Start its normal managed Central command to continue retained work. Reconnect the original PostgreSQL profile " +
        profile_id + " using its host-held connection environment to read the same immutable editions. "
        "The native PostgreSQL server and its operator directory continue under their original host lifecycle.\n\n"
        "## Continue this operation\n\n"
        "Repeat the original run-released-fixtures.py command with its unchanged host, work directory, warehouse "
        "profile and reviewer/note. The provider, commissioner and SQL receiver each recover their own original request "
        "IDs. A repeated completed handover verifies every existing ZIP member before returning it. "
        "The complete retained API requests, responses and receiving journals remain in the original work directory.\n\n"
        "Keep this complete handover private. Its source and approved data belong to the original workspace. "
        "Host credentials and native server recovery snapshots stay with the existing private host operator.\n"
    )
    members["READ_ME.md"] = exact_bytes(target / "READ_ME.md", guide.encode("utf-8"))
    archive = complete_zip(target / "Central_Complete_Reporting_Handover.zip", members)
    result = {"schema": HANDOVER_SCHEMA, "operationId": operation, "workspaceId": workspace_id,
              "commissionId": commissioned["commissionId"], "deliveryId": commissioned["deliveryId"],
              "datasets": len(imported), "periodReports": len(warehouse["reports"]),
              "completeMembers": len(members), "manifest": members["handover.json"],
              "archive": archive, "listenersClosed": True, "completedAt": warehouse["completedAt"]}
    exact_json(target / "result.json", result)
    return result

def run_owned(command, environment):
    child = None
    previous_handlers = {}
    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)
    try:
        for signum in (signal.SIGTERM, signal.SIGHUP):
            previous_handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, interrupted)
        child = subprocess.Popen(command, env=environment, start_new_session=True)
        return child.wait()
    except BaseException:
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
        raise
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-config", required=True)
    parser.add_argument("--work-directory", required=True)
    parser.add_argument("--node", default="node", help="Existing Node runtime with the installed StarForge dependencies.")
    parser.add_argument("--operation", default=OPERATION)
    parser.add_argument("--project", help="Explicit existing native project ID; omitted creates the retained operation's project.")
    parser.add_argument("--warehouse-profiles", help="Existing private Central warehouse profile file.")
    parser.add_argument("--warehouse-profile", help="Original selected PostgreSQL receiving profile ID.")
    parser.add_argument("--warehouse-reviewer", help="Original operator performing the approved mapping review.")
    parser.add_argument("--warehouse-note", help="Original review note for the full approved native columns.")
    parser.add_argument("--warehouse-environment-file", help="Optional private JSON containing only the selected PostgreSQL connection alias.")
    args = parser.parse_args(argv)
    warehouse_options = [args.warehouse_profiles, args.warehouse_profile, args.warehouse_reviewer, args.warehouse_note]
    if any(warehouse_options) and not all(isinstance(item, str) and item.strip() for item in warehouse_options):
        raise ValueError("Supply the original warehouse profiles, profile, reviewer and note together.")
    if args.warehouse_environment_file and not all(warehouse_options):
        raise ValueError("The private warehouse environment file belongs to a complete warehouse selection.")
    configuration = read_json(args.host_config, private=True)
    if configuration.get("schema") != "stellar-forge.odk-central-host.v1" or configuration.get("operation_id") != args.operation:
        raise ValueError("Use the original selected Central host and receiving operation.")
    host = Path(configuration["directory"]).resolve()
    connection_path = host / "connection.json"
    connection = read_json(connection_path)
    reference = configuration["auth_env"]
    if connection.get("authEnv") != reference or connection.get("id") != configuration["compose_project"]:
        raise ValueError("The original host connection binding differs.")
    credentials = read_json(host / "connection-secret.json", private=True)
    if set(credentials) != {reference} or not isinstance(credentials[reference], str) or not credentials[reference]:
        raise ValueError("Keep the original complete Authorization header in its private host custody.")
    if "\r" in credentials[reference] or "\n" in credentials[reference]:
        raise ValueError("The original Authorization header contains a line break.")
    environment = dict(os.environ)
    environment[reference] = credentials[reference]
    ca = host / "tls" / "ca.pem" if configuration["mode"] == "local" else configuration.get("tls", {}).get("ca")
    if ca:
        ca = Path(ca).resolve()
        if not ca.is_file():
            raise ValueError("The original selected Central CA file is missing.")
        environment["NODE_EXTRA_CA_CERTS"] = str(ca)
    work = private_directory(Path(args.work_directory).resolve())
    runtime = shutil.which(args.node)
    if runtime is None:
        raise ValueError("Select the existing installed Node/StarForge runtime for this host.")
    entry = Path(__file__).resolve().with_name("run-released-fixtures.mjs")
    if not entry.is_file():
        raise ValueError("Keep the complete published receiving source beside this launcher.")
    warehouse_entry = entry.parent.parent / "warehouse" / "receiving.mjs"
    if all(warehouse_options):
        profiles_path = Path(args.warehouse_profiles).resolve()
        document = read_json(profiles_path, private=True)
        profiles = document if isinstance(document, list) else document.get("profiles") if isinstance(document, dict) and document.get("schema") == "stellar-forge.central-warehouse-profiles.v1" else None
        selected = [item for item in profiles or [] if isinstance(item, dict) and item.get("id") == args.warehouse_profile]
        if len(selected) != 1 or not warehouse_entry.is_file():
            raise ValueError("Select one existing private warehouse profile and the complete installed SQL receiver.")
        alias = selected[0].get("connectionEnv")
        if not isinstance(alias, str) or not alias or alias == reference:
            raise ValueError("Keep the original warehouse connection alias separate from Central authorization.")
        if args.warehouse_environment_file:
            private_values = read_json(args.warehouse_environment_file, private=True)
            if not isinstance(private_values, dict) or set(private_values) != {alias}:
                raise ValueError("The private warehouse input must contain only its original selected connection alias.")
            environment[alias] = private_values[alias]
        if not isinstance(environment.get(alias), str) or not environment[alias] or "\0" in environment[alias]:
            raise ValueError("Supply the selected original PostgreSQL connection in its private host environment.")
    command = [runtime, str(entry), "--connection", str(connection_path),
               "--directory", str(work / "provider"), "--workspace", str(work / "workspace"),
               "--output", str(work / "receiving"), "--restore", str(work / "restored-workspace"),
               "--operation", args.operation]
    if args.project:
        command.extend(["--project", args.project])
    print(json.dumps({"operation_id": args.operation, "phase": "ORIGINAL_RECEIVING",
                      "connection": str(connection_path), "directory": str(work / "provider"),
                      "receiving_request": str(work / "provider" / "receiving-request.json")}), flush=True)
    result = run_owned(command, environment)
    if result != 0 or not all(warehouse_options):
        return result
    request = work / "receiving" / "commissioning" / "warehouse-selections.json"
    command = [runtime, str(warehouse_entry), "--request", str(request),
               "--profiles", str(profiles_path), "--profile", args.warehouse_profile,
               "--reviewer", args.warehouse_reviewer, "--note", args.warehouse_note,
               "--output", str(work / "warehouse-receiving"),
               "--restore-directory", str(work / "warehouse-reopened")]
    print(json.dumps({"operation_id": args.operation, "phase": "APPROVED_PERIOD_WAREHOUSE",
                      "request": str(request), "profile": args.warehouse_profile}), flush=True)
    result = run_owned(command, environment)
    if result != 0:
        return result
    handover = customer_handover(work, args.operation, args.warehouse_profile)
    print(json.dumps({"operation_id": args.operation, "phase": "COMPLETE_CUSTOMER_HANDOVER", **handover}), flush=True)
    return 0

if __name__ == "__main__":
    try:
        result = main()
        raise SystemExit(result if result >= 0 else 128 - result)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"error": str(error), "phase": "ORIGINAL_RECEIVING_SETUP"}), file=sys.stderr)
        raise SystemExit(1)
