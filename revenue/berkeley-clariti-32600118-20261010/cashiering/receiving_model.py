"""Original exchange row receiving: exact identities, native observations and amounts."""
from __future__ import annotations

from collections import Counter, defaultdict
import copy
import csv
from datetime import datetime, timezone
import hashlib
import io

from . import model as m

STATUSES = ("accepted", "rejected", "posted", "pending", "void", "unknown")
REVIEW_STATES = ("open", "investigating", "accepted_difference", "resolved")
DECISIONS = ("reviewed", "needs_correction", "in_progress")
DEFAULT_MAPPING = {
    "keys": [], "status_column": "", "status_map": {},
    "event_id_column": "", "reference_column": "", "error_code_column": "",
    "error_message_column": "", "observed_at_column": "", "amount": None,
    "note": "",
}


def scalar(value, name):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(name + " must be original scalar text; preserve numeric lexemes.")
    return m.text(value, name, maximum=100000)


def stamp(value):
    return datetime.fromisoformat(m.instant(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def binding(value, columns, name, required=True):
    if value is None and not required:
        return None
    if not isinstance(value, dict) or set(value) not in ({"column"}, {"literal"}):
        raise ValueError(name + " needs exactly one original column or explicit literal.")
    if "column" in value:
        if value["column"] not in columns:
            raise ValueError(name + " names a column absent from this exact source.")
    else:
        m.text(value["literal"], name, required=required, maximum=300)
    return copy.deepcopy(value)


def bound(value, row):
    return value["literal"] if "literal" in value else row.get(value["column"])


def validate_mapping(value, returned_headers, prepared_headers, *, confirmed=False):
    if not isinstance(value, dict) or set(value) - set(DEFAULT_MAPPING):
        raise ValueError("Supply the defined receiving mapping fields.")
    result = {**copy.deepcopy(DEFAULT_MAPPING), **copy.deepcopy(value)}
    structural = []
    keys = result["keys"]
    if not isinstance(keys, list) or len(keys) > 8:
        raise ValueError("Choose up to eight exact prepared/returned key column pairs.")
    seen = set()
    for key in keys:
        if not isinstance(key, dict) or set(key) != {"prepared", "returned"}:
            raise ValueError("Each identity key names prepared and returned columns.")
        if key["prepared"] not in prepared_headers or key["returned"] not in returned_headers:
            structural.append("A selected identity column is absent from these original files.")
        pair = (key["prepared"], key["returned"])
        if pair in seen:
            raise ValueError("Identity column pairs must be distinct.")
        seen.add(pair)
    if not keys:
        structural.append("Choose at least one supplied native identity column pair.")
    for field in ("status_column", "event_id_column", "reference_column", "error_code_column",
                  "error_message_column", "observed_at_column"):
        m.text(result[field], field, maximum=1000)
        if result[field] and result[field] not in returned_headers:
            structural.append(field + " is absent from the returned source.")
    if not result["status_column"]:
        structural.append("Select the native returned status column.")
    labels = result["status_map"]
    if not isinstance(labels, dict) or len(labels) > 1000:
        raise ValueError("Map original returned status labels explicitly.")
    for key, value in labels.items():
        m.text(key, "original status", maximum=1000)
        if value not in STATUSES:
            raise ValueError("Unknown receiving status interpretation.")
    amount = result["amount"]
    if amount is not None:
        allowed = {"prepared_column", "returned_column", "prepared_mode", "returned_mode",
                   "prepared_currency", "returned_currency", "value_basis", "included_statuses"}
        if not isinstance(amount, dict) or set(amount) != allowed:
            raise ValueError("Supply the complete optional amount comparison.")
        if amount["prepared_column"] not in prepared_headers or amount["returned_column"] not in returned_headers:
            structural.append("An amount column is absent from the exact selected source.")
        for field in ("prepared_mode", "returned_mode"):
            if amount[field] not in ("major", "minor"):
                raise ValueError("Declare exact major or minor units for both amount columns.")
        amount["prepared_currency"] = binding(amount["prepared_currency"], prepared_headers, "Prepared currency")
        amount["returned_currency"] = binding(amount["returned_currency"], returned_headers, "Returned currency")
        if amount["value_basis"] not in ("reported_total", "incremental_events"):
            raise ValueError("Choose a reported row total or explicitly incremental event amounts.")
        included = amount["included_statuses"]
        if not isinstance(included, list) or not included or len(set(included)) != len(included) or any(x not in STATUSES for x in included):
            raise ValueError("Declare the exact observation statuses whose amount contributes.")
        if amount["value_basis"] == "incremental_events" and not result["event_id_column"]:
            structural.append("Incremental amounts require the source's unique native event ID column.")
    m.text(result["note"], "mapping note", required=confirmed)
    if confirmed and structural:
        raise ValueError("Cannot confirm this interpretation: " + structural[0])
    return result, structural


def prepared_rows(raw, export):
    if hashlib.sha256(raw).hexdigest() != export["sha256"] or len(raw) != export["bytes"]:
        raise ValueError("The original prepared artifact has changed.")
    profile = export["profile"]
    headers = [column["header"] for column in profile["columns"]]
    if not headers or len(set(headers)) != len(headers):
        raise ValueError("The original prepared profile has ambiguous columns.")
    reader = csv.reader(io.StringIO(raw.decode("utf-8"), newline=""), delimiter=profile["delimiter"])
    if profile["include_header"]:
        actual = next(reader, None)
        if actual != headers:
            raise ValueError("The original prepared header differs from its retained profile.")
    rows = []
    for ordinal, cells in enumerate(reader, 1):
        if len(cells) != len(headers):
            raise ValueError("Original prepared row " + str(ordinal) + " differs from its exact profile.")
        values = dict(zip(headers, cells))
        source = {"artifact_id": export["artifact_id"], "artifact_sha256": export["sha256"],
                  "ordinal": ordinal, "values": values}
        digest = m.fingerprint(source)
        rows.append({"id": "prepared-row-" + digest, "sha256": digest, **source})
        if len(rows) > m.MAX_ROWS:
            raise ValueError("Prepared exchange exceeds the maintained row capacity.")
    if len(rows) != export["row_count"]:
        raise ValueError("The exact prepared row count differs from its retained exchange.")
    return headers, rows


def _amount(value, mode, currency, scales, label):
    currency = scalar(currency, label + " currency")
    if currency not in scales:
        raise ValueError(label + " requires a declared currency and its original scale.")
    amount = m.amount(value, mode, scales[currency], label)
    if amount is None:
        raise ValueError(label + " is absent.")
    return currency, amount


def normalize_source(source, mapping, expected, scales, prepared_indexes=None):
    metadata = source["metadata"]
    index_key = tuple(k["prepared"] for k in mapping["keys"])
    prepared_indexes = {} if prepared_indexes is None else prepared_indexes
    if index_key not in prepared_indexes:
        prepared_index = defaultdict(list)
        for row in expected:
            key = tuple(scalar(row["values"].get(k["prepared"]), "Prepared identity") for k in mapping["keys"])
            if key and all(x is not None for x in key):
                prepared_index[key].append(row["id"])
        prepared_indexes[index_key] = prepared_index
    prepared_index = prepared_indexes[index_key]
    observations = []
    for original in source["parsed"]["rows"]:
        identity = {"source_id": source["id"], "document_sha256": source["sha256"],
                    "record": original["line"], "original": original["values"], "types": original.get("types", {})}
        digest = m.fingerprint(identity)
        row = {
            "id": "return-row-" + digest, "sha256": digest, **identity,
            "mapping_version": source["mapping_version"], "mapping_sha256": m.fingerprint(mapping),
            "source_system": metadata["source_system"], "report_family": metadata["report_family"],
            "mode": metadata["mode"], "source_observed_at": metadata["observed_at"],
            "key": [], "candidates": [], "native_status": None, "status": "unknown",
            "event_id": None, "reference": None, "error_code": None, "error_message": None,
            "observed_at": metadata["observed_at"], "native_observed_at": None, "amount_minor": None, "currency": None,
            "issues": [], "active_source": True,
        }
        values = original["values"]
        try:
            row["key"] = [scalar(values.get(k["returned"]), "Returned identity") for k in mapping["keys"]]
            if not row["key"] or any(x is None for x in row["key"]):
                row["issues"].append({"code": "missing_identity", "message": "An original returned identity field is absent."})
            else:
                row["candidates"] = prepared_index.get(tuple(row["key"]), [])
        except ValueError as error:
            row["issues"].append({"code": "invalid_identity", "message": str(error)})
        try:
            row["native_status"] = scalar(values.get(mapping["status_column"]), "Native status")
            row["status"] = mapping["status_map"].get(row["native_status"], "unknown")
            if row["native_status"] not in mapping["status_map"]:
                row["issues"].append({"code": "unmapped_status", "message": "Retain this original status and supply its explicit interpretation."})
            for target in ("event_id", "reference", "error_code", "error_message"):
                column = mapping[target + "_column"]
                if column:
                    row[target] = scalar(values.get(column), target)
            if mapping["observed_at_column"]:
                row["observed_at"] = None
                row["native_observed_at"] = m.instant(values.get(mapping["observed_at_column"]))
                row["observed_at"] = row["native_observed_at"]
            if mapping["amount"] is not None:
                am = mapping["amount"]
                row["currency"], row["amount_minor"] = _amount(
                    values.get(am["returned_column"]), am["returned_mode"],
                    bound(am["returned_currency"], values), scales, "Returned amount")
        except ValueError as error:
            row["issues"].append({"code": "invalid_observation", "message": str(error)})
        observations.append(row)
    return observations


def calculate(export, prepared, sources, body):
    """Project complete native rows; reviews never change a supplied observation."""
    expected = copy.deepcopy(prepared)
    by_expected = {x["id"]: x for x in expected}
    source_map = {x["id"]: x for x in sources}
    observations = []
    prepared_indexes = {}
    for source in sources:
        observations.extend(normalize_source(source, source["mapping"], expected, body["scales"], prepared_indexes))
    by_observation = {x["id"]: x for x in observations}
    input_sha = m.fingerprint({
        "artifact_id": export["artifact_id"], "artifact_sha256": export["sha256"], "profile": export["profile"],
        "sources": [{"id": s["id"], "sha256": s["sha256"], "metadata": s["metadata"],
                     "mapping_version": s["mapping_version"], "mapping": s["mapping"]} for s in sources],
        "assignments": [a for a in body.get("assignments", []) if a.get("active", True)],
    })
    findings = []
    finding_ids = set()

    def finding(code, message, context, observation_ids=(), expected_ids=()):
        values = {"code": code, "details": context,
                  "observations": [{"id": ident, "sha256": by_observation[ident]["sha256"],
                                    "mapping_sha256": by_observation[ident]["mapping_sha256"]} for ident in observation_ids],
                  "prepared": [{"id": ident, "sha256": by_expected[ident]["sha256"]} for ident in expected_ids]}
        ident = "receiving-finding-" + m.fingerprint(values)
        if ident in finding_ids:
            return
        finding_ids.add(ident)
        findings.append({"id": ident, "code": code, "message": message, "details": context,
                         "observation_ids": list(observation_ids), "prepared_ids": list(expected_ids),
                         "review": copy.deepcopy(body.get("reviews", {}).get(ident, {"status": "open"}))})

    families = defaultdict(list)
    for source in sources:
        families[(source["metadata"]["source_system"], source["metadata"]["report_family"])].append(source)
    inactive = set()
    mixed_families = set()
    for family, group in families.items():
        snapshots = [s for s in group if s["metadata"]["mode"] == "snapshot"]
        events = [s for s in group if s["metadata"]["mode"] == "events"]
        if snapshots and events:
            mixed_families.add(family)
            finding("mixed_source_modes", "This source family mixes state snapshots and incremental event streams.",
                    {"family": list(family), "source_ids": [s["id"] for s in group]})
        if snapshots:
            latest = max(stamp(s["metadata"]["observed_at"]) for s in snapshots)
            selected = [s for s in snapshots if stamp(s["metadata"]["observed_at"]) == latest]
            inactive.update(s["id"] for s in snapshots if stamp(s["metadata"]["observed_at"]) < latest)
            if len(selected) > 1:
                finding("concurrent_snapshots", "Different original snapshots report the same observation point.",
                        {"family": list(family), "source_ids": [s["id"] for s in selected], "observed_at": selected[0]["metadata"]["observed_at"]})
    assignments = {a["observation_id"]: a for a in body.get("assignments", []) if a.get("active", True)}
    for assignment in assignments.values():
        if assignment["observation_id"] not in by_observation:
            finding("stale_assignment", "This retained row assignment belongs to an earlier source selection.",
                    {"assignment_id": assignment["id"], "observation_id": assignment["observation_id"]})
    linked = defaultdict(list)
    all_linked = defaultdict(list)
    for row in observations:
        row["active_source"] = row["source_id"] not in inactive
        assignment = assignments.get(row["id"])
        row["assignment"] = copy.deepcopy(assignment)
        row["excluded"] = bool(assignment and assignment.get("excluded"))
        if assignment and assignment.get("observation_sha256") != row["sha256"]:
            raise ValueError("Retained row assignment no longer matches its immutable original.")
        target = assignment.get("prepared_id") if assignment else row["candidates"][0] if len(row["candidates"]) == 1 else None
        if target is not None and target not in by_expected:
            raise ValueError("Retained assignment belongs to another prepared exchange.")
        row["prepared_id"] = target
        if target:
            all_linked[target].append(row["id"])
        row["match"] = "excluded" if row["excluded"] else "assigned" if assignment and target else "matched" if target else "ambiguous" if len(row["candidates"]) > 1 else "unmatched"
        if not row["active_source"] or row["excluded"]:
            continue
        if target:
            linked[target].append(row)
        else:
            finding(row["match"] + "_return", "The original returned row needs an explicit native identity disposition.",
                    {"key": row["key"], "candidates": row["candidates"]}, (row["id"],), row["candidates"])
        for issue in row["issues"]:
            finding(issue["code"], issue["message"], {"source_id": row["source_id"], "record": row["record"]}, (row["id"],), (target,) if target else ())
    active_families = {family: [s for s in group if s["id"] not in inactive] for family, group in families.items()}
    invalid_event_ids = set()
    native_events = defaultdict(list)
    for row in observations:
        am = source_map[row["source_id"]]["mapping"]["amount"]
        if row["active_source"] and not row["excluded"] and row["prepared_id"] and am and am["value_basis"] == "incremental_events" and row["event_id"]:
            native_events[(row["source_system"], row["report_family"], row["event_id"])].append(row)
    for key, copies in native_events.items():
        meanings = {m.fingerprint({"prepared_id": r["prepared_id"], "original": r["original"], "types": r["types"], "status": r["status"], "amount_minor": r["amount_minor"], "currency": r["currency"], "native_observed_at": r["native_observed_at"]}) for r in copies}
        if len(meanings) > 1:
            invalid_event_ids.add(key)
            finding("conflicting_event_identity", "One native event ID identifies different original records or prepared rows.",
                    {"family": list(key[:2]), "event_id": key[2]},
                    tuple(r["id"] for r in copies), tuple(dict.fromkeys(r["prepared_id"] for r in copies)))
    family_totals = {}
    for prepared_row in expected:
        ident = prepared_row["id"]
        rows = linked.get(ident, [])
        prepared_row["observation_ids"] = all_linked.get(ident, [])
        prepared_row["families"] = []
        grouped = defaultdict(list)
        for row in rows:
            grouped[(row["source_system"], row["report_family"])].append(row)
        if not rows:
            finding("no_current_return", "No currently selected native return identifies this prepared row.",
                    {"selected_source_ids": [s["id"] for s in sources if s["id"] not in inactive],
                     "coverage": [{"source_id": s["id"], "complete": s["metadata"]["complete"]} for s in sources if s["id"] not in inactive]},
                    expected_ids=(ident,))
        for family, family_sources in active_families.items():
            group = grouped.get(family, [])
            mappings = [source["mapping"] for source in family_sources]
            valid_times = []
            for row in group:
                try:
                    valid_times.append((stamp(row["observed_at"]), row))
                except (ValueError, TypeError):
                    pass
            if valid_times:
                last = max(t for t, _ in valid_times)
                latest_rows = [r for t, r in valid_times if t == last]
            else:
                latest_rows = []
            native_states = set(r["status"] for r in latest_rows)
            state = next(iter(native_states)) if len(native_states) == 1 else "ambiguous" if native_states else "unknown" if group else "unobserved"
            projection = {"source_system": family[0], "report_family": family[1], "status": state,
                          "latest_observation_ids": [r["id"] for r in latest_rows],
                          "expected_minor": None, "returned_minor": None, "difference_minor": None,
                          "currency": None, "amount_basis": None, "counted_observation_ids": []}
            if len(native_states) > 1:
                finding("conflicting_status", "The same latest native observation point has different returned statuses.",
                        {"family": list(family), "statuses": sorted(native_states)}, tuple(r["id"] for r in latest_rows), (ident,))
            if state in ("rejected", "void"):
                finding("returned_" + state, "The selected native result reports this prepared row as " + state + ".",
                        {"family": list(family)}, tuple(r["id"] for r in latest_rows), (ident,))
            if state in ("pending", "unknown"):
                finding("returned_" + state, "The selected native result remains " + state + ".",
                        {"family": list(family)}, tuple(r["id"] for r in latest_rows), (ident,))
            amount_configs = {m.canonical(mp["amount"]) for mp in mappings}
            if len(amount_configs) > 1:
                finding("incompatible_amount_mappings", "Selected observations use different amount interpretations for one source family.",
                        {"family": list(family)}, tuple(r["id"] for r in group), (ident,))
            elif mappings[0]["amount"] is not None:
                am = mappings[0]["amount"]
                projection["amount_basis"] = am["value_basis"]
                try:
                    currency, expected_minor = _amount(prepared_row["values"].get(am["prepared_column"]),
                        am["prepared_mode"], bound(am["prepared_currency"], prepared_row["values"]),
                        body["scales"], "Prepared amount")
                    projection.update(currency=currency, expected_minor=expected_minor)
                    chosen = [r for r in (group if am["value_basis"] == "incremental_events" else latest_rows)
                              if r["status"] in am["included_statuses"]]
                    # A mixed report family has no single additive amount meaning.
                    # Retain its expected amount and every observation, but do not
                    # assert a returned total until selection separates its modes.
                    usable = family not in mixed_families and all(r["observed_at"] is not None for r in chosen)
                    if am["value_basis"] == "incremental_events":
                        events = defaultdict(list)
                        for row in chosen:
                            if (row["source_system"], row["report_family"], row["event_id"]) in invalid_event_ids:
                                usable = False
                            elif not row["event_id"]:
                                usable = False
                                finding("missing_event_id", "An incremental amount has no original unique event ID.",
                                        {"family": list(family)}, (row["id"],), (ident,))
                            else:
                                events[row["event_id"]].append(row)
                        chosen = []
                        for event_id, copies in events.items():
                            meanings = {m.fingerprint({"original": r["original"], "types": r["types"]}) for r in copies}
                            if len(meanings) > 1:
                                usable = False
                                finding("conflicting_event_id", "One native event ID refers to different original returned rows.",
                                        {"family": list(family), "event_id": event_id},
                                        tuple(r["id"] for r in copies), (ident,))
                            else:
                                chosen.append(copies[0])
                                if len(copies) > 1:
                                    finding("repeated_event", "Repeated identical native event IDs remain visible and contribute once.",
                                            {"family": list(family), "event_id": event_id},
                                            tuple(r["id"] for r in copies), (ident,))
                    elif len({(r["currency"], r["amount_minor"]) for r in chosen}) > 1:
                        usable = False
                        finding("conflicting_reported_total", "The same latest observation point has different reported row amounts.",
                                {"family": list(family)}, tuple(r["id"] for r in chosen), (ident,))
                    elif chosen:
                        chosen = chosen[:1]
                    if any(r["currency"] != currency or r["amount_minor"] is None for r in chosen):
                        usable = False
                        finding("returned_amount_unavailable", "A returned amount is absent, invalid or in a different currency.",
                                {"family": list(family), "expected_currency": currency},
                                tuple(r["id"] for r in chosen), (ident,))
                    if usable and chosen:
                        received = str(sum(int(r["amount_minor"]) for r in chosen))
                        projection.update(returned_minor=received, difference_minor=str(int(received) - int(expected_minor)),
                                          counted_observation_ids=[r["id"] for r in chosen])
                        if projection["difference_minor"] != "0":
                            finding("amount_difference", "The selected native returned amount differs from the exact prepared amount.",
                                    {"family": list(family), "currency": currency, "expected_minor": expected_minor,
                                     "returned_minor": received, "difference_minor": projection["difference_minor"]},
                                    tuple(r["id"] for r in chosen), (ident,))
                    key = (*family, currency)
                    totals = family_totals.setdefault(key, {"source_system": family[0], "report_family": family[1],
                        "currency": currency, "expected_minor": "0", "known_returned_minor": "0",
                        "prepared_rows": 0, "rows_with_returned_amount": 0, "rows_without_returned_amount": 0})
                    totals["expected_minor"] = str(int(totals["expected_minor"]) + int(expected_minor))
                    totals["prepared_rows"] += 1
                    if projection["returned_minor"] is not None:
                        totals["known_returned_minor"] = str(int(totals["known_returned_minor"]) + int(projection["returned_minor"]))
                        totals["rows_with_returned_amount"] += 1
                    else:
                        totals["rows_without_returned_amount"] += 1
                except ValueError as error:
                    finding("invalid_prepared_amount", str(error), {"family": list(family)}, expected_ids=(ident,))
            prepared_row["families"].append(projection)
        states = {g["status"] for g in prepared_row["families"] if g["status"] != "unobserved"}
        prepared_row["unobserved_families"] = sum(g["status"] == "unobserved" for g in prepared_row["families"])
        prepared_row["status"] = next(iter(states)) if len(states) == 1 else "conflicting" if states else "unobserved"
        if len(states) > 1:
            finding("source_status_disagreement", "The current native source families report different row statuses.",
                    {"families": prepared_row["families"]}, tuple(r["id"] for r in rows), (ident,))
    native = {"prepared": expected, "observations": observations, "findings": [
        {k: v for k, v in f.items() if k != "review"} for f in findings],
        "totals": sorted(family_totals.values(), key=lambda x: (x["source_system"], x["report_family"], x["currency"]))}
    comparison_sha = m.fingerprint(native)
    review_sha = m.fingerprint({"comparison_sha256": comparison_sha,
                               "reviews": [{"id": f["id"], "review": f["review"]} for f in findings]})
    decisions = copy.deepcopy(body.get("decisions", []))
    for decision in decisions:
        decision["current"] = decision["review_sha256"] == review_sha and decision["input_sha256"] == input_sha
    counts = {"prepared_rows": len(expected), "returned_rows": len(observations),
              "current_returned_rows": sum(x["active_source"] for x in observations),
              "inactive_snapshot_rows": sum(not x["active_source"] for x in observations),
              "excluded_rows": sum(x["excluded"] for x in observations),
              "matched_rows": sum(x["active_source"] and x["match"] in ("matched", "assigned") for x in observations),
              "unmatched_rows": sum(x["active_source"] and x["match"] == "unmatched" for x in observations),
              "ambiguous_rows": sum(x["active_source"] and x["match"] == "ambiguous" for x in observations),
              "unobserved_prepared_rows": sum(x["status"] == "unobserved" for x in expected),
              "findings": len(findings),
              "open_findings": sum(x["review"].get("status") in ("open", "investigating") for x in findings),
              "status_counts": dict(Counter(x["status"] for x in expected))}
    return {"input_sha256": input_sha, "comparison_sha256": comparison_sha, "review_sha256": review_sha,
            "prepared": expected, "observations": observations, "findings": findings, "totals": native["totals"],
            "decisions": decisions, "counts": counts, "inactive_source_ids": sorted(inactive)}
