"""Native mapping review, immutable request preparation and complete receiving.

All commands borrow the caller's existing Operations owner. Private input/output
and durable create-only publication use the maintained CLI and edition course.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import html
import io
import json

from model import Problem, canonical, digest
from operations_installation_sources import SourceDesk
from installation_source_desk_client import InstallationSourceDeskClient
import operations_installation_mapping_reconciliation as model
import operations_installation_editions_cli as editions_cli

PREFIX = "source-mapping-"
REPORT = "stellar-forge.installation-mapping-report.v1"


def register(command, mutation):
    for name, description in (
        ("compare", "Compare complete source/current mapping fields and explicit array positions"),
        ("preview", "Resolve every explicit field decision into one complete native successor"),
        ("prepare", "Freeze mapping.apply through the original durable command file"),
        ("execute", "Continue the same original mapping request with exact accepted replay"),
        ("show", "Read complete retained mapping decisions and original revision history"),
        ("export", "Export full original mapping values, decisions and results as JSON, CSV or HTML"),
        ("course-prepare", "Freeze mapping, native Prepare and optional original case attachment"),
        ("course-run", "Continue the complete original mapping and preparation receiving course"),
    ):
        parser = command(PREFIX + name, description, case=True, output=True)
        parser.add_argument("--draft", required=True)
        if name in ("compare", "preview", "export"):
            parser.add_argument("--input", required=True, help="Complete saved native JSON object")
            if name == "export":
                parser.add_argument("--format", choices=("json", "csv", "html"), default="json")
        elif name in ("prepare", "course-prepare"):
            parser.add_argument("--plan", required=True)
            if name == "prepare":
                mutation(parser)
            else:
                parser.add_argument("--request-prefix", required=True)
                parser.add_argument("--actor", required=True)
                parser.add_argument("--note", default="")
                parser.add_argument("--attach-version", type=int)
        elif name == "execute":
            parser.add_argument("--operation-file", required=True)
        elif name == "show":
            parser.add_argument("--revision", type=int)
        elif name == "course-run":
            parser.add_argument("--course", required=True)
            parser.add_argument("--archive-output", required=True)


def operates(action):
    return action.startswith(PREFIX)


def report_document(client, value):
    """Bind an exported report to full original native evidence, not a loose seal."""
    if not isinstance(value, dict):
        raise Problem("Select one complete native mapping comparison, plan or receipt.", 422,
                      "INSTALLATION_MAPPING_INVALID")
    with client.desk.workspace.mutex:
        schema = value.get("schema")
        plan, receipt = None, None
        if schema == model.RECEIPT:
            receipt = deepcopy(value)
            historical = client.read(receipt.get("draftRevision"))
            model.verify_receipt(client.desk, historical, receipt)
            if receipt.get("caseId") != client.case_id or receipt.get("draftId") != client.draft_id:
                raise Problem("Select this original draft's retained reconciliation.", 409,
                              "INSTALLATION_MAPPING_CHANGED")
            plan = receipt["plan"]
        elif schema == model.PLAN:
            plan = deepcopy(value)
            model.verify_plan(client.desk, client.case_id, client.draft_id, plan)
        elif schema != model.COMPARISON:
            raise Problem("Select a native mapping comparison, plan or accepted reconciliation.", 422,
                          "INSTALLATION_MAPPING_INVALID")
        selected = plan or value
        comparison = client.mapping_compare({key: selected[key] for key in
                                             ("source", "target", "expandedArrays")})
        if plan is None and not model.same(comparison, value):
            raise Problem("The complete original comparison changed.", 409, "INSTALLATION_MAPPING_CHANGED")
        result = {"schema": REPORT, "caseId": client.case_id, "draftId": client.draft_id,
                  "comparison": comparison, "plan": plan, "receipt": receipt}
        result["sha256"] = digest(result)
        return result


def export_report(report, format):
    model.editions.unseal(report, REPORT)
    comparison, plan = report["comparison"], report["plan"]
    decisions = {} if plan is None else {row["pointer"]: row for row in plan["decisions"]}
    if format == "json":
        return (canonical(report) + "\n").encode("utf-8")
    safe = lambda s: "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r", "\n") else s
    if format == "csv":
        out = io.StringIO(newline="")
        writer = csv.writer(out, lineterminator="\r\n")
        writer.writerow(("kind", "pointer", "source_present", "source_type", "source_json",
                         "target_present", "target_type", "target_json", "choice",
                         "custom_json", "complete_original_json"))
        writer.writerow(("complete-report", "", "", "", "", "", "", "", "", "", canonical(report)))
        for row in comparison["rows"]:
            choice = decisions.get(row["pointer"])
            writer.writerow(("mapping", safe(row["pointer"]), str(row["sourcePresent"]).lower(),
                             row["sourceType"], canonical(row["source"]), str(row["targetPresent"]).lower(),
                             row["targetType"], canonical(row["target"]), choice["choice"] if choice else "",
                             canonical(choice["value"]) if choice else "", canonical(row)))
        for row in plan["arrayChanges"] if plan else []:
            writer.writerow(("array-positions", safe(row["pointer"]), "", "", "", "", "", "", "", "",
                             canonical(row)))
        return out.getvalue().encode("utf-8")
    if format != "html":
        raise Problem("Choose JSON, CSV or HTML.", 422, "INSTALLATION_MAPPING_INVALID")
    esc = lambda s: html.escape(str(s), quote=True)
    pretty = lambda v: esc(json.dumps(v, ensure_ascii=False, indent=2, sort_keys=True))
    value = lambda present, v: "<pre>" + pretty(v) + "</pre>" if present else "<strong>Absent</strong>"
    body = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Source mapping reconciliation</title>
<style>body{font:16px/1.5 system-ui,sans-serif;color:#242424;background:white;max-width:1200px;margin:0 auto;padding:24px}
h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:10px;text-align:left;vertical-align:top}
.wrap{overflow-x:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:60ch}code{overflow-wrap:anywhere}
details{border:1px solid #ccc;padding:12px;margin:16px 0}@media(max-width:640px){body{padding:12px}.wrap{max-width:100%}table{min-width:660px}}
@media print{body{font-size:11pt;max-width:none}.wrap{overflow:visible}pre{max-width:none}tr{break-inside:avoid}}</style>"""
    body += "<h1>Source mapping reconciliation</h1><p>Original case <code>" + esc(report["caseId"]) + "</code><br>Draft <code>" + esc(report["draftId"]) + "</code></p>"
    for side in ("source", "target"):
        ref = comparison[side]
        body += "<h2>" + side.title() + " edition</h2><p>" + esc(ref["draftId"]) + " · revision " + esc(ref["revision"]) + "<br><code>" + esc(ref["sha256"]) + "</code></p>"
    state = "Accepted editable mapping" if report["receipt"] else "Reviewed preview" if plan else "Original comparison"
    body += "<h2>" + state + "</h2><p>" + str(len(comparison["rows"])) + " complete differing values. Explicit absence is distinct from null. Array positions refer to the unchanged original indices; removals compact only in the final result.</p>"
    body += "<div class=wrap><table><thead><tr><th>Original pointer</th><th>Source</th><th>Target</th><th>Decision</th></tr></thead><tbody>"
    for row in comparison["rows"]:
        decision = decisions.get(row["pointer"])
        displayed = "<pre>" + pretty(decision) + "</pre>" if decision else "Not selected in this comparison"
        body += "<tr><td><code>" + esc(row["pointer"] or "(root)") + "</code></td><td>" + value(row["sourcePresent"], row["source"]) + "</td><td>" + value(row["targetPresent"], row["target"]) + "</td><td>" + displayed + "</td></tr>"
    body += "</tbody></table></div>"
    if plan:
        body += "<h2>Complete resulting mapping</h2><pre>" + pretty(plan["selection"]) + "</pre>"
        body += "<h2>Original native preparation findings</h2><pre>" + pretty(plan["editionPlan"]["findings"]) + "</pre>"
        body += "<h2>Array position changes</h2><pre>" + pretty(plan["arrayChanges"]) + "</pre>"
        body += "<h2>Complete file choices</h2><pre>" + pretty(plan["editionPlan"]["files"]) + "</pre>"
    body += "<p>The accepted mapping remains editable. Run the original native Prepare before treating its profile, source pointers, phases or effort as prepared customer work.</p>"
    body += "<details><summary>Complete original report and retained evidence</summary><pre>" + pretty(report) + "</pre></details></html>\n"
    return body.encode("utf-8")


def operate(ops, args, read_bytes, publish):
    action = args.operation[len(PREFIX):]
    client = InstallationSourceDeskClient(SourceDesk(ops), args.case, args.draft)
    read = lambda path: editions_cli.read_json(read_bytes, path)
    if action == "compare":
        result = client.mapping_compare(read(args.input))
    elif action == "preview":
        result = client.mapping_preview(read(args.input))
    elif action == "prepare":
        result = client.prepare_mapping(read(args.plan), actor=args.actor,
                                        request_id=args.request_id, note=args.note)
    elif action == "execute":
        operation = read(args.operation_file)
        if operation.get("request", {}).get("action") != "mapping.apply":
            raise Problem("Select the original prepared mapping.apply request.", 422,
                          "INSTALLATION_MAPPING_INVALID")
        result = client.execute(operation)
    elif action == "show":
        with client.desk.workspace.mutex:
            draft = client.read(args.revision)
            for receipt in draft.get("mappingReconciliations", []):
                model.verify_receipt(client.desk, client.read(receipt["draftRevision"]), receipt)
            result = {"schema": "stellar-forge.installation-mapping-history.v1",
                      "caseId": args.case, "draftId": args.draft, "revision": draft["revision"],
                      "reconciliations": deepcopy(draft.get("mappingReconciliations", [])), "draft": draft}
    elif action == "export":
        result = report_document(client, read(args.input))
        raw = export_report(result, args.format)
        if args.output:
            return {"output": editions_cli.retain_output(args.output, raw, 96 * 1024 * 1024, publish),
                    "reportSha256": result["sha256"]}
        return result if args.format == "json" else {
            "format": args.format, "content": raw.decode("utf-8"), "reportSha256": result["sha256"]}
    elif action == "course-prepare":
        from installation_source_edition_receiving import prepare_course
        result = prepare_course(client, read(args.plan), request_prefix=args.request_prefix,
                                actor=args.actor, note=args.note, attach_version=args.attach_version,
                                mapping=True)
    elif action == "course-run":
        from installation_source_edition_receiving import MAPPING_COURSE
        # Same original stable read, report/adoption and complete native ZIP path.
        selected = read(args.course)
        if selected.get("schema") != MAPPING_COURSE:
            raise Problem("Select the complete original mapping receiving course.", 422,
                          "INSTALLATION_MAPPING_INVALID")
        return editions_cli.run_course(client, args, publish)
    else:
        raise Problem("Use a declared source mapping command.", 422, "INSTALLATION_MAPPING_INVALID")
    if args.output:
        return {"output": editions_cli.retain_output(args.output, (canonical(result) + "\n").encode("utf-8"),
                                                    96 * 1024 * 1024, publish)}
    return result
