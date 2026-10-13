#!/usr/bin/env python3
"""Install the pinned regional pipeline into an existing Upper Savannah application."""
from __future__ import annotations
import argparse
import ast
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

BUNDLE_REF = "6ff9dcdf9d3907945d768d17439fb834ba7f4736"
BASE_URL = ("https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/"
            + BUNDLE_REF + "/opportunities/upstate_forever_2026/")
CATALOG = [
  {
    "path": "integration/selected-model-core-overlay.json",
    "bytes": 60940,
    "sha256": "000c49f18ae584cc52cbc3dab4c3040230aba686b1865f850c908313c4254989"
  },
  {
    "path": "integration/apply_selected_model_overlay.py",
    "bytes": 4594,
    "sha256": "b17770c96f34064bb8ee74c0cd49bf7ecf1e51ab47af648c422c338782adf717"
  },
  {
    "path": "source_tools/climate_region.py",
    "bytes": 15397,
    "sha256": "1448ac9ad284d262f0aa6e37d35dbd282c2a90b6c56ad2a1fe69cf69e77d44d2"
  },
  {
    "path": "source_tools/CLIMATE_REGION.md",
    "bytes": 5964,
    "sha256": "c03c8ed9963c299504bf2e78447dda6a65a5b341f5a641925c39faac850d536c"
  },
  {
    "path": "model/regional_job.py",
    "bytes": 22187,
    "sha256": "13a43aa53374bd78063048c93bc5bc703984618dd0ce74128adc96739a3add6f"
  },
  {
    "path": "model/regional_scenarios.py",
    "bytes": 9418,
    "sha256": "7d304bc1b6457496f285a0c2a5d54802f35cd6ff1290d58ade2051428f430b37"
  },
  {
    "path": "model/REGIONAL_JOB.md",
    "bytes": 9172,
    "sha256": "a01e7fe7d73a3a6357e4e05bd021049692122bf1e662347180f7ebc3ed220b93"
  },
  {
    "path": "integration/retained-inputs-overlay.json",
    "bytes": 20719,
    "sha256": "4e34a90cc36efbec117f464336085df805d953ae17654790fa66e738f2952c11"
  },
  {
    "path": "integration/RETAINED_INPUTS.md",
    "bytes": 2499,
    "sha256": "7aab6276ff612ab866b2a98bf0070a354faeceb851e56ae6c48a958d1a4377a7"
  },
  {
    "path": "model/native_equivalence.py",
    "bytes": 11081,
    "sha256": "f9ef5d7f13b9f2102f1749cd4ced78cf80e2476276b0972cffa90a5b42604e04"
  }
]
OVERLAYS = [
  "integration/selected-model-core-overlay.json",
  "integration/retained-inputs-overlay.json"
]


SOURCE_UPDATES = {
  "model/native_equivalence.py": {
    "from_sha256": "f9ef5d7f13b9f2102f1749cd4ced78cf80e2476276b0972cffa90a5b42604e04",
    "bytes": 12835,
    "sha256": "377cfe7fa9e071f19dc180d667efeb5f9aa9f1071807a075273a0d7c2d21e621",
    "replacements": [
      {
        "before": "from .common import (INVEST_SOURCE, INVEST_VERSION, file_digest, finite,\n",
        "after": "from .common import (INVEST_SOURCE, INVEST_VERSION, describe_file, file_digest, finite,\n"
      },
      {
        "before": "    def __init__(self, workspace, target_run_id, *, target_lulc=None):\n",
        "after": "    def __init__(self, workspace, target_run_id, *, target_lulc=None, target_runtime=None):\n"
      },
      {
        "before": "        self.target_run_id = target_run_id\n",
        "after": "        self.target_run_id = target_run_id\n        self.target_runtime = target_runtime\n"
      },
      {
        "before": "    def _same_raster(self, left, right):\n",
        "after": "    def _raster_identity(self, path, item):\n        \"\"\"Account for GDAL masks and PAM metadata outside the main TIFF.\"\"\"\n        companions = []\n        for suffix in (\".aux.xml\", \".msk\", \".ovr\"):\n            candidate = Path(str(path) + suffix)\n            if candidate.is_file():\n                descriptor = describe_file(self.workspace.root, candidate)\n                companions.append((suffix, descriptor[\"bytes\"], descriptor[\"sha256\"]))\n        return item[\"sha256\"], tuple(companions)\n\n    def _same_raster(self, left, right):\n"
      },
      {
        "before": "        if a_item[\"sha256\"] == b_item[\"sha256\"]:\n            return True\n        key = tuple(sorted((a_item[\"sha256\"], b_item[\"sha256\"])))\n        if key in self._raster_pairs:\n",
        "after": "        a_identity = self._raster_identity(a_path, a_item)\n        b_identity = self._raster_identity(b_path, b_item)\n        if a_identity == b_identity:\n            return True\n        key = tuple(sorted((a_identity, b_identity)))\n        if key in self._raster_pairs:\n"
      },
      {
        "before": "        runtime = source_state.get(\"runtime\", {})\n        module = runtime.get(\"modules\", {}).get(model, {})\n        if (runtime.get(\"version\") != INVEST_VERSION or\n                module.get(\"git_blob\") != INVEST_SOURCE[model + \"_blob\"]):\n            different(\"source native module\")\n        stage = source_state.get(\"stages\", {}).get(model)\n",
        "after": "        stage = source_state.get(\"stages\", {}).get(model)\n        # A later model can resume under another runtime. The native stage owns\n        # the execution environment that produced its retained results.\n        runtime = (stage or {}).get(\"runtime\") or source_state.get(\"runtime\", {})\n        dependencies = (\"ndr\", \"sdr\") if model == \"ndr\" else (\"sdr\",)\n        if runtime.get(\"version\") != INVEST_VERSION:\n            different(\"source stage native version\")\n        for dependency in dependencies:\n            module = runtime.get(\"modules\", {}).get(dependency, {})\n            if module.get(\"git_blob\") != INVEST_SOURCE[dependency + \"_blob\"]:\n                different(\"source native dependency \" + dependency)\n        target_runtime = self.target_runtime or target_state.get(\"runtime\")\n        if target_runtime:\n            if target_runtime.get(\"version\") != INVEST_VERSION:\n                different(\"target runtime native version\")\n            for dependency in dependencies:\n                module = target_runtime.get(\"modules\", {}).get(dependency, {})\n                if module.get(\"git_blob\") != INVEST_SOURCE[dependency + \"_blob\"]:\n                    different(\"target native dependency \" + dependency)\n            if (target_runtime.get(\"environment\") is not None and\n                    runtime.get(\"environment\") != target_runtime[\"environment\"]):\n                different(\"native runtime environment\")\n"
      }
    ]
  }
}

def sha256(body):
    return hashlib.sha256(body).hexdigest()


def emit(phase, **values):
    print(json.dumps({"phase": phase, **values}, sort_keys=True), flush=True)


def atomic(path, body, *, previous=None, mode=0o644, create=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix="regional-write-", delete=False) as stream:
            pending = Path(stream.name)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(pending, mode)
        if previous is not None and path.read_bytes() != previous:
            raise ValueError("Source changed during installation: " + str(path))
        if create:
            os.link(pending, path)
            pending.unlink()
        else:
            os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def retained_source(item, cache, bundle):
    relative = Path(item["path"])
    target = cache / relative
    if target.exists():
        body = target.read_bytes()
        if len(body) == item["bytes"] and sha256(body) == item["sha256"]:
            return target, body
    if bundle is not None:
        original = (bundle / relative).resolve(strict=True)
        if not original.is_relative_to(bundle):
            raise ValueError("Bundle source escapes the selected source bundle")
        body = original.read_bytes()
    else:
        request = urllib.request.Request(BASE_URL + item["path"],
                                         headers={"User-Agent": "Commons-Upper-Savannah/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read(item["bytes"] + 1)
    if len(body) != item["bytes"] or sha256(body) != item["sha256"]:
        raise ValueError("Pinned source differs from its exact original bytes: " + item["path"])
    if relative.suffix == ".py":
        ast.parse(body.decode("utf-8"), filename=item["path"])
    atomic(target, body)
    emit("source", path=item["path"], bytes=len(body), sha256=item["sha256"])
    return target, body


def derive_source(item, body):
    """Apply the retained exact update to the pinned source, including offline."""
    update = SOURCE_UPDATES.get(item["path"])
    if update is None:
        return item, body
    if sha256(body) != update["from_sha256"]:
        raise ValueError("The source update selects another original body: " + item["path"])
    source = body.decode("utf-8")
    for change in update["replacements"]:
        if source.count(change["before"]) != 1:
            raise ValueError("Source update context differs: " + item["path"])
        source = source.replace(change["before"], change["after"], 1)
    body = source.encode("utf-8")
    if len(body) != update["bytes"] or sha256(body) != update["sha256"]:
        raise ValueError("Updated source differs from its retained body: " + item["path"])
    ast.parse(source, filename=item["path"])
    return {**item, "bytes": update["bytes"], "sha256": update["sha256"],
            "derived_from_sha256": update["from_sha256"]}, body


def install_selected_core(application, loader, packet):
    """Adopt the maintained cache-aware selection API when already integrated."""
    marker = application / "model" / "model_selection.py"
    if not marker.is_file():
        return loader.apply(application, packet)
    check = """
import inspect
from model.common import selected_models
from model.model_selection import normalize_selection, required_roles, required_outputs
from model.profiles import inspect_table
from model.workspace import Workspace
from model.native import execute_run
assert selected_models({'models': ['ndr']}) == ['ndr']
assert required_roles(['ndr']) == ('DEM', 'NLCD', 'PRECIPITATION')
assert required_roles(['sdr']) == ('DEM', 'NLCD', 'R_FACTOR', 'K_FACTOR')
assert required_outputs(['ndr']) == ('nitrogen_export', 'phosphorus_export')
assert required_outputs(['sdr']) == ('sediment_export',)
assert normalize_selection({'models': ['ndr', 'sdr']}) == ({}, ('ndr', 'sdr'))
assert normalize_selection({'models': ['ndr']}) == ({'models': ['ndr']}, ('ndr',))
assert 'models' in inspect.signature(inspect_table).parameters
print('Existing selected-model and native-cache interfaces retained')
"""
    subprocess.run([sys.executable, "-B", "-c", check], cwd=application, check=True)
    files = []
    for name in ("model/common.py", "model/profiles.py", "model/workspace.py",
                 "model/native.py", "model/model_selection.py",
                 "model/stage_cache.py", "model/reuse.py"):
        path = application / name
        if not path.is_file():
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(application):
            raise ValueError("Select a regular selected-model source: " + name)
        body = path.read_bytes()
        ast.parse(body.decode("utf-8"), filename=name)
        actual = sha256(body)
        files.append({"path": name, "changed": False, "bytes": len(body),
                      "before_sha256": actual, "after_sha256": actual})
    return {"mode": "existing-selected-core", "files": files}


def check_existing_dependency(application, name, body):
    if (name != "source_tools/climate_region.py" or
            sha256(body) != "a0d7cc4710b2ec998727ee1536af36370bfe27193afd08cb43b1c9e3d2aa9fcd"):
        return
    source = application / "model" / "rasters.py"
    functions = [node for node in ast.parse(source.read_text(encoding="utf-8")).body
                 if isinstance(node, ast.FunctionDef) and node.name == "align_source"]
    parameters = ({argument.arg for argument in
                   functions[0].args.posonlyargs + functions[0].args.args + functions[0].args.kwonlyargs}
                  if len(functions) == 1 else set())
    if not {"checkpoint_directory", "source_identity"} <= parameters:
        raise ValueError("The joined climate source requires the current 7F24 align_source "
                         "with checkpoint_directory and source_identity")


def install(application, *, bundle=None, cache=None, keep_existing=()):
    application = Path(application).resolve(strict=True)
    if not application.is_dir():
        raise ValueError("Select the existing complete application directory")
    for name in ("model/common.py", "model/workspace.py", "model/native.py", "source_tools/raster_sources.py"):
        if not (application / name).is_file():
            raise ValueError("The complete source application needs " + name)
    keep_existing = set(keep_existing)
    allowed = {item["path"] for item in CATALOG if not item["path"].startswith("integration/")}
    if keep_existing - allowed:
        raise ValueError("Select additive catalog paths to keep: " + ", ".join(sorted(keep_existing - allowed)))
    bundle = Path(bundle).resolve(strict=True) if bundle is not None else None
    cache = Path(cache).resolve() if cache is not None else application / "integration" / "regional-downloads" / BUNDLE_REF
    cache.mkdir(parents=True, exist_ok=True)
    lock_path = application / "integration" / "regional-pipeline-install.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        captured = {item["path"]: retained_source(item, cache, bundle) for item in CATALOG}
        loader_path = captured["integration/apply_selected_model_overlay.py"][0]
        spec = importlib.util.spec_from_file_location("upstate_selected_model_installer", loader_path)
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        reports = []
        for name in OVERLAYS:
            packet = json.loads(captured[name][1])
            report = (install_selected_core(application, loader, packet)
                      if name == OVERLAYS[0] else loader.apply(application, packet))
            reports.append({"path": name, **report})
            emit("overlay", path=name, changed=sum(row["changed"] for row in report["files"]))
        installed = []
        for catalog_item in CATALOG:
            if catalog_item["path"].startswith("integration/"):
                continue
            item, body = derive_source(catalog_item, captured[catalog_item["path"]][1])
            path = application / item["path"]
            if path.is_symlink() or not path.resolve().is_relative_to(application):
                raise ValueError("Select a regular application source: " + item["path"])
            previous = path.read_bytes() if path.exists() else None
            if item["path"] in keep_existing and previous is not None:
                check_existing_dependency(application, item["path"], previous)
                if path.suffix == ".py":
                    ast.parse(previous.decode("utf-8"), filename=item["path"])
                installed.append({"path": item["path"], "sha256": sha256(previous),
                                  "bytes": len(previous), "changed": False,
                                  "kept_existing": True, "pinned_sha256": item["sha256"]})
                emit("installed", **installed[-1])
                continue
            if previous != body:
                if previous is not None:
                    backup = path.with_name(path.name + ".before-regional-" + sha256(previous)[:12])
                    if backup.exists() and backup.read_bytes() != previous:
                        raise ValueError("Source backup differs: " + str(backup))
                    if not backup.exists():
                        atomic(backup, previous, create=True)
                mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
                atomic(path, body, previous=previous, mode=mode, create=previous is None)
            installed.append({"path": item["path"], "sha256": item["sha256"],
                              "bytes": item["bytes"], "changed": previous != body,
                              **({"derived_from_sha256": item["derived_from_sha256"]}
                                 if "derived_from_sha256" in item else {})})
            emit("installed", **installed[-1])
        check = """
import json
from pathlib import Path
import sys
import tempfile
from model.common import selected_models, required_roles
from model.regional_job import run_core, finish_delivery, _progress
from model.regional_scenarios import execute
from model.native_equivalence import NativeInputMatcher
from source_tools.climate_region import prepare
assert required_roles(['ndr']) == ('DEM', 'NLCD', 'PRECIPITATION')
assert required_roles(['sdr']) == ('DEM', 'NLCD', 'R_FACTOR', 'K_FACTOR')
with tempfile.TemporaryDirectory(prefix='upstate-start-', dir=sys.argv[1]) as temporary:
    path = Path(temporary) / 'progress.json'
    record = {'id': 'receiving-start-check', 'state': 'prepared'}
    _progress(path, record, state='running', phase='native')
    retained = json.loads(path.read_bytes())
    assert retained['state'] == record['state'] == 'running'
    assert retained['phase'] == 'native'
print('Regional imports and actual progress transition complete')
"""
        subprocess.run([sys.executable, "-B", "-c", check, str(cache)], cwd=application, check=True)
        result = {"schema": "upstate.regional-install/v1", "source_ref": BUNDLE_REF,
                  "application": str(application), "interpreter": sys.executable,
                  "overlays": reports, "files": installed}
        atomic(cache / "installed.json", (json.dumps(result, sort_keys=True, indent=2) + "\n").encode("utf-8"))
        emit("complete", source_ref=BUNDLE_REF, application=str(application), files=len(installed))
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application", type=Path, help="Existing complete application source root")
    parser.add_argument("--bundle", type=Path, help="Existing pinned source bundle root; otherwise fetch public sources")
    parser.add_argument("--cache", type=Path, help="Retained source download directory")
    parser.add_argument("--keep-existing", action="append", default=[],
                        choices=[item["path"] for item in CATALOG
                                 if not item["path"].startswith("integration/")],
                        help="Retain an already joined additive source at this path; repeat for each file")
    args = parser.parse_args(argv)
    try:
        install(args.application, bundle=args.bundle, cache=args.cache,
                keep_existing=args.keep_existing)
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError, subprocess.CalledProcessError) as error:
        emit("failed", type=type(error).__name__, message=str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
