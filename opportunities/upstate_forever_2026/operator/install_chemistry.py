#!/usr/bin/env python3
"""Compose the original reach-chemistry component through the native registry."""
from __future__ import annotations

import argparse
import ast
import fcntl
import hashlib
import json
import os
import stat
from pathlib import Path
import tempfile

FILES = [
    "model/chemistry_study_transfer.py",
    "model/CHEMISTRY_STUDY_TRANSFER.md",
    "source_tools/chemistry_study_composition.py",
    "integration/component_fragments/chemistry_study_transfer.json",
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
    "integration/reach_chemistry/install_chemistry_legacy.py",
    "model/reach_chemistry/OBSERVATIONS.md",
    "operator/CHEMISTRY_COMPOUND_OBSERVATIONS.md",
    "integration/component_fragments/chemistry-compound-observations.json",
    "integration/reach_chemistry/COMPOUND_SOURCE.json",
    "integration/reach_chemistry/SOURCE_MANIFEST.json",
    "source/monitoring-chemistry-study/COMPOUND_SOURCE.json",
    "source/monitoring-chemistry-study/CURRENT_OWNER_DIRECTION.md",
    "source/monitoring-chemistry-study/README.md",
    "source/monitoring-chemistry-study/build_study_workbench.py",
    "source/monitoring-chemistry-study/capture_editable_workspace.py",
    "source/monitoring-chemistry-study/make_study_brief.py",
    "source/monitoring-chemistry-study/open_completed_study.py",
    "source/monitoring-chemistry-study/prepare_budget_study.py",
    "source/monitoring-chemistry-study/presentation_tables.py",
    "source/monitoring-chemistry-study/refresh_report_layout.py",
    "source/monitoring-chemistry-study/reporting.py",
    "source/monitoring-chemistry-study/run_compound_native.py",
    "source/monitoring-chemistry-study/study.html",
    "integration/component_fragments/monitoring-chemistry-study.json"
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

STUDY_PREVIOUS_SHA256 = {
    "operator/install_chemistry.py": "4a2b11d112dbf2447781e72ead1b9173194dfeb195f7ae067d872e14e6a830f7",
    "operator/CHEMISTRY_OPERATOR.md": "6f4c99b4dbe7b7d3022f9d6321bb598437811d27116ff7183c61696293ea0575",
    "integration/component_fragments/chemistry_reports.json": "934c20327454e074f6a7af3c29e65d10e260257bebcc3802b2f8df6146fb1ef6",
    "integration/component_fragments/chemistry_report_sources.json": "6770524f1e908912e82aa2aebcf9538b95dec6b66a7d99be96c8f0cd5b3a4762"
}
COMPOSITE_PREVIOUS_SHA256 = {
    "model/reach_chemistry/reporting.py": "ed2d4bf87ad91f4db6af4ee4f43b485a18c8a92fea45dd55356cdab2269a4947",
    "model/chemistry_report_source.py": "d32ad0b514473dbbbfebaf5df5e415b136613ccd2db31f82ff10bac5dc550e87",
    "model/CHEMISTRY_REPORTS.md": "549adb84f00167d2e2d3892c571126b1fcf3eaa5080b6e370a70227ea4c2555b",
    "model/CHEMISTRY_REPORT_SOURCE.md": "cfeba48f9639d9c3626bdd4256dfdca4701aee6d57b53f02418f612f1e77e578",
    "operator/install_chemistry.py": "a0d95e38263f6a7ad3a2850c1c4fe398125ac05910973165aa830496c2c50f3c"
}

# Exact maintained editions before native 0.3 compound/interval composition.
INTERVAL_PREVIOUS_SHA256 = {
    "model/chemistry.py": "2b18e2beacf8502a153e8165a0b9cd8f609f725511dc263cde75a2f7b4aa8227",
    "model/chemistry_report_source.py": "3d220bf11a90d8b5847d538c0bf7ae46eae5663d2965c6161c341921cb2f7f19",
    "model/CHEMISTRY_REPORT_SOURCE.md": "c6ca14075df5be717572b6dddaeff420c7f78813784214fcaa960a330be5ceeb",
    "model/CHEMISTRY_REPORTS.md": "195b5cc99403f96fb61048c175bfd3ab32ea4a913f85986242d3d45cda6ed99c",
    "model/reach_chemistry/reporting.py": "0fc43c3e115fff7fac4b0c52e13e19456d24175c5d65b8ead2f8be85891e7641",
    "model/reach_chemistry/__init__.py": "a1c644213e39975b64f2e40485cb64ef14bd1b841d49714a33ce3af3767005c9",
    "model/reach_chemistry/inference.py": "d44b9649541a8841466482810796e20497c8f7ed91ac3686b3be1eb75f668e69",
    "model/reach_chemistry/io.py": "936c4931e102d1f565c1d5598a298d097a353db9c5ccc3a922b4f9c57c7c5d10",
    "operator/web/chemistry.mjs": "9e3474fbf3c5ed4dd9a8b0ca5466f56c4e8f22f9be57c195724e8ce865735521",
    "operator/install_chemistry.py": "94b636cc9f27d72b1e09ddd350d15bf163241c82bce7fbc2f77a2712e6874195",
    "integration/component_fragments/chemistry_reports.json": "4b63a1d685ac1dee5165fd90d32b17a213d519077d1aa31d2c3ac11de240dd33"
}
PUBLISHED_INTERVAL_PREVIOUS_SHA256 = {
    "model/reach_chemistry/reporting.py": "a44610ef9f5b6782b1732bf5265cbb81943033d24aa23a4f01183689f6d45d0d",
    "model/chemistry_report_source.py": "c9ee409f00e34a77153a43bcc3566a5b9a81ff4bd446b5f5799161464209495f",
    "operator/web/chemistry.mjs": "ba4cf205bada0325f496bfc9dc903c74c41dc29070870c2a9876b66b52e4fc22",
    "model/CHEMISTRY_REPORTS.md": "549adb84f00167d2e2d3892c571126b1fcf3eaa5080b6e370a70227ea4c2555b",
    "model/CHEMISTRY_REPORT_SOURCE.md": "cfeba48f9639d9c3626bdd4256dfdca4701aee6d57b53f02418f612f1e77e578",
    "operator/install_chemistry.py": "a0d95e38263f6a7ad3a2850c1c4fe398125ac05910973165aa830496c2c50f3c"
}

COMPOSED_INTERVAL_PREVIOUS_SHA256 = {
    "model/chemistry_report_source.py": "5b5940571a3667e4a09fcd1c4459d82316295a8286f6f30a4050409531989bba",
    "operator/install_chemistry.py": "5a9a29b0aaf12b5af6e4f2c34cdedc7f522950e72fb6ac010330b06ef72b9a18",
    "integration/reach_chemistry/COMPOUND_SOURCE.json": "75df65613e75aa3a505a5154ea451f4b88921ce75ffc36561308c42caaca4d4e"
}

LIFETIME_PREVIOUS_SHA256 = {
    "operator/web/chemistry.mjs": "b89bfd259b7546e429be1ac68d3c790ec3913f6d2eec258ee8cf64c93f207ab3",
    "operator/web/chemistry-native.mjs": "941e43e906fbc4d725abe9ac7aa70808eb821fe8e4943123ff94862e73b5be4a",
    "operator/CHEMISTRY_OPERATOR.md": "6dca4cb3728149f889db4301eddbd48e2755f8cda5c96dab97a663acf5574f5c",
    "operator/install_chemistry.py": "d41c4cedb3622b7d6740ff9ac691172262c14a6ac1f93e386ed24ec323ed1fa5",
    "integration/reach_chemistry/COMPOUND_SOURCE.json": "d4af6b37bf397b1f98088ce0ef909eaeb999242e317e3d8af2d9d8b203e29264"
}

SHARED_STUDY_FILES = ("model/study_transfer.py", "model/scientific_report_study_transfer.py")

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

BANK_PREVIOUS_SHA256 = {
    "operator/install_chemistry.py": "94b636cc9f27d72b1e09ddd350d15bf163241c82bce7fbc2f77a2712e6874195",
    "operator/CHEMISTRY_OPERATOR.md": "8a5de6422c30600f34ec83d8c27aa385dd1e27add258b1d0e30ef6a724f50938"
}
BANK_INTERVAL_PREVIOUS_SHA256 = {
    "operator/install_chemistry.py": "5a9a29b0aaf12b5af6e4f2c34cdedc7f522950e72fb6ac010330b06ef72b9a18"
}
REPORT_SELECTION_PREVIOUS_SHA256 = {
    "operator/install_chemistry.py": "916af699e3271bf452d95d958e92cbe92d829dc6e774c5947e82506f783cf631",
    "operator/web/chemistry.mjs": "e0f8d00d07bace633eb81a22830961276b1840dbd0814743059ee91e3e4b64ae",
    "operator/CHEMISTRY_OPERATOR.md": "8a5de6422c30600f34ec83d8c27aa385dd1e27add258b1d0e30ef6a724f50938",
    "operator/CHEMISTRY_COMPOUND_OBSERVATIONS.md": "ba82be927a9fac599a8cf93bb2db57e4efe331228fdbb77ea908d633df766c2d",
    "model/CHEMISTRY_REPORT_SOURCE.md": "cf3f23b24fa0c68735ecc10caf028b2f6e4101888df65b0ba358c9e671fe651d",
    "integration/reach_chemistry/COMPOUND_SOURCE.json": "69f6be7b9e30ef6f76ab6bdbf2163ab1e0325fb6a606c84d359e75155236e65b"
}
STUDY_EDITION_PREVIOUS_SHA256 = {
    "operator/install_chemistry.py": "9f9fbee45a3879a75376e2b1f0b0d628adf944724c4b9346b513d2c118126e9e",
    "model/chemistry_study_transfer.py": "3e6d53d71fa6c1b737a7313704cb2c19cb89a20ec5ce4d254a615d07709b5c8c",
    "model/CHEMISTRY_STUDY_TRANSFER.md": "60d62403f464e36ed02e652eaf3be4d18972ac0625f86df804db4e048f33a923",
    "integration/reach_chemistry/COMPOUND_SOURCE.json": "9e10b404582297988923a69ed0adf86c31b1579dc223a620f9d0585d5a6681dd"
}
RIVER_STUDY_PREVIOUS_SHA256 = {
    "operator/install_chemistry.py": "7c41a00527032a004988b1db9902e63b73f8f11103a7baaf90d294eeed2ecdaf",
    "model/reach_chemistry/reporting.py": "8622c6bbb7c7ff5198f39c78a7710008d920899b02abf9dbafec5d5549cc4c71",
    "model/CHEMISTRY_REPORTS.md": "d0026878dc6e6f32f9f46a95e9fcbb7189e52d6e3277dd9dd722538f4427d8d7",
    "integration/component_fragments/chemistry_reports.json": "67d80aac82ffbc09c150e7714801110f4cc4b75890c824ace39db64783dafca2",
    "integration/reach_chemistry/COMPOUND_SOURCE.json": "1034bcbd9ab358e8c51819bcaddd0f1dc468c1fed4f23abf4f909db4b6308f8c"
}
RIVER_ORIGINAL_STUDY_SHA256 = {
    "source/monitoring-chemistry-study/capture_editable_workspace.py": "4c3bcee34df1c09d76fc49bf789a2e00c28fb2229b68f0c88129b34100ec91de",
    "source/monitoring-chemistry-study/open_completed_study.py": "8c79e271d57912dc7a87d7a5f1c5663b37c5d9d8821a589780410e2b3b031974"
}
SHARED_MONITORING_FILES = [
    "model/common.py",
    "model/workspace.py",
    "model/portable.py",
    "model/monitoring_workspace.py",
    "model/monitoring_campaign.py",
    "model/monitoring_common.py",
    "model/monitoring_sources.py"
]

BANK_SCHEMA = "commons.source-bank/v1"
BANK_LIMIT = 16 * 1024 * 1024


def _plain_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Repeated source-bank JSON field: " + key)
        result[key] = value
    return result


def read_source_bank(path):
    """Read an already-decoded, complete UTF-8 Chemistry source bank."""
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Select the retained regular source-bank JSON file")
    with path.open("rb") as stream:
        data = stream.read(BANK_LIMIT + 1)
    if len(data) > BANK_LIMIT:
        raise ValueError("Chemistry source bank exceeds 16 MiB")
    document = json.loads(data.decode("utf-8"), object_pairs_hook=_plain_object)
    if not isinstance(document, dict) or document.get("schema") != BANK_SCHEMA:
        raise ValueError("Select the complete decoded commons.source-bank/v1 JSON")
    rows = document.get("files")
    if not isinstance(rows, list) or not rows or len(rows) > len(FILES):
        raise ValueError("Source bank must contain the authored Chemistry file members")
    if document.get("repository_prefix", "opportunities/upstate_forever_2026") != "opportunities/upstate_forever_2026":
        raise ValueError("Source bank belongs to a different application prefix")
    members, identities = {}, {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Each source-bank member must be an object")
        name = row.get("path")
        if not isinstance(name, str) or name not in FILES or name in members:
            raise ValueError("Unknown or repeated Chemistry source-bank path: " + str(name))
        if row.get("encoding", "utf-8") != "utf-8" or not isinstance(row.get("content"), str):
            raise ValueError("Source bank requires complete UTF-8 content: " + name)
        body = row["content"].encode("utf-8")
        if type(row.get("bytes")) is not int or row["bytes"] != len(body):
            raise ValueError("Source-bank byte length differs: " + name)
        digest = hashlib.sha256(body).hexdigest()
        if row.get("sha256") != digest:
            raise ValueError("Source-bank SHA-256 differs: " + name)
        mode = row.get("mode")
        if mode not in ("100644", "100755"):
            raise ValueError("Source-bank member needs its original regular-file mode: " + name)
        members[name] = (body, int(mode[-3:], 8))
        identities[name] = {"bytes": len(body), "sha256": digest, "mode": mode}
    receiver = "operator/install_chemistry.py"
    if receiver not in members or members[receiver][0] != Path(__file__).read_bytes():
        raise ValueError("Run the exact operator/install_chemistry.py retained in this source bank; "
                         "a historical bank cannot replace a newer executing receiver")
    return members, {
        "schema": BANK_SCHEMA, "path": str(path.absolute()), "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(), "edition": document.get("edition"),
        "provided": identities,
    }


def _snapshot(root, name, *, required=False):
    """Retain one ordinary member, rejecting aliased parents and special files."""
    path = root
    parts = Path(name).parts
    if not parts or Path(name).is_absolute() or ".." in parts:
        raise ValueError("Choose an application-relative member")
    for index, part in enumerate(parts):
        path = path / part
        if path.is_symlink():
            raise ValueError("Application member contains a symbolic link: " + name)
        if path.exists() and index < len(parts) - 1 and not path.is_dir():
            raise ValueError("Application member parent is not a directory: " + name)
    if not path.exists():
        if required:
            raise ValueError("Complete reach-chemistry source is missing: " + name)
        return None
    before = path.stat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("Application member is not a regular file: " + name)
    body = path.read_bytes()
    after = path.stat()
    fingerprint = lambda value: (value.st_dev, value.st_ino, value.st_size,
                                 value.st_mtime_ns, value.st_ctime_ns, value.st_mode)
    if fingerprint(before) != fingerprint(after) or len(body) != after.st_size:
        raise RuntimeError("Application source changed while reading: " + name)
    return body, stat.S_IMODE(after.st_mode)


def _validate_body(name, body):
    if name.endswith(".py"):
        ast.parse(body, filename=name)
    elif name.endswith(".json"):
        json.loads(body)


def install(application, source_root=None, dry_run=False, *, source_bank=None):
    if source_root is not None and source_bank is not None:
        raise ValueError("Choose either --source-root or --source-bank")
    target = Path(application).resolve(strict=True)
    bank, source_receipt = read_source_bank(source_bank) if source_bank is not None else (None, None)
    source = target if bank is not None else Path(
        source_root or Path(__file__).resolve().parents[1]).resolve(strict=True)
    if not (target / "model/workspace.py").is_file() or not (target / "operator/extension_registry.py").is_file():
        raise ValueError("Select the maintained scientific application with its original extension registry")
    lock = target / ".locks/extension-install.lock"
    if lock.parent.is_symlink() or lock.is_symlink():
        raise ValueError("Application extension lock contains a symbolic link")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        pending, preimages, shared, inherited = {}, {}, {}, {}
        for name in [*SHARED_REPORT_FILES, *SHARED_STUDY_FILES, *SHARED_MONITORING_FILES]:
            shared[name] = _snapshot(target, name, required=True)
        for name in FILES:
            current = _snapshot(target, name)
            if bank is None:
                selected = _snapshot(source, name, required=True)
            elif name in bank:
                selected = bank[name]
            else:
                if current is None:
                    raise ValueError("Source bank omits a required file absent from the installed application: " + name)
                selected = current
                inherited[name] = current
            body, mode = selected
            _validate_body(name, body)
            if (current is not None and current[0] != body
                    and hashlib.sha256(current[0]).hexdigest() not in
                    {ORIGINAL_SHA256.get(name), PREVIOUS_NATIVE_SHA256.get(name),
                     REPORT_PREVIOUS_SHA256.get(name), SOURCE_PREVIOUS_SHA256.get(name),
                     STUDY_PREVIOUS_SHA256.get(name), COMPOSITE_PREVIOUS_SHA256.get(name),
                     BANK_PREVIOUS_SHA256.get(name), INTERVAL_PREVIOUS_SHA256.get(name),
                     PUBLISHED_INTERVAL_PREVIOUS_SHA256.get(name), COMPOSED_INTERVAL_PREVIOUS_SHA256.get(name),
                     BANK_INTERVAL_PREVIOUS_SHA256.get(name), REPORT_SELECTION_PREVIOUS_SHA256.get(name),
                     STUDY_EDITION_PREVIOUS_SHA256.get(name), LIFETIME_PREVIOUS_SHA256.get(name),
                     RIVER_STUDY_PREVIOUS_SHA256.get(name), RIVER_ORIGINAL_STUDY_SHA256.get(name)}):
                raise ValueError("Reconcile the independently changed chemistry file: " + name)
            pending[name], preimages[name] = (body, mode), current
        composer = "source_tools/chemistry_study_composition.py"
        namespace = {"__name__": "_chemistry_study_composition", "__file__": str(source / composer)}
        exec(compile(pending[composer][0], composer, "exec"), namespace)
        joined = namespace["compose"]({name: shared[name][0].decode("utf-8")
                                       for name in SHARED_STUDY_FILES})
        if set(joined) != set(SHARED_STUDY_FILES):
            raise ValueError("Chemistry Study composer must preserve its exact shared member set")
        for name, body in joined.items():
            ast.parse(body, filename=name)
            pending[name], preimages[name] = (body.encode("utf-8"), shared[name][1]), shared[name]
        descriptor = json.loads(pending["operator/extensions/chemistry.json"][0])
        if (descriptor.get("schema") != "upstate.operator-extension/v1"
                or descriptor.get("id") != "chemistry"
                or descriptor["backend"]["factory"]["name"] != "ChemistryOperations"):
            raise ValueError("Select the original native chemistry registration")
        changed = [name for name in pending if pending[name] != preimages[name]]

        def recheck():
            # Include unchanged/inherited engines, not only outgoing changed members.
            for name, before in {**shared, **preimages}.items():
                if _snapshot(target, name) != before:
                    raise RuntimeError("Concurrent application source change: " + name)

        recheck()
        if not dry_run:
            with tempfile.TemporaryDirectory(prefix=".chemistry-install-", dir=target.parent) as temporary:
                stage = Path(temporary)
                for name in changed:
                    path = stage / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    body, mode = pending[name]
                    path.write_bytes(body)
                    path.chmod(mode)
                recheck()
                committed = []
                try:
                    for name in changed:
                        destination = target / name
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        if _snapshot(target, name) != preimages[name]:
                            raise RuntimeError("Concurrent application source change: " + name)
                        os.replace(stage / name, destination)
                        committed.append(name)
                    # Retained engines and shared rendering dependencies must still match.
                    for name, before in {**shared, **preimages}.items():
                        expected = pending[name] if name in committed else before
                        if _snapshot(target, name) != expected:
                            raise RuntimeError("Concurrent application source change: " + name)
                except BaseException as failure:
                    rollback_conflicts = []
                    for name in reversed(committed):
                        destination = target / name
                        try:
                            actual = _snapshot(target, name)
                        except (OSError, ValueError, RuntimeError):
                            rollback_conflicts.append(name)
                            continue
                        if actual != pending[name]:
                            rollback_conflicts.append(name)
                            continue
                        previous = preimages[name]
                        if previous is None:
                            destination.unlink(missing_ok=True)
                        else:
                            body, mode = previous
                            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as saved:
                                rollback = Path(saved.name)
                                saved.write(body)
                                saved.flush()
                                os.fsync(saved.fileno())
                                os.fchmod(saved.fileno(), mode)
                            os.replace(rollback, destination)
                    if rollback_conflicts:
                        raise RuntimeError("Preserved independently edited installed files during rollback: "
                                           + ", ".join(rollback_conflicts)) from failure
                    raise
        if source_receipt is not None:
            source_receipt["inherited"] = {
                name: {"bytes": len(value[0]), "sha256": hashlib.sha256(value[0]).hexdigest(),
                       "mode": oct(stat.S_IFREG | value[1])[2:]}
                for name, value in inherited.items()}
        return {"schema": "upstate.chemistry-native-install/v1", "application": str(target),
                "dry_run": dry_run, "changed": changed, "files": len(pending), "view": "chemistry",
                "source_bank": source_receipt,
                "report_dependencies": {name: hashlib.sha256(value[0]).hexdigest()
                                        for name, value in shared.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--source-root")
    source.add_argument("--source-bank")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root, args.dry_run,
                             source_bank=args.source_bank), indent=2))


if __name__ == "__main__":
    main()
