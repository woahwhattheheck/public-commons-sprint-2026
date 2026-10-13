"""Saved Observation edition selection for the original Measurements consumers.

The JavaScript edition reader remains the authority for original source and
immutable decision validation. This adapter combines that retained decision
with the current native eligibility snapshot; it never edits either source.
"""
from __future__ import annotations
from copy import deepcopy
import json
import re
from urllib.parse import quote

SCHEMA = "upstate.measurement-observation-edition-selection/v1"


def selection(value):
    if not isinstance(value, dict) or set(value) != {"id", "digest"}:
        raise ValueError("Choose a saved Observation edition and its exact digest")
    key, checksum = value["id"], value["digest"]
    if not isinstance(key, str) or not re.fullmatch(r"observation-edition-[0-9a-f]{64}", key):
        raise ValueError("Choose an original saved Observation edition")
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("Retain the inspected Observation edition digest")
    return {"id": key, "digest": checksum}


def catalogue(service):
    from .operator import BASE
    status, _, raw = service.request("GET", BASE + "/observation-editions/editions", b"")
    if status == 404:
        return []  # Existing standalone Chemistry without the optional edition component.
    if status >= 400:
        raise RuntimeError("The original Observation edition catalogue could not be read (HTTP " + str(status) + ")")
    value = json.loads(raw)
    if not isinstance(value, dict) or not isinstance(value.get("editions"), list):
        raise ValueError("The original Observation edition catalogue is incomplete")
    return value["editions"]


def snapshot(service, value, current):
    """Keep all edition records, including its explicit native exclusions.

    Current is the original unfiltered, single-transaction Measurements
    snapshot. Its complete portable body remains unchanged for cold receiving.
    """
    chosen = selection(value)
    edition = service.json("GET", "observation-editions/editions/" + quote(chosen["id"], safe=""))
    if (edition.get("schema") != "upstate.observation-edition/v1"
            or edition.get("edition_id") != chosen["id"] or edition.get("digest") != chosen["digest"]):
        raise ValueError("The selected saved Observation edition changed; inspect it again")
    portable = current["portable"]
    if portable["revision"] != current["revision"] or current["summary"]["revision"] != current["revision"]:
        raise ValueError("Original Measurements snapshot revisions differ")
    # A later lookup must still name the very edition included in this snapshot.
    # This also makes the original native case's portable source self-contained.
    retained = [item for item in portable.get("tables", {}).get("exports", []) if item.get("id") == chosen["id"]]
    if len(retained) != 1 or retained[0].get("kind") != "observation-edition":
        raise ValueError("The selected Observation edition is outside the captured Measurements revision")
    raw = retained[0].get("content")
    if not isinstance(raw, str) or json.loads(raw) != edition:
        raise ValueError("The captured original Observation edition differs from its validated source")
    current_rows = {row["id"]: row for row in current["records"]}
    if len(current_rows) != current["total"] or len(current_rows) != len(current["records"]):
        raise ValueError("The original Measurements snapshot repeats or omits records")
    original = edition["capture"]["records"]
    choices = {row["record_id"]: row for row in edition["rows"]}
    ids = [row["id"] for row in original]
    if len(ids) != len(set(ids)) or set(ids) != set(choices):
        raise ValueError("The saved Observation edition has inconsistent original membership")
    records = []
    immutable_omissions = {"id", "review", "mapping", "variantCount", "selectedVersion",
                           "eligible", "sources", "variants", "history"}
    for previous in original:
        key = previous["id"]
        if key not in current_rows:
            raise ValueError("The complete original edition record is absent: " + key)
        row = deepcopy(current_rows[key])
        immutable = lambda item: {k: v for k, v in item.items() if k not in immutable_omissions}
        if immutable(row) != immutable(previous):
            raise ValueError("An original canonical record differs from the saved edition: " + key)
        choice = choices[key]
        reasons = list(dict.fromkeys([*row["eligible"]["reasons"], *choice["native_reasons"]]))
        row["eligible"] = {**row["eligible"], "ok": not reasons, "reasons": reasons}
        row["observation_edition"] = {
            **chosen, "source_binding": edition["source_binding"], "choice": deepcopy(choice),
            "original_review": deepcopy(previous["review"]),
            "original_mapping": deepcopy(previous["mapping"]),
            "original_eligibility": deepcopy(previous["eligible"]),
            "original_occurrences": deepcopy(previous["sources"])}
        records.append(row)
    source = {"schema": SCHEMA, "selection": chosen, "edition": deepcopy(edition),
              "edition_source_text": raw, "current_revision": current["revision"],
              "counts": deepcopy(edition["counts"]),
              "method": "The saved edition's frozen eligibility is intersected with current original Measurements eligibility. "
                        "Later review acceptance does not remove the edition's retained exclusions; create a revised "
                        "Observation edition to adopt changed review decisions. "
                        "Every original record remains accounted for; suppressed, excluded and unresolved choices "
                        "remain in native exclusions. No averaging, eligibility override or annualization."}
    return {**current, "records": records, "total": len(records), "observation_edition_source": source}
