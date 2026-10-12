"""MIT. Receive complete native handoffs through the installed original engines."""
from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import zipfile

from domain import (InputError, canonical, digest, entity_key, parse, require, sha,
                    shape, decimal_amount)

HERE = Path(__file__).resolve().parent
SDK = HERE.parent
PROJECTION = "stellar-forge.grant-portfolio-native-projection.v1"


def file_info(path):
    hasher, size = hashlib.sha256(), 0
    with Path(path).open("rb") as stream:
        while block := stream.read(1024 * 1024):
            hasher.update(block)
            size += len(block)
    return {"sha256": hasher.hexdigest(), "bytes": size}


def tokens(value):
    result = {value} if value else set()
    for item in re.split(r"[^A-Za-z0-9]+", value):
        if len(item) >= 6 and any(char.isdigit() for char in item):
            result.add(item)
    return sorted(result)


def native_rows(query, build):
    """Read every native page with the source engine's own cursor and row count."""
    count, cursor, seen = 0, None, set()
    while True:
        params = {"limit": "50"}
        if cursor is not None:
            params["cursor"] = cursor
        response = query(build["id"], params)
        require(response.get("status") == 200, "Original native query did not complete")
        body = response["body"]
        fields = body.get("fields")
        if isinstance(fields, list):
            fields = [item["name"] if isinstance(item, dict) else item for item in fields]
        rows = body.get("rows")
        require(isinstance(rows, list), "Original native query did not return its complete page")
        for raw in rows:
            if isinstance(raw, list):
                require(isinstance(fields, list) and len(fields) == len(raw), "Native row and field widths differ")
                row = dict(zip(fields, raw))
            else:
                require(isinstance(raw, dict), "Invalid original native row")
                row = raw
            require(all(isinstance(value, str) for value in row.values()),
                    "The original string projection changed its value representation")
            count += 1
            yield row
        cursor = body.get("page", {}).get("nextCursor")
        if not cursor:
            break
        require(cursor not in seen and rows, "Original native pagination repeated or failed to progress")
        seen.add(cursor)
    require(count == build["rowCount"], "Complete projection count differs from the original native build")


def xml_text(node):
    if isinstance(node, str):
        return node
    return " ".join(xml_text(child) for child in node.get("content", []))


def organizations():
    return {}


def add_org(registry, standard, original, parent, role):
    if standard == "iati":
        ident = original.get("attributes", {}).get("ref", "")
        name = xml_text(original).strip()
    else:
        ident, name = original.get("id", ""), original.get("name", "")
    # An absent identifier remains local to this exact source organization value.
    original_id = ident or "unidentified:" + digest(original)
    key = entity_key("organization", original_id)
    row = registry.setdefault(key, {"entityKey": key, "kind": "organization",
        "standard": standard, "originalId": ident, "title": name or ident or "Unnamed organization",
        "variants": {}, "members": set()})
    row["variants"][digest(original)] = original
    row["members"].add((parent, role))
    return key


def emit_orgs(registry, output):
    for key, row in sorted(registry.items()):
        original = {"variants": [value for _, value in sorted(row.pop("variants").items())],
                    "members": [{"entityKey": entity, "role": role} for entity, role in sorted(row.pop("members"))]}
        row.update(original=original, sha256=digest(original), referenceTokens=tokens(row["originalId"]))
        output.write(canonical(row))


def stable_build(build):
    return {key: build[key] for key in ("id", "source", "plan", "rowCount", "keys", "columns")
            if key in build} | {"nativeSnapshot": build.get("native", {}).get("snapshot")}


def project_iati(packet, native_root, selection, entities, financial):
    sys.path[:0] = [str(SDK / "iati"), str(SDK / "xml")]
    from iati_workspace import IatiWorkspace
    from iati_source import walk, node_object, text_child, financial_dimensions
    shape(selection, ("portfolioId", "revision"))
    registry, selected_builds = organizations(), []
    with IatiWorkspace(native_root, create=not native_root.exists()) as native:
        received = native.receive_portfolio(packet)
        selected = received["portfolio"]
        if "portfolioId" in selection:
            require(selection["portfolioId"] == selected["id"], "Select the portfolio carried by the original handoff")
        if "revision" in selection:
            selected = native.portfolio(selected["id"], selection["revision"])
        # Keep source complete records in a temporary index, rather than an all-XML memory tree.
        index_path = native_root / "grant-portfolio-original-records.sqlite"
        if index_path.exists():
            index_path.unlink()
        index = sqlite3.connect(index_path)
        try:
            index.execute("CREATE TABLE activity(source TEXT,id TEXT,body BLOB,PRIMARY KEY(source,id))")
            with zipfile.ZipFile(packet) as outer:
                for edition in selected["editions"]:
                    build = edition["activities"]
                    with tempfile.TemporaryFile(dir=native_root) as nested:
                        with outer.open("packets/" + build["id"] + ".zip") as stream:
                            shutil.copyfileobj(stream, nested, 1024 * 1024)
                        nested.seek(0)
                        with zipfile.ZipFile(nested) as inner, inner.open("source.iati") as source:
                            def accept(activity, _ordinal):
                                ident = text_child(activity, "iati-identifier")
                                index.execute("INSERT INTO activity VALUES(?,?,?)",
                                              (edition["source"], ident, canonical(node_object(activity))))
                            walk(source, accept)
                    index.commit()
                    for row in native_rows(native.query, build):
                        key = entity_key("activity", row["activity_id"])
                        complete = index.execute("SELECT body FROM activity WHERE source=? AND id=?",
                                                 (edition["source"], row["activity_id"])).fetchone()
                        require(complete is not None, "Original activity is missing from the retained XML")
                        original = {"native": row, "activity": parse(complete[0])}
                        org_keys = []
                        for field, role in (("reporting_org_json", "reporting"), ("participating_orgs_json", "participating")):
                            for org in parse(row[field]):
                                org_keys.append(add_org(registry, "iati", org, key, role))
                        entities.write(canonical({"entityKey": key, "kind": "activity", "standard": "iati",
                            "originalId": row["activity_id"], "title": row["title"], "nativeSource": edition["source"],
                            "nativeBuild": build["id"], "original": original, "sha256": digest(original),
                            "organizationKeys": sorted(set(org_keys)), "referenceTokens": tokens(row["activity_id"])}))
                    selected_builds.append({"collection": "activities", **stable_build(build)})
                    for collection in ("transactions", "budgets"):
                        current = edition[collection]
                        for row in native_rows(native.query, current):
                            financial.write(canonical({"rowKey": digest([edition["source"], collection, row["row_id"]]),
                                "entityKey": entity_key("activity", row["activity_id"]), "standard": "iati",
                                "kind": collection, "originalId": row["row_id"], "value": row["value_decimal"] or None,
                                "currency": row["currency"], "eligible": row["financial_eligible"] == "true",
                                "dimensions": financial_dimensions(row, collection), "nativeSource": edition["source"],
                                "nativeBuild": current["id"], "original": row}))
                        selected_builds.append({"collection": collection, **stable_build(current)})
            emit_orgs(registry, entities)
            return {"standard": "iati", "portfolioId": selected["id"], "revision": selected["revision"],
                    "definitionSha256": selected["definitionSha256"], "selection": selected["selection"],
                    "builds": selected_builds, "report": native.report(selected["id"], selected["revision"]),
                    "sourceHistoryCount": received["historyCount"], "reconstructed": received["reconstructed"]}
        finally:
            index.close()
            index_path.unlink(missing_ok=True)


def project_giving(packet, native_root, selection, entities, financial):
    require(packet.stat().st_size <= 1024 * 1024 * 1024, "The original 360Giving operator packet limit is 1 GiB")
    shape(selection, ("build",))
    kind = selection.get("build", "original")
    require(kind in {"original", "candidate"}, "Select the original or explicit reviewed candidate build")
    path = SDK / "ndjson" / "360giving" / "operator" / "publisher_workspace.py"
    spec = importlib.util.spec_from_file_location("grant_portfolio_native_giving", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    registry = organizations()
    with module.PublisherWorkspace(native_root, create=not native_root.exists()) as native:
        with packet.open("rb") as stream:
            uploaded = native.upload(stream)
        request_id = "receive-" + uploaded["sha256"]
        native.admit(request_id, "receive", {"object": uploaded["sha256"]})
        received = native.execute(request_id)["result"]
        require(kind in received["builds"], "The complete handoff does not contain the selected native build")
        build = received["builds"][kind]
        query = lambda ident, params: native.query(received["dataset"], ident, params)
        for row in native_rows(query, build):
            key = entity_key("grant", row["grant_id"])
            # original_grant remains exact JSON text: no conversion through float.
            original = {"native": row, "grantJson": row["original_grant"]}
            org_keys = []
            for field, role in (("funders", "funding"), ("recipients", "recipient")):
                for org in parse(row[field]):
                    org_keys.append(add_org(registry, "360giving", org, key, role))
            entities.write(canonical({"entityKey": key, "kind": "grant", "standard": "360giving",
                "originalId": row["grant_id"], "title": row["title"], "nativeBuild": build["id"],
                "original": original, "sha256": digest(original), "organizationKeys": sorted(set(org_keys)),
                "referenceTokens": tokens(row["grant_id"])}))
            for field, meaning in (("amount_awarded", "award"), ("amount_applied_for", "application-request")):
                value = row[field] if row[field] != "" else None
                valid = decimal_amount(value) is not None
                currency = row["currency"]
                financial.write(canonical({"rowKey": digest([row["grant_id"], meaning]), "entityKey": key,
                    "standard": "360giving", "kind": meaning, "originalId": row["grant_id"],
                    "value": value, "currency": currency,
                    "eligible": valid and bool(re.fullmatch(r"[A-Z]{3}", currency)),
                    "dimensions": {"currency": currency, "awardDate": row["award_date"],
                                   "valueMeaning": meaning},
                    "nativeBuild": build["id"], "original": {field: row[field], "currency": currency,
                        "award_date": row["award_date"], "amount_applied_state": row["amount_applied_state"],
                        "funders": row["funders"], "recipients": row["recipients"],
                        "original_grant": row["original_grant"]}}))
        emit_orgs(registry, entities)
        return {"standard": "360giving", "editionId": received["editionId"],
                "dataset": received["dataset"], "buildSelection": kind, "builds": [stable_build(build)],
                "sourceWorkspaceId": received["sourceWorkspaceId"], "sourceRequest": received["sourceRequest"],
                "comparison": received["comparison"], "reconstructed": True}


def project(packet, standard, selection, output):
    packet, output = Path(packet).resolve(strict=True), Path(output).absolute()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    specification = {"schema": PROJECTION, "packet": file_info(packet), "standard": standard, "selection": selection}
    selected_path, receipt_path = output / "selection.json", output / "native-receipt.json"
    if selected_path.exists():
        require(parse(selected_path.read_bytes()) == specification, "Original source operation selected different input")
    else:
        selected_path.write_bytes(canonical(specification))
        selected_path.chmod(0o600)
    if receipt_path.exists():
        receipt = parse(receipt_path.read_bytes())
        require(receipt["selection"] == specification, "Retained projection selects a different source")
        for name, expected in receipt["files"].items():
            require(file_info(output / name) == expected, "The retained complete native projection changed")
        return receipt
    runner = project_iati if standard == "iati" else project_giving if standard == "360giving" else None
    require(runner is not None, "Select IATI or 360Giving")
    with (output / "entities.jsonl").open("wb") as entities, (output / "financial.jsonl").open("wb") as financial:
        with redirect_stdout(io.StringIO()):
            native = runner(packet, output / "native", selection, entities, financial)
        for stream in (entities, financial):
            stream.flush()
            os.fsync(stream.fileno())
    from managed import sourceFileList
    original_source = {name: file_info(SDK / name)["sha256"] for name in sourceFileList()}
    receipt = {"schema": PROJECTION, "selection": specification, "native": native,
               "program": original_source,
               "files": {name: file_info(output / name) for name in ("entities.jsonl", "financial.jsonl")}}
    pending = receipt_path.with_suffix(".pending")
    pending.write_bytes(canonical(receipt))
    pending.chmod(0o600)
    os.replace(pending, receipt_path)
    return receipt


def run_projection(packet, standard, selection, output):
    """One separate process per original engine; never mix their workspace modules."""
    command = [sys.executable, str(HERE / "native_sources.py"), "--worker", "--packet", str(packet),
               "--standard", standard, "--selection", canonical(selection).decode(), "--output", str(output)]
    result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    if result.returncode:
        raise InputError("Original native receiving failed: " + result.stderr[-12000:],
                         "NATIVE_RECEIVING_FAILED", 422)
    receipt = parse((Path(output) / "native-receipt.json").read_bytes())
    require(receipt["selection"]["packet"] == file_info(packet), "Original source bytes changed during receiving")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--packet", required=True)
    parser.add_argument("--standard", choices=("iati", "360giving"), required=True)
    parser.add_argument("--selection", default="{}")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(project(args.packet, args.standard, parse(args.selection), args.output)))
    except Exception as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        sys.exit(1)
