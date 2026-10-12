"""Readable migration review and complete record exports at one selected revision."""
from __future__ import annotations

import csv
from html import escape
import io
import json
import os
from pathlib import Path
import uuid

STYLE = """body{font:15px/1.5 system-ui,sans-serif;color:#202124;margin:2rem auto;max-width:1100px;padding:0 1rem}h1{font-size:1.7rem}h2{margin-top:2rem;border-bottom:2px solid #555;padding-bottom:.4rem}h3{margin-top:1.4rem}table{border-collapse:collapse;width:100%;font-size:.9rem;margin:1rem 0}th,td{border:1px solid #bfc4c8;padding:.55rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e7e9ea}pre,code{font-family:ui-monospace,monospace;font-size:.83rem;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f1f2f3;padding:.8rem}a{color:#202124;text-underline-offset:.2em}.note{border-left:3px solid #666;padding:.65rem 1rem;background:#eee}.subtle{color:#565b60}details{margin:.8rem 0}summary{font-weight:600;cursor:pointer}*:focus-visible{outline:3px solid #111;outline-offset:3px}@media print{body{margin:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}details{display:block}}"""
PAGE = 250


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def cell(value):
    return escape("Not supplied" if value is None else str(value))


def json_detail(title, value):
    return "<details><summary>" + cell(title) + "</summary><pre>" + escape(json.dumps(value, ensure_ascii=False, indent=2)) + "</pre></details>\n"


def iter_records(workspace, kind):
    offset = 0
    while True:
        page = workspace.dispatch("entity.list", {"kind": kind, "offset": offset, "limit": PAGE})
        yield from page["rows"]
        offset += len(page["rows"])
        if offset >= page["total"]:
            return
        if not page["rows"]:
            raise ValueError("Original catalogue stopped before its declared complete count")


def table_start(stream, caption, columns):
    stream.write("<table><caption>" + cell(caption) + "</caption><thead><tr>")
    stream.write("".join("<th scope=\"col\">" + cell(v) + "</th>" for v in columns))
    stream.write("</tr></thead><tbody>\n")


def table_row(stream, values):
    stream.write("<tr>" + "".join("<td>" + cell(v) + "</td>" for v in values) + "</tr>\n")


def table_end(stream):
    stream.write("</tbody></table>\n")


class PublishedText:
    """Stream a complete deterministic capture and publish without replacement."""
    def __init__(self, path):
        self.path = Path(path)
        self.temporary = self.path.with_name(self.path.name + ".pending-" + uuid.uuid4().hex)
        self.stream = None

    def __enter__(self):
        self.stream = self.temporary.open("x", encoding="utf-8", newline="")
        return self.stream

    def __exit__(self, kind, value, traceback):
        try:
            if kind is None:
                self.stream.flush()
                os.fsync(self.stream.fileno())
        finally:
            self.stream.close()
        if kind is None:
            from migration_portable import digest, sync_parent, retire_published_duplicate
            try:
                os.link(self.temporary, self.path)
            except FileExistsError:
                if self.path.is_symlink() or digest(self.path) != digest(self.temporary):
                    raise ValueError("Retained report differs from the selected capture")
            sync_parent(self.path)
            retire_published_duplicate(self.temporary, self.path)


def write_record_file(workspace, kind, destination):
    with PublishedText(destination) as stream:
        for record in iter_records(workspace, kind):
            stream.write(canonical(record) + "\n")


def write_findings(workspace, reconciliation, directory):
    identifier = reconciliation["id"]
    # Entity IDs were created by the original engine and are flat; validate before a path use.
    from migration_store import identifier as validate_id
    validate_id(identifier)
    ndjson = directory / (identifier + ".ndjson")
    csv_path = directory / (identifier + ".csv")
    fields = ("reconciliation_id", "item_id", "status", "expected_row_id", "observed_row_id",
              "presence_status", "path_status", "size_status", "hash_status",
              "principals_status", "label_status", "classification_order_status", "record_json")
    with PublishedText(ndjson) as raw, PublishedText(csv_path) as tabular:
        writer = csv.writer(tabular, lineterminator="\n", quoting=csv.QUOTE_ALL)
        writer.writerow(fields)
        offset = 0
        while True:
            page = workspace.dispatch("reconciliation.items", {"id": identifier, "offset": offset, "limit": PAGE})
            for item in page["rows"]:
                encoded = canonical(item)
                raw.write(encoded + "\n")
                checks = item.get("checks", {})
                if isinstance(checks, list):
                    checks = {record.get("field"): record for record in checks}
                states = [(checks.get(field) or {}).get("status", "NOT_SELECTED")
                          for field in ("presence", "path", "size", "hash", "principals", "label", "classification_order")]
                # Only engine-owned flat IDs/statuses are individual CSV values.
                # User-supplied names/paths remain exact JSON in record_json, which
                # begins with '{' and cannot become a spreadsheet formula.
                writer.writerow((identifier, item["id"], item["status"],
                                 item.get("expected_row_id"), item.get("observed_row_id"),
                                 *states, encoded))
            offset += len(page["rows"])
            if offset >= page["total"]:
                break
            if not page["rows"]:
                raise ValueError("Findings stopped before the original declared complete count")
    return [ndjson.name, csv_path.name]


def build_reports(workspace, directory, *, source_revision, title, note):
    """Call under the original owner mutex at the selected live/snapshot revision."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink() or workspace.project["revision"] != source_revision:
        raise ValueError("Report capture must use the selected original workspace revision")
    files = []
    for kind in ("source", "round", "mapping", "evidence_link", "reconciliation", "correction", "workspace_edit"):
        path = directory / (kind + ".ndjson")
        write_record_file(workspace, kind, path)
        files.append(path.name)
    review_path = directory / "review.html"
    with PublishedText(review_path) as report:
        report.write("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + cell(title) + "</title><style>" + STYLE + "</style></head><body>")
        report.write("<header><p class=\"subtle\">File migration / Operating handover</p><h1>" + cell(title) + "</h1><p>Workspace <code>" + cell(workspace.project["id"]) + "</code> · Selected revision " + str(source_revision) + "</p></header>")
        if note:
            report.write("<p class=\"note\">" + cell(note) + "</p>")
        report.write("<p>This handover retains original inputs, reviewed mapping editions, migration-round selections and the current correction queue. Field results concern the supplied evidence. Review the selected population and coverage before interpreting a count.</p>")
        report.write("<h2>Actions and current correction decisions</h2>")
        table_start(report, "Current correction queue at the selected revision", ("Correction", "State", "Owner", "Finding", "Latest review note"))
        count = 0
        for correction in iter_records(workspace, "correction"):
            current = correction.get("current") or correction
            table_row(report, (correction.get("title"), correction.get("status"),
                               current.get("assigned_to") or correction.get("assigned_to") or "Unassigned",
                               correction.get("item_id"), current.get("note") or correction.get("note")))
            count += 1
        table_end(report)
        if not count:
            report.write("<p>No correction decisions have been recorded. This does not establish that every item matches.</p>")
        report.write("<p><a href=\"correction.ndjson\">Complete correction records and retained current/history projection</a>. The included editable database retains the complete event and decision history.</p>")
        report.write("<h2>Reconciliation results and selected evidence</h2>")
        run_count = 0
        for reconciliation in iter_records(workspace, "reconciliation"):
            run_count += 1
            complete = workspace.dispatch("reconciliation.get", {"id": reconciliation["id"]})
            files.extend(write_findings(workspace, complete, directory))
            report.write("<section><h3>" + cell(complete.get("title")) + "</h3><p><code>" + cell(complete["id"]) + "</code></p>")
            configuration = complete.get("configuration", {})
            round_record = complete.get("round_snapshot", {})
            report.write("<p>Scope: " + cell(round_record.get("scope_id")) + " · Round: " + cell(round_record.get("round_label")) + " · Observation basis: " + cell(configuration.get("target_basis")) + "</p>")
            summary = complete.get("summary", {})
            report.write("<p>Selected baseline occurrences: " + cell(summary.get("expected_occurrences")) + " · Selected observations: " + cell(summary.get("observed_occurrences")) + " · Explicitly linked pairs: " + cell(summary.get("linked_pairs")) + ".</p>")
            for key, title_text in (("expected_status_counts", "Selected baseline occurrences by result"),
                                    ("unpaired_observed_status_counts", "Unpaired observation occurrences by result")):
                table_start(report, title_text, ("Result", "Occurrence count"))
                for status, value in summary.get(key, {}).items():
                    table_row(report, (status, value))
                table_end(report)
            table_start(report, "Evidence coverage for each selected field check", ("Field", "Result", "Occurrence count"))
            for field, states in summary.get("field_status_counts", {}).items():
                for status, value in states.items():
                    table_row(report, (field, status, value))
            table_end(report)
            report.write(json_detail("Known quantities and their denominators", summary.get("quantities", {})))
            report.write(json_detail("Exact selected report set, scope and coverage declarations", round_record))
            report.write(json_detail("Identity, principal, status and evidence mapping selection", configuration))
            report.write(json_detail("Result meaning and recorded limitations", {"claim_scope": complete.get("claim_scope"), "limitations": complete.get("limitations")}))
            stem = cell(complete["id"])
            report.write("<p>Complete findings: <a href=\"" + stem + ".csv\">CSV</a> · <a href=\"" + stem + ".ndjson\">NDJSON with exact evidence references</a>.</p></section>")
        if not run_count:
            report.write("<p>No reconciliation has been completed in this workspace.</p>")
        report.write("<h2>Original source inventory</h2>")
        table_start(report, "Declared populations and complete retained artifacts", ("Source", "Role / format", "Scope / round", "Declared / effective coverage", "Original rows / import issues", "Source identity"))
        for source in iter_records(workspace, "source"):
            context = source.get("context", {})
            coverage = context.get("coverage", {})
            table_row(report, (source.get("filename"),
                               str(context.get("role")) + " / " + str(source.get("format")),
                               str(context.get("scope_id")) + " / " + str(context.get("round_label", "Not supplied")),
                               "Declared " + str(coverage.get("mode")) + ": " + str(coverage.get("description")) + "\nEffective " + canonical((source.get("summary") or {}).get("effective_coverage", "Not established")) + "\nCoverage issues " + canonical((source.get("summary") or {}).get("issues", [])),
                               str(source.get("row_count")) + " / " + str(source.get("issue_count")),
                               str(source["id"]) + "\n" + str(source.get("file_sha256"))))
        table_end(report)
        report.write("<p>Original scanned, filtered, expected-to-migrate, packaged, uploaded and migrated report counts keep their original distinct meanings in the retained source rows. Known subtotals are not substituted for an absent complete population.</p>")
        report.write("<h2>Continue this editable project</h2><p>The delivery contains the full application, SQLite workspace and every original file-table object. Follow <code>application/OPERATING_WORKBENCH.md</code> to receive the ZIP into a separate ordinary directory. Start the received application against its workspace, then record the receiving operator's note or correction decision.</p>")
        report.write("<p>The original publication stays immutable. A later edit or new review produces a successor workspace revision and a separately prepared delivery.</p>")
        report.write("<h2>Machine-readable catalogue</h2><ul>")
        for name in files:
            if name.endswith(".ndjson") and not name.startswith("reconciliation-"):
                report.write("<li><a href=\"" + cell(name) + "\">" + cell(name) + "</a></li>")
        report.write("</ul></body></html>\n")
    files.append(review_path.name)
    if workspace.project["revision"] != source_revision:
        raise ValueError("Workspace revision changed during the frozen report capture")
    return sorted(set(files))
