#!/usr/bin/env python3
"""Run one complete Macrobond customer-catalog operation on the retained ECB example.

The operation imports the actual source packet, saves full and USD-only customer
editions, publishes and rolls back, reads the authenticated provider, and transfers
the complete catalog to an independent receiving workspace. One operation root owns
the original catalogs and output; invoking it again resumes those same objects.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import threading
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, ProxyHandler
import zipfile


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha256(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(65536), b""):
            result.update(block)
    return result.hexdigest()


def write(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("wb") as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())
    temporary.chmod(0o600)
    temporary.replace(path)


def progress(stage, **details):
    print(json.dumps({"stage": stage, **details}), flush=True)


@contextmanager
def serving(catalog):
    server = OperatorServer(catalog, provider_username="catalog-operator",
                            provider_password=secrets.token_urlsafe(32))
    thread = threading.Thread(target=server.serve_forever, name="macrobond-native-provider")
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def provider_operation(catalog, full, output):
    selected = full["series"]
    names = [item["id"] for item in selected]
    by_name = {item["id"]: item for item in selected}
    opener = build_opener(ProxyHandler({}))
    captured = {}
    with serving(catalog) as server:
        authorization = "Basic " + base64.b64encode(server._provider_credentials).decode("ascii")

        def get(command, params=None, authenticated=True):
            suffix = "?" + urlencode(params or {}, doseq=True) if params else ""
            request = Request(server.origin + "/" + command + suffix,
                              headers={"Authorization": authorization} if authenticated else {})
            try:
                with opener.open(request, timeout=60) as response:
                    code, raw = response.status, response.read()
            except HTTPError as error:
                code, raw = error.code, error.read()
            return code, raw

        status, raw = get("getcapabilities", authenticated=False)
        require(status == 401, "The public provider must challenge a missing Basic credential")
        status, raw = get("getcapabilities")
        require(status == 200, "Authenticated capabilities were not served")
        capabilities = json.loads(raw)
        require(capabilities["browse"] and capabilities["search"] and capabilities["meta"]
                and capabilities["allowMultipleSeriesPerRequest"]
                and not capabilities["revisions"], "The advertised provider capabilities differ")
        captured["getcapabilities"] = capabilities

        status, raw = get("loadtree")
        require(status == 200, "The root catalog tree was not served")
        tree = json.loads(raw)
        require(tree and all("ChildrenReference" in row for row in tree), "The root tree is incomplete")
        captured["loadtree"] = tree
        browse_names = []
        for node in tree:
            status, raw = get("loadtree", {"reference": node["ChildrenReference"]})
            require(status == 200, "The source-flow frequency tree was not served")
            for frequency in json.loads(raw):
                status, raw = get("listseries", {"reference": frequency["SeriesReference"]})
                require(status == 200, "A frequency's retained series were not served")
                listing = json.loads(raw)
                for group in listing["groups"]:
                    for item in group["series"]:
                        browse_names.extend(item["names"])
        require(sorted(browse_names) == sorted(names), "Browse does not return the exact published series")

        status, raw = get("searchseries", {"query": "USD"})
        require(status == 200, "The customer search was not served")
        search = json.loads(raw)
        expected_usd = {s["id"] for s in selected if s["dimensions"].get("CURRENCY") == "USD"}
        require({s["PrimName"] for s in search} == expected_usd, "Search differs from the original USD series")
        captured["searchseries"] = search

        request_names = [names[0], "missing-customer-series", names[-1]]
        status, raw = get("loadmeta", {"n": request_names})
        require(status == 200, "The ordered metadata request was not served")
        metadata = json.loads(raw)
        require(len(metadata) == 3 and "error" in metadata[1]
                and metadata[0]["data"]["metaData"]["PrimName"] == names[0]
                and metadata[2]["data"]["metaData"]["PrimName"] == names[-1],
                "Metadata success/error order differs from the repeated n parameters")
        captured["loadmeta"] = metadata

        status, raw = get("loadseries", {"n": request_names})
        require(status == 200, "The ordered mixed series request was not served")
        mixed = json.loads(raw, parse_float=Decimal)
        require(len(mixed) == 3 and "error" in mixed[1]
                and mixed[0]["data"]["metaData"]["PrimName"] == names[0]
                and mixed[2]["data"]["metaData"]["PrimName"] == names[-1],
                "Data success/error order differs from the repeated n parameters")
        captured["loadseries_mixed"] = mixed

        status, raw = get("loadseries", {"n": names})
        require(status == 200, "The complete published series were not served")
        values = json.loads(raw, parse_float=Decimal)
        require(len(values) == len(names), "The provider omitted a requested series")
        count = 0
        for name, received in zip(names, values):
            item = by_name[name]
            data = received["data"]
            original = catalog.observations(full["edition"]["id"], name, 0, 1000)["rows"]
            require(data["metaData"] == item["metaData"], "The provider changed retained metadata")
            require(data["values"] == [projected_number(row) for row in original],
                    "The provider changed an original decimal observation")
            require(data["dates"] == [row["date"] for row in original],
                    "The provider changed an original source period anchor")
            count += len(data["values"])
        annual_gbp = next(s for s in selected
                          if s["dimensions"].get("CURRENCY") == "GBP" and s["source_frequency"] == "A")
        exact = values[names.index(annual_gbp["id"])]["data"]["values"][0]
        require(exact == Decimal("0.8567923137255"), "The ECB annual GBP source value changed")
        require(b"0.8567923137255" in raw, "The original decimal value is missing from the HTTP JSON")
        captured["loadseries"] = values

    write(output, wire_json(captured))
    return {"routes": sorted(PROVIDER_METHODS), "authentication_status_without_credentials": 401,
            "series_count": len(names), "observation_count": count,
            "annual_gbp": str(exact), "annual_gbp_series_id": annual_gbp["id"],
            "provider_series_ids": names, "wire_sha256": sha256(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True, help="The maintained sdmx source directory")
    parser.add_argument("--operation-root", type=Path, required=True, help="A private directory for this operation")
    parser.add_argument("--project-packet", type=Path, required=True, help="The retained ECB SDMX example packet")
    args = parser.parse_args()
    source_root, operation, packet = (p.expanduser().absolute()
                                      for p in (args.source_root, args.operation_root, args.project_packet))
    sys.path.insert(0, str(source_root / "macrobond"))
    global Catalog, OperatorServer, projected_number, wire_json, PROVIDER_METHODS
    from catalog import Catalog, projected_number, wire_json, PROVIDER_METHODS
    from server import OperatorServer
    node = os.environ.get("SF30_XML_NODE") or os.environ.get("SF30_SDMX_NODE") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE")
    if node:
        os.environ["SF30_XML_NODE"] = node
    os.umask(0o077)
    operation.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not operation.is_symlink() and operation.stat().st_mode & 0o077 == 0,
            "The operation root must be a private real directory")
    packet_sha = sha256(packet)
    completed = operation / "native-complete.json"
    if completed.exists():
        previous = json.loads(completed.read_bytes())
        require(previous["input_packet_sha256"] == packet_sha,
                "This operation belongs to a different original source packet")
        progress("already_complete", result=str(completed), packet=previous["catalog_packet"])
        return

    with zipfile.ZipFile(packet) as archive:
        manifest = json.loads(archive.read("sdmx-packet.json"))
    project_id, revision = manifest["project_id"], manifest["revision"]
    catalog_path, receiving_path = operation / "catalog", operation / "receiving-catalog"
    result = {"operation": "macrobond-ecb-customer-catalog", "input_packet_sha256": packet_sha,
              "source_project_id": project_id, "source_revision": revision,
              "catalog_path": str(catalog_path), "receiving_catalog_path": str(receiving_path)}
    with Catalog(catalog_path, create=not catalog_path.exists()) as catalog:
        catalog.import_packet(packet)
        catalog.source.native.close()
        progress("source_imported", project=project_id, revision=revision)
        full_request = {"operation_id": "macrobond-ecb-full-v1", "title": "ECB 2025 reference rates",
                        "notes": "All retained annual, quarterly, monthly and daily GBP/EUR and USD/EUR observations.",
                        "members": [{"project_id": project_id, "revision": revision, "series_keys": []}]}
        preview = catalog.preview(full_request)
        require(len(preview["series"]) == 8 and preview["row_count"] == 544,
                "Use the supplied eight-series, 544-observation ECB example packet")
        require(not [i for i in preview["issues"] if i["severity"] == "error"],
                "The actual source has unresolved publication compatibility errors")
        full = catalog.save_edition(full_request)
        require(catalog.save_edition(full_request) == full, "An exact save retry changed the retained edition")
        usd_keys = sorted(s["series_key"] for s in full["series"]
                          if s["dimensions"].get("CURRENCY") == "USD")
        usd_request = {"operation_id": "macrobond-ecb-usd-v1", "title": "ECB 2025 USD customer selection",
                       "notes": "Customer subscription selection from the same unmodified retained source.",
                       "members": [{"project_id": project_id, "revision": revision, "series_keys": usd_keys}]}
        usd = catalog.save_edition(usd_request)
        comparison = catalog.compare(full["edition"]["id"], usd["edition"]["id"])
        require(comparison["series_counts"] == {"added": 0, "removed": 4, "changed": 0, "unchanged": 4}
                and comparison["observation_counts"] == {"added": 0, "removed": 272, "changed": 0, "unchanged": 272},
                "The customer selection differs from its original source comparison")
        targets = [full["edition"]["id"], usd["edition"]["id"], full["edition"]["id"]]
        state = catalog.state()
        require(state["revision"] <= 3 and
                [e["current"] for e in state["publications"]] == targets[:state["revision"]],
                "This operation's existing publication history differs; preserve it for its operator")
        for target in targets[state["revision"]:]:
            state = catalog.activate(target, state["revision"], state["current"])
        require(catalog.activate(targets[-1], 2, targets[-2])["revision"] == 3,
                "The exact publication retry created another event")
        progress("customer_editions_published", editions=2, publication_revision=state["revision"])
        result["catalog_id"] = state["workspace"]["id"]
        result["full_edition"] = full["edition"]["id"]
        result["usd_edition"] = usd["edition"]["id"]
        result["compatibility_warnings"] = [i for i in preview["issues"] if i["severity"] == "warning"]
        result["comparison"] = comparison
        result["publication_history"] = state["publications"]
        result["source_provider"] = provider_operation(catalog, full, operation / "source-provider.json")
        exported = catalog.export_packet(full["edition"]["id"], operation / "ecb-reference-rates.macrobond.zip")
        result["catalog_packet"] = {key: exported[key] for key in
                                    ("path", "bytes", "sha256", "edition_count", "publication_count", "source_project_count")}
        progress("provider_and_export_completed", series=8, observations=544,
                 packet_bytes=exported["bytes"], packet_sha256=exported["sha256"])

    with Catalog(receiving_path, create=not receiving_path.exists()) as receiving:
        received = receiving.import_catalog(exported["path"])
        receiving.source.native.close()
        require(received["workspace"]["id"] == result["catalog_id"]
                and received["revision"] == 3 and received["current"] == result["full_edition"]
                and received["publications"] == result["publication_history"]
                and len(received["editions"]) == 2, "Receiving changed the catalog's original state")
        require(receiving.edition(result["full_edition"]) == full
                and receiving.edition(result["usd_edition"]) == usd, "Receiving changed a saved customer edition")
        result["receiving_provider"] = provider_operation(receiving, full, operation / "receiving-provider.json")
        require(result["receiving_provider"]["wire_sha256"] == result["source_provider"]["wire_sha256"],
                "The receiving provider's actual HTTP data differs")
        require(receiving.import_catalog(exported["path"])["revision"] == 3,
                "Exact packet recovery changed the original publication history")
        receiving.source.native.close()
    with Catalog(receiving_path) as reopened:
        state = reopened.state()
        require(state["current"] == result["full_edition"] and state["revision"] == 3,
                "The receiving publication did not survive a full process close/reopen")
        result["receiving_reopened"] = {"catalog_id": state["workspace"]["id"],
                                        "current": state["current"], "revision": state["revision"]}
    result["completed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result["implementation_sha256"] = {name: sha256(source_root / "macrobond" / name)
                                        for name in ("catalog.py", "server.py", "connection.py")}
    write(completed, wire_json(result))
    progress("complete", result=str(completed), catalog_packet=result["catalog_packet"],
             receiving_catalog=str(receiving_path), series=8, observations=544)


if __name__ == "__main__":
    main()
