#!/usr/bin/env python3
"""A company's full report, editable observations and exact returned-byte handover."""
from __future__ import annotations
import argparse
import base64
import copy
import datetime
import html
import json
import pathlib
import re
import uuid
if __package__:
    from . import customer_reporting as R
else:
    import customer_reporting as R

SCHEMA = "commons.scf-company-observation-return.v1"
PACKAGE = "commons.scf-company-observation-return-package.v1"
REPORTING_SHA = "774d943c0481e13b0221c3dd684853a26d61b01aa7765aae3658b0e33322556b"
SOFTWARE = ("customer_return.py", "customer-return-ui.js", "customer_return_native.py", "RETURNING.md")
STATES = ("OPEN", "IN_PROGRESS", "ACCEPTED", "CHANGES_REQUIRED", "NOT_APPLICABLE")
OBSERVATION_KEYS = ("state", "operator", "observedAt", "note", "sourceIds", "workIds", "purchaseIds", "outcomeIds")
LINK_KEYS = ("sourceIds", "workIds", "purchaseIds", "outcomeIds")
DEFINITION_KEYS = ("id", "title", "criterion", "tranche", "required")
require, packed, digest = R.require, R.packed, R.digest


def string(value, label, maximum, required=False):
    require(isinstance(value, str) and len(value) <= maximum and (not required or bool(value.strip())),
            "Retain " + label + " within " + str(maximum) + " characters.")
    return value


def identifier(value):
    try:
        require(isinstance(value, str) and str(uuid.UUID(value)) == value, "Use a lowercase canonical return UUID.")
    except (ValueError, AttributeError) as exc:
        raise R.ReportError("Use a canonical return UUID.") from exc
    return value


def trusted_reporting():
    source = R.regular_bytes(pathlib.Path(R.__file__).resolve())
    require(digest(source) == REPORTING_SHA, "Select the original complete company reporting receiver.")
    return source


def read_report(raw, expected):
    trusted_reporting()
    value = R.read_customer(raw, expected)
    doc = R.document(value["files"]["installation-input.json"], "complete original Installation")
    binding = value["manifest"]["binding"]
    require(isinstance(doc.get("checks"), list) and 0 < len(doc["checks"]) <= 100,
            "Retain the complete native original check roster.")
    seen = set()
    for row in doc["checks"]:
        require(isinstance(row, dict) and row.get("id") not in seen and
                all(key in row for key in (*DEFINITION_KEYS, *OBSERVATION_KEYS)),
                "Retain every original native check field and unique identity.")
        seen.add(row["id"])
    require(doc.get("workshare", {}).get("caseId") == binding["company_case_id"] and
            doc["workshare"].get("planSha256") == binding["workshare_plan_sha256"],
            "The company report's original Workshare selection differs.")
    value["document"] = doc
    return value


def seed_inputs(selected):
    binding, doc = selected["manifest"]["binding"], selected["document"]
    return {"installationId": binding["installation_id"], "revision": binding["revision"],
            "sha256": binding["native_installation_sha256"],
            "name": (doc.get("name", "Installation") + " — proposed receiving return")[:300],
            "recipient": "", "environment": "", "note": "",
            "observations": [{key: copy.deepcopy(row[key]) for key in ("id", *OBSERVATION_KEYS)}
                             for row in doc["checks"]]}


def validate_return(selected, raw, *, complete=True):
    require(len(raw) <= 8 * 1024 * 1024, "Retain a bounded complete return JSON.")
    value = R.document(raw, "original returned observations")
    require(isinstance(value, dict) and set(value) == {"schema", "report_sha256", "binding", "return_id",
            "previous_return_sha256", "inputs"} and value["schema"] == SCHEMA,
            "Select the complete company observation-return document.")
    require(value["report_sha256"] == selected["archive"].sha256 and
            R.equal(value["binding"], selected["manifest"]["binding"]), "The original company report binding changed.")
    identifier(value["return_id"])
    if value["previous_return_sha256"] is not None:
        R.hash_value(value["previous_return_sha256"], "preceding complete return JSON")
    inputs, original = value["inputs"], seed_inputs(selected)
    require(isinstance(inputs, dict) and set(inputs) == set(original), "Retain the full native return input shape.")
    require(all(R.equal(inputs[key], original[key]) for key in ("installationId", "revision", "sha256")),
            "Retain the exact original saved Installation edition.")
    for key, maximum in (("name", 300), ("recipient", 500), ("environment", 8000), ("note", 12000)):
        string(inputs[key], key, maximum, complete)
    rows = inputs["observations"]
    require(isinstance(rows, list) and len(rows) == len(original["observations"]), "Return every original check.")
    expected = {row["id"]: row for row in original["observations"]}
    seen = set()
    for row in rows:
        require(isinstance(row, dict) and set(row) == {"id", *OBSERVATION_KEYS} and
                isinstance(row.get("id"), str) and row["id"] in expected and row["id"] not in seen,
                "Return each original check exactly once without changing its definition.")
        seen.add(row["id"])
        require(row["state"] in STATES, "Use an original native observation state.")
        string(row["operator"], "named observer", 500)
        string(row["note"], "observation note", 8000)
        observed = row["observedAt"]
        if observed is not None:
            require(isinstance(observed, str) and bool(re.fullmatch(
                r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)", observed)),
                "Use an ISO observation timestamp with its actual timezone.")
            try:
                parsed = datetime.datetime.fromisoformat(observed.replace("Z", "+00:00"))
                require(parsed.tzinfo is not None, "Retain the observation timezone.")
            except ValueError as exc:
                raise R.ReportError("The actual observation timestamp is invalid.") from exc
        for key in LINK_KEYS:
            require(R.equal(row[key], expected[row["id"]][key]),
                    "The company editor retains original native record links: " + key)
        if complete and row["state"] == "ACCEPTED":
            require(row["operator"].strip() and observed and row["note"].strip(),
                    "An accepted observation needs its actual operator, timestamp and note.")
        if complete and row["state"] == "NOT_APPLICABLE":
            require(row["note"].strip(), "Explain an inapplicable check.")
    return value


def compare(selected, returned):
    before = {row["id"]: row for row in seed_inputs(selected)["observations"]}
    after = {row["id"]: row for row in returned["inputs"]["observations"]}
    definitions = {row["id"]: row for row in selected["document"]["checks"]}
    rows = []
    for identity, original in before.items():
        proposed = after[identity]
        differences = [{"field": key, "original": copy.deepcopy(original[key]),
                        "proposed": copy.deepcopy(proposed[key])}
                       for key in OBSERVATION_KEYS if not R.equal(original[key], proposed[key])]
        rows.append({"id": identity, "definition": {key: copy.deepcopy(definitions[identity][key]) for key in DEFINITION_KEYS},
                     "original": copy.deepcopy(original), "proposed": copy.deepcopy(proposed),
                     "changed": bool(differences), "differences": differences})
    return {"schema": SCHEMA + ".comparison", "return_id": returned["return_id"],
            "report_sha256": selected["archive"].sha256, "binding": copy.deepcopy(returned["binding"]),
            "checks": rows, "check_count": len(rows), "changed_checks": sum(row["changed"] for row in rows),
            "proposed_changes": sum(len(row["differences"]) for row in rows),
            "previous_return_sha256": returned["previous_return_sha256"],
            "state": "PROPOSED_FOR_NATIVE_OWNER_REVIEW"}


def comparison_html(comparison):
    esc = lambda value: html.escape(str(value), quote=True)
    chunks = ["<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
              "<title>Proposed Installation return</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:20px;color:#172338}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f4f8;padding:14px}section{border-top:1px solid #ccd4df;padding:16px 0}h1,h2{line-height:1.25}</style>",
              "<h1>Proposed Installation observations</h1><p>Company: " + esc(comparison["binding"]["company_case_id"]) +
              "</p><p>Return: " + esc(comparison["return_id"]) + "</p>",
              "<p>" + str(comparison["check_count"]) + " complete original checks; " +
              str(comparison["changed_checks"]) + " have proposed changes. The native owner reviews each check before saving a revision.</p>"]
    for row in comparison["checks"]:
        chunks.extend(["<section><h2>" + esc(row["definition"]["title"]) + "</h2><p>" +
                       esc(row["definition"]["criterion"]) + "</p><p>" + esc(row["id"]) +
                       "</p><h3>Original</h3><pre>" + esc(json.dumps(row["original"], ensure_ascii=False, indent=2)) +
                       "</pre><h3>Proposed</h3><pre>" + esc(json.dumps(row["proposed"], ensure_ascii=False, indent=2)) +
                       "</pre><h3>All changes</h3><pre>" + esc(json.dumps(row["differences"], ensure_ascii=False, indent=2)) +
                       "</pre></section>"])
    return "".join(chunks).encode("utf-8")


def software_files():
    root = pathlib.Path(__file__).resolve().parent
    return {**{"software/" + name: R.regular_bytes(root / name, R.MAX_MEMBER) for name in SOFTWARE},
            "software/customer_reporting.py": trusted_reporting()}


def editor_html(selected, report_raw, ui, return_seed):
    seed = {"schema": SCHEMA, "binding": selected["manifest"]["binding"],
            "report_sha256": digest(report_raw), "report_base64": base64.b64encode(report_raw).decode("ascii"),
            "document": selected["document"], "checks": selected["document"]["checks"], "inputs": seed_inputs(selected),
            "return_seed": return_seed}
    data = json.dumps(seed, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    title = html.escape(str(selected["manifest"]["binding"]["company_case_id"]))
    return ("""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Company Installation return</title><style>
*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;color:#182c42;background:#f3f6fa;margin:0}
main{max-width:1000px;margin:auto;padding:32px 20px 70px}h1{font-size:2rem;line-height:1.2}
header,.check,.panel{background:white;border:1px solid #cdd7e3;border-radius:12px;padding:22px;margin:18px 0}
label{display:block;font-weight:650;margin:16px 0}input,textarea,select{display:block;font:inherit;color:inherit;padding:10px;border:1px solid #92a1b4;border-radius:5px;width:100%;margin-top:5px}textarea{min-height:100px}
button,.file{font:inherit;display:inline-block;background:#174b72;color:white;border:0;border-radius:5px;padding:10px 14px;margin:5px 8px 5px 0;cursor:pointer}.small{background:#edf2f8;color:#193754;font-size:14px}
.file input{max-width:100%;font-size:13px;background:white;color:#182c42}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf2f8;padding:15px}.muted{color:#53667a}.error{background:#ffe8e5;color:#7a1610;padding:16px}.note{background:#e9f2fc;padding:16px}summary{cursor:pointer;font-weight:650}
@media(max-width:500px){main{padding:12px}header,.check,.panel{padding:16px}h1{font-size:1.6rem}button,.file{width:100%;margin-right:0}}
</style></head><body><main><header><h1>Installation observation return</h1><p>""" + title + """</p>
<p>Record the work you actually observed. The complete original report and check definitions stay attached. The operator reviews every proposed change through the native Installation workflow.</p>
<p>Return ID: <code id="return-id"></code></p><p id="previous"></p><p id="summary"></p></header>
<div id="status" class="note" role="status"></div><section class="panel"><h2>Receiving details</h2>
<label for="name">Return name<input id="name" maxlength="300"></label>
<label for="recipient">Intended receiving owner<input id="recipient" maxlength="500"></label>
<label for="environment">Actual application, host and configuration<textarea id="environment" maxlength="8000"></textarea></label>
<label for="note">Complete receiving note<textarea id="note" maxlength="12000"></textarea></label></section>
<div id="checks"></div><section class="panel"><h2>Retain and return this edition</h2>
<button id="download-draft" type="button">Download complete draft</button><button id="download-return" type="button">Download proposed return</button>
<label class="file">Reopen this draft or return<input id="import-draft" type="file" accept=".json,application/json"></label>
<label class="file">Start a corrected edition from a prior return<input id="correct-return" type="file" accept=".json,application/json"></label>
<button id="download-original" type="button">Download original company report</button>
<p>Keep the original JSON bytes when sending a return. To correct an already submitted return, import it using the corrected-edition control; that retains its exact SHA-256 and creates a distinct return ID. No information leaves this page automatically.</p>
<details><summary>Complete original Installation document</summary><pre id="original-document"></pre></details></section>
</main><script id="return-seed" type="application/json">""" + data + "</script><script>" +
            ui.decode("utf-8").replace("</script", "<\\/script") + "</script></body></html>").encode("utf-8")


def author(report_raw, report_sha256, output, operation_id):
    selected = read_report(report_raw, report_sha256)
    string(operation_id, "original author operation", 300, True)
    files = software_files()
    return_seed = {"schema": SCHEMA, "report_sha256": digest(report_raw),
                   "binding": copy.deepcopy(selected["manifest"]["binding"]),
                   "return_id": str(uuid.uuid5(uuid.NAMESPACE_URL, SCHEMA + "/" + operation_id + "/" + digest(report_raw))),
                   "previous_return_sha256": None, "inputs": seed_inputs(selected)}
    html_raw = editor_html(selected, report_raw, files["software/customer-return-ui.js"], return_seed)
    selection = {"schema": SCHEMA + ".author-selection", "operation_id": operation_id,
                 "report_sha256": digest(report_raw), "report_bytes": len(report_raw),
                 "binding": selected["manifest"]["binding"], "return_seed": return_seed,
                 "checks": [{key: copy.deepcopy(row[key]) for key in DEFINITION_KEYS} for row in selected["document"]["checks"]],
                 "software": [{"path": name, "bytes": len(raw), "sha256": digest(raw)} for name, raw in sorted(files.items())]}
    with R.operation_directory(output) as out:
        R.retain(out, "selection.json", packed(selection))
        R.retain(out, "Original_Company_Report.zip", report_raw)
        R.retain(out, "Company_Return.html", html_raw)
        for name, raw in files.items():
            R.retain(out, name, raw)
        result = {"schema": SCHEMA + ".author-result", **selection, "schema": SCHEMA + ".author-result",
                  "editor": {"path": "Company_Return.html", "bytes": len(html_raw), "sha256": digest(html_raw)},
                  "checks": len(selected["document"]["checks"])}
        R.retain(out, "complete-result.json", packed(result))
        return result


def return_files(report_raw, return_raw, selected, value, software, previous_raw=None):
    if value["previous_return_sha256"] is not None:
        require(previous_raw is not None and digest(previous_raw) == value["previous_return_sha256"],
                "Include the exact prior return JSON for this corrected edition.")
        previous = validate_return(selected, previous_raw)
        require(previous["return_id"] != value["return_id"], "A correction needs a distinct return identity.")
    else:
        require(previous_raw is None, "An initial return cannot silently adopt an unrelated prior file.")
    comparison = compare(selected, value)
    readme = ("# Proposed Installation return\n\nCompany: " + value["binding"]["company_case_id"] +
              "\n\nReturn ID: " + value["return_id"] +
              "\n\nOpen RETURN.html for every original and proposed check. Original_Company_Report.zip contains the full original company report. RETURN.json is the exact received file; its whitespace and bytes are preserved. COMPARISON.json contains every observation field difference.\n\nThe native owner records this proposed return, reviews every check with KEEP or APPLY and then previews and saves any selected Installation revision. A proposed ACCEPTED observation does not itself approve an Installation, payment or Workshare.\n").encode("utf-8")
    return {**software, **({"previous/RETURN.json": previous_raw} if previous_raw is not None else {}),
            "Original_Company_Report.zip": report_raw, "RETURN.json": return_raw,
            "COMPARISON.json": packed(comparison), "RETURN.html": comparison_html(comparison), "README.md": readme}


def package_return(report_raw, report_sha256, return_raw, output, previous_raw=None):
    selected = read_report(report_raw, report_sha256)
    value = validate_return(selected, return_raw)
    files = return_files(report_raw, return_raw, selected, value, software_files(), previous_raw)
    manifest = {"schema": PACKAGE, "return_id": value["return_id"], "binding": value["binding"],
                "report_sha256": digest(report_raw), "returned_json_sha256": digest(return_raw),
                "previous_return_sha256": value["previous_return_sha256"],
                "files": [{"path": name, "bytes": len(raw), "sha256": digest(raw)} for name, raw in sorted(files.items())]}
    files["manifest.json"] = packed(manifest)
    raw = R.zip_bytes(files)
    # Independently reconstruct the complete member roster and comparisons before publication.
    read_return(raw, digest(raw))
    filename = "Installation_Return_" + value["return_id"] + ".zip"
    with R.operation_directory(output) as out:
        R.retain(out, "selection.json", packed({"schema": PACKAGE + ".selection",
                 "return_id": value["return_id"], "report_sha256": digest(report_raw),
                 "returned_json_sha256": digest(return_raw), "manifest_sha256": digest(files["manifest.json"])}))
        R.retain(out, filename, raw)
        R.retain(out, filename + ".sha256", (digest(raw) + "  " + filename + "\n").encode("ascii"))
        result = {"schema": PACKAGE + ".result", "return_id": value["return_id"], "binding": value["binding"],
                  "filename": filename, "bytes": len(raw), "sha256": digest(raw),
                  "report_sha256": digest(report_raw), "returned_json_sha256": digest(return_raw),
                  "manifest_sha256": digest(files["manifest.json"]), "checks": len(value["inputs"]["observations"]),
                  "state": "PROPOSED_FOR_NATIVE_OWNER_REVIEW"}
        R.retain(out, "complete-result.json", packed(result))
        return result


def read_return(raw, expected_sha256):
    archive = R.Archive(raw, expected_sha256)
    manifest = archive.json("manifest.json")
    require(manifest.get("schema") == PACKAGE, "Select a complete proposed-return package.")
    rows = R.indexed(manifest.get("files"), "path", "return package member")
    require(set(rows) | {"manifest.json"} == set(archive.entries), "The full return package roster differs.")
    files = {}
    for name, row in rows.items():
        body = archive.read(name)
        require(len(body) == row.get("bytes") and digest(body) == row.get("sha256"), "Return member changed: " + name)
        files[name] = body
    required_software = {"software/" + name for name in SOFTWARE} | {"software/customer_reporting.py"}
    require(required_software.issubset(files), "Keep the complete portable return source.")
    require(digest(files["software/customer_reporting.py"]) == REPORTING_SHA, "Retain the original reporting receiver.")
    selected = read_report(files["Original_Company_Report.zip"], manifest["report_sha256"])
    value = validate_return(selected, files["RETURN.json"])
    require(value["return_id"] == manifest.get("return_id") and R.equal(value["binding"], manifest.get("binding")) and
            digest(files["RETURN.json"]) == manifest.get("returned_json_sha256") and
            value["previous_return_sha256"] == manifest.get("previous_return_sha256"),
            "The returned original file binding differs.")
    rebuilt = return_files(files["Original_Company_Report.zip"], files["RETURN.json"], selected, value,
                           {name: files[name] for name in required_software}, files.get("previous/RETURN.json"))
    require(set(rebuilt) == set(files) and all(rebuilt[name] == files[name] for name in files),
            "The complete proposed-return comparison or source roster differs.")
    return {"archive": archive, "manifest": manifest, "files": files, "report": selected, "returned": value,
            "comparison": compare(selected, value)}


def receive_package(raw, expected_sha256, output):
    selected = read_return(raw, expected_sha256)
    with R.operation_directory(output) as out:
        selection = {"schema": PACKAGE + ".receiving-selection", "sha256": digest(raw), "bytes": len(raw),
                     "manifest_sha256": digest(selected["archive"].read("manifest.json")),
                     "return_id": selected["returned"]["return_id"], "binding": selected["returned"]["binding"]}
        R.retain(out, "selection.json", packed(selection))
        R.retain(out, "original-return.zip", raw)
        for name in selected["archive"].entries:
            R.retain(out, "package/" + name, selected["archive"].read(name))
        result = {**selection, "schema": PACKAGE + ".receiving-result",
                  "members": len(selected["archive"].entries), "checks": selected["comparison"]["check_count"],
                  "changed_checks": selected["comparison"]["changed_checks"],
                  "state": "PROPOSED_FOR_NATIVE_OWNER_REVIEW"}
        R.retain(out, "complete-result.json", packed(result))
        return result



def submission(raw, expected_sha256, source_id=None):
    """Describe the whole proposed input for an existing native application owner."""
    selected = read_return(raw, expected_sha256)
    returned = selected["returned"]
    inputs = copy.deepcopy(returned["inputs"])
    if source_id is not None:
        require(isinstance(source_id, str) and re.fullmatch(r"source-[a-f0-9]{32}", source_id),
                "Use the actual retained native source identity.")
        for row in inputs["observations"]:
            row["sourceIds"] = list(dict.fromkeys([*row["sourceIds"], source_id]))
    original = selected["files"]["RETURN.json"]
    return {"schema": SCHEMA + ".native-submission", "return_id": returned["return_id"],
            "archive_sha256": digest(raw), "archive_bytes": len(raw),
            "report_sha256": returned["report_sha256"], "returned_json_sha256": digest(original),
            "binding": copy.deepcopy(returned["binding"]), "inputs": inputs,
            "retained_source_id": source_id,
            "source_link_policy": "append_original_return_json_to_every_observation",
            "source": {"filename": "customer-return-" + returned["return_id"] + ".json",
                       "mediaType": "application/json", "kind": "other", "sourceUrl": "",
                       "contentBase64": base64.b64encode(original).decode("ascii")},
            "comparison": copy.deepcopy(selected["comparison"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    for name in ("author", "pack", "receive", "inspect", "submission"):
        command = sub.add_parser(name)
        command.add_argument("--archive", required=True, help="Exact original company report (author/pack) or returned ZIP (receive/inspect)")
        command.add_argument("--sha256", required=True)
        if name not in ("inspect", "submission"):
            command.add_argument("--output", required=True)
        if name == "author":
            command.add_argument("--operation-id", required=True)
        if name == "pack":
            command.add_argument("--return-json", required=True)
            command.add_argument("--previous-return", help="Exact preceding return JSON for a corrected edition")
        if name == "submission":
            command.add_argument("--source-id")
    args = parser.parse_args()
    raw = R.regular_bytes(args.archive)
    if args.action == "author":
        result = author(raw, args.sha256, args.output, args.operation_id)
    elif args.action == "pack":
        result = package_return(raw, args.sha256, R.regular_bytes(args.return_json, 8 * 1024 * 1024), args.output,
                                R.regular_bytes(args.previous_return, 8 * 1024 * 1024) if args.previous_return else None)
    elif args.action == "receive":
        result = receive_package(raw, args.sha256, args.output)
    elif args.action == "submission":
        result = submission(raw, args.sha256, args.source_id)
    else:
        selected = read_return(raw, args.sha256)
        result = {"manifest": selected["manifest"], "comparison": selected["comparison"]}
    print(packed(result).decode("utf-8"), end="")


if __name__ == "__main__":
    try:
        main()
    except (R.ReportError, OSError, KeyError, TypeError) as exc:
        raise SystemExit(str(exc)) from exc
