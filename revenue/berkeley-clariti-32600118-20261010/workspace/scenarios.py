"""Configured lifecycle checks derived from the original departmental workflows."""

TO_BE = "https://berkeleyca.gov/sites/default/files/documents/Appendix%20B%20-%20Rapid%20Workflow%20To-Be%20Business%20Process%20Maps_0.pdf"
ADDENDUM_E = "https://berkeleyca.gov/sites/default/files/documents/24-11661-C%20-%20Addendum%20E%20-%20Additional%20Vendor%20Questions%20and%20Second%20Extension.pdf"
RECIPES = [
    {"id": "linked-fire-finalization", "title": "Building and linked Fire finalization", "criterion": "A Building permit reaches Finalized only after every linked Fire permit reaches Finalized. Review the actual linked case IDs and observe the corresponding lifecycle behavior.", "required": True, "source_url": TO_BE, "source_locator": "PDF page 6, Sessions 1/6/24", "check": {"kind": "linked_finalization", "parent_type": "permit", "parent_department": "Building", "child_type": "permit", "child_department": "Fire", "finalized_statuses": ["Finalized"]}},
    {"id": "open-review-assignment", "title": "Open departmental review ownership and due dates", "criterion": "Every selected open Fire, Public Works or Land Use review retains its assigned reviewer and due date. Confirm the actual department vocabulary and open states with the export owner.", "required": True, "source_url": ADDENDUM_E, "source_locator": "Question 71", "check": {"kind": "required_review_fields", "departments": ["Fire", "Public Works", "Land Use"], "open_states": ["Open", "In Review"]}},
]


def validate_check(check):
    if check is None:
        return
    if not isinstance(check, dict):
        raise ValueError("Scenario check must be an object.")
    kind = check.get("kind")
    if kind == "linked_finalization":
        for field in ("parent_type", "child_type"):
            if check.get(field) not in {"permit", "license", "inspection", "special_event"}:
                raise ValueError("Choose a supported case type for " + field + ".")
        for field in ("parent_department", "child_department"):
            if not isinstance(check.get(field), str) or not check[field].strip() or len(check[field]) > 256:
                raise ValueError("Name the exact normalized " + field + ".")
        arrays = ("finalized_statuses",)
    elif kind == "required_review_fields":
        arrays = ("departments", "open_states")
    else:
        raise ValueError("Supported scenario checks are linked_finalization and required_review_fields.")
    for field in arrays:
        values = check.get(field)
        if not isinstance(values, list) or not values or len(values) > 100 or any(not isinstance(v, str) or not v.strip() or len(v) > 256 for v in values):
            raise ValueError("Specify the explicit normalized values for " + field + ".")


def evaluate(scenarios, records):
    by_id = {row["id"]: row for row in records}
    results = []
    for scenario in scenarios:
        check = scenario.get("check")
        if not check:
            continue
        violations, count, checked = [], 0, 0

        def failure(value):
            nonlocal count
            count += 1
            if len(violations) < 1000:
                violations.append(value)

        if check["kind"] == "linked_finalization":
            finalized = set(check["finalized_statuses"])
            for parent in records:
                if parent["type"] != check["parent_type"] or parent["department"] != check["parent_department"]:
                    continue
                children = [by_id[key] for key in parent.get("relatedIds", []) if key in by_id and by_id[key]["type"] == check["child_type"] and by_id[key]["department"] == check["child_department"]]
                if children:
                    checked += 1
                if parent["status"] in finalized:
                    for child in children:
                        if child["status"] not in finalized:
                            failure({"case_id": parent["id"], "related_id": child["id"], "parent_status": parent["status"], "related_status": child["status"], "reason": "Parent is finalized while the linked child remains open."})
        else:
            departments, states = set(check["departments"]), set(check["open_states"])
            for row in records:
                for department, status in row.get("reviewStates", {}).items():
                    if department not in departments or status not in states:
                        continue
                    checked += 1
                    missing = [field for field in ("reviewAssignments", "reviewDueAt") if not row.get(field, {}).get(department)]
                    if missing:
                        failure({"case_id": row["id"], "department": department, "review_status": status, "missing_fields": missing, "reason": "An in-scope open review is missing assigned reviewer or due date."})
        results.append({"scenario_id": scenario["id"], "kind": check["kind"], "status": "failed" if count else "passed" if checked else "not_exercised", "checked": checked, "violation_count": count, "violations": violations, "violations_truncated": count > len(violations)})
    return results
