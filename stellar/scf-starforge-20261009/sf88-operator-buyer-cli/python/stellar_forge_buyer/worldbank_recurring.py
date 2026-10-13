"""Refresh an approved World Bank edition in the customer's original Analysis workspace.

The existing importer, comparison, report, workbook-refresh and archive engines
own all data and transitions. This adapter preserves customer definitions and
retains one original operation across review, selection and complete delivery.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import zipfile

from .analysis_workspace import AnalysisWorkspace
from .errors import BuyerError
from .storage import private_directory
from .worldbank_metadata import compare_metadata
from .worldbank_analysis import WorldBankAnalysis, encoded, sha, regular, write, describe, require, MAX_DOCUMENT

SCHEMA = "stellar-forge.worldbank-recurring-review.v1"
DEFAULT_KEYS = ["source_id", "country_id", "country_iso3", "indicator_id", "period"]


def review_digest(value):
    return sha(encoded({key: item for key, item in value.items() if key != "review_sha256"}))


class WorldBankRecurring(WorldBankAnalysis):
    def review(self, handover, core, *, view, report, workbook, keys=None, prefix="worldbank", resume=False):
        for name in (view, report, workbook):
            require(isinstance(name, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", name),
                    "Select the actual saved customer view, report and workbook names.")
        if keys is None:
            original_intent = self.directory / "recurring-intent.json"
            if original_intent.exists():
                retained_intent = json.loads(regular(original_intent, MAX_DOCUMENT))
                require(retained_intent.get("schema") == SCHEMA and
                        retained_intent.get("operation_id") == self.operation_id and
                        all(retained_intent.get(field) == value for field, value in (
                            ("view", view), ("report", report), ("workbook", workbook))),
                        "Continue the original recurring customer and comparison keys.")
                keys = retained_intent["keys"]
            else:
                keys = DEFAULT_KEYS
        require(isinstance(keys, list) and 1 <= len(keys) <= 16 and
                all(isinstance(key, str) for key in keys) and len(keys) == len(set(keys)),
                "Supply one to sixteen distinct original comparison key columns.")
        target = {"schema": SCHEMA, "operation_id": self.operation_id,
                  "view": view, "report": report, "workbook": workbook, "keys": keys}
        write(self.directory / "recurring-intent.json", encoded(target), exact=True)
        self.target = target
        result = self.prepare(handover, core, prefix=prefix, resume=resume)
        if result.get("schema") == SCHEMA:
            return result
        received = json.loads(regular(self.directory / "recurring-review.json", MAX_DOCUMENT))
        require(received.get("review_sha256") == review_digest(received) and
                received.get("target") == target, "Continue the original completed recurring review.")
        return received

    def _prepare_analysis(self, workspace, document, name, source, review,
                          rows, columns, selected_recipes, max_rows, *, resume):
        # The original importer retains the complete handover and typed rows.
        # A distinct source name preserves earlier documents. The customer view
        # is selected only by the original reviewed comparison in refresh().
        registered = workspace.responses.register(name, "document", manifest=document / "source.json")
        preview = self.job(workspace, "SOURCE_PREVIEW", "response-preview", {
            "source": name, "source_revision": registered["revision"],
            "mapping": {"collection": "/observations", "sse_data": "text",
                        "columns": [{"name": column, "pointer": "/" + column,
                                     "type": "native", "missing": "error"} for column in columns]}},
            resume=resume)
        imported = self.job(workspace, "SOURCE_IMPORT", "response-import", {
            "preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"],
            "allow_incomplete": False}, resume=resume)
        version = imported["result"]["version"]
        require(version["row_count"] == len(rows), "The reviewed row count changed on import.")
        retained = self.directory / "recurring-review.json"
        if retained.exists():
            received = json.loads(regular(retained, MAX_DOCUMENT))
            require(received.get("review_sha256") == review_digest(received) and
                    received.get("workspace_id") == workspace.identity and
                    received.get("target") == self.target and
                    received.get("candidate_version_id") == version["version_id"],
                    "Continue the complete original recurring review.")
            return received

        baseline = workspace.database.current(self.target["view"])
        require(baseline["version"] is not None, "Select an existing customer view.")
        report = workspace.reports.definition(self.target["report"])
        workbook = workspace.workbooks.definition(self.target["workbook"])
        # Resolve every original worksheet before making a source selection.
        # This also verifies the retained full report/query-export sources.
        refresh = workspace.workbooks.refresh
        related = []
        for index, sheet in enumerate(workbook["definition"]["sheets"]):
            lineage = refresh._lineage(sheet["source"])
            if lineage.get("kind") == "report" and lineage["report_name"] == self.target["report"]:
                sections = [section["ordinal"] for section in report["definition"]["sections"]
                            if section["query_name"] == lineage["query_name"]]
                matches = sections if len(lineage["query_sections"]) == len(sections) == 1 else [
                    ordinal for ordinal in sections if ordinal == lineage["section"]]
                require(len(matches) == 1,
                        "Update the customer worksheet source in the existing workbook editor before "
                        "reviewing this incoming edition: " + json.dumps({
                            "worksheet_index": index, "worksheet": sheet["name"],
                            "query_name": lineage["query_name"], "old_section": lineage["section"],
                            "current_report_sections": sections}))
                related.append(index)
        require(related, "The selected workbook must contain a sheet from the selected saved report.")
        views = workspace.database.view_bindings()
        comparison = self.job(workspace, "SOURCE_COMPARISON", "compare", {
            "view": self.target["view"], "expected_revision": baseline["revision"],
            "base_version_id": baseline["version"]["version_id"],
            "candidate_version_id": version["version_id"], "keys": self.target["keys"]},
            resume=resume)
        received = {
            "schema": SCHEMA, "operation_id": self.operation_id, "workspace_id": workspace.identity,
            "target": self.target, "source": deepcopy(self.record["source"]),
            "source_metadata": source, "original_review": review,
            "metadata_review": compare_metadata(workspace, baseline["version"]["version_id"],
                version["version_id"], source_file=self._source_file, source_sha256=self._source_sha256),
            "candidate_version_id": version["version_id"],
            "baseline_view": {"name": baseline["name"], "revision": baseline["revision"],
                              "version_id": baseline["version"]["version_id"]},
            "views": views, "comparison": {"id": comparison["id"], **comparison["result"]},
            "report": report, "workbook": workbook, "related_sheets": related,
            "review_file": str(retained),
        }
        received["review_sha256"] = review_digest(received)
        write(retained, encoded(received), exact=True)
        self.record["recurring_review"] = {"sha256": received["review_sha256"], "file": str(retained)}
        self.save()
        self.emit("SOURCE_REVIEW_READY", comparison_id=comparison["id"],
                  review_sha256=received["review_sha256"], review_file=str(retained))
        return received

    def refresh(self, review_sha256, *, note, columns=None, resume=False):
        require(isinstance(note, str) and note.strip() and len(note.encode()) <= 8000,
                "Describe the reviewed source change in the selection note.")
        require(isinstance(review_sha256, str) and re.fullmatch(r"[a-f0-9]{64}", review_sha256),
                "Use the exact completed recurring review SHA-256.")
        require(columns is None or isinstance(columns, dict),
                "A worksheet-column choice is an object keyed by worksheet index.")
        lease = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.record = json.loads(regular(self.directory / "operation.json", MAX_DOCUMENT))
            review = json.loads(regular(self.directory / "recurring-review.json", MAX_DOCUMENT))
            require(review.get("schema") == SCHEMA and review.get("operation_id") == self.operation_id and
                    review.get("review_sha256") == review_sha256 == review_digest(review),
                    "Receive the original complete reviewed source and customer definitions.")
            if columns is not None:
                allowed = {str(index) for index in review["related_sheets"]}
                require(all(isinstance(index, str) and index in allowed and
                            isinstance(value, list) and value for index, value in columns.items()),
                        "Supply full nonempty column arrays keyed by related worksheet-index strings.")
            write(self.directory / "recurring-selection-intent.json",
                  encoded({"review_sha256": review_sha256, "note": note}), exact=True)
            ready = self.completed()
            if ready:
                if columns is not None:
                    selected_columns = json.loads(regular(self.directory / "workbook-choice.json", MAX_DOCUMENT))
                    require(all(index in selected_columns and value == selected_columns[index]["columns"]
                                for index, value in columns.items()),
                            "Continue the completed workbook's original accepted column choices.")
                return ready
            with self._workspace_session() as workspace:
                require(workspace.identity == review["workspace_id"], "Continue the original customer workspace.")
                return self._refresh(workspace, review, note, columns, resume=resume)
        finally:
            os.close(lease)

    def _refresh(self, workspace, review, note, columns, *, resume):
        target, comparison = review["target"], review["comparison"]
        selected = workspace.changes.page(comparison["id"], limit=1)
        previous = selected["selection"]
        selection_id = self.identifier("recurring-source-selection")
        if previous is None:
            # Check the same customer definitions before the first transition.
            current_report = workspace.reports.definition(target["report"])
            current_workbook = workspace.workbooks.definition(target["workbook"])
            require(current_report["sha256"] == review["report"]["sha256"] and
                    current_report["head_revision"] == review["report"]["head_revision"] and
                    current_report["publication_revision"] == review["report"]["publication_revision"] and
                    current_workbook["definition_sha256"] == review["workbook"]["definition_sha256"] and
                    current_workbook["head_revision"] == review["workbook"]["head_revision"] and
                    workspace.database.view_bindings() == review["views"],
                    "Customer definitions or source selection changed; review those current edits in a new recurring operation.")
        else:
            require(previous["id"] == selection_id, "Continue the original comparison's selected operation.")
        selection = workspace.changes.select(comparison["id"], {
            "id": selection_id, "result_sha256": comparison["result_sha256"], "note": note})
        activation = selection["activation"]
        expected_views = [
            {"name": view["name"], "revision": activation["revision"],
             "version_id": activation["version"]["version_id"]} if view["name"] == target["view"] else view
            for view in review["views"]]
        self.record["view"] = {"name": target["view"], "revision": activation["revision"]}
        self.record["version_id"] = review["candidate_version_id"]
        self.record["report_views"] = expected_views
        self.record["recurring_selection"] = selection
        self.save()

        # Run the exact customer-edited report, including its pinned query
        # revisions and parameter overrides. Do not save generated recipes over it.
        definition = review["report"]["definition"]
        report = self.job(workspace, "REPORT", "report", {
            "name": target["report"], "revision": definition["revision"],
            "definition_sha256": review["report"]["sha256"], "expected_views": expected_views},
            resume=resume)
        publication = workspace.reports.publish(report["id"], {
            "id": self.identifier("report-publication"),
            "result_sha256": report["result"]["result_sha256"],
            "expected_revision": review["report"]["publication_revision"], "note": note})
        sources = [workspace.workbooks.source({"kind": "report", "id": publication["id"], "section": index})
                   for index in range(len(definition["sections"]))]
        publication_sha = sources[0]["sha256"]
        self.record["publication"] = {**publication, "sha256": publication_sha}
        self.save()

        refresh = workspace.workbooks.refresh
        proposed = deepcopy(review["workbook"]["definition"])
        unresolved = []
        replacements = {}
        choice_path = self.directory / "workbook-choice.json"
        retained_choices = json.loads(regular(choice_path, MAX_DOCUMENT)) if choice_path.exists() else {}
        for index in review["related_sheets"]:
            sheet = proposed["sheets"][index]
            lineage = refresh._lineage(sheet["source"])
            candidates = [source for source in sources if refresh._match(lineage, refresh._lineage(source))]
            require(len(candidates) == 1,
                    "A customer report section changed identity; choose its source in the original workbook refresh editor.")
            candidate = candidates[0]
            suggested, missing = refresh._suggest_columns(sheet, candidate)
            chosen = columns.get(str(index)) if columns is not None else None
            if chosen is None and str(index) in retained_choices:
                chosen = retained_choices[str(index)]["columns"]
            if chosen is not None:
                require(isinstance(chosen, list) and chosen, "Supply the full chosen column mapping for each worksheet.")
                suggested, missing = chosen, []
            replacements[str(index)] = {"source": candidate, "columns": suggested}
            sheet["source"], sheet["columns"] = candidate, suggested
            unresolved.extend({"sheet": index, **item} for item in missing)
        proposal_file = self.directory / "workbook-proposal.json"
        # Keep a complete editable proposal when the actual changed schema needs
        # explicit column choices; the original source selection/report survive.
        write(proposal_file, encoded({"definition": proposed, "unresolved_columns": unresolved,
                                    "review_sha256": review["review_sha256"]}))
        if unresolved:
            return {"schema": SCHEMA, "operation_id": self.operation_id,
                    "status": "WORKBOOK_COLUMN_CHOICES_REQUIRED",
                    "proposal_file": str(proposal_file), "unresolved_columns": unresolved,
                    "selection": selection, "publication": self.record["publication"],
                    "action": "Supply --columns with complete column arrays keyed by worksheet index; continue this operation."}
        request = {"base_revision": review["workbook"]["definition"]["revision"],
                   "definition_sha256": review["workbook"]["definition_sha256"],
                   "expected_revision": review["workbook"]["head_revision"],
                   "reason": note, "definition": proposed}
        received = refresh.review(target["workbook"], request)
        require(received["ready"], "Correct the selected worksheet column conversions in --columns.")
        write(choice_path, encoded(replacements), exact=True)
        saved = refresh.save(target["workbook"], {
            **request, "id": self.identifier("recurring-workbook-definition"),
            "review_sha256": received["review_sha256"]})
        self.record["recurring_workbook"] = {
            "name": target["workbook"], "revision": saved["revision"],
            "definition_sha256": saved["definition_sha256"],
            "refresh_review_sha256": received["review_sha256"]}
        self.save()
        workbook = self.job(workspace, "WORKBOOK", "workbook", {
            "name": target["workbook"], "revision": saved["revision"],
            "definition_sha256": saved["definition_sha256"]}, resume=resume)

        destination = private_directory(self.directory / "delivery", create=True)
        extra = []
        for format in ("json", "csv"):
            change_export = self.job(workspace, "CHANGES_" + format.upper(), "change-export", {
                "comparison_id": comparison["id"], "result_sha256": comparison["result_sha256"],
                "selection_sha256": selected_selection_sha(workspace, comparison["id"]),
                "format": format}, resume=resume)
            export_path, result = workspace.change_export_file(change_export["id"])
            body = regular(export_path, 1024 * 1024 * 1024)
            require(len(body) == result["bytes"] and sha(body) == result["sha256"],
                    "The complete original comparison export changed.")
            path = destination / ("WorldBank_Source_Changes." + format)
            write(path, body, exact=True)
            extra.append(describe(path))
        choice = {"schema": SCHEMA, "operation_id": self.operation_id,
                  "review_sha256": review["review_sha256"], "selection": selection,
                  "customer_report": {"name": target["report"], "revision": definition["revision"],
                                      "sha256": review["report"]["sha256"]},
                  "customer_workbook": self.record["recurring_workbook"],
                  "preserved_other_worksheets": [i for i in range(len(proposed["sheets"]))
                                                 if i not in review["related_sheets"]]}
        choice_file = destination / "WorldBank_Recurring_Selection.json"
        write(choice_file, encoded(choice), exact=True)
        extra.append(describe(choice_file))
        return self._deliver(workspace, review["source_metadata"], review["original_review"],
                             review["source"]["observations"], activation["version"],
                             publication, publication_sha, workbook, resume=resume, extra_files=extra)

    def guide(self, source, review, publication, archived):
        retained = json.loads(regular(self.directory / "recurring-review.json", MAX_DOCUMENT))
        target = retained["target"]
        definition = retained["report"]["definition"]
        workbook = json.loads(regular(self.directory / "workbook-proposal.json", MAX_DOCUMENT))["definition"]
        fence = chr(96) * 3
        sections = "\n".join("- " + section["title"] + " (saved query " +
                             section["query_name"] + ", revision " + str(section["query_revision"]) + ")"
                             for section in definition["sections"])
        sheets = "\n".join("- " + sheet["name"] for sheet in workbook["sheets"])
        return """# Recurring World Bank monitoring delivery

Open **WorldBank_Report.html** for the complete customer report, or
**WorldBank_Analysis.xlsx** for the refreshed workbook.

## Customer report and worksheets

- Saved view: """ + target["view"] + """
- Saved report: """ + target["report"] + " — " + definition["title"] + """
- Saved report definition revision: """ + str(definition["revision"]) + """
- Saved workbook: """ + target["workbook"] + " — " + workbook["title"] + """

The report uses these exact retained customer sections and pinned query revisions:

""" + sections + """

The workbook retains these customer worksheet names, headers and formatting choices:

""" + sheets + """

Related report worksheets use the newly selected source edition. Other worksheets
retain their original source. Earlier workbook definitions and their complete
sources remain in WorldBank_Workbook_Handover.zip and the Analysis workspace.

## Exact source and calculations

The original approved handover, reviewed CSV, source metadata, review and capture
are retained with the source document. Original numeric tokens and period labels
remain text. The saved customer SQL and report definitions govern derived values;
their selected query revisions and parameter overrides are retained.

WorldBank_Source_Changes.json and .csv contain the complete source comparison.
WorldBank_Recurring_Selection.json identifies the selected source and saved
customer report/workbook revisions.

## Open a portable customer installation

Install the existing Python workbook extra, then receive the delivered complete
Analysis workspace into a new private directory:

""" + fence + """sh
stellar-forge-worldbank-analysis receive --archive /absolute/WorldBank_Analysis_Workspace.zip \\
  --sha256 <workspace-ZIP-SHA256-from-Analysis_Delivery.json> \\
  --workspace /absolute/private/worldbank-analysis \\
  --operation-id <stable-32-character-lowercase-hex-receiving-id>
stellar-forge-worldbank-analysis serve --workspace /absolute/private/worldbank-analysis
""" + fence + """

Open the printed private local URL to use the saved SQL, source tables, reports
and workbook history. The archive receiver retains its original operation during
interruption. A completed receive preserves later customer edits.

## Refresh the next approved edition

Use a new recurring operation ID for each newly approved handover, selecting the
same saved view, report and workbook names above. Review the full incoming source
comparison, then select that reviewed edition with recurring-refresh. Edit a
report's pinned query revision before review when a changed saved query should
be used. The product's RECURRING.md contains the complete command reference.

Within the live original workspace, continue an interrupted refresh with its
same operation ID and reviewed digest. A portable Analysis installation contains
the complete customer data and definitions; start its next incoming-edition
review with a new operation ID.

## Source edition and delivery identities

- Source: World Bank Indicators API V2; source """ + source["sourceId"] + """
- Original capture time: """ + source["capturedAt"] + """
- Reviewed observations: """ + str(source["observations"]) + """
- Original source review: """ + review["id"] + " revision " + str(review["revision"]) + """
- Published report: """ + publication["id"] + """
- Analysis workspace: """ + archived["workspace_id"] + """
- Recurring operation: """ + self.operation_id + """

Analysis_Delivery.json lists the exact complete customer files and their hashes.
"""


def selected_selection_sha(workspace, comparison_id):
    return workspace.changes.page(comparison_id, limit=1)["selection_sha256"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    review = commands.add_parser("review", help="Review an approved new handover against the same customer view and definitions")
    review.add_argument("--handover", required=True)
    review.add_argument("--worldbank-core", required=True)
    review.add_argument("--view", required=True)
    review.add_argument("--report", required=True)
    review.add_argument("--workbook", required=True)
    review.add_argument("--keys", help="JSON list of complete original comparison key columns")
    review.add_argument("--prefix", default="worldbank")
    refresh = commands.add_parser("refresh", help="Select the reviewed edition and deliver the existing customer report/workbook")
    refresh.add_argument("--review-sha256", required=True)
    refresh.add_argument("--note", required=True)
    refresh.add_argument("--columns", help="JSON file of full column arrays keyed by worksheet index, if actual schema changed")
    status = commands.add_parser("status", help="Read this original recurring operation")
    for command in (review, refresh, status):
        command.add_argument("--workspace", required=True)
        command.add_argument("--operation-id", required=True)
        command.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        current = WorldBankRecurring(args.workspace, operation_id=args.operation_id,
            progress=lambda event: print(json.dumps(event), flush=True))
        if args.command == "review":
            result = current.review(args.handover, args.worldbank_core,
                view=args.view, report=args.report, workbook=args.workbook,
                keys=json.loads(args.keys) if args.keys else None, prefix=args.prefix, resume=args.resume)
        elif args.command == "refresh":
            result = current.refresh(args.review_sha256, note=args.note,
                columns=json.loads(regular(args.columns, MAX_DOCUMENT)) if args.columns else None,
                resume=args.resume)
        else:
            result = current.completed() or current.record
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except KeyboardInterrupt:
        return 130
    except (BuyerError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"schema": SCHEMA, "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
