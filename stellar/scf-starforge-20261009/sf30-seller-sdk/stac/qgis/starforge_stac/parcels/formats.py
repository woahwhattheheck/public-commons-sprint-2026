# SPDX-License-Identifier: MIT
"""Compare retained City source formats without changing original fact identities."""
from __future__ import annotations
import copy
from collections import defaultdict

from ..model import require, member, file_digest, value_sha, sha_bytes
from .intake import canonical_record, exact_bytes, original_records, text

CITY = {"city-eproperties-json": "city-eproperties", "city-eproperties-csv": "city-eproperties",
        "city-tax-register-json": "city-tax-register", "city-tax-register-csv": "city-tax-register"}
FIELDS = ("sourceId", "family", "key", "recordId", "recordSha256", "geometrySha256")


def city_values(raw):
    # The original CSV represents a missing CKAN scalar as an empty cell.
    # Do not trim, case-fold, infer dates or change numerical text.
    return {key: "" if value is None else text(value) for key, value in canonical_record(raw).items()}


def claim_signature(claim, city):
    value = {key: item for key, item in claim.items() if key not in ("id", "recordId")}
    if city:
        # Empty optional City date context also changes from null to CSV "".
        value = {key: "" if item is None else item for key, item in value.items()}
    return value_sha(value)


class OriginalCityRows:
    """Read each needed original file once; retain only selected canonical rows."""
    def __init__(self, workspace, editions_and_rows):
        self.values = {}
        groups = {}
        for edition, rows in editions_and_rows:
            inputs = {(item["path"], item["sha256"]): item for item in edition["inputs"]}
            for row in rows:
                for record in row["records"]:
                    if record["family"] not in CITY:
                        continue
                    ref = record["references"][0]
                    item = inputs.get((ref["path"], ref["fileSha256"]))
                    require(item is not None and item["sourceId"] == record["sourceId"] and
                            item["family"] == record["family"],
                            "PARCEL_FORMAT_SOURCE", "Reopen the original selected City source record.")
                    group_key = (edition["id"], item["path"], item["sha256"])
                    group = groups.setdefault(group_key, {"item": item, "wanted": defaultdict(list)})
                    group["wanted"][ref["row"]].append((edition["id"], record))
        for group in groups.values():
            item = group["item"]
            path = member(workspace.root, item["object"]["path"])
            file_digest(path, expected=item["object"])
            found = set()
            for offset, raw, geometry in original_records(path.read_bytes(), item["family"]):
                if offset not in group["wanted"]:
                    continue
                require(geometry is None, "PARCEL_FORMAT_GEOMETRY", "Keep City tabular records separate from parcel geometry.")
                raw_sha = sha_bytes(exact_bytes(canonical_record(raw)))
                for edition_id, record in group["wanted"][offset]:
                    stable_id = text(raw.get("id")) if CITY[item["family"]] == "city-eproperties" else raw.get("pin")
                    require(raw_sha == record["recordSha256"] and raw.get("pin") == record["key"] and
                            stable_id == record["recordId"],
                            "PARCEL_FORMAT_SOURCE", "The retained City row differs from its original indexed identity.")
                    self.values[(edition_id, record["id"])] = city_values(raw)
                found.add(offset)
            require(found == set(group["wanted"]), "PARCEL_FORMAT_SOURCE", "A retained City source row is missing.")

    def signature(self, edition_id, record):
        if record["family"] not in CITY:
            return value_sha({key: record[key] for key in FIELDS})
        return value_sha({"sourceId": record["sourceId"], "family": CITY[record["family"]],
            "key": record["key"], "recordId": record["recordId"],
            "fields": self.values[(edition_id, record["id"])],
            "geometrySha256": record["geometrySha256"]})


def match_rows(reader, left_id, right_id, left, right):
    old, new = defaultdict(list), defaultdict(list)
    for record in left["records"]:
        old[reader.signature(left_id, record)].append(record)
    for record in right["records"]:
        new[reader.signature(right_id, record)].append(record)
    if set(old) != set(new) or any(len(old[key]) != 1 or len(new[key]) != 1 for key in old):
        return None
    records, claims, formats = {}, {}, []
    for signature in sorted(old):
        before, after = old[signature][0], new[signature][0]
        records[before["id"]] = after["id"]
        if before["family"] != after["family"]:
            if CITY.get(before["family"]) != CITY.get(after["family"]) or before["family"] not in CITY:
                return None
            formats.append({"sourceId": before["sourceId"], "recordId": before["recordId"],
                            "from": before["family"], "to": after["family"]})
        old_claims, new_claims = defaultdict(list), defaultdict(list)
        for claim in left["claims"]:
            if claim["recordId"] == before["id"]:
                old_claims[claim_signature(claim, before["family"] in CITY)].append(claim)
        for claim in right["claims"]:
            if claim["recordId"] == after["id"]:
                new_claims[claim_signature(claim, after["family"] in CITY)].append(claim)
        if set(old_claims) != set(new_claims) or any(len(old_claims[key]) != 1 or len(new_claims[key]) != 1 for key in old_claims):
            return None
        for key in old_claims:
            claims[old_claims[key][0]["id"]] = new_claims[key][0]["id"]
    if not formats:
        return None
    proof = {"schema": "starforge.parcel-source-format-equivalence.v1", "key": left["key"],
        "leftFactsSha256": left["factsSha256"], "rightFactsSha256": right["factsSha256"],
        "recordIds": records, "claimIds": claims, "formats": formats,
        "comparison": "all-original-fields; City null and empty CSV cells equivalent; exact remaining scalar text"}
    return {**proof, "sha256": value_sha(proof)}


def compare_formats(workspace, left, right, left_index, right_index, candidates):
    pairs = []
    for key in candidates:
        before = workspace.row(left, key, index=left_index)
        after = workspace.row(right, key, index=right_index)
        left_formats = {(r["sourceId"], r["recordId"], r["family"]) for r in before["records"] if r["family"] in CITY}
        right_formats = {(r["sourceId"], r["recordId"], r["family"]) for r in after["records"] if r["family"] in CITY}
        if left_formats and right_formats and left_formats != right_formats:
            pairs.append((before, after))
    if not pairs:
        return {}
    reader = OriginalCityRows(workspace.workspace, [(left, [a for a, _ in pairs]), (right, [b for _, b in pairs])])
    result = {}
    for before, after in pairs:
        proof = match_rows(reader, left["id"], right["id"], before, after)
        if proof is not None:
            result[before["key"]] = proof
    return result


def rebind_review(original, row, proof):
    """Retain the actual target claims and the original accountable-entity edition."""
    require(original["factsSha256"] == proof["leftFactsSha256"] and
            row["factsSha256"] == proof["rightFactsSha256"],
            "PARCEL_FORMAT_REVIEW", "Review the exact original source-format comparison.")
    result = {key: copy.deepcopy(value) for key, value in original.items()
              if key not in ("sha256", "requestId", "reviewedAt", "actor")}
    claims = {claim["id"]: claim for claim in row["claims"]}
    def target(claim):
        if claim is None:
            return None
        identity = proof["claimIds"].get(claim["id"])
        require(identity in claims, "PARCEL_FORMAT_REVIEW", "Bind the reviewed assertion to its actual target source claim.")
        return copy.deepcopy(claims[identity])
    for role in ("owner", "status", "ward"):
        if result[role]["mode"] == "source":
            result[role]["claim"] = target(result[role]["claim"])
    for field in ("area", "geometry"):
        result[field] = target(result[field])
    if result["assessmentRecordId"] is not None:
        require(result["assessmentRecordId"] in proof["recordIds"],
                "PARCEL_FORMAT_REVIEW", "Bind the reviewed assessment to its actual target source record.")
        result["assessmentRecordId"] = proof["recordIds"][result["assessmentRecordId"]]
    result["assessments"] = [target(claim) for claim in result["assessments"]]
    result["factsSha256"] = row["factsSha256"]
    result["sourceFormatEquivalence"] = copy.deepcopy(proof)
    return result
