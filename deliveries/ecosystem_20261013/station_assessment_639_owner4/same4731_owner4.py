# Same original ECO-GEO-0D0F/4731 source/preparation continuation.
# Owner .4 renewal replaces historical cutoff prose; preserve existing issued processes.
import base64, gzip, hashlib, json, os, pathlib, subprocess, sys, urllib.request
repo = "woahwhattheheck/public-commons-sprint-2026"
blob = "7e4631f8ea2a38b3a4b6c0eed2418892cd647041"
expected_gzip = "fbd1275ebe2014cdee13e24d06bf1ca5209ed8aba6a401460f8ef35f31ed12a1"
expected_json = "09cbc69421f4417116476112c82de313e236e930b99ec7154231ee108bcd7247"
assert os.environ.get("ECO_APP"), "Set ECO_APP to the existing receiving application"
app = pathlib.Path(os.environ["ECO_APP"]).resolve()
root = app.parent / "eco-assessment-family-owner4"
if os.environ.get("ECO_FAMILY_GZIP"):
    packed = pathlib.Path(os.environ["ECO_FAMILY_GZIP"]).read_bytes()
elif os.environ.get("ECO_FAMILY_BASE64"):
    packed = base64.b64decode(pathlib.Path(os.environ["ECO_FAMILY_BASE64"]).read_text(encoding="utf-8"))
else:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/git/blobs/{blob}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "Eco-native-receiving"})
    with urllib.request.urlopen(request, timeout=120) as response:
        original = json.load(response)
    assert original["sha"] == blob and original["encoding"] == "base64"
    packed = base64.b64decode(original["content"])
assert len(packed) == 3219578 and hashlib.sha256(packed).hexdigest() == expected_gzip
raw = gzip.decompress(packed)
assert len(raw) == 22265924 and hashlib.sha256(raw).hexdigest() == expected_json
bank = json.loads(raw)
assert bank["schema"] == "commons.source-map/1" and len(bank["files"]) == 639
pending = {}
for item in bank["files"]:
    name = item["path"]
    member = pathlib.PurePosixPath(name)
    assert name and not member.is_absolute() and ".." not in member.parts and member.as_posix() == name
    assert name not in pending
    data = item["content"].encode("utf-8")
    assert len(data) == item["bytes"] and hashlib.sha256(data).hexdigest() == item["sha256"]
    destination = root.joinpath(*member.parts)
    assert destination.resolve().is_relative_to(root.resolve())
    if destination.exists():
        assert destination.is_file() and destination.read_bytes() == data, f"Different existing source: {name}"
    pending[name] = (destination, data)
for destination, data in pending.values():
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        destination.write_bytes(data)
archive = root / "station-assessment-family.json.gz"
if archive.exists():
    assert archive.read_bytes() == packed
else:
    archive.write_bytes(packed)
installer = root / "operator/install_station_geography.py"
assert bank["files"][next(i for i, item in enumerate(bank["files"]) if item["path"] == "operator/install_station_geography.py")]["git_blob"] == "aca79adb9bc1629d5136c247a47e1cb4510b1da3"
print(f"Verified {len(pending)} source files; running NEW installer {installer}", flush=True)
install_command = [sys.executable, str(installer), "--application", str(app), "--source-root", str(root)]
plan = json.loads(subprocess.check_output([*install_command, "--dry-run"], text=True))
changes = plan["changed"]
# Upgrade the known predecessor directions; preserve any unrecognized newer edition.
known_previous = {
    "AGENTS.md": {"46be323017be913780d0d2850b7658861744508d", "150e2d55f9cce9e7a9458aae895cec54ebb09255"},
    "CURRENT_OWNER_DIRECTION.md": {"8cd1c1f3d371a2fb75471813844e31f489aa8272"},
}
for name, allowed in known_previous.items():
    current = app / name
    if not current.is_file() or current.read_bytes() == pending[name][1]:
        continue
    previous = current.read_bytes()
    identity = hashlib.sha1(b"blob " + str(len(previous)).encode("ascii") + b"\0" + previous).hexdigest()
    if identity not in allowed:
        raise RuntimeError("Preserve the current owner instructions at " + name + "; compose this actual source difference before install: " + identity)
if changes:
    subprocess.run(install_command, check=True)
else:
    print("Physical receiving application already has the complete current family.", flush=True)
print(f"Installed current family; native guide: {app / 'source/observed-report-20261013/PREPARE_ASSESSMENT.md'}", flush=True)

# Continue the same source-only native assessment course.
import json, os, pathlib, subprocess, sys

app = pathlib.Path(os.environ["ECO_APP"]).resolve(strict=True)
intake = pathlib.Path(os.environ["ECO_217_INTAKE"]).resolve(strict=True)
case = pathlib.Path(os.environ.get("ECO_ASSESSMENT_ROOT", str(app.parent / "assessment4731-native"))).resolve()
original = case / "workspace"
receiving = case / "receiving-workspace"
output = case / "preparation-report12"
roots = [app, original, receiving, output]
for index, left in enumerate(roots):
    for right in roots[index + 1:]:
        if left.is_relative_to(right) or right.is_relative_to(left):
            raise ValueError("Keep application, original Workspace, receiving Workspace and output in separate trees.")
manifests = [
    app / "source_data/scdes_savannah705_20261013/sources.json",
    app / "source/water-quality-assessments/20261013/sources.json",
    app / "source_data/wqp_eight_20261013/sources.json",
    app / "source_data/wqp_assessment159_additional_two_20261013/sources.json",
    intake / "sources.json",
]
draft = app / "source_data/wqp_eight_20261013/assessment_listed_causes_2026_draft_original.csv"
prepare = app / "source/observed-report-20261013/prepare_assessment.py"
decoder = intake / "materialize_original_217.py"
encoded = intake / "Original217_Gzip_Base64.txt"
for path in [*manifests, draft, prepare, decoder, encoded, intake / "source-provenance.json"]:
    if not path.is_file():
        raise FileNotFoundError("Materialize the complete retained source before starting: " + str(path))
subprocess.run([sys.executable, str(decoder), "--base64", str(encoded)], check=True)

sys.path.insert(0, str(app))
from model.workspace import Workspace
from model.common import held
case.mkdir(parents=True, exist_ok=True)
with held(case / ".assessment4731-launch.lock", blocking=False):
    workspace = Workspace(original, create=True, title="Upper Savannah original-source assessment study")
    other = Workspace(receiving, create=True, title="Upper Savannah independent assessment receiving")
    identities = {
        "operation": "ECO-GEO-0D0F/4731",
        "application": str(app),
        "workspace": str(workspace.root), "project_id": workspace.project["id"],
        "receiving_workspace": str(other.root), "receiving_project_id": other.project["id"],
        "output": str(output),
    }
    print(json.dumps(identities, sort_keys=True), flush=True)
    argv = [
        sys.executable, str(prepare),
        "--workspace", str(original),
        "--receiving-workspace", str(receiving),
        "--assessment-csv", str(draft),
        "--output", str(output),
    ]
    for manifest in manifests:
        argv += ["--manifest", str(manifest)]
    print(json.dumps({"argv": argv}, sort_keys=True), flush=True)
    child = subprocess.Popen(argv, cwd=str(app))
    print(json.dumps({"preparation_pid": child.pid, "launch_pid": os.getpid()}, sort_keys=True), flush=True)
    code = child.wait()
    print(json.dumps({"returncode": code, "native_cases": str(output / "assessment-preparation.json"),
                      "report_course": str(output / "report-course.json"),
                      "report_receiving": str(output / "report-receiving")}, sort_keys=True), flush=True)
    raise SystemExit(code)
