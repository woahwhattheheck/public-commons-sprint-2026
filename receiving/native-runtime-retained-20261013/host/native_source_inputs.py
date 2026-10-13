"""Bind artifact source editions to the existing source resolver and importer.

Git requests retain the original acquisition and identity functions. Artifact
origins describe actual file bytes and their original container references; the
importer's blob SHA remains a content checksum, independent of Git provenance.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import tempfile

import connected_github_source_reuse as reuse

SCHEMA = "commons.artifact-source-request/v1"
ACQUISITION_SCHEMA = "commons.artifact-source-acquisition/v1"
MAX_FILES = 16384
MAX_ORIGIN_BYTES = 8 * 1024 * 1024
SHA256 = re.compile(r"[0-9a-f]{64}")


def _require(value, detail, path=None):
    if not value:
        raise reuse.ReuseError("ARTIFACT_SOURCE_INVALID", detail, path)


def _encoded(value):
    try:
        return json.dumps(value, ensure_ascii=True, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode("ascii")
    except (TypeError, ValueError, OverflowError) as error:
        raise reuse.ReuseError("ARTIFACT_SOURCE_INVALID",
                              "Artifact origins must contain finite JSON values.") from error


def is_artifact(value):
    return isinstance(value, dict) and value.get("schema") == SCHEMA


def source_request(value):
    if isinstance(value, dict) and value.get("schema") == ACQUISITION_SCHEMA:
        request = value.get("request")
        _require(is_artifact(request) and value.get("selection_id") == selection_identity(request),
                 "The retained artifact acquisition request changed.")
        return request
    return value if is_artifact(value) else reuse.source_request(value)


def normalized_request(manifest):
    manifest = source_request(manifest)
    _require(is_artifact(manifest), "Select an original artifact-source request.")
    _require(not set(manifest) - {"schema", "files", "origins"},
             "Artifact requests contain schema, files and original per-path origins.")
    requested = reuse._requests(manifest)
    _require(len(requested) <= MAX_FILES, "Select at most 16384 original artifact files.")
    # Do not silently collapse duplicate declarations with different origins or bodies.
    _require(len(requested) == len(manifest["files"]), "Select each artifact path once.")
    origins = manifest.get("origins")
    paths = {row["path"] for row in requested}
    _require(isinstance(origins, dict) and set(origins) == paths,
             "Original origins must cover exactly the selected artifact paths.")
    _require(len(_encoded(origins)) <= MAX_ORIGIN_BYTES,
             "The original artifact-origin metadata exceeds 8 MiB.")
    normalized_origins, files = {}, []
    for row in requested:
        name, origin = row["path"], origins[row["path"]]
        _require(isinstance(origin, dict), "Each selected file needs its original origin record.", name)
        _require(isinstance(origin.get("uri"), str) and origin["uri"].strip()
                 and "\0" not in origin["uri"] and len(origin["uri"]) <= 4096,
                 "Retain the original artifact URI, file reference or local source path.", name)
        _require(isinstance(origin.get("sha256"), str) and SHA256.fullmatch(origin["sha256"]),
                 "Retain the selected file's exact lowercase SHA-256.", name)
        _require(type(origin.get("bytes")) is int and origin["bytes"] >= 0,
                 "Retain the selected file's exact nonnegative byte count.", name)
        _require(row["size"] is None or row["size"] == origin["bytes"],
                 "The importer byte count and original artifact byte count differ.", name)
        container = origin.get("container")
        if container is not None:
            _require(isinstance(container, dict) and isinstance(container.get("uri"), str)
                     and container["uri"].strip() and "\0" not in container["uri"],
                     "An enclosing artifact needs its original URI or file reference.", name)
            _require(type(container.get("bytes")) is int and container["bytes"] >= 0
                     and isinstance(container.get("sha256"), str)
                     and SHA256.fullmatch(container["sha256"]),
                     "Retain the selected enclosing Canvas/ZIP edition's bytes and SHA-256.", name)
        normalized_origins[name] = json.loads(_encoded(origin))
        files.append({"path": name, "blob_sha": row["blob_sha"],
                      "size": origin["bytes"], "mode": row["mode"] or "100644"})
    return {"schema": SCHEMA,
            "origins": {name: normalized_origins[name] for name in sorted(normalized_origins)},
            "files": sorted(files, key=lambda row: row["path"])}


def selection_identity(manifest):
    manifest = source_request(manifest)
    if not is_artifact(manifest):
        return reuse.selection_identity(manifest)
    return hashlib.sha256(_encoded(normalized_request(manifest))).hexdigest()


def merge_source_captures(manifest, captures=()):
    manifest = source_request(manifest)
    if not is_artifact(manifest):
        return reuse.merge_source_captures(manifest, captures)
    _require(not captures, "Attach original artifact bytes or source roots; Git capture pairs belong to Git requests.")
    normalized_request(manifest)
    return manifest, []


def verify_provided(manifest, *, complete=False):
    """Verify strong origin hashes before the original importer publishes any file."""
    manifest = source_request(manifest)
    if not is_artifact(manifest):
        return
    request = normalized_request(manifest)
    origins = request["origins"]
    for entry in manifest["files"]:
        if "response" not in entry and "source_file" not in entry:
            _require(not complete, "Supply this artifact's complete original bytes.", entry["path"])
            continue
        spec = reuse.importer._source_spec(entry)
        actual, count = hashlib.sha256(), 0
        for chunk in reuse.importer._source_chunks(spec):
            actual.update(chunk)
            count += len(chunk)
        origin = origins[entry["path"]]
        _require(count == origin["bytes"] and actual.hexdigest() == origin["sha256"],
                 "The supplied file differs from its selected original artifact edition.", entry["path"])


def acquisition_plan(manifest, source_roots=(), git_roots=(), *, captures=()):
    manifest = source_request(manifest)
    if not is_artifact(manifest):
        return reuse.acquisition_plan(manifest, source_roots, git_roots, captures=captures)
    hydrated, receipts = merge_source_captures(manifest, captures)
    request = normalized_request(hydrated)
    verify_provided(hydrated)
    report = reuse.resolve_sources(hydrated, source_roots, git_roots, captures=())
    origins = request["origins"]
    # Resolver byte identities remain authoritative for reuse. The original
    # freeze/import then checks strong origin hashes on the complete bodies.
    report = {**report, "origins": origins,
              "files": [{**row, "origin": origins[row["path"]]} for row in report["files"]],
              "missing": [{**row, "origin": origins[row["path"]]} for row in report["missing"]]}
    missing = [{"path": row["path"], "blob_sha": row["blob_sha"],
                "size": origins[row["path"]]["bytes"], "origin": origins[row["path"]]}
               for row in report["missing"]]
    return {"schema": ACQUISITION_SCHEMA, "ok": True, "complete": report["complete"],
            "selection_id": selection_identity(request), "request": request, "reuse": report,
            "origins": origins, "captures": receipts, "missing": missing,
            "fetches": [], "unique_missing_blobs": len({row["blob_sha"] for row in missing}),
            "provider_requests": 0}


def metadata(request, *, include_tree_sha=False):
    request = source_request(request)
    if is_artifact(request):
        normalized = normalized_request(request)
        return {"source_kind": "artifact", "artifact_schema": SCHEMA,
                "origins": normalized["origins"]}
    result = {key: request[key] for key in ("repository", "ref", "tree_sha") if key in request}
    if include_tree_sha:
        result["tree_sha"] = request.get("tree_sha")
    return result


def materialize_reused(manifest, output_directory, source_roots=(), git_roots=(), *,
                       staging_directory=None, captures=(), immutable_links=False,
                       link_fallback="copy", link_anchors=()):
    manifest = source_request(manifest)
    options = {"immutable_links": immutable_links, "link_fallback": link_fallback,
               "link_anchors": link_anchors}
    if not is_artifact(manifest):
        return reuse.materialize_reused(manifest, output_directory, source_roots, git_roots,
                                        staging_directory=staging_directory, captures=captures, **options)
    plan = acquisition_plan(manifest, source_roots, git_roots, captures=captures)
    report = plan["reuse"]
    if not report["complete"]:
        return {**report, **metadata(plan["request"]), "selection_id": plan["selection_id"],
                "error": "SOURCE_REUSE_MISSING", "imported": False}

    def publish(staged):
        selected = reuse._import_manifest(manifest, report, staged)
        selected.update(schema=SCHEMA, origins=plan["request"]["origins"])
        verify_provided(selected, complete=True)
        return reuse.importer.materialize(selected, output_directory,
                                          staging_directory=staging_directory, **options)

    if any(row["status"] == "git_object" for row in report["files"]):
        with tempfile.TemporaryDirectory(prefix="commons-artifact-source-", dir=staging_directory) as directory:
            result = publish(reuse._extract_objects(report["files"], Path(directory)))
    else:
        result = publish({})
    return {**report, **metadata(plan["request"]), "selection_id": plan["selection_id"],
            "imported": True, "import_result": result}


def verify_materialized_origins(request, destination):
    if not is_artifact(source_request(request)):
        return
    request = normalized_request(request)
    manifest = {**request, "files": [{**entry, "source_file": str(Path(destination) / entry["path"])}
                                    for entry in request["files"]]}
    verify_provided(manifest, complete=True)
