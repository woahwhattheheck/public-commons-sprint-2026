#!/usr/bin/env python3
"""Compose the original reach-chemistry component through the native registry."""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = [
    "model/chemistry.py",
    "model/chemistry_reports.py",
    "model/chemistry_report_source.py",
    "model/CHEMISTRY_REPORT_SOURCE.md",
    "integration/component_fragments/chemistry_report_sources.json",
    "model/CHEMISTRY_REPORTS.md",
    "model/reach_chemistry/reporting.py",
    "integration/component_fragments/chemistry_reports.json",
    "model/chemistry_cli.py",
    "model/chemistry_receiving.py",
    "model/reach_chemistry/__init__.py",
    "model/reach_chemistry/__main__.py",
    "model/reach_chemistry/cli.py",
    "model/reach_chemistry/inference.py",
    "model/reach_chemistry/io.py",
    "model/reach_chemistry/model.py",
    "model/reach_chemistry/service.py",
    "model/reach_chemistry/solver.py",
    "operator/chemistry.py",
    "operator/extensions/chemistry.json",
    "operator/web/chemistry.mjs",
    "operator/web/chemistry-native.mjs",
    "operator/web/chemistry.css",
    "operator/CHEMISTRY_OPERATOR.md",
    "CHEMISTRY.md",
    "requirements-chemistry.txt",
    "install_chemistry.py",
    "operator/install_chemistry.py",
    "integration/reach_chemistry/install_chemistry_legacy.py"
]
ORIGINAL_SHA256 = {
    "model/chemistry.py": "12189fbe24b700815693ec9ae7d9f08484a1c1ebc67ba04fd825fad38386a6ed",
    "model/chemistry_cli.py": "4cf3e90a83474842cc4da0773c8d7c22fe1ecca2dc189da7347e52d4cc173cf2",
    "model/reach_chemistry/__init__.py": "a1c644213e39975b64f2e40485cb64ef14bd1b841d49714a33ce3af3767005c9",
    "model/reach_chemistry/__main__.py": "79ee6f134c5c5193377cf9b189cbdcc3e2095e49ba9cec310114441c15a917c4",
    "model/reach_chemistry/cli.py": "eb528efb01e30ed01fd166f6b6c271adc9dd5b573efced3f7aaa402f0b00d08c",
    "model/reach_chemistry/inference.py": "d44b9649541a8841466482810796e20497c8f7ed91ac3686b3be1eb75f668e69",
    "model/reach_chemistry/io.py": "110bbd797349ffaa46b841e9f36ab87dc984642b2e69469ffc62449c41647cb0",
    "model/reach_chemistry/model.py": "d8266d41953cc5a0c9469422c4b6baab083b1dae0abfbbf2b6b67bad32a4e14c",
    "model/reach_chemistry/service.py": "b3980996de0de86680fa8477367868feb7f7bf8641f044bf671fa371a780c58e",
    "model/reach_chemistry/solver.py": "0523bdf585a92cd727b8c6db3089b35224bdb8adc39b45411526c5874ca5eb37",
    "operator/chemistry.py": "26021a183b9e4543cd9a5feb11b776d34264ac5508c0239277fd1317f0e0b932",
    "operator/web/chemistry.mjs": "5332b46bcb08fb5328104fe3182826f584c250979dc59c2d6a07eb1687804588",
    "operator/web/chemistry.css": "4276c4dca88f4987abc2062cf60ec00121ef97d18d7f9a2a4e247dcc2211aff7",
    "CHEMISTRY.md": "81ec1c41e221af64148661e0be0f69eb39526920376ba6d010da1b8e2b50f82f",
    "requirements-chemistry.txt": "794e78e97975a317667c64e1975884140754ff26feb267649b3d4e0249549522",
    "install_chemistry.py": "0229658125241edcc07b54bcd3a199c2e1f8ad06a85806044e404706052495ba"
}

# Exact native-registry predecessors; independently changed files still require
# reconciliation before replacement.
PREVIOUS_NATIVE_SHA256 = {
    "operator/chemistry.py": "26cb08accf987602d1874775d9c61af4c13643ea5de3e8549c9331f9e7cf0541",
    "operator/install_chemistry.py": "cc1eeeff12c27895497bfb9739e63502aa76ac22379c7d4073337cff79efcea5"
}


REPORT_PREVIOUS_SHA256 = {
    "model/chemistry.py": "ed38b793b2ddc2daa7adcfbd599b9b1b7365877fba52a1300fb2e16798cee999",
    "model/reach_chemistry/io.py": "110bbd797349ffaa46b841e9f36ab87dc984642b2e69469ffc62449c41647cb0",
    "model/chemistry_receiving.py": "d6056c3199ff5540d0dae1cf34124230772d435d5906ff0a519d1cba0626d6f1",
    "operator/chemistry.py": "57fa5edc576aae87e22808667f2ded8a64a2dfbbeccc4622e116d73e92b097f4",
    "operator/extensions/chemistry.json": "d03ccae5a2d15920f9bd7aef314d42952b0359bc57238b873db3300ba8ca712b",
    "operator/web/chemistry.mjs": "2663db7f04ec625a8abb9503692c52f9fb4e7deecebcb7d3d62ab96113bed3a6",
    "operator/install_chemistry.py": "d3de5d3f3e6ec6219faba50cafcb48281fbe0f70a0639d76ebffa08be471c2a8",
    "operator/CHEMISTRY_OPERATOR.md": "31e678a1d4daa278b43410d04cbda4a40efbd7240e6ab3de52cf703fe48fc414",
    "operator/web/chemistry-native.mjs": "9520e37557315888f6fe96b147e9731a018dc4e044ab7caa38bf81a8fb808440"
}

SOURCE_PREVIOUS_SHA256 = {
    "model/chemistry.py": "dfe0af2343010f95be8922ae324a30097778af18b07041997ddaa9d2ceadaa64",
    "model/chemistry_receiving.py": "dc30f390a7c329fcdd6b2614dd66fe7e1513c12da7eaa2b648dfa1dfcb7930f3",
    "operator/chemistry.py": "a2dac71be1d3a8691beed3a6b512bb2edeed061d71f39a0e2e594b6b80371951",
    "operator/extensions/chemistry.json": "4a7fc7354b2cba35d735c9246bf464d1e4261e9ba7c2785bd37d4b44355c6956",
    "operator/web/chemistry.mjs": "15557dd9cb3d42cdd20e3abec8b702b0129af32ea611c164621a0c67d44b8036",
    "operator/install_chemistry.py": "dc0b57181da0575a3dcf065cab1e138a1bbf5e40820e55263a008a08c96478ae",
    "operator/CHEMISTRY_OPERATOR.md": "f6e2951c63f24ee392cd4ea6e02923f4eded2a8ddc8bdc6f8926b7520994e88b"
}

SHARED_REPORT_FILES = [
    "model/observed_context.py",
    "model/scientific_figures.py",
    "model/observed_report_render.py",
    "operator/source_reports.py",
    "operator/source_report_editions.py",
    "operator/web/source_reports.mjs",
    "operator/web/source_report_editions.mjs",
    "operator/extensions/source-reports.json",
    "operator/web/extension_host.mjs"
]

def install(application, source_root=None, dry_run=False):
    target = Path(application).resolve(strict=True)
    source = Path(source_root or Path(__file__).resolve().parents[1]).resolve(strict=True)
    if not (target / "model/workspace.py").is_file() or not (target / "operator/extension_registry.py").is_file():
        raise ValueError("Select the maintained scientific application with its original extension registry")
    lock = target / ".locks/extension-install.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        pending, preimages = {}, {}
        shared = {}
        for name in SHARED_REPORT_FILES:
            path = target / name
            if not path.is_file() or path.is_symlink():
                raise ValueError("Receive the maintained Scientific Reports component; missing " + name)
            shared[name] = path.read_bytes()
        for name in FILES:
            path = source / name
            if not path.is_file():
                raise ValueError("Complete reach-chemistry source is missing: " + name)
            body = path.read_bytes()
            if name.endswith(".py"):
                ast.parse(body, filename=name)
            if name.endswith(".json"):
                json.loads(body)
            destination = target / name
            current = destination.read_bytes() if destination.is_file() else None
            if (current is not None and current != body
                    and hashlib.sha256(current).hexdigest() not in
                    {ORIGINAL_SHA256.get(name), PREVIOUS_NATIVE_SHA256.get(name),
                     REPORT_PREVIOUS_SHA256.get(name), SOURCE_PREVIOUS_SHA256.get(name)}):
                raise ValueError("Reconcile the independently changed chemistry file: " + name)
            pending[name], preimages[name] = body, current
        descriptor = json.loads(pending["operator/extensions/chemistry.json"])
        if (descriptor.get("schema") != "upstate.operator-extension/v1"
                or descriptor.get("id") != "chemistry"
                or descriptor["backend"]["factory"]["name"] != "ChemistryOperations"):
            raise ValueError("Select the original native chemistry registration")
        changed = [name for name in FILES if pending[name] != preimages[name]]
        if not dry_run:
            with tempfile.TemporaryDirectory(prefix=".chemistry-install-", dir=target.parent) as temporary:
                stage = Path(temporary)
                for name in changed:
                    path = stage / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(pending[name])
                for name, before in shared.items():
                    if (target / name).read_bytes() != before:
                        raise RuntimeError("Concurrent scientific-report source change: " + name)
                for name in changed:
                    destination = target / name
                    actual = destination.read_bytes() if destination.is_file() else None
                    if actual != preimages[name]:
                        raise RuntimeError("Concurrent application change: " + name)
                committed = []
                try:
                    for name in changed:
                        destination = target / name
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        os.replace(stage / name, destination)
                        committed.append(name)
                except BaseException:
                    for name in reversed(committed):
                        destination = target / name
                        previous = preimages[name]
                        if previous is None:
                            destination.unlink(missing_ok=True)
                        else:
                            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as saved:
                                rollback = Path(saved.name)
                                saved.write(previous)
                                saved.flush()
                                os.fsync(saved.fileno())
                            os.replace(rollback, destination)
                    raise
        return {"schema": "upstate.chemistry-native-install/v1", "application": str(target),
                "dry_run": dry_run, "changed": changed, "files": len(FILES), "view": "chemistry",
                "report_dependencies": {name: hashlib.sha256(body).hexdigest()
                                        for name, body in shared.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-root")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root, args.dry_run), indent=2))


if __name__ == "__main__":
    main()
