"""Complete comparisons of original typed schedule editions and explicit identities."""
from __future__ import annotations

from collections import Counter, defaultdict

from .native import SINGULAR
from .storage import digest, require

# Cached getter state and rendering metadata are retained in each source model.
# Business comparison covers every native entity value and raw timephased value.
CONTENT_KEYS = ("uid", "guid", "parent_uid", "task_uid", "resource_uid",
                "predecessor_uid", "successor_uid", "type", "lag", "notes", "driving",
                "fields", "native_details", "native")

# These exact JsonWriter collections are represented by the complete typed
# entity comparison above. Every other original collection remains independently
# reviewable: definitions, lookups, codes, currencies, units, contours and layout.
JSON_ENTITY_KEYS = {"property_values", "tasks", "resources", "assignments", "calendars"}


def definition_content(model):
    original = model.get("native_json", {})
    require(isinstance(original, dict), "comparison_native_json",
            "Keep the original native JSON object with its captured edition.")
    return {"field_catalogue": model.get("field_catalogue", {}),
            "native_collections": {key: value for key, value in original.items()
                                   if key not in JSON_ENTITY_KEYS}}


def definition_source(model, content):
    return {"field_catalogue_sha256": digest(content["field_catalogue"]),
            "native_json_identity": model.get("native_json_identity"),
            "retained_collections_sha256": digest(content["native_collections"])}


def rows(model, family):
    return [model["project"]] if family == "project" else model[family]


def semantic_equal(left, right):
    """Keep decimal precision while treating native Number wrapper changes explicitly."""
    return left == right


def row_content(row):
    return {key: row[key] for key in CONTENT_KEYS if key in row}


def difference(left, right, path=""):
    """Typed atoms remain one reviewable value; structured schedules retain paths."""
    if semantic_equal(left, right):
        return
    if isinstance(left, dict) and isinstance(right, dict) and not ("type" in left or "type" in right):
        for key in sorted(set(left) | set(right)):
            child = path + "/" + str(key).replace("~", "~0").replace("/", "~1")
            if key not in left:
                yield {"path": child, "kind": "added", "before": None, "after": right[key]}
            elif key not in right:
                yield {"path": child, "kind": "removed", "before": left[key], "after": None}
            else:
                yield from difference(left[key], right[key], child)
        return
    if isinstance(left, list) and isinstance(right, list):
        # Retain complete raw timephased slices and calendar exceptions in source
        # order, without inventing dates or aligning unrelated list positions.
        yield {"path": path or "/", "kind": "changed", "before": left, "after": right}
        return
    yield {"path": path or "/", "kind": "changed", "before": left, "after": right}


def compare_models(left, right, identity_map=None, strict_identity=False):
    require(type(strict_identity) is bool, "comparison_identity", "Choose explicit strict-identity behavior.")
    identity_map = identity_map or {}
    require(isinstance(identity_map, dict) and set(identity_map) <= set(SINGULAR),
            "comparison_mapping", "Map exact original row keys within their native entity families.")
    changes, matches, findings = [], [], []
    counts = Counter()
    per_family = {}
    for family in SINGULAR:
        lrows, rrows = rows(left, family), rows(right, family)
        lindex, rindex = {row["key"]: row for row in lrows}, {row["key"]: row for row in rrows}
        require(len(lindex) == len(lrows) and len(rindex) == len(rrows),
                "comparison_source_keys", "The captured original entity keys must remain unique.", family)
        selected = identity_map.get(family, {})
        require(isinstance(selected, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in selected.items()),
                "comparison_mapping", "Use source-key to target-key mappings.", family)
        require(set(selected) <= set(lindex) and set(selected.values()) <= set(rindex)
                and len(set(selected.values())) == len(selected),
                "comparison_mapping", "Each supplied mapping must select one existing source and one distinct existing target.", family)
        paired = dict(selected)
        methods = {key: "explicit" for key in paired}
        used = set(paired.values())
        if family == "project" and not paired and lrows and rrows:
            paired[lrows[0]["key"]] = rrows[0]["key"]
            methods[lrows[0]["key"]] = "project_properties"
            used.add(rrows[0]["key"])
        for identity in (("guid",) if strict_identity else ("guid", "uid")):
            li, ri = defaultdict(list), defaultdict(list)
            for row in lrows:
                if row["key"] not in paired and row.get(identity) is not None:
                    li[str(row[identity])].append(row["key"])
            for row in rrows:
                if row["key"] not in used and row.get(identity) is not None:
                    ri[str(row[identity])].append(row["key"])
            for value in sorted(set(li) & set(ri)):
                if len(li[value]) == 1 and len(ri[value]) == 1:
                    lkey, rkey = li[value][0], ri[value][0]
                    # Conflicting nonempty GUIDs never silently align through a UID.
                    lguid, rguid = lindex[lkey].get("guid"), rindex[rkey].get("guid")
                    if identity == "uid" and lguid and rguid and lguid != rguid:
                        item = {"code": "comparison_uid_guid_conflict", "severity": "review",
                                "family": family, "message": "This repeated UID has different original GUIDs.",
                                "details": {"uid": value, "left_key": lkey, "right_key": rkey,
                                            "left_guid": lguid, "right_guid": rguid}}
                        findings.append({"id": digest(item), **item})
                        continue
                    paired[lkey], methods[lkey] = rkey, identity
                    used.add(rkey)
                else:
                    item = {"code": "comparison_ambiguous_identity", "severity": "review",
                            "family": family, "message": "Choose an explicit mapping for repeated original identities.",
                            "details": {"identity": identity, "value": value, "left": li[value], "right": ri[value]}}
                    findings.append({"id": digest(item), **item})
        family_count = Counter()
        for lkey, rkey in paired.items():
            matches.append({"family": family, "left_key": lkey, "right_key": rkey, "method": methods[lkey]})
            delta = list(difference(row_content(lindex[lkey]), row_content(rindex[rkey])))
            for change in delta:
                changes.append({"family": family, "left_key": lkey, "right_key": rkey, **change})
            family_count["matched"] += 1
            family_count["changed_rows" if delta else "unchanged_rows"] += 1
            family_count["changed_fields"] += len(delta)
        for key, row in lindex.items():
            if key not in paired:
                changes.append({"family": family, "left_key": key, "right_key": None,
                                "path": "/", "kind": "removed", "before": row_content(row), "after": None})
                family_count["removed"] += 1
        for key, row in rindex.items():
            if key not in used:
                changes.append({"family": family, "left_key": None, "right_key": key,
                                "path": "/", "kind": "added", "before": None, "after": row_content(row)})
                family_count["added"] += 1
        per_family[family] = {name: family_count[name] for name in
                              ("matched", "added", "removed", "changed_rows", "unchanged_rows", "changed_fields")}
        counts.update(family_count)
    left_definitions, right_definitions = definition_content(left), definition_content(right)
    definition_changes = []
    for scope, prefix in (("field_catalogue", "/field_catalogue"),
                          ("native_collections", "/native_json")):
        definition_changes.extend({"scope": scope, **change} for change in difference(
            left_definitions[scope], right_definitions[scope], prefix))
    definition_sources = {"left": definition_source(left, left_definitions),
                          "right": definition_source(right, right_definitions)}
    # Companion editions are portable business artifacts too. The native project
    # file cannot contain arbitrary PWA exports, lookup tables or attachment bytes.
    companion_changes = list(difference(left.get("companions", []), right.get("companions", []), "/companions"))
    return {"schema": "project-portfolio-comparison.v1", "identity_map": identity_map,
            "strict_identity": strict_identity, "matches": matches, "changes": changes,
            "companion_changes": companion_changes, "definition_changes": definition_changes,
            "definition_sources": definition_sources, "findings": findings,
            "summary": {**{name: counts[name] for name in
                           ("matched", "added", "removed", "changed_rows", "unchanged_rows", "changed_fields")},
                        "families": per_family, "companion_changes": len(companion_changes),
                        "definition_changes": len(definition_changes),
                        "findings": len(findings)}}


def target_findings(model, target_profile):
    """Surface documented source features against the selected target route."""
    profile = {"id": target_profile} if isinstance(target_profile, str) else target_profile
    require(isinstance(profile, dict), "target_profile", "Retain the selected target profile and native route.")
    name = str(profile.get("id", profile.get("name", profile.get("route", "mspdi")))).lower()
    result = []
    def finding(code, path, message, details=None):
        value = {"code": code, "path": path, "message": message, "details": details,
                 "severity": "review", "requires_decision": True}
        result.append({"id": digest(value), **value})
    if model.get("companions"):
        finding("portable_companion_delivery", "companions",
                "Keep the complete enterprise companion files with the receiving workspace; the project file does not embed these originals.",
                {"source_ids": [row["source_id"] for row in model["companions"]]})
    planner_file = "planner" in name and any(v in name for v in ("file", "import", "mpp"))
    if planner_file:
        source = "https://support.microsoft.com/en-us/office/move-your-project-from-project-desktop-to-project-for-the-web-143ab391-002e-451a-aedb-3b6fa1f6ab8b"
        for family, code, message in (
            ("resources", "planner_file_resources", "Review the actual target resource and assignment reconstruction after the file import."),
            ("assignments", "planner_file_assignments", "Retain and reconcile the original assignments against the actual target project.")):
            if model[family]:
                finding(code, family, message, {"count": len(model[family]), "source": source})
        rules = {
            "BASELINE": ("planner_file_baselines", "Retain and reconcile every selected original baseline."),
            "DEADLINE": ("planner_file_deadlines", "The file-import route does not carry the original task deadlines."),
            "MANUAL": ("planner_file_manual", "Review manually scheduled values in the selected target route."),
            "ACTIVE": ("planner_file_inactive", "Review inactive tasks against the target import result."),
            "RECURRING": ("planner_file_recurring", "Review recurring task semantics in the selected target route."),
            "SUBPROJECT": ("planner_file_subprojects", "Review linked subprojects and cross-project dependencies."),
            "FORMULA": ("planner_file_formulas", "Retain custom-field formulas and explicitly choose their target behavior."),
        }
        for family in ("project", "tasks", "resources", "assignments"):
            found = defaultdict(list)
            for row in rows(model, family):
                for field, value in row.get("fields", {}).items():
                    for fragment, (code, message) in rules.items():
                        if fragment in field:
                            raw = value.get("value") if isinstance(value, dict) else value
                            if fragment == "ACTIVE" and raw is not False:
                                continue
                            if fragment in {"MANUAL", "RECURRING"} and raw in (False, "0", "0.0", None):
                                continue
                            found[(code, message)].append({"key": row["key"], "field": field, "value": value})
            for (code, message), values in found.items():
                finding(code, family, message, {"values": values, "source": source})
        custom_fields = model.get("native_json", {}).get("custom_fields", [])
        if custom_fields:
            finding("planner_file_custom_fields", "native_json/custom_fields",
                    "Review the actual imported custom fields against the target limit and supported field types.",
                    {"source_fields": custom_fields, "maximum_file_import_custom_fields": 10, "source": source})
    return result
