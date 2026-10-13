"""MIT. Complete original Monitoring Workspace archive intake for reviewer exchange.

This reader preserves native ZIP bytes and invokes the original complete receiving
path in an independent scratch Workspace. It does not merge a returned database,
provider request, case, source edition or cycle into the author's workspace.
The reviewer-exchange engine supplies its verified issued scope and owns adoption.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import zipfile

from model import InputError, PACKET, MAX_SOURCE, exact_id, text, json_bytes, load_json, sha, stable
import review_cycles

SCHEMA = "starforge.monitoring-review-workspace-snapshot.v1"
MAX_CASES = review_cycles.MAX_CASES
MAX_CYCLES = 1000


def _need(condition, message):
    if not condition:
        raise InputError(message)


def selection(value):
    _need(isinstance(value, dict) and set(value) == {"caseIds", "cycleIds"},
          "Use the exact issued native case and cycle selection")
    result = {}
    for key, maximum in (("caseIds", MAX_CASES), ("cycleIds", MAX_CYCLES)):
        ids = value[key]
        _need(isinstance(ids, list) and len(ids) <= maximum and
              all(isinstance(ident, str) for ident in ids) and len(set(ids)) == len(ids),
              "The issued scope must contain distinct original IDs within native limits")
        result[key] = sorted(exact_id(ident) for ident in ids)
    _need(result["caseIds"] or result["cycleIds"], "Select the actual issued native scope")
    return result


def _case(domain, ident, verified):
    value = domain._one("cases", ident)
    _need(not value.get("mergedInto"), "Select the original unmerged issued case")
    event = review_cycles.case_event(domain, value["revision"], verified)
    _need(stable(event["value"]) == stable(value), "The current case differs from its native decision history")
    history, cursor = [], value["revision"]
    while cursor is not None:
        item = review_cycles.case_event(domain, cursor, verified)
        _need(item["case"] == ident, "A retained predecessor belongs to another case")
        history.append(deepcopy(item))
        cursor = item["previous"]
    history.reverse()
    return {"case": deepcopy(value), "history": history}


def _bindings(domain, cases, cycles):
    # Native domain records are retained exactly by import. Native source registration
    # labels/timestamps may legitimately differ on receiving; only their stable
    # original content identity is projected here. The complete archive is retained.
    selected = {"portfolios": set(), "editions": set()}
    def include_case(value):
        selected["portfolios"].add(exact_id(value["portfolio"]))
        selected["editions"].add(exact_id(value["edition"]))
    for case in cases:
        for event in case["history"]:
            include_case(event["value"])
    for cycle in cycles:
        for value in cycle["state"]["basis"]["caseSnapshots"]:
            include_case(value)
        basis = cycle["state"]["basis"]
        comparison = basis["comparison"]
        kind = "portfolios" if basis.get("sourceKind") == "portfolio_refresh" else "editions"
        selected[kind].update((exact_id(comparison["before"]), exact_id(comparison["after"])))
    result = []
    for table in ("portfolios", "editions"):
        for ident in sorted(selected[table]):
            value = domain._one(table, ident)
            source = domain.ws.source(value["source"])
            _need(source["id"] == value["source"], "The native source binding differs")
            result.append({"kind": table, "id": ident, "record": deepcopy(value),
                           "source": {key: deepcopy(source[key]) for key in ("id", "bytes", "inventory")}})
    return result


def snapshot(domain, issued_selection):
    """Read the exact current original scope; no export, timestamp or state mutation."""
    scope = selection(issued_selection)
    with domain.mutex:
        states = review_cycles.replay(domain)
        verified = {}
        cases = [_case(domain, ident, verified) for ident in scope["caseIds"]]
        cycles = []
        cycle_rows = [load_json(row[0]) for row in domain.db.execute("SELECT body FROM os_cycle_events")] if scope["cycleIds"] else []
        for ident in scope["cycleIds"]:
            _need(ident in states, "The exact issued review cycle is absent")
            state = deepcopy(states[ident])
            history = sorted((row for row in cycle_rows if row["cycleId"] == ident), key=lambda row: row["version"])
            _need(history and history[-1]["result"]["revision"] == state["revision"],
                  "The original cycle head differs from its retained history")
            cycles.append({"state": state, "history": history})
        value = {"schema": SCHEMA, "selection": scope, "cases": cases, "cycles": cycles,
                 "sourceBindings": _bindings(domain, cases, cycles)}
        raw = json_bytes(value)
        _need(len(raw) <= review_cycles.MAX_STATE_BYTES, "The complete issued snapshot exceeds 96 MiB; select a smaller exact case/cycle scope")
        value["sha256"] = sha(raw)
        return value


def verify_snapshot(value):
    """Validate transport identity; the exchange engine still validates issued authority."""
    _need(isinstance(value, dict) and set(value) ==
          {"schema", "selection", "cases", "cycles", "sourceBindings", "sha256"} and value["schema"] == SCHEMA,
          "Select the complete original workspace review snapshot")
    _need(sha(json_bytes({key: item for key, item in value.items() if key != "sha256"})) == exact_id(value["sha256"]),
          "The original workspace review snapshot changed")
    _need(selection(value["selection"]) == value["selection"], "The snapshot selection changed")
    _need(isinstance(value["cases"], list) and isinstance(value["cycles"], list) and
          all(isinstance(item, dict) and set(item) == {"case", "history"} and
              isinstance(item["case"], dict) and isinstance(item["history"], list) for item in value["cases"]) and
          all(isinstance(item, dict) and set(item) == {"state", "history"} and
              isinstance(item["state"], dict) and isinstance(item["history"], list) for item in value["cycles"]) and
          isinstance(value["sourceBindings"], list) and
          all(isinstance(item, dict) for item in value["sourceBindings"]),
          "The complete native snapshot has malformed case, cycle or source rows")
    _need([item["case"].get("id") for item in value["cases"]] == value["selection"]["caseIds"] and
          [item["state"].get("id") for item in value["cycles"]] == value["selection"]["cycleIds"],
          "The complete snapshot differs from its selected scope")
    return value


def _manifest(path):
    # The native importer validates every member and nested native build. Preserve
    # its exact manifest here without introducing a second archive codec.
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        _need(len(names) == len(set(names)) and "manifest.json" in names,
              "Select the complete original native Workspace ZIP")
        member = archive.getinfo("manifest.json")
        _need(member.file_size <= 2 * 1024 * 1024, "The original archive manifest is too large")
        value = load_json(archive.read("manifest.json"))
        _need(isinstance(value, dict) and value.get("schema") == PACKET,
              "The returned file is not an original Monitoring Workspace archive")
        return value


def inspect(domain, object_id, issued_selection):
    """Validate the complete returned ZIP independently; author domain remains untouched."""
    from model import Workspace
    scope = selection(issued_selection)
    with domain.mutex:
        original = domain._one("objects", exact_id(object_id))
        path = domain.object_path(object_id)
        _need(path.stat().st_size == original["bytes"] and original["bytes"] <= MAX_SOURCE,
              "The retained original ZIP exceeds its native object boundary")
        manifest = _manifest(path)
        with domain.ws.scratch() as temp:
            with Workspace(Path(temp) / "independent-monitoring", create=True) as received:
                receipt = received.opensanctions.import_packet(path)
                retained = snapshot(received.opensanctions, scope)
                # No author-side table merge occurs. In particular, original requests,
                # responses, profiles and new source editions remain only in this ZIP.
        _need(domain.object_path(object_id).stat().st_size == original["bytes"],
              "The original returned ZIP changed during independent receiving")
        return {"schema": SCHEMA + ".archive", "archive": deepcopy(original),
                "manifest": manifest, "nativeReceiving": receipt, "snapshot": retained,
                "meaning": "Independent original Workspace evidence. No author case, source, provider request or cycle was adopted."}


def receive(domain, stream, name, issued_selection):
    """Keep exact incoming bytes through the existing original object writer."""
    scope = selection(issued_selection)
    text(name, "Original returned archive name", 240)
    original = domain.put_object(stream, name, "application/zip",
                                 {"purpose": "Original Monitoring reviewer workspace return"})
    return inspect(domain, original["id"], scope)


def export(domain, output, issued_selection):
    """Issue the complete existing native Workspace; the exchange stores its authority."""
    scope = selection(issued_selection)
    with domain.mutex:
        retained = snapshot(domain, scope)
        descriptor = domain.export_packet(Path(output))
        return {"schema": SCHEMA + ".issued", "archive": descriptor, "snapshot": retained,
                "meaning": "Complete original Workspace copy; the original review exchange owns the selected recipient and adoption authority."}


def main():
    """Direct source-native command; the managed host keeps its original ownership."""
    import argparse
    import sys
    from model import Workspace, private_write
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Original private Monitoring Workspace")
    parser.add_argument("--selection", required=True, help="Complete JSON {caseIds,cycleIds}; exchange owns issued authority")
    parser.add_argument("--report", required=True, help="New full JSON report outside the original Workspace")
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("snapshot", help="Read exact original case/cycle/source history")
    outgoing = actions.add_parser("export", help="Export the complete original Workspace with its selected snapshot")
    outgoing.add_argument("--archive", required=True, help="New original Workspace ZIP outside the original Workspace")
    incoming = actions.add_parser("inspect", help="Retain and independently receive the full returned Workspace ZIP")
    incoming.add_argument("--input", required=True)
    args = parser.parse_args()
    root = Path(args.workspace).expanduser().resolve(strict=True)
    selected_path = Path(args.selection).expanduser()
    _need(selected_path.is_file() and selected_path.stat().st_size <= 2 * 1024 * 1024,
          "Use a complete bounded original scope JSON file")
    scope = selection(load_json(selected_path.read_bytes()))
    report_path = Path(args.report).expanduser().absolute()
    _need(not report_path.resolve().is_relative_to(root),
          "Keep complete outgoing reports outside the author's original Workspace")
    if args.action == "export":
        archive_path = Path(args.archive).expanduser().absolute()
        _need(not archive_path.resolve().is_relative_to(root),
              "Keep the original Workspace ZIP outside its source Workspace")
        _need(archive_path != report_path, "The complete ZIP and JSON need separate output paths")
    with Workspace(root) as workspace:
        domain = workspace.opensanctions
        if args.action == "snapshot":
            result = snapshot(domain, scope)
        elif args.action == "export":
            result = export(domain, archive_path, scope)
        else:
            incoming_path = Path(args.input).expanduser().resolve(strict=True)
            _need(incoming_path.is_file() and incoming_path.stat().st_size <= MAX_SOURCE,
                  "Select a complete original returned ZIP within the native 256 MiB object boundary")
            with incoming_path.open("rb") as stream:
                result = receive(domain, stream, incoming_path.name, scope)
        raw = json_bytes(result)
        if report_path.exists():
            _need(report_path.is_file() and report_path.read_bytes() == raw,
                  "The retained report has different complete bytes; preserve it and choose a new output")
        else:
            private_write(report_path, raw)
        response = {"schema": SCHEMA + ".command", "action": args.action, "report": str(report_path),
                    "bytes": len(raw), "sha256": sha(raw), "selection": scope,
                    "snapshotSha256": result.get("snapshot", result)["sha256"]}
        if args.action == "inspect":
            response["archiveObjectId"] = result["archive"]["id"]
        elif args.action == "export":
            response["archive"] = result["archive"]
        sys.stdout.buffer.write(json_bytes(response))


if __name__ == "__main__":
    import sys
    try:
        main()
    except (InputError, OSError, ValueError, zipfile.BadZipFile) as error:
        sys.stderr.buffer.write(json_bytes({"error": str(error)}))
        raise SystemExit(2)
