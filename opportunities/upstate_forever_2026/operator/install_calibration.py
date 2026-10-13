"""Install calibration through the retained operator's maintained extension registry.

The current generic extension installer owns shared application hooks. Calibration
supplies one descriptor, its complete backend/browser sources and a portable
assembly driver. Earlier direct calibration registrations migrate in memory.
"""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile

FILES = ("model/calibration.py", "model/CALIBRATION.md",
         "model/calibration_uncertainty.py", "model/CALIBRATION_UNCERTAINTY.md",
         "model/calibration_maps.py", "model/CALIBRATION_MAPS.md",
         "model/calibration_review.py", "model/CALIBRATION_REVIEW.md", "operator/calibration.py",
         "operator/web/calibration.mjs", "operator/web/calibration_maps.mjs",
         "operator/web/calibration_review.mjs", "operator/web/calibration.css",
         "operator/extensions/calibration.json", "operator/CALIBRATION.md",
         "operator/install_calibration.py", "source_tools/calibration_assembly.py",
         "operator/web/calibration_design.mjs", "operator/CALIBRATION_DESIGN.md",
         "operator/calibration_design_patch.json", "operator/install_calibration_design.py",
         "source/calibration-design/upper-savannah-reference-support.json")
SHARED = ("operator/server.py", "operator/web/app.mjs", "operator/web/index.html")
DEPENDENCIES = ("operator/extension_registry.py", "operator/web/extension_host.mjs",
                "install_extensions.py")
VERSION = "upstate.calibration-registration/v3"
PREDECESSORS = {
    "model/CALIBRATION_REVIEW.md": {
        "2e074fac920846af9cb50013c520e83e0808b95c3d148e4f7734199f1ec9bbd0",
    },
    "operator/web/calibration_review.mjs": {
        "dfead8c5d57617ed5b2dc22fd8674687a9441d0da64e17abf122280f89fe8a9d",
    },
    "operator/web/calibration_maps.mjs": {
        "520d4224204e7567507410877562e01c24db6c00ab65e66f096d99a175c5a193",
    },
    "model/calibration.py": {
        "390613243fa53a9955236dc4b57b7bebd6cd88ecbb6f3dc694308ec5d81e7fc5",
        "212435ab972a19027222042870a9c0914701271ce9f8760d785460d53e553e26",
    },
    "model/CALIBRATION.md": {
        "30cd645cce5210ea31aeb13327796e90e8f8c4820f7a44ea957d4f104ccdfa2c",
        "ea20e443b4152012cac68c9ef0f322ddb1529f3ce45c7995e4bc3c47a0c9bfd1",
    },
    "operator/calibration.py": {
        "4081205000d0071e9c0d0f8dd2d0532b4b2a5f98dbb930d8945c84c58c56461f",
        "f606ecace454c6ce9f7644dddd68a0637f0e243106dc6d56e404c38bf44003ae",
        "9440c787158558bccf0df44314de00872ce560ab31ea71246e51446a58edbac3",
        "20764e08b5e66ef4d64d3099c7778dced81a0e587ec26013f24835629d177cfa",
        "804cd4e54600fa358d7554d10de9605d26a96b74bc8a10df6d77465544707961",
        "d09b6154d3eb889d6d18db6b70a6989ea08455373abe4d5a78d7d63cb545203a",
        "c93bc426673d7489ce14b11921c2093e867aa09b4aaa73f33aff322c7d88e776",
    },
    "operator/web/calibration.mjs": {
        "0304425bc0d1fc508631f4556f14aebc5d6764c74100142a7bf40567ca7f6229",
        "b8e08775f1aec0b16c701857363bdfdc6a31c460f5cec39f9bf8c028750307e1",
        "d62b47ff8248083c231e61d2aaddc609ff7a66b2b8e9f02c5c3100a47503f5c7",
        "b70e352a1d601bab075fa1f6e97f5bd3b0f093ff3e09cb91ca1f5caff7ec98a2",
        "8dbb74a4ab4ebc26de2fc2391be9175ca84aa8ef5d3e5cebe09dec2760ed0e71",
        "f11f84b5bc537783bf9d6c05a4698ecc67c9960044236f6f4bf09cd84eb7c6b3",
        "d671b93682092db969d7ca5819fa9c77aacb90f7a12f835655dbb84675ef6476",
    },
    "operator/web/calibration.css": {
        "650ff487671e51d1814e1015985d3268495dc141246bb2aecfd1205185632469",
        "f7d61970e7ce5a5e010a702ce6d5da7565a2921f04b851ff45715df1729ab735",
        "6d523b2bf1b10f94b70e9c2a270eea08137e8edf0345160efee497108228386e",
        "6d523b2bf1b10f94b70e9c2a270eea08137e8edf0345160efee497108228386e",
    },
    "operator/extensions/calibration.json": {
        "482005956a6d3ec9347f2cc16700c644055f7c44259e81bc97ac3baf329bd547",
        "92175b71c806f5f71889031dd24d4766bf45d3e9f5a8f5b087c78c735f557f71",
        "dd9e74df13aaf1d183897a9c2bb6d26478f60b05b21ca5882ffb548dc85e9fe4",
        "a2865a0fd8429f5e684e5111e61e5edac7be4dbd8a03956654cba79595e6b8b9",
    },
    "operator/CALIBRATION.md": {
        "82042e958306863a9b90b311d6affb17a9d97cf486bfcd044a820e36aab8607d",
        "d77a8b7cb6e8fac7a83148356de08322f96badc1cf481dda676150eeae2ba836",
        "e9a139100b382867c5afdfccf3a5691318cc34886f40227a508f6bba9403eaca",
        "a531f22fa04bf1c2ea6476866246b1d09751f9f393846280ec1c5d923a7dcb64",
        "6b9eff4d235c967ba1e7329c426d9c66599858e350fa341decffdd7c0945a3a3",
        "db602932eca8dfcb5b2feb008246a388a236657339baa70fb522a82520d533cd",
        "ffc4ee920f1a94481e991818ccdcd9e66bcefa468989b75025d97fab046b333c",
        "8b149d2747c3b2fe975640fc700da54fd7aa68acfb0b9d50c0490050e4ca6aa9",
        "4b475c00a806812548da18d54fe3885e7e73a01daaad49e5709212718b9624ad",
    },
    "operator/install_calibration.py": {
        "4d8124b5b891f347d87dcb56ac0b8796530b1381764e24229bc259c2ef095a49",
        "d1e92bc00687a7ef5c470ba9e4902e2e78677742f01794b6725c91ec33acd768",
        "88e464da584ec4f34c9f71d0a0211ebfa25e90ab3e10f021613a73157ca4764d",
        "7aef9208344921e01033c548a9420b60eeccf596c104dc8f6486c0837de6b35c",
        "4a3a1b816c20d75f034b82bacbda5388c784e4b2cf12852e222260707015acea",
        "3092eef2818fea214527923f040ef035e9bd4c7c5a323876d6fe665eb72cf748",
        "c4778244f62b9ee214034bd64fadc74cd2cc4d545b7e5292c4395575e88ac261",
        "50360ee8e59a0c318d298fa449498be43f6d47abfbae87e5a88969d3f26aa32a",
    },
    "source_tools/calibration_assembly.py": {
        "d3ab1ab2f4baf0c93d2ad1b390d73e61118ba7c8ee724de44210f07238d96210",
        "d0521c411956d084a30dfc4da76d39301e78baf6afebda1d2a0689cfa7ea46b7",
        "d249ffa25199f07dd400af8bb5e93aa4cd02bb55dc55ec3d07b3e1187b6cc583",
        "5ea2734cc4bac957d99b8f8ef7d63c10ae687fd6d02ae208342b5219804bddb1",
        "d2ce1db8c60f83b34856fe6adeb99912c59593404495dff4cb62ae991020ed57",
        "5ea2734cc4bac957d99b8f8ef7d63c10ae687fd6d02ae208342b5219804bddb1",
    },
}


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".calibration-install-", delete=False) as stream:
            pending = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _replace_owned(source, old, new, label):
    if old not in source:
        return source
    if source.count(old) != 1:
        raise ValueError(label + ": compose the repeated current calibration registration")
    return source.replace(old, new, 1)


def _legacy_server(source):
    removals = (
        "from calibration import CalibrationOperations, ACTIONS as CALIBRATION_ACTIONS, READS as CALIBRATION_READS\n",
        "ACTIONS.update(CALIBRATION_ACTIONS)\n",
        "        self.calibration = CalibrationOperations(self, Fault)\n",
        "        if action in CALIBRATION_ACTIONS:\n            return self.calibration.invoke(task)\n",
        "        state.update(self.calibration.state(workspace))\n",
        '                calibration_reads = {"/api/calibration/" + name: name for name in CALIBRATION_READS}\n'
        '                if url.path in calibration_reads:\n'
        '                    return self.send_json(200, self.app.calibration.read(\n'
        '                        workspace, calibration_reads[url.path], {"id": one("id")}))\n',
        '            if url.path == "/api/calibration/preview":\n'
        '                return self.send_json(200, self.app.calibration.preview(\n'
        '                    value.get("workspace", self.app.primary), required(value, "selection")))\n',
    )
    for value in removals:
        source = _replace_owned(source, value, "", "Earlier calibration backend")
    source = _replace_owned(source,
        "self.customer_reviews.decorate_task(self.calibration.decorate_task(task))",
        "self.customer_reviews.decorate_task(task)", "Earlier calibration task decoration")
    if re.search(r"\bCALIBRATION_(?:ACTIONS|READS)\b|\bself(?:\.app)?\.calibration\b", source):
        raise ValueError("Current direct calibration backend has independent registration changes; compose those exact joins")
    return source


def _legacy_app(source):
    removals = (
        "import {attachCalibration} from './calibration.mjs';\n",
        "const calibration=attachCalibration({getState:()=>state,api,endpoint,openForm,submitAction,"
        "detail,fileList,openItem,showTask,toast});\n",
        "  if(view==='calibration')html=calibration.render();\n",
        "  if(view==='calibration')calibration.mount($('#content'));else calibration.detach();\n",
        " if(action?.startsWith('calibration-'))return calibration.dispatch(button);\n",
    )
    for value in removals:
        source = _replace_owned(source, value, "", "Earlier calibration browser")
    source = _replace_owned(source, "if(view==='spatial'){calibration.detach();",
                            "if(view==='spatial'){", "Earlier spatial view lifecycle")
    source = _replace_owned(source, "calibration.detach();workspace=id;state=null;",
                            "workspace=id;state=null;", "Earlier calibration workspace lifecycle")
    source = _replace_owned(source, "customerReviews.taskActions(row)+calibration.taskActions(row)",
                            "customerReviews.taskActions(row)", "Earlier calibration task links")
    if "attachCalibration" in source or re.search(r"\bcalibration\.(?:render|mount|detach|dispatch|taskActions)\(", source):
        raise ValueError("Current direct calibration browser has independent registration changes; compose those exact joins")
    return source


def load_extension_installer(path):
    path = Path(path).resolve(strict=True)
    spec = importlib.util.spec_from_file_location("_upstate_maintained_extension_installer", path)
    if spec is None or spec.loader is None:
        raise ValueError("Select the retained install_extensions.py")
    tool = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = tool
    spec.loader.exec_module(tool)
    if not callable(getattr(tool, "patch_server", None)) or not callable(getattr(tool, "patch_app", None)):
        raise ValueError("The retained extension installer needs patch_server and patch_app")
    return tool


def patch_journey_validation(source):
    """Join the current native saved-view method without replacing its owner."""
    nodes = [node for node in ast.walk(ast.parse(source))
             if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
             and node.name == "_save_operator_session"]
    if not nodes:
        return source
    if len(nodes) != 1:
        raise ValueError("Compose the current unique native saved-view method")
    lines = source.splitlines(keepends=True)
    node = nodes[0]
    body = "".join(lines[node.lineno - 1:node.end_lineno])
    marker = "# Calibration review: retain the original dossier in a saved journey."
    addition = "        # Calibration review: retain the original dossier in a saved journey.\n        review_id = selection.get(\"calibration_review_id\", \"\")\n        if not isinstance(review_id, str):\n            raise Fault(\"JOURNEY_SELECTION\", \"Choose one saved calibration review.\")\n        if review_id:\n            from calibration import validate_review_journey\n            validate_review_journey(ws, journey)\n"
    anchor = "        request_sha256 = digest(journey)\n"
    if marker in body:
        if body.count(addition) != 1 or body.count(marker) != 1:
            raise ValueError("The current calibration saved-view join has changed")
        return source
    if body.count(anchor) != 1:
        raise ValueError("Compose the current native saved-view revision before calibration receiving")
    body = body.replace(anchor, addition + anchor, 1)
    result = "".join(lines[:node.lineno - 1]) + body + "".join(lines[node.end_lineno:])
    ast.parse(result, filename="operator/server.py")
    return result


def register_sources(sources, extension_installer):
    """Compose the current maintained host and migrate only our earlier joins."""
    for name in (*SHARED, *DEPENDENCIES):
        if name not in sources:
            raise ValueError("Receive the current complete application and extension host; missing " + name)
    result = {
        "operator/server.py": patch_journey_validation(extension_installer.patch_server(_legacy_server(sources["operator/server.py"]))),
        "operator/web/app.mjs": extension_installer.patch_app(_legacy_app(sources["operator/web/app.mjs"])),
        "operator/web/index.html": sources["operator/web/index.html"],
    }
    ast.parse(result["operator/server.py"], filename="operator/server.py")
    return result


def install(application, source, *, preview=False, extension_installer=None):
    application, source = Path(application).resolve(strict=True), Path(source).resolve(strict=True)
    for path in ("model/workspace.py", "model/observations.py", *SHARED, *DEPENDENCIES):
        if not (application / path).is_file():
            raise ValueError("Select the complete retained scientific application and extension host; missing " + path)
    tool_path = Path(extension_installer or application / "install_extensions.py").resolve(strict=True)
    tool_bytes = tool_path.read_bytes()
    if tool_bytes != (application / "install_extensions.py").read_bytes():
        raise ValueError("Select the current application's exact maintained install_extensions.py")
    tool = load_extension_installer(tool_path)
    lock_path = application / "operator" / ".calibration-registration.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest_path = application / "operator" / "calibration-install.json"
        previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
        originals, changes, kinds = {}, {}, {}
        for name in FILES:
            incoming = source / name
            if not incoming.is_file():
                raise ValueError("The calibration source cohort is incomplete: " + name)
            data = incoming.read_bytes()
            target = application / name
            before = target.read_bytes() if target.exists() else None
            if before is not None and before != data:
                expected = previous.get("installed", {}).get(name)
                if expected != _hash(before) and _hash(before) not in PREDECESSORS.get(name, set()):
                    raise ValueError("Existing extension has independent changes: " + name
                                     + " (current " + _hash(before) + ", incoming " + _hash(data) + ")")
            originals[name], changes[name], kinds[name] = before, data, "extension"
        source_snapshot = {name: (application / name).read_bytes() for name in (*SHARED, *DEPENDENCIES)}
        composed = register_sources({name: data.decode("utf-8") for name, data in source_snapshot.items()}, tool)
        for name, after in composed.items():
            originals[name], changes[name], kinds[name] = source_snapshot[name], after.encode("utf-8"), "registration"
        for name, data in changes.items():
            if name.endswith(".py"):
                ast.parse(data.decode("utf-8"), filename=name)
            if name == "operator/extensions/calibration.json":
                descriptor = json.loads(data)
                if descriptor.get("schema") != "upstate.operator-extension/v1" or descriptor.get("id") != "calibration":
                    raise ValueError("Select the complete calibration extension descriptor")
        plan = [{"path": name, "kind": kinds[name],
                 "before_sha256": _hash(originals[name]) if originals[name] is not None else None,
                 "after_sha256": _hash(data), "changed": data != originals[name]}
                for name, data in changes.items()]
        dependency_hashes = {name: _hash(source_snapshot[name]) for name in DEPENDENCIES}
        receipt = {"schema": VERSION, "application": str(application), "files": plan,
                   "dependencies": dependency_hashes, "catalogue": "/api/extensions",
                   "changed_files": sum(row["changed"] for row in plan)}
        if preview:
            return {**receipt, "state": "prepared"}
        operation_id = _hash(json.dumps(plan, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        history = application / ".calibration-install-history" / operation_id
        for name, before in source_snapshot.items():
            if (application / name).read_bytes() != before:
                raise ValueError("Current shared source changed during calibration preparation: " + name)
        for name, before in originals.items():
            path = application / name
            current = path.read_bytes() if path.exists() else None
            if current != before:
                raise ValueError("Original source changed during calibration preparation: " + name)
        for name, data in changes.items():
            before = originals[name]
            if before == data:
                continue
            path = application / name
            current = path.read_bytes() if path.exists() else None
            if current != before:
                raise ValueError("Concurrent source changed before registration: " + name)
            if before is not None:
                _atomic(history / name, before)
            _atomic(path, data)
        installed = {name: _hash(data) for name, data in changes.items()}
        _atomic(manifest_path, (json.dumps({"schema": VERSION, "operation_id": operation_id,
                                           "installed": installed, "dependencies": dependency_hashes},
                                          sort_keys=True, indent=2) + "\n").encode("utf-8"))
        return {**receipt, "state": "installed", "operation_id": operation_id}
    finally:
        os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True,
                        help="Existing complete Upper Savannah scientific application and extension host")
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1],
                        help="This complete calibration cohort with model/, operator/ and source_tools/")
    parser.add_argument("--extension-installer", type=Path,
                        help="Exact current maintained install_extensions.py; defaults to the application copy")
    parser.add_argument("--preview", action="store_true", help="Show exact composed paths before applying")
    args = parser.parse_args(argv)
    try:
        result = install(args.application, args.source, preview=args.preview,
                         extension_installer=args.extension_installer)
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except (ValueError, OSError, SyntaxError) as error:
        print(json.dumps({"state": "failed", "type": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
