#!/usr/bin/env python3
"""Prepare and enter one original admitted public cohort foreground.

This is the local execution caller for the existing native host and published
public-cohort-foreground.py, not another controller.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys

OPERATION = "scf-public-python-e287-workbooks-agents-a66c-20261012"
PUBLISHED = {
    "engine.py": "0a11ddd116f0d093470f0f67e4707da3192d250f08d9a894c5ebf7596e144be8",
    "run-public-cohort.sh": "38c31168d4fbedc5b34595ea28e54879d3329cbf767dde782695b275cd654259",
    "public-cohort-foreground.py": "f05efddfa9f1b609a76b19a817e57e0c3fae37e4668457782c3998d8af9d8a67",
}
HELPERS = {
    "library_upload.py": "5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767",
    "library_hosted_apps.py": "97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59",
    "library_file_transfer.py": "5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378",
}
SESSION_SHA = "dfd802b9cc17dc0aaac48a6d0f70bcf39ee2515fb33730d97286c4f55aa83e48"
SOURCE = {
  "buildRequirements": [
    "setuptools>=68"
  ],
  "extras": {
    "agents": [
      "langchain-core>=1.6.9,<2",
      "langgraph>=1.2.14,<2",
      "langgraph-checkpoint-sqlite>=3.1.1,<4",
      "pydantic>=2.14,<3"
    ],
    "workbooks": [
      "openpyxl==3.1.5"
    ]
  },
  "files": [
    {
      "bytes": 39601,
      "path": "README.md",
      "sha256": "06f1f7e07d56836dc9d5c250ad3656dbe6b37f62d63e127ed75a90a77761b83d"
    },
    {
      "bytes": 864,
      "path": "pyproject.toml",
      "sha256": "0bd177891a543d628997c4a4e8c110b0941bcd73316a4ed22eb5dc3125a3a011"
    },
    {
      "bytes": 1538,
      "path": "stellar_forge_buyer/__init__.py",
      "sha256": "d416ba44ea061c450cbfff84e026dd1b1c189cea397b878b0fef50b0fb48812b"
    },
    {
      "bytes": 7212,
      "path": "stellar_forge_buyer/__main__.py",
      "sha256": "fc80a81da072195b5e24fa8927fab8fc31ba27a959c675d75cbe2b14fb099381"
    },
    {
      "bytes": 4642,
      "path": "stellar_forge_buyer/_analysis_export_http.py",
      "sha256": "8d4fcb14055814e81685c80fcf3656dd0ec82f4b69bbcdfe6ee8cac911a1254c"
    },
    {
      "bytes": 23160,
      "path": "stellar_forge_buyer/_analysis_export_ui.py",
      "sha256": "092eac9e8232832619322d9601309ea0aa8cd1176c693fc42462e5ecf16f2cbb"
    },
    {
      "bytes": 28514,
      "path": "stellar_forge_buyer/_analysis_profiles_ui.py",
      "sha256": "a847b0ddcc538b4e2056417d97c0e711a7d1fe1114484d1c070220aa0e84b490"
    },
    {
      "bytes": 30801,
      "path": "stellar_forge_buyer/_analysis_reports_ui.py",
      "sha256": "1e9fcb1d29820628786cd6afbc16a3487ef96d3bd82ff45b3590abc906344a50"
    },
    {
      "bytes": 16658,
      "path": "stellar_forge_buyer/_analysis_response_ui.py",
      "sha256": "d3f42c269cdcfcd46b9e5aad34356d28219f799a4801cb4e9cd837805376a45b"
    },
    {
      "bytes": 53938,
      "path": "stellar_forge_buyer/_analysis_ui.py",
      "sha256": "a62b871917872d1a98906027986f05a2d6273afab639eab9f49529bbf971ee4d"
    },
    {
      "bytes": 13062,
      "path": "stellar_forge_buyer/_analysis_workbook_refresh_ui.py",
      "sha256": "886f17f1581b1a650f16d665a5f2e99cfaec3adac2a545814494d8f28c981ed5"
    },
    {
      "bytes": 25238,
      "path": "stellar_forge_buyer/_analysis_workbooks_ui.py",
      "sha256": "bc997281f2179f2e580d033c37468439a644a64618dfb1823df46b16ce95fb22"
    },
    {
      "bytes": 17307,
      "path": "stellar_forge_buyer/acquisitions.py",
      "sha256": "66023df3eeebebed2fb6604017fe55c1eb89910ae7800685b152bc3bc6c6a30f"
    },
    {
      "bytes": 8983,
      "path": "stellar_forge_buyer/agent_tools.py",
      "sha256": "163a5a5bbe3100a70a17792daca22d4256ef3f52af484f6950109aca4311f00f"
    },
    {
      "bytes": 41480,
      "path": "stellar_forge_buyer/agent_workflow.py",
      "sha256": "e1ee2fa09b65f3d53615962338ddb1ba1cf0095d6473c95f438362a9d333014b"
    },
    {
      "bytes": 17847,
      "path": "stellar_forge_buyer/analysis_export_delivery.py",
      "sha256": "97a1dd713494ea958961cc161603efdfd3d00e467def927bbfe8f2e5d789261a"
    },
    {
      "bytes": 14395,
      "path": "stellar_forge_buyer/analysis_exports.py",
      "sha256": "f0baf1770774fed9d4acbb7a0023716d574cb4755aa9dc4ba0e093bf57e660dd"
    },
    {
      "bytes": 4681,
      "path": "stellar_forge_buyer/analysis_native.py",
      "sha256": "06b5ccc3b6e8cb6c06f3fe68b4128243e37693cd06f079d61a927d5dd3f5eda4"
    },
    {
      "bytes": 39041,
      "path": "stellar_forge_buyer/analysis_reports.py",
      "sha256": "f81931819a76e922c55c30827d3eda2d0f5bf9abeb303b1908e63c7270bc5170"
    },
    {
      "bytes": 58296,
      "path": "stellar_forge_buyer/analysis_workbooks.py",
      "sha256": "e89ef28dda857413addc5a3a6fa31b53bae005aee0c52b0b820a84cb40197081"
    },
    {
      "bytes": 50217,
      "path": "stellar_forge_buyer/analysis_workspace.py",
      "sha256": "51a81024a6609b65dd9f42926a9af0c56ef8d34993b7603b1a5e31d4f867fb9a"
    },
    {
      "bytes": 44900,
      "path": "stellar_forge_buyer/client.py",
      "sha256": "8681fecda781bec8c2948ead6b2c9d3734883cc848269b257472f4af5261184d"
    },
    {
      "bytes": 25843,
      "path": "stellar_forge_buyer/dataset_changes.py",
      "sha256": "7b4670ea951c317c29f1834beffbe7bde6b0a1754f865958e362b10a21711148"
    },
    {
      "bytes": 26354,
      "path": "stellar_forge_buyer/dataset_profiles.py",
      "sha256": "ca6e743f8e29773f29f42376a70c7fcfd63cb315b982d6eb2a14fbc723488adf"
    },
    {
      "bytes": 10829,
      "path": "stellar_forge_buyer/datasets.py",
      "sha256": "1134b80323bbdbd68805d3244ae0b27fdf433c11688f3c6bf41adc3716d25da4"
    },
    {
      "bytes": 965,
      "path": "stellar_forge_buyer/errors.py",
      "sha256": "4f4b01c2b09cc332c5b037c86959e758df7e361c39d0c1ec20e155f69bfeef3e"
    },
    {
      "bytes": 16158,
      "path": "stellar_forge_buyer/objects.py",
      "sha256": "a2a08823c37a35f020fcf37d1d5d1755c8846f3b679c0632a6f6b632c45a344d"
    },
    {
      "bytes": 8981,
      "path": "stellar_forge_buyer/profile_cli.py",
      "sha256": "3a8aec4792559424bf94e6e8a71ed4bffa66e362c138de05f3d5905cd0e79ded"
    },
    {
      "bytes": 22980,
      "path": "stellar_forge_buyer/query_export.py",
      "sha256": "17185c98b3f517b0581e90a43aa8e65d571440c10aba859dd32df983ebf918a6"
    },
    {
      "bytes": 6332,
      "path": "stellar_forge_buyer/query_stream.py",
      "sha256": "eced868dda3f1346e9d023a9b2609ad54c0142800ee50c9770eb1ebef3233508"
    },
    {
      "bytes": 8803,
      "path": "stellar_forge_buyer/recovery.py",
      "sha256": "853cd256d27f557c91c82c2d734a66900ed54d0f4e8c4ee8e95e4c89dc809160"
    },
    {
      "bytes": 2723,
      "path": "stellar_forge_buyer/requests.py",
      "sha256": "fa6f2a1b8a45d0058788f68c9a000a1feedee5bae953448c0fa8431391129157"
    },
    {
      "bytes": 36470,
      "path": "stellar_forge_buyer/response_tables.py",
      "sha256": "7549eb590626bcfdc16576b3b7f8ef2a673eea6be2b5e88feb53b4a6ff02554e"
    },
    {
      "bytes": 12628,
      "path": "stellar_forge_buyer/result.py",
      "sha256": "4310436cb01184404b1805bf304b726234ba6c88c1163071bbd6d0947bf6d4b4"
    },
    {
      "bytes": 7249,
      "path": "stellar_forge_buyer/runtime.py",
      "sha256": "0249916441bd6bfdcf0866c835c8b3b5a7fe5eb8da11d2a57289ea9b519beee9"
    },
    {
      "bytes": 24403,
      "path": "stellar_forge_buyer/sqlite_dataset.py",
      "sha256": "3a989b46f67caba2262da948db8cfb95851ce09929a02cd36203fb7029a6b4de"
    },
    {
      "bytes": 3230,
      "path": "stellar_forge_buyer/storage.py",
      "sha256": "9dd9dbc6e8cdd2de82235399dc12aa1ed43318e82255bb50afdcf34cdfeef26b"
    },
    {
      "bytes": 10820,
      "path": "stellar_forge_buyer/streams.py",
      "sha256": "a90e8bd829012b499cd42c6a344ecc96ce87b2f0391516e51d3c7a92b818f1d3"
    },
    {
      "bytes": 11954,
      "path": "stellar_forge_buyer/workbook_client.py",
      "sha256": "19b491d931313c263f4dd96f2879e046226309b2e3b371547983222005165f0f"
    },
    {
      "bytes": 17488,
      "path": "stellar_forge_buyer/workbook_refresh.py",
      "sha256": "826e42fc6f53238ba5ed5c587d532a3e9d91b9cd233b92a8404c54564b024281"
    }
  ],
  "id": "63faa446741cc98429d80516b34ee993ffe060e1b2739223bc84f18c8e4a88d5",
  "name": "stellar-forge-buyer",
  "packagePaths": [
    "stellar_forge_buyer"
  ],
  "releaseDigest": "267cd1292c8e542e8a70134c814bba7d624d2b375191a8892fb269f226bf4ff7",
  "releaseId": "e28755f20dd4f9cb932d82fb59feb48424e327e7",
  "requiresPython": ">=3.11",
  "scripts": {
    "stellar-forge-agent": "stellar_forge_buyer.agent_workflow:main",
    "stellar-forge-buyer": "stellar_forge_buyer.__main__:main",
    "stellar-forge-workbook": "stellar_forge_buyer.analysis_workbooks:main",
    "stellar-forge-workbook-deliver": "stellar_forge_buyer.workbook_client:main"
  },
  "version": "0.5.0"
}


def need(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with Path(path).open("rb") as body:
        return hashlib.file_digest(body, "sha256").hexdigest()


def private(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    value = path.lstat()
    need(not path.is_symlink() and path.resolve() == path and stat.S_ISDIR(value.st_mode)
         and value.st_uid == os.getuid() and not value.st_mode & 0o077,
         "Select an existing or new owned private directory")
    return path


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def copy_original(source, target, expected, mode=0o600):
    source, target = Path(source), Path(target)
    need(source.is_file() and digest(source) == expected, "Original selected source bytes differ: " + source.name)
    if target.exists():
        need(not target.is_symlink() and target.is_file() and digest(target) == expected,
             "Preserve the different existing selected file: " + target.name)
        return
    temporary = target.with_name(target.name + ".pending")
    descriptor = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, "r+b") as output, source.open("rb") as original:
        information = os.fstat(output.fileno())
        need(stat.S_ISREG(information.st_mode) and information.st_uid == os.getuid()
             and information.st_nlink == 1 and not information.st_mode & 0o077,
             "Preserve the different existing source staging file")
        need(information.st_size <= source.stat().st_size,
             "Preserve source staging that exceeds the original")
        remaining = information.st_size
        while remaining:
            amount = min(1024 * 1024, remaining)
            need(output.read(amount) == original.read(amount),
                 "Preserve source staging with different original bytes")
            remaining -= amount
        output.seek(information.st_size)
        shutil.copyfileobj(original, output, 1024 * 1024)
        output.flush()
        os.fsync(output.fileno())
    need(digest(temporary) == expected, "Selected source changed during copying")
    os.link(temporary, target)
    sync_directory(target.parent)
    try:
        temporary.unlink(missing_ok=True)
    except OSError:
        pass  # The exact source file is already durably published.


def save_plan(path, value):
    data = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
    if path.exists():
        need(path.read_bytes() == data, "Preserve the existing different original producer plan")
        return
    temporary = path.with_name(path.name + ".pending")
    descriptor = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+b") as output:
        information = os.fstat(output.fileno())
        need(stat.S_ISREG(information.st_mode) and information.st_uid == os.getuid()
             and information.st_nlink == 1 and not information.st_mode & 0o077
             and information.st_size <= len(data), "Preserve different existing plan staging")
        prefix = output.read()
        need(data.startswith(prefix), "Preserve the different original plan prefix")
        output.seek(len(prefix))
        output.write(data[len(prefix):])
        output.flush()
        os.fsync(output.fileno())
    os.link(temporary, path)
    sync_directory(path.parent)
    try:
        temporary.unlink(missing_ok=True)
    except OSError:
        pass  # The exact plan is already durably published.


def configure_native_launch_parser(native, parser):
    """Use the installed host's launch API or its original inline parser.

    The legacy declaration below is copied from Commons a51d9c5a139e1aad9cc7e37d5662efb887ca7f79,
    host/swarm_cloud_job.py, blob d49362d031ec4630b38f961d4c7f143a0c4e8308.
    Runtime and storage arguments still come from that same installed host.
    """
    maintained = getattr(native, "launch_options", None)
    if callable(maintained):
        maintained(parser)
        return
    sub = parser
    MEMORY_ADMISSION_RECLAIM_MODES = native.MEMORY_ADMISSION_RECLAIM_MODES
    sub.add_argument("peer")
    sub.add_argument("--operation-id", required=True)
    sub.add_argument("--project", required=True)
    sub.add_argument("--java", choices=("17", "21"))
    sub.add_argument("--node", choices=("18", "24"))
    sub.add_argument("--artifact", action="append", default=[], help="output required for either exit outcome")
    sub.add_argument("--artifact-on-success", action="append", default=[], help="output required only for exit code zero")
    sub.add_argument("--artifact-on-failure", action="append", default=[], help="output required only for a nonzero exit")
    from runtime_consumers import runtime_options
    runtime_options(sub)
    sub.add_argument("--memory-mib", type=int, help="original job's declared peak memory; queue before command start")
    sub.add_argument("--memory-reserve-mib", type=int, default=256,
                     help="shared control-plane headroom retained at admission")
    sub.add_argument("--memory-reservations-root", help="same shared VM reservation directory used by other jobs")
    sub.add_argument("--memory-reclaim", choices=MEMORY_ADMISSION_RECLAIM_MODES, default="none",
                     help="clean-cache includes the explicit kernel cache estimate; hard counters remain visible")
    sub.add_argument("--disk-space", action="append", default=[], metavar="PATH=MIB",
                     help="additional filesystem MiB this command can create; repeat for separate paths")
    sub.add_argument("--disk-inodes", action="append", default=[], metavar="PATH=COUNT",
                     help="additional filesystem inodes this command can create; repeat for separate paths")
    sub.add_argument("--disk-reserve-mib", type=int, default=64,
                     help="shared filesystem byte headroom retained at admission (default: 64 MiB)")
    sub.add_argument("--disk-reserve-inodes", type=int, default=128,
                     help="shared filesystem inode headroom retained at admission (default: 128)")
    sub.add_argument("--disk-reservations-root", "--disk-ledger-root", dest="disk_reservations_root",
                     help="same shared VM disk reservation directory used by other jobs")
    from swarm_cloud_worker import storage_options
    storage_options(sub)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--control", required=True)
    parser.add_argument("--work", required=True)
    parser.add_argument("--payload", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--library-session", required=True)
    parser.add_argument("--library-helpers", required=True)
    parser.add_argument("--ledger-reference", required=True)
    parser.add_argument("--operation-id", default=OPERATION)
    args = parser.parse_args()
    need(sys.implementation.name == "cpython" and sys.version_info[:2] == (3, 12),
         "Invoke this same foreground with the selected CPython3.12")
    os.umask(0o077)
    host = Path(args.host).resolve(strict=True)
    payload = Path(args.payload).resolve(strict=True)
    source = Path(args.source).resolve(strict=True)
    for item in SOURCE["files"]:
        member = source / item["path"]
        need(member.is_file() and member.stat().st_size == item["bytes"]
             and digest(member) == item["sha256"], "Original selected project member differs: " + item["path"])
    reference_path = Path(args.ledger_reference).resolve(strict=True)
    reference = json.loads(reference_path.read_bytes())["intent"]
    memory_ledger = reference["memory"]["ledger_root"]
    disk_ledger = reference["disk"]["ledger_root"]
    need(Path(memory_ledger).is_absolute() and Path(disk_ledger).is_absolute(),
         "Reuse the original shared admission ledgers")
    control, work = private(args.control), private(args.work)
    need(control != work and not control.is_relative_to(work), "Keep compact control outside the temporary root")
    preparation = os.open(control / "preparation.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(preparation, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name, expected in PUBLISHED.items():
            copy_original(payload / name, control / name, expected,
                          mode=0o700 if name.endswith(".sh") else 0o600)
        helper_directory = private(control / "library-helper")
        for name, expected in HELPERS.items():
            copy_original(Path(args.library_helpers) / name, helper_directory / name, expected)
        session = control / "connected-library-session.py"
        copy_original(Path(args.library_session), session, SESSION_SHA)
        records = private(control / "native-records")
        native_record = records / hashlib.sha256(args.operation_id.encode()).hexdigest()
        plan = {
            "schema": "stellar-forge.public-cohort-plan.v1",
            "operation_id": OPERATION, "native_operation_id": args.operation_id,
            "directory": str(work), "control": str(control),
            "engine": str(control / "engine.py"),
            "wrapper": str(control / "run-public-cohort.sh"),
            "python": sys.executable,
            "source": {**SOURCE, "directory": str(source)},
            "capacity_request": str(native_record / "request.json"),
            "limits": {"disk_bytes": 256 * 1024**2, "reserve_bytes": 32 * 1024**2},
            "library": {"session": str(session), "helpers": str(helper_directory)},
            "predecessor": {"request": str(reference_path), "request_sha256": digest(reference_path)},
        }
        plan_path = control / "public-plan.json"
        save_plan(plan_path, plan)
    finally:
        os.close(preparation)
    sys.path.insert(0, str(host))
    from native_foreground import ForegroundLaunch, load_native
    native = load_native(host)
    native_parser = argparse.ArgumentParser()
    configure_native_launch_parser(native, native_parser)
    native_args = native_parser.parse_args([
        "a66c", "--operation-id", args.operation_id, "--project", str(control),
        "--records-root", str(records), "--worker-root", str(work / "workers"),
        "--temp-root", str(work / "tmp"), "--memory-mib", "512",
        "--memory-reserve-mib", "128", "--memory-reclaim", "clean-cache",
        "--memory-reservations-root", memory_ledger,
        "--disk-space", str(work) + "=256", "--disk-inodes", str(work) + "=8000",
        "--disk-space", str(control) + "=2", "--disk-inodes", str(control) + "=256",
        "--disk-reserve-mib", "32", "--disk-reserve-inodes", "128",
        "--disk-reservations-root", disk_ledger,
        "--runtime-path", str(host), "--runtime-path", str(source),
        "--runtime-path", str(control),
        "--artifact", "public-plan.json",
        "--artifact-on-success", "producer-result.json", "--artifact-on-success", "custody.json",
    ])
    native_args.command = [sys.executable, "-B", str(control / "public-cohort-foreground.py"),
                           "--plan", str(plan_path)]
    launch = ForegroundLaunch(native)
    try:
        report = native.start(native_args, launcher=launch)
        print(json.dumps({"schema": "stellar-forge.public-cohort-launch.v1",
                          "operation_id": args.operation_id, "record": str(native_record),
                          "plan_sha256": digest(plan_path),
                          "state": report.get("state"), "reused": report.get("reused", False),
                          "foreground_acquired": launch.root is not None}), flush=True)
    finally:
        if launch.root is not None:
            code = launch.handoff()
            if code is not None:
                raise SystemExit(code)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"schema": "stellar-forge.public-cohort-launch.v1",
                          "state": "FAILED", "error_type": type(error).__name__,
                          "error": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
