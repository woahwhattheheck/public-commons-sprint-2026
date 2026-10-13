"""Headless delivery operations through the original SF47 Workspace owner."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile

from model import Problem, MAX_BUNDLE, canonical
from operations import Operations, MAX_SOURCE
import operations_dcat_sources as dcat_sources
import operations_commercial_cli as commercial_cli
import operations_expense_billing_cli as expense_billing_cli
import operations_work_billing_cli as work_billing_cli
import operations_installation_returns_cli as installation_returns_cli
import operations_company_returns_cli as company_returns_cli
import operations_ledger_intake as ledger_intake
import operations_funding_cli as funding_cli
import award_terms_cli
import operations_agenda_cli as agenda_cli
import operations_installation_editions_cli as editions_cli
import operations_installation_mapping_cli as mapping_cli
import operations_risks_cli as risks_cli
import operations_workbook_cli as workbook_cli
import operations_supplier_statements_cli as supplier_statements_cli


def register(subparsers, common):
    root = subparsers.add_parser("operations", parents=[common],
        help="Retained delivery, work, invoices, cash, deployments and review")
    actions = root.add_subparsers(dest="operation", required=True)
    def command(name, description, case=False, output=False):
        target = actions.add_parser(name, help=description, description=description)
        if case:
            target.add_argument("--case", required=True, help="Original operations case ID")
        if output:
            target.add_argument("--output", help="New private JSON filename; omission prints JSON")
        return target
    def mutation(target, version=False, note_required=False):
        target.add_argument("--actor", required=True, help="Recording operator, retained in the original history")
        target.add_argument("--request-id", required=True, help="Stable ID; reuse exact inputs to resume")
        if version:
            target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--note", default="", required=note_required, help="Reason or review note")
    def selection(target):
        target.add_argument("--plan", required=True)
        target.add_argument("--selected-revision", type=int, required=True)
        target.add_argument("--expected-content-sha256", required=True)
        target.add_argument("--name", required=True)
        target.add_argument("--calendar-start", help="Explicit operational YYYY-MM-DD anchor; does not record an award")

    supplier_statements_cli.register(command, mutation)
    workbook_cli.register(command, mutation)
    funding_cli.register(command, mutation)
    risks_cli.register(command, mutation)
    agenda_cli.register(command)
    editions_cli.register(command, mutation)
    mapping_cli.register(command, mutation)
    target = command("list", "List delivery operations cases", output=True)
    target.add_argument("--plan")
    target = command("create", "Pin a saved plan and open an operations or walkthrough case")
    selection(target); mutation(target)
    target.add_argument("--mode", choices=("OPERATIONS", "WALKTHROUGH"), required=True)
    for name in ("show", "report"):
        command(name, "Read the complete retained " + name, case=True, output=True)
    target = command("operating-workflows", "Read all six saved operating workflow families from one original case version", output=True)
    target.add_argument("case", help="Original operations case ID")
    target.add_argument("--version", type=int, required=True, help="Expected original case version")
    command("task-outcomes", "List saved customer task comparisons and their current editions", case=True, output=True)
    target = command("task-outcomes-seed", "Prepare a new complete customer task comparison input", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target = command("task-outcomes-show", "Read the complete selected comparison, source and revision history", case=True, output=True)
    target.add_argument("--comparison", required=True)
    target.add_argument("--revision", type=int)
    target.add_argument("--inputs-only", action="store_true", help="Emit complete editable inputs based on this selected revision")
    target = command("task-outcomes-preview", "Compare both complete methods using exact effort and costs", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--inputs", required=True, help="Complete task comparison inputs JSON")
    target = command("task-outcomes-save", "Save a reviewed immutable edition in the original case transaction", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--inputs", required=True)
    target.add_argument("--expected-preview-sha256", required=True)
    target = command("task-outcomes-export", "Export the selected customer report, complete source case and all revisions", case=True)
    target.add_argument("--comparison", required=True)
    target.add_argument("--revision", type=int, required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--output", required=True)
    target = command("supplier-account", "Read the complete supplier account, original records and dated balances", case=True, output=True)
    target.add_argument("--contributor", help="Original contributor or supplier record ID; defaults to the first supplier")
    target.add_argument("--start-date")
    target.add_argument("--end-date", required=True)
    target.add_argument("--expected-version", type=int)
    target = command("supplier-account-export", "Export the complete supplier account, original CSVs, offline HTML and original case", case=True)
    target.add_argument("--contributor")
    target.add_argument("--start-date")
    target.add_argument("--end-date", required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--expected-report-sha256", required=True)
    target.add_argument("--output", required=True)
    for verb in ("account-reconciliation", "account-reconciliation-export"):
        target = command(verb, "Read or export the complete original statement reconciliation and saved period editions", case=True, output=verb == "account-reconciliation")
        target.add_argument("--reconciliation", help="Retained reconciliation ID; omission lists the complete account")
        target.add_argument("--revision", type=int, help="Original saved edition; omission opens its current head")
        target.add_argument("--expected-version", type=int, required=verb == "account-reconciliation-export")
        if verb == "account-reconciliation-export":
            target.add_argument("--expected-report-sha256", required=True)
            target.add_argument("--output", required=True)
    target = command("account-reconciliation-statement-inputs", "Read the complete original statement bytes and retained mapping for its native writer", case=True, output=True)
    target.add_argument("--source", required=True, help="Original statement source ID")
    for verb in ("account-reconciliation-preview", "account-reconciliation-apply"):
        target = command(verb, "Review or save the complete source, native cash matches and dated reconciliation edition", case=True, output=True)
        target.add_argument("--input", required=True, help="Complete reconciliation JSON or downloaded browser desk")
        target.add_argument("--expected-version", type=int, help="Original case version; must match if retained in the input")
        if verb == "account-reconciliation-apply":
            target.add_argument("--actor", help="Recording operator; must match if already retained")
            target.add_argument("--request-id", help="Original request ID; must match if already retained")
            target.add_argument("--expected-preview-sha256", help="Complete reviewed preview hash; must match if retained")
    target = command("account-reconciliation-desk-resume", "Resume the exact original request retained in a complete browser reconciliation desk", case=True, output=True)
    target.add_argument("--input", required=True)
    for verb in ("cash-account", "cash-account-export"):
        target = command(verb, "Read or export the complete dated cash account and original correction history", case=True, output=verb == "cash-account")
        target.add_argument("--start-date")
        target.add_argument("--end-date", required=True)
        target.add_argument("--network")
        target.add_argument("--currency")
        target.add_argument("--asset")
        target.add_argument("--expected-version", type=int, required=verb == "cash-account-export")
        if verb == "cash-account-export":
            target.add_argument("--expected-report-sha256", required=True)
            target.add_argument("--output", required=True)
    for verb in ("cash-correction-preview", "cash-correction-apply"):
        target = command(verb, "Review or apply the complete original cash correction in one native transaction", case=True, output=True)
        target.add_argument("--input", required=True, help="Complete correction JSON or downloaded cash desk")
        if verb == "cash-correction-apply":
            target.add_argument("--actor", help="Recording operator; must match if already retained in the input")
            target.add_argument("--request-id", help="Original request ID; must match if already retained")
            target.add_argument("--expected-preview-sha256", help="Reviewed preview hash; must match if already retained")
    target = command("cash-desk-resume", "Resume exactly the retained pending cash/source request from a downloaded desk", case=True, output=True)
    target.add_argument("--input", required=True, help="Complete downloaded cash desk; retains actor, version and original request ID")
    target = command("work-intakes", "List retained work and invoice source intakes", case=True, output=True)
    target = command("work-intake-show", "Read source rows, saved mappings, editions and original record links", case=True, output=True)
    target.add_argument("--intake", required=True)
    target.add_argument("--revision", type=int)
    target = command("work-intake-upload", "Open an intake from an original CSV/TSV file or case source", case=True, output=True)
    mutation(target, version=True)
    original = target.add_mutually_exclusive_group(required=True)
    original.add_argument("--file", help="Original delimited file, up to the native source limit")
    original.add_argument("--source", help="Existing original case source ID")
    target.add_argument("--name", required=True)
    target.add_argument("--kind", choices=("WORK", "INVOICES"), required=True)
    target.add_argument("--format", help="UTF-8 JSON with explicit delimiter, encoding, header row, dates and decimal separators")
    target.add_argument("--source-url", default="")
    target.add_argument("--observed-at")
    target = command("work-intake-preview", "Review proposed original records and duplicate decisions without changing the case", case=True, output=True)
    target.add_argument("--intake", required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--revision", type=int)
    target.add_argument("--document", help="Complete edited intake document JSON; omission uses the saved edition")
    for verb in ("save", "apply"):
        target = command("work-intake-" + verb, "Save mapping corrections" if verb == "save" else "Apply the complete reviewed import in one original transaction", case=True, output=True)
        mutation(target, version=True)
        target.add_argument("--intake", required=True)
        target.add_argument("--expected-revision", type=int, required=True)
        target.add_argument("--document", help="Complete intake document JSON; omission uses the current saved edition")
        target.add_argument("--expected-preview-sha256", required=verb == "apply")
    command("amendments", "Read saved plan revisions, amendment editions and applied baseline history", case=True, output=True)
    target = command("amendment-show", "Read one complete original amendment and its native history", case=True, output=True)
    target.add_argument("--amendment", required=True)
    target.add_argument("--revision", type=int)
    target = command("amendment-preview", "Compare a selected native planning revision against the same recorded case", case=True, output=True)
    target.add_argument("--inputs", required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target = command("amendment-calendar-export", "Export both native amendment calendars, the full comparison and complete case", case=True)
    target.add_argument("--selection", required=True, help="Original draft or saved-edition calendar export selection JSON")
    target.add_argument("--output", required=True)
    target = command("performance", "Read period cash, invoices, work and pinned budget performance", case=True, output=True)
    target.add_argument("--start-date", help="First included business date; omission includes all prior dates")
    target.add_argument("--end-date", required=True, help="Last included business date, YYYY-MM-DD")
    target.add_argument("--expected-version", type=int)
    target = command("performance-export", "Export the reviewed report, all CSVs, offline HTML and complete operating case", case=True)
    target.add_argument("--start-date")
    target.add_argument("--end-date", required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--expected-report-sha256", required=True)
    target.add_argument("--output", required=True)
    command("ledger-intake", "Read table fields, templates and all recorded bulk intakes", case=True, output=True)
    target = command("ledger-intake-original", "Reopen every original file and its recorded row-to-record mapping", case=True, output=True)
    target.add_argument("--source", required=True)
    target.add_argument("--document-only", action="store_true", help="Emit the complete intake input for reuse")
    target = command("ledger-intake-template", "Write original CSV or TSV headers for a record table")
    target.add_argument("--kind", choices=ledger_intake.KINDS, required=True)
    target.add_argument("--format", choices=("csv", "tsv"), default="csv")
    target.add_argument("--output", required=True)
    target = command("ledger-intake-build", "Compile explicit sourceFile paths into a portable original-file intake document", output=True)
    target.add_argument("--input", required=True)
    target = command("ledger-intake-preview", "Review every resulting native record before recording the complete intake", case=True, output=True)
    target.add_argument("--input", required=True, help="Complete intake JSON or downloaded browser desk")
    target.add_argument("--expected-version", type=int)
    target = command("ledger-intake-apply", "Record all files and native rows in one original workspace transaction", case=True, output=True)
    target.add_argument("--input", required=True)
    target.add_argument("--expected-preview-sha256", required=True)
    mutation(target, version=True)
    target = command("history", "Page the original operations event history", case=True, output=True)
    target.add_argument("--after", type=int, default=0)
    target.add_argument("--limit", type=int, default=100)
    target = command("command", "Apply an original action with an explicit reviewed version", case=True)
    mutation(target, version=True)
    target.add_argument("--action", required=True)
    target.add_argument("--data", required=True, help="JSON file containing the action data object")
    target = command("attach", "Attach exact original source bytes", case=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True)
    target.add_argument("--kind", choices=("invoice", "work", "grant", "payment", "deployment", "purchase", "other"), default="other")
    target.add_argument("--media-type", default="application/octet-stream")
    target.add_argument("--source-url", default="")
    target.add_argument("--observed-at", required=True)
    target = command("attach-dcat", "Attach one complete hash-selected original DCAT workspace", case=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True)
    target.add_argument("--expected-sha256", required=True)
    target.add_argument("--source-url", default="")
    target.add_argument("--observed-at", required=True)
    target = command("source", "Export one exact retained source attachment", case=True)
    target.add_argument("--source", required=True)
    target.add_argument("--output", required=True)
    target = command("review", "Read one complete frozen review", case=True, output=True)
    target.add_argument("--review", required=True)
    target = command("export", "Export source, planner history, operations, reviews and CSV reports", case=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--output", required=True)
    target = command("import", "Receive and reopen a complete operations bundle")
    target.add_argument("--file", required=True)
    target.add_argument("--name", required=True)
    mutation(target)
    target = command("settlements", "List original merchant settlement reviews and their correction editions", case=True, output=True)
    target = command("settlement-show", "Read a complete saved settlement attribution and current original cash", case=True, output=True)
    target.add_argument("--review", required=True)
    target = command("settlement-export", "Export a complete saved settlement review and its original source", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)
    for verb in ("settlement-preview", "settlement-receive"):
        target = command(verb, "Review or receive original merchant settlements, explicit units, valuations and delivery attribution", case=True, output=True)
        target.add_argument("--file", required=True, help="Complete original merchant accounting or period-close TAR archive")
        target.add_argument("--name", required=verb == "settlement-receive", help="Name for this complete receiving review")
        target.add_argument("--selections", required=verb == "settlement-receive", help="UTF-8 JSON array of explicitly reviewed original row decisions")
        if verb == "settlement-receive":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True, help="Hash from the full native preview with the same name and selections")
        else:
            target.add_argument("--expected-version", type=int, required=True)
    for verb in ("settlement-correction-preview", "settlement-correct"):
        target = command(verb, "Review or save a correction to the original settlement attribution and immutable cash history", case=True, output=True)
        target.add_argument("--data", required=True, help="UTF-8 JSON correction object with original reviewId, rowId and expectedCashId")
        if verb == "settlement-correct":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    command("expenses", "Read issued expenses, accountant references and reviewed cost attribution", case=True, output=True)
    target = command("expense-preview", "Review an original issued buyer source or accountant-delivery ZIP", case=True, output=True)
    target.add_argument("--file", required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target = command("expense-receive", "Retain the exact reviewed issued source and original bookkeeping history", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True)
    target.add_argument("--expected-preview-sha256", required=True)
    target = command("expense-save", "Record explicit native cost splits and their original valuation", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--data", required=True, help="JSON allocation inputs including original intake and row SHA")
    for verb in ("expense-review", "expense-reopen", "expense-void"):
        target = command(verb, "Apply the selected attribution's recorded review transition", case=True, output=True)
        mutation(target, version=True)
        target.add_argument("--attribution", required=True)
        target.add_argument("--expected-content-sha256", required=True)
    target = command("expense-request", "Read the original receipt for an exact retained expense request", case=True, output=True)
    target.add_argument("--request", required=True, help="Complete original request JSON, including its stable requestId")
    target = command("expense-export", "Export the retained expense register, sources or readable review", case=True)
    target.add_argument("--format", choices=("attributions", "sources", "html"), required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--output", required=True)
    target = command("buyer-preview", "Review original SF88 Inbox or Node accounting source for this case", case=True, output=True)
    target.add_argument("--file", required=True, help="Original private SF88 Inbox handoff or Node Operation_Accounting.json")
    target.add_argument("--expected-version", type=int, required=True)
    target = command("buyer-receive", "Receive exact buyer source with original operation/deployment and purchase associations", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True, help="Same original handoff used for preview")
    target.add_argument("--expected-preview-sha256", required=True)
    target.add_argument("--selections", required=True, help="JSON file with reviewed jobId/purchaseId selections; purchaseId is null for unpaid Node observations or new original purchases")
    deployment = target.add_mutually_exclusive_group(required=True)
    deployment.add_argument("--deployment", help="Existing original buyer or combined deployment ID")
    deployment.add_argument("--deployment-file", help="Explicit JSON fields for a new buyer deployment")
    target = command("support-preview", "Review an original merchant support handoff for this delivery case", case=True, output=True)
    target.add_argument("--file", required=True, help="Original SF74 portable support handoff")
    target.add_argument("--expected-version", type=int, required=True)
    target = command("support-receive", "Attach reviewed support source and native report to a deployment", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True, help="Same original support file used for preview")
    target.add_argument("--expected-preview-sha256", required=True)
    deployment = target.add_mutually_exclusive_group(required=True)
    deployment.add_argument("--deployment", help="Original deployment ID from this operations case")
    deployment.add_argument("--deployment-file", help="JSON fields for a new original deployment")
    target = command("implementation-source", "Read the complete original SF74 implementation and selected observation cutoff", case=True, output=True)
    target.add_argument("--source", required=True, help="Original attached source ID")
    target.add_argument("--as-of", required=True, help="Canonical UTC observation cutoff including milliseconds")
    target.add_argument("--expected-version", type=int, required=True)
    for verb in ("implementation-preview", "implementation-prepare"):
        target = command(verb, "Review or freeze exact original implementation observations and explicit case links", case=True, output=True)
        target.add_argument("--inputs", required=True, help="Explicit reviewed implementation inputs JSON")
        if verb == "implementation-prepare":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    target = command("implementation-export", "Export a complete frozen implementation review and all original files", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)
    target = command("implementation-original", "Download one exact embedded original from the retained implementation source", case=True)
    target.add_argument("--source", required=True)
    target.add_argument("--sha256", required=True)
    target.add_argument("--output", required=True)
    for name in ("customer-use-calendar", "customer-use-calendar-export", "customer-use-calendar-cohort"):
        target = command(name, "Read saved customer-use editions, export complete dated use or open the original Cohort input",
                         case=True, output=name != "customer-use-calendar-export")
        target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--installation-refs", help="JSON array of exact saved id/revision/optional sha256 selections; omission selects current editions")
        target.add_argument("--as-of", help="YYYY-MM-DD for the calendar; original ISO timestamp for the Cohort observation cutoff")
        if name == "customer-use-calendar-export":
            target.add_argument("--format", choices=("json", "csv", "ics"), default="json")
            target.add_argument("--output", required=True)
        if name == "customer-use-calendar-cohort":
            target.add_argument("--group", required=True, help="Original window group ID returned by customer-use-calendar")
            target.add_argument("--inputs-only", action="store_true", help="Output native inputs directly for original cohort-preview/prepare")
    target = command("customer-use-calendar-expand", "Expand explicit working dates into an editable complete Installation document", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--document", required=True, help="Complete editable Installation JSON")
    target.add_argument("--pattern", required=True, help="Explicit task/buyer/weekday/include/exclude date expansion JSON")
    target.add_argument("--document-only", action="store_true", help="Output the complete Installation document directly for original preview/save")
    target = command("cohort-seed", "Open the original proposed 7/14-day acceptance rule and explicit input", case=True, output=True)
    target.add_argument("--tranche", type=int, choices=(2, 3), required=True)
    target.add_argument("--expected-version", type=int, required=True)
    for verb in ("cohort-preview", "cohort-prepare"):
        target = command(verb, "Review or freeze the original intent cohort and retained source coverage", case=True, output=True)
        target.add_argument("--inputs", required=True, help="Explicit reviewed cohort inputs JSON")
        if verb == "cohort-prepare":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    target = command("cohort-export", "Export the complete frozen cohort and its original sources", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)
    target = command("delivery-queue", "Read current Installation work, assignments and civil-calendar due dates", case=True, output=True)
    target.add_argument("--as-of", help="Complete YYYY-MM-DD calendar date; defaults to the current UTC date")
    target = command("delivery-queue-export", "Export the dated delivery report and complete original operating case", case=True)
    target.add_argument("--as-of", help="Complete YYYY-MM-DD calendar date; defaults to the current UTC date")
    target.add_argument("--output", required=True)
    command("installations", "List current saved customer installation editions", case=True, output=True)
    target = command("installation-seed", "Prepare a complete installation from the original funded work packages", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    for verb in ("installation-commercial", "installation-commercial-seed"):
        target = command(verb, "Read accepted SF74 quotations or prepare their complete Customer Installation", case=True, output=True)
        target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--source", required=True, help="Complete original Merchant Support workspace or handoff source ID")
        target.add_argument("--expected-source-sha256", required=True)
        if verb == "installation-commercial-seed":
            target.add_argument("--quote", required=True)
            target.add_argument("--quote-sha256", required=True)
            target.add_argument("--acceptance", required=True, help="Original recorded current customer acceptance UUID")
            target.add_argument("--acceptance-sha256", required=True)
            target.add_argument("--installation", help="Current Installation; omit to prepare a new one")
            target.add_argument("--expected-revision", type=int, required=True)
            target.add_argument("--document", help="Complete original editable Installation JSON")
            target.add_argument("--resolutions", help="JSON object mapping reviewed conflicting fields to accepted or current")
    for verb in ("installation-workshares", "installation-workshare-seed"):
        target = command(verb, "Read or receive complete original commercial Workshares from retained case sources", case=True, output=True)
        target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--source", required=True, help="Original attached commissioning source ID")
        target.add_argument("--expected-source-sha256", required=True)
        target.add_argument("--packet-source", help="Original attached matching receiving packet source ID")
        target.add_argument("--expected-packet-sha256")
        if verb == "installation-workshare-seed":
            target.add_argument("--workshare-case", required=True, help="Original commercial case ID from installation-workshares")
            target.add_argument("--installation", help="Original installation ID; omit for a new installation")
            target.add_argument("--expected-revision", type=int, required=True)
            target.add_argument("--document", help="Optional complete current editable installation JSON")
    for verb in ("installation-workflows", "installation-workflow-seed"):
        target = command(verb, "Read or receive complete original customer operating periods", case=True, output=True)
        target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--source", required=True, help="Original attached recurring-work source ZIP")
        target.add_argument("--expected-source-sha256", required=True)
        if verb == "installation-workflow-seed":
            target.add_argument("--cycle", action="append", required=True, help="Original selected cycle ID; repeat for every selected period")
            target.add_argument("--installation", help="Original Installation ID; omit for a new Installation")
            target.add_argument("--expected-revision", type=int, required=True)
            target.add_argument("--document", help="Optional complete current editable Installation JSON")
    for verb in ("installation-commissioning-seed", "installation-commissioning-review"):
        target = command(verb, "Prepare exact customer cycle, priced-unit and output decisions in the original Installation draft", case=True, output=True)
        target.add_argument("--document", required=True, help="Complete original editable Installation JSON")
        target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--installation", help="Original Installation ID; omit for a new Installation")
        target.add_argument("--expected-revision", type=int, required=True)
        target.add_argument("--document-only", action="store_true", help="Return the full document for original preview/save")
        if verb == "installation-commissioning-review":
            target.add_argument("--reviews", required=True, help="Explicit review rows with kind, id, state, expectedBasisSha256 and note")
            target.add_argument("--actor", required=True)
            target.add_argument("--observed-at", required=True, help="Original recorded review timestamp with timezone")
    target = command("installation-effort-seed", "Prepare original phase effort, recorded Work and support allowances", case=True, output=True)
    target.add_argument("--installation", required=True, help="Original current saved Installation ID")
    target.add_argument("--expected-revision", type=int, required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--as-of", required=True, help="Selected effort review date, YYYY-MM-DD")
    target.add_argument("--document", help="Optional complete editable Installation JSON")
    target = command("installation-effort-selection", "Open original Forecast inputs from saved reviewed phase remainders", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--forecast", required=True)
    target.add_argument("--installation-selections", required=True, help="JSON array of exact saved Installation editions and matching original task IDs")
    target.add_argument("--name")
    target.add_argument("--note")
    target = command("installation-show", "Reopen one whole saved installation and its selected original records", case=True, output=True)
    target.add_argument("--installation", required=True)
    target.add_argument("--revision", type=int, help="Exact saved edition; omission opens the latest")
    target = command("installation-history", "Page the original saved installation editions", case=True, output=True)
    target.add_argument("--installation", required=True)
    target.add_argument("--before", type=int)
    target.add_argument("--limit", type=int, default=25)
    for verb in ("installation-preview", "installation-save"):
        target = command(verb, "Review or save one complete customer installation edition", case=True, output=True)
        target.add_argument("--document", required=True, help="UTF-8 JSON installation document from seed or an edited saved edition")
        target.add_argument("--installation", help="Original installation ID; omit for the first edition")
        target.add_argument("--expected-revision", type=int, required=True, help="Zero for a new installation; current saved edition otherwise")
        target.add_argument("--return-review", help="Original staged owner review ID, paired with --return-review-sha256")
        target.add_argument("--return-review-sha256", help="Exact staged owner review digest")
        if verb == "installation-save":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    target = command("installation-export", "Export the selected edition, readable handover and entire original operating case", case=True)
    target.add_argument("--installation", required=True)
    target.add_argument("--revision", type=int, required=True)
    target.add_argument("--output", required=True)
    target = command("completion-calendar", "Read payment-derived completion clocks and original award dates", case=True, output=True)
    target.add_argument("--as-of", help="Explicit YYYY-MM-DD calendar date; defaults to current UTC date")
    target = command("delivery-calendar", "Read the original grant deadlines and complete delivery agenda", case=True, output=True)
    target.add_argument("--as-of", help="Complete YYYY-MM-DD calendar date; defaults to current UTC date")
    target.add_argument("--expected-version", type=int, help="Require the selected original case version")
    target = command("delivery-calendar-export", "Export the complete grant delivery calendar as ICS, CSV or JSON", case=True)
    target.add_argument("--as-of", help="Complete YYYY-MM-DD calendar date; defaults to current UTC date")
    target.add_argument("--format", dest="calendar_format", choices=("ics", "csv", "json"), default="ics")
    target.add_argument("--expected-version", type=int, help="Require the selected original case version")
    target.add_argument("--output", required=True, help="New destination for the complete calendar file")
    target = command("completion-corrections-seed", "Continue an actual changes-requested issuer outcome in its original correction round", case=True, output=True)
    target.add_argument("--outcome", required=True, help="Original changes-requested completion outcome ID")
    target.add_argument("--review", help="Saved correction edition to continue; retain its round and prior review")
    target.add_argument("--expected-version", type=int, required=True)
    for verb in ("preview", "save"):
        target = command("completion-corrections-" + verb, "Review or save the complete original correction inputs", case=True, output=True)
        target.add_argument("--inputs", required=True, help="Complete correction inputs JSON, retaining all findings and source identities")
        if verb == "save":
            mutation(target, version=True)
            target.add_argument("--as-of-date", required=True, help="Exact asOfDate from the reviewed preview")
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
            target.add_argument("--as-of-date", help="Explicit correction review date YYYY-MM-DD")
    target = command("completion-corrections-export", "Export the immutable correction review, full original preparation and source evidence", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)
    target = command("completion-installations", "List current saved Installation checks for the original tranche packages", case=True, output=True)
    target.add_argument("--tranche", type=int, choices=(1, 2, 3), required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target = command("completion-installations-preview", "Compare exact selected Installation evidence with the complete assignment draft without saving", case=True, output=True)
    target.add_argument("--inputs", required=True, help="Complete original completion inputs JSON, including selected Installation editions/checks")
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--as-of-date", help="Actual evidence cutoff in YYYY-MM-DD form")
    target = command("completion-seed", "Open the original tranche assignments without saving", case=True, output=True)
    target.add_argument("--tranche", type=int, choices=(1, 2, 3), required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target = command("completion-preview", "Preview completed deliverables against their actual previous payment", case=True, output=True)
    target.add_argument("--data", required=True, help="JSON with receiptId, asOfDate, summary and optional saved correctionReviewId")
    target.add_argument("--expected-version", type=int, required=True)
    target = command("completion-save", "Save the complete original tranche assignment input", case=True, output=True)
    target.add_argument("--inputs", required=True, help="Original completion-seed inputs JSON, edited by the operator")
    mutation(target, version=True)
    for verb in ("prepare", "extension", "submit", "decision"):
        target = command("completion-" + verb, "Retain the original completion " + verb + " through its case journal", case=True, output=True)
        target.add_argument("--data", required=True, help="Native completion action data JSON")
        mutation(target, version=True)
    target = command("completion-export", "Download the frozen form preparation and its exact selected sources", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)
    for verb in ("statement-inspect", "statement-preview", "statement-receive"):
        target = command(verb, "Inspect original bank accounts, reconcile a statement or receive its reviewed cash observations", case=True, output=True)
        target.add_argument("--inputs", required=True, help="Complete statement inputs JSON, with source metadata when --file supplies the original bytes")
        target.add_argument("--file", help="Original CSV, OFX / QFX or MT940 file; exact bytes join the declared source metadata")
        if verb == "statement-receive":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    command("engagements", "List complete sourced contributor agreement editions and native receivings", case=True, output=True)
    target = command("engagement-seed", "Open a complete agreement draft or sourced successor of a saved edition", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--review", help="Original engagement review ID; omit for the native initial seed")
    target = command("engagement-show", "Reopen the full saved agreement edition, source, report and receiving history", case=True, output=True)
    target.add_argument("--review", required=True)
    for verb in ("engagement-preview", "engagement-prepare"):
        target = command(verb, "Review or retain the complete named agreement document and actual acceptance states", case=True, output=True)
        target.add_argument("--document", required=True, help="Complete engagement document JSON from the original seed or saved edition")
        if verb == "engagement-prepare":
            mutation(target, version=True, note_required=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    for verb in ("engagement-forecast", "engagement-portfolio"):
        target = command(verb, "Review a complete native agreement allocation into the original Forecast or Portfolio", case=True, output=True)
        target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--selection", required=True, help="Complete original handover selection JSON, retaining all selected agreement and source IDs")
    target = command("engagement-receiving", "Retain the validated original agreement, saved Forecast and saved Portfolio join", case=True, output=True)
    mutation(target, version=True, note_required=True)
    target.add_argument("--data", required=True, help="Exact review/hash, saved Forecast/Portfolio IDs and both normalized original selections")
    target = command("engagement-export", "Export the selected agreement edition, readable report and whole original case with all sources", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True)
    target = command("forecast-compare", "Compare two complete saved forecast editions and their original case", case=True, output=True)
    target.add_argument("--before", required=True, help="Original before forecast ID")
    target.add_argument("--after", required=True, help="Original after forecast ID")
    target.add_argument("--expected-comparison-sha256")
    target.add_argument("--format", choices=("json", "html", "changes-csv", "impact-csv", "daily-csv", "work-csv", "zip"), default="json")
    target = command("forecast-preview", "Calculate a dated forecast from current original records", case=True, output=True)
    target.add_argument("--inputs", required=True, help="Forecast input JSON file")
    target.add_argument("--expected-version", type=int, required=True)
    target = command("forecast-save", "Save exactly the reviewed forecast and its original source snapshot", case=True, output=True)
    mutation(target, version=True)
    target.add_argument("--inputs", required=True, help="Same forecast input JSON used for preview")
    target.add_argument("--expected-preview-sha256", required=True)
    command("forecasts", "List immutable saved forecasts", case=True, output=True)
    target = command("forecast-show", "Reopen the complete original saved forecast", case=True, output=True)
    target.add_argument("--forecast", required=True)
    target = command("forecast-export", "Download the complete saved forecast and dated cash/work CSVs", case=True)
    target.add_argument("--forecast", required=True)
    target.add_argument("--output", required=True)
    target = command("portfolio-seed", "Prepare allocation inputs from one original saved forecast", case=True, output=True)
    target.add_argument("--forecast", required=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--installation-selections", help="JSON array of exact saved installation editions for original commercial task IDs")
    target.add_argument("--inputs", help="Complete existing Portfolio draft JSON to retain while selecting installation phases")
    for verb in ("portfolio-preview", "portfolio-save"):
        target = command(verb, "Calculate or retain source-bound delivery alternatives", case=True, output=True)
        target.add_argument("--inputs", required=True)
        if verb == "portfolio-save":
            mutation(target, version=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    command("portfolios", "List retained delivery allocations", case=True, output=True)
    for verb in ("portfolio-show", "portfolio-export", "portfolio-selection"):
        target = command(verb, "Reopen, export or select an original saved allocation", case=True, output=verb != "portfolio-export")
        target.add_argument("--portfolio", required=True)
        if verb == "portfolio-export":
            target.add_argument("--output", required=True)
        if verb == "portfolio-selection":
            target.add_argument("--alternative", required=True)
            target.add_argument("--expected-version", type=int, required=True)
    target = command("intake", "Import a supplied original pre-award source packet without inferring receipts")
    selection(target); mutation(target)
    target.add_argument("--file", required=True)

    award_terms_cli.register(command, mutation)
    commercial_cli.register(command)
    expense_billing_cli.register(command)
    work_billing_cli.register(command)
    installation_returns_cli.register(command, mutation)
    company_returns_cli.register(command, mutation)

def read_bytes(filename, maximum=MAX_BUNDLE):
    path = Path(filename).expanduser().resolve()
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise Problem("Input exceeds its retained-source bound.", 413, "INPUT_TOO_LARGE")
    return raw


def reconciliation_document(filename, case_id, mode):
    """Receive the complete original input and preserve every pending request field."""
    try:
        document = json.loads(read_bytes(filename, 64 * 1024 * 1024))
    except (UnicodeError, ValueError) as exc:
        raise Problem("Use a complete UTF-8 reconciliation input or downloaded desk.", 422, "INVALID_RECONCILIATION_INPUT") from exc
    if not isinstance(document, dict):
        raise Problem("Use the complete reconciliation input object.", 422, "INVALID_RECONCILIATION_INPUT")
    if document.get("schema") == "stellar-forge.sf47-account-reconciliation-desk.v1":
        if document.get("caseId") != case_id:
            raise Problem("Open this reconciliation desk in its original case.", 409, "RECONCILIATION_DESK_CASE_MISMATCH")
        pending = document.get("pending")
        if mode == "resume" or pending is not None:
            if (not isinstance(pending, dict) or pending.get("caseId") != case_id
                    or pending.get("kind") != "account-reconciliation"
                    or not isinstance(pending.get("body"), dict)
                    or not isinstance(pending["body"].get("requestId"), str)
                    or not pending["body"]["requestId"]):
                raise Problem("Retain the complete original pending reconciliation request.", 422, "INVALID_RECONCILIATION_INPUT")
            document = dict(pending["body"])
        else:
            draft = document.get("draft")
            if not isinstance(draft, dict) or not isinstance(draft.get("document"), dict):
                raise Problem("The downloaded desk needs its complete editable reconciliation document.", 422, "INVALID_RECONCILIATION_INPUT")
            document = {"expectedVersion": document.get("caseVersion"),
                        "reconciliationId": draft.get("reconciliationId"),
                        "expectedRevision": draft.get("expectedRevision"), "state": draft.get("state"),
                        "document": draft["document"]}
    elif mode == "resume":
        raise Problem("Resume from the complete original downloaded reconciliation desk.", 422, "INVALID_RECONCILIATION_INPUT")
    if mode == "preview":
        document = {key: value for key, value in document.items()
                    if key not in ("requestId", "actor", "expectedPreviewSha256")}
    return document


def reconciliation_fields(document, args, applying=False):
    body = dict(document)
    supplied = [("expectedVersion", args.expected_version)]
    if applying:
        supplied += [("actor", args.actor), ("requestId", args.request_id),
                     ("expectedPreviewSha256", args.expected_preview_sha256)]
    for key, value in supplied:
        if value is None:
            continue
        if key in body and body[key] is not None and body[key] != value:
            raise Problem("The supplied " + key + " differs from the retained original reconciliation request.",
                          409, "RECONCILIATION_REQUEST_MISMATCH")
        body[key] = value
    return body


def cash_document(filename, case_id, mode):
    """Keep complete original requests while allowing a downloaded desk to resume."""
    try:
        document = json.loads(read_bytes(filename, 64 * 1024 * 1024))
    except (UnicodeError, ValueError) as exc:
        raise Problem("Use a complete UTF-8 JSON cash input or downloaded desk.", 422, "INVALID_CASH_INPUT") from exc
    if not isinstance(document, dict):
        raise Problem("Use a complete cash input object.", 422, "INVALID_CASH_INPUT")
    is_desk = document.get("schema") == "stellar-forge.sf47-cash-desk.v1"
    if is_desk:
        if document.get("caseId") != case_id:
            raise Problem("The cash desk belongs to another original case.", 409, "CASH_DESK_CASE_MISMATCH")
        pending = document.get("pending")
        if mode == "resume" or (mode == "apply" and pending is not None):
            if not isinstance(pending, dict) or pending.get("kind") not in ("command", "correction") or not isinstance(pending.get("body"), dict):
                raise Problem("The desk must contain its complete pending original request.", 422, "INVALID_CASH_INPUT")
            body = pending["body"]
            if mode == "apply" and pending["kind"] != "correction":
                raise Problem("Use cash-desk-resume for the retained original cash or source command.", 422, "INVALID_CASH_INPUT")
            if pending["kind"] == "command" and body.get("action") not in ("cash.record", "cash.void", "source.add"):
                raise Problem("Resume only the desk's original cash or source action.", 422, "INVALID_CASH_INPUT")
            if not isinstance(body.get("requestId"), str) or not body["requestId"]:
                raise Problem("Retain the original pending request ID.", 422, "INVALID_CASH_INPUT")
            return pending["kind"], body
        draft = document.get("draft")
        if not isinstance(draft, dict) or draft.get("kind") != "correction":
            raise Problem("The downloaded desk needs its complete editable correction.", 422, "INVALID_CASH_INPUT")
        document = {"expectedVersion": draft.get("expectedVersion"), "selection": draft.get("selection"),
                    "originalCashId": draft.get("originalCashId"), "replacement": draft.get("data"),
                    "reason": draft.get("reason", "")}
    elif mode == "resume":
        raise Problem("Resume from a complete downloaded cash desk.", 422, "INVALID_CASH_INPUT")
    if mode == "preview":
        document = {key: value for key, value in document.items()
                    if key not in ("requestId", "actor", "expectedPreviewSha256")}
    return "correction", document


def cash_apply_fields(document, args):
    body = dict(document)
    for key, value in (("actor", args.actor), ("requestId", args.request_id),
                       ("expectedPreviewSha256", args.expected_preview_sha256)):
        if value is None:
            continue
        if key in body and body[key] != value:
            raise Problem("The supplied " + key + " differs from the retained original correction.", 409, "CASH_REQUEST_MISMATCH")
        body[key] = value
    return body


def ledger_document(filename, compile_sources=False):
    original = Path(filename).expanduser().resolve()
    document = ledger_intake._json(read_bytes(original, 64 * 1024 * 1024), decimal_strings=False)
    raw_defaults = {}
    if isinstance(document, dict) and document.get("schema") == "stellar-forge.sf47-ledger-desk.v1":
        raw_defaults = document.get("rawDefaults", {})
        document = document.get("document")
        if not isinstance(raw_defaults, dict):
            raise Problem("The downloaded desk defaults must be an object.", 422, "INVALID_LEDGER_INTAKE")
    if not isinstance(document, dict) or document.get("schema") != ledger_intake.SCHEMA:
        raise Problem("Use a complete ledger-intake document or downloaded browser desk.", 422, "INVALID_LEDGER_INTAKE")
    files = document.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= ledger_intake.MAX_FILES:
        raise Problem("Select one through twenty original source files.", 422, "INVALID_LEDGER_INTAKE")
    total = 0
    for spec in files:
        if not isinstance(spec, dict):
            raise Problem("Each source file needs its explicit table specification.", 422, "INVALID_LEDGER_INTAKE")
        if "sourceFile" in spec:
            if not compile_sources:
                raise Problem("Compile sourceFile paths with ledger-intake-build before preview or apply.", 422, "INVALID_LEDGER_INTAKE")
            selected = spec.pop("sourceFile")
            if not isinstance(selected, str) or not selected or "\x00" in selected or "contentBase64" in spec:
                raise Problem("Choose one explicit sourceFile path or original contentBase64 for each file.", 422, "INVALID_LEDGER_INTAKE")
            source = Path(selected).expanduser()
            if not source.is_absolute():
                source = original.parent / source
            raw = read_bytes(source, MAX_SOURCE)
            spec.setdefault("filename", source.name)
            spec["contentBase64"] = base64.b64encode(raw).decode()
        if spec.get("id") in raw_defaults:
            selected = raw_defaults[spec["id"]]
            if not isinstance(selected, str):
                raise Problem("Retained table defaults must be JSON text.", 422, "INVALID_LEDGER_INTAKE")
            spec["defaults"] = ledger_intake._json(selected or "{}", decimal_strings=False)
        if compile_sources:
            inspection = ledger_intake.inspect(spec)
            total += inspection["bytes"]
    if total > ledger_intake.MAX_BYTES or len(canonical(document).encode()) > MAX_BUNDLE:
        raise Problem("The complete intake supports twelve MiB of original source bytes.", 413, "LEDGER_INTAKE_LIMIT")
    return document


def publish(filename, raw):
    """Private exact output; an existing destination is never replaced."""
    destination = Path(filename).expanduser().absolute()
    if not destination.parent.is_dir():
        raise Problem("Output directory does not exist.", 422, "OUTPUT_DIRECTORY_MISSING")
    fd, temporary = tempfile.mkstemp(prefix="." + destination.name + ".", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError as exc:
            raise Problem("Output already exists; select a new filename.", 409, "OUTPUT_EXISTS") from exc
        descriptor = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"path": str(destination), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def operate(workspace, args):
    ops, action = Operations(workspace), args.operation
    if supplier_statements_cli.operates(action):
        return supplier_statements_cli.operate(ops, args, read_bytes, publish)
    if workbook_cli.operates(action):
        return workbook_cli.operate(ops, args, read_bytes, publish)
    if mapping_cli.operates(action):
        return mapping_cli.operate(ops, args, read_bytes, publish)
    if editions_cli.operates(action):
        return editions_cli.operate(ops, args, read_bytes, publish)
    if risks_cli.operates(action):
        return risks_cli.operate(ops, args, read_bytes, publish)
    if agenda_cli.operates(action):
        return agenda_cli.operate(ops, args, publish)
    if action == "cost-funding" or action.startswith("funding-"):
        return funding_cli.operate(ops, args, read_bytes, publish)
    if award_terms_cli.operates(action):
        return award_terms_cli.operate(ops, args, read_bytes, publish)
    if action.startswith("installation-company-return-"):
        return company_returns_cli.operate(ops, args, read_bytes, publish)
    if action == "installation-returns" or action.startswith("installation-return-"):
        return installation_returns_cli.operate(ops, args, read_bytes, publish)
    if action.startswith("work-billing-"):
        return work_billing_cli.operate(ops, args, read_bytes, publish)
    if action.startswith("expense-billing-"):
        return expense_billing_cli.operate(ops, args, read_bytes, publish)
    if action.startswith("commercial-"):
        return commercial_cli.operate(ops, args, read_bytes, publish)
    if action == "list":
        result = {"cases": ops.list(args.plan)}
    elif action in ("show", "report"):
        result = ops.read(args.case) if action == "show" else ops.report(args.case)
    elif action == "operating-workflows":
        result = ops.operating_workflows(args.case, args.version)
    elif action == "task-outcomes":
        result = {"comparisons": ops.list_task_outcomes(args.case)}
    elif action == "task-outcomes-seed":
        result = ops.seed_task_outcomes(args.case, {"expectedVersion": args.expected_version})["inputs"]
    elif action == "task-outcomes-show":
        result = ops.task_outcomes(args.case, args.comparison, args.revision)
        if args.inputs_only:
            result = {"id": result["edition"]["id"], "expectedRevision": result["history"][0]["revision"],
                      "document": result["edition"]["document"]}
    elif action in ("task-outcomes-preview", "task-outcomes-save"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use the complete UTF-8 customer comparison inputs.", 422, "INVALID_TASK_OUTCOMES") from exc
        if action == "task-outcomes-preview":
            result = ops.preview_task_outcomes(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"action": "task-outcomes.save", "expectedVersion": args.expected_version,
                "actor": args.actor, "note": args.note, "requestId": args.request_id,
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "task-outcomes-export":
        return {"caseId": args.case, "output": publish(args.output, ops.export_task_outcomes(
            args.case, args.comparison, args.revision, args.expected_version))}
    elif action == "supplier-account":
        result = ops.supplier_account(args.case, args.contributor, args.start_date, args.end_date, args.expected_version)
    elif action == "supplier-account-export":
        return {"caseId": args.case, "output": publish(args.output, ops.export_supplier_account(
            args.case, args.contributor, args.start_date, args.end_date, args.expected_version, args.expected_report_sha256))}
    elif action in ("account-reconciliation", "account-reconciliation-export"):
        selected = {"reconciliationId": args.reconciliation, "revision": args.revision}
        if action == "account-reconciliation-export":
            return {"caseId": args.case, "output": publish(args.output, ops.export_account_reconciliation(
                args.case, selected, args.expected_version, args.expected_report_sha256))}
        result = ops.account_reconciliation(args.case, selected, args.expected_version)
    elif action == "account-reconciliation-statement-inputs":
        result = ops.account_reconciliation_statement_inputs(args.case, args.source)
    elif action in ("account-reconciliation-preview", "account-reconciliation-apply", "account-reconciliation-desk-resume"):
        mode = "preview" if action.endswith("-preview") else "apply" if action.endswith("-apply") else "resume"
        body = reconciliation_document(args.input, args.case, mode)
        if mode == "preview":
            result = ops.account_reconciliation_preview(args.case, reconciliation_fields(body, args))
        elif mode == "apply":
            result = ops.account_reconciliation_apply(args.case, reconciliation_fields(body, args, applying=True))
        else:
            result = ops.account_reconciliation_apply(args.case, body)
    elif action in ("cash-account", "cash-account-export"):
        selected = {"startDate": args.start_date, "endDate": args.end_date,
                    "network": args.network, "currency": args.currency, "asset": args.asset}
        if action == "cash-account-export":
            return {"caseId": args.case, "output": publish(args.output, ops.export_cash_account(
                args.case, selected, args.expected_version, args.expected_report_sha256))}
        result = ops.cash_account(args.case, selected, args.expected_version)
    elif action in ("cash-correction-preview", "cash-correction-apply", "cash-desk-resume"):
        mode = "preview" if action.endswith("-preview") else "apply" if action.endswith("-apply") else "resume"
        kind, body = cash_document(args.input, args.case, mode)
        if mode == "preview":
            result = ops.cash_correction_preview(args.case, body)
        elif mode == "apply":
            result = ops.cash_correction_apply(args.case, cash_apply_fields(body, args))
        elif kind == "correction":
            result = ops.cash_correction_apply(args.case, body)
        else:
            result = ops.command(args.case, body)
    elif action == "work-intakes":
        result = {"intakes": ops.list_work_intakes(args.case)}
    elif action == "work-intake-show":
        result = ops.work_intake(args.case, args.intake, args.revision)
    elif action in ("work-intake-upload", "work-intake-preview", "work-intake-save", "work-intake-apply"):
        def intake_json(filename):
            try:
                value = json.loads(read_bytes(filename))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Use a complete UTF-8 JSON intake object.", 422, "INVALID_JSON") from exc
            if not isinstance(value, dict):
                raise Problem("Use a complete intake object.", 422, "INVALID_JSON")
            return value
        if action == "work-intake-upload":
            data = {"name": args.name, "kind": args.kind}
            if args.format:
                data["format"] = intake_json(args.format)
            if args.source:
                data["sourceId"] = args.source
            else:
                data["file"] = {"filename": Path(args.file).name,
                    "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode("ascii"),
                    "mediaType": "text/tab-separated-values" if Path(args.file).suffix.lower() == ".tsv" else "text/csv",
                    "sourceUrl": args.source_url}
                if args.observed_at:
                    data["file"]["observedAt"] = args.observed_at
        else:
            data = {"intakeId": args.intake}
            if args.document:
                data["document"] = intake_json(args.document)
            if action == "work-intake-preview":
                if args.revision is not None:
                    data["revision"] = args.revision
            else:
                data["expectedRevision"] = args.expected_revision
                if args.expected_preview_sha256:
                    data["expectedPreviewSha256"] = args.expected_preview_sha256
        if action == "work-intake-preview":
            result = ops.preview_work_intake(args.case, {"expectedVersion": args.expected_version, **data})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "requestId": args.request_id,
                "actor": args.actor, "note": args.note, "action": action.replace("work-intake-", "work-intake."), "data": data})
    elif action == "amendments":
        result = ops.amendments(args.case)
    elif action == "amendment-show":
        result = ops.amendment(args.case, args.amendment, args.revision)
    elif action == "amendment-preview":
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use complete UTF-8 amendment inputs.", 422, "INVALID_AMENDMENT") from exc
        result = ops.preview_amendment(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
    elif action == "amendment-calendar-export":
        try:
            selection = json.loads(read_bytes(args.selection, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use the original complete calendar export selection.", 422, "INVALID_AMENDMENT_CALENDAR") from exc
        return {"caseId": args.case, "output": publish(args.output, ops.export_amendment_calendar(args.case, selection))}
    elif action == "performance":
        result = ops.performance(args.case, args.start_date, args.end_date, args.expected_version)
    elif action == "performance-export":
        return {"caseId": args.case, "output": publish(args.output, ops.export_performance(
            args.case, args.start_date, args.end_date, args.expected_version, args.expected_report_sha256))}
    elif action == "ledger-intake":
        result = ops.ledger_intake(args.case)
    elif action == "ledger-intake-original":
        result = ops.ledger_intake_original(args.case, args.source)
        if args.document_only:
            result = result["document"]
    elif action == "ledger-intake-template":
        return {"kind": args.kind, "format": args.format,
                "output": publish(args.output, ledger_intake.template(args.kind, args.format).encode())}
    elif action == "ledger-intake-build":
        result = ledger_document(args.input, compile_sources=True)
    elif action == "ledger-intake-preview":
        result = ops.preview_ledger_intake(args.case, {"document": ledger_document(args.input),
            **({"expectedVersion": args.expected_version} if args.expected_version is not None else {})})
    elif action == "ledger-intake-apply":
        result = ops.apply_ledger_intake(args.case, {"document": ledger_document(args.input),
            "expectedVersion": args.expected_version, "expectedPreviewSha256": args.expected_preview_sha256,
            "actor": args.actor, "note": args.note, "requestId": args.request_id})
    elif action == "history":
        result = ops.history(args.case, args.after, args.limit)
    elif action == "forecasts":
        result = {"forecasts": ops.list_forecasts(args.case)}
    elif action == "forecast-show":
        result = ops.forecast(args.case, args.forecast)
    elif action == "forecast-export":
        return {"forecastId": args.forecast, "output": publish(args.output, ops.export_forecast(args.case, args.forecast))}
    elif action in ("statement-inspect", "statement-preview", "statement-receive"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_BUNDLE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Statement inputs must be complete UTF-8 JSON.", 422, "INVALID_STATEMENT") from exc
        if not isinstance(inputs, dict):
            raise Problem("Use one complete statement input object.", 422, "INVALID_STATEMENT")
        if args.file:
            source = inputs.get("source")
            if not isinstance(source, dict):
                raise Problem("Retain source filename, observation time and optional URL in the inputs JSON.", 422, "INVALID_STATEMENT")
            filename = Path(args.file).name
            if source.get("filename", filename) != filename:
                raise Problem("The selected statement filename differs from the declared original source.", 409, "STATEMENT_SOURCE_CONFLICT")
            encoded = base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode("ascii")
            if source.get("contentBase64", encoded) != encoded:
                raise Problem("The selected statement file differs from the retained input bytes.", 409, "STATEMENT_SOURCE_CONFLICT")
            inputs["source"] = {**source, "filename": filename, "contentBase64": encoded}
        if action == "statement-inspect":
            result = ops.inspect_statement(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        elif action == "statement-preview":
            result = ops.preview_statement(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "statement.receive",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "settlements":
        result = ops.settlements(args.case)
    elif action == "settlement-show":
        result = ops.settlement(args.case, args.review)
    elif action == "settlement-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_settlement(args.case, args.review))}
    elif action in ("settlement-preview", "settlement-receive"):
        original = {"filename": Path(args.file).name,
                    "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode("ascii")}
        if bool(args.name is not None) != bool(args.selections is not None):
            raise Problem("Supply the review name and complete selections together.", 422, "INVALID_SETTLEMENT")
        selected = {}
        if args.selections is not None:
            try:
                selections = json.loads(read_bytes(args.selections, MAX_SOURCE))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Settlement selections must be a complete UTF-8 JSON array.", 422, "INVALID_JSON") from exc
            if not isinstance(selections, list):
                raise Problem("Settlement selections must be an array of original row decisions.", 422, "INVALID_SETTLEMENT")
            selected = {"name": args.name, "selections": selections}
        if action == "settlement-preview":
            result = ops.preview_settlement(args.case, {"expectedVersion": args.expected_version, **original, **selected})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "settlement.receive",
                "data": {**original, **selected, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action in ("settlement-correction-preview", "settlement-correct"):
        try:
            correction = json.loads(read_bytes(args.data, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("The settlement correction must be a complete UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if not isinstance(correction, dict) or any(key in correction for key in
                ("expectedVersion", "expectedPreviewSha256", "requestId", "actor", "note", "action")):
            raise Problem("Keep the original correction fields in --data and command metadata in its named options.",
                          422, "INVALID_SETTLEMENT")
        if action == "settlement-correction-preview":
            result = ops.preview_settlement_correction(args.case, {"expectedVersion": args.expected_version, **correction})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "settlement.correct",
                "data": {**correction, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "expenses":
        result = ops.expense_attribution(args.case)
    elif action in ("expense-preview", "expense-receive"):
        original = {"filename": Path(args.file).name,
                    "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode("ascii")}
        if action == "expense-preview":
            result = ops.preview_expense(args.case, {"expectedVersion": args.expected_version, **original})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "expense.receive",
                "data": {**original, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "expense-save":
        try:
            data = json.loads(read_bytes(args.data, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use complete UTF-8 allocation input JSON.", 422, "INVALID_JSON") from exc
        result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
            "requestId": args.request_id, "note": args.note, "action": "expense.save", "data": data})
    elif action in ("expense-review", "expense-reopen", "expense-void"):
        result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
            "requestId": args.request_id, "note": args.note, "action": action.replace("-", "."),
            "data": {"id": args.attribution, "expectedContentSha256": args.expected_content_sha256}})
    elif action == "expense-request":
        try:
            request = json.loads(read_bytes(args.request, 12 * 1024 * 1024))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use the complete original request JSON.", 422, "INVALID_JSON") from exc
        result = ops.expense_request(args.case, request)
    elif action == "expense-export":
        names = {"attributions": "expense-attributions.csv", "sources": "expense-sources.csv",
                 "html": "expense-attribution.html"}
        with workspace.mutex:
            current = ops.read(args.case)
            if current["program"]["version"] != args.expected_version:
                raise Problem("The Operations case changed; read its current expense attribution.", 409, "OPERATIONS_CONFLICT")
            raw = ops.expense_file(args.case, names[args.format])
        return {"caseId": args.case, "version": args.expected_version, "output": publish(args.output, raw)}
    elif action in ("buyer-preview", "buyer-receive"):
        original = {"filename": Path(args.file).name,
                    "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode("ascii")}
        if action == "buyer-preview":
            result = ops.preview_buyer(args.case, {"expectedVersion": args.expected_version, **original})
        else:
            try:
                selections = json.loads(read_bytes(args.selections, MAX_SOURCE))
                deployment = json.loads(read_bytes(args.deployment_file, MAX_SOURCE)) if args.deployment_file else None
            except (UnicodeError, ValueError) as exc:
                raise Problem("Use the original UTF-8 JSON selection and deployment fields.", 422, "INVALID_JSON") from exc
            data = {**original, "expectedPreviewSha256": args.expected_preview_sha256,
                    "deploymentId": args.deployment, "selections": selections}
            if deployment is not None:
                data["deployment"] = deployment
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "buyer.receive", "data": data})
    elif action in ("support-preview", "support-receive"):
        original = {"filename": Path(args.file).name,
                    "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode("ascii")}
        if action == "support-preview":
            result = ops.preview_support(args.case, {"expectedVersion": args.expected_version, **original})
        else:
            data = {**original, "expectedPreviewSha256": args.expected_preview_sha256,
                    "deploymentId": args.deployment}
            if args.deployment_file:
                try:
                    data["deployment"] = json.loads(read_bytes(args.deployment_file, MAX_SOURCE))
                except (UnicodeError, ValueError) as exc:
                    raise Problem("New deployment fields must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "support.receive", "data": data})
    elif action == "implementation-source":
        result = ops.seed_implementation(args.case, {"expectedVersion": args.expected_version,
            "sourceId": args.source, "asOfAt": args.as_of})
    elif action == "implementation-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_implementation(args.case, args.review))}
    elif action == "implementation-original":
        metadata, raw = ops.implementation_original(args.case, args.source, args.sha256)
        return {"original": metadata, "output": publish(args.output, raw)}
    elif action in ("implementation-preview", "implementation-prepare"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Implementation inputs must be a complete UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "implementation-preview":
            result = ops.preview_implementation(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "implementation.prepare",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action.startswith("customer-use-calendar"):
        def calendar_json(filename, maximum=MAX_SOURCE):
            try:
                return json.loads(read_bytes(filename, maximum))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Use complete UTF-8 customer-use selection, pattern or Installation JSON.",
                              422, "INVALID_CUSTOMER_USE_CALENDAR") from exc
        body = {"expectedVersion": args.expected_version}
        if action == "customer-use-calendar-expand":
            from operations_installations import MAX_DOCUMENT_BYTES
            body.update(document=calendar_json(args.document, MAX_DOCUMENT_BYTES), pattern=calendar_json(args.pattern, 131072))
            result = ops.expand_customer_use_calendar(args.case, body)
            if args.document_only:
                result = result["document"]
        else:
            if args.installation_refs:
                body["installationRefs"] = calendar_json(args.installation_refs, 32768)
            if action == "customer-use-calendar-cohort":
                body.update(groupId=args.group, asOfAt=args.as_of)
                result = ops.seed_customer_use_cohort(args.case, body)
                if args.inputs_only:
                    result = result["inputs"]
            else:
                body["asOfDate"] = args.as_of
                if action == "customer-use-calendar-export":
                    return {"caseId": args.case, "format": args.format,
                            "output": publish(args.output, ops.export_customer_use_calendar(args.case, body, args.format))}
                result = ops.customer_use_calendar(args.case, body)
    elif action == "cohort-seed":
        result = ops.seed_cohort(args.case, {"expectedVersion": args.expected_version, "tranche": args.tranche})
    elif action == "cohort-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_cohort(args.case, args.review))}
    elif action in ("cohort-preview", "cohort-prepare"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Cohort inputs must be an original UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "cohort-preview":
            result = ops.preview_cohort(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "cohort.prepare",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "delivery-queue":
        result = ops.delivery_queue(args.case, args.as_of)
    elif action == "delivery-queue-export":
        return {"caseId": args.case, "output": publish(args.output, ops.export_delivery_queue(args.case, args.as_of))}
    elif action == "installations":
        result = {"installations": ops.list_installations(args.case)}
    elif action == "installation-seed":
        result = ops.seed_installation(args.case, {"expectedVersion": args.expected_version})
    elif action in ("installation-commercial", "installation-commercial-seed"):
        selected = {"expectedVersion": args.expected_version, "sourceId": args.source,
                    "expectedSourceSha256": args.expected_source_sha256}
        if action == "installation-commercial":
            result = ops.installation_commercial(args.case, selected)
        else:
            selected.update({"quoteId": args.quote, "quoteSha256": args.quote_sha256,
                             "acceptanceId": args.acceptance, "acceptanceSha256": args.acceptance_sha256,
                             "installationId": args.installation, "expectedRevision": args.expected_revision})
            for argument, field in ((args.document, "document"), (args.resolutions, "resolutions")):
                if argument:
                    from operations_installations import MAX_DOCUMENT_BYTES
                    try:
                        selected[field] = json.loads(read_bytes(argument, MAX_DOCUMENT_BYTES))
                    except (UnicodeError, ValueError) as exc:
                        raise Problem("Use complete UTF-8 Installation input or field choices.", 422, "INVALID_JSON") from exc
            result = ops.seed_commercial_installation(args.case, selected)
    elif action in ("installation-workshares", "installation-workshare-seed"):
        selected = {"expectedVersion": args.expected_version, "sourceId": args.source,
                    "expectedSourceSha256": args.expected_source_sha256,
                    "packetSourceId": args.packet_source, "expectedPacketSha256": args.expected_packet_sha256}
        if action == "installation-workshares":
            result = ops.installation_workshares(args.case, selected)
        else:
            selected.update({"workshareCaseId": args.workshare_case, "installationId": args.installation,
                             "expectedRevision": args.expected_revision})
            if args.document:
                from operations_installations import MAX_DOCUMENT_BYTES
                try:
                    selected["document"] = json.loads(read_bytes(args.document, MAX_DOCUMENT_BYTES))
                except (UnicodeError, ValueError) as exc:
                    raise Problem("Installation input must be a complete UTF-8 JSON document.",
                                  422, "INVALID_JSON") from exc
            result = ops.seed_workshare_installation(args.case, selected)
    elif action in ("installation-workflows", "installation-workflow-seed"):
        selected = {"expectedVersion": args.expected_version, "sourceId": args.source,
                    "expectedSourceSha256": args.expected_source_sha256}
        if action == "installation-workflows":
            result = ops.installation_workflows(args.case, selected)
        else:
            selected.update({"cycleIds": args.cycle, "installationId": args.installation,
                             "expectedRevision": args.expected_revision})
            if args.document:
                from operations_installations import MAX_DOCUMENT_BYTES
                try:
                    selected["document"] = json.loads(read_bytes(args.document, MAX_DOCUMENT_BYTES))
                except (UnicodeError, ValueError) as exc:
                    raise Problem("Use the complete UTF-8 Installation document.", 422, "INVALID_JSON") from exc
            result = ops.seed_workflow_installation(args.case, selected)
    elif action in ("installation-commissioning-seed", "installation-commissioning-review"):
        from operations_installations import MAX_DOCUMENT_BYTES
        try:
            document = json.loads(read_bytes(args.document, MAX_DOCUMENT_BYTES).decode("utf-8"))
            reviews = json.loads(read_bytes(args.reviews, MAX_DOCUMENT_BYTES).decode("utf-8")) if action == "installation-commissioning-review" else None
        except (UnicodeError, ValueError) as exc:
            raise Problem("Supply the complete UTF-8 Installation document and explicit review rows.", 422, "INVALID_JSON") from exc
        selected = {"expectedVersion": args.expected_version, "installationId": args.installation,
                    "expectedRevision": args.expected_revision, "document": document}
        if action == "installation-commissioning-review":
            selected.update({"reviews": reviews, "actor": args.actor, "observedAt": args.observed_at})
            result = ops.review_installation_commissioning(args.case, selected)
        else:
            result = ops.seed_installation_commissioning(args.case, selected)
        if args.document_only:
            result = result["document"]
    elif action == "installation-effort-seed":
        selected = {"expectedVersion": args.expected_version, "installationId": args.installation,
                    "expectedRevision": args.expected_revision, "asOfDate": args.as_of}
        if args.document:
            from operations_installations import MAX_DOCUMENT_BYTES
            try:
                selected["document"] = json.loads(read_bytes(args.document, MAX_DOCUMENT_BYTES))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Use the complete UTF-8 Installation document.", 422, "INVALID_JSON") from exc
        result = ops.seed_installation_effort(args.case, selected)
    elif action == "installation-effort-selection":
        try:
            choices = json.loads(read_bytes(args.installation_selections, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Installation selections must be a UTF-8 JSON array.", 422, "INVALID_JSON") from exc
        if not isinstance(choices, list):
            raise Problem("Installation selections must be a JSON array.", 422, "INVALID_JSON")
        body = {"expectedVersion": args.expected_version, "forecastId": args.forecast,
                "installationSelections": choices}
        for key in ("name", "note"):
            if getattr(args, key) is not None:
                body[key] = getattr(args, key)
        result = ops.select_installation_effort(args.case, body)
    elif action == "installation-show":
        result = ops.installation(args.case, args.installation, args.revision)
    elif action == "installation-history":
        result = ops.installation_history(args.case, args.installation, args.before, args.limit)
    elif action == "installation-export":
        return {"installationId": args.installation, "revision": args.revision,
                "output": publish(args.output, ops.export_installation(args.case, args.installation, args.revision))}
    elif action in ("installation-preview", "installation-save"):
        from operations_installations import MAX_DOCUMENT_BYTES
        try:
            document = json.loads(read_bytes(args.document, MAX_DOCUMENT_BYTES))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Installation input must be a complete UTF-8 JSON document.", 422, "INVALID_JSON") from exc
        selected = {"installationId": args.installation, "expectedRevision": args.expected_revision, "document": document}
        if bool(args.return_review) != bool(args.return_review_sha256):
            raise Problem("Select both the original return review ID and its exact SHA-256.", 422, "INVALID_INSTALLATION_RETURN")
        if args.return_review:
            selected["returnReview"] = {"id": args.return_review, "sha256": args.return_review_sha256}
        if action == "installation-preview":
            result = ops.preview_installation(args.case, {"expectedVersion": args.expected_version, **selected})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "installation.save",
                "data": {**selected, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "completion-calendar":
        result = ops.completion_calendar(args.case, args.as_of)
    elif action == "delivery-calendar":
        result = ops.delivery_calendar(args.case, args.as_of, args.expected_version)
    elif action == "delivery-calendar-export":
        return {"caseId": args.case, "format": args.calendar_format,
                "output": publish(args.output, ops.export_delivery_calendar(
                    args.case, args.as_of, args.calendar_format, args.expected_version))}
    elif action == "completion-corrections-seed":
        body = {"expectedVersion": args.expected_version, "outcomeId": args.outcome}
        if args.review is not None:
            body["reviewId"] = args.review
        result = ops.seed_completion_corrections(args.case, body)
    elif action == "completion-corrections-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_completion_corrections(args.case, args.review))}
    elif action in ("completion-corrections-preview", "completion-corrections-save"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Correction inputs must be a complete UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if not isinstance(inputs, dict):
            raise Problem("Retain the complete original correction inputs object.", 422, "INVALID_JSON")
        if action == "completion-corrections-preview":
            body = {"expectedVersion": args.expected_version, "inputs": inputs}
            if args.as_of_date is not None:
                body["asOfDate"] = args.as_of_date
            result = ops.preview_completion_corrections(args.case, body)
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "completion.corrections.save",
                "data": {"inputs": inputs, "asOfDate": args.as_of_date,
                         "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "completion-installations":
        result = ops.completion_installations(args.case, {"expectedVersion": args.expected_version, "tranche": args.tranche})
    elif action == "completion-installations-preview":
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Completion assignments must be a complete UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if not isinstance(inputs, dict):
            raise Problem("Use the complete original completion assignment object.", 422, "INVALID_COMPLETION")
        body = {"expectedVersion": args.expected_version, "inputs": inputs}
        if args.as_of_date is not None:
            body["asOfDate"] = args.as_of_date
        result = ops.preview_completion_installations(args.case, body)
    elif action == "completion-seed":
        result = ops.seed_completion(args.case, {"expectedVersion": args.expected_version, "tranche": args.tranche})
    elif action == "completion-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_completion(args.case, args.review))}
    elif action.startswith("completion-"):
        filename = args.inputs if action == "completion-save" else args.data
        try:
            data = json.loads(read_bytes(filename, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Completion input must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "completion-preview":
            if not isinstance(data, dict) or "expectedVersion" in data:
                raise Problem("Use only the native completion preview fields in the data file.", 422, "INVALID_COMPLETION")
            result = ops.preview_completion(args.case, {"expectedVersion": args.expected_version, **data})
        else:
            if action == "completion-save":
                data = {"inputs": data}
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": action.replace("-", ".", 1), "data": data})
    elif action == "engagements":
        result = ops.list_engagements(args.case)
    elif action == "engagement-show":
        result = ops.engagement(args.case, args.review)
    elif action == "engagement-seed":
        body = {"expectedVersion": args.expected_version}
        if args.review is not None:
            body["reviewId"] = args.review
        result = ops.seed_engagement(args.case, body)
    elif action == "engagement-export":
        return {"reviewId": args.review, "output": publish(args.output, ops.export_engagement(args.case, args.review))}
    elif action in ("engagement-preview", "engagement-prepare", "engagement-forecast",
                    "engagement-portfolio", "engagement-receiving"):
        filename = (args.document if action in ("engagement-preview", "engagement-prepare") else
                    args.selection if action in ("engagement-forecast", "engagement-portfolio") else args.data)
        try:
            selected = json.loads(read_bytes(filename, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use the complete original UTF-8 engagement document or selection.",
                          422, "INVALID_JSON") from exc
        if not isinstance(selected, dict):
            raise Problem("The original engagement input must be a JSON object.", 422, "INVALID_JSON")
        if action == "engagement-preview":
            result = ops.preview_engagement(args.case, {"expectedVersion": args.expected_version,
                                                       "document": selected})
        elif action == "engagement-forecast":
            result = ops.preview_engagement_forecast(args.case, {"expectedVersion": args.expected_version,
                                                                "selection": selected})
        elif action == "engagement-portfolio":
            result = ops.preview_engagement_portfolio(args.case, {"expectedVersion": args.expected_version,
                                                                 "selection": selected})
        else:
            data = ({"document": selected, "expectedPreviewSha256": args.expected_preview_sha256}
                    if action == "engagement-prepare" else selected)
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note,
                "action": "engagement.prepare" if action == "engagement-prepare" else "engagement.receiving",
                "data": data})
    elif action == "forecast-compare":
        import forecast_comparison
        if args.format == "json" and not args.output:
            result = forecast_comparison.compare(ops, args.case, args.before, args.after, args.expected_comparison_sha256)
        else:
            if not args.output:
                raise Problem("Select a new output file for this comparison format.", 422, "OUTPUT_REQUIRED")
            raw, _mime, _filename = forecast_comparison.output(ops, args.case, args.before, args.after,
                                                             args.format, args.expected_comparison_sha256)
            return {"output": publish(args.output, raw)}
    elif action in ("forecast-preview", "forecast-save"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Forecast input must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "forecast-preview":
            result = ops.preview_forecast(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "forecast.save",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "portfolio-seed":
        body = {"expectedVersion": args.expected_version, "forecastId": args.forecast}
        for filename, field, expected_type in (
            (args.installation_selections, "installationSelections", list),
            (args.inputs, "inputs", dict),
        ):
            if filename is None:
                continue
            try:
                value = json.loads(read_bytes(filename, MAX_SOURCE))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Portfolio " + field + " must be valid JSON.", 422, "INVALID_JSON") from exc
            if not isinstance(value, expected_type):
                kind = "array" if expected_type is list else "object"
                raise Problem("Portfolio " + field + " must be a JSON " + kind + ".", 422, "INVALID_JSON")
            body[field] = value
        result = ops.seed_portfolio(args.case, body)
    elif action == "portfolios":
        result = {"portfolios": ops.list_portfolios(args.case)}
    elif action == "portfolio-show":
        result = ops.portfolio(args.case, args.portfolio)
    elif action == "portfolio-export":
        return {"portfolioId": args.portfolio, "output": publish(args.output, ops.export_portfolio(args.case, args.portfolio))}
    elif action == "portfolio-selection":
        result = ops.select_portfolio(args.case, {"expectedVersion": args.expected_version,
            "portfolioId": args.portfolio, "alternativeId": args.alternative})
    elif action in ("portfolio-preview", "portfolio-save"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Portfolio input must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
        if action == "portfolio-preview":
            result = ops.preview_portfolio(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        else:
            result = ops.command(args.case, {"expectedVersion": args.expected_version, "actor": args.actor,
                "requestId": args.request_id, "note": args.note, "action": "portfolio.save",
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "review":
        result = ops.review(args.case, args.review)
    elif action in ("create", "intake"):
        body = {"planId": args.plan, "selectedRevision": args.selected_revision,
                "expectedContentSha256": args.expected_content_sha256, "name": args.name,
                "calendarStart": args.calendar_start, "actor": args.actor, "requestId": args.request_id}
        if action == "create":
            result = ops.create({**body, "mode": args.mode})
        else:
            from operations_intake import import_source_intake
            result = import_source_intake(ops, read_bytes(args.file, MAX_SOURCE), body)
    elif action == "attach-dcat":
        data = {"filename": Path(args.file).name,
                "contentBase64": base64.b64encode(read_bytes(args.file, dcat_sources.MAX_SOURCE)).decode("ascii"),
                "expectedSha256": args.expected_sha256, "kind": "other", "mediaType": "application/gzip",
                "sourceUrl": args.source_url, "observedAt": args.observed_at}
        result = ops.command(args.case, {"expectedVersion": args.expected_version, "requestId": args.request_id,
            "actor": args.actor, "note": args.note, "action": dcat_sources.ACTION, "data": data})
    elif action in ("command", "attach"):
        if action == "attach":
            data = {"filename": Path(args.file).name, "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode(),
                    "kind": args.kind, "mediaType": args.media_type, "sourceUrl": args.source_url, "observedAt": args.observed_at}
            verb = "source.add"
        else:
            try:
                data = json.loads(read_bytes(args.data))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Action data must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
            verb = args.action
        result = ops.command(args.case, {"expectedVersion": args.expected_version, "requestId": args.request_id,
                                       "actor": args.actor, "note": args.note, "action": verb, "data": data})
    elif action == "source":
        metadata, raw = ops.source(args.case, args.source)
        return {"source": metadata, "output": publish(args.output, raw)}
    elif action == "export":
        with workspace.mutex:
            current = ops.read(args.case)
            if current["program"]["version"] != args.expected_version:
                raise Problem("The operations case changed. Read it before exporting.", 409, "OPERATIONS_CONFLICT")
            raw = ops.export(args.case)
        return {"case": current["program"], "output": publish(args.output, raw)}
    elif action == "import":
        result = ops.import_bundle(read_bytes(args.file, dcat_sources.MAX_BUNDLE), args.name, args.request_id, args.actor)
    else:
        raise Problem("Unknown operations action.", 422, "UNKNOWN_COMMAND")
    if getattr(args, "output", None):
        return {"output": publish(args.output, (canonical(result) + "\n").encode())}
    return result
