#!/usr/bin/env bash
set -euo pipefail
# Sequence the maintained engine through the selected host's original admission.
# Usage: bash run-public-cohort.sh PRIVATE_ROOT ENGINE.py E287_PYTHON_PROJECT PYTHON
if [ "$#" -ne 4 ]; then
  printf '%s\n' 'Usage: bash run-public-cohort.sh PRIVATE_ROOT ENGINE.py E287_PYTHON_PROJECT PYTHON' >&2
  exit 2
fi
COHORT_ROOT=$1
COHORT_ENGINE=$2
COHORT_SOURCE=$3
COHORT_PYTHON=$4
COHORT_OPERATION=scf-public-python-e287-workbooks-agents-a66c-20261012
COHORT_CANDIDATE=ecd877ea50015f8ff76b8c3b07156250e62b425574e0392052106295f5494e8c
export PYTHONDONTWRITEBYTECODE=1
umask 077
"$COHORT_PYTHON" -B - "$COHORT_ROOT" "$COHORT_ENGINE" "$COHORT_SOURCE" <<'PY'
import hashlib, os, pathlib, platform, stat, sys, sysconfig
root, engine, source = map(pathlib.Path, sys.argv[1:])
if not all(p.is_absolute() for p in (root, engine, source)):
    raise SystemExit("Select absolute receiving paths")
root.mkdir(parents=True, exist_ok=True, mode=0o700)
info = root.stat()
if root.is_symlink() or root.resolve() != root or not root.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o077:
    raise SystemExit("Select an owned private receiving directory")
if not engine.is_file() or hashlib.sha256(engine.read_bytes()).hexdigest() != "52c2b42c1b222174679d07da89893ae268fbfe04f785f9dfdcda617ec727fb41":
    raise SystemExit("Use the exact published engine.py for this producer")
if not (source / "pyproject.toml").is_file():
    raise SystemExit("Select the original e287 Python project directory")
observed = (sys.implementation.name, sys.version_info.major, sys.version_info.minor, sysconfig.get_platform(), platform.machine(), sys.implementation.cache_tag)
if observed != ("cpython", 3, 12, "linux-x86_64", "x86_64", "cpython-312"):
    raise SystemExit("This receiving operation selects CPython 3.12 on Linux x86_64")
PY
exec 9>"$COHORT_ROOT/public-cohort.lock"
flock -n 9
COHORT_ATTEMPT=$(mktemp -d "$COHORT_ROOT/attempt-XXXXXXXX")
cohort_phase() {
  COHORT_PHASE=$1
  shift
  if "$COHORT_PYTHON" -B "$COHORT_ENGINE" --root "$COHORT_ROOT/runtime" --lease-fd 9 --progress-file "$COHORT_ATTEMPT/$COHORT_PHASE-progress.json" "$@" >"$COHORT_ATTEMPT/$COHORT_PHASE.json" 2>"$COHORT_ATTEMPT/$COHORT_PHASE.stderr"; then
    return 0
  else
    COHORT_EXIT=$?
    "$COHORT_PYTHON" -B - "$COHORT_OPERATION" "$COHORT_ATTEMPT" "$COHORT_ROOT/runtime/logs" "$COHORT_PHASE" "$COHORT_EXIT" <<'PY'
import json, os, pathlib, sys
operation, attempt, logs, phase, code = sys.argv[1:]
value = {"schema":"stellar-forge.public-python-producer.v1","operation_id":operation,"state":"FAILED","phase":phase,"exit_code":int(code),"attempt":attempt,"engine_logs":logs,"stdout":str(pathlib.Path(attempt)/(phase+".json")),"stderr":str(pathlib.Path(attempt)/(phase+".stderr"))}
target = pathlib.Path(attempt)/"result.json"
with target.open("x") as output:
    json.dump(value, output, sort_keys=True, indent=2); output.write("\n"); output.flush(); os.fsync(output.fileno())
print(json.dumps(value, sort_keys=True))
PY
    exit "$COHORT_EXIT"
  fi
}
cohort_phase resolve resolve --python "$COHORT_PYTHON" --source "$COHORT_SOURCE" --extras workbooks,agents --release-id e28755f20dd4f9cb932d82fb59feb48424e327e7 --release-digest 267cd1292c8e542e8a70134c814bba7d624d2b375191a8892fb269f226bf4ff7
"$COHORT_PYTHON" -B - "$COHORT_ATTEMPT/resolve.json" "$COHORT_CANDIDATE" <<'PY'
import json, pathlib, sys
value = json.loads(pathlib.Path(sys.argv[1]).read_text())
if value.get("candidate", value.get("id")) != sys.argv[2] or value["source"]["id"] != "63faa446741cc98429d80516b34ee993ffe060e1b2739223bc84f18c8e4a88d5" or value["extras"] != ["agents","workbooks"]:
    raise SystemExit("The original source/interpreter/extras identity differs from the selected cohort")
PY
cohort_phase inspect inspect --candidate "$COHORT_CANDIDATE"
if [ -n "${COHORT_DISK_LIMIT_BYTES:-}" ] || [ -n "${COHORT_DISK_RESERVE_BYTES:-}" ]; then
  "$COHORT_PYTHON" -B - "$COHORT_ATTEMPT/inspect.json" "$COHORT_ROOT" "${COHORT_DISK_LIMIT_BYTES:-}" "${COHORT_DISK_RESERVE_BYTES:-}" "$COHORT_ATTEMPT/capacity.json" <<'PY'
import json, os, pathlib, sys
inspection, root_name, limit_text, reserve_text, report_name = sys.argv[1:]
if not limit_text.isdecimal() or not reserve_text.isdecimal():
    raise SystemExit("Declare both original disk limit and reserve in bytes")
root = pathlib.Path(root_name)
limit, reserve = int(limit_text), int(reserve_text)
if limit <= 0:
    raise SystemExit("The original disk limit must be positive")
selected = json.loads(pathlib.Path(inspection).read_text())
seen, allocated = set(), 0
for path in (root, *root.rglob("*")):
    info = path.lstat()
    identity = (info.st_dev, info.st_ino)
    if path.is_symlink() or identity in seen:
        continue
    seen.add(identity)
    allocated += info.st_blocks * 512
additional = selected["wheelBytes"] + 16 * 1024 * 1024
fs = os.statvfs(root)
available = fs.f_bavail * fs.f_frsize
report = {"schema":"stellar-forge.public-cohort-capacity.v1",
          "allocatedBytes":allocated,"wheelBytes":selected["wheelBytes"],
          "bundleAndDiagnosticsAdditionalBytes":additional,
          "projectedBytes":allocated+additional,"declaredBytes":limit,
          "availableBytes":available,"reserveBytes":reserve,
          "fits":allocated+additional <= limit and available >= additional+reserve}
with pathlib.Path(report_name).open("x") as output:
    json.dump(report, output, sort_keys=True, indent=2); output.write("\n")
    output.flush(); os.fsync(output.fileno())
if not report["fits"]:
    print(json.dumps(report, sort_keys=True), file=sys.stderr)
    raise SystemExit(75)
PY
fi
cohort_phase bundle bundle --candidate "$COHORT_CANDIDATE" --output "$COHORT_ROOT/scf-public-python-e287-workbooks-agents.bundle.zip"
"$COHORT_PYTHON" -B - "$COHORT_OPERATION" "$COHORT_ATTEMPT" "$COHORT_ROOT" "$COHORT_CANDIDATE" <<'PY'
import hashlib, json, os, pathlib, sys
operation, attempt_name, root_name, candidate = sys.argv[1:]
attempt, root = pathlib.Path(attempt_name), pathlib.Path(root_name)
resolved = json.loads((attempt/"resolve.json").read_text())
checked = json.loads((attempt/"inspect.json").read_text())
bundle = json.loads((attempt/"bundle.json").read_text())
lock = json.loads((pathlib.Path(checked["directory"])/"lock.json").read_text())
if checked["source"] != resolved["source"] or checked["candidate"] != candidate or bundle["candidate"] != candidate or bundle["sourceId"] != resolved["source"]["id"] or bundle["lockSha256"] != checked["lockSha256"]:
    raise SystemExit("The retained cohort changed during inspection or publication")
archive = pathlib.Path(bundle["path"])
checksum = hashlib.sha256()
with archive.open("rb") as body:
    for chunk in iter(lambda: body.read(1024*1024), b""):
        checksum.update(chunk)
if checksum.hexdigest() != bundle["sha256"] or archive.stat().st_size != bundle["bytes"]:
    raise SystemExit("The produced bundle differs from its original publication receipt")
files = [p for p in root.rglob("*") if p.is_file() and not p.is_symlink()]
value = {"schema":"stellar-forge.public-python-producer.v1","operation_id":operation,"state":"COMPLETED","attempt":str(attempt),"candidate":candidate,"source":checked["source"],"extras":checked["extras"],"interpreter":checked["interpreter"],"resolutionPython":lock["resolutionPython"],"wheelBytes":checked["wheelBytes"],"unpackedBytes":checked["unpackedBytes"],"packageCount":len(checked["packages"]),"packages":checked["packages"],"runtimeFileBytes":sum(p.stat().st_size for p in files),"runtimeAllocatedBytes":sum(p.stat().st_blocks*512 for p in files),"bundle":bundle,"engine_logs":str(root/"runtime/logs")}
target = attempt/"result.json"
with target.open("x") as output:
    json.dump(value, output, sort_keys=True, indent=2); output.write("\n"); output.flush(); os.fsync(output.fileno())
directory = os.open(attempt, os.O_RDONLY|os.O_DIRECTORY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
print(json.dumps(value, sort_keys=True))
PY
