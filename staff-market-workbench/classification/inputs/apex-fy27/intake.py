#!/usr/bin/env python3
"""Apex FY27 original-source adapter and reusable workforce intake.

Only the standard library is required. Published annual rates remain Decimal
strings. The original records, column mappings and source bytes accompany the
classification inputs. See README.md for the complete native import workflow.
"""
from __future__ import annotations

import argparse
import base64
import csv
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import io
import json
from pathlib import Path
import re
import sys

SCHEMA = "apex.public-safety-inputs/v1"
HERE = Path(__file__).resolve().parent
ZERO = Decimal("0")
CENT = Decimal("0.01")
DEPARTMENTS = ("Fire & Rescue", "Police")
PAY_FIELDS = (
    "department", "title", "grade_id", "minimum_hourly", "minimum_salary",
    "market_hourly", "market_salary", "maximum_hourly", "maximum_salary",
)


class InputError(ValueError):
    pass


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps(value), encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_utf8(path):
    """Preserve original CSV line endings and BOM for native source retention."""
    return Path(path).read_bytes().decode("utf-8")


def exact_date(value):
    if date.fromisoformat(value).isoformat() != value:
        raise InputError("Date must be YYYY-MM-DD")
    return value


def decimal(value, field, blank=False, minimum=ZERO, maximum=None):
    if value is None or str(value).strip() == "":
        if blank:
            return None
        raise InputError(field + " is required")
    if isinstance(value, bool):
        raise InputError(field + " must be a decimal value")
    try:
        result = Decimal(str(value).strip().replace(",", "").removeprefix("$"))
    except InvalidOperation as exc:
        raise InputError(field + " is not a decimal value") from exc
    if not result.is_finite() or result < minimum or (
        maximum is not None and result > maximum
    ):
        raise InputError(field + " is outside the permitted range")
    return result


def ds(value):
    if value is None:
        return ""
    return format(value, "f")


def money(value):
    return ds(value.quantize(CENT, rounding=ROUND_HALF_UP))


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def role_id(department, title):
    return "apex-" + slug(department) + "-" + slug(title)


def source_ref(manifest, name, page=None, note=""):
    source = next(s for s in manifest["sources"] if s["name"] == name)
    result = {
        "label": source["label"], "url": source["url"],
        "sha256": source["sha256"], "as_of": source["retrieved_at"][:10],
    }
    if page is not None:
        result["page"] = str(page)
    if note:
        result["note"] = note
    return result


def verify_sources(source_dir, manifest):
    for source in manifest["sources"]:
        path = source_dir / source["file"]
        raw = path.read_bytes()
        if len(raw) != source["bytes"] or sha(raw) != source["sha256"]:
            raise InputError("Original source bytes changed: " + str(path))
        extraction = source.get("text_extraction")
        if extraction:
            text_path = source_dir / extraction["file"]
            text_raw = text_path.read_bytes()
            if len(text_raw) != extraction["bytes"] or sha(text_raw) != extraction["sha256"]:
                raise InputError("Captured text extraction changed: " + str(text_path))


def parse_pay_plan(text):
    """Read every physical pay-plan row, including original duplicate rows."""
    rows = []
    for page, content in enumerate(text.split("\f"), 1):
        for line_number, line in enumerate(content.splitlines(), 1):
            if "$" not in line:
                continue
            cells = re.split(r"\s{2,}", line.strip())
            if len(cells) != 9:
                raise InputError(f"Pay table width differs at page {page}, line {line_number}")
            if cells[2] != "TBD" and not re.fullmatch(r"(?:[A-Z]+\d+)", cells[2]):
                raise InputError(f"Unrecognized original grade at page {page}, line {line_number}")
            row = dict(zip(PAY_FIELDS, cells))
            for key in PAY_FIELDS[3:]:
                row[key] = money(decimal(row[key], key))
            row.update(
                original_id=f"pay-plan-p{page}-l{line_number}",
                source_page=page, source_line=line_number,
                original_cells=dict(zip(PAY_FIELDS, cells)), original_line=line,
                full_time_fte="1.0",
                arithmetic_midpoint=money(
                    (decimal(row["minimum_salary"], "minimum")
                     + decimal(row["maximum_salary"], "maximum")) / 2
                ),
            )
            rows.append(row)
    selected = [r for r in rows if r["department"] in DEPARTMENTS]
    counts = {d: sum(r["department"] == d for r in selected) for d in DEPARTMENTS}
    if counts != {"Fire & Rescue": 18, "Police": 29}:
        raise InputError("This captured FY27 pay-plan edition has an unexpected public-safety row census: " + str(counts))
    return rows


def parse_authorizations(text):
    """Keep each published FT/FTE group once, preserving combined grade lists."""
    result, department = [], None
    for page, content in enumerate(text.split("\f"), 1):
        for line_number, line in enumerate(content.splitlines(), 1):
            title = re.fullmatch(r"(.+?)\s{2,}(\d+(?:\.\d+)?)\s*", line.strip())
            if title:
                department = title.group(1) if title.group(1) in DEPARTMENTS else None
                continue
            if department is None or not line.strip() or "FT   PT" in line:
                continue
            match = re.fullmatch(
                r"(.+?)\s{2,}(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-Z0-9/]+)\s*",
                line.strip(),
            )
            if not match:
                raise InputError(f"Review authorization columns at page {page}, line {line_number}: {line}")
            title, ft, fte, grades = match.groups()
            if decimal(ft, "authorized FT") != decimal(fte, "authorized FTE"):
                raise InputError("Review the original FT/PT/FTE interpretation for " + title)
            result.append({
                "id": "apex-authorized-" + slug(department) + "-" + slug(title),
                "department": department, "title": title,
                "authorized_ft": ft, "authorized_pt": "",
                "authorized_fte": fte, "published_grade_list": grades,
                "grade_ids": list(dict.fromkeys(grades.split("/"))),
                "source_page": page, "source_line": line_number,
                "original_line": line,
            })
    totals = {d: sum((decimal(r["authorized_fte"], "FTE") for r in result
                     if r["department"] == d), ZERO) for d in DEPARTMENTS}
    if len(result) != 38 or totals != {"Fire & Rescue": Decimal(122), "Police": Decimal(153)}:
        raise InputError("This captured authorization edition has an unexpected group/FTE census: " + str(totals))
    return result


def match_title(value):
    value = value.lower().replace("traffice", "traffic")
    value = value.replace("(5% increase)", "").replace("(pt 30)", "")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


# Explicit source-title differences that cannot be resolved by punctuation.
# A list is one authorization bucket; its FTE must never be copied to every role.
AUTHORIZATION_ALIASES = {
    ("Fire & Rescue", "Fire Captain I/Captain II"): ["Fire Captain I", "Fire Captain II"],
    ("Fire & Rescue", "Cadet/Firefighter/Senior Firefighter"):
        ["Firefighter Cadet", "Firefighter", "Senior Firefighter"],
    ("Police", "Police Officers (I/II/III/Senior)"):
        ["Police Officer I", "Police Officer II", "Police Officer III", "Senior Police Officer"],
    ("Police", "Telecommunicator I/II/Senior"):
        ["Telecommunicator I, II (5% increase)", "Senior Telecommunicator"],
    ("Police", "Senior Program Support Specialist I/II"):
        ["Senior Program Support Specialist (PT 30)"],
}


def compile_inputs(source_dir, output_dir):
    manifest = read_json(source_dir / "source-manifest.json")
    verify_sources(source_dir, manifest)
    all_pay = parse_pay_plan((source_dir / "pay-plan.txt").read_text(encoding="utf-8"))
    pay = [r for r in all_pay if r["department"] in DEPARTMENTS]
    authorizations = parse_authorizations((source_dir / "positions.txt").read_text(encoding="utf-8"))
    scope = read_json(HERE / "rfp-position-scope.json")
    by_key = {(r["department"], r["title"]): r for r in pay}
    if len(by_key) != len(pay):
        raise InputError("Public-safety titles require disambiguation before creating stable role IDs")
    rfp_by_role = {}
    for item in scope["items"]:
        item["role_ids"] = []
        for title in item["published_titles"]:
            key = (item["department"], title)
            if key not in by_key:
                raise InputError("RFP mapping references an absent original pay title: " + str(key))
            rid = role_id(*key)
            item["role_ids"].append(rid)
            rfp_by_role.setdefault(rid, []).append(item["id"])
    refs = [source_ref(manifest, "pay-plan"), source_ref(manifest, "pay-coversheet"),
            source_ref(manifest, "position-cover")]
    method = {
        "name": "Apex FY27 published public-safety salary grades",
        "edition": "FY2026-2027 / June 23 council source / captured 2026-10-12",
        "effective_date": "",
        "effective_timing": "First full pay period in July 2026",
        "currency": "USD", "rate_basis": "annual_fulltime", "mode": "explicit_grades",
        "source_refs": refs, "grades": [], "factors": [], "score_bands": [],
        "basis": (
            "Town FY27 Job Titles and Pay Ranges, physical pages 2 and 4; all published ranges "
            "are for 1.0 FTE. The reference column is the source's Market Salary. It is not "
            "the arithmetic midpoint. Published annual values are used directly; rounded hourly "
            "values do not establish an employee's annual hours. The authorization coversheet "
            "specifies the first full pay period in July 2026, without its calendar date. "
            "These are the existing published grades, prior to the new RFP's study recommendations."
        ),
    }
    grades = {}
    for row in pay:
        values = tuple(row[k] for k in ("minimum_salary", "market_salary", "maximum_salary"))
        if row["grade_id"] in grades and grades[row["grade_id"]][0] != values:
            raise InputError("Conflicting original public-safety grade amounts: " + row["grade_id"])
        grades.setdefault(row["grade_id"], (values, row))
    for grade_id, (values, row) in sorted(grades.items()):
        method["grades"].append({
            "id": grade_id, "label": grade_id,
            "min": values[0], "reference": values[1], "max": values[2],
            "reference_label": "Published Market Salary",
            "source_ref": source_ref(manifest, "pay-plan", row["source_page"],
                                     "Annual 1.0 FTE amounts; original row " + row["original_id"]),
        })
    roles = {
        "name": "Apex FY27 public-safety source roles",
        "edition": method["edition"], "basis": method["basis"],
        "source_refs": [source_ref(manifest, "pay-plan"), source_ref(manifest, "rfp", 6)],
        "rows": [],
    }
    for row in pay:
        rid = role_id(row["department"], row["title"])
        row["role_id"] = rid
        row["rfp_item_ids"] = rfp_by_role.get(rid, [])
        coverage = ("RFP position-list items: " + ", ".join(row["rfp_item_ids"])
                    if row["rfp_item_ids"] else "Department context role outside the RFP's printed position list.")
        roles["rows"].append({
            "id": rid, "title": row["title"], "department": row["department"],
            "grade_id": row["grade_id"], "current_grade_id": row["grade_id"],
            "description": "",
            "rationale": coverage + " Existing published grade " + row["grade_id"]
                         + "; full-time annual salary basis. Job duties and professional classification "
                         "rationale are supplied by the Town and consulting study in a new retained edition.",
            "source_refs": [source_ref(manifest, "pay-plan", row["source_page"],
                                       "Original title retained; source row " + row["original_id"])],
        })
    roles_by_id = {r["id"]: r for r in roles["rows"]}
    for group in authorizations:
        key = (group["department"], group["title"])
        titles = AUTHORIZATION_ALIASES.get(key)
        if titles is None:
            titles = [r["title"] for r in pay if r["department"] == group["department"]
                      and match_title(r["title"]) == match_title(group["title"])]
        if not titles:
            raise InputError("Map the original authorization title explicitly: " + str(key))
        group["role_ids"] = [role_id(group["department"], title) for title in titles]
        for rid in group["role_ids"]:
            if rid not in roles_by_id or roles_by_id[rid]["grade_id"] not in group["grade_ids"]:
                raise InputError("Authorization title/grade mismatch for " + group["title"])
        coverage = [rid in rfp_by_role for rid in group["role_ids"]]
        if any(coverage) and not all(coverage):
            raise InputError("Partially covered authorization group needs an explicit RFP allocation")
        group["rfp_listed"] = all(coverage)
        group["source_ref"] = source_ref(manifest, "positions", group["source_page"])
        group["mapping_note"] = ""
        if key == ("Police", "Senior Program Support Specialist I/II"):
            group["mapping_note"] = (
                "Authorization lists 1 FT / 1 FTE; the pay title says PT 30. "
                "Public envelope uses the authorization's FTE and the pay table's published full-time range. "
                "Town confirmation is required before using this mapping for an employee's position."
            )
        if "Traffice" in group["title"]:
            group["mapping_note"] = "Original authorization spelling 'Traffice' maps to published pay-title 'Traffic'."
    write_json(output_dir / "pay-plan-all-rows.json", {"schema": SCHEMA, "rows": all_pay})
    write_json(output_dir / "pay-plan-public-safety.json", {"schema": SCHEMA, "rows": pay})
    write_json(output_dir / "method.json", method)
    write_json(output_dir / "roles.json", roles)
    listed_roles = {**roles, "name": "Apex RFP listed source roles",
                    "rows": [r for r in roles["rows"] if r["id"] in rfp_by_role]}
    write_json(output_dir / "roles-rfp-listed.json", listed_roles)
    write_json(output_dir / "rfp-position-scope.json", scope)
    write_json(output_dir / "authorized-position-groups.json",
               {"schema": SCHEMA, "source_refs": [source_ref(manifest, "positions")],
                "basis": "One row per original authorized group. Combined grade buckets retain one FTE total.",
                "rows": authorizations})
    summary = {
        "schema": SCHEMA, "original_pay_rows_all_town": len(all_pay),
        "public_safety_pay_rows": len(pay), "public_safety_grades": len(grades),
        "rfp_position_list_items": len(scope["items"]), "rfp_mapped_pay_rows": len(rfp_by_role),
        "authorized_groups": len(authorizations),
        "department_authorized_fte": {
            d: ds(sum((decimal(g["authorized_fte"], "FTE") for g in authorizations
                       if g["department"] == d), ZERO)) for d in DEPARTMENTS},
        "rfp_listed_authorized_fte": {
            d: ds(sum((decimal(g["authorized_fte"], "FTE") for g in authorizations
                       if g["department"] == d and g["rfp_listed"]), ZERO)) for d in DEPARTMENTS},
        "rfp_narrative_counts": {"sworn_police": "121", "fire": "112"},
        "all_town_authorized_fte": "742.5",
        "scope_notes": scope["scope_notes"],
    }
    write_json(output_dir / "source-summary.json", summary)
    allocations = []
    for group in authorizations:
        for rid in group["role_ids"]:
            allocations.append({
                "authorization_group_id": group["id"],
                "department": group["department"], "published_group_title": group["title"],
                "group_authorized_fte": group["authorized_fte"], "role_id": rid,
                "published_role_title": roles_by_id[rid]["title"],
                "grade_id": roles_by_id[rid]["grade_id"],
                "allocated_fte": group["authorized_fte"] if len(group["role_ids"]) == 1 else "",
                "rfp_listed": "yes" if group["rfp_listed"] else "no",
                "mapping_note": group["mapping_note"],
            })
    write_csv(output_dir / "allocation-template.csv", allocations)
    source_bundle = [
        {**s, "content_base64": base64.b64encode((source_dir / s["file"]).read_bytes()).decode("ascii")}
        for s in manifest["sources"] if s.get("include_in_native_import", True)
    ]
    records = [{
        "id": row["role_id"], "title": row["title"], "family": row["department"],
        "level": row["grade_id"], "description": roles_by_id[row["role_id"]]["rationale"],
        "reference_amount": row["market_salary"], "currency": "USD",
        "period": "annual", "amount_scale": "1", "source_url": source_ref(manifest, "pay-plan")["url"],
    } for row in pay]
    write_json(output_dir / "jobs-source-import.json", {
        "records": records, "source_manifest": manifest, "source_bundle": source_bundle,
        "source_summary": summary, "pay_plan_rows": pay,
        "authorized_position_groups": authorizations, "rfp_position_scope": scope,
    })
    cohorts = []
    for selected_scope in ("all-public-safety", "rfp-listed"):
        for envelope in ("lower", "upper"):
            cohort = planning_cohort(output_dir, selected_scope, envelope=envelope)
            write_json(output_dir / f"planning-{selected_scope}-{envelope}.json", cohort)
            cohorts.append(cohort["planning_summary"])
    write_json(output_dir / "planning-envelopes.json", {"schema": SCHEMA, "cohorts": cohorts})
    return summary


def write_csv(path, rows, columns=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns or list(rows[0]),
                                lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)


def csv_rows(content):
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff"), newline=""))
    headers = reader.fieldnames or []
    if not headers or any(not h for h in headers) or len(set(headers)) != len(headers):
        raise InputError("CSV needs unique nonblank headers")
    rows = []
    for number, row in enumerate(reader, 2):
        if None in row or any(v is None for v in row.values()):
            raise InputError(f"CSV row {number} differs from its header width")
        if any(v.strip() for v in row.values()):
            rows.append((number, row))
    if not rows:
        raise InputError("The CSV contains no populated rows")
    return rows


def planning_cohort(compiled_dir, scope, envelope=None, allocation_csv=None, anchor="minimum"):
    if scope not in ("all-public-safety", "rfp-listed"):
        raise InputError("Choose all-public-safety or rfp-listed scope")
    if envelope not in (None, "lower", "upper") or anchor not in ("minimum", "market", "maximum"):
        raise InputError("Choose a published planning envelope or rate anchor")
    if bool(envelope) == bool(allocation_csv):
        raise InputError("Choose exactly one envelope or original allocation CSV")
    roles_doc = read_json(compiled_dir / "roles.json")
    roles = {r["id"]: r for r in roles_doc["rows"]}
    grades = {g["id"]: g for g in read_json(compiled_dir / "method.json")["grades"]}
    groups = read_json(compiled_dir / "authorized-position-groups.json")["rows"]
    if scope == "rfp-listed":
        groups = [g for g in groups if g["rfp_listed"]]
    selected = {g["id"]: g for g in groups}
    allocations = []
    original = None
    if envelope:
        anchor = "minimum" if envelope == "lower" else "maximum"
        field = {"minimum": "min", "maximum": "max"}[anchor]
        for group in groups:
            choose = min if envelope == "lower" else max
            rid = choose(group["role_ids"], key=lambda r: (decimal(grades[roles[r]["grade_id"]][field], field), r))
            allocations.append((group, rid, decimal(group["authorized_fte"], "FTE")))
        allocation_basis = (
            "For every combined authorized group, all authorized FTE are placed in the "
            + ("lowest published minimum" if envelope == "lower" else "highest published maximum")
            + " among that group's permitted source roles. This is the "
            + envelope + " full-occupancy published base-pay envelope."
        )
    else:
        raw = read_utf8(allocation_csv)
        original = {"filename": Path(allocation_csv).name, "content": raw,
                    "sha256": sha(raw.encode("utf-8"))}
        seen, totals = set(), {gid: ZERO for gid in selected}
        for number, row in csv_rows(raw):
            gid, rid = row.get("authorization_group_id"), row.get("role_id")
            if gid not in selected:
                if scope == "rfp-listed" and row.get("rfp_listed") == "no":
                    continue
                raise InputError(f"Allocation row {number} references an unknown or unselected group")
            if (gid, rid) in seen or rid not in selected[gid]["role_ids"]:
                raise InputError(f"Allocation row {number} duplicates or mismatches its original group")
            seen.add((gid, rid))
            fte = decimal(row.get("allocated_fte"), f"Allocated FTE on row {number}")
            totals[gid] += fte
            if fte > 0:
                allocations.append((selected[gid], rid, fte))
        for gid, total in totals.items():
            if total != decimal(selected[gid]["authorized_fte"], "authorized FTE"):
                raise InputError(f"Allocation for {selected[gid]['title']} totals {ds(total)}; original group has {selected[gid]['authorized_fte']} FTE")
        allocation_basis = "Operator-supplied role allocations reconcile exactly to every selected authorized group."
    field = {"minimum": "min", "market": "reference", "maximum": "max"}[anchor]
    rows = []
    for group, rid, fte in allocations:
        grade = grades[roles[rid]["grade_id"]]
        basis = f"Published {anchor} rate for grade {grade['id']}; authorized group {group['id']}."
        rows.append({
            "id": group["id"] + "--" + rid.removeprefix("apex-"),
            "role_id": rid, "fte": ds(fte), "annual_base_rate": grade[field],
            "annual_incentive_rate": "", "credited_years": "",
            "current_grade_id": grade["id"], "manager_id": "",
            "source_ref": {"authorization": group["source_ref"], "pay_grade": grade["source_ref"],
                           "authorized_group_id": group["id"], "allocation_basis": allocation_basis,
                           "rate_basis": basis, "mapping_note": group["mapping_note"]},
            "placement_rationale": basis,
        })
    result = {
        "name": f"Apex {scope} public planning — {envelope + ' envelope' if envelope else anchor + ' allocation'}",
        "edition": "FY27 source / prepared 2026-10-12", "as_of": "2026-10-12",
        "currency": "USD", "rate_basis": "annual_fulltime", "data_kind": "planning_cohort",
        "basis": allocation_basis + " Base pay only, with every selected authorized position filled for "
                 "the full year. Published annual rates are multiplied by FTE once. Incentive rates, "
                 "credited service and reporting relationships are left blank. This cohort is an "
                 "editable planning assumption derived from public authorizations; employee placement "
                 "uses the separate private workforce import.",
        "source_refs": read_json(compiled_dir / "authorized-position-groups.json")["source_refs"]
                       + roles_doc["source_refs"],
        "rows": rows,
        "planning_summary": {
            "scope": scope, "anchor": anchor, "envelope": envelope or "",
            "authorized_groups": len(groups), "rows": len(rows),
            "total_fte": ds(sum((decimal(r["fte"], "FTE") for r in rows), ZERO)),
            "annual_base_pay": money(sum((decimal(r["fte"], "FTE")
                                         * decimal(r["annual_base_rate"], "rate") for r in rows), ZERO)),
        },
    }
    if original:
        result["original_allocation_csv"] = original
    return result


def normalize_workforce(path, mapping_path, compiled_dir, as_of, name):
    exact_date(as_of)
    raw = read_utf8(path)
    mapping = read_json(mapping_path)
    fields = mapping["columns"]
    basis = mapping["base_basis"]
    if basis not in ("annual_fulltime", "annual_prorated", "hourly"):
        raise InputError("Choose annual_fulltime, annual_prorated or hourly base_basis")
    if basis == "hourly" and not mapping.get("annual_hours_basis"):
        raise InputError("Describe the source of full-time annual hours before converting hourly pay")
    if not mapping.get("basis"):
        raise InputError("Describe this private workforce export and its pay/FTE basis")
    role_doc = read_json(compiled_dir / "roles.json")
    roles = {r["id"]: r for r in role_doc["rows"]}
    aliases = mapping.get("role_aliases", {})
    parsed, rows, seen = csv_rows(raw), [], set()
    headers = set(parsed[0][1])
    for field, column in fields.items():
        if column and column not in headers:
            raise InputError(f"Mapped source column for {field} is absent: {column}")
    def get(row, field):
        column = fields.get(field)
        return row[column].strip() if column else ""
    for number, original in parsed:
        identity = get(original, "id")
        if not identity or identity in seen:
            raise InputError(f"Workforce row {number} has a blank or duplicate employee ID")
        seen.add(identity)
        rid = get(original, "role_id")
        if not rid:
            key = get(original, "department") + "|" + get(original, "role_title")
            rid = aliases.get(key)
            if not rid:
                matches = [r["id"] for r in roles.values()
                           if r["department"] == get(original, "department")
                           and r["title"] == get(original, "role_title")]
                if len(matches) == 1:
                    rid = matches[0]
        if rid not in roles:
            raise InputError(f"Workforce row {number} needs an exact role_id or explicit department|title alias")
        fte = decimal(get(original, "fte"), f"FTE on row {number}", maximum=Decimal(100000))
        if fte <= 0:
            raise InputError(f"FTE on row {number} must be greater than zero")
        source_base = decimal(get(original, "base_rate"), f"Base pay on row {number}")
        annual = source_base
        conversion = {"basis": basis, "source_value": ds(source_base)}
        if basis == "annual_prorated":
            annual = source_base / fte
            conversion["formula"] = "annual_prorated / FTE"
        elif basis == "hourly":
            hours = decimal(get(original, "annual_hours") or mapping.get("annual_hours"),
                            f"Full-time annual hours on row {number}")
            if hours <= 0:
                raise InputError(f"Annual hours on row {number} must be greater than zero")
            annual = source_base * hours
            conversion.update(formula="hourly * full_time_annual_hours", annual_hours=ds(hours),
                              annual_hours_basis=mapping["annual_hours_basis"])
        incentive = decimal(get(original, "annual_incentive_rate"), "Annual incentive", blank=True)
        years = decimal(get(original, "credited_years"), "Credited years", blank=True,
                        maximum=Decimal(100))
        rows.append({
            "id": identity, "role_id": rid, "fte": ds(fte), "annual_base_rate": ds(annual),
            "annual_incentive_rate": ds(incentive), "credited_years": ds(years),
            "manager_id": get(original, "manager_id"),
            "current_grade_id": get(original, "current_grade_id") or roles[rid]["grade_id"],
            "source_ref": {"filename": Path(path).name, "source_row": number,
                           "raw_sha256": sha(raw.encode("utf-8")), "conversion": conversion},
            "placement_rationale": "",
        })
    return {
        "name": name, "edition": as_of, "as_of": as_of,
        "currency": mapping.get("currency", "USD"), "rate_basis": "annual_fulltime", "data_kind": "employee_rates",
        "basis": mapping["basis"] + " Source base basis: " + basis
                 + ". Normalized values are full-time annual rates; FTE is applied in the scenario once. "
                 "Blank incentive and credited-service cells remain blank until supplied.",
        "source_refs": [{"label": Path(path).name, "as_of": as_of,
                         "sha256": sha(raw.encode("utf-8"))}],
        "rows": rows,
        "original_workforce_input": {
            "filename": Path(path).name, "format": "csv", "content": raw,
            "sha256": sha(raw.encode("utf-8")), "mapping": mapping,
            "mapping_sha256": sha(Path(mapping_path).read_bytes()),
            "row_count": len(rows),
        },
    }


def questionnaire_roles(path, mapping_path, base_roles_path, as_of, name):
    """Compose questionnaire evidence into a new editable original role edition."""
    exact_date(as_of)
    raw = read_utf8(path)
    mapping = read_json(mapping_path)
    if not mapping.get("basis") or not mapping.get("text_fields"):
        raise InputError("Describe the questionnaire export and map its job-content sections")
    base = read_json(base_roles_path)
    if base.get("kind") == "roles" and isinstance(base.get("content"), dict):
        base = base["content"]
    if not isinstance(base.get("rows"), list):
        raise InputError("Choose an original roles JSON document with rows")
    by_id = {r["id"]: r for r in base["rows"]}
    columns, aliases = mapping["columns"], mapping.get("role_aliases", {})
    parsed = csv_rows(raw)
    headers = set(parsed[0][1])
    for column in list(columns.values()) + list(mapping["text_fields"].values()):
        if column and column not in headers:
            raise InputError("Mapped questionnaire column is absent: " + column)
    def get(row, field):
        return row[columns[field]].strip() if columns.get(field) else ""
    grouped, identities = {}, set()
    for number, row in parsed:
        identity = get(row, "id")
        if not identity or identity in identities:
            raise InputError(f"Questionnaire row {number} needs a unique response ID")
        identities.add(identity)
        rid = get(row, "role_id")
        if not rid:
            key = get(row, "department") + "|" + get(row, "role_title")
            rid = aliases.get(key)
            if not rid:
                matches = [r["id"] for r in base["rows"]
                           if r["department"] == get(row, "department")
                           and r["title"] == get(row, "role_title")]
                rid = matches[0] if len(matches) == 1 else None
        if rid not in by_id:
            raise InputError(f"Questionnaire row {number} needs an exact original role mapping")
        sections = [{"label": label, "value": row[column].strip()}
                    for label, column in mapping["text_fields"].items()
                    if column and row[column].strip()]
        if not sections:
            raise InputError(f"Questionnaire row {number} contains no mapped job-content evidence")
        grouped.setdefault(rid, []).append({"response_id": identity, "source_row": number,
                                            "sections": sections})
    rows = []
    raw_sha = sha(raw.encode("utf-8"))
    for original in base["rows"]:
        row = dict(original)
        evidence = grouped.get(row["id"], [])
        if evidence:
            parts = []
            if row.get("description"):
                parts.append("Existing retained job description\n" + row["description"])
            for response in evidence:
                parts.append("Questionnaire response " + response["response_id"]
                             + " (source row " + str(response["source_row"]) + ")\n"
                             + "\n\n".join(s["label"] + "\n" + s["value"] for s in response["sections"]))
            description = "\n\n".join(parts)
            if len(description) > 40000:
                raise InputError("Mapped job-content sections exceed the native role description limit for " + row["title"])
            row["description"] = description
            row["rationale"] = original["rationale"] + (
                " Job-content intake adds the original questionnaire responses below. "
                "The prior grade is retained for the consulting team's subsequent classification review."
            )
            row["source_refs"] = list(row.get("source_refs", [])) + [{
                "label": Path(path).name, "as_of": as_of, "sha256": raw_sha,
                "note": "Questionnaire response rows " + ", ".join(str(e["source_row"]) for e in evidence),
            }]
        rows.append(row)
    return {
        "name": name, "edition": as_of,
        "basis": mapping["basis"] + " Existing role IDs and grades are retained. Multiple responses "
                 "for one role remain individually identified in its evidence for professional review.",
        "source_refs": list(base.get("source_refs", []))
                       + [{"label": Path(path).name, "as_of": as_of, "sha256": raw_sha}],
        "rows": rows,
        "intake_summary": {
            "responses": len(parsed), "roles_with_content": len(grouped),
            "roles_without_new_content": [r["id"] for r in rows if r["id"] not in grouped],
        },
        "original_questionnaire_input": {
            "filename": Path(path).name, "format": "csv", "content": raw,
            "sha256": raw_sha, "mapping": mapping,
            "mapping_sha256": sha(Path(mapping_path).read_bytes()),
            "base_roles_file": Path(base_roles_path).name,
            "base_roles_sha256": sha(Path(base_roles_path).read_bytes()),
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    compile_parser = commands.add_parser("compile", help="Rebuild native inputs from captured original sources")
    compile_parser.add_argument("--sources", type=Path, default=HERE / "sources")
    compile_parser.add_argument("--out", type=Path, default=HERE / "compiled")
    planning = commands.add_parser("planning", help="Make a public authorization planning cohort")
    planning.add_argument("--compiled", type=Path, default=HERE / "compiled")
    planning.add_argument("--scope", choices=["all-public-safety", "rfp-listed"], required=True)
    mode = planning.add_mutually_exclusive_group(required=True)
    mode.add_argument("--envelope", choices=["lower", "upper"])
    mode.add_argument("--allocation", type=Path)
    planning.add_argument("--anchor", choices=["minimum", "market", "maximum"], default="minimum")
    planning.add_argument("--out", type=Path, required=True)
    workforce = commands.add_parser("workforce", help="Normalize a private workforce CSV with explicit mappings")
    workforce.add_argument("--input", type=Path, required=True)
    workforce.add_argument("--mapping", type=Path, required=True)
    workforce.add_argument("--compiled", type=Path, default=HERE / "compiled")
    workforce.add_argument("--as-of", required=True)
    workforce.add_argument("--name", required=True)
    workforce.add_argument("--out", type=Path, required=True)
    questionnaire = commands.add_parser("questionnaire", help="Attach original questionnaire evidence to retained roles")
    questionnaire.add_argument("--input", type=Path, required=True)
    questionnaire.add_argument("--mapping", type=Path, required=True)
    questionnaire.add_argument("--base-roles", type=Path, default=HERE / "compiled" / "roles.json")
    questionnaire.add_argument("--as-of", required=True)
    questionnaire.add_argument("--name", required=True)
    questionnaire.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "compile":
            result = compile_inputs(args.sources, args.out)
        elif args.command == "planning":
            result = planning_cohort(args.compiled, args.scope, args.envelope, args.allocation, args.anchor)
            write_json(args.out, result)
            result = result["planning_summary"]
        elif args.command == "workforce":
            result = normalize_workforce(args.input, args.mapping, args.compiled, args.as_of, args.name)
            write_json(args.out, result)
            result = {"rows": len(result["rows"]), "as_of": result["as_of"], "out": str(args.out)}
        else:
            result = questionnaire_roles(args.input, args.mapping, args.base_roles, args.as_of, args.name)
            write_json(args.out, result)
            result = {**result["intake_summary"], "out": str(args.out)}
        print(dumps(result), end="")
    except (InputError, OSError, KeyError, ValueError) as exc:
        print("Apex intake: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
