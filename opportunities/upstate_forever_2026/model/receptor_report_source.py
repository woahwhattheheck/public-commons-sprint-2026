"""Publish a saved original watershed study as a retained scientific report source.

Consumes the existing network and optional prepared-area products. Original
polygon, profile, drainage and membership files remain byte-identical.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from html import escape
import json
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, held,
                     identifier, now, read_json, relative_file, verify_file)
from . import receptor_scenarios

SCHEMA = "upstate.receptor-report-source/v1"
RECIPE_SCHEMA = "upstate.observed-report/v1"
FOLDER = "receptor-report-sources"
VERSION = 1


def _capture(workspace, selection):
    if not isinstance(selection, dict):
        raise ValueError("Choose a saved original watershed study")
    allowed = {"network_id", "preparation_id", "title"}
    if set(selection) - allowed:
        raise ValueError("Unknown source-water report selection fields")
    preparation = None
    preparation_id = selection.get("preparation_id")
    if preparation_id is not None:
        preparation = receptor_scenarios.inspect(workspace, identifier(preparation_id))
    network_id = selection.get("network_id") or (preparation or {}).get("network_result_id")
    network_id = identifier(network_id)
    if preparation is not None and preparation["network_result_id"] != network_id:
        raise ValueError("Prepared polygons must belong to the selected original watershed study")
    network_root, product, network = receptor_scenarios._network(workspace, network_id)
    if preparation is not None and preparation["source_binding"] != product["source_binding"]:
        raise ValueError("Prepared polygons and drainage study must retain the same original source binding")
    title = selection.get("title") or (preparation or product)["title"] + " — source geography"
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Give the retained source geography report a title")
    source_files = {}

    def retain(prefix, root, result):
        # Add result.json explicitly: its hash captures the complete original
        # product and source descriptors alongside their verified member bytes.
        descriptors = dict(result["files"])
        descriptors["result"] = describe_file(root, root / "result.json")
        for item in descriptors.values():
            source = verify_file(root, item)
            name = (Path(prefix) / item["path"]).as_posix()
            if name in source_files:
                prior = source_files[name][1]
                if (prior["bytes"], prior["sha256"]) != (item["bytes"], item["sha256"]):
                    raise ValueError("Original product files assign conflicting source bodies")
            source_files[name] = (source, {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]})
        return descriptors["result"]

    original_result = retain("network", network_root, product)
    prepared_result = None
    if preparation is not None:
        prepared_result = retain("prepared", workspace.root / receptor_scenarios.FOLDER / preparation["id"], preparation)
    selected = {"network_id": network_id, "preparation_id": (preparation or {}).get("id"), "title": title.strip()}
    identity = {"schema": SCHEMA, "version": VERSION, "workspace_id": workspace.project["id"],
                "selection": selected,
                "network_result": {key: original_result[key] for key in ("sha256", "bytes")},
                "prepared_result": ({key: prepared_result[key] for key in ("sha256", "bytes")} if prepared_result else None),
                "source_members": {name: {key: item[key] for key in ("sha256", "bytes")}
                                   for name, (_, item) in sorted(source_files.items())}}
    return selected, identity, source_files, product, network, preparation


def _published_area(rows):
    values, missing = [], 0
    fields = set()
    for row in rows:
        found = [(key, value) for key, value in row["attributes"].items() if key.casefold() == "areasqkm"]
        if len(found) != 1:
            missing += 1
            continue
        key, raw = found[0]
        try:
            if isinstance(raw, bool) or raw is None:
                raise InvalidOperation
            number = Decimal(str(raw))
            if not number.is_finite() or number < 0:
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            missing += 1
            continue
        fields.add(key)
        values.append(number)
    return {"value": str(sum(values, Decimal(0))) if not missing else None,
            "unit": "km2", "source_fields": sorted(fields),
            "complete": missing == 0, "source_units": len(rows), "missing_units": missing,
            "basis": "Sum of the original publisher's AreaSqKm values over distinct HUC12 members"}


def _table(columns, rows):
    return {"kind": "table", "columns": columns, "rows": rows}


def _sections(product, network, preparation, title):
    lookup = {row["huc12"]: row for row in network["network"]}
    if len(lookup) != network["network_huc12_count"]:
        raise ValueError("Saved watershed graph count differs from its original HUC12 rows")
    selected_ids = set((preparation or {}).get("identity", {}).get("receptor_ids", [area["id"] for area in network["areas"]]))
    areas = [area for area in network["areas"] if area["id"] in selected_ids]
    if len(areas) != len(selected_ids):
        raise ValueError("Prepared receiving areas differ from their retained network selection")
    members, area_rows, summary_areas, union = [], [], [], set()
    for area in areas:
        hucs = area["huc12s"]
        if len(set(hucs)) != area["huc12_count"] or any(huc not in lookup for huc in hucs):
            raise ValueError("Saved area membership differs from the original graph")
        source_area = _published_area([lookup[huc] for huc in hucs])
        extent = source_area["value"] if source_area["complete"] else "Unavailable: " + str(source_area["missing_units"]) + " original area values missing"
        longest = max((row["links_to_anchor"] for row in area["memberships"]), default=0)
        area_rows.append([area["title"], area["role"].replace("_", " "), ", ".join(area["anchor_huc12s"]),
                          area["huc12_count"], extent, longest])
        summary_areas.append({"id": area["id"], "title": area["title"], "role": area["role"],
                              "huc12_count": area["huc12_count"], "anchor_huc12s": area["anchor_huc12s"],
                              "maximum_links_to_anchor": longest, "published_area": source_area})
        union.update(hucs)
        for member in area["memberships"]:
            original = lookup[member["huc12"]]
            members.append([area["title"], member["huc12"], original.get("name") or "",
                            member["anchor_huc12"], member["links_to_anchor"],
                            member.get("downstream_huc12") or "", original["source_feature_id"]])
    shared = {huc: owners for huc, owners in network["shared_huc12s"].items()
              if len([key for key in owners if key in selected_ids]) > 1}
    union_area = _published_area([lookup[huc] for huc in sorted(union)])
    binding = product["source_binding"]
    reference = product["identity"]["receptor_spec"].get("source_reference") or {}
    summary = {"schema": "upstate.receptor-report-summary/v1", "title": title,
               "network_id": product["id"], "preparation_id": (preparation or {}).get("id"),
               "network_huc12_count": len(lookup), "selected_huc12_count": len(union),
               "membership_rows": len(members), "shared_huc12_count": len(shared),
               "published_union_area": union_area, "areas": summary_areas,
               "original_source_binding": deepcopy(binding),
               "original_source_reference": deepcopy(reference)}
    sections = [
        ["Original source geography", [
            "The retained study follows the original HUC12 downstream links upstream from each selected anchor. "
            "Each receiving area includes its anchors and all connected upstream HUC12 units within this source edition.",
            _table(["Source measure", "Retained value"], [
                ["Original network HUC12 units", len(lookup)],
                ["Selected distinct HUC12 units", len(union)],
                ["Receiving-area membership rows", len(members)],
                ["HUC12 units shared by selected areas", len(shared)],
                ["Published area of the distinct selected union (km²)",
                 union_area["value"] if union_area["complete"] else "Unavailable: incomplete original AreaSqKm values"],
                ["Original source records", binding["feature_count"]],
                ["Original coordinate reference", json.dumps(binding.get("spatial_reference"), sort_keys=True)],
                ["Source edition", reference.get("vintage") or product["created_at"].split("T")[0]],
            ]),
            "Published areas sum original AreaSqKm attributes over distinct HUC12 members. "
            "Per-area totals retain their individual geography; the union counts each selected original unit once.",
        ]],
        ["Receiving areas and original upstream support", [
            _table(["Receiving area", "Purpose", "Anchor HUC12s", "HUC12 units",
                    "Published area (km²)", "Longest original path (links)"], area_rows),
            "A path length counts original downstream links to the nearest selected anchor. "
            "The source network bounds the available upstream extent; original external links and terminal labels remain retained.",
        ]],
        ["Original source boundaries", [
            _table(["Network context", "Original count"], [
                ["Links leaving the retained network", len(network.get("outside_network_links", []))],
                ["Original terminal labels", len(network.get("terminal_links", []))],
                ["Original special hydrologic-unit types", len(network.get("special_hydrologic_units", []))],
            ]),
            "The report preserves the original watershed geography and source relationships. "
            "Native scenario and pollutant comparisons retain their own saved reporting grid, producing model versions and physical-output support.",
        ]],
    ]
    if preparation is not None:
        sections.append(["Prepared original polygon sources", [
            "The prepared vectors retain each selected original feature's attributes, rings, native IDs and coordinate reference. "
            "They enter the existing Workspace as individual source areas for ordered land-cover scenarios and native analysis.",
            _table(["Receiving area", "HUC12 units", "Retained source ID", "Coordinate reference"],
                   [[area["title"], area["huc12_count"], area["source_id"],
                     json.dumps(area["source_spatial_reference"], sort_keys=True)] for area in preparation["areas"]]),
            "Prepared source collection: " + preparation["source_collection_id"],
        ]])
    sections.append(["Selected original HUC12 memberships", [
        _table(["Receiving area", "HUC12", "Original name", "Nearest anchor",
                "Links to anchor", "Next downstream HUC12", "Original feature ID"], members),
    ]])
    sections.append(["Original source identity and complete companion records", [
        "Saved original network: " + product["id"],
        "Retained source SHA256: " + binding["body_sha256"],
        "Decoded original source SHA256: " + binding["decoded_sha256"],
        {"kind": "links", "items": [
            {"title": "Original watershed explorer and geographic map", "path": "network/index.html"},
            {"title": "Complete original drainage network and attributes", "path": "network/network.json"},
            {"title": "Original membership CSV", "path": "network/memberships.csv"},
            {"title": "Original downstream links CSV", "path": "network/network.csv"},
            {"title": "Original watershed geometry", "path": "network/" + product["files"]["source_body"]["path"]},
        ] + ([{"title": "Prepared original polygons and analysis handoff", "path": "prepared/index.html"},
              {"title": "Prepared source manifest", "path": "prepared/sources.json"}] if preparation else [])},
    ]])
    return summary, sections


def _html(title, sections, geography):
    output = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
              '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) + '</title>',
              '<style>body{font:14px/1.5 system-ui;color:#202327;background:white;max-width:1280px;margin:32px auto;padding:0 24px}h1{font-size:27px}h2{font-size:20px;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:7px;text-align:left;vertical-align:top}th{background:#eee}a{color:inherit}img{width:100%;height:auto}p,td{overflow-wrap:anywhere}@media print{body{margin:10mm;padding:0}thead{display:table-header-group}tr{break-inside:avoid}table{font-size:9px}}</style></head><body><h1>' + escape(title) + '</h1>']
    if geography:
        output.append('<figure><img src="' + escape(geography, quote=True) + '" alt="Retained original watershed geography"><figcaption>Original geographic view from the saved drainage study.</figcaption></figure>')
    for heading, blocks in sections:
        output.append("<section><h2>" + escape(heading) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                output.append("<p>" + escape(block) + "</p>")
            elif block["kind"] == "table":
                output.append("<table><thead><tr>" + "".join("<th>" + escape(str(value)) + "</th>" for value in block["columns"]) + "</tr></thead><tbody>")
                for row in block["rows"]:
                    output.append("<tr>" + "".join("<td>" + escape(str(value)) + "</td>" for value in row) + "</tr>")
                output.append("</tbody></table>")
            else:
                output.append("<ul>" + "".join('<li><a href="' + escape(item["path"], quote=True) + '">' + escape(item["title"]) + "</a></li>" for item in block["items"]) + "</ul>")
        output.append("</section>")
    output.append("</body></html>\n")
    return "".join(output).encode("utf-8")


def inspect(workspace, key):
    key = identifier(key)
    directory = workspace.root / FOLDER / key
    result = read_json(directory / "result.json")
    if (result.get("schema") != SCHEMA or result.get("id") != key
            or digest(result["identity"]) != key
            or result.get("workspace_id") != workspace.project["id"]):
        raise ValueError("Choose a retained scientific source from this Workspace")
    for item in result["files"].values():
        verify_file(directory, item)
    choice = result["source_choice"]
    _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    recipe = result["files"]["recipe"]
    if entry["kind"] != "document" or entry["body"]["sha256"] != recipe["sha256"] or entry["body"]["bytes"] != recipe["bytes"]:
        raise ValueError("The scientific report source differs from its original retained recipe")
    from .observed_context import bind
    binding = bind(workspace, {"source_roles": {"OBSERVED_CONTEXT": choice}})
    if binding != result["observed_context_binding"]:
        raise ValueError("The retained scientific report companion binding changed")
    return {**result, "files": {**result["files"],
            "result": describe_file(directory, directory / "result.json")}}


def build(workspace, selection):
    selected, identity, sources, product, network, preparation = _capture(workspace, selection)
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".report.lock", blocking=False):
        if (directory / "result.json").exists():
            return inspect(workspace, key)
        for name, (path, descriptor) in sorted(sources.items()):
            raw = path.read_bytes()
            # Verify the complete retained original again at the copy boundary.
            from hashlib import sha256
            if len(raw) != descriptor["bytes"] or sha256(raw).hexdigest() != descriptor["sha256"]:
                raise ValueError("The original watershed product changed during source capture: " + name)
            atomic_bytes(directory / name, raw, immutable=True)
        summary, sections = _sections(product, network, preparation, selected["title"])
        atomic_json(directory / "summary.json", summary, immutable=True)
        provenance = {"schema": "upstate.receptor-report-provenance/v1",
                      "report_id": key, "identity": identity,
                      "original_source_binding": product["source_binding"],
                      "network_id": product["id"], "preparation_id": selected["preparation_id"]}
        atomic_json(directory / "provenance.json", provenance, immutable=True)
        originals = [describe_file(directory, directory / name) for name in sorted(sources)]
        inputs = originals + [describe_file(directory, directory / name) for name in ("summary.json", "provenance.json")]
        recipe = {"schema": RECIPE_SCHEMA, "title": selected["title"],
                  "source_scope": "Original watershed topology and prepared source geometry",
                  "inputs": [{name: item[name] for name in ("path", "bytes", "sha256")} for item in inputs],
                  "sections": sections,
                  "source_links": ["index.html", "summary.json", "provenance.json"] + sorted(sources)}
        atomic_json(directory / "observed-report.json", recipe, immutable=True)
        geography = ("network/" + product["files"]["geography"]["path"]) if product["files"].get("geography") else None
        atomic_bytes(directory / "index.html", _html(selected["title"], sections, geography), immutable=True)
        paths = sorted(sources) + ["summary.json", "provenance.json", "observed-report.json", "index.html"]
        descriptors = [describe_file(directory, directory / name) for name in paths]
        source_id = "source-water-geography-" + key[:24]
        manifest = {"schema": "upstate.sources/v1", "title": selected["title"],
                    "captured_at": product["created_at"],
                    "entries": [{"id": source_id, "kind": "document", "title": selected["title"],
                                 "path": "observed-report.json", "uri": "urn:sha256:" + key,
                                 "vintage": product["created_at"].split("T")[0],
                                 "report_schema": RECIPE_SCHEMA,
                                 "metadata": {"report_schema": RECIPE_SCHEMA,
                                              "source_scope": recipe["source_scope"],
                                              "network_result_id": product["id"],
                                              "preparation_id": selected["preparation_id"]},
                                 "companions": [{name: item[name] for name in ("path", "bytes", "sha256")}
                                                for item in descriptors if item["path"] != "observed-report.json"]}]}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        choice = {"source_collection_id": collection["id"], "source_id": source_id}
        from .observed_context import bind
        binding = bind(workspace, {"source_roles": {"OBSERVED_CONTEXT": choice}})
        files = {"source_%04d" % i: item for i, item in enumerate(originals)}
        files.update({name: describe_file(directory, directory / filename) for name, filename in
                      (("summary", "summary.json"), ("provenance", "provenance.json"),
                       ("recipe", "observed-report.json"), ("report", "index.html"), ("manifest", "sources.json"))})
        result = {"schema": SCHEMA, "id": key, "identity": identity, "title": selected["title"],
                  "created_at": now(), "state": "complete", "workspace_id": workspace.project["id"],
                  "selection": selected, "network_result_id": product["id"],
                  "preparation_id": selected["preparation_id"], "summary": summary,
                  "areas": summary["areas"], "membership_rows": summary["membership_rows"],
                  "network_huc12_count": summary["network_huc12_count"],
                  "selected_huc12_count": summary["selected_huc12_count"],
                  "source_binding": deepcopy(product["source_binding"]),
                  "source_collection_id": collection["id"], "source_choice": choice,
                  "observed_context_binding": binding, "files": files}
        atomic_json(directory / "result.json", result, immutable=True)
        return inspect(workspace, key)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("build", help="Retain one saved original network and optional prepared areas")
    create.add_argument("--network")
    create.add_argument("--prepared")
    create.add_argument("--title")
    check = commands.add_parser("inspect", help="Reopen the exact retained source and original companions")
    check.add_argument("id")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.command == "inspect":
        result = inspect(workspace, args.id)
    else:
        if not args.network and not args.prepared:
            parser.error("build requires --network or --prepared")
        selection = {key: value for key, value in
                     (("network_id", args.network), ("preparation_id", args.prepared), ("title", args.title))
                     if value is not None}
        result = build(workspace, selection)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
