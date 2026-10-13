#!/usr/bin/env python3
"""Join the selected workbook continuation to the existing Conapi owner's run.

Called by continue_conapi.py while its original continuation flock is held.
The original application selection and native requests are never changed here.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from preserve_delivery import atomic_json

OPERATION = "CONAPI-SUPPLIER-WORKBOOK-RECEIVING-7A2F-20261012"
ORIGINAL_OPERATION = "SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012"
APPLICATION_OPERATION = "CONAPI-WORKFLOW-RECEIVING-DSCEB3-20261012"
PRODUCT = "products/conapi/supplier-report"
DRIVER = PRODUCT + "/tools/receive_review_workbook.mjs"
DRIVER_SHA256 = "2a0b3bf4af4eb278b987cb404fde97dfac5b56835474b0c109a935b06554dbd3"
CORE_SHA256 = "f5643bf116141787d5412e8e444c12d7a18ea59415cca1d5302b55cc7725ede4"
INPUT_SHA256 = "4020b1ee82e66b7b25886159248c92b7a1ee5006bc7fc71f698844e61a8924b9"
INPUT_BYTES = 65289
IMPLEMENTATION_SHA256 = "9e805a59afa79d1be1d3e351e2109b298a3dd1337d53438010b2e39adaa85d9b"
IMPLEMENTATION_BYTES = 65135


def read(path):
    return json.loads(Path(path).read_bytes())


def identity(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Keep the original regular receiving file: " + str(path))
    before = path.stat()
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            sha.update(block)
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError("A receiving file changed while being read: " + str(path))
    return {"path": str(path), "bytes": after.st_size, "sha256": sha.hexdigest()}


def canonical_path(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise ValueError("Use an existing canonical receiving path: " + str(path))
    return path


def runtime_path(value):
    path = Path(value)
    if not path.is_absolute() or Path(os.path.normpath(path)) != path or not path.is_file():
        raise ValueError("Use the original existing runtime executable/module: " + str(path))
    return path


def checked_command(command, *, cwd):
    result = subprocess.run(command, cwd=cwd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError("The existing source/runtime read failed: " +
                           result.stderr.decode("utf-8", errors="replace")[-8000:])
    return result.stdout.decode("utf-8", errors="strict").strip()



# Host executables are separate from the original source, parent and workbooks
# installation selection. Python and its installationId remain exact.
HOST_BINDING_KEYS = ("node", "browserExecutable", "playwrightModule", "nodeModules")


def semantic_selection(value):
    result = dict(value)
    result["runtime"] = {key: item for key, item in value["runtime"].items()
                         if key not in HOST_BINDING_KEYS}
    return result


def observed_runtime(value):
    observed = {}
    for key in HOST_BINDING_KEYS + ("python",):
        path = Path(value[key])
        actual = path.resolve(strict=True)
        stat = actual.stat()
        expected_directory = key == "nodeModules"
        if (expected_directory and not actual.is_dir()) or (not expected_directory and not actual.is_file()):
            raise ValueError("The selected host binding has the wrong file type: " + str(path))
        if key in ("node", "python", "browserExecutable") and not os.access(actual, os.X_OK):
            raise ValueError("The selected host executable is not executable: " + str(path))
        observed[key] = {"path": str(path), "resolved": str(actual),
                         "bytes": stat.st_size, "mtimeNs": stat.st_mtime_ns}
    observed["installationId"] = value["installationId"]
    return observed


def retain_execution_binding(root, original, current):
    if semantic_selection(original) != semantic_selection(current):
        raise ValueError("Continue the original workbook source, parent, output and installed Python identity.")
    selected_path = root / "conapi-workbook-execution-bindings.json"
    history = read(selected_path) if selected_path.exists() else {
        "schema": "commons.conapi-workbook-execution-bindings.v1",
        "operation": OPERATION, "originalSelection": original, "attempts": []}
    if history.get("operation") != OPERATION or history.get("originalSelection") != original:
        raise ValueError("The retained execution history belongs to another original workbook selection.")
    observation = observed_runtime(current["runtime"])
    previous = history["attempts"][-1]["runtime"] if history["attempts"] else original["runtime"]
    receipt = {"sequence": len(history["attempts"]) + 1, "at": time.time(),
               "runtime": current["runtime"], "observed": observation,
               "changed": [key for key in HOST_BINDING_KEYS
                           if previous.get(key) != current["runtime"].get(key)]}
    history["attempts"].append(receipt)
    atomic_json(selected_path, history)
    return receipt


def retained_source_copy(target, data):
    target = Path(target)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    expected = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if target.exists():
        actual = identity(target)
        if any(actual[key] != expected[key] for key in expected):
            raise ValueError("A retained receiving implementation changed: " + str(target))
        return actual
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".source-", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        try:
            os.link(temporary, target)
        except FileExistsError:
            actual = identity(target)
            if any(actual[key] != expected[key] for key in expected):
                raise ValueError("The receiving source publication differs.")
        descriptor = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)
    return identity(target)


def prepare_receiving_implementation(root, original_driver, source_ref):
    supplied = Path(__file__).resolve().with_name("workbook_receiving.mjs")
    body = supplied.read_bytes()
    if len(body) != IMPLEMENTATION_BYTES or hashlib.sha256(body).hexdigest() != IMPLEMENTATION_SHA256:
        raise ValueError("Keep the complete selected workbook custody implementation.")
    original_body = Path(original_driver["path"]).read_bytes()
    if hashlib.sha256(original_body).hexdigest() != DRIVER_SHA256:
        raise ValueError("Keep the exact original workbook driver as the preserved predecessor.")
    directory = root / "conapi-workbook-receiving-source" / IMPLEMENTATION_SHA256
    executed = retained_source_copy(directory / "workbook_receiving.mjs", body)
    predecessor = retained_source_copy(directory / "original_receive_review_workbook.mjs", original_body)
    receipt = {"schema": "commons.conapi-workbook-implementation-selection.v1",
               "operation": OPERATION, "originalSourceRef": source_ref,
               "originalDriver": original_driver, "retainedOriginalDriver": predecessor,
               "implementation": executed,
               "scope": "same original product; host-local inspection images and clean outgoing archive"}
    selection_path = directory / "implementation.json"
    if selection_path.exists():
        if read(selection_path) != receipt:
            raise ValueError("The retained workbook implementation selection changed.")
    else:
        atomic_json(selection_path, receipt)
    return receipt


def run_workbook_following(*, root, node, original_input, programme, source_root,
                           run_native, emit, output_directory=None):
    """Run one full native workbook leg before the original owner's final save."""
    root = canonical_path(root)
    source_root = canonical_path(source_root or root / "canonical-repository")
    node = runtime_path(node)
    if read(root / "delivery-input.json").get("operation") != ORIGINAL_OPERATION:
        raise ValueError("Keep the original Datasette/Conapi programme.")
    if programme.get("phase") not in ("COMPLETE", "SUPPLIER_RECEIVING_COMPLETE"):
        raise ValueError("Complete the original supplier/installed programme first.")
    if not programme.get("id") or programme.get("input", {}).get("sourceRef") != (
            "e5520a2a962ccebc461d478edf6aebb4b6c7fb20"):
        raise ValueError("Keep the original accepted Conapi application selection.")

    # This is a read of the receiving owner's supplied source checkout. No
    # checkout, fetch, application install or original source mutation occurs.
    git = lambda *args: checked_command(["git", "-C", str(source_root), *args], cwd=root)
    if Path(git("rev-parse", "--show-toplevel")) != source_root:
        raise ValueError("Select the complete canonical source checkout root.")
    source_ref = git("rev-parse", "HEAD")
    if len(source_ref) != 40 or any(c not in "0123456789abcdef" for c in source_ref):
        raise ValueError("The supplied source has no exact Git commit.")
    if git("status", "--porcelain", "--untracked-files=all", "--", PRODUCT):
        raise ValueError("Preserve and publish the supplier source changes before this run.")

    driver = identity(source_root / DRIVER)
    core = identity(source_root / PRODUCT / "supplier-report.mjs")
    original = identity(source_root / PRODUCT / "examples/elite-reimport-workspace.json")
    if driver["sha256"] != DRIVER_SHA256:
        raise ValueError("Receive the complete workbook driver with the merged PR883 shutdown correction.")
    if core["sha256"] != CORE_SHA256:
        raise ValueError("The original supplier model differs from the selected complete workbook source.")
    if original["sha256"] != INPUT_SHA256 or original["bytes"] != INPUT_BYTES:
        raise ValueError("Retain the actual complete Elite reimport workspace.")

    # The original application has already installed the workbooks environment.
    # Its returned interpreter is the one used by this follow-on operation.
    installed_python = programme.get("originalPython", {})
    if not installed_python.get("id"):
        raise ValueError("Retain the original installed workbooks Python receipt.")
    python = runtime_path(installed_python["python"])
    browser = runtime_path(original_input["browserExecutable"])
    playwright = runtime_path(original_input["playwrightModule"])
    resolver = (
        "const {createRequire}=require('node:module');"
        "const path=require('node:path');"
        "const resolved=createRequire(process.argv[1]).resolve('playwright/package.json');"
        "process.stdout.write(path.dirname(path.dirname(resolved)));"
    )
    node_modules = canonical_path(checked_command(
        [str(node), "-e", resolver, str(playwright)], cwd=root))
    if not (node_modules / "playwright" / "package.json").is_file():
        raise ValueError("Use the original installed Playwright dependency closure.")

    output = Path(output_directory) if output_directory else root / "conapi-workbook-native"
    if (not output.is_absolute() or Path(os.path.normpath(output)) != output
            or output.resolve() != output or root not in output.parents):
        raise ValueError("Keep the exact original workbook output beneath this owned programme root.")
    selection = {
        "schema": "commons.conapi-workbook-following.v1",
        "operation": OPERATION,
        "parent": {
            "originalOperation": ORIGINAL_OPERATION,
            "applicationOperation": APPLICATION_OPERATION,
            "programmeId": programme["id"],
            "applicationSourceRef": programme["input"]["sourceRef"],
            "applicationInput": programme["input"],
        },
        "sourceRoot": str(source_root), "sourceRef": source_ref,
        "driver": driver, "core": core, "original": original,
        "outputDirectory": str(output),
        "runtime": {"node": str(node), "python": str(python),
                    "installationId": installed_python["id"],
                    "browserExecutable": str(browser), "playwrightModule": str(playwright),
                    "nodeModules": str(node_modules)},
    }
    selected_path = root / "conapi-workbook-selected-input.json"
    original_selection = read(selected_path) if selected_path.exists() else selection
    if not selected_path.exists():
        # The surrounding original flock serializes this immutable selection.
        atomic_json(selected_path, selection)
    execution_binding = retain_execution_binding(root, original_selection, selection)
    if not (root / "conapi-workbook-parent-programme.json").exists():
        atomic_json(root / "conapi-workbook-parent-programme.json", programme)
    emit({"stage": "conapi_workbook_original_joined", "operation": OPERATION,
          "source_ref": source_ref, "original_programme": programme["id"],
          "output": str(output), "execution_binding": execution_binding})
    implementation = prepare_receiving_implementation(root, driver, source_ref)
    emit({"stage": "conapi_workbook_execution_source", "operation": OPERATION,
          "original_source_ref": source_ref, "implementation": implementation})
    command = [str(node), implementation["implementation"]["path"],
               "--out", str(output), "--source-commit", source_ref,
               "--input", original["path"], "--core-sha256", CORE_SHA256,
               "--python", str(python), "--browser", str(browser),
               "--node-modules", str(node_modules), "--operation-id", OPERATION]
    environment_key = "CONAPI_WORKBOOK_ORIGINAL_SOURCE_DIRECTORY"
    previous_environment = os.environ.get(environment_key)
    os.environ[environment_key] = str(source_root / PRODUCT)
    try:
        returned = run_native(command)
    finally:
        if previous_environment is None:
            os.environ.pop(environment_key, None)
        else:
            os.environ[environment_key] = previous_environment
    if returned["returncode"] != 0:
        raise RuntimeError("The retained workbook continuation requires its original resume; see " +
                           returned["stderr"])
    # The maintained driver reopens completed state, checks every retained
    # member and returns the same complete package on an ordinary retry.
    result = read(output / "DELIVERY_COMPLETE.json")
    expected_source = {
        "operationId": OPERATION,
        "input": {"bytes": INPUT_BYTES, "sha256": INPUT_SHA256,
                  "blob": "6f4ae11b0d7ffabcc05143b48a6c60159c229c9e"},
        "core": {"sha256": CORE_SHA256, "bytes": core["bytes"]},
        "sourceCommit": source_ref,
    }
    if (result.get("schema") != "conapi.supplier-workbook-receiving.v1"
            or result.get("operationId") != OPERATION or result.get("status") != "COMPLETE"
            or result.get("source") != expected_source):
        raise ValueError("The completed workbook receipt belongs to another selection.")
    package = identity(output / "Supplier_Workbook_Delivery.zip")
    recorded = result.get("package", {})
    if any(recorded.get(key) != package[key] for key in ("path", "bytes", "sha256")):
        raise ValueError("The complete workbook package differs from its original native receipt.")
    completed = {"state": "COMPLETE", "operation": OPERATION,
                 "selection": original_selection, "executionBinding": execution_binding,
                 "native": returned, "result": result, "implementation": implementation,
                 "report": identity(output / "DELIVERY_COMPLETE.json"), "package": package}
    atomic_json(root / "Conapi_Workbook_Following_Result.json", completed)
    emit({"stage": "conapi_workbook_complete", "operation": OPERATION,
          "source_ref": source_ref, "package": package})
    return completed
