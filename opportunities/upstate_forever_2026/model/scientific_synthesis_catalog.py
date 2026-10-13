"""Exact original source references for an authored scientific synthesis.

This is a readonly catalogue over the existing OBSERVED_CONTEXT reader.  It
creates no Workspace records, report, source import, or numerical interpretation.
A caller freezes the complete returned catalogue and selected references beside
its attributed authored revision and complete original source-collection ZIPs.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json

from . import observed_context
from .common import digest, identifier
from .scientific_figures import _validate_figure

SCHEMA = "upstate.scientific-synthesis-catalog/v1"
REFERENCE_SCHEMA = "upstate.scientific-synthesis-reference/v1"


def _json_member(source, name):
    """Read one entire already-bound member without a read/hash race."""
    relative = observed_context._relative(name).as_posix()
    member = source["members"].get(relative)
    if member is None:
        raise ValueError("The selected scientific source has no member: " + relative)
    raw = member["path"].read_bytes()
    if len(raw) != member["bytes"] or sha256(raw).hexdigest() != member["sha256"]:
        raise ValueError("The selected scientific source changed: " + relative)
    return json.loads(raw.decode("utf-8"))


def _reference(source, kind, title, pointer, content, *, member_path, **extra):
    binding = source["binding"]
    member = source["members"][member_path]
    value = {
        "schema": REFERENCE_SCHEMA,
        "source_collection_id": binding["source_collection_id"],
        "source_id": binding["source_id"],
        "body_sha256": binding["body_sha256"],
        "kind": kind,
        "title": title,
        "pointer": pointer,
        "member_path": member_path,
        "member_sha256": member["sha256"],
        "member_bytes": member["bytes"],
        "content": deepcopy(content),
        **deepcopy(extra),
    }
    value["id"] = digest(value)
    return value


def _text(value, fallback):
    return value if isinstance(value, str) and value.strip() else fallback


def _source_catalog(workspace, choice, supplied):
    identifier(choice["source_collection_id"])
    source = observed_context._source(
        workspace, {"source_roles": {observed_context.ROLE: choice}})
    binding, entry = source["binding"], source["entry"]
    expected = supplied.get("body_sha256")
    if expected is not None and identifier(expected) != binding["body_sha256"]:
        raise ValueError("Read the exact original scientific source edition before writing.")
    if "binding" in supplied and supplied["binding"] != binding:
        raise ValueError("The selected scientific source member binding has changed.")
    body_name = observed_context._relative(
        entry["body"].get("view_path", entry["body"]["filename"])).as_posix()
    recipe = _json_member(source, body_name)
    if recipe != source["recipe"]:
        raise ValueError("The scientific recipe changed during source cataloguing.")
    # The original reader owns block validation; repeat no scientific model.
    sections = recipe["sections"]
    title = _text(recipe.get("title"), _text(entry.get("title"), choice["source_id"]))
    collection = workspace._get("sources", choice["source_collection_id"])
    original = collection["original_manifest"]
    members = [{
        "path": name, "bytes": member["bytes"], "sha256": member["sha256"],
    } for name, member in sorted(source["members"].items())]
    row = {
        **deepcopy(choice),
        "binding": deepcopy(binding),
        "body_sha256": binding["body_sha256"],
        "body_path": body_name,
        "title": title,
        "source_title": entry["title"],
        "vintage": entry["vintage"],
        "uri": entry["uri"],
        "collection_title": collection.get("title", choice["source_collection_id"]),
        "original_manifest": {
            name: original[name] for name in ("filename", "bytes", "sha256")
        },
        "metadata": deepcopy(entry.get("metadata") or {}),
        "recipe": deepcopy(recipe),
        "members": members,
    }
    refs = [_reference(source, "source", title, "", recipe,
                       member_path=body_name)]
    for section_index, section in enumerate(sections):
        heading, blocks = section
        label = _text(heading, "Section " + str(section_index + 1))
        pointer = "/sections/" + str(section_index)
        refs.append(_reference(
            source, "section", label, pointer, section, member_path=body_name,
            section_index=section_index))
        for block_index, block in enumerate(blocks):
            kind = block.get("kind", "block") if isinstance(block, dict) else "paragraph"
            block_title = (block.get("caption") or block.get("title")
                           if isinstance(block, dict) else None)
            refs.append(_reference(
                source, "block",
                _text(block_title, label + " — " + kind + " " + str(block_index + 1)),
                pointer + "/1/" + str(block_index), block,
                member_path=body_name, section_index=section_index,
                block_index=block_index, block_kind=kind))
    choices = recipe.get("figures", [])
    if choices:
        if not isinstance(choices, list):
            raise ValueError("Scientific figure choices must be an ordered list.")
        spec_name = observed_context._relative(recipe["figure_spec"]).as_posix()
        spec = _json_member(source, spec_name)
        if spec.get("schema") != "upstate.scientific-figure-spec/v1":
            raise ValueError("The original scientific figure specification differs.")
        figures = spec.get("figures")
        if not isinstance(figures, list):
            raise ValueError("The original figure specification needs its complete list.")
        indexed = {}
        for index, figure in enumerate(figures):
            if not isinstance(figure, dict) or "id" not in figure:
                raise ValueError("Scientific figures need their original identifiers.")
            try:
                hash(figure["id"])
            except TypeError as error:
                raise ValueError("A scientific figure identifier must be a scalar.") from error
            if figure["id"] in indexed:
                raise ValueError("Scientific figures repeat an original identifier.")
            indexed[figure["id"]] = (index, figure)
        for choice_index, selected in enumerate(choices):
            if not isinstance(selected, dict) or "id" not in selected or selected["id"] not in indexed:
                raise ValueError("A selected scientific figure is absent from its original specification.")
            figure_index, figure = indexed[selected["id"]]
            _validate_figure(figure)
            asset_name = observed_context._relative(selected["path"]).as_posix()
            asset = source["members"].get(asset_name)
            if asset is None or not asset_name.lower().endswith(".svg"):
                raise ValueError("The selected scientific figure needs its complete retained SVG.")
            refs.append(_reference(
                source, "figure", _text(figure.get("title"), str(selected["id"])),
                "/figures/" + str(figure_index), figure, member_path=spec_name,
                figure_id=selected["id"], figure_index=figure_index,
                selection_index=choice_index,
                recipe_pointer="/figures/" + str(choice_index),
                selection=selected, asset_path=asset_name,
                asset_sha256=asset["sha256"], asset_bytes=asset["bytes"]))
    for member in members:
        refs.append(_reference(
            source, "member", member["path"], "", member,
            member_path=member["path"]))
    row["reference_ids"] = [ref["id"] for ref in refs]
    return row, refs


def catalog(workspace, ordered_choices):
    """Return every exact source, section, block, selected figure and member.

    ordered_choices uses the original source_collection_id/source_id pair.
    Optional body_sha256 and binding assert a previously read exact edition.
    Full headings, block values, numeric figure specifications and original
    recipe metadata remain available; repeated headings have separate indices.
    Reference.pointer addresses member_path's JSON, except kind=member where
    content is the exact descriptor for the whole retained file.
    """
    if not isinstance(ordered_choices, list):
        raise ValueError("Choose the ordered original scientific source documents.")
    choices = observed_context.source_choices({
        "observed_context_sources": ordered_choices,
    })
    sources, references = [], []
    for choice, supplied in zip(choices, ordered_choices):
        source, refs = _source_catalog(workspace, choice, supplied)
        sources.append(source)
        references.extend(refs)
    ids = [row["id"] for row in references]
    if len(ids) != len(set(ids)):
        raise ValueError("The scientific source catalogue repeats a reference identity.")
    result = {
        "schema": SCHEMA,
        "sources": sources,
        "references": references,
    }
    result["catalog_sha256"] = digest(result)
    return result


def bind_references(source_catalog, selected_ids):
    """Freeze exact references from one complete retained source catalogue.

    This verifies the catalogue and all reference/source identities before
    returning independent full copies in the caller's selected order.  It does
    not treat a submitted catalogue hash as authority to mutate a Workspace:
    the original writer must obtain/compare its own catalog(workspace, choices)
    against the reviewed catalog_sha256 at its existing request boundary.
    """
    if not isinstance(source_catalog, dict) or source_catalog.get("schema") != SCHEMA:
        raise ValueError("Use the complete original scientific synthesis catalogue.")
    content = {key: value for key, value in source_catalog.items()
               if key != "catalog_sha256"}
    if source_catalog.get("catalog_sha256") != digest(content):
        raise ValueError("The retained scientific source catalogue changed.")
    sources = source_catalog.get("sources")
    references = source_catalog.get("references")
    if not isinstance(sources, list) or not isinstance(references, list):
        raise ValueError("The retained catalogue lacks its complete sources and references.")
    source_map = {}
    expected_ids = []
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("The retained source catalogue has an invalid source.")
        key = (source.get("source_collection_id"), source.get("source_id"))
        if any(not isinstance(value, str) or not value for value in key) or key in source_map:
            raise ValueError("The retained source catalogue repeats or loses a source identity.")
        binding = source.get("binding")
        if (not isinstance(binding, dict)
                or tuple(binding.get(name) for name in ("source_collection_id", "source_id")) != key
                or binding.get("body_sha256") != source.get("body_sha256")):
            raise ValueError("The retained source differs from its original binding.")
        ids = source.get("reference_ids")
        if not isinstance(ids, list) or any(not isinstance(value, str) for value in ids):
            raise ValueError("The retained source lacks its original reference roster.")
        expected_ids.extend(ids)
        source_map[key] = source
    indexed = {}
    for row in references:
        if not isinstance(row, dict) or row.get("schema") != REFERENCE_SCHEMA:
            raise ValueError("The catalogue contains an invalid original reference.")
        identity = row.get("id")
        if (not isinstance(identity, str) or identity in indexed
                or identity != digest({key: value for key, value in row.items() if key != "id"})):
            raise ValueError("The original scientific reference identity changed.")
        original = source_map.get((row.get("source_collection_id"), row.get("source_id")))
        if original is None or row.get("body_sha256") != original["body_sha256"]:
            raise ValueError("The reference has another original scientific source.")
        member = next((member for member in original.get("members", [])
                       if member.get("path") == row.get("member_path")), None)
        if (member is None or member.get("sha256") != row.get("member_sha256")
                or member.get("bytes") != row.get("member_bytes")
                or original["binding"].get("member_sha256", {}).get(row["member_path"])
                != row["member_sha256"]):
            raise ValueError("The reference has another original source member.")
        indexed[identity] = row
    if [row["id"] for row in references] != expected_ids:
        raise ValueError("The complete source reference order differs from its retained roster.")
    if not isinstance(selected_ids, list):
        raise ValueError("Select the exact original scientific reference identifiers.")
    selected, seen = [], set()
    for identity in selected_ids:
        if not isinstance(identity, str) or identity not in indexed or identity in seen:
            raise ValueError("Select each existing original scientific reference once.")
        seen.add(identity)
        selected.append(deepcopy(indexed[identity]))
    return selected
