"""Buyer credit allocations and period projections over original native refund packets."""
from collections import defaultdict
from domain import Problem, amount, day, digest, text, group_amounts

DATA_CONTEXTS = {"operational", "development"}


def data_context(value):
    if not isinstance(value, str) or value not in DATA_CONTEXTS:
        raise Problem("DATA_CONTEXT", "Choose Operational records or Development operation")
    return value


def allocation_key(line):
    return (line["center_id"], line.get("project", ""), line.get("account_code", ""))


def purchase_matches(item, native):
    if not item:
        return False
    detail = item["row"].get("native_detail") or {}
    return (not item["missing"] and item["row"]["state"] == "settled" and
            item["row"]["network"] == native["network"] and item["row"]["asset"] == native["asset"] and
            item["row"]["settled_base_units"] == native["amount"] and
            detail.get("transfer_identity") == native["transfer_identity"] and
            detail.get("payer") == native["payer"] and detail.get("recipient") == native["recipient"])


def coding_basis(credit, purchase):
    coding = purchase.get("coding") if purchase else None
    return digest({"credit": credit["native_basis"], "purchase_item": credit["item_id"],
                   "purchase_basis": purchase["basis"] if purchase else None,
                   "purchase_coding": {k: coding[k] for k in ("basis", "recognition_date", "allocations")} if coding else None})


def validate_credit_coding(credit, payload, purchase, centers, other_credits):
    if not purchase_matches(purchase, credit["purchase"]):
        raise Problem("CREDIT_PURCHASE_CHANGED", "This refund no longer binds to the retained original buyer payment", 409)
    original = purchase.get("coding")
    if not original or original["basis"] != purchase["basis"]:
        raise Problem("PURCHASE_CODING_REQUIRED", "Review and allocate the original purchase before allocating its return", 409)
    if payload.get("basis") != credit["basis"]:
        raise Problem("CREDIT_CHANGED", "Review the current refund source and original purchase allocation", 409)
    recognition = day(payload.get("recognition_date"))
    if recognition < original["recognition_date"]:
        raise Problem("CREDIT_BEFORE_PURCHASE", "A return allocation cannot precede the recognition date of its original purchase")
    lines = payload.get("allocations")
    if not isinstance(lines, list) or not 1 <= len(lines) <= 100:
        raise Problem("CREDIT_ALLOCATIONS", "Add one to 100 exact return allocation lines")
    available = defaultdict(int)
    for line in original["allocations"]:
        available[allocation_key(line)] += amount(line["amount"])
    used = defaultdict(int)
    total_used = 0
    for other in other_credits:
        if other["id"] == credit["id"] or not other.get("coding"):
            continue
        same_return = other["native"]["transfer_identity"] == credit["native"]["transfer_identity"]
        if same_return:
            raise Problem("RETURN_ALREADY_ALLOCATED", "The same original return event is already allocated by another retained refund", 409)
        if other["item_id"] == credit["item_id"]:
            for line in other["coding"]["allocations"]:
                used[allocation_key(line)] += amount(line["amount"])
                total_used += amount(line["amount"])
    normalized, selected = [], defaultdict(int)
    total = 0
    for line in lines:
        if not isinstance(line, dict):
            raise Problem("CREDIT_ALLOCATIONS", "Each return allocation must be an object")
        center = centers.get(line.get("center_id"))
        if center is None or not center["active"]:
            raise Problem("COST_CENTER_REQUIRED", "Choose an active original cost center")
        record = {"center_id": center["id"], "amount": str(amount(line.get("amount"))),
                  "project": text(line.get("project", ""), "Project", maximum=160, optional=True),
                  "account_code": text(line.get("account_code", ""), "Account code", maximum=120, optional=True),
                  "memo": text(line.get("memo", ""), "Return line memo", maximum=1000, optional=True)}
        key = allocation_key(record)
        if key not in available:
            raise Problem("ORIGINAL_ALLOCATION_REQUIRED", "Use a cost center, project and account combination from the original purchase allocation")
        selected[key] += amount(record["amount"])
        total += amount(record["amount"])
        normalized.append(record)
    expected = amount(credit["native"]["amount"])
    if total != expected:
        raise Problem("CREDIT_ALLOCATION_TOTAL", "Return lines must equal the original verified reverse transfer of " + str(expected) + " base units")
    if total_used + total > amount(credit["purchase"]["amount"]):
        raise Problem("RETURNS_EXCEED_PURCHASE", "These recognized returns exceed the original purchase amount", 409)
    if any(used[key] + value > available[key] for key, value in selected.items()):
        raise Problem("RETURN_ALLOCATION_CAPACITY", "Cumulative returns exceed an original cost-center/project/account allocation; review the other contributing refunds", 409)
    return {"credit_id": credit["id"], "item_id": credit["item_id"], "basis": credit["basis"],
            "recognition_date": recognition, "allocations": normalized,
            "operator": text(payload.get("operator"), "Return allocation owner", maximum=240),
            "memo": text(payload.get("memo", ""), "Return memo", maximum=4000, optional=True)}


def credit_period(view, credits, pending_packets, items, centers, dispositions, closed_credit_lines, data_kind):
    period = view["period"]
    start, through = period["from_day"], period["through_day"]
    by_item = {item["id"]: item for item in items}
    decisions = {(d["item_id"], d["code"]): d for d in dispositions}
    issues, lines, outcomes = [], [], []
    recognized = {}
    for original in closed_credit_lines:
        recognized.setdefault(original["credit_id"], []).append(original)
    def issue(code, credit, description, group=None, allowed=None):
        ident = credit["id"] if credit else ""
        basis = digest({"code": code, "basis": credit["basis"] if credit else None, "group": group})
        selected = decisions.get((ident, code))
        kinds = ["carry_forward", "exclude_from_period"] if allowed is None else allowed
        valid = bool(selected and selected["basis"] == basis and selected["kind"] in kinds)
        issues.append({"code": code, "item_id": ident, "credit_id": ident or None,
                       "request_id": credit["native"]["adjustment_id"] if credit else None,
                       "source_name": credit.get("source_name") if credit else None,
                       "source_capture": credit.get("capture_id") if credit else None,
                       "basis": basis, "description": description, "group": group,
                       "allowed_kinds": kinds, "resolved": valid, "disposition": selected if valid else None})
        return issues[-1]
    for packet in pending_packets:
        issue("REFUND_PACKET_REVIEW_" + packet["id"], None,
              "An original refund packet is awaiting its retained acceptance or rejection",
              {"packet_id": packet["id"], "manifest_sha256": packet["manifest_sha256"]}, [])
    all_returns = {}
    for credit in credits:
        all_returns.setdefault(credit["native"]["transfer_identity"], []).append(credit)
    for credit in credits:
        n, coding, purchase = credit["native"], credit.get("coding"), by_item.get(credit["item_id"])
        native_day = n["transfer_at"][:10]
        if native_day > through and not (coding and start <= coding["recognition_date"] <= through):
            continue
        outcomes.append({"credit_id": credit["id"], "source_name": credit["source_name"],
                         "source_capture": credit["capture_id"], "packet_id": credit["packet_id"],
                         "manifest_sha256": credit["manifest_sha256"], "data_context": credit["data_context"],
                         "item_id": credit["item_id"], "site_url": credit["purchase"]["site_url"],
                         "order_reference": n["order_reference"], "adjustment_id": n["adjustment_id"],
                         "refund_id": n["refund_id"], "merchant_status": n["original_operation_status"],
                         "store_amount": n["store_amount"], "currency": n["currency"],
                         "store_credit_applied": n["original_operation_status"] == "APPLIED",
                         "native_return": n["amount"], "network": n["network"], "asset": n["asset"],
                         "transfer_at": n["transfer_at"], "observed_at": n["observed_at"],
                         "transaction": n["transaction"], "original_transaction": n["original_transaction"],
                         "transfer_identity": n["transfer_identity"], "observation_sha256": n["observation_sha256"],
                         "coding_id": coding["id"] if coding else None})
        if purchase is None or not purchase_matches(purchase, credit["purchase"]):
            issue("CREDIT_PURCHASE_CHANGED", credit, "The captured return no longer binds to the current original payment", allowed=[])
            continue
        if not purchase.get("coding") or purchase["coding"]["basis"] != purchase["basis"]:
            issue("CREDIT_PURCHASE_UNCODED", credit, "Allocate the current original purchase before recognizing its return")
            continue
        if coding and coding["recognition_date"] < start:
            if coding["basis"] != credit["basis"]:
                issue("EARLIER_CREDIT_SOURCE_CHANGED", credit, "The source or original purchase allocation changed after earlier return coding; review that original period")
            continue
        if coding and coding["recognition_date"] > through:
            if coding["basis"] != credit["basis"]:
                issue("FUTURE_CREDIT_SOURCE_CHANGED", credit, "The source or original purchase allocation changed after future return coding")
            continue
        if not coding:
            issue("UNCODED_NATIVE_RETURN", credit, "Assign an accounting date and exact original-allocation return, or retain its period disposition")
            continue
        if coding["basis"] != credit["basis"]:
            issue("CREDIT_CODING_CHANGED", credit, "The refund or original purchase allocation changed; review this return allocation")
            continue
        prior = recognized.get(credit["id"])
        if prior:
            issue("RETURN_ALREADY_ISSUED", credit, "This return is recognized in another currently closed period; reopen that original edition before moving it",
                  {"issued_returns": prior}, ["exclude_from_period"])
            continue
        duplicates = [c for c in all_returns[n["transfer_identity"]] if c.get("coding")]
        if len(duplicates) > 1:
            issue("DUPLICATE_NATIVE_RETURN", credit, "The same reverse-transfer event is allocated more than once; correct its original coding",
                  {"credits": sorted(c["id"] for c in duplicates)}, [])
            continue
        for index, line in enumerate(coding["allocations"]):
            center = centers[line["center_id"]]
            lines.append({"credit_id": credit["id"], "item_id": credit["item_id"], "source_id": credit["source_id"],
                          "source_name": credit["source_name"], "source_capture": credit["capture_id"],
                          "packet_id": credit["packet_id"], "manifest_sha256": credit["manifest_sha256"],
                          "adjustment_id": n["adjustment_id"], "refund_id": n["refund_id"],
                          "order_reference": n["order_reference"], "network": n["network"], "asset": n["asset"],
                          "original_transaction": n["original_transaction"], "transaction": n["transaction"],
                          "transfer_identity": n["transfer_identity"], "observation_sha256": n["observation_sha256"],
                          "native_return": n["amount"], "recognition_date": coding["recognition_date"],
                          "native_transfer_at": n["transfer_at"], "amount": line["amount"],
                          "center_id": center["id"], "center_code": center["code"], "center_name": center["name"],
                          "project": line["project"], "account_code": line["account_code"],
                          "memo": line["memo"] or coding["memo"], "coding_id": coding["id"], "line": index + 1,
                          "data_context": credit["data_context"]})
    # Current coding heads cannot silently overdraw original dimensions after
    # another purchase allocation is edited or a source edition is adopted.
    aggregate = defaultdict(lambda: defaultdict(int))
    contributors = defaultdict(list)
    for credit in credits:
        if not credit.get("coding"):
            continue
        contributors[credit["item_id"]].append(credit["id"])
        for line in credit["coding"]["allocations"]:
            aggregate[credit["item_id"]][allocation_key(line)] += amount(line["amount"])
    for item_id, used in aggregate.items():
        purchase = by_item.get(item_id)
        if not purchase or not purchase.get("coding"):
            continue
        available = defaultdict(int)
        for line in purchase["coding"]["allocations"]:
            available[allocation_key(line)] += amount(line["amount"])
        if any(total > available[key] for key, total in used.items()):
            for credit in credits:
                if credit["item_id"] == item_id:
                    issue("RETURN_ALLOCATION_CAPACITY", credit,
                          "Cumulative return allocations exceed the current original purchase dimensions",
                          {"credit_ids": sorted(contributors[item_id])}, [])
    gross = view["allocations"]
    returns_as_negative = [line | {"amount": str(-amount(line["amount"]))} for line in lines]
    view["issues"] += issues
    view["unresolved"] = sum(not x["resolved"] for x in view["issues"])
    view["ready"] = view["unresolved"] == 0
    view.update(data_context=data_kind, credit_allocations=lines, credit_totals=group_amounts(lines),
                net_totals=group_amounts(gross + returns_as_negative),
                credit_by_cost_center=group_amounts(lines, ("center_code", "center_name")),
                net_by_cost_center=group_amounts(gross + returns_as_negative, ("center_code", "center_name")),
                merchant_credit_outcomes=outcomes)
    view["context_sha256"] = digest({"expense": view["context_sha256"], "data_context": data_kind,
        "credits": [{"id": c["id"], "native_basis": c["native_basis"], "basis": c["basis"],
                     "packet_id": c["packet_id"], "native": c["native"], "coding": c.get("coding")} for c in credits],
        "pending": [{"id": p["id"], "manifest": p["manifest_sha256"]} for p in pending_packets],
        "closed_returns": closed_credit_lines})
    return view
