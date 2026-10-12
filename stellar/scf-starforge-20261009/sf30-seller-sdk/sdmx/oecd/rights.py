"""MIT. Source-bound OECD data citation and portable customer acknowledgment."""
from __future__ import annotations

from datetime import datetime
from urllib.parse import urlsplit

from bootstrap import InputError, digest, json_bytes

RIGHTS_SCHEMA = "stellar-forge.oecd-source-rights.v1"
TERMS_URL = "https://www.oecd.org/en/about/terms-conditions.html"
DATASET_URL = "https://www.oecd.org/en/data/datasets/oecd-composite-leading-indicators-clis.html"
ACKNOWLEDGMENT = (
    "When sharing or licensing work that uses these data, retain the dataset acknowledgment "
    "and require recipients and any further sublicensees to retain the same acknowledgment."
)
INTERPRETATION = (
    "Stellar Forge independently selects the report window, calculates index-point differences "
    "and presents the briefing. OECD supplies the original observations and referenced metadata."
)


def receipt_access(acquisition):
    """Use an actual retained acquisition field; publisher Prepared is not an access time."""
    receipt = acquisition.get("receipt", {})
    if not isinstance(receipt, dict):
        return None
    for field in ("completed_at", "readback_recorded_at", "retrieved_at", "accessed_at"):
        value = receipt.get(field)
        if not isinstance(value, str):
            continue
        try:
            instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue
        if instant.tzinfo is not None and instant.utcoffset() is not None:
            return {"accessed_at": value, "accessed_date": instant.date().isoformat(),
                    "accessed_time_field": "receipt." + field}
    return None


def source_credit(source, acquisition):
    origin = acquisition.get("origin", source.get("origin", ""))
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise InputError("A cited source requires its retained public HTTPS acquisition URL")
    access = receipt_access(acquisition)
    if access is None:
        raise InputError("Retain a timezone-qualified acquisition receipt for " + source["name"] +
                         " before creating a cited edition")
    publisher = "SDMX" if "/codelist/SDMX/" in parsed.path else "OECD"
    return {"sha256": source["sha256"], "bytes": source["bytes"], "name": source["name"],
            "origin": origin, "kind": source["kind"], "coverage": source.get("coverage", {}),
            "acquisition_sha256": digest(json_bytes(acquisition)), **access,
            "attribution": {"publisher": publisher, "title": source["name"],
                            "source_url": origin, "accessed_date": access["accessed_date"]}}


def credited_sources(catalog, capture, retained=None):
    """Reopen using the exact recorded native acquisition, including in a populated catalog."""
    if retained is not None and (not isinstance(retained, list) or len(retained) != len(capture["sources"])):
        raise InputError("The retained report must credit every original capture source")
    result = []
    for index, source in enumerate(capture["sources"]):
        acquisitions = catalog.source.source(source["id"])["acquisitions"]
        expected = retained[index] if retained is not None else None
        if expected is not None:
            if not isinstance(expected, dict):
                raise InputError("The retained source credit is not an object")
            matches = [a for a in acquisitions
                       if digest(json_bytes(a)) == expected.get("acquisition_sha256")]
            if len(matches) != 1:
                raise InputError("The cited native acquisition is absent from the retained source history")
            credit = source_credit(source, matches[0])
            if credit != expected:
                raise InputError("The citation differs from its original acquisition receipt")
        else:
            matches = [a for a in acquisitions if a.get("origin") == source.get("origin")
                       and a.get("name") == source["name"] and receipt_access(a) is not None]
            if not matches:
                raise InputError("Supply the original acquisition receipt for " + source["name"] +
                                 "; an import timestamp is not its publisher access date")
            # First retained valid acquisition is selected once, then its identity
            # is pinned in the report and verified on every fresh project import.
            credit = source_credit(source, matches[0])
        result.append(credit)
    return result


def dataset_citation(sources):
    data = [item for item in sources if item["kind"] == "data"]
    if len(data) != 1:
        raise InputError("A cited CLI edition requires exactly one original observation response")
    source = data[0]
    year = int(source["accessed_date"][:4])
    citation = ("OECD (" + str(year) + "), Composite leading indicators, OECD Data Explorer, " +
                source["origin"] + " (accessed " + source["accessed_date"] + ").")
    return {"publisher": "OECD", "year": year, "dataset": "Composite leading indicators",
            "data_source": "OECD Data Explorer", "dataset_url": DATASET_URL,
            "source_url": source["origin"], "accessed_at": source["accessed_at"],
            "accessed_date": source["accessed_date"], "accessed_time_field": source["accessed_time_field"],
            "source_sha256": source["sha256"], "acquisition_sha256": source["acquisition_sha256"],
            "text": citation, "terms": {"title": "OECD Data Terms, section 3", "url": TERMS_URL},
            "downstream_acknowledgment": ACKNOWLEDGMENT, "analysis_credit": INTERPRETATION}


def rights_document(report):
    return {"schema": RIGHTS_SCHEMA, "briefing_id": report["id"],
            "catalog_edition_id": report["catalog_edition_id"],
            "source_capture_id": report["source_capture_id"], "native_snapshot": report["native_snapshot"],
            "citation": report["citation"], "sources": report["sources"],
            "source_annotations": "The complete original dataflow, DSD and codelists retain their source and rights annotations."}


def render_rights(report):
    rights = rights_document(report)
    citation = rights["citation"]
    lines = ["# Original OECD data and customer acknowledgment", "", citation["text"], "",
             citation["terms"]["title"] + ": " + citation["terms"]["url"], "",
             citation["downstream_acknowledgment"], "", citation["analysis_credit"], "",
             "The original dataset and third-party annotations remain applicable. Statistical data use "
             "is governed by the OECD Data Terms; this source credit does not change the dataset's terms.", "",
             "The access date comes from " + citation["accessed_time_field"] + " (" +
             citation["accessed_at"] + "), retained with the original source acquisition.", "",
             "Briefing: " + rights["briefing_id"], "Catalog edition: " + rights["catalog_edition_id"],
             "Capture: " + rights["source_capture_id"], "Native snapshot: " + rights["native_snapshot"],
             "", "## Complete original source credits", ""]
    for source in rights["sources"]:
        lines.extend([source["attribution"]["publisher"] + ": " + source["name"],
                      source["origin"], "Accessed " + source["accessed_date"] + " via " +
                      source["accessed_time_field"] + " = " + source["accessed_at"],
                      "Original bytes: " + str(source["bytes"]) + "; SHA-256: " + source["sha256"],
                      "Retained acquisition SHA-256: " + source["acquisition_sha256"], ""])
    lines.extend([rights["source_annotations"], "",
                  "Keep this file with the CSV, native dataset and customer handover. The original Macrobond "
                  "customer ZIP also carries this acknowledgment in its standard ZIP comment.", ""])
    return "\n".join(lines)
