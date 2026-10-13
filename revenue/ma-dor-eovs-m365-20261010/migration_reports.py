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
    files.extend(write_case_reports(workspace, directory, source_revision=source_revision))
    files.extend(write_register_reports(workspace, directory, source_revision=source_revision))
    files.extend(write_crf_reports(workspace, directory, source_revision=source_revision))
    review_path = directory / "review.html"
    with PublishedText(review_path) as report:
        report.write("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + cell(title) + "</title><style>" + STYLE + "</style></head><body>")
        report.write("<header><p class=\"subtle\">File migration / Operating handover</p><h1>" + cell(title) + "</h1><p>Workspace <code>" + cell(workspace.project["id"]) + "</code> · Selected revision " + str(source_revision) + "</p></header>")
        if note:
            report.write("<p class=\"note\">" + cell(note) + "</p>")
        report.write("<p>This handover retains original inputs, reviewed mapping editions, migration-round selections and the current correction queue. Field results concern the supplied evidence. Review the selected population and coverage before interpreting a count.</p>")
        report.write("<h2>Case and document migration</h2><p><a href=\"case-review.html\">Open the complete selected case policy, relationships, rehearsals, review decisions and cutover record</a>. All original projections/results are included as complete NDJSON and CSV.</p>")
        report.write("<h2>Register migration</h2><p><a href=\"register-review.html\">Open the complete typed registers, relationship checks, exact financial controls and cutover reviews</a>. Full original rows and findings accompany each selected edition.</p>")
        report.write('<h2>CRF reporting</h2><p><a href="crf-review.html">Open the complete retained reporting editions, findings, comparisons and workbook observations</a>. Every record includes its complete CSV and NDJSON section exports.</p>')
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

CASE_KINDS = ("dataset", "plan", "rehearsal", "review", "cutover")
CASE_PAGE_READS = {"dataset": "case.dataset.rows", "plan": "case.plan.items",
                   "rehearsal": "case.rehearsal.items"}


def case_pages(workspace, operation, payload):
    """Read every original occurrence at one owned revision; reject an incomplete page."""
    from migration_store import MigrationError
    selected_revision = workspace.project["revision"]
    offset, declared, seen = 0, None, set()
    while True:
        result = workspace.dispatch(operation, {**payload, "offset": offset, "limit": PAGE})
        total, records = result.get("total"), result.get("rows")
        if (isinstance(total, bool) or not isinstance(total, int) or total < 0 or
                not isinstance(records, list) or len(records) > PAGE or
                result.get("offset") != offset):
            raise MigrationError("CASE_EXPORT_PAGE", "Original case reader returned an invalid complete page")
        if declared is None:
            declared = total
        if total != declared or offset + len(records) > total:
            raise MigrationError("CASE_EXPORT_PAGE", "Original case population changed during export")
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get("id"), str):
                raise MigrationError("CASE_EXPORT_PAGE", "Original case reader must retain a complete record ID")
            if record["id"] in seen:
                raise MigrationError("CASE_EXPORT_PAGE", "Original case reader repeated a record")
            seen.add(record["id"])
            yield record
        offset += len(records)
        if workspace.project["revision"] != selected_revision:
            raise MigrationError("CASE_EXPORT_REVISION", "Workspace changed during its selected complete export")
        if offset == total:
            return
        if not records:
            raise MigrationError("CASE_EXPORT_PAGE", "Original case reader ended before its complete count")


def case_records(workspace, kind):
    if kind not in CASE_KINDS:
        raise ValueError("Choose an original case entity kind")
    yield from case_pages(workspace, "case.list", {"kind": kind})


def _case_csv_text(value):
    # Complete original JSON remains unchanged in the final column. The other
    # individual text columns are safe to open directly in a spreadsheet.
    value = "" if value is None else str(value)
    if value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        return "'" + value
    return value


def iter_case_export(workspace, kind, entity_id, *, format="ndjson"):
    """Complete selected descriptor plus every original projection/result; no second store."""
    from migration_store import MigrationError, identifier
    if kind not in tuple("case." + item for item in CASE_KINDS):
        raise MigrationError("EXPORT_KIND", "Choose case.dataset, case.plan, case.rehearsal, case.review or case.cutover")
    if format not in ("ndjson", "csv"):
        raise MigrationError("EXPORT_FORMAT", "Choose ndjson or csv")
    identifier(entity_id)
    bare = kind.split(".", 1)[1]
    revision = workspace.project["revision"]
    descriptor = workspace.dispatch(kind + ".get", {"id": entity_id})
    if descriptor.get("id") != entity_id:
        raise MigrationError("CASE_EXPORT_ID", "The selected original entity identity differs")
    def records():
        yield {"schema": "commons.case-migration-export/v1", "type": "selection",
               "workspace_id": workspace.project["id"], "workspace_revision": revision,
               "kind": kind, "entity_id": entity_id, "record": descriptor}
        if bare in CASE_PAGE_READS:
            for row in case_pages(workspace, CASE_PAGE_READS[bare], {"id": entity_id}):
                yield {"schema": "commons.case-migration-export/v1", "type": "record",
                       "kind": kind, "entity_id": entity_id, "record": row}
    if format == "csv":
        output = io.StringIO(newline="")
        csv.writer(output, lineterminator="\r\n", quoting=csv.QUOTE_ALL).writerow(
            ("record_type", "entity_id", "record_id", "kind", "status",
             "key_json", "destinations_json", "complete_original_record_json"))
        yield output.getvalue().encode("utf-8")
    for wrapped in records():
        if format == "ndjson":
            yield (canonical(wrapped) + "\n").encode("utf-8")
        else:
            record = wrapped["record"]
            values = (wrapped["type"], entity_id, record.get("id"), record.get("kind", bare),
                      record.get("status", record.get("decision")),
                      canonical(record.get("key")), canonical(record.get("expected_destinations")),
                      canonical(wrapped))
            output = io.StringIO(newline="")
            csv.writer(output, lineterminator="\r\n", quoting=csv.QUOTE_ALL).writerow(
                [_case_csv_text(value) for value in values[:-1]] + [values[-1]])
            yield output.getvalue().encode("utf-8")
    if workspace.project["revision"] != revision:
        raise MigrationError("CASE_EXPORT_REVISION", "Workspace changed while exporting original case evidence")


def write_case_reports(workspace, directory, *, source_revision):
    """Render the actual selected policy, independent results and all decisions."""
    from migration_store import identifier
    if workspace.project["revision"] != source_revision:
        raise ValueError("Case report must retain the selected original revision")
    files, counts = [], {}
    for kind in CASE_KINDS:
        path = directory / ("case-" + kind + ".ndjson")
        count = 0
        with PublishedText(path) as stream:
            for record in case_records(workspace, kind):
                stream.write(canonical(record) + "\n")
                count += 1
        files.append(path.name)
        counts[kind] = count
    path = directory / "case-review.html"
    with PublishedText(path) as report:
        report.write("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Case migration review</title><style>" + STYLE + "</style></head><body>")
        report.write("<header><p class=\"subtle\">Case and document migration / Original evidence</p><h1>Case migration review</h1><p>Workspace <code>" + cell(workspace.project["id"]) + "</code> · Selected revision " + str(source_revision) + "</p></header>")
        report.write("<p>This report retains the selected case/document relationships, original lifecycle values and explicit cutoff/destination policy. Supplied loader receipts remain separate from independent target inventory. A recorded cutover decision does not send data or confer target-system authority.</p>")
        table_start(report, "Complete selected entity inventory", ("Kind", "Count", "Complete records"))
        for kind in CASE_KINDS:
            table_row(report, (kind, counts[kind], "case-" + kind + ".ndjson"))
        table_end(report)
        for kind in CASE_KINDS:
            report.write("<h2>" + cell(kind.capitalize() + " editions") + "</h2>")
            for record in case_records(workspace, kind):
                entity_id = identifier(record["id"])
                descriptor = workspace.dispatch("case." + kind + ".get", {"id": entity_id})
                report.write("<section><h3>" + cell(descriptor.get("title", entity_id)) + "</h3><p><code>" + cell(entity_id) + "</code></p>")
                if kind == "dataset":
                    report.write("<p>Kind: " + cell(descriptor.get("kind")) + " · Side: " + cell(descriptor.get("side")) + " · Destination: " + cell(descriptor.get("destination")) + " · Original occurrences: " + cell(descriptor.get("row_count")) + " · Interpretation issues: " + cell(descriptor.get("issue_count")) + ".</p>")
                    report.write(json_detail("Complete original source, explicit field selectors and value maps", descriptor))
                elif kind == "plan":
                    report.write(json_detail("Exact selected source editions, cutoff and destination policy", descriptor))
                elif kind == "rehearsal":
                    report.write("<p>Plan <code>" + cell(descriptor.get("plan_id")) + "</code>. Counts retain selected occurrences, including repeated, missing and ambiguous identities.</p>")
                    table_start(report, "Independent target reconciliation results", ("Result", "Occurrences"))
                    for status, count in (descriptor.get("summary") or {}).get("counts", {}).items():
                        table_row(report, (status, count))
                    table_end(report)
                    report.write(json_detail("Full frozen plan, selected target and separate receipt datasets", descriptor))
                elif kind == "review":
                    report.write("<p>Disposition: " + cell(descriptor.get("disposition")) + " · Assigned to: " + cell(descriptor.get("assigned_to")) + ".</p>")
                    report.write(json_detail("Original finding, explicit response and selected evidence", descriptor))
                else:
                    report.write("<p>Recorded decision: " + cell(descriptor.get("decision")) + " · Owner: " + cell(descriptor.get("owner")) + ".</p>")
                    report.write(json_detail("Full window, rollback, task evidence, review selection and unresolved findings", descriptor))
                for extension in ("ndjson", "csv"):
                    target = directory / (entity_id + "." + extension)
                    with PublishedText(target) as output:
                        for chunk in iter_case_export(workspace, "case." + kind, entity_id, format=extension):
                            output.write(chunk.decode("utf-8"))
                    files.append(target.name)
                report.write("<p>Complete original selection and all rows: <a href=\"" + cell(entity_id) + ".ndjson\">NDJSON</a> · <a href=\"" + cell(entity_id) + ".csv\">CSV</a>.</p></section>")
            if not counts[kind]:
                report.write("<p>No " + cell(kind) + " edition has been supplied or recorded. No migration result is inferred.</p>")
        report.write("<h2>Continue the same editable project</h2><p>The portable handover contains the complete original SQLite database and source objects. Open <code>application/CASE_MIGRATION.md</code> for CLI and browser use. Retain earlier source, plan, rehearsal and decision editions; record explicit successors against the actual current revision.</p>")
        report.write("<p><a href=\"review.html\">Original migration review and full evidence inventory</a></p></body></html>\n")
    files.append(path.name)
    if workspace.project["revision"] != source_revision:
        raise ValueError("Case report changed from its selected original revision")
    return files


REGISTER_KINDS = ("dataset", "plan", "rehearsal", "review", "cutover")
REGISTER_PAGE_READS = {"dataset": "register.dataset.rows", "plan": "register.plan.items",
                       "rehearsal": "register.rehearsal.items"}


def register_records(workspace, kind):
    if kind not in REGISTER_KINDS:
        raise ValueError("Choose a retained register entity kind")
    yield from case_pages(workspace, "register.list", {"kind": kind})


def iter_register_export(workspace, kind, entity_id, *, format="ndjson"):
    """Stream the exact full selection and every retained register result under the owner mutex."""
    from migration_store import MigrationError, identifier
    if kind not in tuple("register." + item for item in REGISTER_KINDS):
        raise MigrationError("EXPORT_KIND", "Choose an original register entity")
    if format not in ("ndjson", "csv"):
        raise MigrationError("EXPORT_FORMAT", "Choose ndjson or csv")
    identifier(entity_id)
    bare = kind.split(".", 1)[1]
    revision = workspace.project["revision"]
    descriptor = workspace.dispatch(kind + ".get", {"id": entity_id})
    if descriptor.get("id") != entity_id:
        raise MigrationError("REGISTER_EXPORT_ID", "The selected original register identity differs")

    def records():
        yield {"schema": "commons.register-migration-export/v1", "type": "selection",
               "workspace_id": workspace.project["id"], "workspace_revision": revision,
               "kind": kind, "entity_id": entity_id, "record": descriptor}
        if bare in REGISTER_PAGE_READS:
            for row in case_pages(workspace, REGISTER_PAGE_READS[bare], {"id": entity_id}):
                yield {"schema": "commons.register-migration-export/v1", "type": "record",
                       "kind": kind, "entity_id": entity_id, "record": row}

    if format == "csv":
        output = io.StringIO(newline="")
        csv.writer(output, lineterminator="\r\n", quoting=csv.QUOTE_ALL).writerow(
            ("record_type", "entity_id", "record_id", "finding_kind", "register", "status",
             "key_json", "scope_id", "identity_namespace", "system", "side",
             "complete_original_record_json"))
        yield output.getvalue().encode("utf-8")
    for wrapped in records():
        if format == "ndjson":
            yield (canonical(wrapped) + "\n").encode("utf-8")
        else:
            row = wrapped["record"]
            values = (wrapped["type"], entity_id, row.get("id"), row.get("kind", bare),
                      row.get("register"), row.get("status", row.get("decision", row.get("disposition"))),
                      canonical(row.get("key")), row.get("scope_id", descriptor.get("scope_id")),
                      row.get("identity_namespace", descriptor.get("identity_namespace")),
                      row.get("system"), row.get("side"), canonical(wrapped))
            output = io.StringIO(newline="")
            csv.writer(output, lineterminator="\r\n", quoting=csv.QUOTE_ALL).writerow(
                [_case_csv_text(value) for value in values[:-1]] + [values[-1]])
            yield output.getvalue().encode("utf-8")
    if workspace.project["revision"] != revision:
        raise MigrationError("REGISTER_EXPORT_REVISION", "Workspace changed during the complete original export")


def write_register_reports(workspace, directory, *, source_revision):
    """Capture all register mappings, policies, comparisons and decisions in the original delivery."""
    from migration_store import identifier
    if workspace.project["revision"] != source_revision:
        raise ValueError("Register reports require the selected original revision")
    directory = Path(directory)
    files, counts = [], {}
    for kind in REGISTER_KINDS:
        target = directory / ("register-" + kind + ".ndjson")
        count = 0
        with PublishedText(target) as stream:
            for record in register_records(workspace, kind):
                stream.write(canonical(record) + "\n")
                count += 1
        files.append(target.name)
        counts[kind] = count
    target = directory / "register-review.html"
    with PublishedText(target) as report:
        report.write("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Register migration review</title><style>" + STYLE + "</style></head><body>")
        report.write("<header><p class=\"subtle\">Register migration / Complete operating review</p><h1>Register migration and cutover</h1><p>Workspace <code>" + cell(workspace.project["id"]) + "</code> · Selected revision " + str(source_revision) + "</p></header>")
        report.write("<p>The selected original records, typed mappings, exact identity definitions, source cutoff, independent target observations, relationship rules and unit-separated financial controls travel together. Each full CSV and NDJSON retains its original descriptor and every occurrence or finding. Original source files and the editable database remain in this same delivery.</p>")
        table_start(report, "Complete retained editions", ("Kind", "Count", "Catalogue"))
        for kind in REGISTER_KINDS:
            table_row(report, (kind, counts[kind], "register-" + kind + ".ndjson"))
        table_end(report)
        for kind in REGISTER_KINDS:
            report.write("<h2>" + cell(kind.capitalize() + " editions") + "</h2>")
            for record in register_records(workspace, kind):
                entity_id = identifier(record["id"])
                value = workspace.dispatch("register." + kind + ".get", {"id": entity_id})
                report.write("<section><h3>" + cell(value.get("title", entity_id)) + "</h3><p><code>" + cell(entity_id) + "</code></p>")
                if kind == "dataset":
                    table_start(report, "Original projected register", ("Register", "System / side", "Scope / namespace", "Occurrences", "Interpretation issues"))
                    table_row(report, (value.get("register"), str(value.get("system")) + " / " + str(value.get("side")),
                                       str(value.get("scope_id")) + " / " + str(value.get("identity_namespace")),
                                       value.get("row_count"), value.get("issue_count")))
                    table_end(report)
                elif kind in ("plan", "rehearsal", "cutover"):
                    table_start(report, "Complete finding population", ("Result", "Count"))
                    for status, count in (value.get("summary") or {}).get("counts", {}).items():
                        table_row(report, (status, count))
                    table_end(report)
                    report.write(json_detail("Counts by finding type and complete selected summary", value.get("summary", {})))
                if kind == "review":
                    report.write("<p>Disposition: " + cell(value.get("disposition")) + " · Reason: " + cell(value.get("reason")) + "</p>")
                if kind == "cutover":
                    report.write("<p>Decision: " + cell(value.get("decision")) + " · Acceptance owner: " + cell(value.get("acceptance_owner")) + " · Reason: " + cell(value.get("reason")) + "</p>")
                report.write(json_detail("Complete original edition, source selection and review basis", value))
                for extension in ("ndjson", "csv"):
                    output_path = directory / (entity_id + "." + extension)
                    with PublishedText(output_path) as output:
                        for chunk in iter_register_export(workspace, "register." + kind, entity_id, format=extension):
                            output.write(chunk.decode("utf-8"))
                    files.append(output_path.name)
                report.write("<p>Full selected record and every retained row: <a href=\"" + cell(entity_id) + ".ndjson\">NDJSON</a> · <a href=\"" + cell(entity_id) + ".csv\">CSV</a>.</p></section>")
            if not counts[kind]:
                report.write("<p>No " + cell(kind) + " edition is retained in this selected workspace.</p>")
        report.write("<h2>Continue this register migration</h2><p>Open the mounted Register migration section and follow <code>application/REGISTER_OPERATOR.md</code>. Preserve the original mappings, plans and rehearsals; record explicit reviewed successors against the actual selected revision. Every receiving operator uses the same complete database and original source files.</p>")
        report.write("<p><a href=\"review.html\">Complete migration handover</a> · <a href=\"case-review.html\">Case and document review</a></p></body></html>\n")
    files.append(target.name)
    if workspace.project["revision"] != source_revision:
        raise ValueError("Register report changed from its selected original revision")
    return files


def write_crf_reports(workspace, directory, *, source_revision):
    """Readable CRF handover plus every retained record and every complete section."""
    import crf_workspace as crf
    from migration_store import identifier
    if workspace.project["revision"] != source_revision:
        raise ValueError("CRF report must retain the selected original revision")
    files, counts = [], {}
    for kind in crf.KINDS:
        path = directory / (kind.replace(".", "-") + ".ndjson")
        count = 0
        with PublishedText(path) as output:
            for record in crf.records(workspace, kind):
                output.write(canonical(record) + "\n")
                count += 1
        files.append(path.name)
        counts[kind] = count
    path = directory / "crf-review.html"
    with PublishedText(path) as report:
        report.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CRF reporting handover</title><style>' + STYLE + '</style></head><body>')
        report.write('<header><p class="subtle">Crisis and Resilience Fund / Retained reporting editions</p><h1>CRF reporting handover</h1><p>Workspace <code>' + cell(workspace.project["id"]) + '</code> · Selected revision ' + str(source_revision) + '</p></header>')
        report.write('<p>This report includes every retained contract, original source mapping, reporting edition, comparison, review and workbook record at the selected revision. Annual reporting is cumulative. Earlier editions remain separate history; totals from different editions are not added together.</p>')
        report.write('<p>Computed reporting values and an observed workbook return do not establish whole-workbook compliance, fresh native calculation, Section 151 sign-off, the actual submission email or DWP acceptance. Use the original reviewed source coverage and actual returned workbook observations.</p>')
        table_start(report, "Complete retained record inventory", ("Record kind", "Retained editions", "Complete catalogue"))
        for kind in crf.KINDS:
            table_row(report, (kind, counts[kind], kind.replace(".", "-") + ".ndjson"))
        table_end(report)
        for kind in crf.KINDS:
            report.write("<h2>" + cell(kind.replace("crf.", "").replace("_", " ").capitalize()) + "</h2>")
            for record in crf.records(workspace, kind):
                record_id = identifier(record["id"])
                report.write('<section><h3>' + cell(record["title"]) + '</h3><p><code>' + cell(record_id) + '</code> · Created at revision ' + cell(record["created_revision"]) + '</p>')
                if kind == "crf.edition":
                    summary = record["report"]
                    report.write('<p>Period: ' + cell(record["period"]) + ' · Computation status: ' + cell(summary.get("status")) + ' · Original source rows: ' + cell(summary.get("selected_source_rows")) + '.</p>')
                    table_start(report, "Complete computed metric selection for this edition", ("Metric", "Meaning", "Value", "Status", "Contributing rows"))
                    for metric in crf.rows(workspace, record_id, "metrics"):
                        table_row(report, (metric["id"], metric["label"], metric["value"], metric["status"], metric["source_contributions"]))
                    table_end(report)
                    report.write(json_detail("Finding counts and actual reporting context", summary))
                elif kind == "crf.comparison":
                    report.write(json_detail("Full original comparison selection and occurrence counts", {key: record[key] for key in ("earlier_id", "later_id", "counts")}))
                elif kind == "crf.review":
                    report.write(json_detail("Reviewed edition, exact parent and complete disposition counts", {key: record.get(key) for key in ("edition_id", "parent_id", "statuses", "review")}))
                elif kind in ("crf.workbook_binding", "crf.workbook_output", "crf.workbook_return"):
                    report.write('<p>Use the retained original file identities and full member/cell observations below. A cached formula value is an observation; inspect and recalculate the actual outgoing workbook in its authorised native application.</p>')
                report.write(json_detail("Complete original record and source/evidence identities", record))
                table_start(report, "Retained complete sections", ("Section", "Complete section identity and count"))
                for section, description in record["sections"].items():
                    table_row(report, (section, canonical(description)))
                table_end(report)
                for extension in ("ndjson", "csv"):
                    target = directory / (record_id + "." + extension)
                    with PublishedText(target) as output:
                        for chunk in crf.iter_export(workspace, kind, record_id, extension):
                            output.write(chunk.decode("utf-8"))
                    files.append(target.name)
                report.write('<p>Complete record and every original section: <a href="' + cell(record_id) + '.ndjson">NDJSON</a> · <a href="' + cell(record_id) + '.csv">CSV</a>.</p></section>')
            if not counts[kind]:
                report.write("<p>No " + cell(kind) + " record has been supplied or recorded in this workspace.</p>")
        report.write('<h2>Continue the editable reporting workspace</h2><p>The portable archive retains the original SQLite workspace, source objects, complete application and this report. Follow <code>application/CRF_REPORTING.md</code> to receive it and open <code>/crf</code>. Retain earlier source and review editions; record explicit successors against the current workspace revision.</p>')
        report.write('<p>Before presenting this outgoing product, open this actual report and its complete downloads, inspect the populated and empty views at intended and narrow widths, and reopen the editable delivery.</p><p><a href="review.html">Full workbench handover</a></p></body></html>\n')
    files.append(path.name)
    if workspace.project["revision"] != source_revision:
        raise ValueError("CRF report changed from its selected original revision")
    return files
