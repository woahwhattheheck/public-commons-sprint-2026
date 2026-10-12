"""Complete portable exchange receiving records and grayscale staff report."""
from __future__ import annotations

import copy
import hashlib
import html
import io
import json
from pathlib import PurePosixPath
import re
import zipfile

from .reporting import _csv

SCHEMA = "berkeley.cashiering.receiving-packet.v1"


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def esc(value):
    if value is None:
        value = ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return html.escape(str(value), quote=True)


def table(columns, rows):
    result = ["<div class='table-wrap'><table><thead><tr>"]
    result += ["<th>" + esc(label) + "</th>" for key, label in columns]
    result.append("</tr></thead><tbody>")
    for row in rows[:200]:
        result.append("<tr>" + "".join("<td>" + esc(row.get(key)) + "</td>" for key, _ in columns) + "</tr>")
    result.append("</tbody></table></div>")
    if len(rows) > 200:
        result.append("<p>Showing the first 200 of " + str(len(rows)) + " records here. The named CSV and receiving.json contain the full selected population.</p>")
    if not rows:
        result.append("<p>No recorded rows in this family.</p>")
    return "".join(result)


def rows_csv(detail, kind):
    if kind == "prepared":
        rows = [{"prepared_id": r["id"], "ordinal": r["ordinal"], "status": r["status"],
                 "unobserved_families": r["unobserved_families"], "original_prepared_values": r["values"],
                 "current_source_results": r["families"], "original_observation_ids": r["observation_ids"]}
                for r in detail["prepared"]]
    elif kind == "observations":
        rows = [{"observation_id": r["id"], "source_id": r["source_id"], "record": r["record"],
                 "mapping_version": r["mapping_version"], "source_system": r["source_system"],
                 "report_family": r["report_family"], "active_source": r["active_source"],
                 "match": r["match"], "prepared_id": r["prepared_id"], "native_status": r["native_status"],
                 "interpreted_status": r["status"], "observed_at": r["observed_at"],
                 "event_id": r["event_id"], "reference": r["reference"], "currency": r["currency"],
                 "amount_minor": r["amount_minor"], "error_code": r["error_code"],
                 "error_message": r["error_message"], "original_values": r["original"],
                 "original_types": r["types"], "mapping_sha256": r["mapping_sha256"],
                 "document_sha256": r["document_sha256"], "issues": r["issues"],
                 "assignment": r["assignment"]} for r in detail["observations"]]
    elif kind == "findings":
        rows = [{"finding_id": r["id"], "code": r["code"], "message": r["message"],
                 "prepared_ids": r["prepared_ids"], "observation_ids": r["observation_ids"],
                 "details": r["details"], "review_status": r["review"].get("status"),
                 "review_owner": r["review"].get("owner"), "review_note": r["review"].get("note"),
                 "review_time": r["review"].get("updated_at")} for r in detail["findings"]]
    else:
        raise ValueError("Choose prepared, observations or findings.")
    return _csv(rows)


def render_report(detail):
    export = detail["export"]
    counts = detail["counts"]
    sources = detail["source_bindings"]
    totals = detail["totals"]
    prepared = [{"ordinal": r["ordinal"], "status": r["status"], "values": r["values"],
                 "families": r["families"]} for r in detail["prepared"]]
    returned = [{"source": r["source_id"], "record": r["record"], "match": r["match"],
                 "native_status": r["native_status"], "interpreted": r["status"],
                 "observed_at": r["observed_at"], "amount_minor": r["amount_minor"],
                 "currency": r["currency"], "original": r["original"]} for r in detail["observations"]]
    style = """
    *{box-sizing:border-box}body{margin:0;color:#171717;background:#fff;font:14px/1.5 system-ui,sans-serif}
    main{max-width:1200px;margin:0 auto;padding:36px}h1{font-size:27px;margin:0 0 12px}h2{font-size:19px;margin-top:32px}
    .eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#555}
    .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));border:1px solid #bbb}
    .facts div{padding:12px;border-right:1px solid #ddd}.facts strong{display:block;font-size:21px}
    .table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;border:1px solid #ccc;padding:7px;overflow-wrap:anywhere}
    th{background:#eee}code,pre{font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}
    details{border:1px solid #ccc;padding:12px;margin:12px 0}.muted{color:#555}a{color:inherit}
    @media print{main{padding:0}.table-wrap{overflow:visible}details{break-inside:avoid}h2{break-after:avoid}thead{display:table-header-group}}
    """
    parts = ["<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
             "<title>" + esc(detail["label"]) + " · Exchange receiving</title><style>" + style + "</style></head><body><main>",
             "<p class='eyebrow'>Berkeley cashiering · Original exchange receiving</p><h1>" + esc(detail["label"]) + "</h1>",
             "<p>Receiving edition " + str(detail["version"]) + " · " + esc(detail["id"]) + "</p>",
             "<p>" + esc(detail["note"]) + "</p><div class='facts'>"]
    for field, label in (("prepared_rows", "Prepared rows"), ("returned_rows", "Original returned rows"),
                         ("matched_rows", "Current matched observations"), ("unobserved_prepared_rows", "Prepared rows unobserved"),
                         ("findings", "Native findings"), ("open_findings", "Open investigations")):
        parts.append("<div><strong>" + str(counts[field]) + "</strong>" + label + "</div>")
    parts += ["</div><h2>Exact prepared exchange</h2><p>" + esc(export["label"]) + " · " + esc(export["id"]) + "</p>",
              "<p>Financial run " + esc(detail["run_id"]) + ", edition " + str(export["edit_revision"]) +
              ". Profile " + esc(export["profile"]["name"]) + " v" + str(export["profile_version"]) + ".</p>",
              "<pre>Original artifact SHA-256: " + esc(export["sha256"]) +
              "\nInput SHA-256: " + esc(detail["input_sha256"]) +
              "\nComparison SHA-256: " + esc(detail["comparison_sha256"]) +
              "\nReviewed projection SHA-256: " + esc(detail["review_sha256"]) + "</pre>",
              "<h2>Original returned sources</h2>",
              table([("id", "Source"), ("filename", "Original filename"), ("rows", "Rows"),
                     ("sha256", "SHA-256"), ("metadata", "Native source scope"), ("mapping_version", "Mapping edition")], sources),
              "<h2>Amount observations by original source family</h2>",
              "<p>Amounts are exact integer minor units under the retained currency scales. A known returned subtotal excludes absent or unusable row amounts. Each source family is shown separately.</p>",
              table([("source_system", "System"), ("report_family", "Report"), ("currency", "Currency"),
                     ("expected_minor", "Prepared minor units"), ("known_returned_minor", "Known returned minor units"),
                     ("prepared_rows", "Prepared rows"), ("rows_with_returned_amount", "Observed amounts"),
                     ("rows_without_returned_amount", "Amounts absent or unusable")], totals),
              "<h2>Prepared rows and observed results</h2><p>Complete file: prepared.csv</p>",
              table([("ordinal", "Original row"), ("status", "Current native result"),
                     ("values", "Original prepared values"), ("families", "Source-specific observations")], prepared),
              "<h2>Complete original return population</h2><p>Complete file: observations.csv. Earlier snapshots and explicitly excluded records remain in the export.</p>",
              table([("source", "Source"), ("record", "Original record"), ("match", "Identity"),
                     ("native_status", "Native status"), ("interpreted", "Interpretation"), ("observed_at", "Observed time"),
                     ("currency", "Currency"), ("amount_minor", "Returned minor units"), ("original", "Original fields")], returned),
              "<h2>Source-bound investigations</h2><p>Complete file: findings.csv. A recorded review does not change a native status or returned amount.</p>",
              table([("code", "Finding"), ("message", "Meaning"), ("details", "Original context"),
                     ("review", "Recorded staff review")], detail["findings"]),
              "<h2>Receiving decisions</h2>",
              table([("status", "Decision"), ("owner", "Reviewer"), ("statement", "Statement"), ("note", "Reason"),
                     ("created_at", "Recorded time"), ("current", "Matches this projection")], detail["decisions"]),
              "<details><summary>Exact output profile and currency scales</summary><pre>" +
              esc({"profile": export["profile"], "scales": detail["scales"]}) + "</pre></details>",
              "<h2>Continue the original workspace</h2><p>receiving.json contains the complete selected rows, mappings, decisions and retained receiving history. "
              "The original application SQLite backup reopens both permitting and cashiering work, including these receiving editions. "
              "Use the supplied RECEIVING.md for the installed browser and CLI.</p>",
              "<p class='muted'>Native returned labels are interpreted only through the selected mapping. The original cashiering exchange receipts and financial close retain their own identities.</p>",
              "</main></body></html>"]
    return "".join(parts)


def build_packet(detail, prepared_raw, originals, source_files):
    if not isinstance(prepared_raw, bytes) or hashlib.sha256(prepared_raw).hexdigest() != detail["export"]["sha256"]:
        raise ValueError("Receiving handoff needs the exact original prepared bytes.")
    members = {
        "report.html": render_report(detail).encode("utf-8"),
        "receiving.json": encoded(detail),
        "prepared-original.csv": prepared_raw,
        "prepared-profile.json": encoded(detail["export"]),
        "history.json": encoded(detail["history"]),
        "currency-scales.json": encoded(detail["scales"]),
    }
    for kind in ("prepared", "observations", "findings"):
        members[kind + ".csv"] = rows_csv(detail, kind)
    sources = []
    for source in originals:
        raw = source["raw"]
        if not isinstance(raw, bytes) or len(raw) != source["bytes"] or hashlib.sha256(raw).hexdigest() != source["sha256"]:
            raise ValueError("Returned original bytes changed before handoff.")
        suffix = PurePosixPath(source["filename"]).suffix.lower()
        suffix = suffix if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix) else ".bin"
        member = "originals/" + source["sha256"] + suffix
        if member in members and members[member] != raw:
            raise ValueError("Original handoff member collision.")
        members[member] = raw
        sources.append({k: copy.deepcopy(v) for k, v in source.items() if k not in ("raw", "preview")})
        sources[-1]["member"] = member
    members["originals.json"] = encoded(sources)
    for name, raw in source_files.items():
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name or not isinstance(raw, bytes):
            raise ValueError("Only complete relative maintained source files belong in the handoff.")
        members["source/" + str(path)] = raw
    members["README.md"] = (
        "# Original accounting exchange receiving\n\n"
        "Open report.html, then use receiving.json and the three complete human-review CSVs "
        "for all selected records. prepared-original.csv preserves the exact emitted exchange. "
        "originals.json names each unchanged returned file and the exact mapping edition; originals/ holds its bytes.\n\n"
        "history.json preserves the receiving configuration, original source bindings, assignments, "
        "reviews and decisions through this selected edition. Original files required by those editions accompany the packet. "
        "The supplied maintained source implements the same identity and amount interpretation.\n\n"
        "For a working handover, also download the original application backup. Restore it with "
        "python3 -B workspace/app.py --restore BACKUP.sqlite --db NEW.sqlite and open /cashiering/receiving/. "
        "The backup preserves the complete original permitting, financial and receiving state.\n\n"
        "Amounts use declared integer minor units and separate source-family denominators. "
        "Human CSV preserves long identifiers and protects spreadsheet formula cells; exact JSON and original files preserve source text. "
        "Returned status mappings and staff review decisions remain separate from the original daily close and exchange-level receipts.\n"
    ).encode("utf-8")
    manifest = {"schema": SCHEMA, "receiving_id": detail["id"], "receiving_version": detail["version"],
                "run_id": detail["run_id"], "export_id": detail["export_id"],
                "input_sha256": detail["input_sha256"], "comparison_sha256": detail["comparison_sha256"],
                "review_sha256": detail["review_sha256"], "members": [
                    {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                    for name, raw in sorted(members.items())]}
    members["manifest.json"] = encoded(manifest)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:
        for name, raw in sorted(members.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            archive.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return out.getvalue(), manifest
