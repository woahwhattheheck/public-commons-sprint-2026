"""Jurisdiction-qualified original water classifications.

SC v1 is preserved. New state editions retain literal labels and separate
components; this module never equates state classes or determines reach geometry.
"""
from __future__ import annotations

import re

REGISTRY_SCHEMAS = ("upstate.classified-water-registry/v1", "upstate.classified-water-registry/v2")
SYSTEMS = {"SC": "SC-R61-69", "NC": "NC-15A-NCAC-02B", "GA": "GA-391-3-6-.03"}
FIELDS = ("jurisdiction", "classification_system", "source_class_label", "class_components",
          "primary_class", "supplemental_classes", "special_markers", "original_index",
          "effective_date", "native_effective_date", "classification_role")


def classification_scope(value, *, required=False):
    jurisdiction = value.get("jurisdiction")
    system = value.get("classification_system")
    if jurisdiction is None and system is None and not required:
        return "SC", SYSTEMS["SC"]
    if not isinstance(jurisdiction, str) or jurisdiction not in SYSTEMS:
        raise ValueError("Classification jurisdiction must explicitly be SC, NC or GA")
    if system != SYSTEMS[jurisdiction]:
        raise ValueError("Classification system must match the original jurisdiction")
    return jurisdiction, system


def validate_registry(value):
    schema = value.get("schema")
    if schema not in REGISTRY_SCHEMAS:
        raise ValueError("Expected native classified-water registry v1 or v2")
    edition = value.get("edition")
    if not isinstance(edition, dict) or not edition.get("id"):
        raise ValueError("Legal registry requires an original edition identity")
    # Historical SC editions spell the jurisdiction 'South Carolina'. It remains
    # unchanged in the retained source; only matching obtains its SC default.
    if schema == REGISTRY_SCHEMAS[0]:
        if edition.get("classification_system") or edition.get("jurisdiction") not in (None, "SC", "South Carolina"):
            raise ValueError("Foreign legal editions require explicit registry v2")
        scope = ("SC", SYSTEMS["SC"])
    else:
        scope = classification_scope(edition, required=True)
    allowed_statuses = ("current", "proposed") if schema == REGISTRY_SCHEMAS[0] else ("current", "proposed", "source-published", "historical", "superseded")
    if edition.get("status") not in allowed_statuses:
        raise ValueError("Legal registry must retain its explicit edition status")
    records = value.get("records")
    if not isinstance(records, list):
        raise ValueError("Legal registry requires complete original records")
    seen = set()
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not record["id"]:
            raise ValueError("Each legal record requires its original stable identity")
        if record["id"] in seen:
            raise ValueError("Duplicate legal record identity")
        seen.add(record["id"])
        if not isinstance(record.get("waterbody_name"), str) or not isinstance(record.get("class_code"), str):
            raise ValueError("Each legal record must retain a name and literal class")
        if schema == REGISTRY_SCHEMAS[1]:
            if any(key in record for key in ("jurisdiction", "classification_system")) and classification_scope(record, required=True) != scope:
                raise ValueError("Legal record and edition jurisdictions differ")
            if not isinstance(record.get("class_components"), list) or any(not isinstance(v, str) or not v for v in record["class_components"]):
                raise ValueError("Registry v2 requires original class components")
            if "rfp_high_quality_candidate" in record and not isinstance(record["rfp_high_quality_candidate"], bool):
                raise ValueError("The source priority predicate must be an explicit boolean")
    return scope


def record_scope(record, edition):
    if edition.get("classification_system"):
        scope = classification_scope(edition, required=True)
        if any(key in record for key in ("jurisdiction", "classification_system")):
            if classification_scope(record, required=True) != scope:
                raise ValueError("Legal record and edition jurisdictions differ")
        return scope
    if edition.get("jurisdiction") not in (None, "SC", "South Carolina"):
        raise ValueError("Foreign legal edition lacks a classification system")
    return "SC", SYSTEMS["SC"]


def literal_class(label, config):
    """Decode only the selected jurisdiction; retain exact original punctuation."""
    jurisdiction, system = classification_scope(config, required=True)
    text = "" if label is None else str(label)
    base = {"jurisdiction": jurisdiction, "classification_system": system,
            "class_label": label, "source_class_label": label, "class_code": text or None,
            "previous_class": None, "site_specific": None}
    if jurisdiction == "NC":
        markers = [v for v in ("+", "@") if v in text]
        clean = re.sub(r":(?=[+@])", "", text).replace("+", "").replace("@", "")
        components = [v.strip() for v in re.split(r"[;,]", clean) if v.strip()]
        primary = components[0] if components else None
        supplemental = components[1:]
        return {**base, "class_components": components, "primary_class": primary,
                "supplemental_classes": supplemental, "special_markers": markers,
                "rfp_high_quality_candidate": any(v in ("Tr", "HQW", "ORW") for v in components),
                "classification_role": "designated-water-class"}
    if jurisdiction == "GA":
        forms = {
            "Drinking Water": ["Drinking Water"],
            "Drinking Water Supplies": ["Drinking Water"],
            "Recreation": ["Recreation"],
            "Fishing": ["Fishing"],
            "Coastal Fishing": ["Coastal Fishing"],
            "Wild River": ["Wild River"],
            "Scenic River": ["Scenic River"],
            "Wild and Scenic": ["Wild River", "Scenic River"],
            "Recreation and Drinking Water": ["Recreation", "Drinking Water"],
            "Recreation and Wild and Scenic": ["Recreation", "Wild River", "Scenic River"],
            "Primary Trout Waters": ["Primary Trout Waters"],
            "Secondary Trout Streams": ["Secondary Trout Streams"],
            "Primary": ["Primary Trout Waters"],
            "Secondary": ["Secondary Trout Streams"],
            "ONRW": ["ONRW"],
        }
        # Whitespace folding is for component recognition; class_code is exact.
        components = forms.get(" ".join(text.split()), [])
        declared = config.get("class_components", {}).get(text)
        if declared is not None:
            if not isinstance(declared, list) or any(not isinstance(v, str) or not v for v in declared):
                raise ValueError("Declared GA components must be nonempty strings")
            components = list(declared)
        return {**base, "class_components": components, "primary_class": None,
                "supplemental_classes": [], "special_markers": [],
                "rfp_high_quality_candidate": any(v in ("Primary Trout Waters", "Secondary Trout Streams", "ONRW", "Wild River", "Scenic River") for v in components),
                "classification_role": config.get("classification_role", "designated-use")}
    raise ValueError("SC classes use the original R.61-69 parser")


def display_fields(record, edition=None):
    """View-only enrichment: never modify retained original record bodies."""
    scope = record_scope(record, edition) if edition is not None else classification_scope(record)
    return {**{key: record[key] for key in FIELDS if key in record},
            "jurisdiction": scope[0], "classification_system": scope[1]}


def classification_key(value, edition=None):
    scope = record_scope(value, edition) if edition is not None else classification_scope(value)
    return (*scope, value.get("class_code"))
