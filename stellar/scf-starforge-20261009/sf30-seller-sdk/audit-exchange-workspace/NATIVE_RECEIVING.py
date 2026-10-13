#!/usr/bin/env python3
"""Commission the complete original native analysis with real retained inputs."""
from __future__ import annotations
import argparse
import contextlib
import csv
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time

COMMIT = "343146d7a1e20d027e6ca48bd7ca2b38c646592a"
FIXTURE_SHA = "9862c46fce26d90f019dab4ec9c2ccd79f4602cd48e117fb39d7e2103975c7b5"


def sha(body):
    return hashlib.sha256(body).hexdigest()


def retain(path, body):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != body:
            raise ValueError("Original receiving input differs: " + str(path))
        return
    candidate = path.with_name(path.name + ".pending")
    with candidate.open("wb") as out:
        out.write(body)
        out.flush()
        os.fsync(out.fileno())
    candidate.chmod(0o600)
    os.replace(candidate, path)


def put_json(path, body):
    retain(path, json.dumps(body, sort_keys=True, indent=2, ensure_ascii=False,
                           allow_nan=False).encode() + b"\n")


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


DATA_RECEIVER_R = r'''
args <- commandArgs(trailingOnly=TRUE)
dir.create(args[[1]], recursive=TRUE, showWarnings=FALSE, mode="0700")
setwd(args[[1]])
library(nmecr)
library(jsonlite)
data(eload, package="nmecr")
data(temp, package="nmecr")
saveRDS(eload, "original-eload.rds")
saveRDS(temp, "original-temp.rds")
write.csv(eload, "original-eload.csv", row.names=FALSE)
write.csv(temp, "original-temp.csv", row.names=FALSE)
capture.output(str(eload), str(temp), sessionInfo(), file="original-data-description.txt")
tz <- attr(eload$time,"tzone")
if(is.null(tz) || !length(tz) || !nzchar(tz[[1]])) tz <- "UTC" else tz <- tz[[1]]
attr(eload$time,"tzone") <- tz
if(!identical(attr(temp$time,"tzone"), attr(eload$time,"tzone"))) {
  # Numeric instants are preserved; this explicitly chooses one display/model zone.
  temp$time <- as.POSIXct(as.numeric(temp$time),origin="1970-01-01",tz=tz)
}
nterval <- median(diff(as.numeric(eload$time)))
if(!is.finite(nterval) || nterval>86400) stop("The original package example is not subdaily/daily energy.")
start <- min(eload$time)
end <- as.POSIXct(max(as.numeric(eload$time))+nterval,origin="1970-01-01",tz=tz)
frame <- nmecr::create_dataframe(eload_data=eload,temp_data=temp,
  start_date=format(start,"%m/%d/%Y %H:%M:%S",tz=tz),
  end_date=format(end-1,"%m/%d/%Y %H:%M:%S",tz=tz),
  convert_to_data_interval="Daily",temp_balancepoint=65,shift_normal_weather=FALSE)
if(any(!complete.cases(frame)) || nrow(frame)<60) stop("Original native daily example is incomplete.")
saveRDS(frame,"original-native-daily-frame.rds")
write.csv(frame,"original-native-daily-frame.csv",row.names=FALSE)
ends <- frame$time + lubridate::days(1)
meter <- data.frame(time=as.numeric(frame$time),end=as.numeric(ends),eload=frame$eload)
weather <- data.frame(time=as.numeric(frame$time),end=as.numeric(ends),temp=frame$temp)
write.csv(meter,"meter-native.csv",row.names=FALSE)
write.csv(weather,"weather-native.csv",row.names=FALSE)
write_json(list(schema="commons.original-nmecr-dataset.v1",package="nmecr",
  version=as.character(packageVersion("nmecr")),commit="343146d7a1e20d027e6ca48bd7ca2b38c646592a",
  datasets=c("eload","temp"),rows=nrow(frame),originalEnergyRows=nrow(eload),
  originalWeatherRows=nrow(temp),originalMeterIntervalSeconds=nterval,timezone=tz,
  start=as.numeric(frame$time[[1]]),end=as.numeric(tail(ends,1)),
  units="kWh",weatherUnits="F",
  dailyFrameMethod="nmecr::create_dataframe on original package datasets",
  comparisonPurpose="Held-out native prediction and uncertainty exercise; original data and calendar remain unchanged"),
  "dataset-source.json",auto_unbox=TRUE,pretty=TRUE)
'''


def receiving(application, directory, weather, weather_metadata, model_options, *, rscript=None):
    application, root = Path(application).absolute(), Path(directory).absolute()
    if root.resolve() != root or application.resolve() != application:
        raise ValueError("Keep original receiving in ordinary directories")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (root / "receiving.lock").open("a+b") as global_lock:
        try:
            fcntl.flock(global_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "running", "directory": str(root)}
        sys.path.insert(0, str(application))
        model = load_module("model", application / "model.py")
        engine = load_module("audit_native_engine", Path(__file__).with_name("analysis.py"))
        original = model.asset_bytes("fixture-l100-bsyncr-2.7.0.xml")
        if sha(original) != FIXTURE_SHA:
            raise ValueError("Use the untouched original combined L100 + BSyncr fixture")
        retain(root / "original-fixture.xml", original)
        source_id, revision_id = "native-l100-bsyncr-original", "sha256:" + FIXTURE_SHA
        if (root / "original-model.json").exists() and (root / "original-validation.json").exists():
            native = json.loads((root / "original-model.json").read_bytes())
            report = json.loads((root / "original-validation.json").read_bytes())
        else:
            native, report = model.validate_document(original, source_id, profile_ids=["ashrae-l100", "bsyncr-input"])
            if not (root / "original-validation.json").exists():
                put_json(root / "original-validation.json", report)
            put_json(root / "original-model.json", native)
        detail = {"source": {"id": source_id}, "revision": {"id": revision_id, "sha256": FIXTURE_SHA},
                  "model": native}
        buildings = [item for item in native["entities"]
                     if item.get("semanticKind") == "building" and item.get("xmlId") == "Building-A"]
        if len(buildings) != 1:
            raise ValueError("The original selected Building-A is ambiguous")
        groups = {}
        for row in native["timeSeries"]:
            groups.setdefault(row["streamKey"], []).append(row)
        if len(groups) != 7 or sorted(map(len, groups.values())) != [12] * 7:
            raise ValueError("The untouched original must preserve all seven 12-reading streams")
        weather_bytes = Path(weather).read_bytes()
        weather_metadata = json.loads(Path(weather_metadata).read_bytes())
        options = json.loads(Path(model_options).read_bytes())
        if weather_metadata["sha256"] != sha(weather_bytes):
            raise ValueError("Use the complete retained original observed weather")
        retain(root / "original-observed-weather.csv", weather_bytes)
        put_json(root / "original-weather-metadata.json", weather_metadata)
        put_json(root / "original-model-options.json", options)
        if rscript:
            os.environ["AUDIT_RSCRIPT"] = str(rscript)
        outcomes = []
        for index, (stream, rows) in enumerate(sorted(groups.items())):
            first = rows[0]
            request = {"buildingKey": buildings[0]["key"], "scenarioKey": first["scenarioKey"],
                       "resourceKey": first["resourceKey"], "readingType": first["readingType"],
                       "units": first["units"], "streamKey": stream}
            selected = model.analysis_selection(detail, request)
            put_json(root / ("selection-%02d.json" % index), selected)
            selection = selected["selection"]
            selection["sourceXmlPath"] = str(root / "original-fixture.xml")
            case = root / ("stream-%02d" % index)
            result = engine.run_analysis(selection, weather_bytes, weather_metadata, options, case)
            item = {"streamKey": stream, "resource": first["resourceKey"],
                    "readingType": first["readingType"], "units": first["units"],
                    "status": result["status"], "outputs": len(result["outputs"]),
                    "diagnostics": result["diagnostics"], "directory": str(case),
                    "inputSha256": result["metadata"].get("inputSha256"),
                    "models": result["metadata"].get("models", [])}
            outcomes.append(item)
            print(json.dumps({"stage": "original-building-stream", **item}), flush=True)
            if first["readingType"] == "Total":
                if result["status"] not in ("complete", "partial"):
                    raise RuntimeError("Original energy run needs continuation: " + result["status"])
            elif not any(item.get("code") == "non_energy_selection" for item in result["diagnostics"]):
                raise ValueError("The original non-energy quantity needs its explicit outcome")
            # An actual same-input re-entry must reuse complete retained outputs.
            replay = engine.run_analysis(selection, weather_bytes, weather_metadata, options, case)
            if replay != result:
                raise ValueError("The native same-input complete outcome changed on re-entry")
        put_json(root / "original-seven-stream-results.json", outcomes)
        data_dir = root / "original-package-data"
        data_dir.mkdir(mode=0o700, exist_ok=True)
        data_programme = root / "receive_original_datasets.R"
        retain(data_programme, DATA_RECEIVER_R.encode())
        executable = rscript or os.environ.get("AUDIT_RSCRIPT", "Rscript")
        if not (data_dir / "dataset-source.json").exists():
            with (root / "native-data-receiving.log").open("ab", buffering=0) as log:
                process = subprocess.run([str(executable), "--vanilla", str(data_programme), str(data_dir)],
                    stdout=log, stderr=subprocess.STDOUT, pass_fds=(global_lock.fileno(),))
            if process.returncode:
                raise RuntimeError("Original package dataset receiving returned " + str(process.returncode))
        data_source = json.loads((data_dir / "dataset-source.json").read_bytes())
        meter = list(csv.DictReader((data_dir / "meter-native.csv").open()))
        count = len(meter)
        cut = count // 2
        if cut < 30 or count - cut < 30:
            raise ValueError("The original daily example needs complete baseline/reporting periods")
        case = root / "native-eleven-models"
        case.mkdir(mode=0o700, exist_ok=True)
        for name in ("meter-native.csv", "weather-native.csv"):
            retain(case / name, (data_dir / name).read_bytes())
        retain(case / "native_analysis.R", Path(__file__).with_name("native_analysis.R").read_bytes())
        identity = {"datasetSource": data_source,
                    "originalEnergySha256": sha((data_dir / "original-eload.rds").read_bytes()),
                    "originalWeatherSha256": sha((data_dir / "original-temp.rds").read_bytes()),
                    "nativeScriptSha256": sha((case / "native_analysis.R").read_bytes()),
                    "baselineIndices": list(range(1, cut + 1)),
                    "reportingIndices": list(range(cut + 1, count + 1))}
        input_sha = sha(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode())
        put_json(case / "input.json", identity)
        request = {"schema": engine.SCHEMA, "inputSha256": input_sha, "directory": str(case),
            "timezone": data_source["timezone"], "interval": "Daily", "models": list(engine.MODELS),
            "arguments": {}, "balancePoint": 65, "confidenceLevel": 90,
            "allowNegativePredictions": False, "seed": 20261012, "units": data_source["units"],
            "expectedRows": count, "baseline": {"indices": list(range(1, cut + 1))},
            "reporting": {"indices": list(range(cut + 1, count + 1))},
            "normalization": {"start": float(meter[0]["time"]), "end": float(meter[-1]["end"])},
            "weather": data_source,
            "source": {"id": "nmecr:eload+temp", "revisionId": COMMIT, "readingType": "Total",
                       "purpose": data_source["comparisonPurpose"]}}
        put_json(case / "native-request.json", request)
        native_result = case / "native-result.json"
        with (case / "operation.lock").open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if not native_result.exists() or not json.loads(native_result.read_bytes()).get("terminal"):
                attempts = case / "native-attempts"
                attempts.mkdir(mode=0o700, exist_ok=True)
                index = 1
                while (attempts / ("%04d" % index)).exists():
                    index += 1
                attempt = attempts / ("%04d" % index)
                attempt.mkdir(mode=0o700)
                command = [str(executable), "--vanilla", str(case / "native_analysis.R"),
                           str(case / "native-request.json")]
                put_json(attempt / "invocation.json", {"argv": command, "inputSha256": input_sha,
                         "startedAt": time.time(), "leaseInherited": True})
                with (attempt / "stdout.log").open("ab", buffering=0) as stdout, \
                     (attempt / "stderr.log").open("ab", buffering=0) as stderr:
                    process = subprocess.run(command, stdout=stdout, stderr=stderr,
                        pass_fds=(lock.fileno(), global_lock.fileno()))
                put_json(attempt / "exit.json", {"code": process.returncode, "finishedAt": time.time()})
                if native_result.exists():
                    retain(attempt / "native-result.json", native_result.read_bytes())
                if process.returncode:
                    raise RuntimeError("Original eleven-model native run needs its retained continuation: " + str(attempt))
            result = json.loads(native_result.read_bytes())
            if result["inputSha256"] != input_sha or len(result.get("models", [])) != 11:
                raise ValueError("The complete original eleven-model catalogue is missing")
            if result["status"] not in ("complete", "partial"):
                raise RuntimeError("The original native catalogue did not fit any model")
        models = [{"model": item["model"], "status": item["status"],
                   "summary": item.get("summary"), "savingsSummary": item.get("savingsSummary"),
                   "normalizedSavingsSummary": item.get("normalizedSavingsSummary")}
                  for item in result["models"]]
        print(json.dumps({"stage": "original-eleven-models", "status": result["status"], "models": models}), flush=True)
        final = {"schema": "commons.audit.native-receiving.v1", "status": "complete",
                 "fixtureSha256": FIXTURE_SHA, "sourceCommit": COMMIT,
                 "weatherSha256": sha(weather_bytes), "sevenStreams": outcomes,
                 "nativeCatalogue": models, "originalDataset": data_source,
                 "scope": "Published original data and explicit held-out analytical periods"}
        put_json(root / "receiving-result.json", final)
        archive = root.with_name(root.name + "-complete.tar.gz")
        if not archive.exists():
            pending = archive.with_name(archive.name + ".pending")
            with tarfile.open(pending, "w:gz", compresslevel=6) as bundle:
                for path in sorted(root.rglob("*")):
                    if path.is_file() and not path.is_symlink() and not path.name.endswith(".lock"):
                        bundle.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
        candidate = archive if archive.exists() else pending
        expected_names = {path.relative_to(root).as_posix() for path in root.rglob("*")
                          if path.is_file() and not path.is_symlink() and not path.name.endswith(".lock")}
        seen = set()
        with tarfile.open(candidate, "r:gz") as bundle:
            for member in bundle:
                if not member.isfile() or member.name not in expected_names or member.name in seen:
                    raise ValueError("The complete native archive has an unexpected or duplicate member")
                seen.add(member.name)
                expected = (root / member.name).read_bytes()
                if bundle.extractfile(member).read() != expected:
                    raise ValueError("The complete native archive differs from its source")
        if seen != expected_names:
            raise ValueError("The complete native archive omits original case files")
        if candidate != archive:
            os.replace(candidate, archive)
        body = archive.read_bytes()
        print(json.dumps({"stage": "complete-original-native-case", "archive": str(archive),
                          "bytes": len(body), "sha256": sha(body)}), flush=True)
        return final


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--application", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--weather", required=True)
    parser.add_argument("--weather-metadata", required=True)
    parser.add_argument("--model-options", required=True)
    parser.add_argument("--rscript")
    args = parser.parse_args()
    receiving(args.application, args.directory, args.weather, args.weather_metadata,
              args.model_options, rscript=args.rscript)


if __name__ == "__main__":
    main()
