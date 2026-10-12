"""MIT. Complete original-publisher IATI authoring for the installed receiving workflow."""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import zipfile

MAX_INPUT = 256 * 1024 * 1024
SCHEMA = "stellar-forge.iati-publisher-receiving.v1"


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                       allow_nan=False) + "\n").encode()


def exact_file(path, maximum=4 * 1024 * 1024 * 1024):
    path = Path(path).expanduser().absolute()
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError("Select the complete original regular file within its capacity")
        h, size = hashlib.sha256(), 0
        with os.fdopen(fd, "rb", closefd=False) as stream:
            while block := stream.read(1048576):
                size += len(block)
                if size > maximum:
                    raise ValueError("Original file exceeded its capacity while reading")
                h.update(block)
        after = os.fstat(fd)
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, key) != getattr(after, key) for key in fields) or size != after.st_size:
            raise ValueError("Original file changed during receiving")
        return {"path": str(path), "bytes": size, "sha256": h.hexdigest()}
    finally:
        os.close(fd)


def sync_directory(path):
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def save_bytes(path, body):
    """Publish only a fully synced body; preserve the completed original on replay."""
    path = Path(path)
    if path.exists() or path.is_symlink():
        actual = exact_file(path)
        if actual["bytes"] != len(body) or actual["sha256"] != hashlib.sha256(body).hexdigest():
            raise ValueError("A retained receiving output already has another identity: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(name, path)
        except FileExistsError:
            actual = exact_file(path)
            if actual["bytes"] != len(body) or actual["sha256"] != hashlib.sha256(body).hexdigest():
                raise ValueError("A retained receiving output already has another identity: " + str(path))
        sync_directory(path.parent)
    finally:
        os.unlink(name)
        sync_directory(path.parent)


def save(path, value):
    save_bytes(path, encoded(value))


def json_input(path):
    item = exact_file(path, 8 * 1024 * 1024)
    return json.loads(Path(item["path"]).read_text(encoding="utf-8"))


def regular_directory(path):
    path = Path(path).expanduser().absolute()
    if path.is_symlink():
        raise ValueError("Receiving directories must be real directories")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if (not stat.S_ISDIR(info.st_mode) or
        (os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077))):
        raise ValueError("Use a private operator-owned receiving directory")
    return path


def publisher(value):
    if not isinstance(value, dict):
        raise ValueError("Supply the actual acquired publisher file and its source identity")
    required = {"path", "bytes", "sha256", "url", "fetchedAt", "label"}
    if set(value) != required:
        raise ValueError("Publisher requires path, bytes, sha256, url, fetchedAt and label")
    if (type(value["bytes"]) is not int or not 0 < value["bytes"] <= MAX_INPUT
        or not isinstance(value["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", value["sha256"])
        or not isinstance(value["url"], str) or not value["url"].startswith("https://")
        or not isinstance(value["label"], str) or not 1 <= len(value["label"]) <= 160):
        raise ValueError("Invalid original publisher byte identity or label")
    observed = datetime.fromisoformat(value["fetchedAt"].replace("Z", "+00:00"))
    if observed.tzinfo is None:
        raise ValueError("Publisher acquisition time requires a timezone")
    actual = exact_file(value["path"], MAX_INPUT)
    if any(actual[key] != value[key] for key in ("bytes", "sha256")):
        raise ValueError("Acquired publisher bytes differ from their original manifest")
    return {**value, "path": actual["path"]}


def native_dataset_identity(target, build):
    regular_directory(target)
    members = {"data.csv", "dataset.json", "iati-lineage.json"}
    if {path.name for path in target.iterdir()} != members:
        raise ValueError("Native dataset delivery has an incomplete file set")
    identities = {name: exact_file(target / name) for name in sorted(members)}
    for name in ("data.csv", "dataset.json"):
        if any(identities[name][key] != build["files"][name][key] for key in ("bytes", "sha256")):
            raise ValueError("Native merchant dataset differs from the reviewed original edition")
    if json_input(target / "iati-lineage.json") != build:
        raise ValueError("Native merchant lineage differs from the complete source review")
    return identities


def interrupted_dataset_matches(target, complete):
    """Recognize only exact prefixes of this operation's fully verified export."""
    regular_directory(target)
    members = {"data.csv", "dataset.json", "iati-lineage.json"}
    if not {path.name for path in target.iterdir()} <= members:
        raise ValueError("The existing dataset destination contains unrelated files")
    for path in target.iterdir():
        retained = exact_file(path)
        reference = exact_file(complete / path.name)
        if retained["bytes"] > reference["bytes"]:
            raise ValueError("The existing dataset destination contains another original body")
        with path.open("rb") as partial, (complete / path.name).open("rb") as original:
            while block := partial.read(1048576):
                if block != original.read(len(block)):
                    raise ValueError("The existing dataset destination contains another original body")


def publish_native_dataset(workspace, build, target):
    """Keep incomplete exports private and publish the complete native directory."""
    if target.exists() or target.is_symlink():
        regular_directory(target)
        try:
            return native_dataset_identity(target, build)
        except (ValueError, FileNotFoundError):
            # A killed older exporter may have exposed only an original prefix.
            # Confirm it against a complete staged native export before moving it.
            pass
    attempt = Path(tempfile.mkdtemp(prefix="." + target.name + "-attempt-", dir=target.parent))
    save(attempt / "original-export.json", {"build": build["id"], "destination": str(target)})
    staged = attempt / "complete"
    workspace.export_dataset(build["id"], staged)
    native_dataset_identity(staged, build)
    sync_directory(staged)
    if target.exists() or target.is_symlink():
        interrupted_dataset_matches(target, staged)
        os.rename(target, attempt / "interrupted-original")
        sync_directory(attempt)
        sync_directory(target.parent)
    os.rename(staged, target)
    sync_directory(attempt)
    sync_directory(target.parent)
    return native_dataset_identity(target, build)


def all_native_rows(workspace, build, fields):
    """Read the complete native cursor, retaining the declared selected fields."""
    params = {"limit": str(min(100, build["native"]["maxLimit"])), "fields": ",".join(fields)}
    rows, pages, seen_cursors = [], 0, set()
    while True:
        native = workspace.query(build["id"], params)
        response = native["response"]
        if response["status"] != 200:
            raise ValueError("Original native query rejected: " + json.dumps(response))
        body = response["body"]
        if body["dataset"]["snapshot"] != build["native"]["snapshot"] or body["fields"] != fields:
            raise ValueError("Native query changed its original snapshot or selected fields")
        if body["page"]["total"] != build["rowCount"]:
            raise ValueError("Complete native query has another row count")
        rows.extend(body["rows"])
        pages += 1
        cursor = body["page"]["nextCursor"]
        if cursor is None:
            break
        if cursor in seen_cursors:
            raise ValueError("Native query repeated a cursor")
        seen_cursors.add(cursor)
        params["cursor"] = cursor
    if len(rows) != build["rowCount"] or len({row["row_id"] for row in rows}) != len(rows):
        raise ValueError("Native cursor did not return every distinct original record")
    return rows, {"build": build["id"], "snapshot": build["native"]["snapshot"],
                  "fields": fields, "pages": pages, "rows": len(rows)}


def full_finance_review(workspace, portfolio):
    """Reconcile complete query results and publisher profile with the saved report."""
    reports, activity_ids = [], set()
    for edition in portfolio["editions"]:
        profile = workspace.profile(edition["source"])
        queries = {}
        selected = {}
        for collection in ("activities", "transactions", "budgets"):
            build = edition[collection]
            fields = ["row_id", "activity_id", "reporting_org_ref", "hierarchy"]
            if collection != "activities":
                fields += ["value", "value_decimal", "currency", "value_day", "financial_eligible"]
                fields += (["transaction_type", "transaction_type_label"] if collection == "transactions"
                           else ["budget_type", "budget_type_label", "budget_status", "budget_status_label",
                                 "period_start_day", "period_end_day"])
            selected[collection], queries[collection] = all_native_rows(workspace, build, fields)
            if build["rowCount"] != profile["inventory"]["counts"][collection]:
                raise ValueError("Complete portfolio omitted original publisher " + collection)
        activity_ids.update(row["activity_id"] for row in selected["activities"])
        reports.append({"source": edition["source"], "profile": profile, "queries": queries,
                        "rows": selected})
    summary = portfolio["report"]
    groups = {}
    excluded = 0
    with localcontext() as context:
        context.prec = 1024
        for item in reports:
            for collection in ("transactions", "budgets"):
                for row in item["rows"][collection]:
                    if row["activity_id"] not in activity_ids:
                        raise ValueError("Financial row lost its original activity association")
                    if row["financial_eligible"] != "true":
                        excluded += 1
                        continue
                    dimensions = {"collection": collection, "reportingOrgRef": row["reporting_org_ref"],
                                  "hierarchy": row["hierarchy"], "currency": row["currency"],
                                  "valueDate": row["value_day"]}
                    if collection == "transactions":
                        dimensions.update(transactionType=row["transaction_type"],
                                          transactionTypeLabel=row["transaction_type_label"])
                    else:
                        dimensions.update(budgetType=row["budget_type"], budgetTypeLabel=row["budget_type_label"],
                                          budgetStatus=row["budget_status"], budgetStatusLabel=row["budget_status_label"],
                                          periodStart=row["period_start_day"], periodEnd=row["period_end_day"])
                    key = encoded(dimensions)
                    group = groups.setdefault(key, {**dimensions, "count": 0, "amount": Decimal(0)})
                    group["count"] += 1
                    group["amount"] += Decimal(row["value_decimal"])
    actual_groups = [{**groups[key], "amount": format(groups[key]["amount"], "f")} for key in sorted(groups)]
    if actual_groups != summary["financialGroups"] or excluded != summary["counts"]["excludedFinancialRecords"]:
        raise ValueError("Saved finance report differs from the full original native rows")
    for collection in ("activities", "transactions", "budgets"):
        actual = sum(len(item["rows"][collection]) for item in reports)
        if actual != summary["counts"][collection]:
            raise ValueError("Saved complete portfolio count differs from its native rows")
    return {"counts": summary["counts"], "financialGroups": actual_groups,
            "sources": [{"source": item["source"], "profile": item["profile"], "queries": item["queries"]}
                        for item in reports]}, sorted(activity_ids)


def run(config):
    if not isinstance(config, dict):
        raise ValueError("Receiving configuration must be an object")
    expected = {"schema", "sourceRoot", "directory", "outputDirectory", "operationId", "actor", "publisher"}
    if set(config) != expected or config["schema"] != SCHEMA:
        raise ValueError("Supply one complete original IATI publisher receiving configuration")
    operation = config["operationId"]
    actor = config["actor"]
    if not isinstance(operation, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,110}", operation):
        raise ValueError("Use the original short receiving operation identity")
    if (not isinstance(actor, dict) or set(actor) != {"id", "label"} or
        any(not isinstance(actor[key], str) or not actor[key].strip() or len(actor[key]) > 160
            for key in ("id", "label"))):
        raise ValueError("The receiving actor needs its original id and label")
    source_root = Path(config["sourceRoot"]).expanduser().resolve(strict=True)
    application = source_root / "stellar/scf-starforge-20261009/sf30-seller-sdk/iati"
    sys.path.insert(0, str(application))
    from iati_source import DOMAIN_VERSION
    from iati_workspace import IatiWorkspace
    from managed import inspect_binding

    acquired = publisher(config["publisher"])
    directory = Path(config["directory"]).expanduser().absolute()
    output = regular_directory(config["outputDirectory"])
    intent = {"schema": SCHEMA, "operationId": operation, "actor": actor,
              "directory": str(directory), "sourceRoot": str(source_root), "publisher": acquired,
              "domainVersion": DOMAIN_VERSION}
    save(output / "original-intent.json", intent)
    if directory.is_symlink():
        raise ValueError("The original source workspace must be a real directory")
    workspace = IatiWorkspace(directory, create=not directory.exists())
    try:
        with Path(acquired["path"]).open("rb") as stream:
            source = workspace.add_source(stream, acquired["label"], Path(acquired["path"]).name)
        if source["id"] != acquired["sha256"] or source["bytes"] != acquired["bytes"]:
            raise ValueError("Retained publisher has another complete byte identity")
        with Path(acquired["path"]).open("rb") as stream:
            if workspace.add_source(stream, acquired["label"], Path(acquired["path"]).name)["id"] != source["id"]:
                raise ValueError("Retaining the same complete source changed its identity")
        title = "IATI publisher finance — " + acquired["label"]
        title = title[:160]
        definition = {"name": title, "sources": [source["id"]],
                      "notes": "Complete publisher edition acquired " + acquired["fetchedAt"] + " from " + acquired["url"]}
        first_input = {"requestId": operation + ":original", **definition}
        first = workspace.save_portfolio(first_input)
        review, activity_ids = full_finance_review(workspace, first)
        if not activity_ids:
            raise ValueError("Select an original publisher with activities for this receiving workflow")
        save(output / "original-source-profile.json", workspace.profile(source["id"]))
        save(output / "complete-native-finance-review.json", review)
        finding_count = review["counts"]["reviewRecords"]
        review_state = {"status": "needs-correction" if finding_count else "reviewed",
                        "reviewer": actor["label"],
                        "note": "Complete publisher/native row counts, activity associations and exact financial groups reconciled. "
                                + str(finding_count) + " records retain publisher review findings in the complete report."}
        reviewed_input = {"requestId": operation + ":reviewed", "id": first["id"], "expectedRevision": first["revision"],
                          **definition, "review": review_state}
        reviewed = workspace.save_portfolio(reviewed_input)
        original_comparison = workspace.compare_portfolio({
            "id": first["id"], "beforeRevision": first["revision"], "afterRevision": reviewed["revision"]})
        for item in original_comparison["comparisons"]:
            counts = item["comparison"]["counts"]
            if counts["added"] or counts["removed"] or counts["changed"]:
                raise ValueError("Named portfolio review changed its retained source rows")
        # Exercise an actual analyst selection and then restore the complete cohort.
        selected_ids = activity_ids[:min(3, len(activity_ids))]
        selected_input = {"requestId": operation + ":activity-selection", "id": first["id"],
                          "expectedRevision": reviewed["revision"], **definition,
                          "selection": {"activityIds": selected_ids},
                          "notes": definition["notes"] + ". Saved analyst selection: " + ", ".join(selected_ids)}
        selected = workspace.save_portfolio(selected_input)
        if selected["report"]["counts"]["activities"] != len(selected_ids):
            raise ValueError("Saved activity selection did not preserve its exact original cohort")
        selection_comparison = workspace.compare_portfolio({
            "id": first["id"], "beforeRevision": reviewed["revision"], "afterRevision": selected["revision"]})
        complete_input = {"requestId": operation + ":complete-handover", "id": first["id"],
                          "expectedRevision": selected["revision"], **definition, "review": review_state}
        complete = workspace.save_portfolio(complete_input)
        restored_comparison = workspace.compare_portfolio({
            "id": first["id"], "beforeRevision": first["revision"], "afterRevision": complete["revision"]})
        if complete["report"] != first["report"]:
            raise ValueError("Returning to the complete publisher cohort changed the original report")
        if workspace.save_portfolio(first_input) != first or workspace.portfolio(first["id"]) != complete:
            raise ValueError("Replaying the original save changed later portfolio history")
        if len(workspace.history(first["id"])) != complete["revision"]:
            raise ValueError("Complete receiving did not retain all original revisions")

        report_path, packet_path = output / "iati-report.zip", output / "iati-portfolio.zip"
        workspace.write_report(first["id"], report_path, complete["revision"])
        workspace.export_portfolio(first["id"], packet_path, complete["revision"])
        report_identity, packet_identity = exact_file(report_path), exact_file(packet_path)
        if not workspace.export_portfolio(first["id"], packet_path, complete["revision"])["reused"]:
            raise ValueError("Completed portfolio export did not reuse its original full file")
        if exact_file(packet_path) != packet_identity:
            raise ValueError("Replayed portfolio export changed its original bytes")
        # Native merchant publishing consumes these exact configurations and CSVs.
        dataset_root = regular_directory(output / "native-datasets")
        datasets = []
        for edition in complete["editions"]:
            for collection in ("activities", "transactions", "budgets"):
                build = edition[collection]
                target = dataset_root / collection
                member_identities = publish_native_dataset(workspace, build, target)
                datasets.append({"collection": collection, "build": build["id"], "files": member_identities})
        report_directory = regular_directory(output / "report")
        with zipfile.ZipFile(report_path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            for name, declared in manifest["files"].items():
                if not name.startswith("reports/") or Path(name).name != name[8:]:
                    raise ValueError("Original report has an unexpected receiving path")
                target = report_directory / Path(name).name
                body = archive.read(name)
                if len(body) != declared["bytes"] or hashlib.sha256(body).hexdigest() != declared["sha256"]:
                    raise ValueError("Original report member changed")
                save_bytes(target, body)
        save(output / "saved-portfolio-history.json", workspace.history(first["id"]))
        save(output / "saved-portfolio-comparisons.json",
             [original_comparison, selection_comparison, restored_comparison])
        expected_operator = {"portfolioId": complete["id"], "revision": complete["revision"],
                             "definitionSha256": complete["definitionSha256"],
                             "counts": complete["report"]["counts"],
                             "financialGroups": complete["report"]["financialGroups"],
                             "comparison": {key: restored_comparison[key]
                                            for key in ("id", "beforeRevision", "afterRevision", "pairs")}}
        result = {"schema": SCHEMA, "operationId": operation, "source": source["id"],
                  "directory": str(directory), "outputDirectory": str(output), "sourceRoot": str(source_root),
                  "publisher": acquired, "domainVersion": DOMAIN_VERSION,
                  "portfolio": complete, "queries": [item["queries"] for item in review["sources"]],
                  "report": report_identity, "packet": packet_identity, "datasets": datasets,
                  "comparisonIds": [original_comparison["id"], selection_comparison["id"], restored_comparison["id"]],
                  "expected": expected_operator}
    finally:
        workspace.close()
    # The original workspace lease is closed before Applications acquires it.
    result["binding"] = inspect_binding(directory)
    save(output / "result.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    result = run(json_input(args.input))
    print(json.dumps({"schema": result["schema"], "operationId": result["operationId"],
                      "portfolio": result["expected"], "result": str(Path(result["outputDirectory"]) / "result.json")},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
