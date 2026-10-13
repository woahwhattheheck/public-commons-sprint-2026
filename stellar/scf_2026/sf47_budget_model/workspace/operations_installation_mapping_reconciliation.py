"""Explicit mapping reconciliation inside the original Source Desk transaction.

All original values and revisions remain retained. Arrays are whole values until
the operator explicitly selects positional comparison; no record identity or
ordering is inferred. The existing edition writer owns files and preparation.
"""
from __future__ import annotations

from copy import deepcopy
import json
from model import canonical, digest
import operations_installation_source_editions as editions

COMPARISON = "stellar-forge.installation-mapping-comparison.v1"
PLAN = "stellar-forge.installation-mapping-plan.v1"
RECEIPT = "stellar-forge.installation-mapping-reconciliation.v1"
MAX_ROWS = 20000
MAX_DEPTH = 128
MAX_SAVED = 100
MAX_HISTORY = 24 * 1024 * 1024
MAX_SAFE_INTEGER = 9007199254740991
need, exact, same, seal = editions.need, editions.exact, editions.same, editions.seal


def pointer(parent, key):
    return parent + "/" + str(key).replace("~", "~0").replace("/", "~1")


def type_name(present, value):
    if not present:
        return "absent"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    need(False, "Retain original JSON mapping values.")


def bounded(value, limit, label):
    try:
        length = len(canonical(value).encode("utf-8"))
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        from model import Problem
        raise Problem("Keep complete valid JSON and Unicode for " + label + ".", 422,
                      "INSTALLATION_MAPPING_INVALID") from error
    need(length <= limit, "The complete " + label + " exceeds its retained byte limit.",
         "INSTALLATION_MAPPING_CAPACITY", 413)


def expansions(value):
    need(isinstance(value, list) and len(value) <= MAX_ROWS,
         "Select the complete explicit array expansion list.")
    for path in value:
        need(isinstance(path, str) and (path == "" or path.startswith("/"))
             and len(path) <= 32000, "Use complete original JSON pointers for array expansion.")
        for token in path.split("/")[1:]:
            index = 0
            while index < len(token):
                if token[index] == "~":
                    need(index + 1 < len(token) and token[index + 1] in "01",
                         "Use exact RFC 6901 pointer escapes.")
                    index += 2
                else:
                    index += 1
    need(len(set(value)) == len(value), "Expand each original array pointer once.")
    return sorted(value)


def compare_values(source, target, expanded):
    """Return all differing nonoverlapping units and encountered array choices."""
    expanded = expansions(expanded)
    chosen, reached, rows, arrays = set(expanded), set(), [], []

    def visit(path, sp, s, tp, t, depth):
        need(depth <= MAX_DEPTH, "Keep mapping reconciliation within 128 nested levels.",
             "INSTALLATION_MAPPING_CAPACITY", 413)
        both_arrays = sp and tp and isinstance(s, list) and isinstance(t, list)
        if both_arrays:
            arrays.append({"pointer": path, "sourceLength": len(s),
                           "targetLength": len(t), "expanded": path in chosen})
            if path in chosen:
                reached.add(path)
        if sp and tp and same(s, t):
            return
        if sp and tp and isinstance(s, dict) and isinstance(t, dict):
            for key in sorted(set(s) | set(t)):
                visit(pointer(path, key), key in s, s.get(key), key in t, t.get(key), depth + 1)
            return
        if both_arrays and path in chosen:
            for index in range(max(len(s), len(t))):
                visit(pointer(path, index), index < len(s), s[index] if index < len(s) else None,
                      index < len(t), t[index] if index < len(t) else None, depth + 1)
            return
        need(len(rows) < MAX_ROWS, "The complete mapping comparison exceeds 20,000 differing values.",
             "INSTALLATION_MAPPING_CAPACITY", 413)
        rows.append({"pointer": path, "sourcePresent": sp, "targetPresent": tp,
                     "source": deepcopy(s) if sp else None, "target": deepcopy(t) if tp else None,
                     "sourceType": type_name(sp, s), "targetType": type_name(tp, t)})

    visit("", True, source, True, target, 0)
    need(reached == chosen,
         "Expand only an encountered array in both mappings; expand its original array ancestors first.")
    return expanded, rows, arrays


def compare(desk, case_id, draft_id, body):
    exact(body, ("source", "target", "expandedArrays"), "mapping comparison")
    with desk.workspace.mutex:
        source = editions.pinned(desk, case_id, body["source"])
        target = editions.pinned(desk, case_id, body["target"])
        need(target["id"] == draft_id, "The mapping target differs from its original draft route.")
        for selection in (source["selection"], target["selection"]):
            bounded(selection, editions.MAX_SELECTION, "original mapping")
            need(selection is None or isinstance(selection, dict),
                 "Select complete original mapping objects or null.")
        expanded, rows, arrays = compare_values(source["selection"], target["selection"],
                                                body["expandedArrays"])
        result = seal({"schema": COMPARISON, "caseId": case_id,
                       "source": editions.reference(source), "target": editions.reference(target),
                       "sourceSelection": deepcopy(source["selection"]),
                       "targetSelection": deepcopy(target["selection"]),
                       "expandedArrays": expanded, "arrays": arrays, "rows": rows})
        bounded(result, 3 * editions.MAX_SELECTION, "mapping comparison")
        return result


def custom_value(value):
    bounded(value, editions.MAX_SELECTION, "custom mapping value")
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        need(depth <= MAX_DEPTH, "Keep custom mapping values within 128 nested levels.")
        if item is None or isinstance(item, (str, bool)):
            continue
        if type(item) is int:
            need(abs(item) <= MAX_SAFE_INTEGER,
                 "Keep whole counts within the safe integer range; retain exact decimals as text.")
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)
        elif isinstance(item, dict):
            need(all(isinstance(key, str) for key in item), "Use complete JSON object field names.")
            stack.extend((child, depth + 1) for child in item.values())
        else:
            need(False, "Keep exact decimals as text and custom values as ordinary complete JSON.")
    return deepcopy(value)


def decisions_for(comparison, supplied):
    rows = {row["pointer"]: row for row in comparison["rows"]}
    need(isinstance(supplied, list) and len(supplied) == len(rows),
         "Choose once for every complete differing mapping value.")
    indexed = {}
    for item in supplied:
        exact(item, ("pointer", "choice", "value"), "mapping decision")
        path, choice = item["pointer"], item["choice"]
        need(isinstance(path, str) and path in rows and path not in indexed,
             "Choose each original differing pointer exactly once.")
        need(choice in ("source", "target", "custom", "absent"),
             "Explicitly choose source, target, custom JSON or absence.")
        if choice == "custom":
            value = custom_value(item["value"])
        else:
            need(item["value"] is None, "Keep value null for a source, target or absent choice.")
            value = None
        indexed[path] = {"pointer": path, "choice": choice, "value": value}
    return [indexed[row["pointer"]] for row in comparison["rows"]]


def resolve(comparison, decisions):
    chosen = {row["pointer"]: row for row in decisions}
    expanded = set(comparison["expandedArrays"])
    array_changes = []

    def build(path, sp, s, tp, t, depth):
        need(depth <= MAX_DEPTH, "Keep mapping reconciliation within 128 nested levels.")
        if path in chosen:
            row = chosen[path]
            if row["choice"] == "source":
                return sp, deepcopy(s) if sp else None
            if row["choice"] == "target":
                return tp, deepcopy(t) if tp else None
            if row["choice"] == "custom":
                return True, deepcopy(row["value"])
            return False, None
        if sp and tp and same(s, t):
            return True, deepcopy(t)
        if sp and tp and isinstance(s, dict) and isinstance(t, dict):
            result = {}
            for key in sorted(set(s) | set(t)):
                present, value = build(pointer(path, key), key in s, s.get(key),
                                       key in t, t.get(key), depth + 1)
                if present:
                    result[key] = value
            return True, result
        if sp and tp and isinstance(s, list) and isinstance(t, list) and path in expanded:
            result, positions = [], []
            # Resolve against immutable original indices before compacting. No
            # deletion can shift the interpretation of a subsequent decision.
            for index in range(max(len(s), len(t))):
                present, value = build(pointer(path, index), index < len(s),
                                       s[index] if index < len(s) else None, index < len(t),
                                       t[index] if index < len(t) else None, depth + 1)
                positions.append({"originalIndex": index,
                                  "resultIndex": len(result) if present else None})
                if present:
                    result.append(value)
            array_changes.append({"pointer": path, "positions": positions})
            return True, result
        need(False, "The full comparison is missing an explicit mapping decision.")

    present, result = build("", True, comparison["sourceSelection"],
                            True, comparison["targetSelection"], 0)
    need(present and (result is None or isinstance(result, dict)),
         "The complete successor mapping must be an object or explicit null, not absent.")
    bounded(result, editions.MAX_SELECTION, "resolved mapping")
    return result, sorted(array_changes, key=lambda row: row["pointer"])


def preview(desk, case_id, draft_id, body):
    exact(body, ("source", "target", "expandedArrays", "decisions", "files"),
          "complete mapping reconciliation preview")
    with desk.workspace.mutex:
        comparison = compare(desk, case_id, draft_id,
                             {key: body[key] for key in ("source", "target", "expandedArrays")})
        decisions = decisions_for(comparison, body["decisions"])
        selection, array_changes = resolve(comparison, decisions)
        edition = editions.preview(desk, case_id, draft_id, {
            "source": comparison["source"], "target": comparison["target"],
            "files": deepcopy(body["files"]),
            "mapping": {"mode": "explicit", "selection": selection}})
        result = seal({"schema": PLAN, "caseId": case_id,
                       "source": comparison["source"], "target": comparison["target"],
                       "expandedArrays": comparison["expandedArrays"],
                       "comparisonSha256": comparison["sha256"], "decisions": decisions,
                       "selection": selection, "selectionSha256": digest(selection),
                       "arrayChanges": array_changes, "editionPlan": edition})
        bounded(result, editions.MAX_PLAN, "complete mapping reconciliation plan")
        return result


def verify_plan(desk, case_id, draft_id, plan):
    value = editions.unseal(plan, PLAN)
    exact(value, ("schema", "caseId", "source", "target", "expandedArrays",
                  "comparisonSha256", "decisions", "selection", "selectionSha256",
                  "arrayChanges", "editionPlan"), "complete mapping reconciliation plan")
    need(value["caseId"] == case_id and isinstance(value["editionPlan"], dict),
         "Select this original case's complete mapping plan.")
    rebuilt = preview(desk, case_id, draft_id, {
        **{key: value[key] for key in ("source", "target", "expandedArrays", "decisions")},
        "files": value["editionPlan"].get("files")})
    need(same(rebuilt, plan), "The complete mapping reconciliation cannot be reproduced unchanged.",
         "INSTALLATION_MAPPING_CHANGED", 409)
    return value


def wire(value, *, include_value=True):
    """Keep native number lexemes and canonical key order across JSON clients."""
    result = {"schema": "stellar-forge.installation-mapping-wire.v1",
              "canonicalJSON": canonical(value), "sha256": digest(value)}
    if include_value:
        result["value"] = value
    return result


def read_selection_json(raw):
    need(isinstance(raw, str), "Keep the complete original mapping editor text.")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, "Keep each original JSON object field exactly once.")
            result[key] = value
        return result
    try:
        need(len(raw.encode("utf-8")) <= editions.MAX_SELECTION,
             "The complete mapping editor text exceeds 8 MiB.",
             "INSTALLATION_MAPPING_CAPACITY", 413)
        value = json.loads(raw, object_pairs_hook=unique)
        need(isinstance(value, dict), "Retain the complete original mapping object.")
        bounded(value, editions.MAX_SELECTION, "complete original mapping")
        return value
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        from model import Problem
        if isinstance(error, Problem):
            raise
        raise Problem("Keep complete valid original mapping JSON text.", 422,
                      "INSTALLATION_MAPPING_INVALID") from error


def read_plan_json(raw):
    need(isinstance(raw, str), "Retain the complete original canonical mapping plan text.")
    try:
        need(len(raw.encode("utf-8")) <= editions.MAX_PLAN,
             "The complete original mapping plan exceeds 12 MiB.",
             "INSTALLATION_MAPPING_CAPACITY", 413)
        value = json.loads(raw)
        need(isinstance(value, dict) and canonical(value) == raw,
             "Retain exact native canonical mapping plan text without duplicate fields or changed values.")
    except (ValueError, TypeError, UnicodeError, RecursionError) as error:
        from model import Problem
        if isinstance(error, Problem):
            raise
        raise Problem("Retain complete valid original canonical mapping plan JSON.", 422,
                      "INSTALLATION_MAPPING_INVALID") from error
    return value


def apply(desk, state, data, context):
    if isinstance(data, dict) and set(data) == {"planJSON"}:
        plan = read_plan_json(data["planJSON"])
    else:
        exact(data, ("plan",), "reviewed mapping application")
        plan = data["plan"]
    value = verify_plan(desk, state["caseId"], state["id"], plan)
    need(same(value["target"], editions.reference(state)),
         "The target draft advanced after the complete mapping review.",
         "INSTALLATION_SOURCE_REVISION_CONFLICT", 409)
    previous = state.get("mappingReconciliations", [])
    need(isinstance(previous, list) and len(previous) < MAX_SAVED,
         "Retain at most 100 complete mapping reconciliations in this source draft.",
         "INSTALLATION_MAPPING_CAPACITY", 413)
    transition = editions.apply(desk, state, {"plan": value["editionPlan"]}, context)
    receipt = seal({"schema": RECEIPT, "state": "RECONCILED_SOURCE_MAPPING",
                    "caseId": state["caseId"], "draftId": state["id"],
                    "draftRevision": state["revision"] + 1,
                    "requestId": context["requestId"], "actor": context["actor"], "at": context["at"],
                    "source": value["source"], "target": value["target"],
                    "plan": deepcopy(plan), "editionTransition": deepcopy(transition)})
    bounded([*previous, receipt], MAX_HISTORY, "complete retained mapping history")
    state.setdefault("mappingReconciliations", []).append(deepcopy(receipt))
    return receipt


def verify_receipt(desk, draft, receipt):
    value = editions.unseal(receipt, RECEIPT)
    exact(value, ("schema", "state", "caseId", "draftId", "draftRevision", "requestId",
                  "actor", "at", "source", "target", "plan", "editionTransition"),
          "accepted mapping reconciliation")
    need(value["state"] == "RECONCILED_SOURCE_MAPPING" and value["caseId"] == draft["caseId"]
         and value["draftId"] == draft["id"] and value["draftRevision"] == draft["revision"],
         "The accepted mapping reconciliation belongs to another complete draft.")
    plan = verify_plan(desk, draft["caseId"], draft["id"], value["plan"])
    need(same(plan["source"], value["source"]) and same(plan["target"], value["target"])
         and same(plan["selection"], draft["selection"]),
         "The accepted mapping differs from its original full selection.")
    previous = editions.pinned(desk, draft["caseId"], value["target"])
    expected = [*previous.get("mappingReconciliations", []), receipt]
    need(same(draft.get("mappingReconciliations"), expected)
         and draft["history"][-1]["requestId"] == value["requestId"]
         and draft["history"][-1]["action"] == "mapping.apply",
         "Keep the complete original reconciliation history and request identity.",
         "INSTALLATION_MAPPING_CHANGED", 409)
    transition = value["editionTransition"]
    need(isinstance(transition, dict)
         and transition.get("planSha256") == plan["editionPlan"]["sha256"]
         and all(transition.get(key) == value[key] for key in
                 ("caseId", "draftId", "draftRevision", "requestId", "actor", "at"))
         and same(transition.get("source"), value["source"])
         and same(transition.get("target"), value["target"]),
         "The original edition transition differs from the accepted mapping review.")
    editions.verify_receipt(desk, draft, transition, expected_action="mapping.apply")
    return receipt
