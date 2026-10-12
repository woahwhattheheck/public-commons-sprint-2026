"""Readable IPAM and connectivity delivery from a retained native migration result.

The original ScriptJob remains the source of objects, relationships and effects.
This module performs no NetBox requests or writes.
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import ipaddress
import json

SCHEMA = "tjlabs.netbox.network-commissioning/v1"
FAMILIES = ("route_targets", "vrfs", "vlans", "prefixes", "interfaces", "ip_addresses", "cables")
LABELS = {"route_targets": "Route targets", "vrfs": "VRFs", "vlans": "VLANs",
          "prefixes": "Prefixes", "interfaces": "Interfaces", "ip_addresses": "IP addresses",
          "cables": "Cables", "native_effects": "Native endpoint and path effects"}
COLUMNS = {
    "route_targets": ("name", "description"),
    "vrfs": ("name", "rd", "enforce_unique", "import_targets", "export_targets"),
    "vlans": ("name", "vid", "status", "site", "group", "ipam_role"),
    "prefixes": ("prefix", "vrf", "vlan", "scope_site", "status", "is_pool", "mark_utilized"),
    "interfaces": ("device", "name", "type", "mode", "vrf", "untagged_vlan", "tagged_vlans", "cable"),
    "ip_addresses": ("address", "vrf", "interface", "status", "dns_name"),
    "cables": ("label", "a_interface", "b_interface", "type", "status", "length", "length_unit"),
}


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def reference_label(value):
    if value is None:
        return "Global / unassigned"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, dict):
        if "key" in value and "kind" in value:
            return str(value["kind"]) + "/" + str(value["key"])
        if "id" in value and "model" in value:
            return str(value["model"]) + " #" + str(value["id"])
        return _json(value)
    if isinstance(value, list):
        return "; ".join(reference_label(item) for item in value) or "None"
    return str(value)


def network_inventory(result):
    result = result or {}
    resolved = {(row["kind"], row["key"]): row for row in result.get("resolved", [])}
    objects = {kind: [] for kind in (*FAMILIES, "native_effects")}
    for change in result.get("changes", []):
        kind = change.get("kind", "")
        family = kind if kind in FAMILIES else ("native_effects" if kind.startswith("cable_") else None)
        if family is None:
            continue
        native = resolved.get((kind, change.get("key")), {})
        objects[family].append({"kind": kind, "key": change.get("key"),
                                "action": change.get("action"), "native_id": native.get("id", change.get("original_id")),
                                "native_url": native.get("url"), "source": change.get("source"),
                                "before": change.get("before"), "after": change.get("after")})
    # Prefix aliases share one interval group. Address rows refer to that group,
    # keeping repeated native prefixes compact without dropping any selected row.
    groups = {}
    by_vrf = {}
    for row in objects["prefixes"]:
        fields = row["after"] or {}
        value = fields.get("prefix")
        if not isinstance(value, str):
            continue
        network = ipaddress.ip_network(value, strict=False)
        vrf = fields.get("vrf")
        signature = _json({"vrf": vrf, "prefix": str(network)})
        identity = "pg-" + hashlib.sha256(signature.encode("utf-8")).hexdigest()[:24]
        if identity not in groups:
            groups[identity] = {"id": identity, "vrf": vrf, "prefix": str(network),
                                "family": network.version, "prefix_length": network.prefixlen,
                                "address_count": str(network.num_addresses), "objects": []}
            by_vrf.setdefault(_json(vrf), []).append((network, identity))
        groups[identity]["objects"].append({"kind": "prefixes", "key": row["key"],
                                            "native_id": row["native_id"]})
        row["prefix_group"] = identity
    for networks in by_vrf.values():
        networks.sort(key=lambda item: (-item[0].prefixlen, item[0].version, int(item[0].network_address)))
    address_cache = {}
    for row in objects["ip_addresses"]:
        fields = row["after"] or {}
        value = fields.get("address")
        if not isinstance(value, str):
            continue
        address = ipaddress.ip_interface(value).ip
        vrf_key = _json(fields.get("vrf"))
        cache_key = (vrf_key, address.version, int(address))
        if cache_key not in address_cache:
            address_cache[cache_key] = next(
                (identity for network, identity in by_vrf.get(vrf_key, [])
                 if address.version == network.version and address in network), None)
        row["selected_prefix_group"] = address_cache[cache_key]
    return {"schema": SCHEMA, "operation_id": result.get("operation_id"),
            "state": result.get("state", "AWAITING_REVIEW"), "review_digest": result.get("review_digest"),
            "receipt_sha256": result.get("receipt_sha256"), "netbox_version": result.get("netbox_version"),
            "contract_source_commit": result.get("contract_source_commit"), "tenant": result.get("tenant"),
            "scope": "Imported network inventory and relationships in the retained native review.",
            "prefix_membership": "Most specific selected prefix within the address's explicitly reviewed VRF.",
            "counts": {kind: len(rows) for kind, rows in objects.items()},
            "prefix_groups": list(groups.values()), "objects": objects,
            "source_files": result.get("sources", [])}


def network_csv(value):
    output = io.StringIO(newline="")
    columns = ("kind", "source_key", "action", "native_id", "native_url", "name", "address_or_prefix",
               "vrf", "vlan", "device_or_endpoint_a", "interface_or_endpoint_b", "tagged_vlans",
               "selected_prefix_group", "source_file_sha256", "source_data_row", "before_json", "after_json")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for family in (*FAMILIES, "native_effects"):
        for row in value["objects"][family]:
            fields = row["after"] if isinstance(row["after"], dict) else {}
            provenance = row["source"] if isinstance(row["source"], dict) else {}
            writer.writerow({
                "kind": row["kind"], "source_key": row["key"], "action": row["action"],
                "native_id": row["native_id"], "native_url": row["native_url"],
                "name": fields.get("name", fields.get("label", "")),
                "address_or_prefix": fields.get("address", fields.get("prefix", "")),
                "vrf": reference_label(fields.get("vrf")),
                "vlan": reference_label(fields.get("vlan", fields.get("untagged_vlan"))),
                "device_or_endpoint_a": reference_label(fields.get("device", fields.get("a_interface"))),
                "interface_or_endpoint_b": reference_label(fields.get("interface", fields.get("b_interface"))),
                "tagged_vlans": reference_label(fields.get("tagged_vlans", [])),
                "selected_prefix_group": row.get("selected_prefix_group", row.get("prefix_group", "")),
                "source_file_sha256": provenance.get("sha256"), "source_data_row": provenance.get("row"),
                "before_json": _json(row["before"]), "after_json": _json(row["after"]),
            })
    return output.getvalue().encode("utf-8")


def network_html(value):
    esc = lambda item: html.escape(str(item), quote=True)
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8">',
             '<meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>Network commissioning</title>',
             '<style>body{font:14px system-ui,sans-serif;max-width:1500px;margin:32px auto;padding:0 24px;color:#171717;background:#fff}',
             'h1{font-size:25px}h2{font-size:19px;margin-top:32px}table{border-collapse:collapse;width:100%}',
             'td,th{padding:9px;border:1px solid #bbb;vertical-align:top;text-align:left}th{background:#f3f3f3}',
             '.scroll{overflow:auto}code,pre{font:12px ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}',
             '.counts{display:flex;gap:16px;flex-wrap:wrap;margin:20px 0}.count{border:1px solid #bbb;padding:12px}',
             'input{font:inherit;padding:10px;max-width:550px;width:90%;border:1px solid #888}nav{display:flex;gap:16px;flex-wrap:wrap}',
             'a{color:inherit}details{margin:12px 0}summary{cursor:pointer}small{display:block;color:#555}',
             '@media print{input,nav{display:none}body{margin:0;padding:0;font-size:10px}tr{break-inside:avoid}.scroll{overflow:visible}}</style>',
             '<h1>Network commissioning</h1><p>' + esc(value["scope"]) + '</p>',
             '<p><strong>' + esc(value["state"]) + '</strong> · Operation <code>' + esc(value["operation_id"]) + '</code></p>',
             '<p>Native NetBox ' + esc(value["netbox_version"]) + ' · Review <code>' + esc(value["review_digest"]) + '</code></p>',
             '<div class="counts">']
    for family in FAMILIES:
        parts.append('<div class="count"><strong>' + str(value["counts"][family]) + '</strong> ' + esc(LABELS[family]) + '</div>')
    parts += ['</div><nav>']
    for family in (*FAMILIES, "native_effects"):
        if value["objects"][family]:
            parts.append('<a href="#' + family + '">' + esc(LABELS[family]) + '</a>')
    parts += ['</nav><p><label>Find a reviewed object <input id="find" type="search"></label></p>']
    groups = {item["id"]: item for item in value["prefix_groups"]}
    for family in FAMILIES:
        rows = value["objects"][family]
        if not rows:
            continue
        columns = COLUMNS[family]
        parts += ['<section id="' + family + '"><h2>' + esc(LABELS[family]) + '</h2><div class="scroll"><table>',
                  '<thead><tr><th>Source object</th><th>Change</th>']
        parts += ['<th>' + esc(name.replace("_", " ")) + '</th>' for name in columns]
        if family == "ip_addresses":
            parts.append('<th>Selected prefix</th>')
        parts.append('</tr></thead><tbody>')
        for row in rows:
            fields = row["after"] or {}
            parts += ['<tr class="object"><td><strong>' + esc(row["key"]) + '</strong>',
                      '<small>Native ID ' + esc(row["native_id"]) + '</small></td><td>' + esc(row["action"]) + '</td>']
            parts += ['<td>' + esc(reference_label(fields.get(name))) + '</td>' for name in columns]
            if family == "ip_addresses":
                group = groups.get(row.get("selected_prefix_group"))
                selected = group["prefix"] + " · " + ", ".join(item["key"] for item in group["objects"]) if group else "No selected prefix"
                parts.append('<td>' + esc(selected) + '</td>')
            parts.append('</tr>')
        parts += ['</tbody></table></div></section>']
    if value["objects"]["native_effects"]:
        parts += ['<section id="native_effects"><h2>Native endpoint and path effects</h2>']
        for row in value["objects"]["native_effects"]:
            parts += ['<details class="object"><summary>' + esc(row["kind"]) + ' · ' + esc(row["key"]) + ' · ' + esc(row["action"]) + '</summary>',
                      '<h3>Before</h3><pre>' + esc(json.dumps(row["before"], ensure_ascii=False, indent=2)) + '</pre>',
                      '<h3>After</h3><pre>' + esc(json.dumps(row["after"], ensure_ascii=False, indent=2)) + '</pre></details>']
        parts.append('</section>')
    parts += ['<h2>Source files</h2><ul>']
    for source in value["source_files"]:
        parts.append('<li>' + esc(source["name"]) + ' · ' + esc(source["rows"]) + ' rows · <code>' + esc(source["sha256"]) + '</code></li>')
    parts += ['</ul><p>' + esc(value["prefix_membership"]) + '</p>',
              '<p>The JSON and CSV downloads retain complete before/after values and source-row identities. '
              'Use the original migration desk to recover the same native journal or prepare a corrected edition.</p>',
              '<script>document.getElementById("find").addEventListener("input",e=>{const q=e.target.value.toLowerCase();'
              'for(const row of document.querySelectorAll(".object"))row.hidden=!row.textContent.toLowerCase().includes(q)});</script></html>']
    return "".join(parts).encode("utf-8")
