#!/usr/bin/env python3
"""Receive the retained ClinicalTrials customer through the committed original product."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import traceback
import uuid
import zipfile
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
PARSER = argparse.ArgumentParser(description=__doc__)
PARSER.add_argument("--source-root", required=True, type=Path,
                    help="Complete installed package/source or exact merged repository source")
PARSER.add_argument("--checkpoint", required=True, type=Path)
PARSER.add_argument("--operation", required=True, type=Path,
                    help="Original complete Customer_Operation.json containing mcp.observed")
PARSER.add_argument("--customer", type=Path, help="Optional original complete 43-file customer ZIP")
PARSER.add_argument("--out", required=True, type=Path, help="New directory on persistent receiver storage")
PARSER.add_argument("--node", default=os.environ.get("SF30_XML_NODE", "node"))
ARGS = PARSER.parse_args()
MANIFEST = json.loads((HERE / "input-manifest.json").read_text(encoding="utf-8"))
EXPECTED = MANIFEST["expected"]
SOURCE = ARGS.source_root.resolve(strict=True)
OUT = ARGS.out.resolve()
NODE = shutil.which(ARGS.node) or str(Path(ARGS.node).resolve())
if not Path(NODE).is_file():
    PARSER.error("Select the existing Node executable with --node")
if OUT.exists():
    PARSER.error("Use a new receiving directory; an existing directory retains its original actions")
OUT.mkdir(mode=0o700, parents=True)
TMP = OUT / "temporary"
TMP.mkdir(mode=0o700)
os.environ["SF30_XML_NODE"] = NODE
os.environ.setdefault("NODE_OPTIONS", "--max-old-space-size=384")
os.environ["TMPDIR"] = str(TMP)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True

REPORT = OUT / "ClinicalTrials_Customer_Operation.json"
report = {
    "schema": "stellar-forge.clinicaltrials-complete-receiving.v1",
    "startedAt": datetime.now(timezone.utc).isoformat(),
    "operation": MANIFEST["operation"],
    "sourceCommit": MANIFEST["sourceCommit"],
    "sourceRoot": str(SOURCE),
    "phases": [], "passed": False
}
artifacts = []
servers = []
ws = prs_ws = None

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")

def atomic_write(path, data):
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def identity(path):
    path = Path(path)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}

def verify_identity(path, declared):
    actual = identity(path)
    wanted = {key: declared[key] for key in ("bytes", "sha256")}
    if actual != wanted:
        raise RuntimeError("Original input bytes differ: " + str(path))
    return actual

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def write_report():
    atomic_write(REPORT, json_bytes(report))

def phase(name, **details):
    report["phases"].append({"name": name, "at": datetime.now(timezone.utc).isoformat(), **details})
    write_report()
    print(json.dumps({"phase": name, **details}, ensure_ascii=False), flush=True)

def add(path):
    path = Path(path)
    path.chmod(0o600)
    if path not in artifacts:
        artifacts.append(path)
    return path

def act(action, payload=None, owner=None):
    owner = owner or ws
    return owner.act(action, payload or {}, owner._meta("revision", 0), str(uuid.uuid4()))["result"]

def start_console(owner):
    server = OperatorServer(owner, 0)
    thread = threading.Thread(target=server.serve_forever, name="clinical-receiving-console", daemon=True)
    thread.start()
    servers.append((server, thread))
    return server.url

def run_node(source, context, name):
    driver = TMP / (name + ".mjs")
    atomic_write(driver, source.encode())
    context_path = TMP / (name + "-context.json")
    atomic_write(context_path, json_bytes(context))
    env = dict(os.environ)
    env["CLINICAL_NATIVE_CONTEXT"] = str(context_path)
    log = OUT / (name + "-log.txt")
    try:
        with log.open("w", encoding="utf-8") as output:
            result = subprocess.run([NODE, str(driver)], cwd=SOURCE, env=env,
                                    stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            tail = log.read_text(encoding="utf-8", errors="replace")[-5000:]
            raise RuntimeError(name + " returned " + str(result.returncode) + ": " + tail)
    finally:
        # This receiver-local context includes the borrowed console bearer URL.
        # Original native actions/results remain in their own retained journals.
        context_path.unlink(missing_ok=True)

def archive_directory(directory, target, members=None):
    directory = Path(directory)
    paths = [directory / member for member in members] if members else sorted(directory.rglob("*"))
    with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in paths:
            if path.is_symlink():
                raise RuntimeError("Unexpected link in the retained source package: " + str(path))
            if path.is_file():
                archive.write(path, path.relative_to(directory).as_posix())
    return add(target)

def read_child_report(directory):
    for name in ("result.json", "journey.json", "report.json"):
        path = directory / name
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    return None

try:
    roster_text = MANIFEST["sourceRoster"]["json"].encode("utf-8")
    if git_blob(roster_text) != MANIFEST["sourceRoster"]["gitBlob"]:
        raise RuntimeError("The exact independently read merged source roster changed")
    roster = json.loads(roster_text)
    if roster["sourceCommit"] != MANIFEST["clinicalSourceCommit"] or len(roster["files"]) != 54:
        raise RuntimeError("Use the complete accepted merged Clinical source roster")
    for entry in roster["files"] + MANIFEST["sourceDependencies"]["files"]:
        relative = Path(entry["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError("Unexpected source path in the original roster")
        path = SOURCE / relative
        if not path.is_file() or git_blob(path.read_bytes()) != entry["sha"]:
            raise RuntimeError("Installed source differs from the accepted merged file: " + entry["path"])
    verify_identity(HERE / MANIFEST["callback"]["path"], MANIFEST["callback"])
    inputs = {
        "checkpoint": verify_identity(ARGS.checkpoint, MANIFEST["inputs"]["checkpoint"]),
        "operation": verify_identity(ARGS.operation, MANIFEST["inputs"]["operation"])
    }
    if ARGS.customer:
        inputs["customer"] = verify_identity(ARGS.customer, MANIFEST["inputs"]["customer"])
    original_operation = json.loads(ARGS.operation.read_text(encoding="utf-8"))
    resume_journal = original_operation["mcp"]["observed"]
    if resume_journal["original"]["captureId"] != EXPECTED["captureId"]:
        raise RuntimeError("The original MCP journal belongs to another capture")
    if resume_journal["review"]["id"] not in EXPECTED["reviewIds"]:
        raise RuntimeError("The original completed MCP study review identity changed")
    atomic_write(OUT / "Original_Customer_Operation.json", ARGS.operation.read_bytes())
    add(OUT / "Original_Customer_Operation.json")
    atomic_write(OUT / "input-manifest.json", (HERE / "input-manifest.json").read_bytes())
    add(OUT / "input-manifest.json")
    report["inputFiles"] = inputs
    report["continuedFrom"] = {
        "captureId": EXPECTED["captureId"], "checkpoint": inputs["checkpoint"],
        "journalPhase": resume_journal["phase"], "reviewIds": EXPECTED["reviewIds"]
    }
    phase("committed_source_and_original_input_verified", files=54 + len(MANIFEST["sourceDependencies"]["files"]), sourceCommit=MANIFEST["sourceCommit"])

    CLINICAL = SOURCE / "stellar/scf-starforge-20261009/sf30-seller-sdk/clinicaltrials"
    sys.path.insert(0, str(CLINICAL))
    from clinical_workspace import Workspace
    from clinical_server import OperatorServer
    import clinical_prs

    # Resolve original native modules before opening either original workspace.
    # This imports the installed selected-dataset family and original Clinical MCP leaf.
    import_targets = [
        SOURCE / "stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/publisher.mjs",
        SOURCE / "stellar-forge/mcp-merchant-operator/clinicaltrials-workspace.mjs",
        SOURCE / "stellar-forge/mcp-merchant-operator/config.mjs",
        SOURCE / "stellar-forge/mcp-merchant-operator/serve.mjs"
    ]
    import_script = "\n".join("await import(" + json.dumps(path.as_uri()) + ");" for path in import_targets)
    preflight = subprocess.run([NODE, "--input-type=module", "-e", import_script],
                               cwd=SOURCE, capture_output=True, text=True)
    if preflight.returncode:
        raise RuntimeError("Complete committed native source import: " + preflight.stderr[-5000:])
    runtime = clinical_prs.doctor()
    report["prsRuntime"] = runtime
    if not runtime.get("ready"):
        raise RuntimeError("Install the source-declared PRS Python runtime: " + json.dumps(runtime))
    phase("original_native_source_and_prs_ready", schemaSetSha256=runtime.get("schemaSetSha256"))

    ws = Workspace(OUT / "workspace", create=True)
    act("package.import", {"packagePath": str(ARGS.checkpoint.resolve()), "sha256": inputs["checkpoint"]["sha256"]})
    capture = ws.capture_manifest()
    build = ws.build_view(ws._meta("activeBuild"))
    if (capture["id"] != EXPECTED["captureId"] or capture["rowCount"] != EXPECTED["studies"]
            or len(capture["pages"]) != EXPECTED["pages"]
            or build["id"] != EXPECTED["buildId"]
            or build["native"]["snapshot"] != EXPECTED["snapshot"]):
        raise RuntimeError("The original full source/build identity changed on receiving")
    current_reviews = json.dumps(ws.state()["reviews"])
    for review_id in EXPECTED["reviewIds"]:
        if review_id not in current_reviews:
            raise RuntimeError("An original completed study review is missing")
    report["capture"] = capture
    phase("original_portfolio_and_both_reviews_received", captureId=capture["id"],
          studies=capture["rowCount"], snapshot=build["native"]["snapshot"])
    prs_ws = Workspace(OUT / "prs-example-workspace", create=True)
    console_url = start_console(ws)
    prs_url = start_console(prs_ws)

    report["browser"] = {"passed": False}
    browser_directory = OUT / "browser"
    try:
        browser_source = (
            "import {readFile,writeFile} from 'node:fs/promises';\n"
            "import {runClinicalTrialsBrowserJourney} from " + json.dumps((HERE / "run-browser-receiving.mjs").as_uri()) + ";\n"
            "const options=JSON.parse(await readFile(process.env.CLINICAL_NATIVE_CONTEXT,'utf8'));\n"
            "const result=await runClinicalTrialsBrowserJourney(options);\n"
            "await writeFile(options.outputDirectory+'/result.json',JSON.stringify(result,null,2)+'\\n');\n"
            "console.log(JSON.stringify({passed:result.passed,steps:result.steps.length,downloads:result.downloads.length}));\n"
        )
        run_node(browser_source, {
            "consoleUrl": console_url, "prsConsoleUrl": prs_url, "sourceRoot": str(SOURCE),
            "outputDirectory": str(browser_directory)
        }, "browser-run")
        report["browser"] = read_child_report(browser_directory)
        phase("rendered_source_publisher_and_xml_receiving", passed=report["browser"].get("passed"))
    except BaseException as exc:
        report["browser"] = {"passed": False, "error": str(exc), "observed": read_child_report(browser_directory)}
        phase("rendered_receiving_result", passed=False, error=str(exc))

    report["mcp"] = {"passed": False}
    mcp_directory = OUT / "mcp"
    try:
        mcp_source = (
            "import {readFile,writeFile} from 'node:fs/promises';\n"
            "import {runClinicalTrialsMcpJourney} from " + json.dumps((HERE / "run-mcp-receiving.mjs").as_uri()) + ";\n"
            "const options=JSON.parse(await readFile(process.env.CLINICAL_NATIVE_CONTEXT,'utf8'));\n"
            "const result=await runClinicalTrialsMcpJourney(options);\n"
            "await writeFile(options.outputDirectory+'/result.json',JSON.stringify(result,null,2)+'\\n');\n"
            "console.log(JSON.stringify({passed:result.passed,steps:result.steps?.length}));\n"
        )
        run_node(mcp_source, {
            "sourceRoot": str(SOURCE), "consoleUrl": console_url, "outputDirectory": str(mcp_directory),
            "captureId": capture["id"], "expectedStudies": EXPECTED["studies"],
            "reviewedBy": "1FB3 internal customer receiving", "installOverlay": False,
            "portableReopen": True, "resumeJournal": resume_journal
        }, "mcp-run")
        report["mcp"] = read_child_report(mcp_directory)
        tool_names=report["mcp"].get("toolNames",[])
        if (len(tool_names)!=len(set(tool_names)) or
                sorted(tool_names)!=sorted(EXPECTED["toolNames"])):
            raise RuntimeError("The installed Clinical MCP catalog differs from its complete original named interface")
        phase("same_console_complete_mcp_receiving", passed=report["mcp"].get("passed"))
    except BaseException as exc:
        report["mcp"] = {"passed": False, "error": str(exc), "observed": read_child_report(mcp_directory)}
        phase("mcp_receiving_result", passed=False, error=str(exc))

    current = ws.state()
    exported = ws.verify_export(current["exports"][-1]["id"]) if current["exports"] else act("package.export")
    report["export"] = exported
    export_directory = Path(exported["directory"])
    if exported["snapshot"] != EXPECTED["snapshot"]:
        raise RuntimeError("The customer export differs from the original native snapshot")
    verify_identity(export_directory / "dataset.csv", EXPECTED["csv"])
    archive_directory(export_directory, OUT / "ClinicalTrials_Daiichi_Registry_Customer.zip",
                      [entry["name"] for entry in exported["files"]])
    for source_name, target_name in [
        ("clinicaltrials-workspace.zip", "ClinicalTrials_Daiichi_Workspace.zip"),
        ("dataset.csv", "ClinicalTrials_Daiichi_Registry.csv"),
        ("RECEIVING.md", "ClinicalTrials_Receiving.md")
    ]:
        target = OUT / target_name
        shutil.copy2(export_directory / source_name, target)
        add(target)

    browser_report = report["browser"].get("observed") or report["browser"]
    package_directory = browser_report.get("publisher", {}).get("packageDirectory")
    if package_directory:
        package_directory = Path(package_directory)
        descriptor = json.loads((package_directory / "source.json").read_text(encoding="utf-8"))
        members = descriptor.get("sourceFiles", [])
        if not members:
            raise RuntimeError("The original staged dataset lost its complete raw-source closure")
        for entry in members:
            relative = Path(entry["path"])
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unexpected original dataset source member")
            verify_identity(package_directory / relative, entry)
        release_archive = archive_directory(package_directory, OUT / "ClinicalTrials_Dataset_Release_Source.zip")
        report["datasetReleaseSource"] = {"sourceFiles": len(members), **identity(release_archive)}
    report["publisher"] = ws.state()["publisher"]
    report["passed"] = bool(report["browser"].get("passed") and report["mcp"].get("passed"))
    phase("complete_customer_files_retained", exportId=exported["id"],
          files=len(exported["files"]), snapshot=exported["snapshot"])

except BaseException as exc:
    report["passed"] = False
    report["error"] = {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()}
    phase("receiving_error", error=report["error"])
finally:
    for server, thread in reversed(servers):
        try:
            server.shutdown()
            thread.join(timeout=10)
            server.server_close()
        except Exception as exc:
            report.setdefault("closeErrors", []).append(str(exc))
    for owner, label in [
        (prs_ws, "ClinicalTrials_Original_PRS_Example_Workspace.zip"),
        (ws, "ClinicalTrials_Customer_Checkpoint.zip")
    ]:
        if owner is None:
            continue
        try:
            target = OUT / label
            owner._portable(target)
            add(target)
            report["state" if owner is ws else "prsExampleState"] = owner.state()
        except Exception as exc:
            report.setdefault("checkpointErrors", []).append(str(exc))
        finally:
            try:
                owner.close()
            except Exception as exc:
                report.setdefault("closeErrors", []).append(str(exc))
    if report.get("closeErrors") or report.get("checkpointErrors"):
        report["passed"] = False
    report["completedAt"] = datetime.now(timezone.utc).isoformat()
    report["artifacts"] = [{"name": path.name, **identity(path)} for path in artifacts]
    write_report()
    add(REPORT)
    files = [{"name": path.name, **identity(path)} for path in artifacts]
    atomic_write(OUT / "receiving-files.json", json_bytes({
        "schema": "stellar-forge.clinicaltrials-receiving-files.v1",
        "passed": report["passed"], "sourceCommit": MANIFEST["sourceCommit"],
        "captureId": EXPECTED["captureId"], "snapshot": EXPECTED["snapshot"], "files": files
    }))
    print(json.dumps({
        "clinicaltrials_receiving": {
            "passed": report["passed"], "sourceCommit": MANIFEST["sourceCommit"],
            "captureId": EXPECTED["captureId"], "snapshot": EXPECTED["snapshot"],
            "exportId": report.get("export", {}).get("id"),
            "browserPassed": report.get("browser", {}).get("passed"),
            "mcpPassed": report.get("mcp", {}).get("passed"),
            "outputDirectory": str(OUT), "files": files, "error": report.get("error")
        }
    }, ensure_ascii=False), flush=True)
    if not report["passed"]:
        raise SystemExit(1)
