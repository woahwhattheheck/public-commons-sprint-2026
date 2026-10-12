#!/usr/bin/env python3
"""Install the original locked regex runtime, then become the original native driver."""
from pathlib import Path
import json
import os
import runpy
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
OPERATION = "SCF-NDJSON-FILE-JOBS-3AD791-20261012"
setup = runpy.run_path(str(ROOT / "inbox/prepare-ndjson.py"))
read_regular, publish = setup["read_regular"], setup["publish"]
receipt = json.loads(read_regular(ROOT / "prepared-inputs.json", 1024 * 1024))
project = ROOT / "project"
runtime = receipt["runtime"]

try:
    if receipt["operationId"] != OPERATION:
        raise RuntimeError("original native operation differs")
    source = project / "product"
    profile = project / "publisher/stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving"
    catalog = source / "stellar-forge/payment-auto-catalog"
    lock = json.loads(read_regular(catalog / "package-lock.json", 65536))
    dependency = lock["packages"]["node_modules/re2js"]
    if dependency["version"] != "2.8.6" or dependency["integrity"] != (
            "sha512-xLgQil4kIUCrAzVk9fRSkxkFNwmygLFjVxXrLc65aE1F0+Zsb8rxumFBy4XKyvgMCTL6kilDq3EZ0piE2dP/Dg=="):
        raise RuntimeError("original locked regex runtime differs")
    environment = dict(os.environ)
    environment["PATH"] = str(Path(runtime["node"]).parent) + os.pathsep + environment.get("PATH", "")
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    environment["NPM_CONFIG_USERCONFIG"] = os.devnull
    environment["NPM_CONFIG_CACHE"] = str(project / ".npm-cache")
    with open(project / "runtime-install.stdout.log", "wb") as stdout, open(
            project / "runtime-install.stderr.log", "wb") as stderr:
        completed = subprocess.run(
            [runtime["node"], runtime["npm"], "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
            cwd=catalog, env=environment, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
    if completed.returncode:
        raise RuntimeError("original locked runtime install failed: " + str(completed.returncode))
    installed = json.loads(read_regular(catalog / "node_modules/re2js/package.json", 65536))
    if installed.get("version") != "2.8.6":
        raise RuntimeError("installed regex runtime version differs")
    publish(project / "runtime-receipt.json", (json.dumps({
        "schema": "scf.ndjson-file-jobs-native-runtime.v1", "operationId": OPERATION,
        "runtime": runtime, "package": {"name": "re2js", "version": "2.8.6",
        "integrity": dependency["integrity"]}, "installExitCode": completed.returncode
    }, sort_keys=True, indent=2) + "\n").encode())
    driver = source / "operations/scf-ndjson-file-jobs-native-20261012"
    selection = {
        "schema": "scf.ndjson-file-jobs-native-input.v1", "operationId": OPERATION,
        "sourceRoot": str(source), "sourceCommit": setup["PRODUCT_COMMIT"],
        "publisherProfileRoot": str(profile), "publisherSourceCommit": setup["PUBLISHER_COMMIT"],
        "outputDirectory": str(project / "receiving"),
        "pythonExecutable": runtime["python"],
        "lifecycleCompanion": str(driver / "process-lifecycle.mjs")
    }
    publish(project / "native-input.json", (json.dumps(selection, sort_keys=True, indent=2) + "\n").encode())
    print(json.dumps({"operationId": OPERATION, "phase": "original-native-driver",
                      "productCommit": setup["PRODUCT_COMMIT"], "publisherCommit": setup["PUBLISHER_COMMIT"],
                      "runtime": runtime}), flush=True)
    os.chdir(project)
    os.execve(runtime["node"], [runtime["node"], str(driver / "receive.mjs"),
                               str(project / "native-input.json")], environment)
except Exception as error:
    publish(project / "native-preparation-error.json", (json.dumps({
        "schema": "scf.ndjson-file-jobs-native-preparation-error.v1",
        "operationId": OPERATION, "error": type(error).__name__, "detail": str(error)
    }, sort_keys=True, indent=2) + "\n").encode())
    raise
