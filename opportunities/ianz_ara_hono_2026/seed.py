"""Receive the supplied complete public transcription, preserving its limits."""
from __future__ import annotations
import csv
import io
import pathlib
from schema import OPERATION, ROOT, copy, digest, dumps, loads, record_key

PUBLIC_FILES = (
    "source-register.json", "data/public-programmes.csv", "data/public-accreditations.csv",
    "data/source-editions.csv", "data/public-scope-items.csv", "data/fee-rates.csv",
    "data/fee-controls.json", "data/forms-register.csv", "data/transition-profile.json",
    "data/source-change-review.json", "contracts/data-contract.json",
    "contracts/target-mapping-profile.json", "contracts/reconciliation-contract.json",
    "contracts/document-edition-profile.json", "contracts/workflow-contract.json"
)

def _csv(path):
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"), newline="")))

def public_seed(root=ROOT):
    root = pathlib.Path(root)
    files = [{"path": name, "content": (root / name).read_bytes(),
              "filename": pathlib.PurePosixPath(name).name,
              "media_type": "text/csv" if name.endswith(".csv") else "application/json",
              "origin": "original_94FE_public_transcription"} for name in PUBLIC_FILES]
    hashes = {item["path"]: digest(item["content"]) for item in files}
    register = loads((root / "source-register.json").read_text(encoding="utf-8"))
    sources = {source["id"]: source for source in register["sources"]}
    editions = _csv(root / "data/source-editions.csv")
    edition_for = {row["source_id"]: row["edition_key"] for row in editions}
    for source_id in sources:
        edition_for.setdefault(source_id, source_id + "-observed")
    records = []
    def add(entity, values, *, source_id=None, source_file=None, row=None, origins=None, notes=None):
        provenance = {}
        for field in values:
            provenance[field] = {
                "origin": (origins or {}).get(field, "source_transcription" if source_id else "authored_staging"),
                "source_id": source_id, "source_edition_id": edition_for.get(source_id),
                "source_file_id": "sha256:" + hashes[source_file]["sha256"] if source_file else None,
                "source_locator": sources[source_id].get("locator") if source_id else None
            }
        annotations = {"operation": OPERATION}
        if row is not None:
            annotations["original_transcribed_row"] = row
        if notes:
            annotations["notes"] = notes
        records.append({"entity": entity, "values": values, "provenance": provenance, "annotations": annotations})

    editions_by_source = {row["source_id"]: row for row in editions}
    for source_id, source in sources.items():
        edition = editions_by_source.get(source_id)
        if edition:
            source_kind = "indexed_excerpt" if "indexed" in edition["coverage"] else "original_pdf_text"
            date, issue, coverage = edition["edition_date"], edition["issue"], edition["coverage"]
            selected = edition["current_selection"] == "true"
            source_file = "data/source-editions.csv"
        else:
            source_kind = "original_pdf_text" if source["kind"] == "official_pdf_text" else "structured_export"
            date, issue, coverage = None, source.get("edition"), source.get("locator", "Declared public source observation")
            selected, source_file = True, "source-register.json"
        values = {"source_edition_id": edition_for[source_id], "source_id": source_id,
                  "source_kind": source_kind, "source_url": source["url"],
                  "retrieved_at": source["retrieved_at"], "declared_issue": issue,
                  "declared_date": date, "coverage": coverage, "selected_for_current": selected,
                  "transcription_sha256": hashes[source_file]["sha256"],
                  "provenance_notes": "Original public source observation supplied by 94FE. The transcription digest identifies the retained collection file; original publisher bytes have a separate digest only after file receiving."}
        if source_id == "S15":
            values["supersedes_edition_id"] = "826-issue22-indexed"
        if source_id == "S16":
            values["supersedes_edition_id"] = "791-issue51-indexed"
        add("source_edition", values, source_id=source_id, source_file=source_file, row=source,
            notes="A linked PDF or DOCX does not assert that its binary body has been received.")

    for row in _csv(root / "data/public-programmes.csv"):
        values = {key: row[key] for key in ["programme_key", "published_label", "navigation_group"]}
        values["source_edition_id"] = edition_for[row["source_id"]]
        if row["programme_key"] == "drinking-water":
            values["fee_profile_id"] = "AS19-2026-07"
        if row["programme_key"] == "inspection-bodies":
            values["fee_profile_id"] = "AS14-2026-07"
        add("programme", values, source_id=row["source_id"], source_file="data/public-programmes.csv",
            row=row, origins={"programme_key": "authored_staging_key", "fee_profile_id": "explicit_published_programme_link"})

    accreditations = _csv(root / "data/public-accreditations.csv")
    by_number = {row["accreditation_number"]: row for row in accreditations}
    for row in accreditations:
        source_id = row["source_id"]
        account_key = dumps(["IANZ", row["issuer_client_number"]])
        facility_key = "public-site:" + row["issuer_programme_id"] + ":1"
        labels = [{"display_name": edition["published_organisation"],
                   "source_edition_id": edition["edition_key"], "declared_date": edition["edition_date"],
                   "coverage": edition["coverage"]} for edition in editions
                  if edition["issuer_programme_id"] == row["issuer_programme_id"]]
        account = {"issuer_namespace": "IANZ", "issuer_client_number": row["issuer_client_number"],
                   "display_name": row["published_organisation"], "source_edition_id": edition_for[source_id],
                   "label_history": labels, "merge_decisions": [], "visibility": "public"}
        add("issuer_account", account, source_id=source_id, source_file="data/public-accreditations.csv", row=row,
            notes="The published parent label is retained in the source row. It is not an asserted legal identity or merge.")
        facility = {"facility_key": facility_key, "issuer_account_key": account_key,
                    "published_label": row["facility_label"], "address_text": row["facility_label"],
                    "site_kind": "unresolved", "source_edition_id": edition_for[source_id]}
        add("facility", facility, source_id=source_id, source_file="data/public-accreditations.csv", row=row,
            origins={"facility_key": "authored_mapping_from_published_programme_and_location",
                     "site_kind": "unresolved", "issuer_account_key": "original_issuer_client_link"})
        accreditation = {
            "issuer_programme_id": row["issuer_programme_id"], "issuer_account_key": account_key,
            "accreditation_number": row["accreditation_number"], "programme_key": row["programme_key"],
            "facility_keys": [facility_key], "initial_accreditation_date": row["initial_accreditation_date"],
            "selected_scope_edition_id": edition_for[source_id], "standard_edition": row["standard_edition"],
            "publication_observation": row["publication_observation"], "source_edition_id": edition_for[source_id]
        }
        if row["inspection_type"]:
            accreditation["inspection_classification"] = row["inspection_type"]
        if row["expiry_date"]:
            accreditation["expiry_date"] = row["expiry_date"]
        add("accreditation", accreditation, source_id=source_id, source_file="data/public-accreditations.csv", row=row,
            notes="An accessible schedule does not imply a current issuer status or an invented expiry.")
    for row in _csv(root / "data/public-scope-items.csv"):
        accreditation = by_number[row["accreditation_number"]]
        values = {"scope_item_key": row["scope_row_key"], "accreditation_key": accreditation["issuer_programme_id"],
                  "source_edition_id": edition_for[row["source_id"]], "activity": row["activity"],
                  "classification": row["classification"], "item_label": row["item"],
                  "method_reference": row["method_reference"], "conditions": [row["qualifier"]] if row["qualifier"] else [],
                  "facility_keys": ["public-site:" + accreditation["issuer_programme_id"] + ":1"],
                  "source_page": int(row["source_page"]), "source_locator": "Published schedule, selected transcribed scope row " + row["scope_row_key"],
                  "coverage": row["coverage"]}
        add("scope_item", values, source_id=row["source_id"], source_file="data/public-scope-items.csv",
            row=row, origins={"scope_item_key": "authored_staging_row_key", "facility_keys": "explicit_public_schedule_location"})
    tariffs = _csv(root / "data/fee-rates.csv")
    for profile_id in sorted({row["profile"] for row in tariffs}):
        rows = [row for row in tariffs if row["profile"] == profile_id]
        source_id = rows[0]["source_id"]
        values = {"fee_profile_id": profile_id, "source_edition_id": edition_for[source_id],
                  "programme_key": "drinking-water" if profile_id.startswith("AS19") else "inspection-bodies",
                  "currency": "NZD", "tax_basis": rows[0]["tax_basis"], "published_period": "2026/27",
                  "publication_month": rows[0]["publication_month"], "charge_rules": rows}
        add("fee_profile", values, source_id=source_id, source_file="data/fee-rates.csv",
            notes="Published tariff only. Customer tax, rounding and invoice quantities are received separately.")
    return {"files": files, "records": records,
            "source_change_review": loads((root / "data/source-change-review.json").read_text()),
            "transition_profile": loads((root / "data/transition-profile.json").read_text()),
            "fee_controls": loads((root / "data/fee-controls.json").read_text()),
            "forms_register": _csv(root / "data/forms-register.csv"),
            "source_register": register,
            "counts": {"source_entries": len(sources), "observed_scope_editions": len(editions),
                       "programme_rows": 19, "accreditation_rows": len(accreditations),
                       "scope_rows": sum(row["entity"] == "scope_item" for row in records),
                       "tariffs": len(tariffs), "canonical_records": len(records)}}
