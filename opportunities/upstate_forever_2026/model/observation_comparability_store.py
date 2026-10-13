"""Retained original-cohort comparisons in the existing scientific Workspace.

The maintained observation_comparability producer owns every numerical result.
This module binds original input editions, saved choices and complete receiving.
"""
from __future__ import annotations
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

from measurement_workspace import observation_comparability as calculation
from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, read_json, relative_file, verify_file)
from . import observed_context

KIND = "observation-comparability-selections"
SCHEMA = "upstate.observation-comparability-selection/v1"
EDITION = "original-cohort-comparison/1"
APPLICATION = Path(__file__).resolve().parent.parent


def _require(value, message):
    if not value:
        raise ValueError(message)


def _producers():
    return {name: file_digest(path) for name, path in {
        "store": Path(__file__),
        "calculation": Path(calculation.__file__),
        "desk": Path(calculation.__file__).with_suffix(".html"),
    }.items()}


def _choice(value):
    _require(isinstance(value, dict), "Choose one original cohort source")
    if value.get("kind") == "installed":
        _require(set(value) == {"kind", "index_sha256"},
                 "Choose the installed original index without additional source fields")
        identifier(value["index_sha256"])
    else:
        _require(set(value) == {"kind", "source_collection_id", "source_id", "source_sha256"}
                 and value.get("kind") == "retained", "Choose the complete retained cohort source")
        identifier(value["source_collection_id"])
        identifier(value["source_sha256"])
        _require(isinstance(value["source_id"], str) and value["source_id"],
                 "Choose the original source identifier")
    return dict(value)


def _load(workspace, value):
    choice = _choice(value)
    if choice["kind"] == "installed":
        original_root, index_name = APPLICATION, calculation.INDEX
        index = calculation.member(original_root, index_name)
        _require(file_digest(index) == choice["index_sha256"],
                 "The installed original index changed; choose its current edition")
        prior_data, original_title, source_prefix = None, None, None
    else:
        recipe_path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        _require(entry.get("metadata", {}).get("source_kind") == calculation.SCHEMA
                 and entry["body"]["sha256"] == choice["source_sha256"],
                 "The retained entry is not this original comparable-period source")
        recipe = read_json(recipe_path)
        _require(recipe.get("schema") == observed_context.SCHEMA,
                 "The original comparison recipe has a different schema")
        view = recipe_path.parent
        companion_map = {item.get("view_path", item["filename"]): item
                         for item in entry.get("companions", [])}
        _require(len(companion_map) == len(entry.get("companions", []))
                 and "comparability.json" in companion_map,
                 "Retain the complete original comparison data and source companions")
        prior_data = read_json(verify_file(view, {
            **companion_map["comparability.json"], "path": "comparability.json"}))
        _require(prior_data.get("schema") == calculation.SCHEMA,
                 "The retained comparison data has a different original schema")
        for item in prior_data.get("original_inputs", []):
            kept = companion_map.get(item["path"])
            _require(kept is not None and all(kept[k] == item[k] for k in ("bytes", "sha256")),
                     "An original cohort input differs from its retained companion")
            verify_file(view, item)
        _require(prior_data.get("original_inputs"), "Retain every original cohort input")
        original_root = view / "originals"
        presentation = prior_data.get("presentation", {})
        index_name = presentation.get("index_path", calculation.INDEX)
        original_title = recipe.get("title")
        source_prefix = presentation.get("source_prefix")
    rows, names = calculation.load_index(original_root, index_name)
    if prior_data is not None:
        _require(rows == prior_data.get("original_rows"),
                 "The retained index rows differ from the original comparison source")
        retained = {item["path"]: item for item in prior_data["original_inputs"]}
        _require(set(retained) == {"originals/" + name for name in names},
                 "The original index and full publisher response inventory differ")
        for name in names:
            item = calculation.identity(calculation.member(original_root, name))
            kept = retained["originals/" + name]
            _require(all(item[k] == kept[k] for k in ("bytes", "sha256")),
                     "The original publisher response differs from its selected edition")
    originals = [calculation.identity(calculation.member(original_root, name), original_root)
                 for name in names]
    binding = {"source": choice, "index_path": index_name, "originals": originals,
               "source_edition_id": prior_data.get("edition_id") if prior_data else None}
    data = calculation.build(rows)
    defaults = dict(prior_data.get("default_comparison", {})) if prior_data else {}
    years = data["years"]
    if defaults.get("year_a") not in years or defaults.get("year_b") not in years:
        defaults = {"year_a": years[-2] if len(years) > 1 else None, "year_b": years[-1]}
    presentation = calculation.presentation(data, index_name, title=original_title, source_prefix=source_prefix)
    return {"root": original_root, "index_path": index_name, "binding": binding,
            "data": data, "defaults": defaults, "presentation": presentation}


def catalog(workspace):
    sources = []
    path = APPLICATION / calculation.INDEX
    if path.is_file():
        sources.append({"choice": {"kind": "installed", "index_sha256": file_digest(path)},
                        "title": "Installed original SV-833 observation cohort",
                        "vintage": "Original retained index and publisher responses"})
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry.get("metadata", {}).get("source_kind") == calculation.SCHEMA:
                sources.append({
                    "choice": {"kind": "retained", "source_collection_id": collection["id"],
                               "source_id": entry["id"], "source_sha256": entry["body"]["sha256"]},
                    "title": entry["title"], "vintage": entry.get("vintage", "")})
    return {"sources": sources, "selections": overview(workspace)}


def _source_origin(workspace, source):
    """Read source provenance without changing the immutable saved binding."""
    choice = _choice(source)
    if choice["kind"] == "installed":
        return None
    _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    _require(entry["body"]["sha256"] == choice["source_sha256"],
             "The original cohort source changed its retained edition")
    # Imported here because the Study helper also verifies this store's receipts.
    from .observation_comparability_study_transfer import origin
    native = origin(entry)
    return {"source": choice, "title": entry["title"], "native_origin": native,
            "relationship": ("same_project" if native["project_id"] == workspace.project["id"]
                             else "external_project") if native else "source_only"}


def inputs(workspace, source):
    value = _load(workspace, source)
    return {"source": value["binding"]["source"], "binding": value["binding"],
            "data": value["data"], "defaults": value["defaults"],
            "presentation": value["presentation"], "binding_sha256": digest(value["binding"]),
            "producers": _producers(), "source_origin": _source_origin(workspace, source)}


def _selection(value, loaded):
    _require(isinstance(value, dict) and set(value) == {"source", "year_a", "year_b", "title", "binding_sha256", "producers"},
             "Choose an original source, two years and a report title")
    _require(_choice(value["source"]) == loaded["binding"]["source"], "The cohort source changed")
    a, b = value["year_a"], value["year_b"]
    _require(type(a) is int and type(b) is int and a < b
             and a in loaded["data"]["years"] and b in loaded["data"]["years"],
             "Choose an earlier and later year present in the original cohort")
    title = value["title"]
    _require(isinstance(title, str) and 0 < len(title.strip()) <= 300,
             "Use a nonempty comparison title of at most 300 characters")
    _require(value["binding_sha256"] == digest(loaded["binding"]),
             "The original cohort binding changed; reopen the current source selection")
    _require(isinstance(value["producers"], dict) and set(value["producers"]) == {"store", "calculation", "desk"},
             "Retain the selected comparison producer edition")
    for checksum in value["producers"].values():
        identifier(checksum)
    return {"source": dict(value["source"]), "year_a": a, "year_b": b, "title": title.strip(),
            "binding_sha256": value["binding_sha256"], "producers": dict(value["producers"])}


def _files(directory):
    return {p.relative_to(directory).as_posix(): describe_file(directory, p)
            for p in sorted(directory.rglob("*")) if p.is_file()}


def _source_receipt(workspace, key, directory, planned):
    for item in planned["files"].values():
        verify_file(directory, item)
    manifest = directory / "source" / "model-sources.json"
    collection = workspace.import_sources(manifest)
    entry = collection["entries"][0]
    source = {"source_collection_id": collection["id"], "source_id": entry["id"]}
    binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: source}})
    _require(binding is not None, "The saved comparison has no native scientific-report binding")
    files = {name: describe_file(workspace.root, directory / row["path"])
             for name, row in planned["files"].items()}
    receipt = {"schema": SCHEMA, "id": key, "state": "complete",
               "project_id": workspace.project["id"], "identity": planned["identity"],
               "selection": planned["identity"]["selection"],
               "title": planned["identity"]["selection"]["title"],
               "source": source, "observed_binding": binding,
               "counts": planned["counts"], "files": files}
    atomic_json(directory / "receipt.json", receipt, immutable=True)
    return receipt


def build(workspace, value):
    loaded = _load(workspace, value.get("source") if isinstance(value, dict) else None)
    selection = _selection(value, loaded)
    identity = {"edition": EDITION, "project_id": workspace.project["id"],
                "selection": selection, "binding": loaded["binding"], "producers": selection["producers"]}
    key = digest(identity)
    parent = workspace.root / KIND
    parent.mkdir(parents=True, exist_ok=True)
    directory = parent / key
    with held(parent / (key + ".lock"), blocking=False):
        if (directory / "receipt.json").is_file():
            return inspect(workspace, key)["edition"]
        if directory.exists():
            planned = read_json(directory / "build.json")
            _require(planned.get("identity") == identity, "Continue the exact original saved comparison")
            return _source_receipt(workspace, key, directory, planned)
        _require(_producers() == identity["producers"],
                 "The selected comparison producer changed; reopen the current edition before a new generation")
        pending = Path(tempfile.mkdtemp(prefix=".intake-", dir=parent))
        try:
            output = pending / "source"
            calculation.write(loaded["root"], output, index_name=loaded["index_path"],
                              year_a=selection["year_a"], year_b=selection["year_b"],
                              title=selection["title"], source_prefix=loaded["presentation"]["source_prefix"])
            _require(_producers() == identity["producers"],
                     "The installed comparison source changed during generation")
            generated = read_json(output / "comparability.json")
            _require(generated["original_rows"] == loaded["data"]["original_rows"],
                     "The generated source changed the selected original measurement rows")
            generated_inputs = [{**item, "path": item["path"][len("originals/"):]}
                                for item in generated["original_inputs"]
                                if item["path"].startswith("originals/")]
            _require(len(generated_inputs) == len(generated["original_inputs"])
                     and generated_inputs == identity["binding"]["originals"],
                     "The generated source changed an original publisher response or companion edition")
            # Bind the native editor edition in its source manifest before any
            # complete ZIP/build/import publication. Existing saved editions keep
            # their original manifest and source collection unchanged.
            manifest_path = output / "model-sources.json"
            manifest = read_json(manifest_path)
            _require(manifest.get("schema") == "upstate.sources/v1"
                     and len(manifest.get("entries", [])) == 1,
                     "Retain the original single-source comparison manifest")
            manifest["entries"][0].setdefault("metadata", {})["native_comparability"] = {
                "schema": "upstate.observation-comparability-origin/v1",
                "project_id": workspace.project["id"], "selection_id": key}
            atomic_json(manifest_path, manifest)
            # Retain complete source and operating instructions with the original outputs.
            shutil.copyfile(__file__, output / "producer" / "observation_comparability_store.py")
            guide = Path(calculation.__file__).with_name("OBSERVATION_COMPARABILITY.md")
            if guide.is_file():
                shutil.copyfile(guide, output / "OBSERVATION_COMPARABILITY.md")
            package = pending / "comparable-period-source.zip"
            with zipfile.ZipFile(package, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for path in sorted(output.rglob("*")):
                    if path.is_file():
                        archive.write(path, path.relative_to(output).as_posix())
            planned = {"identity": identity, "counts": generated["counts"], "files": _files(pending)}
            atomic_json(pending / "build.json", planned, immutable=True)
            _require(not directory.exists(), "The original comparison destination appeared during generation")
            os.rename(pending, directory)
            pending = None
            return _source_receipt(workspace, key, directory, planned)
        finally:
            if pending is not None:
                shutil.rmtree(pending)


def _receipt(workspace, path):
    value = read_json(path)
    _require(value.get("schema") == SCHEMA and value.get("state") == "complete"
             and value.get("project_id") == workspace.project["id"]
             and value.get("id") == path.parent.name == digest(value.get("identity"))
             and value.get("selection") == value["identity"].get("selection")
             and value.get("title") == value["selection"].get("title"),
             "The saved comparison identity differs from its original source selection")
    return value


def overview(workspace):
    return [{key: value[key] for key in ("id", "title", "selection", "counts", "source")}
            for value in (_receipt(workspace, path)
                          for path in sorted((workspace.root / KIND).glob("*/receipt.json")))]


def inspect(workspace, key):
    directory = workspace.root / KIND / identifier(key)
    receipt = _receipt(workspace, directory / "receipt.json")
    for item in receipt["files"].values():
        verify_file(workspace.root, item)
    data = read_json(verify_file(workspace.root, receipt["files"]["source/comparability.json"]))
    selection = receipt["selection"]
    _require(data.get("schema") == calculation.SCHEMA and data.get("counts") == receipt["counts"]
             and data.get("default_comparison") == {"year_a": selection["year_a"], "year_b": selection["year_b"]}
             and data.get("presentation", {}).get("title") == selection["title"],
             "The saved data differ from the original selected comparison")
    recipe_path, entry = workspace.source_file(receipt["source"]["source_collection_id"], receipt["source"]["source_id"])
    descriptor = receipt["files"]["source/observed-report.json"]
    _require(all(entry["body"][name] == descriptor[name] for name in ("bytes", "sha256")),
             "The retained scientific source changed its original recipe")
    recipe = read_json(recipe_path)
    _require(recipe.get("schema") == observed_context.SCHEMA,
             "The saved report recipe schema differs")
    declared = {item["path"]: item for item in recipe["inputs"]}
    companions = {item.get("view_path", item["filename"]): item for item in entry.get("companions", [])}
    _require(len(companions) == len(entry.get("companions", [])) and set(companions) == set(declared),
             "The retained scientific source companion inventory differs")
    for path, descriptor in declared.items():
        _require(all(companions[path][name] == descriptor[name] for name in ("bytes", "sha256")),
                 "A retained scientific source companion changed")
    current = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: receipt["source"]}})
    # The collector implementation tag can advance without changing any
    # selected source byte. Preserve its captured value in the saved receipt.
    captured = receipt["observed_binding"]
    _require(current is not None and
             {k: v for k, v in current.items() if k != "edition"} ==
             {k: v for k, v in captured.items() if k != "edition"},
             "The native report source binding changed")
    return {"edition": receipt, "data": data,
            "source_origin": _source_origin(workspace, selection["source"])}


def verify_all(workspace):
    for value in overview(workspace):
        inspect(workspace, value["id"])
