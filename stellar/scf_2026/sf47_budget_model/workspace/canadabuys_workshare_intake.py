"""Source-native CanadaBuys Workshares for the existing Grant Installation reader.

The original package and every Workshare edition remain complete. This module
normalizes explicit phase allocations for the existing Installation engine. It
does not create DealScout cases, convert currency, infer commercial acceptance,
or dispatch payment, source acquisition, or delivery jobs.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import csv
from decimal import Decimal, localcontext
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tempfile

SCHEMA = "stellar-forge.canadabuys-workshare-source.v1"
SELECTION = "stellar-forge.canadabuys-workshare-selection.v1"
PLAN = "stellar-forge.canadabuys-native-workshare-plan.v1"
PACKAGE = "starforge.canadabuys.package.v2"
RECEIVING = "stellar-forge.installation-workshare-receiving.v1"
MAX_FILE = 8 * 1024 * 1024
SAFE_INTEGER = 9007199254740991


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def same(left, right):
    return canonical(left) == canonical(right)


def object_bytes(raw, label):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, label + " repeats JSON member " + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError(label + " needs finite JSON values: " + value)
    result = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    require(isinstance(result, dict), label + " must be a complete JSON object.")
    return result


def integer(value, label, minimum=0, maximum=SAFE_INTEGER):
    require(type(value) is int and minimum <= value <= maximum,
            label + " must retain its original exact integer.")
    return value


def text(value, label, maximum=131072, empty=False):
    require(isinstance(value, str) and len(value) <= maximum
            and (empty or bool(value.strip())), label + " must retain complete explicit text.")
    return value


def decimal(value, label):
    require(not isinstance(value, bool) and isinstance(value, (str, int, float)),
            label + " must be an explicit nonnegative decimal.")
    require(len(str(value)) <= 180, label + " exceeds the complete native decimal bound.")
    result = Decimal(str(value))
    require(result.is_finite() and result >= 0, label + " must be finite and nonnegative.")
    return result


def hours(value, label):
    number = decimal(value, label)
    require(number <= 1000000, label + " exceeds the original native limit.")
    return str(number)


def cents(value):
    integer(value, "Original cents")
    return str(value // 100) + "." + str(value % 100).zfill(2)


def exact(value, required, optional=(), label="Selection"):
    require(isinstance(value, dict) and set(required) <= set(value)
            and set(value) <= set(required) | set(optional),
            label + " must retain its complete declared fields.")
    return value


def indexed(rows, key, label, limit=1000):
    require(isinstance(rows, list) and len(rows) <= limit,
            label + " must retain all original rows within the native limit.")
    result = {}
    for row in rows:
        require(isinstance(row, dict), label + " has an incomplete row.")
        ident = text(row.get(key), label + " identity", 500)
        require(ident not in result, label + " repeats an original identity.")
        result[ident] = row
    return result


def original_edition(value):
    required = ("title", "status", "partner", "owner", "availableFrom", "scope",
                "deliverables", "partnerResponsibilities", "inputs", "acceptance", "note",
                "currency", "feeCents", "estimatedHours", "partnerHours", "deliveryDays",
                "milestones", "costs", "totals", "id", "noticeId", "revision", "createdAt",
                "updatedAt", "operator", "sourceContext")
    exact(value, required, label="Original native Workshare edition")
    require(re.fullmatch(r"workshare-[a-f0-9-]{36}", value["id"]) is not None,
            "Keep the original native Workshare UUID.")
    integer(value["revision"], "Original revision", 1)
    for field in ("title", "partner", "owner", "availableFrom", "scope", "deliverables",
                  "partnerResponsibilities", "inputs", "acceptance", "note"):
        text(value[field], "Original " + field, empty=True)
    require(value["status"] in ("draft", "ready", "partner-review", "agreed",
                               "delivering", "completed", "passed"),
            "Retain the original native status.")
    require(isinstance(value["currency"], str)
            and re.fullmatch(r"[A-Z]{3}", value["currency"]) is not None,
            "Retain the original currency without conversion.")
    integer(value["feeCents"], "Original fee cents")
    integer(value["deliveryDays"], "Original delivery days", 0, 1000000)
    for field in ("estimatedHours", "partnerHours"):
        require(type(value[field]) in (int, float), "Retain the native numeric " + field + ".")
        hours(value[field], field)
    milestone_rows = indexed(value["milestones"], "id", "Original milestones")
    cost_rows = indexed(value["costs"], "id", "Original costs")
    for row in milestone_rows.values():
        exact(row, ("id", "title", "amountCents", "due", "acceptance"), label="Original milestone")
        for field in ("id", "title", "due", "acceptance"):
            text(row[field], "Original milestone " + field, empty=True)
        integer(row["amountCents"], "Original milestone cents")
    for row in cost_rows.values():
        exact(row, ("id", "title", "amountCents"), label="Original cost")
        text(row["title"], "Original cost title", empty=True)
        integer(row["amountCents"], "Original cost cents")
    totals = {"feeCents": value["feeCents"],
              "milestoneCents": sum(row["amountCents"] for row in milestone_rows.values()),
              "costCents": sum(row["amountCents"] for row in cost_rows.values()),
              "marginBeforeLaborCents": value["feeCents"] - sum(row["amountCents"] for row in cost_rows.values()),
              "currency": value["currency"]}
    require(same(value["totals"], totals)
            and abs(totals["marginBeforeLaborCents"]) <= SAFE_INTEGER
            and totals["milestoneCents"] <= SAFE_INTEGER and totals["costCents"] <= SAFE_INTEGER,
            "Original Workshare totals must agree with its unchanged exact cents.")
    return value


def original_source_entry(packet, entry, workshare):
    require(isinstance(entry, dict), "Retain the complete original source row.")
    context = workshare["sourceContext"]
    exact(context, ("entryId", "sourceId", "rowSha256", "summary"), label="Original source context")
    sources = indexed(packet.get("sources"), "id", "Original source package", 20000)
    require(context["sourceId"] in sources, "Original source bytes are missing from the package.")
    source = sources[context["sourceId"]]
    raw = text(source.get("rawText"), "Complete source CSV", MAX_FILE).encode("utf-8")
    require(source.get("sha256") == sha(raw) and source.get("bytes") == len(raw),
            "Original CSV bytes differ from their retained source.")
    stream = source.get("stream")
    require(isinstance(stream, str) and stream.endswith("tenders"),
            "The Workshare must retain its original tender source.")
    require(source["id"] == "source-" + sha((stream + "\n" + sha(raw)).encode()),
            "The original source identity differs.")
    csv.field_size_limit(MAX_FILE)
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
    try:
        columns = next(reader)
    except StopIteration as error:
        raise ValueError("Original CSV is missing its complete header.") from error
    require(columns and all(columns) and len(columns) == len(set(columns))
            and columns == source.get("columns"), "Original source columns differ.")
    number = integer(entry.get("rowNumber"), "Original source row", 2)
    selected, count = None, 0
    for index, values in enumerate(reader, 2):
        count += 1
        require(len(values) == len(columns), "Original CSV has an incomplete source record.")
        if index == number:
            selected = dict(zip(columns, values))
    require(selected is not None and source.get("rowCount") == count
            and same(entry.get("row"), selected), "The complete selected CSV row differs.")
    # Native core.canonical sorts JavaScript UTF-16 code units. CSV values are
    # strings, so preserve that exact native row identity even for astral headers.
    ordered_row = {key: selected[key] for key in sorted(selected, key=lambda key: key.encode("utf-16-be"))}
    row_sha = sha(json.dumps(ordered_row, ensure_ascii=False, separators=(",", ":")).encode())
    entry_id = "entry-" + sha((source["id"] + "\n" + str(number)).encode())[:32]
    require(entry.get("id") == entry_id == context["entryId"]
            and entry_id in source.get("entryIds", [])
            and entry.get("sourceId") == source["id"]
            and entry.get("rowSha256") == row_sha == context["rowSha256"]
            and entry.get("noticeId") == workshare["noticeId"]
            and entry.get("kind") == "tender"
            and same(entry.get("summary"), context["summary"]),
            "The native Workshare's original source context differs from the retained source row.")


def allocated_phases(selection, source_row, workshare):
    with localcontext() as context:
        context.prec = 240
        return _allocated_phases(selection, source_row, workshare)


def _allocated_phases(selection, source_row, workshare):
    selected = indexed(selection["phases"], "id", "Selected delivery phases", 100)
    require(bool(selected), "Retain explicit delivery phases.")
    supplied = indexed(source_row["phases"], "id", "Prepared delivery phases", 100)
    require(list(selected) == list(supplied), "The prepared phases changed original selection order.")
    milestones = indexed(workshare["milestones"], "id", "Original payment milestones")
    require(bool(milestones), "Enter complete milestones in the original native Workshare.")
    used, phases, effort, elapsed = set(), [], {}, {}
    parties = exact(selection["parties"], ("customer", "supplier", "basis"), label="Explicit parties")
    for key in parties:
        text(parties[key], "Selected " + key, 4000 if key == "basis" else 1000)
    schedule = exact(selection["schedule"], ("businessDays", "basis", "startConditions"), label="Working-day selection")
    integer(schedule["businessDays"], "Selected working days", 1, 1000000)
    text(schedule["basis"], "Original delivery-day interpretation", 4000)
    require(isinstance(schedule["startConditions"], list) and len(schedule["startConditions"]) <= 100,
            "Retain explicit commencement conditions.")
    for condition in schedule["startConditions"]:
        text(condition, "Commencement condition", 4000)
    production_total, partner_total = Decimal(0), Decimal(0)
    for ident, phase in selected.items():
        exact(phase, ("id", "title", "milestoneIds", "productionHours", "partnerHours", "businessDays",
                      "owner", "dependsOn", "deliverables", "acceptance", "inputs"), label="Original phase selection")
        for field in ("id", "title", "owner", "deliverables", "acceptance", "inputs"):
            text(phase[field], "Selected phase " + field, 4000)
        require(isinstance(phase["milestoneIds"], list) and bool(phase["milestoneIds"]),
                "Select the original milestones for each phase.")
        original_milestones = []
        for milestone_id in phase["milestoneIds"]:
            require(milestone_id in milestones and milestone_id not in used,
                    "Map every original milestone exactly once.")
            used.add(milestone_id)
            original_milestones.append(milestones[milestone_id])
        parents = phase["dependsOn"]
        require(isinstance(parents, list) and all(isinstance(parent, str) for parent in parents)
                and len(set(parents)) == len(parents) and ident not in parents
                and set(parents) <= set(selected), "Retain distinct selected phase dependencies.")
        duration = integer(phase["businessDays"], "Phase working days", 1, schedule["businessDays"])
        require(isinstance(phase["productionHours"], str) and isinstance(phase["partnerHours"], str),
                "Retain the operator's explicit decimal effort strings.")
        production = decimal(phase["productionHours"], "Phase production hours")
        partner = decimal(phase["partnerHours"], "Phase partner hours")
        production_total += production
        partner_total += partner
        amount = sum(milestone["amountCents"] for milestone in original_milestones)
        expected = {**phase, "productionHours": supplied[ident].get("productionHours"),
                    "partnerHours": supplied[ident].get("partnerHours"), "amountCents": amount,
                    "currency": workshare["currency"], "milestones": original_milestones}
        require(same(supplied[ident], expected)
                and decimal(supplied[ident]["productionHours"], "Prepared effort") == production
                and decimal(supplied[ident]["partnerHours"], "Prepared partner effort") == partner,
                "Prepared phases differ from the original explicit allocation.")
        phases.append({
            "id": ident, "title": phase["title"], "owner": phase["owner"],
            "description": phase["deliverables"] + "\nInputs: " + phase["inputs"],
            "acceptance": phase["acceptance"], "depends_on": deepcopy(parents),
            "business_days": duration, "native_milestone_ids": deepcopy(phase["milestoneIds"]),
            "amount_cents": amount, "currency": workshare["currency"],
            "partner_hours": str(partner)})
        effort[ident] = str(production)
    require(used == set(milestones)
            and sum(row["amountCents"] for row in milestones.values()) == workshare["feeCents"],
            "Complete original milestones must retain the complete quoted fee.")
    require(production_total == decimal(workshare["estimatedHours"], "Original production hours")
            and partner_total == decimal(workshare["partnerHours"], "Original partner hours"),
            "Explicit phase effort must equal the original production and partner totals.")
    visiting = set()
    def end(ident):
        require(ident not in visiting, "Selected phase dependencies contain a cycle.")
        if ident in elapsed:
            return elapsed[ident]
        visiting.add(ident)
        row = selected[ident]
        value = max((end(parent) for parent in row["dependsOn"]), default=0) + row["businessDays"]
        require(value <= schedule["businessDays"], "Selected phase critical path exceeds selected working days.")
        elapsed[ident] = value
        visiting.remove(ident)
        return value
    for ident in selected:
        end(ident)
    return phases, effort, str(production_total), str(partner_total)


def load_native_workshares(commissioning, packet, *, packet_bytes=None, require_proposed_usd=False):
    require(commissioning.get("schema") == SCHEMA, "Select the native CanadaBuys commissioning source.")
    require(not require_proposed_usd,
            "Native CanadaBuys Installation intake preserves original currency/status; "
            "the USD proposed-work forecast requires its separately entered original commercial contract.")
    require(isinstance(packet_bytes, bytes) and len(packet_bytes) <= MAX_FILE,
            "Retain the original complete CanadaBuys package bytes with native intake.")
    require(same(object_bytes(packet_bytes, "Original package"), packet),
            "The original parsed package differs from its retained bytes.")
    exact(commissioning, ("schema", "operationId", "requestPrefix", "receivingName", "sourceUrl",
                         "observedAt", "selection", "selectionBodyBase64", "originalPackage",
                         "nativeValidation", "workshares"), label="Native commissioning source")
    binding = commissioning["originalPackage"]
    require(isinstance(binding, dict) and binding.get("bytes") == len(packet_bytes)
            and binding.get("sha256") == sha(packet_bytes)
            and binding.get("packageId") == packet.get("packageId")
            and same(binding.get("workspace"), packet.get("workspace"))
            and binding.get("schema") == packet.get("schema") == PACKAGE,
            "The original package binding differs from complete retained bytes.")
    require(isinstance(packet.get("packageId"), str)
            and re.fullmatch(r"[a-f0-9]{64}", packet["packageId"]) is not None,
            "Keep the original native package identity.")
    selected_raw = base64.b64decode(commissioning["selectionBodyBase64"], validate=True)
    require(len(selected_raw) <= MAX_FILE and commissioning["selection"] ==
            {"filename": "SOURCE_SELECTION.json", "bytes": len(selected_raw), "sha256": sha(selected_raw)},
            "Original selection bytes differ.")
    selected = object_bytes(selected_raw, "Original native selection")
    exact(selected, ("schema", "operationId", "requestPrefix", "receivingName", "sourceUrl",
                     "observedAt", "package", "workshares"), label="Original native selection")
    require(selected.get("schema") == SELECTION
            and all(same(selected.get(key), commissioning.get(key))
                    for key in ("operationId", "requestPrefix", "receivingName", "sourceUrl", "observedAt")),
            "The native source differs from the original selected operation.")
    expected_package = {key: binding[key] for key in ("filename", "bytes", "sha256", "packageId")}
    expected_package.update({"workspaceId": packet["workspace"]["id"],
                             "workspaceRevision": packet["workspace"]["revision"]})
    require(same(selected.get("package"), expected_package), "The original package selection differs.")
    selections = indexed(selected.get("workshares"), "workshareId", "Selected Workshares", 20)
    sources = indexed(commissioning.get("workshares"), "workshareId", "Prepared native Workshares", 20)
    originals = indexed(packet.get("workshares"), "id", "Original packaged Workshares", 20000)
    require(bool(selections) and list(sources) == list(selections)
            and set(selections) <= set(originals), "Retain every selected original Workshare once.")
    result = []
    for ident, choice in selections.items():
        source_row, original = sources[ident], originals[ident]
        exact(choice, ("workshareId", "revision", "workshareSha256", "profile", "mappingNote",
                       "parties", "schedule", "phases"), ("bindings",), "Native Workshare selection")
        require(choice["profile"] == "canadabuys-bidder-desk", "Select the installed CanadaBuys profile.")
        text(choice["mappingNote"], "Original phase mapping basis", 4000)
        require(same(source_row.get("nativeHead"), original), "The complete native Workshare history differs.")
        history = original.get("history")
        require(isinstance(history, list) and bool(history)
                and len(history) == integer(original.get("revision"), "Native head revision", 1),
                "Keep every original Workshare edition from revision one.")
        for number, edition in enumerate(history, 1):
            original_edition(edition)
            require(edition["id"] == ident and edition["revision"] == number
                    and edition["noticeId"] == original["noticeId"]
                    and same(edition["sourceContext"], original["sourceContext"]),
                    "Original Workshare history changed its identity or source.")
        head = {key: value for key, value in original.items() if key != "history"}
        require(same(history[-1], head), "Native current head differs from its final original edition.")
        number = integer(choice["revision"], "Selected native revision", 1, len(history))
        workshare = history[number - 1]
        exact_text = source_row.get("selectedEditionCanonical")
        require(isinstance(exact_text, str)
                and same(object_bytes(exact_text.encode(), "Selected native edition"), workshare)
                and sha(exact_text.encode()) == choice["workshareSha256"] == source_row.get("workshareSha256")
                and same(source_row.get("selectedEdition"), workshare)
                and source_row.get("selectedRevision") == number,
                "The selected complete native edition or its original serialized identity differs.")
        for key in ("profile", "mappingNote", "parties", "schedule"):
            require(same(source_row.get(key), choice[key]), "Original " + key + " mapping differs.")
        require(("bindings" in source_row) == ("bindings" in choice)
                and same(source_row.get("bindings"), choice.get("bindings")),
                "Original Installation binding selection differs.")
        original_source_entry(packet, source_row.get("sourceEntry"), workshare)
        phases, effort, production, partner = allocated_phases(choice, source_row, workshare)
        milestones = [{"id": row["id"], "label": row["title"], "amount": cents(row["amountCents"]),
                       "trigger": "Due: " + row["due"] + "\nAcceptance: " + row["acceptance"],
                       "original_due": row["due"], "original_acceptance": row["acceptance"],
                       "amount_cents": row["amountCents"]} for row in workshare["milestones"]]
        plan = {
            "version": PLAN, "title": workshare["title"],
            "customer": choice["parties"]["customer"], "supplier": choice["parties"]["supplier"],
            "outcome": workshare["scope"] + "\nDeliverables: " + workshare["deliverables"]
                       + "\nAcceptance: " + workshare["acceptance"],
            "commercial": {"currency": workshare["currency"], "amount": cents(workshare["feeCents"]),
                           "price_status": "RECORDED_NATIVE_" + workshare["status"].upper(),
                           "status_basis": "Original native record status; agreement and payment are not inferred.",
                           "source_url": commissioning["sourceUrl"], "milestones": milestones},
            "schedule": {"business_days": choice["schedule"]["businessDays"],
                         "start_conditions": deepcopy(choice["schedule"]["startConditions"]),
                         "basis": choice["schedule"]["basis"],
                         "original_delivery_days": workshare["deliveryDays"],
                         "original_available_from": workshare["availableFrom"]},
            "phases": phases,
            "native": {"workshareId": ident, "revision": number,
                       "workshareSha256": choice["workshareSha256"],
                       "sourcePackageId": packet["packageId"], "originalStatus": workshare["status"],
                       "originalFeeCents": workshare["feeCents"],
                       "productionHours": production, "partnerHours": partner,
                       "partyMapping": deepcopy(choice["parties"]), "phaseMappingNote": choice["mappingNote"],
                       "originalCosts": deepcopy(workshare["costs"]),
                       "originalPartner": workshare["partner"], "originalOwner": workshare["owner"],
                       "originalPartnerResponsibilities": workshare["partnerResponsibilities"],
                       "originalInputs": workshare["inputs"], "originalNote": workshare["note"]}}
        result.append({
            "caseId": ident, "planSha256": sha(canonical(plan).encode()),
            "source": {"kind": "canadabuys-native-workshare", "case_id": ident,
                       "workspace": deepcopy(packet["workspace"]), "package": deepcopy(binding),
                       "workshareRevision": number, "workshareSha256": choice["workshareSha256"],
                       "sourceContext": deepcopy(workshare["sourceContext"]),
                       "selection": deepcopy(commissioning["selection"])},
            "plan": plan, "effort": effort, "hours": production, "phaseCount": len(phases),
            "packetPresent": True, "originalCase": deepcopy(source_row)})
    return result


def stable_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE,
                "Retain a complete regular source within the original receiver bound.")
        raw = bytearray()
        while block := os.read(fd, 65536):
            raw.extend(block)
            require(len(raw) <= MAX_FILE, "The complete original file exceeds its receiving bound.")
        after, named = os.fstat(fd), os.lstat(path)
        require(all(getattr(before, key) == getattr(after, key)
                    for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"))
                and (after.st_dev, after.st_ino) == (named.st_dev, named.st_ino)
                and len(raw) == before.st_size, "Original source changed during intake.")
        return bytes(raw)
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def retain(path, raw):
    try:
        require(stable_file(path) == raw, "The original retained preparation differs: " + str(path))
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except FileNotFoundError:
        fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            try:
                os.link(name, path)
            except FileExistsError:
                require(stable_file(path) == raw, "A concurrent preparation selected different source bytes.")
        finally:
            os.unlink(name)
    sync_directory(path.parent)
    return {"filename": path.name, "bytes": len(raw), "sha256": sha(raw)}


def prepare(commissioning_path, packet_path, destination):
    original_raw, packet_raw = stable_file(commissioning_path), stable_file(packet_path)
    original, packet = object_bytes(original_raw, "Native source"), object_bytes(packet_raw, "Original package")
    rows = load_native_workshares(original, packet, packet_bytes=packet_raw)
    output = Path(os.path.abspath(destination))
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = output.lstat()
    require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077
            and info.st_uid == os.getuid() and output.resolve() == output,
            "Use a private original preparation directory without symbolic-link ancestors.")
    selected_raw = base64.b64decode(original["selectionBodyBase64"], validate=True)
    source_name = original["originalPackage"]["filename"]
    require(isinstance(source_name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", source_name)
            and source_name not in ("SOURCE_SELECTION.json", "CANADABUYS_NATIVE_WORKSHARES.json",
                                    "SUPPLIER_RECEIVING.json", "SOURCE_PREPARATION.json"),
            "Use a distinct original package filename.")
    selected_file = retain(output / "SOURCE_SELECTION.json", selected_raw)
    commissioning = retain(output / "CANADABUYS_NATIVE_WORKSHARES.json", original_raw)
    packet_file = retain(output / source_name, packet_raw)
    files = [
        {**commissioning, "role": "commissioning"},
        {**packet_file, "role": "packet"},
        {**selected_file, "role": "source"}]
    files = [{**row, "sourceUrl": original["sourceUrl"], "observedAt": original["observedAt"],
              "mediaType": "application/json"} for row in files]
    selected_rows = {row["workshareId"]: row for row in original["workshares"]}
    customers = []
    for row in rows:
        selected = selected_rows[row["caseId"]]
        customer = {"profile": selected["profile"], "workshareCaseId": row["caseId"],
                    "planSha256": row["planSha256"], "files": deepcopy(files)}
        if "bindings" in selected:
            customer["bindings"] = deepcopy(selected["bindings"])
        customers.append(customer)
    receiving = {"schema": RECEIVING, "requestPrefix": original["requestPrefix"],
                 "receivingName": original["receivingName"], "customers": customers}
    receiving_file = retain(output / "SUPPLIER_RECEIVING.json",
                            (json.dumps(receiving, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode())
    summary = {"schema": "stellar-forge.canadabuys-workshare-preparation.v1", "state": "PREPARED_SOURCE",
               "operationId": original["operationId"], "originalSources": files,
               "receiving": receiving_file,
               "nativeWorkshares": [{key: row[key] for key in
                                     ("caseId", "planSha256", "hours", "phaseCount", "packetPresent")}
                                    for row in rows],
               "sourceKind": "canadabuys-native-workshare",
               "commercialAcceptanceInferred": False, "paymentAction": False,
               "currencyConversion": False}
    receipt = retain(output / "SOURCE_PREPARATION.json",
                     (json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode())
    return {**summary, "output": {**receipt, "path": str(output / receipt["filename"])}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commissioning", required=True)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.commissioning, args.packet, args.out), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
