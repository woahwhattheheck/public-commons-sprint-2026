"""Calculate retained original XLSX editions through installed LibreOffice UNO.

Uses the official Java client and an owned, isolated, loopback-only office
instance. Workbook macros and external-link updates are disabled. Immutable
original inputs and complete native calculation exports are retained separately.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from workbooks import read_xlsx

SOURCE = Path(__file__).resolve().parent

def sha(data):
    return hashlib.sha256(data).hexdigest()

def executable(command=None):
    result = command or os.environ.get("ATSSC_SOFFICE") or shutil.which("soffice") or shutil.which("libreoffice")
    if not result:
        raise RuntimeError("Select the installed LibreOffice executable with ATSSC_SOFFICE.")
    return result

def _runtime(jar=None):
    jar = Path(jar or os.environ.get("ATSSC_UNO_JAR") or SOURCE/"calculation-runtime/libreoffice-26.2.2.jar").resolve()
    if not jar.is_file():
        raise RuntimeError("Select the supplied official UNO client JAR with ATSSC_UNO_JAR.")
    java = os.environ.get("ATSSC_JAVA") or shutil.which("java")
    if not java:
        raise RuntimeError("Select the installed Java 17+ executable with ATSSC_JAVA.")
    manifest_path = jar.parent/"manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        expected = next((a["sha256"] for a in manifest.get("artifacts",manifest.get("files",[])) if a["path"] == jar.name), None)
        if not expected or sha(jar.read_bytes()) != expected:
            raise ValueError("Official UNO client bytes differ from the pinned runtime manifest.")
    return java, jar

def _execute(jobs, output, command, java, jar, timeout, inspect=False):
    with tempfile.TemporaryDirectory(prefix="atssc-native-uno-") as temporary:
        root = Path(temporary)
        job_file = root/"jobs.tsv"
        job_file.write_text("".join(a.as_uri()+"\t"+b.as_uri()+"\n" for a,b in jobs),encoding="utf-8")
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1",0))
            port = reservation.getsockname()[1]
        address = f"socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
        start = time.monotonic()
        with (output/"office.stdout").open("w") as office_out, (output/"office.stderr").open("w") as office_err, \
             (output/"driver.stdout").open("w") as driver_out, (output/"driver.stderr").open("w") as driver_err:
            office = subprocess.Popen([command,"--headless","--nologo","--nodefault","--norestore",
                "-env:UserInstallation="+(root/"profile").as_uri(),"--accept="+address],
                stdout=office_out,stderr=office_err,start_new_session=True)
            try:
                args = [java,"--class-path",str(jar),str(SOURCE/"NativeWorkbookCalculation.java"),"uno:"+address,str(job_file)]
                if inspect: args.append("inspect")
                run = subprocess.run(args,stdout=driver_out,stderr=driver_err,timeout=timeout)
                driver_out.flush();driver_err.flush()
                progress = (output/"driver.stdout").read_text()
                if run.returncode or progress.count("COMPLETE ") != len(jobs):
                    raise RuntimeError("Native operation did not complete: "+progress+" "+(output/"driver.stderr").read_text())
            finally:
                try:
                    office.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(office.pid,signal.SIGTERM)
                    try:office.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(office.pid,signal.SIGKILL)
                        office.wait(timeout=5)
        return progress,time.monotonic()-start

def inspect_calculated_workbooks(calculation_manifest, output_directory, soffice_command=None, timeout=180, uno_jar=None):
    """Recover exact native direct precedent ranges without replacing exports."""
    output = Path(output_directory).resolve();output.mkdir(parents=True,exist_ok=True)
    command = executable(soffice_command);java,jar = _runtime(uno_jar)
    jobs,selected = [],[]
    for item in calculation_manifest["workbooks"]:
        source = Path(item["native_path"]).resolve()
        if sha(source.read_bytes()) != item["native_sha256"]:raise ValueError("The selected native calculation export differs.")
        destination = output/source.name
        if Path(str(destination)+".precedents.json").exists():raise FileExistsError("Retain the existing native precedent edition.")
        jobs.append((source,destination));selected.append(item)
    progress,elapsed = _execute(jobs,output,command,java,jar,timeout,inspect=True)
    result = {"schema":"atssc.native-precedent-edition.v1","elapsed_seconds":elapsed,"workbooks":[],"progress":progress.splitlines()}
    for item,(source,destination) in zip(selected,jobs):
        if sha(source.read_bytes()) != item["native_sha256"]:raise RuntimeError("The selected calculation export changed.")
        path = Path(str(destination)+".precedents.json");body=path.read_bytes();graph=json.loads(body)
        result["workbooks"].append({**item,"precedents_path":str(path),"precedents_sha256":sha(body),"precedents_bytes":len(body),"precedent_formula_count":len(graph["formulas"])})
    (output/"native-precedents.json").write_text(json.dumps(result,indent=2)+"\n")
    return result

def calculate_original_workbooks(requests, output_directory, soffice_command=None, timeout=180, uno_jar=None):
    """Return complete native exports for exact named original XLSX byte inputs.

    Each request has name, workbook_bytes and optional workbook_sha256. Existing
    exports are never overwritten. One fresh profile and native process handles
    the whole requested collection, including every hidden sheet and formula.
    """
    if not requests:
        raise ValueError("Select at least one original workbook.")
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    command = executable(soffice_command)
    java, jar = _runtime(uno_jar)
    engine = subprocess.run([command, "--version"], check=True, capture_output=True, text=True, timeout=15).stdout.strip()
    retained, names = [], set()
    for request in requests:
        body = request["workbook_bytes"]
        source_sha = sha(body)
        if request.get("workbook_sha256") and source_sha != request["workbook_sha256"]:
            raise ValueError("The original workbook source hash differs.")
        name = Path(request["name"]).name
        if name != request["name"] or name in names or not name.lower().endswith(".xlsx") or any(c in name for c in "\t\n\r"):
            raise ValueError("Use distinct original XLSX filenames.")
        names.add(name)
        read_xlsx(body)
        destination = output/(source_sha[:12]+"-"+name)
        if destination.exists():
            raise FileExistsError("Retain the existing calculation edition; select a new output directory.")
        retained.append((name, source_sha, body, destination))
    with tempfile.TemporaryDirectory(prefix="atssc-native-calculate-") as temporary:
        root = Path(temporary)
        profile = root/"profile"
        original = root/"originals"
        original.mkdir()
        jobs = []
        for name, source_sha, body, destination in retained:
            source = original/name
            source.write_bytes(body)
            jobs.append((source, destination))
        progress, elapsed = _execute(jobs, output, command, java, jar, timeout)
        results = []
        for (name, source_sha, body, destination), (source, _) in zip(retained, jobs):
            if sha(source.read_bytes()) != source_sha:
                raise RuntimeError("The original source changed during native calculation.")
            native = destination.read_bytes()
            book = read_xlsx(native)
            graph_path=Path(str(destination)+".precedents.json")
            graph_body=graph_path.read_bytes();graph=json.loads(graph_body)
            results.append({"name":name, "source_sha256":source_sha, "source_bytes":len(body),
                "native_path":str(destination), "native_sha256":sha(native), "native_bytes":len(native),
                "sheet_count":book["sheetCount"], "formula_count":book["formulaCount"],
                "precedents_path":str(graph_path),"precedents_sha256":sha(graph_body),"precedents_bytes":len(graph_body),
                "precedent_formula_count":len(graph["formulas"])})
        result = {"schema":"atssc.native-workbook-calculation.v1", "engine":engine,
            "operation":"com.sun.star.sheet.XCalculatable.calculateAll", "official_client_sha256":sha(jar.read_bytes()),
            "original_sources_unchanged":True, "original_macros":"NEVER_EXECUTE", "linked_source_updates":"NO_UPDATE",
            "elapsed_seconds":elapsed, "workbooks":results, "progress":progress.splitlines()}
        (output/"native-calculation.json").write_text(json.dumps(result, indent=2)+"\n")
        return result

def main():
    parser = argparse.ArgumentParser(description="Calculate every original workbook through installed LibreOffice")
    parser.add_argument("--input-directory", required=True)
    parser.add_argument("--output-directory", required=True)
    parser.add_argument("--soffice")
    parser.add_argument("--uno-jar")
    args = parser.parse_args()
    inputs = [{"name":f.name, "workbook_bytes":f.read_bytes()} for f in sorted(Path(args.input_directory).glob("*.xlsx"))]
    result = calculate_original_workbooks(inputs, args.output_directory, args.soffice, uno_jar=args.uno_jar)
    print(json.dumps({"engine":result["engine"], "workbooks":len(result["workbooks"]), "elapsed_seconds":result["elapsed_seconds"]}))

if __name__ == "__main__":
    main()
