"""Compare complete retained provider metadata in an original recurring review.

The native World Bank source parser owns exact numeric tokens and duplicate-key
validation. The original source document and handover own all page bytes. This
module compares their metadata without acquiring or rewriting provider data.
"""
from __future__ import annotations

from collections import defaultdict
import json
from pathlib import Path
from types import ModuleType
import zipfile

from .response_documents import document_path, validate_manifest, _delivery
from .worldbank_analysis import encoded, regular, require, sha, MAX_DOCUMENT

SCHEMA = "stellar-forge.worldbank-metadata-review.v1"
_METADATA = {"sources", "countries", "indicators"}


def _parser(source_file, expected_sha256):
    raw = regular(source_file, MAX_DOCUMENT)
    require(sha(raw) == expected_sha256, "Retain the original reviewed World Bank source parser.")
    module = ModuleType("_worldbank_original_source")
    module.__file__ = str(source_file)
    exec(compile(raw, str(source_file), "exec"), module.__dict__)
    return module


def _typed(value, numeric):
    """Canonical type-aware values, with no numeric conversion or key collision."""
    if isinstance(value, numeric):
        return ["number", str(value)]
    if value is None:
        return ["null"]
    if isinstance(value, bool):
        return ["boolean", value]
    if isinstance(value, str):
        return ["string", value]
    if isinstance(value, list):
        return ["array", [_typed(item, numeric) for item in value]]
    require(isinstance(value, dict), "Retain the original JSON metadata value types.")
    return ["object", [[key, _typed(value[key], numeric)] for key in sorted(value)]]


def _numbers(value, numeric, pointer=""):
    result = {}
    if isinstance(value, numeric):
        result[pointer] = str(value)
    elif isinstance(value, dict):
        for key, item in value.items():
            result.update(_numbers(item, numeric, pointer + "/" + key.replace("~", "~0").replace("/", "~1")))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            result.update(_numbers(item, numeric, pointer + "/" + str(index)))
    return result


def _edition(workspace, version_id, parser):
    version = workspace.database.version(version_id)
    document_id = version["dataset"].get("response", {}).get("original", {}).get("documentId")
    manifest_path = document_path(workspace.database.directory, document_id)
    manifest_raw = regular(manifest_path, MAX_DOCUMENT)
    require(sha(manifest_raw) == document_id, "Retain the original content-addressed source document.")
    manifest = validate_manifest(json.loads(manifest_raw))
    originals = [item for item in manifest["originals"] if item["role"] == "original-worldbank-handover"]
    require(len(originals) == 1, "Select an original World Bank handover retained by this dataset version.")
    descriptor = originals[0]
    groups = defaultdict(list)
    pages = []
    with _delivery(manifest_path.parent, descriptor).open() as stream:
        with zipfile.ZipFile(stream) as archive:
            names = archive.namelist()
            require(len(names) == len(set(names)), "The retained handover repeats an archive member.")
            def member(name):
                item = archive.getinfo(name)
                require(item.file_size <= MAX_DOCUMENT, "A retained metadata member exceeds the original capacity.")
                return archive.read(item)
            source = json.loads(member("source.json"))
            review = json.loads(member("review.json"))
            selection = json.loads(member("selection.json"))
            capture = json.loads(member("original/capture.json"))
            require(source.get("schema") == "stellar-forge.worldbank-export.v1" and
                    source["captureSha256"] == review["captureSha256"] == capture["captureSha256"] and
                    selection == source["selection"] == capture["spec"],
                    "The original source, capture, selection and review must name the same edition.")
            for page in capture["pages"]:
                require(page["kind"] in _METADATA | {"data"}, "Use a complete original World Bank page kind.")
                retained = {key: page.get(key) for key in (
                    "kind", "page", "indicatorId", "requestGroup", "url", "sha256", "bytes", "pagination")}
                pages.append(retained)
                raw = member("original/" + page["bodyFile"])
                require(len(raw) == page["bytes"] and sha(raw) == page["sha256"],
                        "The retained provider page differs from its original capture.")
                if page["kind"] not in _METADATA:
                    continue
                value = parser.parse_source(raw)
                require(isinstance(value, list) and len(value) == 2 and
                        isinstance(value[0], dict) and (value[1] is None or isinstance(value[1], list)),
                        "The original provider metadata page must contain pagination and rows.")
                for row in value[1] or []:
                    require(isinstance(row, dict), "Retain complete original metadata objects.")
                    # The original engine groups indicator metadata by its
                    # selected indicator. Imported requestGroup labels describe
                    # acquisition and remain in pages, not semantic row identity.
                    indicator = page.get("indicatorId")
                    group = page["kind"] if indicator is None else "indicators:" + indicator.upper()
                    identity = [page["kind"], indicator.upper() if indicator is not None else None, group,
                                _typed(row.get("id"), parser.NumericToken)]
                    groups[encoded(identity).decode()].append(row)
    for rows in groups.values():
        rows.sort(key=lambda row: encoded(_typed(row, parser.NumericToken)))
    return {
        "version_id": version_id, "document_id": document_id,
        "handover": {key: descriptor[key] for key in ("bytes", "sha256")},
        "source": source, "review": review, "selection": selection,
        "capture": {key: capture.get(key) for key in (
            "id", "captureSha256", "selectionSha256", "startedAt", "completedAt",
            "acquisition", "status", "collections", "requestGroups", "summary")},
        "pages": pages,
    }, groups


def compare_metadata(workspace, baseline_version_id, candidate_version_id, *, source_file, source_sha256):
    """Return full before/after context covered by the recurring review digest."""
    parser = _parser(Path(source_file), source_sha256)
    before, left = _edition(workspace, baseline_version_id, parser)
    after, right = _edition(workspace, candidate_version_id, parser)
    changes = []
    counts = {"added": 0, "removed": 0, "changed": 0, "unchanged": 0}
    for key in sorted(left.keys() | right.keys()):
        old, new = left.get(key, []), right.get(key, [])
        if _typed(old, parser.NumericToken) == _typed(new, parser.NumericToken):
            counts["unchanged"] += 1
            continue
        kind = "added" if not old else "removed" if not new else "changed"
        counts[kind] += 1
        identity = json.loads(key)
        changes.append({
            "change": kind, "kind": identity[0], "indicator_id": identity[1],
            "request_group": identity[2], "typed_record_id": identity[3],
            "before": old, "after": new,
            "before_numeric_tokens": _numbers(old, parser.NumericToken),
            "after_numeric_tokens": _numbers(new, parser.NumericToken),
        })
    selection_fields = ("sourceId", "countries", "indicators", "date")
    review_fields = ("title", "note", "columns", "excludedKeys", "choices", "includedObservations")
    selection_changes = {
        key: {"before": before["selection"].get(key), "after": after["selection"].get(key)}
        for key in sorted(before["selection"].keys() | after["selection"].keys())
        if before["selection"].get(key) != after["selection"].get(key)
    }
    review_changes = {
        key: {"before": before["review"].get(key), "after": after["review"].get(key)}
        for key in review_fields if before["review"].get(key) != after["review"].get(key)
    }
    return {
        "schema": SCHEMA, "baseline": before, "candidate": after,
        "same_selection": all(before["selection"].get(key) == after["selection"].get(key)
                              for key in selection_fields),
        "same_capture": before["source"]["captureSha256"] == after["source"]["captureSha256"],
        "selection_changes": selection_changes, "review_changes": review_changes,
        "provider_metadata_counts": counts, "provider_metadata_changes": changes,
        "numeric_representation": "Original numeric token strings with JSON-pointer type evidence; no float conversion.",
        "observation_comparison": "The original DatasetChanges comparison in the enclosing recurring review.",
    }
