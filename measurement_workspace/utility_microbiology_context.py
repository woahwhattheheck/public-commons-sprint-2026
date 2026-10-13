"""Retain the maintained microbial temporal explorer in a Published studies source.

The author's analysis, HTML, recipe and original inputs remain byte-identical.
A separate observed-report recipe binds paths to the published study source view.
This module reads source and returns bytes; it does not execute the analysis.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath

SOURCE_DIRECTORY = "source/ecoli_temporal_analysis/20261013"
SOURCE_MANIFEST = "microbial_temporal_observed_report.sources.json"
CONTEXT_PREFIX = "application-context/microbial"
REPORT_SOURCE = SOURCE_DIRECTORY + "/index.html"
FIGURE_GALLERY_SOURCE = SOURCE_DIRECTORY + "/publication-figures.html"
RECIPE_SOURCE = SOURCE_DIRECTORY + "/observed-report.json"
REPORT_PATH = CONTEXT_PREFIX + "/" + REPORT_SOURCE
BOUND_RECIPE_PATH = CONTEXT_PREFIX + "/published-study-observed-report.json"
OBSERVED_SCHEMA = "upstate.observed-report/v1"
ORIGINAL_ANALYSIS_COMMIT = "b44910ba39d668e778bf34a0a19f5bd02b0b00da"
ORIGINAL_MANIFEST_SHA256 = "e044c8bad2693b34c3f5912ff1f360d7a2da594b92504fc2ec6ac2f69573f391"
ORIGINAL_FILES = {
    "README.md": (10529, "1d9aacdfaf9102ffd2d155a10ff48a6f51e82095"),
    "analysis-summary.json": (8450, "e23ae2d303ffa689cfef0afdb95415b35df627a6"),
    "analysis.mjs": (20084, "6327f6df6c47668fb9e9bc0c7149434373f5892e"),
    "annual-sampling-coverage.csv": (206, "6af58e993b5991213cc8db0a2815915c560de740"),
    "comment-sensitivity.csv": (13752, "07e331c6e3bdf7295b299f349f89640d279f606b"),
    "field-replicates.csv": (708, "da8787d098f952bf8cc613fbd0549275cbc00bdb"),
    "flagged-source-comments.csv": (28893, "79e07f0f8bce50a6c332a851dba21b5203bab763"),
    "flow-daily-2022.csv": (21567, "0e0a421a99cd3b8a4851702517652decd6b3fdad"),
    "flow-sample-join.csv": (7536, "d27636bf0753e1732720340fbe8e3a5944077d0b"),
    "record-intervals.csv": (227126, "9619f7a0f2aa222c7462ac724cb7e2556b187294"),
    "reproduce.mjs": (2314, "47b73e496d9f1b017a3cf16b16c89b34203b0fc4"),
    "source-manifest.json": (9294, "20eab79a8d48a618af7d58494cee07d047b00f5d"),
    "station-month-summary.csv": (122016, "1d3153e783f5ffbb90b0d5b3560544832cea9896"),
    "station-season-summary.csv": (48144, "d6e2c6160d7ec2c92271b373cf796cf241326087"),
    "station-summary.csv": (13740, "ff644ec9e84cb78db9c1a4181047dcc3986f8043"),
    "station-year-summary.csv": (30692, "ef16a151e0d440d721755086b38bc7cee988fcab"),
}
EXPLORER_FILES = (
    "explorer.mjs", "build-explorer.mjs", "index.html",
    "EXPLORER.md", "observed-report.json",
)


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Microbial context requires portable relative source paths")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or path.as_posix() != value or value == ".":
        raise ValueError("Microbial context source leaves its application: " + value)
    return value


def _application(application):
    path = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    path = path.expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError("Choose the complete installed application directory")
    return path


def _descriptor(name, body):
    return {"path": name, "bytes": len(body), "sha256": _sha(body)}


def _check_descriptor(name, body, descriptor):
    if descriptor.get("bytes", len(body)) != len(body):
        raise ValueError("Microbial context source length differs: " + name)
    if descriptor.get("sha256", _sha(body)) != _sha(body):
        raise ValueError("Microbial context source SHA256 differs: " + name)


def _read_source(application):
    application = _application(application)
    files = {}

    def read(name, descriptor=None):
        name = _relative(name)
        if name not in files:
            path = (application / name).resolve(strict=True)
            if not path.is_relative_to(application) or not path.is_file():
                raise ValueError("Microbial context source leaves its application: " + name)
            files[name] = path.read_bytes()
        if descriptor is not None:
            _check_descriptor(name, files[name], descriptor)
        return files[name]

    manifest_body = read(SOURCE_MANIFEST)
    manifest = json.loads(manifest_body)
    if manifest.get("schema") != "upstate.sources/v1" or not isinstance(manifest.get("entries"), list):
        raise ValueError("Retain the maintained microbial temporal upstate.sources/v1 manifest")
    entries, by_path, ids = [], {}, set()
    for source in manifest["entries"]:
        if not isinstance(source, dict) or not isinstance(source.get("id"), str) or not source["id"] or source["id"] in ids:
            raise ValueError("Microbial temporal manifest needs distinct source entry IDs")
        ids.add(source["id"])
        if not all(source.get(key) for key in ("uri", "vintage", "title")):
            raise ValueError("Microbial temporal sources need their original URI, vintage and title")
        companions = source.get("companions", [])
        if not isinstance(companions, list):
            raise ValueError("Microbial temporal source companions must be a list")
        names = []
        for member in [source, *companions]:
            if not isinstance(member, dict):
                raise ValueError("Microbial temporal source members must be objects")
            name = _relative(member.get("path"))
            if name in names:
                raise ValueError("Microbial temporal source entry repeats a member: " + name)
            names.append(name)
            read(name, member)
        entries.append(source)
        by_path.setdefault(source["path"], []).append(source)

    # The 16-file analytical edition is unchanged by the additive explorer.
    for name, (size, blob) in ORIGINAL_FILES.items():
        path = SOURCE_DIRECTORY + "/" + name
        body = read(path)
        git_body = b"blob " + str(len(body)).encode("ascii") + b"\0" + body
        if len(body) != size or hashlib.sha1(git_body).hexdigest() != blob:
            raise ValueError("Retain the original PR3148 analytical source unchanged: " + path)
    original_name = SOURCE_DIRECTORY + "/source-manifest.json"
    original_body = read(original_name)
    if _sha(original_body) != ORIGINAL_MANIFEST_SHA256:
        raise ValueError("Original microbial temporal source manifest differs")
    original = json.loads(original_body)
    if original.get("schema") != "upstate.microbial-temporal-sources/v1":
        raise ValueError("Retain the original microbial temporal source contract")
    if not isinstance(original.get("inputs"), list) or len(original["inputs"]) != 3:
        raise ValueError("Retain all three original microbial temporal inputs")
    input_paths = []
    for item in original["inputs"]:
        raw = item.get("path")
        if not isinstance(raw, str) or not raw or "\\" in raw or "\0" in raw or PurePosixPath(raw).is_absolute():
            raise ValueError("Original temporal input must resolve inside the application")
        name = _relative(posixpath.normpath(posixpath.join(SOURCE_DIRECTORY, raw)))
        if item.get("repository_path") != "opportunities/upstate_forever_2026/" + name:
            raise ValueError("Original temporal input path and repository identity differ: " + name)
        if not isinstance(item.get("sha256"), str) or len(item["sha256"]) != 64 or not isinstance(item.get("bytes"), int):
            raise ValueError("Original temporal input requires its exact length and SHA256")
        read(name, item)
        input_paths.append(name)
    for name, descriptor in original["outputs"].items():
        read(SOURCE_DIRECTORY + "/" + _relative(name), descriptor)
    for name in EXPLORER_FILES:
        read(SOURCE_DIRECTORY + "/" + name)

    recipe_entries = [row for row in by_path.get(RECIPE_SOURCE, []) if row.get("kind") == "document"]
    if len(recipe_entries) != 1:
        raise ValueError("The temporal manifest must declare one observed-report recipe document")
    recipe_entry = recipe_entries[0]
    if len(by_path.get(REPORT_SOURCE, [])) > 1:
        raise ValueError("The temporal manifest repeats its maintained HTML report")
    html_entries = by_path.get(REPORT_SOURCE, [])
    if html_entries and html_entries[0].get("kind") != "document":
        raise ValueError("The temporal HTML report must be a document source")
    recipe = json.loads(read(RECIPE_SOURCE))
    if recipe.get("schema") != OBSERVED_SCHEMA:
        raise ValueError("Retain the author's upstate.observed-report/v1 recipe")
    # The native importer takes the common parent of an entry and its companions.
    # Reproduce its actual view-path map rather than inferring recipe-relative paths.
    members = [recipe_entry, *recipe_entry.get("companions", [])]
    common = posixpath.commonpath([posixpath.dirname(item["path"]) or "." for item in members])
    views = {}
    for item in members:
        name = item["path"]
        view = posixpath.relpath(name, common or ".")
        view = _relative(view)
        if view in views:
            raise ValueError("The temporal recipe has colliding native view paths: " + view)
        views[view] = name
    return files, manifest, recipe, recipe_entry, (html_entries[0] if html_entries else None), views, input_paths


def _bind_recipe(recipe, views, originals):
    bound = copy.deepcopy(recipe)

    def path(value):
        name = _relative(value)
        if name not in views:
            raise ValueError("The observed recipe references an unretained original source view: " + name)
        source_name = views[name]
        if source_name not in originals:
            raise ValueError("The observed recipe source body is absent: " + source_name)
        return CONTEXT_PREFIX + "/" + source_name

    inputs = bound.get("inputs", [])
    if not isinstance(inputs, list):
        raise ValueError("The observed recipe inputs must be a list")
    for item in inputs:
        if not isinstance(item, dict):
            raise ValueError("The observed recipe input must retain its source descriptor")
        original_path = _relative(item.get("path"))
        destination = path(original_path)
        if not isinstance(item.get("sha256"), str) or len(item["sha256"]) != 64 or not isinstance(item.get("bytes"), int):
            raise ValueError("The observed recipe input needs its original length and SHA256")
        _check_descriptor(views[original_path], originals[views[original_path]], item)
        item["path"] = destination

    sections = bound.get("sections")
    if not isinstance(sections, list):
        raise ValueError("The observed recipe must retain its author's sections")
    for section in sections:
        if not isinstance(section, list) or len(section) != 2 or not isinstance(section[1], list):
            raise ValueError("The observed recipe section must be a heading and block list")
        for block in section[1]:
            if isinstance(block, dict) and block.get("kind") == "links":
                if not isinstance(block.get("items"), list):
                    raise ValueError("Observed recipe links must be a list")
                for item in block["items"]:
                    item["path"] = path(item.get("path"))
    links = bound.get("source_links", [])
    if not isinstance(links, list):
        raise ValueError("The observed recipe source links must be a list")
    bound["source_links"] = [path(item) for item in links]
    if bound.get("figures"):
        bound["figure_spec"] = path(bound.get("figure_spec"))
        for item in bound["figures"]:
            item["path"] = path(item.get("path"))

    original_path = CONTEXT_PREFIX + "/" + RECIPE_SOURCE
    binding = {
        "schema": "upstate.published-study-observed-recipe-binding/v1",
        "operation": "Prefix original source view paths for the retained Published studies source",
        "original_recipe": _descriptor(original_path, originals[RECIPE_SOURCE]),
        "original_source_manifest": _descriptor(CONTEXT_PREFIX + "/" + SOURCE_MANIFEST, originals[SOURCE_MANIFEST]),
        "source_view_prefix": CONTEXT_PREFIX,
        "path_mapping": {name: CONTEXT_PREFIX + "/" + original for name, original in sorted(views.items())},
        "preserved_content": "Author's sections, quantities, interpretation, analytical outputs and original recipe bytes",
    }
    if "published_study_binding" in bound:
        raise ValueError("The original observed recipe is already a derived study binding")
    bound["published_study_binding"] = binding
    return bound, binding


def load_companion(application=None):
    """Return verified files, both document entries and original installer paths.

    The files keys are relative to the Published studies source directory.
    report_entry is the unchanged HTML document; recipe_entry is the
    separately derived observed-report JSON. An original figure gallery, when
    supplied, is a third explicit document. Each carries the full companion
    closure. The caller includes both in its normal model-sources.json;
    PublishedStudyStore retains that root manifest as additional context, which
    anchors the returned application-context/microbial/ view paths.
    """
    originals, manifest, recipe, recipe_entry, html_entry, views, inputs = _read_source(application)
    files = {CONTEXT_PREFIX + "/" + name: body for name, body in originals.items()}
    if BOUND_RECIPE_PATH in files:
        raise ValueError("A source file collides with the derived observed recipe")
    bound, provenance = _bind_recipe(recipe, views, originals)
    files[BOUND_RECIPE_PATH] = _json(bound)
    descriptors = [_descriptor(name, body) for name, body in sorted(files.items())]

    native = copy.deepcopy(recipe_entry)
    native.update({
        "id": "utility-microbial-temporal-published-report",
        "kind": "document",
        "path": BOUND_RECIPE_PATH,
        "bytes": len(files[BOUND_RECIPE_PATH]),
        "sha256": _sha(files[BOUND_RECIPE_PATH]),
        "report_schema": OBSERVED_SCHEMA,
        "metadata": {**recipe_entry.get("metadata", {}), "report_schema": OBSERVED_SCHEMA},
        "source_role": "OBSERVED_CONTEXT",
        "original_recipe": provenance["original_recipe"],
        "published_study_binding": provenance,
        "companions": [item for item in descriptors if item["path"] != BOUND_RECIPE_PATH],
    })
    html = copy.deepcopy(html_entry) if html_entry is not None else {
        key: recipe_entry[key] for key in ("uri", "vintage", "title")
    }
    html.update({
        "id": "utility-microbial-temporal-explorer",
        "kind": "document",
        "title": (html_entry or {}).get("title") or "Original utility E. coli temporal and flow explorer",
        "path": REPORT_PATH,
        "bytes": len(files[REPORT_PATH]),
        "sha256": _sha(files[REPORT_PATH]),
        "companions": [item for item in descriptors if item["path"] != REPORT_PATH],
    })
    # A generic document registration has no companions. Register the original
    # gallery explicitly so its relative vector/source downloads also work when
    # that single document is opened or exported from the source catalogue.
    gallery = None
    gallery_path = None
    if FIGURE_GALLERY_SOURCE in originals:
        gallery_path = CONTEXT_PREFIX + "/" + FIGURE_GALLERY_SOURCE
        gallery = {
            **{key: recipe_entry[key] for key in ("uri", "vintage")},
            "id": "utility-microbial-scientific-figure-gallery",
            "kind": "document",
            "title": "Original microbial scientific figures and vector downloads",
            "path": gallery_path,
            "bytes": len(files[gallery_path]),
            "sha256": _sha(files[gallery_path]),
            "metadata": {
                "source_scope": "Complete original microbial temporal, calendar and flow figures",
                "original_recipe_sha256": provenance["original_recipe"]["sha256"],
                "scientific_figures": len(recipe.get("figures", [])),
            },
            "companions": [item for item in descriptors if item["path"] != gallery_path],
        }
    return {
        "files": files,
        "report_path": REPORT_PATH,
        "gallery_path": gallery_path,
        "gallery_entry": gallery,
        "report_entry": html,
        "recipe_entry": native,
        "source_paths": sorted(originals),
        "provenance": {
            **provenance,
            "original_analysis_commit": ORIGINAL_ANALYSIS_COMMIT,
            "original_analysis_files": len(ORIGINAL_FILES),
            "original_inputs": [_descriptor(name, originals[name]) for name in inputs],
            "source_manifest": _descriptor(SOURCE_MANIFEST, originals[SOURCE_MANIFEST]),
            "captured_at": manifest.get("captured_at"),
        },
    }


def companion_files(application=None):
    """Return complete study-relative source bytes, including the bound recipe."""
    return load_companion(application)["files"]


def source_paths(application=None):
    """Return verified application-relative installer members; generated files are excluded."""
    return load_companion(application)["source_paths"]
