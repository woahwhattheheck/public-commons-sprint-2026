"""Join the original NLCD range reader to the existing source-preparation desk."""
from __future__ import annotations

from pathlib import Path
import re

from model.common import atomic_json, digest, held, read_json
from source_tools import nlcd_remote_window as reader


def method_schema(input_field, option, domain_options):
    return {
        "id": "nlcd-range", "title": "Annual NLCD from original byte ranges", "role": "NLCD",
        "description": "Read the same original 2025 national ZIP through retained byte ranges and prepare its native land-cover window.",
        "inputs": [
            input_field("domain", "Complete upstream model domain", required=True, kinds=["vector"]),
            input_field("metadata_manifest", "Original static-product metadata", required=True,
                        default={"builtin_id": "nlcd-metadata"}),
            input_field("prefix", "Existing immutable original archive prefix",
                        help="Optional retained prefix from the same original national ZIP. Its byte count and SHA256 come from the saved input; keep an active growing capture with its existing owner."),
        ],
        "options": list(domain_options) + [
            option("compression_mode", "Original ZIP access", "choice", default="seekable",
                   choices=[{"value": "seekable", "label": "Stored or indexed SOZip"},
                            {"value": "measure-deflate", "label": "Also measure ordinary Deflate"}],
                   help="The reader inspects the actual member. Ordinary Deflate can require most of the original compressed archive; its real byte cost remains visible."),
            option("maximum_source_bytes", "Retained original byte allowance", "integer",
                   default=reader.DEFAULT_TRANSFER_BYTES,
                   help="Default 536870912 bytes. The complete original compressed archive is 1457983950 bytes. A later request can reuse completed ranges from this study."),
            option("timeout", "Provider timeout (seconds)", "number", default=60),
            option("raster_member", "Land-cover TIFF member", "text",
                   help="Leave blank when the original archive contains one TIFF."),
            option("expected_features", "Expected domain features", "integer",
                   help="Use 217 for the retained whole upstream model domain."),
            option("maximum_clip_pixels", "Maximum local clip cells", "integer",
                   default=reader.native.DEFAULT_CLIP_PIXELS,
                   help="The complete native domain window must fit the selected capacity."),
        ],
    }


def _window_identity(owner, selection):
    inputs = selection["inputs"]
    def primary(name):
        item = inputs[name]
        return next(row["sha256"] for row in item["files"] if row["path"] == item["main"])
    return {"domain_sha256": primary("domain"),
            "metadata_manifest_sha256": primary("metadata_manifest"),
            "domain_options": owner._domain_options(selection["options"], inputs["domain"]),
            "raster_member": selection["options"].get("raster_member")}


def _reuse_ranges(owner, workspace, task, native, maximum_bytes):
    """Adopt completed same-entity chunks without replaying provider requests."""
    reuse_record = Path(native) / "range-reuse.json"
    if reuse_record.is_file():
        return read_json(reuse_record)
    target = Path(native) / "prepared" / "original" / "ranges"
    target.mkdir(parents=True, exist_ok=True)
    entity = {"schema": "upstate.original-ranges/v1", "entity": reader.ENTITY,
              "chunk_bytes": reader.CHUNK_BYTES}
    adopted = []
    window_identity = _window_identity(owner, read_json(Path(native) / "selection.json"))
    # Source task requests and their source selections remain immutable. Reuse is
    # only of completed chunks from the same pinned entity and source window.
    with held(target / "ranges.lock", blocking=False):
        cache = reader.OriginalRanges(target, maximum_bytes=maximum_bytes)
        used = cache.retained_bytes
        records = owner._records(workspace)
        records.sort(key=lambda item: (item.get("updated_at", ""), item["task_id"]), reverse=True)
        for previous in records:
            previous_id = previous["task_id"]
            if (previous_id == task["id"] or previous.get("method") != "nlcd-range"
                    or previous.get("project_id") != workspace.project["id"]):
                continue
            previous_native = owner._native_root(workspace, previous_id)
            selection_path = previous_native / "selection.json"
            if not selection_path.is_file():
                continue
            if _window_identity(owner, read_json(selection_path)) != window_identity:
                continue
            source = previous_native / "prepared" / "original" / "ranges"
            if not (source / "entity.json").is_file():
                continue
            if read_json(reader._regular(source, "entity.json")) != entity:
                raise ValueError("A previous NLCD range cache names a different original entity")
            # Each committed receipt follows its immutable body. Reading those
            # completed chunks is safe even while the original task adds more.
            for receipt in sorted((source / "ranges").glob("*.json")):
                row = read_json(reader._regular(source, receipt.relative_to(source)))
                start, length = row.get("start"), row.get("bytes")
                if (type(start) is not int or start < 0 or start % reader.CHUNK_BYTES
                        or type(length) is not int
                        or length != min(reader.CHUNK_BYTES, reader.ENTITY["bytes"] - start)
                        or length <= 0 or row.get("entity_sha256") != digest(reader.ENTITY)
                        or row.get("path") != f"ranges/{start:016d}.bin"
                        or receipt.name != f"{start:016d}.json"
                        or row.get("end") != start + length - 1
                        or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("sha256", "")))):
                    raise ValueError("A previous completed range has a different source layout")
                if start in cache.records:
                    if cache.records[start] != row:
                        # Different receipt timestamps are legitimate independent
                        # acquisitions; the original body identity must still agree.
                        existing = cache.records[start]
                        if any(existing[key] != row[key] for key in ("sha256", "bytes", "start", "end", "path", "entity_sha256")):
                            raise ValueError("Completed original ranges have conflicting identities")
                    continue
                if used + length > maximum_bytes:
                    continue
                source_body = reader._regular(source, row["path"])
                saved = owner._object(workspace, source_body, row)
                owner._link_object(workspace, saved, reader._regular(target, row["path"]))
                atomic_json(reader._regular(target, f"ranges/{start:016d}.json"), row, immutable=True)
                cache.records[start] = row
                used += length
                adopted.append({"task_id": previous_id, "start": start, "bytes": length,
                                "sha256": row["sha256"]})
        result = {"schema": "upstate.original-range-reuse/v1",
                  "entity_sha256": digest(reader.ENTITY), "task_id": task["id"],
                  "window_identity": window_identity,
                  "adopted_ranges": adopted, "adopted_bytes": sum(item["bytes"] for item in adopted),
                  "retained_bytes": used}
        # Preserve each continuation's exact source reuse rather than rewriting
        # the first operation's original selection or HTTP receipts.
        atomic_json(reuse_record, result, immutable=True)
        return result


def prepare_entry(owner, workspace, task, native, record, files, snapshots, options):
    """Return the ordinary entry for the common bank/import/download path."""
    maximum = options.get("maximum_source_bytes", reader.DEFAULT_TRANSFER_BYTES)
    reuse = owner._stage(workspace, record, "Reusing completed original NLCD byte ranges",
                         lambda: _reuse_ranges(owner, workspace, task, native, maximum))
    prefix = {}
    if "prefix" in files:
        original = next(item for item in snapshots["prefix"]["files"]
                        if item["path"] == snapshots["prefix"]["main"])
        prefix = {"prefix": files["prefix"], "prefix_bytes": original["bytes"],
                  "prefix_sha256": original["sha256"]}
    entry = owner._stage(
        workspace, record, "Preparing the original NLCD window from retained byte ranges",
        lambda: reader.prepare(
            Path(native) / "prepared", metadata_manifest=files["metadata_manifest"],
            domain=files["domain"], expected_features=options.get("expected_features"),
            maximum_clip_pixels=options.get("maximum_clip_pixels", reader.native.DEFAULT_CLIP_PIXELS),
            maximum_source_bytes=maximum, timeout=options.get("timeout", 60),
            raster_member=options.get("raster_member"),
            allow_unindexed_deflate=options.get("compression_mode", "seekable") == "measure-deflate",
            progress=lambda item: owner._native_progress(workspace, record, item),
            **prefix, **owner._domain_options(options, snapshots["domain"])))
    record["original_range_reuse"] = {
        "adopted_ranges": len(reuse["adopted_ranges"]),
        "adopted_bytes": reuse["adopted_bytes"]}
    return entry
