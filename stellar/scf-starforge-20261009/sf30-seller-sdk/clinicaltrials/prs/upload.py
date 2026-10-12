"""Local, source-attributed full/partial/list replacement preview.

This models the explicitly described XML units. Source ambiguities are returned
as unresolved operations unless the caller provides a named, reviewed rule. It
does not contact PRS or reproduce unobserved server business rules.
"""
from __future__ import annotations
from copy import deepcopy
from collections import defaultdict, Counter
from .errors import PrsError
from . import schema as s

def _serial(doc):
    return s.etree.tostring(doc, encoding="UTF-8", xml_declaration=True, pretty_print=False)

def _replace(parent, tag, incoming, order):
    existing = [c for c in s.children(parent) if c.tag == tag]
    for node in existing:
        parent.remove(node)
    rank = order.index(tag) if tag in order else len(order)
    for node in incoming:
        copy = deepcopy(node)
        copy.attrib.pop("delete", None)
        insertion = next((i for i, c in enumerate(parent) if isinstance(c.tag, str)
                          and c.tag in order and order.index(c.tag) > rank), len(parent))
        parent.insert(insertion, copy)

def _result(base, incoming, operations, at):
    mode = s.boolean_attribute(incoming, "partialUpload")["value"]
    if mode is None:
        raise PrsError("Invalid results partialUpload attribute.", "UPLOAD_MODE")
    if not mode or base is None:
        operations.append({"path": at, "effect": "replace_results_content"})
        out = deepcopy(incoming)
    else:
        out = deepcopy(base)
        for unit in s.children(incoming):
            if unit.tag not in s.RESULT_PARTIAL_UNITS:
                raise PrsError("Results unit is outside the source-defined subset list.", "UPLOAD_UNIT",
                               {"name": unit.tag})
            _replace(out, unit.tag, [unit], s.RESULT_PARTIAL_UNITS)
            operations.append({"path": at, "unit": unit.tag, "effect": "replace_results_subset"})
    out.attrib.pop("partialUpload", None)
    return out

def preview_upload(base_bytes, incoming_bytes, schema="protocol", rules=None, reviewer="", schema_dir=None):
    """Return (candidate bytes, report); unresolved units are preserved from base.

    rules maps an exact undocumented top-level tag to 'replace_unit'. Such a
    supplied interpretation is prominently attributed to reviewer; it does not
    become an NLM source rule. complete=False requires review of unresolved rows.
    """
    if schema not in ("protocol", "results"):
        raise PrsError("schema must be protocol or results.", "SCHEMA_KIND")
    rules = rules or {}
    if not isinstance(rules, dict) or any(v != "replace_unit" for v in rules.values()):
        raise PrsError("rules must map native element names to replace_unit.", "UPLOAD_RULE")
    if rules and (not isinstance(reviewer, str) or not reviewer.strip()):
        raise PrsError("A supplied interpretation needs its actual reviewer.", "UPLOAD_RULE")
    source = s.schemas(schema_dir)
    if not source.profile_matches:
        raise PrsError("Upload semantics profile belongs to the bundled source edition.", "PROFILE_SOURCE")
    base, incoming = s.parse_document(base_bytes), s.parse_document(incoming_bytes)
    operations, unresolved = [], []
    if schema == "results":
        if any(d.getroot().tag != "{" + s.RRS + "}result" for d in (base, incoming)):
            raise PrsError("Standalone results preview requires two RRS result documents.", "UPLOAD_SOURCE")
        out = s.etree.ElementTree(_result(base.getroot(), incoming.getroot(), operations, []))
    else:
        base_rows, incoming_rows = s.study_nodes(base), s.study_nodes(incoming)
        if not base_rows or not incoming_rows:
            raise PrsError("Protocol preview requires two PRS study collections.", "UPLOAD_SOURCE")
        for rows in (base_rows, incoming_rows):
            keys = Counter(s.study_key(n) for n in rows)
            if any(v != 1 for v in keys.values()) or any(not all((s.identity(n)["orgName"], s.identity(n)["orgStudyId"])) for n in rows):
                raise PrsError("Each input must have unique nonempty organization/study identities.", "UPLOAD_IDENTITY")
        out = deepcopy(base)
        target = {s.study_key(n): n for n in s.study_nodes(out)}
        full_order = [*source.order, "{" + s.RRS + "}result", "{" + s.RRS + "}resultDisposition"]
        for incoming_study in incoming_rows:
            key = s.study_key(incoming_study)
            current = target.get(key)
            partial = s.boolean_attribute(incoming_study, "partial_upload")["value"]
            if partial is None:
                raise PrsError("Invalid protocol partial_upload attribute.", "UPLOAD_MODE")
            if not partial:
                copy = deepcopy(incoming_study)
                copy.attrib.pop("partial_upload", None)
                if current is not None:
                    old_results = s.select_xml(current, ("{" + s.RRS + "}result",))
                    submitted_results = s.select_xml(incoming_study, ("{" + s.RRS + "}result",))
                    if submitted_results and s.boolean_attribute(submitted_results[0], "partialUpload")["value"] is True:
                        merged_result = _result(old_results[0] if old_results else None, submitted_results[0],
                                                operations, s.path_of(submitted_results[0]))
                        _replace(copy, "{" + s.RRS + "}result", [merged_result], full_order)
                    if old_results:
                        disposition = "{" + s.RRS + "}resultDisposition"
                        if s.select_xml(incoming_study, (disposition,)):
                            _replace(copy, disposition, s.select_xml(current, (disposition,)), full_order)
                            operations.append({"studyKey": key, "unit": disposition,
                                "effect": "preserve_established_results_disposition",
                                "source": "ProtocolRecordSchema.xsd: resultDisposition comment"})
                if current is None:
                    out.getroot().append(copy)
                else:
                    out.getroot().replace(current, copy)
                target[key] = copy
                operations.append({"studyKey": key, "effect": "replace_record_content", "newRecord": current is None})
                continue
            if current is None:
                unresolved.append({"studyKey": key, "code": "PARTIAL_BASE_MISSING",
                                   "detail": "This partial record has no retained previous edition."})
                continue
            grouped = defaultdict(list)
            for unit in s.children(incoming_study):
                grouped[unit.tag].append(unit)
            for tag, nodes in grouped.items():
                if tag == "id_info":
                    # Identifying information remains the base identity. The
                    # source-listed secondary_id unit lives inside actual id_info.
                    ids = s.select_xml(nodes[0], ("secondary_id",))
                    if ids:
                        old_id = s.select_xml(current, ("id_info",))[0]
                        deletes = [n for n in ids if s.boolean_attribute(n, "delete")["value"] is True]
                        if any(s.boolean_attribute(n, "delete")["value"] is None for n in ids) or (
                                deletes and (len(ids) != 1 or not s._empty(deletes[0]))):
                            unresolved.append({"studyKey": key, "unit": "id_info/secondary_id",
                                "code": "AMBIGUOUS_DELETE", "detail": "Secondary ID deletion needs one otherwise empty tag."})
                        elif deletes:
                            _replace(old_id, "secondary_id", [], ["provider_name", "provider_study_id", "org_name", "org_study_id", "secondary_id"])
                            operations.append({"studyKey": key, "unit": "id_info/secondary_id", "effect": "delete_complete_list_or_value"})
                        elif all(s._empty(n) for n in ids):
                            operations.append({"studyKey": key, "unit": "id_info/secondary_id", "effect": "retain_previous"})
                        else:
                            _replace(old_id, "secondary_id", ids, ["provider_name", "provider_study_id", "org_name", "org_study_id", "secondary_id"])
                            operations.append({"studyKey": key, "unit": "id_info/secondary_id", "effect": "replace_complete_list_or_value", "incomingOccurrences": len(ids)})
                    extra = [c.tag for c in s.children(nodes[0]) if c.tag not in (
                        "org_name", "org_study_id", "secondary_id", "provider_name", "provider_study_id")]
                    if extra:
                        unresolved.append({"studyKey": key, "unit": tag, "code": "IDENTITY_EXTRA_FIELDS", "fields": extra})
                    if any(c.tag in ("provider_name", "provider_study_id") for c in s.children(nodes[0])):
                        operations.append({"studyKey": key, "unit": "id_info", "effect": "preserve_retained_internal_provider_identity"})
                    continue
                if tag == "{" + s.RRS + "}result":
                    existing = [n for n in s.children(current) if n.tag == tag]
                    result = _result(existing[0] if existing else None, nodes[0], operations, s.path_of(nodes[0]))
                    _replace(current, tag, [result], full_order)
                    continue
                if tag == "{" + s.RRS + "}resultDisposition" and any(c.tag == "{" + s.RRS + "}result" for c in s.children(current)):
                    operations.append({"studyKey": key, "unit": tag, "effect": "preserve_established_results_disposition",
                                       "source": "ProtocolRecordSchema.xsd: resultDisposition comment"})
                    continue
                documented = tag in s.PROTOCOL_PARTIAL_UNITS
                if not documented and rules.get(tag) != "replace_unit":
                    unresolved.append({"studyKey": key, "unit": tag, "code": "UNDOCUMENTED_PARTIAL_UNIT",
                                       "paths": [s.path_of(n) for n in nodes],
                                       "detail": "The selected original partial-upload list does not name this actual top-level unit."})
                    continue
                deletes = [n for n in nodes if s.boolean_attribute(n, "delete")["value"] is True]
                bad_delete = [n for n in deletes if not s._empty(n)]
                bad_bool = [n for n in nodes if s.boolean_attribute(n, "delete")["value"] is None]
                if bad_delete or bad_bool or (deletes and len(nodes) != 1):
                    unresolved.append({"studyKey": key, "unit": tag, "code": "AMBIGUOUS_DELETE",
                                       "detail": "Deletion requires one otherwise empty tag with delete=true, without competing replacement values."})
                    continue
                if deletes:
                    _replace(current, tag, [], full_order)
                    effect = "delete_complete_list_or_value"
                elif all(s._empty(n) for n in nodes):
                    effect = "retain_previous"
                else:
                    _replace(current, tag, nodes, full_order)
                    effect = "replace_complete_list_or_value"
                operations.append({"studyKey": key, "unit": tag, "effect": effect, "incomingOccurrences": len(nodes),
                                   "basis": "original_schema_comment" if documented else "reviewed_interpretation",
                                   **({"reviewer": reviewer} if not documented else {})})
            current.attrib.pop("partial_upload", None)
    candidate = _serial(out)
    comparison = s.compare(base_bytes, candidate, schema, schema_dir)
    return candidate, {
        "schema": "stellar-forge.prs-upload-preview.v1", "baseSha256": s.sha256(s.xml_bytes(base_bytes)),
        "incomingSha256": s.sha256(s.xml_bytes(incoming_bytes)), "candidateSha256": s.sha256(candidate),
        "schemaKind": schema, "schemaSetSha256": source.set_sha256, "schemaSources": source.sources,
        "incomingInspection": s.inspect(incoming_bytes, schema, schema_dir), "comparison": comparison,
        "complete": not unresolved, "operations": operations, "unresolved": unresolved,
        "reviewer": reviewer, "rules": rules,
        "semantics": "Local composition of retained base and submitted units, attributed to the original XSD comments or explicit reviewer rule.",
    }
