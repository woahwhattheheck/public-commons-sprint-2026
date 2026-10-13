#!/usr/bin/env python3
"""Company reporting and independently receivable handovers for the original SCF programme."""
from __future__ import annotations

import argparse
import contextlib
import copy
import csv
import fcntl
import hashlib
import html
import io
import json
import os
import pathlib
import re
import stat
import sys
import tempfile
import zipfile

SCHEMA = "commons.scf-customer-report-package.v1"
SELECTION_SCHEMA = "commons.scf-three-customer-operator-selection.v1"
RESULT_SCHEMA = "commons.scf-three-customer-operated-project.v1"
SOURCE_FILE = "customer_reporting.py"
GUIDE_FILE = "OPERATING.md"
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_MEMBER = 128 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
SHA = re.compile(r"^[a-f0-9]{64}$")


class ReportError(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise ReportError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def packed(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON property: " + key)
        result[key] = value
    return result


def document(raw, label):
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=no_duplicates,
                          parse_constant=lambda value: (_ for _ in ()).throw(ReportError("Invalid JSON number " + value)))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReportError("Invalid complete JSON: " + label) from exc


def equal(a, b):
    # Preserve JSON type distinctions, including booleans versus numbers.
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(equal(a[key], b[key]) for key in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    return a == b


def safe_name(value):
    require(isinstance(value, str) and value and "\\" not in value and "\x00" not in value,
            "Use a complete POSIX member name.")
    parts = value.split("/")
    require(not value.startswith("/") and all(part not in ("", ".", "..") for part in parts),
            "Unsafe archive member: " + value)
    require(":" not in parts[0], "Unsafe archive member: " + value)
    return value


def hash_value(value, label):
    require(isinstance(value, str) and SHA.fullmatch(value), "Retain the exact SHA-256 for " + label)
    return value


def regular_bytes(path, limit=MAX_ARCHIVE):
    path = pathlib.Path(path)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, "Select a bounded regular file: " + str(path))
        with os.fdopen(os.dup(descriptor), "rb") as handle:
            raw = handle.read(limit + 1)
        after = os.fstat(descriptor)
        require(len(raw) == before.st_size and before.st_size == after.st_size and
                before.st_mtime_ns == after.st_mtime_ns and len(raw) <= limit,
                "Selected file changed during its original read: " + str(path))
        return raw
    finally:
        os.close(descriptor)


class Archive:
    def __init__(self, raw, expected=None):
        require(len(raw) <= MAX_ARCHIVE, "The complete archive exceeds the declared limit.")
        self.raw = raw
        self.sha256 = digest(raw)
        if expected is not None:
            require(self.sha256 == hash_value(expected, "archive"), "The original archive SHA-256 differs.")
        try:
            self.zip = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as exc:
            raise ReportError("Read the complete original ZIP.") from exc
        self.entries = {}
        total = 0
        for row in self.zip.infolist():
            if row.is_dir():
                safe_name(row.filename.rstrip("/"))
                continue
            safe_name(row.filename)
            require(row.filename not in self.entries, "Duplicate ZIP member: " + row.filename)
            require(not row.flag_bits & 1, "Encrypted ZIP members are not supported.")
            mode = row.external_attr >> 16
            require(not stat.S_ISLNK(mode), "Symbolic links are not report members.")
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG), "Select regular ZIP members.")
            require(row.file_size <= MAX_MEMBER, "Oversized member: " + row.filename)
            total += row.file_size
            require(total <= MAX_TOTAL, "The complete member population exceeds the declared limit.")
            self.entries[row.filename] = row

    def read(self, name):
        require(name in self.entries, "Missing complete member: " + name)
        try:
            raw = self.zip.read(self.entries[name])
        except (zipfile.BadZipFile, RuntimeError) as exc:
            raise ReportError("The original ZIP member failed its CRC: " + name) from exc
        require(len(raw) == self.entries[name].file_size, "Incomplete member: " + name)
        return raw

    def json(self, name):
        return document(self.read(name), name)


def csv_bytes(columns, rows):
    # Human-readable values are prefixed when necessary so spreadsheet software
    # does not execute a customer-supplied cell as a formula. Full JSON stays exact.
    def cell(value):
        if value is None:
            return ""
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, allow_nan=False)
        return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([cell(row.get(key)) for key in columns])
    return stream.getvalue().encode("utf-8")


def indexed(rows, key, label):
    require(isinstance(rows, list), "Retain the full " + label + " list.")
    result = {}
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get(key), str) and row[key],
                "The " + label + " identity is missing.")
        require(row[key] not in result, "Duplicate " + label + " identity: " + row[key])
        result[row[key]] = row
    return result


def check_records(doc):
    rows = doc.get("checks")
    indexed(rows, "id", "installation check")
    return rows


def stage_label(value):
    return value if isinstance(value, str) and value else "Not supplied in the original edition"


def company_title(case_id):
    return case_id.split("-")[0].upper()


def reporting_value(binding, doc, selected, sources):
    checks = copy.deepcopy(check_records(doc))
    states = {}
    for row in checks:
        state_value = stage_label(row.get("state"))
        states[state_value] = states.get(state_value, 0) + 1
    commercial = selected.get("commercial")
    require(isinstance(commercial, dict), "The selected original Workshare has no commercial object.")
    return {
        "schema": "commons.scf-customer-report.v1",
        "binding": copy.deepcopy(binding),
        "company": company_title(binding["company_case_id"]),
        "stage": doc.get("stage"),
        "commercial": copy.deepcopy(commercial),
        "hours": copy.deepcopy(selected.get("hours")),
        "phase_count": selected.get("phaseCount"),
        "check_states": states,
        "checks": checks,
        "sources": copy.deepcopy(sources),
        "interpretation": {
            "stage": "The stage is copied from the saved native installation.",
            "observations": "Check states, operators, observation times and notes are original recorded values.",
            "commercial": "The full original Workshare terms are retained; an amount does not establish acceptance, invoicing or payment.",
            "hours": "Hours are the native Workshare selection. The original source files retain the effort basis and counterpart participation distinctions.",
            "receiving": "Report receipt verifies these package bytes and their original bindings. It does not change the native installation."
        }
    }


def report_markdown(report, doc, selected):
    b = report["binding"]
    lines = [
        "# " + report["company"] + " — installation reporting handover",
        "",
        "This report is an exact reporting edition of the saved SCF customer installation.",
        "",
        "- Original commercial case: " + b["company_case_id"],
        "- Installation: " + b["installation_id"] + ", revision " + str(b["revision"]),
        "- Native saved-edition SHA-256: " + b["native_installation_sha256"],
        "- Recorded stage: " + stage_label(report["stage"]),
        "- Source programme: " + b["source_program"]["case_id"] + ", version " + str(b["source_program"]["version"]),
        "- Original plan: " + b["source_program"]["plan_id"],
        "- Workshare plan SHA-256: " + b["workshare_plan_sha256"],
        "- Original browser completion: " + str(b["observed_at"]),
        "",
        "## Original commercial selection",
        "",
        "The commercial object below is copied completely. Its proposed terms and recorded hours retain their original meaning.",
        "",
        "    " + json.dumps({"commercial": report["commercial"], "hours": report["hours"],
                             "phase_count": report["phase_count"]}, ensure_ascii=False, sort_keys=True),
        "",
        "## Saved checks and observations",
        "",
        "Recorded state counts: " + json.dumps(report["check_states"], ensure_ascii=False, sort_keys=True),
        ""
    ]
    for row in report["checks"]:
        lines.extend(["### " + row["id"], "", "Recorded state: " + stage_label(row.get("state")), "",
                      "The complete original check record:", "",
                      *["    " + line for line in json.dumps(row, ensure_ascii=False, indent=2).splitlines()], ""])
    lines.extend(["## Full original installation", "", "The editable original input is installation-input.json.",
                  "Its complete workshare, source, receiving, assignment, check and other retained fields follow.", "",
                  *["    " + line for line in json.dumps(doc, ensure_ascii=False, indent=2).splitlines()], "",
                  "## Full selected Workshare", "",
                  *["    " + line for line in json.dumps(selected, ensure_ascii=False, indent=2).splitlines()], "",
                  "## Complete original customer files", ""])
    for source in report["sources"]:
        lines.extend(["- " + source["role"] + ": " + source["path"] + " — " + str(source["bytes"]) +
                      " bytes / SHA-256 " + source["sha256"]])
    lines.extend(["", "## Receiving and later editions", "",
                  "Use software/customer_reporting.py receive with this ZIP and its exact SHA-256 to reopen all files and verify the original bindings.",
                  "Use compare with two complete reporting ZIPs for the same original commercial case and installation to retain full keyed changes.",
                  "The original SCF programme remains the place to record new implementation observations and save another native installation edition.",
                  "Report generation and receipt do not constitute implementation acceptance or a commercial transaction.", ""])
    return ("\n".join(lines)).encode("utf-8")


def report_html(report, doc, selected, sources):
    esc = lambda value: html.escape(str(value), quote=True)
    def pre(value):
        return "<pre>" + esc(json.dumps(value, ensure_ascii=False, indent=2)) + "</pre>"
    b = report["binding"]
    checks = "".join("<article><h3>" + esc(row["id"]) + "</h3><p>Recorded state: <strong>" +
                     esc(stage_label(row.get("state"))) + "</strong></p>" + pre(row) + "</article>"
                     for row in report["checks"])
    source_sections = []
    for row in sources:
        raw = row["raw"]
        obj = document(raw, row["path"])
        source_sections.append("<details><summary>" + esc(row["role"]) + " · " +
                               esc(row["bytes"]) + " bytes</summary><p><a href=\"" + esc(row["path"]) +
                               "\">Complete original JSON</a></p><p class=\"hash\">" + esc(row["sha256"]) +
                               "</p>" + pre(obj) + "</details>")
    body = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SCF customer installation report</title>
<style>body{font:16px/1.55 system-ui,sans-serif;color:#172638;background:#f4f6f8;margin:0}
main{max-width:1100px;margin:auto;padding:32px}header,section,article,details{background:white;border:1px solid #d6dee7;border-radius:8px;padding:22px;margin:18px 0}
h1,h2,h3{line-height:1.2}nav{display:flex;gap:14px;flex-wrap:wrap}a{color:#075a9c}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f6;padding:14px;font-size:13px}
.hash{overflow-wrap:anywhere;font-family:monospace}dl{display:grid;grid-template-columns:minmax(130px,1fr) 3fr;gap:8px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
@media(max-width:600px){main{padding:12px}header,section,article,details{padding:14px}dl{display:block}dd{margin-bottom:12px}}
@media print{body{background:white}main{max-width:none;padding:0}details{display:block}pre{font-size:10px}a{color:inherit}}
</style><main><header><h1>""" + esc(report["company"]) + """ installation reporting handover</h1>
<p>Complete saved customer scope, recorded checks and original source files.</p><nav>
<a href="#selection">Selection</a><a href="#checks">Checks</a><a href="#installation">Installation</a><a href="#workshare">Workshare</a><a href="#sources">Original files</a>
</nav></header><section id="selection"><h2>Original saved selection</h2><dl>
<dt>Commercial case</dt><dd>""" + esc(b["company_case_id"]) + "</dd><dt>Installation</dt><dd>" + esc(b["installation_id"]) + \
        "</dd><dt>Revision</dt><dd>" + esc(b["revision"]) + "</dd><dt>Recorded stage</dt><dd>" + esc(stage_label(report["stage"])) + \
        "</dd><dt>Native edition SHA-256</dt><dd>" + esc(b["native_installation_sha256"]) + \
        "</dd><dt>Original browser completion</dt><dd>" + esc(b["observed_at"]) + \
        "</dd></dl><h3>Original commercial selection</h3>" + pre({"commercial": report["commercial"], "hours": report["hours"],
                                                               "phase_count": report["phase_count"]}) + \
        "<p>Commercial terms and recorded hours retain their original meaning. Consult the complete source for the effort basis and any separate counterpart participation.</p></section>" + \
        "<section id=\"checks\"><h2>Saved checks and observations</h2>" + pre(report["check_states"]) + checks + \
        "</section><section id=\"installation\"><h2>Complete original installation</h2><p><a href=\"installation-input.json\">Editable saved input</a></p>" + \
        pre(doc) + "</section><section id=\"workshare\"><h2>Complete selected Workshare</h2>" + pre(selected) + \
        "</section><section id=\"sources\"><h2>Complete original customer files</h2>" + "".join(source_sections) + \
        "</section><section><h2>Continue and receive</h2><p>The original SCF programme records later observations and saves the next installation edition. " + \
        "This reporting package preserves its selected source; receiving verifies the bytes and bindings.</p><p><a href=\"software/OPERATING.md\">Complete operating guide</a> · " + \
        "<a href=\"reporting.json\">Full reporting record</a> · <a href=\"tables/checks.csv\">All checks CSV</a> · " + \
        "<a href=\"tables/source-files.csv\">Source inventory CSV</a></p></section></main></html>"
    return body.encode("utf-8")


def rendered_files(binding, input_raw, selected_raw, source_rows):
    doc = document(input_raw, "installation-input.json")
    selected = document(selected_raw, "workshare-selection.json")
    require(isinstance(doc, dict) and isinstance(doc.get("workshare"), dict), "Retain the full Workshare-bound installation input.")
    require(doc["workshare"].get("caseId") == binding["company_case_id"] and
            doc["workshare"].get("planSha256") == binding["workshare_plan_sha256"],
            "The original installation Workshare binding differs.")
    require(selected.get("caseId") == binding["company_case_id"] and
            selected.get("planSha256") == binding["workshare_plan_sha256"],
            "The selected full Workshare binding differs.")
    sources = [{key: row[key] for key in ("id", "role", "path", "bytes", "sha256")} for row in source_rows]
    report = reporting_value(binding, doc, selected, sources)
    files = {
        "installation-input.json": input_raw,
        "workshare-selection.json": selected_raw,
        "reporting.json": packed(report),
        "REPORT.md": report_markdown(report, doc, selected),
        "REPORT.html": report_html(report, doc, selected, source_rows),
        "tables/checks.csv": csv_bytes(["check_id", "state", "operator", "observed_at", "note", "complete_check_json"],
             [{"check_id": row["id"], "state": row.get("state"), "operator": row.get("operator"),
               "observed_at": row.get("observedAt"), "note": row.get("note"), "complete_check_json": row}
              for row in report["checks"]]),
        "tables/source-files.csv": csv_bytes(["id", "role", "path", "bytes", "sha256"], sources),
        "tables/commercial-selection.csv": csv_bytes(["company_case_id", "installation_id", "revision", "stage",
                "phase_count", "hours", "complete_commercial_json"],
             [{"company_case_id": binding["company_case_id"], "installation_id": binding["installation_id"],
               "revision": binding["revision"], "stage": report["stage"], "phase_count": report["phase_count"],
               "hours": report["hours"], "complete_commercial_json": report["commercial"]}])
    }
    for row in source_rows:
        require(row["path"] not in files and row["path"].startswith("original-files/"),
                "The original customer source path is invalid.")
        require(len(row["raw"]) == row["bytes"] and digest(row["raw"]) == row["sha256"],
                "The complete original source bytes differ.")
        files[row["path"]] = row["raw"]
    return files, report



def receiving_guide(binding):
    lines = [
        "# Customer installation report — receiving and later editions", "",
        "Original commercial case: " + binding["company_case_id"],
        "Installation: " + binding["installation_id"] + ", saved revision " + str(binding["revision"]),
        "Native saved-edition SHA-256: " + binding["native_installation_sha256"],
        "Workshare plan SHA-256: " + binding["workshare_plan_sha256"], "",
        "## Open the complete report", "",
        "Use Python 3.11 or later on Linux. The included programme uses only the standard library.",
        "Keep customer_reporting.py and this OPERATING.md together inside software/.",
        "Obtain the exact SHA-256 supplied with this package's own receipt or .sha256 sidecar.",
        "From the directory containing this software/ folder:", "",
        "    python3 software/customer_reporting.py receive --archive /absolute/REPORT.zip --sha256 EXACT_SELECTED_SHA256 --output /absolute/received-report", "",
        "The receiver verifies the entire ZIP member population, exact file hashes and original bindings.",
        "It regenerates every reporting view from the retained input and source and checks the full bytes.",
        "It writes original-report.zip, selection.json, all files under package/, and complete-result.json.",
        "Open package/REPORT.html for the complete readable report. No server or JavaScript is needed.",
        "Reusing the same inputs/output reopens and verifies those exact files; changed inputs cannot overwrite the original selection.", "",
        "## What this package preserves", "",
        "- REPORT.html and REPORT.md: complete saved installation, Workshare, check records and original customer files.",
        "- installation-input.json: unchanged full editable native download.",
        "- workshare-selection.json: the complete selected original Workshare case.",
        "- original-files/: all three complete original files for this customer.",
        "- reporting.json: recorded stage, commercial selection, every check and exact provenance.",
        "- tables/: all check records, original source identities and the actual commercial selection.",
        "- manifest.json: every member's byte count and SHA-256 plus original case/plan/installation/source bindings.",
        "- software/: the complete original reporting receiver and this selected-customer guide.", "",
        "The recorded proposed commercial terms and hours retain their original meaning.",
        "The original source explains internal effort and any separate counterpart participation.",
        "A successful report receipt verifies package integrity; it does not approve implementation, invoice or record payment.", "",
        "## Compare a later complete reporting edition", "",
        "Keep both exact report ZIPs and their own SHA-256 receipts:", "",
        "    python3 software/customer_reporting.py compare --before /absolute/earlier.zip --before-sha256 EARLIER_SHA256 --after /absolute/later.zip --after-sha256 LATER_SHA256 --output /absolute/report-comparison", "",
        "Both reports must identify this same original commercial case and installation.",
        "The comparison retains every installation and Workshare field change, every check keyed by its original ID,",
        "and all original source identity changes. Arrays without declared native keys retain complete before/after values.",
        "The output includes both input ZIPs, full comparison.json, all differences.csv and its reading guide.",
        "Use the included source version for each report if a later format changes; this receiver verifies its current format exactly.", "",
        "## Continue the original installation", "",
        "The original SCF application remains the place to record observations, review phase criteria and save a later installation edition.",
        "The full internal operating programme is retained by its existing operator. This reporting package carries the selected customer",
        "records and original provenance rather than the programme's wider internal database and correspondence.", "",
        "Source programme: " + binding["source_program"]["case_id"] + " / version " + str(binding["source_program"]["version"]),
        "Source plan: " + binding["source_program"]["plan_id"],
        "Original operator archive SHA-256: " + binding["source_archive"]["sha256"],
        "Original browser completion: " + str(binding["observed_at"]), ""
    ]
    return ("\n".join(lines)).encode("utf-8")


def zip_bytes(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as handle:
        for name, raw in sorted(files.items()):
            safe_name(name)
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o600) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            handle.writestr(entry, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    return out.getvalue()


def read_customer(raw, expected=None):
    archive = Archive(raw, expected)
    manifest = archive.json("manifest.json")
    require(manifest.get("schema") == SCHEMA, "Select a complete SCF customer reporting package.")
    rows = indexed(manifest.get("files"), "path", "package member")
    require(set(archive.entries) == set(rows) | {"manifest.json"}, "The complete package member closure differs.")
    files = {}
    for name, row in rows.items():
        safe_name(name)
        content = archive.read(name)
        require(len(content) == row.get("bytes") and digest(content) == hash_value(row.get("sha256"), name),
                "Package member identity differs: " + name)
        files[name] = content
    require("software/" + SOURCE_FILE in files and "software/" + GUIDE_FILE in files,
            "Retain the complete reporting receiver and operating guide.")
    binding = manifest.get("binding")
    require(isinstance(binding, dict), "The original reporting binding is missing.")
    sources = []
    source_rows = manifest.get("customer_sources")
    indexed(source_rows, "id", "original customer source")
    roles = set()
    for row in source_rows:
        require(row.get("role") not in roles, "Duplicate original customer source role.")
        roles.add(row.get("role"))
        require(row.get("path") in files, "The selected original customer source is missing.")
        sources.append({**row, "raw": files[row["path"]]})
    expected_files, report = rendered_files(binding, files["installation-input.json"], files["workshare-selection.json"], sources)
    for name, content in expected_files.items():
        require(files.get(name) == content, "The complete native reporting view differs: " + name)
    require(set(files) == set(expected_files) | {"software/" + SOURCE_FILE, "software/" + GUIDE_FILE},
            "Unexpected files require an explicit reporting format edition.")
    require(files["software/" + GUIDE_FILE] == receiving_guide(binding),
            "The selected customer receiving guide differs.")
    require(manifest.get("report_sha256") == digest(files["reporting.json"]), "The report binding differs.")
    return {"archive": archive, "manifest": manifest, "files": files, "report": report}


def source_root(archive, prefix):
    if prefix:
        prefix = safe_name(prefix.rstrip("/")) + "/"
    required = ["operation-selection.json", "complete-operator-result.json",
                "original/browser-result.json", "original/complete-original-programme.json"]
    require(all(prefix + name in archive.entries for name in required),
            "Select the explicit archive root containing the completed operator selection and original/ results.")
    return prefix


def prepare_reports(archive, prefix, operation_id, software, guide):
    prefix = source_root(archive, prefix)
    take = lambda name: archive.read(prefix + name)
    parsed = lambda name: document(take(name), name)
    selection = parsed("operation-selection.json")
    completed = parsed("complete-operator-result.json")
    browser = parsed("original/browser-result.json")
    program = parsed("original/complete-original-programme.json")
    require(selection.get("schema") == SELECTION_SCHEMA and completed.get("schema") == RESULT_SCHEMA,
            "Use the completed original operator selection and result.")
    require(browser.get("completedAt") and not browser.get("failure") and not browser.get("errors"),
            "The selected original browser operation is not complete.")
    require(equal(completed.get("original_browser"), browser), "The retained full browser result differs.")
    require(browser.get("coldReopen", {}).get("caseId") == selection.get("case") and
            browser.get("coldReopen", {}).get("planId") == selection.get("plan"),
            "Retain the original completed cold-browser reopen.")
    require(completed.get("native_source_case") == selection.get("case") and
            completed.get("native_source_version") == selection.get("version") and
            program.get("program", {}).get("id") == selection.get("case") and
            program.get("program", {}).get("version") == selection.get("version"),
            "The original programme case/version differs.")
    planned = indexed(selection.get("installations"), "installation_id", "selected installation")
    observed = indexed(browser.get("installations"), "installationId", "observed installation")
    require(len(planned) == 3 and set(planned) == set(observed), "Receive all three original selected installations.")
    downloads = indexed(browser.get("downloads"), "file", "original download")
    company_keys = set()
    packages = []
    for installation_id, row in planned.items():
        got = observed[installation_id]
        case_id = row.get("case_id")
        require(isinstance(case_id, str) and re.fullmatch(r"[A-Za-z0-9_-]+", case_id),
                "Retain the complete original commercial case identity.")
        key = case_id.split("-")[0]
        require(key not in company_keys, "The original customer download prefixes collide.")
        company_keys.add(key)
        require(got.get("caseId") == case_id and got.get("revision") == row.get("revision") and
                got.get("sha256") == row.get("installation_sha256") and
                got.get("originalPlanSha256") == row.get("plan_sha256"),
                "The observed installation and original Workshare selection differ.")
        edition_name = "original/" + case_id + "-saved-edition.json"
        edition_raw = take(edition_name)
        edition = document(edition_raw, edition_name)
        require(edition.get("id") == installation_id and edition.get("revision") == row["revision"] and
                edition.get("sha256") == row["installation_sha256"], "The complete saved native edition differs.")
        input_name = key + "-complete-saved-input.json"
        require(input_name in downloads, "The exact editable input download is missing.")
        input_raw = take("original/" + input_name)
        require(len(input_raw) == downloads[input_name].get("bytes") and digest(input_raw) == downloads[input_name].get("sha256"),
                "The editable original download differs.")
        doc = document(input_raw, input_name)
        require(equal(doc, edition.get("preview", {}).get("document")), "The complete saved input differs from its native edition.")
        inventory_name = "original/" + key + "-original-workshare.json"
        inventory = parsed(inventory_name)
        cases = indexed(inventory.get("cases"), "caseId", "Workshare case")
        require(case_id in cases, "The original Workshare case is absent.")
        selected = cases[case_id]
        require(selected.get("planSha256") == row["plan_sha256"] and selected.get("phaseCount") == got.get("phases") and
                str(selected.get("hours")) == str(got.get("hours")) and
                selected.get("commercial", {}).get("amount") == got.get("fee") and
                selected.get("commercial", {}).get("currency") == got.get("currency"),
                "The original complete Workshare terms differ.")
        originals = indexed(got.get("originalFiles"), "id", "observed source")
        source_rows = []
        roles = set()
        for source_id, source in originals.items():
            role = source.get("role")
            require(isinstance(role, str) and re.fullmatch(r"[A-Za-z0-9_-]+", role) and role not in roles,
                    "Retain each original source role exactly once.")
            roles.add(role)
            original_name = key + "-" + role + "-original.json"
            require(original_name in downloads, "The observed original source download is missing.")
            raw = take("original/" + original_name)
            downloaded = downloads[original_name]
            require(len(raw) == source.get("bytes") == downloaded.get("bytes") and
                    digest(raw) == source.get("sha256") == downloaded.get("sha256"),
                    "The complete original customer file differs: " + original_name)
            document(raw, original_name)
            source_rows.append({"id": source_id, "role": role, "path": "original-files/" + role + ".json",
                                "bytes": len(raw), "sha256": digest(raw), "raw": raw})
        require(len(source_rows) == 3, "Keep all three complete original customer source files.")
        binding = {
            "operation_id": operation_id,
            "company_case_id": case_id,
            "installation_id": installation_id,
            "revision": row["revision"],
            "native_installation_sha256": hash_value(row["installation_sha256"], "native edition"),
            "workshare_plan_sha256": hash_value(row["plan_sha256"], "Workshare plan"),
            "source_program": {"case_id": selection["case"], "version": selection["version"], "plan_id": selection["plan"],
                               "planning_sha256": hash_value(selection["planningSha256"], "planning"),
                               "commissioning_manifest_sha256": hash_value(selection["manifestSha256"], "commissioning manifest")},
            "source_archive": {"sha256": archive.sha256, "bytes": len(archive.raw), "root": prefix},
            "original_selection_sha256": digest(take("operation-selection.json")),
            "original_browser_result_sha256": digest(take("original/browser-result.json")),
            "original_saved_edition_sha256": digest(edition_raw),
            "original_workshare_inventory_sha256": digest(take(inventory_name)),
            "observed_at": browser["completedAt"]
        }
        files, report = rendered_files(binding, input_raw, packed(selected), source_rows)
        files["software/" + SOURCE_FILE] = software
        files["software/" + GUIDE_FILE] = receiving_guide(binding)
        manifest = {"schema": SCHEMA, "binding": binding, "report_sha256": digest(files["reporting.json"]),
                    "customer_sources": [{key: s[key] for key in ("id", "role", "path", "bytes", "sha256")} for s in source_rows],
                    "files": [{"path": name, "bytes": len(raw), "sha256": digest(raw)} for name, raw in sorted(files.items())]}
        files["manifest.json"] = packed(manifest)
        raw = zip_bytes(files)
        verified = read_customer(raw)
        require(equal(verified["report"], report), "Independent report receiving differs.")
        packages.append({"case_id": case_id, "installation_id": installation_id, "revision": row["revision"],
                         "filename": company_title(case_id) + "_Customer_Installation_Report_r" + str(row["revision"]) + ".zip",
                         "bytes": len(raw), "sha256": digest(raw), "manifest_sha256": digest(files["manifest.json"]),
                         "stage": report["stage"], "checks": len(report["checks"]), "source_files": len(source_rows),
                         "raw": raw})
    return packages, selection


@contextlib.contextmanager
def operation_directory(path):
    out = pathlib.Path(path).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(out.is_dir(), "Use an owned operation output directory.")
    with open(out / "operation.lock", "a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ReportError("This original output is already owned by a live reporting operation.") from exc
        try:
            yield out
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def retain(out, relative, raw):
    safe_name(relative)
    dest = out.joinpath(*relative.split("/"))
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(dest.parent.resolve().is_relative_to(out.resolve()), "The output parent escaped its selected root.")
    if dest.exists() or dest.is_symlink():
        require(regular_bytes(dest) == raw, "Existing retained bytes differ: " + relative)
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".report-", dir=str(dest.parent))
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        try:
            os.link(temporary, dest)
        except FileExistsError:
            require(regular_bytes(dest) == raw, "Concurrent publication differs: " + relative)
        directory = os.open(dest.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        os.unlink(temporary)


def export_reports(args):
    raw = regular_bytes(args.archive)
    archive = Archive(raw, args.sha256)
    own = pathlib.Path(__file__).resolve()
    software, guide = regular_bytes(own), regular_bytes(own.with_name(GUIDE_FILE))
    require(isinstance(args.operation_id, str) and args.operation_id.strip(), "Retain the original reporting operation ID.")
    request = {"schema": "commons.scf-customer-report-selection.v1", "operation_id": args.operation_id,
               "source_archive_sha256": archive.sha256, "source_archive_bytes": len(raw),
               "archive_root": args.archive_root, "software_sha256": digest(software), "guide_sha256": digest(guide)}
    with operation_directory(args.output) as out:
        retain(out, "selection.json", packed(request))
        packages, selection = prepare_reports(archive, args.archive_root, args.operation_id, software, guide)
        index = []
        for row in packages:
            retain(out, row["filename"], row["raw"])
            public_row = {key: value for key, value in row.items() if key != "raw"}
            retain(out, row["filename"] + ".sha256", (row["sha256"] + "  " + row["filename"] + "\n").encode("ascii"))
            selected_report = read_customer(row["raw"], row["sha256"])
            retain(out, row["filename"] + ".receipt.json", packed({"schema": "commons.scf-customer-report-delivery-receipt.v1",
                    "package": public_row, "binding": selected_report["manifest"]["binding"]}))
            index.append(public_row)
        result = {"schema": "commons.scf-customer-reports-result.v1", "operation_id": args.operation_id,
                  "source_archive": {"sha256": archive.sha256, "bytes": len(raw)},
                  "original_programme_selection": selection, "packages": index}
        retain(out, "complete-result.json", packed(result))
        # Reopen every complete saved package before reporting completion.
        for row in index:
            read_customer(regular_bytes(out / row["filename"]), row["sha256"])
        return result


def receive_report(args):
    raw = regular_bytes(args.archive)
    got = read_customer(raw, args.sha256)
    manifest, files = got["manifest"], got["files"]
    request = {"schema": "commons.scf-customer-report-receiving-selection.v1",
               "archive_sha256": digest(raw), "archive_bytes": len(raw),
               "manifest_sha256": digest(got["archive"].read("manifest.json")), "binding": manifest["binding"]}
    with operation_directory(args.output) as out:
        retain(out, "selection.json", packed(request))
        retain(out, "original-report.zip", raw)
        for name, content in files.items():
            retain(out, "package/" + name, content)
        retain(out, "package/manifest.json", got["archive"].read("manifest.json"))
        for name, content in files.items():
            require(regular_bytes(out / "package" / name) == content, "Independent reopened file differs: " + name)
        result = {**request, "schema": "commons.scf-customer-report-receiving-result.v1",
                  "member_count": len(files) + 1, "source_files": len(manifest["customer_sources"]),
                  "checks": len(got["report"]["checks"]), "stage": got["report"]["stage"],
                  "report_sha256": manifest["report_sha256"]}
        retain(out, "complete-result.json", packed(result))
        return result


def pointer(part):
    return str(part).replace("~", "~0").replace("/", "~1")


def changes(before, after, path=""):
    if equal(before, after):
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(set(before) | set(after)):
            loc = path + "/" + pointer(key)
            if key not in before:
                result.append({"path": loc, "kind": "added", "after": after[key]})
            elif key not in after:
                result.append({"path": loc, "kind": "removed", "before": before[key]})
            else:
                result.extend(changes(before[key], after[key], loc))
        return result
    # Retain arrays completely rather than invent identity or truncate moved rows.
    return [{"path": path or "/", "kind": "changed", "before": before, "after": after}]


def compare_reports(args):
    left = read_customer(regular_bytes(args.before), args.before_sha256)
    right = read_customer(regular_bytes(args.after), args.after_sha256)
    a, b = left["manifest"]["binding"], right["manifest"]["binding"]
    require(a["company_case_id"] == b["company_case_id"] and a["installation_id"] == b["installation_id"],
            "Compare the same original company and installation.")
    before_doc = document(left["files"]["installation-input.json"], "before installation")
    after_doc = document(right["files"]["installation-input.json"], "after installation")
    before_checks = indexed(before_doc.pop("checks"), "id", "before check")
    after_checks = indexed(after_doc.pop("checks"), "id", "after check")
    diffs = []
    diffs.extend(changes(before_doc, after_doc, "/installation"))
    diffs.extend(changes(before_checks, after_checks, "/checks"))
    diffs.extend(changes(document(left["files"]["workshare-selection.json"], "before Workshare"),
                         document(right["files"]["workshare-selection.json"], "after Workshare"), "/workshare"))
    old_sources = indexed(left["manifest"]["customer_sources"], "role", "before source role")
    new_sources = indexed(right["manifest"]["customer_sources"], "role", "after source role")
    diffs.extend(changes(old_sources, new_sources, "/original_sources"))
    for row in diffs:
        row["difference_id"] = "difference-" + digest(packed(row))
    result = {"schema": "commons.scf-customer-report-comparison.v1", "company_case_id": a["company_case_id"],
              "installation_id": a["installation_id"], "before": {"archive_sha256": left["archive"].sha256, "binding": a},
              "after": {"archive_sha256": right["archive"].sha256, "binding": b},
              "difference_count": len(diffs), "differences": diffs,
              "recorded_stage_before": left["report"]["stage"], "recorded_stage_after": right["report"]["stage"]}
    with operation_directory(args.output) as out:
        retain(out, "before-report.zip", left["archive"].raw)
        retain(out, "after-report.zip", right["archive"].raw)
        retain(out, "comparison.json", packed(result))
        retain(out, "differences.csv", csv_bytes(["difference_id", "path", "kind", "before", "after"], diffs))
        retain(out, "READ_COMPARISON.md",
               ("# Complete customer reporting comparison\n\nCompany: " + a["company_case_id"] +
                "\n\nInstallation: " + a["installation_id"] + "\n\nDifferences: " + str(len(diffs)) +
                "\n\ncomparison.json retains every full before/after value and exact package identity. "
                "Both original reporting ZIPs are retained. Checks use original check IDs; other arrays retain their complete before/after values. "
                "Review and record any implementation decisions in the original SCF installation.\n").encode("utf-8"))
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("export", help="Report all original saved customer installations without changing their native state.")
    p.add_argument("--archive", required=True, type=pathlib.Path)
    p.add_argument("--sha256", required=True)
    p.add_argument("--archive-root", default="", help="Exact ZIP directory containing operation-selection.json; empty means ZIP root.")
    p.add_argument("--operation-id", required=True)
    p.add_argument("--output", required=True, type=pathlib.Path)
    p.set_defaults(run=export_reports)
    p = sub.add_parser("receive", help="Verify and reopen a complete company reporting package.")
    p.add_argument("--archive", required=True, type=pathlib.Path)
    p.add_argument("--sha256", required=True)
    p.add_argument("--output", required=True, type=pathlib.Path)
    p.set_defaults(run=receive_report)
    p = sub.add_parser("compare", help="Compare complete original company reporting editions.")
    p.add_argument("--before", required=True, type=pathlib.Path)
    p.add_argument("--before-sha256", required=True)
    p.add_argument("--after", required=True, type=pathlib.Path)
    p.add_argument("--after-sha256", required=True)
    p.add_argument("--output", required=True, type=pathlib.Path)
    p.set_defaults(run=compare_reports)
    args = parser.parse_args(argv)
    try:
        result = args.run(args)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (ReportError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({"state": "FAILED", "type": type(exc).__name__, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
