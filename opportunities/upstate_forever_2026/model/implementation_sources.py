"""Import source selections without recomputing scientific or planning results.

The native community adapter follows communities.py blob
dd7785ad8633af7b038857b83408534166b0c8cb in woahwhattheheck/commons,
opportunities/upstate_forever_2026/model/communities.py.
The conservation adapter follows conservation.py blob
961a444d0d8f3608592601819d62ca4a90ae927c in
woahwhattheheck/public-commons-sprint-2026 at commit
f2c43c5530bc30b0c7aa6133c796ecc140c02566.

Public API: import_selection(document, source_id, kind, **options).
The result can be merged into upstate.implementation-plan/v1 using the
implementation store's revision and immutable-candidate checks.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from hashlib import sha256
import json
import math
import re
from typing import Any

__all__ = ["SourceImportError", "import_selection"]

RESULT_SCHEMA = "upstate.implementation-source-import/v1"
SOURCE_SCHEMA = "upstate.implementation-selection-source/v1"
CANDIDATE_SCHEMA = "upstate.implementation-candidate-source/v1"
MAX_JSON_BYTES = 16 * 1024 * 1024
SAFE_INTEGER = 9007199254740991
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")
KINDS = {
    "community_plan", "community_plans", "conservation_selection",
    "portfolio_selection", "mapped_selection", "conservation_portfolio",
}
MAPPING_FIELDS = {
    "rows", "id", "label", "source_title", "area_ha", "modeled_benefits",
    "selected", "all_rows", "method_key", "assignee", "next_step",
}
NATIVE_MAPPING = {
    "rows": "/interventions", "id": "/id", "label": "/title",
    "source_title": "/title", "method_key": "/strategy",
    "assignee": "/owner", "next_step": "/next_step",
    "selected": {
        "pointer": "/status",
        "values": ["selected", "in_progress", "complete"],
    },
}
CONSERVATION_MAPPING = {
    "rows": "/selected_candidates", "id": "/id", "label": "/label",
    "area_ha": "/area_ha", "all_rows": True,
}
CONSERVATION_SCHEMA = "upstate.conservation-portfolio/v1"
CONSERVATION_ENVELOPE = "upstate.implementation-conservation-source/v1"
NATIVE_STATUSES = {"proposed", "selected", "in_progress", "complete"}
NATIVE_STRATEGIES = {"protect", "restore", "monitor", "investigate", "other"}


class SourceImportError(ValueError):
    """The source, selection, or explicit mapping needs a concrete correction."""


def _text(value: Any, name: str, *, empty: bool = False) -> str:
    if not isinstance(value, str) or (not empty and not value.strip()):
        raise SourceImportError(name + " must be " +
                                ("a string" if empty else "a nonempty string"))
    return value


def _pointer_parts(pointer: Any, name: str) -> list[str]:
    _text(pointer, name, empty=True)
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise SourceImportError(name + " must be an RFC 6901 JSON pointer")
    parts = pointer[1:].split("/")
    for part in parts:
        if re.search(r"~(?:[^01]|$)", part):
            raise SourceImportError(name + " has an invalid JSON pointer escape")
    return [part.replace("~1", "/").replace("~0", "~") for part in parts]


def _get(document: Any, pointer: str, name: str) -> Any:
    node = document
    for part in _pointer_parts(pointer, name):
        if isinstance(node, dict):
            if part not in node:
                raise SourceImportError(name + " is absent at " + repr(pointer))
            node = node[part]
        elif isinstance(node, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", part):
                raise SourceImportError(name + " needs an array index at " + repr(pointer))
            index = int(part)
            if index >= len(node):
                raise SourceImportError(name + " is absent at " + repr(pointer))
            node = node[index]
        else:
            raise SourceImportError(name + " cannot traverse " + repr(pointer))
    return node


def _json_copy(value: Any, path: str = "$", depth: int = 0) -> Any:
    if depth > 80:
        raise SourceImportError(path + " exceeds the supported JSON nesting depth")
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        if abs(value) > SAFE_INTEGER:
            raise SourceImportError(path + " is outside the safe JSON integer range")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise SourceImportError(path + " must be a finite JSON number")
        if value.is_integer() and abs(value) > SAFE_INTEGER:
            raise SourceImportError(path + " is outside the safe JSON integer range")
        return value
    if isinstance(value, Mapping):
        result = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise SourceImportError(path + " has a non-string JSON object key")
            result[key] = _json_copy(item, path + "[" + repr(key) + "]", depth + 1)
        return result
    if isinstance(value, list):
        return [_json_copy(item, path + "[" + str(index) + "]", depth + 1)
                for index, item in enumerate(value)]
    raise SourceImportError(path + " is not a JSON value")


def _encoded(value: Any) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False,
                          sort_keys=True, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError) as exc:
        raise SourceImportError("Source cannot be encoded as canonical UTF-8 JSON") from exc


def _digest(value: Any) -> str:
    return sha256(_encoded(value)).hexdigest()


def _row_id(value: Any, name: str) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise SourceImportError(name + " must be a nonempty string or safe integer")
    if isinstance(value, int):
        if abs(value) > SAFE_INTEGER:
            raise SourceImportError(name + " is outside the safe JSON integer range")
        return str(value)
    return _text(value, name)


def _mapping(kind: str, supplied: Mapping[str, Any] | None) -> dict[str, Any]:
    if kind in ("community_plan", "conservation_portfolio"):
        if supplied is not None:
            raise SourceImportError(
                kind + " uses the native export contract; "
                "use mapped_selection for a custom field mapping")
        return deepcopy(NATIVE_MAPPING if kind == "community_plan" else CONSERVATION_MAPPING)
    if not isinstance(supplied, Mapping):
        raise SourceImportError(kind + " requires an explicit field_mapping")
    result = _json_copy(supplied, "$field_mapping")
    extra = set(result) - MAPPING_FIELDS
    if extra:
        raise SourceImportError("Unknown field_mapping keys: " + ", ".join(sorted(extra)))
    for name in ("rows", "id", "label"):
        if name not in result:
            raise SourceImportError("field_mapping requires " + name)
    for name in MAPPING_FIELDS - {"selected", "all_rows"}:
        if name in result:
            _pointer_parts(result[name], "field_mapping." + name)
    if "all_rows" in result and not isinstance(result["all_rows"], bool):
        raise SourceImportError("field_mapping.all_rows must be a boolean")
    if "selected" in result:
        selector = result["selected"]
        if (not isinstance(selector, dict)
                or set(selector) != {"pointer", "values"}
                or not isinstance(selector["values"], list)
                or not selector["values"]):
            raise SourceImportError(
                "field_mapping.selected requires pointer and a nonempty values array")
        _pointer_parts(selector["pointer"], "field_mapping.selected.pointer")
        for value in selector["values"]:
            if isinstance(value, (dict, list)):
                raise SourceImportError("Selection values must be JSON scalar values")
        if result.get("all_rows"):
            raise SourceImportError("Use selected or all_rows, not both")
    return result


def _native_document(document: dict[str, Any]) -> None:
    for name in ("title", "table_id", "purpose"):
        _text(document.get(name), "Community plan " + name)
    for name in ("source", "metadata", "context"):
        if not isinstance(document.get(name), dict):
            raise SourceImportError("Native community plan requires object " + name)
    if not isinstance(document.get("selected_groups"), list):
        raise SourceImportError("Native community plan requires selected_groups")
    revision = document.get("revision_number")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise SourceImportError("Native community plan requires positive revision_number")
    context = document["context"]
    if not isinstance(context.get("snapshots"), dict):
        raise SourceImportError("Native community plan context requires snapshots")
    if not isinstance(context.get("physical_totals"), list):
        raise SourceImportError("Native community plan context requires physical_totals")
    if not isinstance(context.get("snapshot_sha256"), str) or not re.fullmatch(
            r"[0-9a-f]{64}", context["snapshot_sha256"]):
        raise SourceImportError("Native community plan context requires snapshot_sha256")


def _native_row(row: dict[str, Any], key: str) -> None:
    for name in ("utility_id", "watershed_id", "reason"):
        _text(row.get(name), "Community intervention " + key + " " + name)
    if not isinstance(row.get("status"), str) or row["status"] not in NATIVE_STATUSES:
        raise SourceImportError("Community intervention " + key + " has unsupported status")
    if not isinstance(row.get("strategy"), str) or row["strategy"] not in NATIVE_STRATEGIES:
        raise SourceImportError("Community intervention " + key + " has unsupported strategy")
    geoids = row.get("geoids")
    if not isinstance(geoids, list) or not geoids:
        raise SourceImportError("Community intervention " + key + " requires geoids")
    for geoid in geoids:
        _text(geoid, "Community intervention geoid")
    if not isinstance(row.get("community_context"), dict):
        raise SourceImportError("Community intervention " + key + " requires community_context")
    for name in ("owner", "next_step", "notes"):
        _text(row.get(name), "Community intervention " + name, empty=True)
    estimate = row.get("cost_estimate_usd")
    if estimate is not None and (
            not isinstance(estimate, str)
            or not re.fullmatch(r"(?:0|[1-9][0-9]*)\.[0-9]{2}", estimate)):
        raise SourceImportError("Native cost_estimate_usd must be null or a USD decimal string")



def _nonnegative(value: Any, name: str, *, nullable: bool = False) -> None:
    if value is None and nullable:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        raise SourceImportError(name + " must be a nonnegative JSON number" +
                                (" or null" if nullable else ""))


def _conservation_document(source: dict[str, Any]) -> tuple[dict[str, Any], str]:
    wrapped = source.get("schema") == CONSERVATION_ENVELOPE
    portfolio = source.get("portfolio") if wrapped else source
    if not isinstance(portfolio, dict) or portfolio.get("schema") != CONSERVATION_SCHEMA:
        raise SourceImportError(
            "conservation_portfolio requires original upstate.conservation-portfolio/v1 "
            "JSON or an upstate.implementation-conservation-source/v1 context envelope")
    for name in ("id", "study_id"):
        value = portfolio.get(name)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise SourceImportError("Conservation portfolio " + name + " must be an original 64hex ID")
    if not isinstance(portfolio.get("summary"), dict):
        raise SourceImportError("Conservation portfolio requires its original summary")
    for name in ("selected_candidates", "selected_ids", "skipped", "selection_steps"):
        if not isinstance(portfolio.get(name), list):
            raise SourceImportError("Conservation portfolio requires array " + name)
    ids = portfolio["selected_ids"]
    if not ids or any(not isinstance(key, str) or not key.strip() for key in ids):
        raise SourceImportError("Conservation portfolio selected_ids must contain original text IDs")
    if len(set(ids)) != len(ids):
        raise SourceImportError("Conservation portfolio contains duplicate selected_ids")
    actual = [row.get("id") if isinstance(row, dict) else None
              for row in portfolio["selected_candidates"]]
    if actual != ids:
        raise SourceImportError("Conservation selected_candidates must match selected_ids in original order")
    if not wrapped:
        return portfolio, ""
    for name in ("plan", "selection"):
        if not isinstance(source.get(name), dict):
            raise SourceImportError("Conservation context envelope requires original " + name + " object")
    plan, selection = source["plan"], source["selection"]
    if plan.get("schema") != "upstate.conservation-plan/v1" or plan.get("state") != "complete":
        raise SourceImportError("Conservation context requires its completed original saved plan")
    _text(plan.get("title"), "Conservation plan title")
    for name in ("id", "study_id", "selected_ids", "summary", "skipped", "selection_steps"):
        if plan.get(name) != portfolio[name]:
            raise SourceImportError("Conservation plan and portfolio differ at " + name)
    for name in ("study_selection", "plan_selection", "method", "normalization"):
        if not isinstance(selection.get(name), dict):
            raise SourceImportError("Conservation selection file requires object " + name)
    if selection.get("selected_ids") != ids:
        raise SourceImportError("Conservation selection file has different selected_ids")
    if selection["plan_selection"] != plan.get("selection"):
        raise SourceImportError("Conservation selection file differs from the saved plan selection")
    if selection["plan_selection"].get("study_id") != portfolio["study_id"]:
        raise SourceImportError("Conservation plan selection identifies another study")
    for name in ("spec", "bindings"):
        if not isinstance(selection["study_selection"].get(name), dict):
            raise SourceImportError("Conservation study selection requires " + name)
    files = plan.get("files")
    if not isinstance(files, dict):
        raise SourceImportError("Conservation saved plan requires original file descriptors")
    for name in ("portfolio", "selection", "footprint"):
        descriptor = files.get(name)
        if not isinstance(descriptor, dict):
            raise SourceImportError("Conservation plan requires file descriptor " + name)
        _text(descriptor.get("path"), "Conservation " + name + " original file path")
        checksum = descriptor.get("sha256")
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise SourceImportError("Conservation " + name + " requires original file SHA256")
    return portfolio, "/portfolio"


def _conservation_row(row: dict[str, Any], key: str) -> None:
    _text(row.get("id"), "Conservation original candidate ID")
    identity = row.get("source_identity")
    if not isinstance(identity, dict):
        raise SourceImportError("Conservation candidate " + key + " requires source_identity")
    for name in ("source_collection_id", "source_id", "native_id"):
        _text(identity.get(name), "Conservation source_identity." + name)
    if identity["native_id"] != row["id"]:
        raise SourceImportError("Conservation native source ID differs from candidate ID")
    unit_type = row.get("unit_type")
    if not isinstance(unit_type, str) or unit_type not in ("parcel", "watershed", "management_unit"):
        raise SourceImportError("Conservation candidate requires original unit_type")
    metric_state = row.get("metric_state")
    if not isinstance(metric_state, str) or metric_state not in ("modeled", "context_only"):
        raise SourceImportError("Conservation candidate requires original metric_state")
    for name in ("area_ha", "reporting_area_ha"):
        _nonnegative(row.get(name), "Conservation candidate " + name)
    if "cost" not in row or "currency" not in row:
        raise SourceImportError("Conservation candidate requires original cost and currency fields")
    _nonnegative(row["cost"], "Conservation original whole-unit cost", nullable=True)
    if row["currency"] is not None:
        _text(row["currency"], "Conservation original cost currency")
    if row["cost"] is not None and row["currency"] is None:
        raise SourceImportError("Conservation supplied whole-unit cost requires its original currency")
    if not isinstance(row.get("original_attributes"), dict):
        raise SourceImportError("Conservation candidate requires original_attributes")
    if not isinstance(row.get("eligible"), bool):
        raise SourceImportError("Conservation candidate requires original eligible flag")
    pollutants = row.get("pollutants")
    if not isinstance(pollutants, dict):
        raise SourceImportError("Conservation candidate requires its original pollutant records")
    for name in ("nitrogen_export", "phosphorus_export", "sediment_export"):
        value = pollutants.get(name)
        if not isinstance(value, dict):
            raise SourceImportError("Conservation candidate is missing pollutant " + name)
        _text(value.get("unit"), "Conservation original pollutant unit")
        availability = value.get("availability")
        if availability not in ("modeled", "not_selected", "unbound"):
            raise SourceImportError("Conservation pollutant requires original availability")
        if availability == "not_selected":
            for field in ("baseline", "coverage_fraction", "valid_area_ha",
                          "structural_stream_area_ha", "missing_area_ha"):
                if value.get(field) is not None:
                    raise SourceImportError("An omitted original model output must retain null " + field)
            _text(value.get("availability_reason"), "Conservation omitted-output reason")
        if "baseline" not in value or not isinstance(value.get("alternatives"), dict):
            raise SourceImportError("Conservation pollutant requires baseline and alternatives")


def _selected_keys(selected_ids: Sequence[str] | None) -> set[str] | None:
    if selected_ids is None:
        return None
    if isinstance(selected_ids, (str, bytes)) or not isinstance(selected_ids, Sequence):
        raise SourceImportError("selected_ids must be an array of original row ID strings")
    result = set()
    for value in selected_ids:
        _text(value, "selected_ids entry")
        if value in result:
            raise SourceImportError("selected_ids contains duplicate " + repr(value))
        result.add(value)
    return result


def _methods(method_mapping: Mapping[str, str] | None) -> dict[str, str]:
    if method_mapping is None:
        return {}
    if not isinstance(method_mapping, Mapping):
        raise SourceImportError("method_mapping must map source method keys to catalog IDs")
    result = {}
    for key, value in method_mapping.items():
        _text(key, "method_mapping source key")
        _text(value, "method_mapping catalog ID")
        if not IDENTIFIER.fullmatch(value):
            raise SourceImportError("method_mapping catalog ID must be a portable identifier")
        result[key] = value
    return result


def import_selection(
    document: Mapping[str, Any],
    source_id: str,
    kind: str,
    *,
    source_ref: str | None = None,
    selected_ids: Sequence[str] | None = None,
    field_mapping: Mapping[str, Any] | None = None,
    method_mapping: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Return candidates, source_links and explicit proposed task inputs.

    Native community plans use interventions whose status is selected,
    in_progress or complete. Explicit selected_ids overrides that status filter.
    Native conservation portfolios import their selected_candidates and retain
    original whole-unit areas separately from reporting-footprint quantities.
    Other kinds require JSON pointer mappings and an explicit selector,
    all_rows=True, or selected_ids. Pointer rows is document-relative; id,
    label and other row fields are relative to each row.

    The input is never mutated. Only the top-level presentation key _downloads
    is removed before preserving and hashing the source. Candidate identity
    includes the frozen source and interpretation, so changed source content
    or mappings cannot silently replace evidence on an existing candidate.
    """
    _text(source_id, "source_id")
    _text(kind, "kind")
    if kind not in KINDS:
        raise SourceImportError("Unsupported source kind: " + kind)
    if kind == "community_plans":
        kind = "community_plan"
    if source_ref is not None:
        _text(source_ref, "source_ref")
    if not isinstance(document, Mapping):
        raise SourceImportError("document must be the original source JSON object")
    source = _json_copy({key: value for key, value in document.items()
                         if key != "_downloads"})
    if not source:
        raise SourceImportError("document must contain original source data")
    encoded = _encoded(source)
    if len(encoded) > MAX_JSON_BYTES:
        raise SourceImportError("Original source exceeds the implementation JSON size limit")
    mapping = _mapping(kind, field_mapping)
    requested = _selected_keys(selected_ids)
    methods = _methods(method_mapping)
    if (kind != "community_plan" and requested is None
            and "selected" not in mapping and not mapping.get("all_rows")):
        raise SourceImportError(
            "Supply selected_ids, a selected field mapping, or all_rows=True")
    conservation = None
    conservation_prefix = ""
    if kind == "community_plan":
        _native_document(source)
    elif kind == "conservation_portfolio":
        conservation, conservation_prefix = _conservation_document(source)
        if conservation_prefix:
            mapping["rows"] = conservation_prefix + mapping["rows"]
            mapping["source_title"] = "/plan/title"

    rows = _get(source, mapping["rows"], "Source rows")
    if not isinstance(rows, list):
        raise SourceImportError("Mapped source rows must be an array")
    source_digest = sha256(encoded).hexdigest()
    identity = {
        "schema": SOURCE_SCHEMA, "source_id": source_id, "kind": kind,
        "source_digest": source_digest, "source_ref": source_ref,
        "field_mapping": mapping,
    }
    source_link_id = _digest(identity)
    title = (_text(_get(source, mapping["source_title"], "Source title"), "Source title")
             if "source_title" in mapping else source_id)
    source_link = {
        "id": source_link_id, "kind": kind, "label": title,
        "source_schema": SOURCE_SCHEMA,
        "source_id": source_id, "source_digest": source_digest,
        "field_mapping": deepcopy(mapping),
        "snapshot": source,
    }
    if source_ref is not None:
        source_link["reference"] = source_ref

    indexed = []
    available = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise SourceImportError("Source row " + str(index) + " must be an object")
        original_id = _get(row, mapping["id"], "Source row ID")
        key = _row_id(original_id, "Source row ID")
        if key in available:
            raise SourceImportError("Source contains duplicate or ambiguous row ID " + repr(key))
        available.add(key)
        label = _text(_get(row, mapping["label"], "Source row label"), "Source row label")
        if kind == "community_plan":
            _native_row(row, key)
        elif kind == "conservation_portfolio":
            _conservation_row(row, key)
        indexed.append((index, key, original_id, label, row))
    if requested is not None:
        unknown = requested - available
        if unknown:
            raise SourceImportError("selected_ids not found: " + ", ".join(sorted(unknown)))

    candidates, proposals, chosen = [], [], []
    selector = mapping.get("selected")
    allowed = {_encoded(value) for value in selector["values"]} if selector else set()
    for index, key, original_id, label, row in indexed:
        if requested is not None:
            take = key in requested
        elif selector:
            value = _get(row, selector["pointer"], "Selection field for " + key)
            if isinstance(value, (dict, list)):
                raise SourceImportError("Selection field must be a JSON scalar")
            take = _encoded(value) in allowed
        else:
            take = True
        if not take:
            continue
        row_pointer = mapping["rows"] + "/" + str(index)
        candidate_id = _digest({
            "schema": CANDIDATE_SCHEMA, "source_link_id": source_link_id,
            "source_row_id": key,
        })
        snapshot = {
            "schema": CANDIDATE_SCHEMA, "source_link_id": source_link_id,
            "source_id": source_id, "source_kind": kind,
            "source_digest": source_digest, "source_row_id": key,
            "original_row_id": original_id, "row_pointer": row_pointer,
            "row_snapshot": deepcopy(row),
        }
        candidate = {
            "id": candidate_id, "label": label, "source": snapshot,
            "modeled_benefits": [],
        }
        if "area_ha" in mapping:
            area = _get(row, mapping["area_ha"], "Mapped area_ha for " + key)
            if area is not None:
                if isinstance(area, bool) or not isinstance(area, (int, float)) or area < 0:
                    raise SourceImportError("Mapped area_ha must be a nonnegative JSON number or null")
                candidate["area_ha"] = area
        if "modeled_benefits" in mapping:
            benefits = _get(row, mapping["modeled_benefits"], "Mapped modeled_benefits for " + key)
            if not isinstance(benefits, list):
                raise SourceImportError("Mapped modeled_benefits must be an array")
            candidate["modeled_benefits"] = deepcopy(benefits)
        proposal = {
            "candidate_id": candidate_id, "source_row_id": key,
            "title": label, "duration_days": None,
            "method_key": None, "method_id": None,
            "assignee": "", "next_step": "",
            "evidence_refs": [source_link_id],
        }
        for field in ("assignee", "next_step", "method_key"):
            if field in mapping:
                value = _get(row, mapping[field], "Mapped " + field + " for " + key)
                if value is not None:
                    proposal[field] = _text(value, "Mapped " + field, empty=True)
        if proposal["method_key"] in methods:
            proposal["method_id"] = methods[proposal["method_key"]]
        if kind == "community_plan":
            context = source["context"]
            snapshot["model_context"] = {
                name: deepcopy(context.get(name))
                for name in ("source_collection_ids", "grid_id", "baseline_run_id",
                             "scenario_run_ids", "delivery_id", "snapshot_sha256")
            }
            proposal["source_planning_context"] = {
                name: deepcopy(row.get(name))
                for name in ("strategy", "priority", "status", "reason",
                             "utility_id", "watershed_id", "geoids")
            }
            if row.get("cost_estimate_usd") is not None:
                proposal["source_planning_estimate"] = {
                    "currency": "USD",
                    "amount_original": row["cost_estimate_usd"],
                    "basis": "Operator-entered intervention planning estimate",
                }
        if kind == "conservation_portfolio":
            candidate["area_basis"] = "whole_original_unit"
            candidate["reporting_area_ha"] = row["reporting_area_ha"]
            snapshot["conservation_context"] = {
                "portfolio_id": conservation["id"],
                "study_id": conservation["study_id"],
                "source_identity": deepcopy(row["source_identity"]),
                "area_basis": "whole_original_unit",
                "pollutant_scope": "Candidate reporting-area footprint",
                "portfolio_summary_pointer": conservation_prefix + "/summary",
            }
            if conservation_prefix:
                snapshot["conservation_context"].update({
                    "study_bindings_pointer": "/selection/study_selection/bindings",
                    "method_pointer": "/selection/method",
                    "footprint_descriptor": deepcopy(source["plan"]["files"]["footprint"]),
                })
            proposal["source_planning_context"] = {
                name: deepcopy(row.get(name))
                for name in ("unit_type", "metric_state", "eligible", "score", "rank")
            }
            if row["cost"] is not None:
                proposal["source_planning_estimate"] = {
                    "currency": row["currency"], "amount_original": row["cost"],
                    "basis": "Original supplied whole-unit cost",
                    "footprint_basis": "whole_original_unit",
                }
        candidates.append(candidate)
        proposals.append(proposal)
        chosen.append(key)

    result = {
        "schema": RESULT_SCHEMA, "source_digest": source_digest,
        "source_links": [source_link], "candidates": candidates,
        "proposed_task_inputs": proposals,
        "selection": {
            "source_kind": kind, "source_id": source_id,
            "row_count": len(rows), "selected_count": len(candidates),
            "selected_ids": chosen,
            "selection_basis": ("explicit_ids" if requested is not None else
                                "field_selector" if selector else "all_rows"),
        },
    }
    if len(_encoded(result)) > MAX_JSON_BYTES:
        raise SourceImportError(
            "Imported source and frozen rows exceed the implementation JSON size limit; "
            "use a smaller source-native selection export")
    return result
