#!/usr/bin/env python3
"""Continue the same Kafka customer with complete client/MCP source under native placement."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import time

OPERATION = "SCF-KAFKA-MERCHANT-8F43-20261012"
PLACEMENT = "scf-kafka-dev-receiving-8f43-20261012"
CONTINUATION = OPERATION + "-dev-continuation"
ROOT = Path("/workspace/scratch/8f4370a17e6f/kafka-native-receiving")
RECORDS = Path("/workspace/scratch/8f4370a17e6f/kafka-native-records")
ORIGINAL = RECORDS / "a15e28b79340cb8ac21ccc76525bc2cc3f1b5f63ad5bbfc76866b70f97020655"
CONTROL = Path("/workspace/scratch/8f4370a17e6f/kafka-native-placement")
HOST = Path("/workspace/scratch/d76c9c89fb9e/native-prepared-stop-20261012/host")
SOURCE_PIN = "d6938e1f333d92670a653f47d136b7d7cfb3abfa"
ADMISSION_BLOB = "d44eacd6eb5e60862e804d21870f3a837b18163d"
CAPSULE_BLOB = "c30804ecc16f28e8dff638c31a046db69bb82e07"
CONSUMER_SOURCE_PIN = "f1828c513b8c249b1dbaaf7e48e8a3e4a6c16548"
CONSUMER_CAPSULE_BLOB = "e096594571878a1b8f459923cfdc4b0ff6525b2c"
CONSUMER_MATERIALIZER_BLOB = "f310453707f160ee8b4b450341eaecbb9286fbef"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def regular(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError("Select the original owned regular source: " + str(path))
    return path.read_bytes()


def check_original(admission):
    manifest_bytes = regular(HOST.parent / "source-manifest.json")
    manifest = json.loads(manifest_bytes)
    if (manifest.get("schema") != "commons.prepared-stop-install.v1"
            or manifest.get("base") != "46bbfc4da90915400033074f4c72b79582b5d95f"
            or manifest.get("source_bundle") != "9e5d792d3ed1d819b7ed78422ca591c31223a280"
            or manifest.get("host") != str(HOST)):
        raise RuntimeError("Select the same complete original native host")
    rows = manifest.get("files")
    if not isinstance(rows, list) or len(rows) != len(admission.HOST_FILES) or {
            item.get("path") for item in rows} != set(admission.HOST_FILES):
        raise RuntimeError("Retain every original native source member")
    for item in rows:
        name = item["path"]
        expected = admission.HOST_FILES[name]
        path = HOST / name
        data = regular(path)
        if (set(item) != {"path", "sha", "bytes"} or item["sha"] != expected["sha"]
                or blob(data) != expected["sha"] or len(data) != item["bytes"]
                or stat.S_IMODE(path.lstat().st_mode) != int(expected["mode"], 8)):
            raise RuntimeError("The original native source changed: " + name)
    if sha(regular(HOST / "swarm_cloud_job.py")) != admission.NATIVE:
        raise RuntimeError("The original native runtime changed")
    for base, members in ((ROOT / "source", admission.SOURCE_FILES), (ROOT, admission.TOOL_FILES)):
        for name, expected in members.items():
            if blob(regular(base / name)) != expected:
                raise RuntimeError("The original customer source changed: " + name)
    if blob(regular(ROOT / "native-source-bootstrap.py")) != CAPSULE_BLOB:
        raise RuntimeError("The original complete source capsule changed")
    input_bytes = regular(ROOT / "native-job-input.json")
    selected = json.loads(input_bytes)
    materialized = regular(ROOT / "source-materialization.json")
    inventory_bytes = regular(ROOT / "source-inventory.json")
    merchant_bytes = regular(ROOT / "merchant-request.json")
    materialization = json.loads(materialized)
    merchant_expected = (json.dumps(materialization.get("merchant"), ensure_ascii=False,
        sort_keys=True, separators=(",", ":")) + "\n").encode()
    if (selected.get("schema") != "stellar-forge.kafka-native-admission.v1"
            or selected.get("operationId") != OPERATION
            or selected.get("sourcePin") != SOURCE_PIN
            or selected.get("project") != str(ROOT)
            or selected.get("records") != str(RECORDS)
            or selected.get("nativeHost") != str(HOST)
            or selected.get("nativeManifestSha256") != sha(manifest_bytes)
            or selected.get("sourceMaterializationSha256") != sha(materialized)
            or selected.get("sourceInventorySha256") != sha(inventory_bytes)
            or selected.get("merchantRequestSha256") != sha(merchant_bytes)
            or merchant_bytes != merchant_expected
            or selected.get("sourceFiles") != admission.SOURCE_FILES
            or selected.get("receivingFiles") != admission.TOOL_FILES
            or materialization.get("operation") != OPERATION
            or materialization.get("sourcePin") != SOURCE_PIN
            or materialization.get("root") != str(ROOT)
            or json.loads(inventory_bytes).get("merchantFiles") != admission.SOURCE_FILES):
        raise RuntimeError("Preserve the original admitted customer input and source")
    if selected.get("memoryMiB") != 768 or selected.get("projectStorageMiB") != 768 or selected.get("recordStorageMiB") != 128:
        raise RuntimeError("Retain the original full customer resource envelope")
    return selected, sha(input_bytes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true",
        help="Prepare and inspect the complete original placement without cancelling or starting")
    parser.add_argument("--consumer-packet", required=True,
        help="Complete original source capsule and receiving helpers published with this caller")
    args = parser.parse_args()
    os.umask(0o077)
    sys.dont_write_bytecode = True
    admission_bytes = regular(ROOT / "native-admitted.py")
    if blob(admission_bytes) != ADMISSION_BLOB:
        raise RuntimeError("Select the original reviewed admission caller")
    definition = importlib.util.spec_from_file_location("original_kafka_admission", ROOT / "native-admitted.py")
    admission = importlib.util.module_from_spec(definition)
    definition.loader.exec_module(admission)
    selected, input_sha = check_original(admission)
    admission.private(str(CONTROL))
    plans = admission.private(str(CONTROL / "plans"))
    sys.path.insert(0, str(HOST))
    import swarm_cloud_job as native
    import native_placement
    from native_foreground import ForegroundLaunch
    original = native_placement.inspect_predecessor(str(ORIGINAL), native=native)
    if original["operation_id"] != OPERATION:
        raise RuntimeError("The original Kafka predecessor identity changed")
    if not original["undispatched"]:
        print(json.dumps({"operation": OPERATION, "phase": "original_dispatched",
            "record": str(ORIGINAL), "nativeState": original["native"].get("state")}), flush=True)
        return 75
    if not isinstance(original.get("supervisor"), dict):
        raise RuntimeError("The original queued supervisor has no retained identity")
    source_command = selected["command"]
    expected_command = [str(Path(sys.executable).resolve()), "-B", str(ROOT / "native-lifecycle.py"),
        "--root", str(ROOT), "--node", source_command[6], "--browser-executable",
        source_command[8], "--playwright-module", source_command[10]]
    if source_command != expected_command:
        raise RuntimeError("Select the unchanged complete customer command")
    spec_file = CONTROL / "placement-spec.json"
    packet = Path(args.consumer_packet).expanduser().absolute()
    if packet.resolve(strict=True) != packet or not packet.is_dir():
        raise RuntimeError("Select the complete canonical consumer source packet")
    materializer_path = packet / "materialize-consumer-source.py"
    if (materializer_path.resolve(strict=True) != materializer_path
            or blob(regular(materializer_path)) != CONSUMER_MATERIALIZER_BLOB
            or blob(regular(packet / "consumer-source-capsule.json")) != CONSUMER_CAPSULE_BLOB):
        raise RuntimeError("The complete original consumer source transport changed")
    loader = importlib.util.spec_from_file_location("original_kafka_consumer_source", materializer_path)
    consumer_module = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(consumer_module)
    # Add and verify every immutable member before the sole native run-copy
    # manifest is prepared. Reentry after a written spec is strictly read-only.
    consumer, consumer_bytes = consumer_module.materialize(packet, ROOT, verify_only=spec_file.exists())
    if (consumer.get("operation") != OPERATION or consumer.get("status") != "MATERIALIZED"
            or consumer.get("selection", {}).get("sourcePin") != CONSUMER_SOURCE_PIN
            or consumer["selection"].get("capsuleGitBlob") != CONSUMER_CAPSULE_BLOB
            or consumer["selection"].get("originalAdmissionSha256") != input_sha):
        raise RuntimeError("Join the complete consumer source to the original admitted operation")
    command = [expected_command[0], "-B",
        {"binding": "run", "relative": "native-lifecycle-with-consumers.py"},
        "--root", {"binding": "run"}, "--node", expected_command[6],
        "--browser-executable", expected_command[8], "--playwright-module", expected_command[10],
        "--consumer-driver", {"binding": "run", "relative": "client-mcp-receiving.mjs"},
        "--consumer-product-root", {"binding": "run", "relative": "consumer-source"},
        "--consumer-source-inventory", {"binding": "run", "relative": "consumer-source-inventory.json"}]
    consumer_admission = {"schema": "stellar-forge.kafka-native-consumer-admission.v1",
        "operationId": OPERATION, "originalAdmissionSha256": input_sha,
        "originalSourcePin": SOURCE_PIN, "consumerSourcePin": CONSUMER_SOURCE_PIN,
        "consumerCapsuleGitBlob": CONSUMER_CAPSULE_BLOB,
        "consumerMaterializerGitBlob": CONSUMER_MATERIALIZER_BLOB,
        "consumerMaterializationSha256": sha(consumer_bytes),
        "consumerSourceInventorySha256": consumer["selection"]["sourceInventorySha256"],
        "receivingFiles": consumer["selection"]["helpers"], "command": command}
    consumer_admission_bytes = (json.dumps(consumer_admission, sort_keys=True, indent=2) + "\n").encode()
    joined_input_path = ROOT / "consumer-native-job-input.json"
    if spec_file.exists():
        if regular(joined_input_path) != consumer_admission_bytes:
            raise RuntimeError("The prepared original consumer admission changed")
    else:
        admission.exact_write(joined_input_path, consumer_admission_bytes)
    input_sha = sha(consumer_admission_bytes)
    artifacts = list(dict.fromkeys([*selected["artifacts"],
        "consumer-native-job-input.json", "consumer-source-selection.json",
        "consumer-materialization.json", "consumer-source-capsule.json",
        "consumer-source-inventory.json", "consumer-source",
        "native-customer-with-consumers.py", "native-lifecycle-with-consumers.py",
        "client-mcp-receiving.mjs", "CLIENT_MCP_RECEIVING.md",
        "lifecycle-consumer-input.json", "receiving/consumer-input.json",
        "receiving/client-mcp"]))
    print(json.dumps({"operation": OPERATION, "phase": "complete_consumer_source_retained",
        "sourcePin": CONSUMER_SOURCE_PIN, "sourceFiles": consumer["selection"]["sourceFiles"],
        "sourceBytes": consumer["selection"]["sourceBytes"],
        "sourceAdmissionSha256": input_sha}), flush=True)
    os.environ["SWARM_NODE24_BIN"] = str(Path(expected_command[6]).parent)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    predecessor = {"record": str(ORIGINAL), "request_sha256": original["request_sha256"],
        "expected_supervisor": original["supervisor"]}
    if spec_file.exists():
        retained = json.loads(regular(spec_file))
        if (retained.get("placement_id") != PLACEMENT or retained.get("business_operation_id") != OPERATION
                or retained.get("source_admission_sha256") != input_sha
                or retained.get("predecessor", {}).get("record") != str(ORIGINAL)
                or retained.get("predecessor", {}).get("request_sha256") != original["request_sha256"]):
            raise RuntimeError("Retain the exact original placement specification")
        predecessor = retained["predecessor"]
    spec = {
        "schema": "commons.native-placement/v1",
        "placement_id": PLACEMENT,
        "business_operation_id": OPERATION,
        "source_admission_sha256": input_sha,
        "source_pin": SOURCE_PIN,
        "source_capsule": CAPSULE_BLOB,
        "candidates": [{"id": "original-command-tmpfs", "root": "/dev/commons-8f43-kafka"}],
        "bindings": {"run": {"mode": "copy", "source": str(ROOT), "target": "run"}},
        "predecessor": predecessor,
        "native": {
            "operation_id": CONTINUATION, "peer": "8f43-kafka-native-customer",
            "project": {"binding": "run"}, "records_root": str(RECORDS),
            "worker_root": {"binding": "worker"}, "temp_root": {"binding": "temporary"},
            "command": command, "java": None, "node": "24",
            "artifact": artifacts, "artifact_on_success": [], "artifact_on_failure": [],
            "retain_artifacts": True, "runtime_path": selected["runtimePaths"],
            "runtime_consumers_root": "/workspace/shared/swarm/jobs/runtime-consumers",
            # Reserve the full original process envelope plus the complete
            # declared tmpfs project growth in this single native lifetime.
            "memory_mib": 1536, "memory_reserve_mib": 128, "memory_reclaim": "clean-cache",
            "memory_reservations_root": "/workspace/shared/swarm/capacity/memory",
            "disk_space": [{"path": {"binding": "run"}, "mib": 768},
                {"path": str(RECORDS), "mib": 128}],
            "disk_inodes": [{"path": {"binding": "run"}, "count": 8192},
                {"path": str(RECORDS), "count": 2048}],
            "disk_reserve_mib": 4, "disk_reserve_inodes": 128,
            "disk_reservations_root": "/workspace/shared/swarm/capacity/disk",
        },
    }
    admission.exact_write(spec_file, (json.dumps(spec, sort_keys=True, indent=2) + "\n").encode())
    prepared = native_placement.prepare(spec, str(plans), native=native)
    print(json.dumps({"operation": OPERATION, "placement": PLACEMENT,
        "phase": prepared.get("phase"), "journal": prepared.get("journal"),
        "predecessor": str(ORIGINAL),
        "candidate": prepared.get("selected"),
        "candidates": prepared.get("candidates") if prepared.get("phase") == "awaiting_capacity" else None}), flush=True)
    if prepared.get("phase") == "awaiting_capacity":
        return 75
    if args.prepare_only:
        return 0
    ready = native_placement.materialize(str(plans), PLACEMENT, native=native)
    if ready.get("phase") != "ready":
        ready = native_placement.materialize(str(plans), PLACEMENT, native=native, cancel_predecessor=True)
        # Keep this original carrier and its private /dev mount alive until
        # native custody releases the undispatched predecessor. A fixed wait
        # would strand the prepared device binding in a later invocation.
        observed = 0
        while ready.get("phase") in ("waiting_predecessor", "waiting_predecessor_release"):
            if observed % 5 == 0:
                print(json.dumps({"operation": OPERATION, "placement": PLACEMENT,
                    "phase": ready.get("phase"), "journal": ready.get("journal"),
                    "predecessor": str(ORIGINAL)}), flush=True)
            time.sleep(2)
            observed += 1
            ready = native_placement.materialize(str(plans), PLACEMENT, native=native, cancel_predecessor=True)
    print(json.dumps({"operation": OPERATION, "placement": PLACEMENT,
        "phase": ready.get("phase"), "journal": ready.get("journal")}), flush=True)
    if ready.get("phase") not in ("ready", "native"):
        return 75
    launch = ForegroundLaunch(native)
    try:
        started = native_placement.start(str(plans), PLACEMENT, native=native, launcher=launch)
        report = started["native"]
        print(json.dumps({"operation": OPERATION, "placement": PLACEMENT,
            "record": report["record"], "state": report.get("state"),
            "supervisor_alive": report.get("supervisor_alive"),
            "process_alive": report.get("process_alive"), "reused": report.get("reused"),
            "bindings": started.get("bindings")}), flush=True)
    finally:
        if launch.root is not None:
            code = launch.handoff()
            if code is not None:
                return code
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as issue:
        print("Original Kafka placement continuation: " + str(issue), file=sys.stderr, flush=True)
        sys.exit(1)
