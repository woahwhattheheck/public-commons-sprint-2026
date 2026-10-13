"""Read original report/review continuation from a retained Study receipt."""
from __future__ import annotations

from copy import deepcopy

from .common import identifier
from . import customer_review_study_transfer as review_transfer


def summary(identity):
    rows = identity.get("customer_reviews", [])
    return {"customer_review_count": len(rows),
            "captured_customer_response_count": sum(len(row.get("response_ids", [])) for row in rows)}


def augment(closure, retained, result):
    """Expose captured reviews with their current appended original history."""
    captured = retained["identity"].get("customer_reviews", [])
    review_transfer.verify_receipt(closure, captured)
    available = {row["id"]: row for row in review_transfer.receipt(closure)}
    result["customer_reviews"] = []
    by_report = {row["id"]: row for row in result.get("reports", [])}
    for report in by_report.values():
        report["customer_review_ids"] = []
    for original in captured:
        key = identifier(original["id"])
        row = available[key]
        review = closure.read("reviews/" + key + ".json")
        if review.get("project", {}).get("id") != closure.workspace.project["id"]:
            raise ValueError("The retained customer review belongs to another project.")
        response_ids = row["response_ids"]
        disposition = "in-review"
        if response_ids:
            latest = closure.read("review-responses/" + identifier(response_ids[-1]) + ".json")
            if latest.get("review_id") != key:
                raise ValueError("The current customer response belongs to another review.")
            disposition = latest["response"]["disposition"]
        scientific = []
        for source in row["scientific_reports"]:
            source = deepcopy(source)
            edition_id = source.get("scientific_report_edition_id")
            if not source.get("external"):
                identifier(edition_id)
                node = closure.nodes.get(("scientific-report-editions", edition_id))
                if node is None:
                    raise ValueError("The retained review lost its original scientific edition.")
                source["title"] = node.get("title", edition_id[:12])
                if edition_id in by_report:
                    by_report[edition_id]["customer_review_ids"].append(key)
            scientific.append(source)
        result["customer_reviews"].append({
            "id": key, "project_id": row["project_id"], "title": row["title"],
            "purpose": row["purpose"], "review_sha256": row["review_sha256"],
            "state": disposition, "captured_response_count": len(original["response_ids"]),
            "response_count": len(response_ids), "response_ids": deepcopy(response_ids),
            "handback_count": len(row["handback_ids"]),
            "received_package_count": len(row["received_package_ids"]),
            "returned_response_count": len(row["returned_response_ids"]),
            "reconciliation_count": len(row["reconciliations"]),
            "scientific_reports": scientific,
        })
    for report in by_report.values():
        report["customer_review_ids"] = sorted(set(report["customer_review_ids"]))
