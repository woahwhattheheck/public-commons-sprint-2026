"""Reviewed, occurrence-bound changes to the thirteen NLM legacy tag names."""
from __future__ import annotations
from collections import Counter
from .errors import PrsError
from . import schema as s

PLAN_SCHEMA = "stellar-forge.prs-modernization-plan.v1"

def _string(value, name, *, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise PrsError(name + " must be a nonempty string.", "PLAN_REVIEW")
    return value

def _remove(node):
    # Keep tail text, including whitespace, where removing the element would
    # otherwise remove bytes belonging to its surrounding mixed content.
    parent, previous, tail = node.getparent(), node.getprevious(), node.tail
    if tail:
        if previous is not None:
            previous.tail = (previous.tail or "") + tail
        else:
            parent.text = (parent.text or "") + tail
    parent.remove(node)

def _insert(parent, name, value, source):
    matches = [c for c in s.children(parent) if c.tag == name]
    if len(matches) > 1:
        raise PrsError("A replacement target occurs more than once.", "PLAN_AMBIGUOUS",
                       {"path": s.path_of(parent), "field": name})
    if matches:
        node = matches[0]
        if s.children(node):
            raise PrsError("A replacement target is not a simple field.", "PLAN_AMBIGUOUS")
        before = s.text_value(node)
        try:
            node.text = value
        except (ValueError, TypeError) as exc:
            raise PrsError("Replacement contains text that cannot be represented in XML.", "PLAN_FIELD",
                           {"field": name, "message": str(exc)}) from exc
        return {"field": name, "previous": before, "value": value, "created": False}
    node = s.etree.Element(name)
    try:
        node.text = value
    except (ValueError, TypeError) as exc:
        raise PrsError("Replacement contains text that cannot be represented in XML.", "PLAN_FIELD",
                       {"field": name, "message": str(exc)}) from exc
    if parent.tag == "clinical_study":
        if name not in source.order:
            raise PrsError("Replacement field is outside the selected ClinicalStudy sequence.", "PLAN_FIELD")
        rank = source.order.index(name)
        insertion = next((i for i, c in enumerate(parent)
                          if isinstance(c.tag, str) and c.tag in source.order
                          and source.order.index(c.tag) > rank), len(parent))
        parent.insert(insertion, node)
    else:  # The selected ResponsibleParty and InterventionalDesign use xs:all.
        parent.append(node)
    return {"field": name, "previous": None, "value": value, "created": True}

def _prepare(value, decisions, reviewer, rationale, schema_dir):
    data = s.xml_bytes(value)
    reviewer = _string(reviewer, "reviewer")
    rationale = _string(rationale, "rationale", allow_empty=True)
    if not isinstance(decisions, list):
        raise PrsError("decisions must be an array.", "PLAN_DECISIONS")
    source = s.schemas(schema_dir)
    if not source.profile_matches:
        raise PrsError("The thirteen-tag migration profile is bound to its retained source edition.",
                       "PROFILE_SOURCE", {"schemaSetSha256": source.set_sha256})
    before = s.inspect(data, "protocol", schema_dir)
    if not before["wellFormed"] or before.get("rootName") != "{" + s.PRS + "}study_collection":
        raise PrsError("A modernizable input must be a parsed PRS study_collection.", "PLAN_SOURCE")
    doc = s.parse_document(data)
    available = {e["elementId"]: e for e in before["legacyElements"]}
    seen, selected, replacements = set(), [], {}
    for i, decision in enumerate(decisions):
        if not isinstance(decision, dict):
            raise PrsError("Every decision must be an object.", "PLAN_DECISIONS", {"index": i})
        ident = decision.get("elementId")
        if ident not in available or ident in seen:
            raise PrsError("A decision must select one unique occurrence from this exact source.", "PLAN_SOURCE",
                           {"elementId": ident, "index": i})
        seen.add(ident)
        action = decision.get("action")
        if action not in ("keep", "remove", "replace"):
            raise PrsError("Decision action must be keep, remove or replace.", "PLAN_DECISIONS")
        reason = _string(decision.get("reason"), "decision.reason")
        entry = available[ident]
        node = s.node_at(doc, entry["path"])
        replacement = decision.get("replacement", {})
        if action != "replace" and replacement:
            raise PrsError("Only replace decisions can carry replacement values.", "PLAN_FIELD")
        if action == "replace":
            if not isinstance(replacement, dict) or not replacement:
                raise PrsError("A replace decision requires explicit native replacement fields.", "PLAN_FIELD")
            if set(replacement) - set(entry["allowedReplacementFields"]):
                raise PrsError("Replacement contains fields outside this exact legacy occurrence's profile.",
                               "PLAN_FIELD", {"allowed": entry["allowedReplacementFields"]})
            for name, value in replacement.items():
                if not isinstance(value, str):
                    raise PrsError("PRS replacement values must be explicit native strings.", "PLAN_FIELD",
                                   {"field": name})
                key = (s.path_key(s.path_of(node.getparent())), name)
                if key in replacements and replacements[key] != value:
                    raise PrsError("Two reviewed decisions give conflicting values for the same native field.",
                                   "PLAN_CONFLICT", {"field": name, "parent": entry["path"][:-1]})
                replacements[key] = value
        selected.append((node, entry, {"elementId": ident, "action": action, "reason": reason,
                                      **({"replacement": dict(replacement)} if action == "replace" else {})}))
    # All paths resolve before any removal, so repeated legacy occurrences retain
    # their original indexes even when earlier siblings are removed.
    applied, written = [], set()
    for node, entry, decision in selected:
        changes = []
        if decision["action"] == "replace":
            parent = node.getparent()
            for name, value in decision["replacement"].items():
                key = (s.path_key(s.path_of(parent)), name)
                if key not in written:
                    changes.append(_insert(parent, name, value, source))
                    written.add(key)
        if decision["action"] != "keep":
            _remove(node)
        applied.append({**decision, "ruleId": entry["ruleId"], "studyIndex": entry["studyIndex"],
                        "originalPath": entry["path"], "originalValue": entry["value"],
                        "nativeChanges": changes})
    changed = any(d["action"] != "keep" for _, _, d in selected)
    candidate = s.etree.tostring(doc, encoding="UTF-8", xml_declaration=True, pretty_print=False) if changed else data
    comparison = s.compare(data, candidate, "protocol", schema_dir)
    mask_issues = []
    for study in s.study_nodes(doc):
        for parent in s.select_xml(study, ("study_design", "interventional_design")):
            vals = {n: s._first(parent, (n,)) for n in (
                "no_masking", "masked_subject", "masked_caregiver", "masked_investigator", "masked_assessor")}
            truth = lambda x: str(x).lower() in ("yes", "true", "1")
            if truth(vals["no_masking"]) and any(truth(v) for k, v in vals.items() if k != "no_masking"):
                mask_issues.append({"code": "MASKING_ROLE_CONFLICT", "path": s.path_of(parent), "values": vals,
                                    "detail": "The original XSD comment requires all masked roles to be no when no_masking is yes."})
    plan = {
        "schema": PLAN_SCHEMA, "reviewer": reviewer, "rationale": rationale,
        "inputSha256": before["inputSha256"], "inputBytes": len(data),
        "schemaSetSha256": source.set_sha256, "schemaSources": source.sources,
        "notice": s.NOTICE, "decisions": [d for _, _, d in selected],
        "applied": applied, "candidateSha256": s.sha256(candidate), "candidateBytes": len(candidate),
        "candidateSchemaValid": comparison["after"]["schemaValid"],
        "originalLegacyCount": len(before["legacyElements"]),
        "remainingLegacyCount": len(comparison["after"]["legacyElements"]),
        "unreviewedElementIds": [e["elementId"] for e in before["legacyElements"] if e["elementId"] not in seen],
        "semanticIssues": mask_issues,
        "comparison": comparison,
        "serialization": "Original bytes if no change; otherwise retained UTF-8 XML serialization with declaration. Source and candidate remain separate artifacts.",
    }
    plan["planSha256"] = s.digest(plan)
    return candidate, plan

def prepare(xml_bytes, decisions, reviewer, rationale="", schema_dir=None):
    return _prepare(xml_bytes, decisions, reviewer, rationale, schema_dir)[1]

def apply(xml_bytes, plan, schema_dir=None):
    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:
        raise PrsError("An original PRS modernization plan is required.", "PLAN_TYPE")
    body = {k: v for k, v in plan.items() if k != "planSha256"}
    if s.digest(body) != plan.get("planSha256"):
        raise PrsError("The retained plan has changed.", "PLAN_HASH")
    if s.sha256(s.xml_bytes(xml_bytes)) != plan.get("inputSha256"):
        raise PrsError("This plan belongs to different original XML bytes.", "PLAN_SOURCE")
    if s.schemas(schema_dir).set_sha256 != plan.get("schemaSetSha256"):
        raise PrsError("This plan belongs to another schema edition.", "PLAN_SCHEMA")
    candidate, rebuilt = _prepare(xml_bytes, plan["decisions"], plan["reviewer"], plan.get("rationale", ""), schema_dir)
    if rebuilt["planSha256"] != plan["planSha256"] or s.sha256(candidate) != plan["candidateSha256"]:
        raise PrsError("Reapplying the original reviewed decisions did not reproduce its candidate.", "PLAN_REPRODUCTION")
    return candidate, {
        "schema": "stellar-forge.prs-modernization-application.v1",
        "planSha256": plan["planSha256"], "reviewer": plan["reviewer"],
        "inputSha256": plan["inputSha256"], "candidateSha256": s.sha256(candidate),
        "candidateBytes": len(candidate), "schemaSetSha256": plan["schemaSetSha256"],
        "schemaValid": rebuilt["candidateSchemaValid"], "semanticIssues": rebuilt["semanticIssues"],
        "remainingLegacyCount": rebuilt["remainingLegacyCount"], "comparison": rebuilt["comparison"],
    }
