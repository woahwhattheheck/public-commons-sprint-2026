#!/usr/bin/env python3
"""MIT. Complete authored invoice example through the original retained application."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile, zipfile
from xml.sax.saxutils import escape

EXAMPLE = json.loads("{\"source1\":[[\"Worklog ID\",\"Customer\",\"Service code\",\"Work date\",\"Logged time\",\"Billing status\"],[\"w-101\",\"client-north\",\"Engineering\",\"2026-09-04\",\"03:30\",\"Billable\"],[\"w-102\",\"client-north\",\"Engineering\",\"2026-09-07\",\"02:15\",\"Billable\"],[\"w-103\",\"client-north\",\"Support\",\"2026-09-11\",\"01:20\",\"Billable\"],[\"w-104\",\"client-north\",\"Engineering\",\"2026-09-12\",\"01:00\",\"Internal\"],[\"w-105\",\"client-north\",\"Support\",\"2026-09-16\",\"00:40\",\"Billable\"]],\"source2\":[[\"Worklog ID\",\"Customer\",\"Service code\",\"Work date\",\"Logged time\",\"Billing status\"],[\"w-101-oct\",\"client-north\",\"Engineering\",\"2026-10-04\",\"03:30\",\"Billable\"],[\"w-102-oct\",\"client-north\",\"Engineering\",\"2026-10-07\",\"02:45\",\"Billable\"],[\"w-103-oct\",\"client-north\",\"Support\",\"2026-10-11\",\"01:20\",\"Billable\"],[\"w-104-oct\",\"client-north\",\"Engineering\",\"2026-10-12\",\"01:00\",\"Internal\"],[\"w-105-oct\",\"client-north\",\"Support\",\"2026-10-16\",\"00:40\",\"Billable\"]],\"contract\":{\"version\":1,\"owner\":\"Example billing operator\",\"period\":\"2026-09\",\"currency\":\"USD\",\"currency_scale\":2,\"rounding\":\"HALF_UP\",\"round_at\":\"invoice_line\",\"worklogs\":{\"sheet\":\"Detailed worklogs\",\"header_row\":3,\"identity\":\"worklog_id\",\"date_encoding\":\"iso-date\",\"duration_unit\":\"hh:mm\",\"billable_values\":[\"Billable\"],\"nonbillable_values\":[\"Internal\"],\"columns\":{\"worklog_id\":\"Worklog ID\",\"customer\":\"Customer\",\"line\":\"Service code\",\"date\":\"Work date\",\"duration\":\"Logged time\",\"billable\":\"Billing status\"}},\"invoices\":{\"header_row\":1,\"duration_unit\":\"hours\",\"columns\":{\"customer\":\"Client code\",\"currency\":\"Currency\",\"period\":\"Billing month\",\"line\":\"Service\",\"duration\":\"Hours\",\"net_amount\":\"Net\"}},\"rates\":[{\"customer\":\"client-north\",\"line\":\"Engineering\",\"hourly_rate\":\"120.00\"},{\"customer\":\"client-north\",\"line\":\"Support\",\"hourly_rate\":\"90.00\"}]},\"fixtures\":{\"september-invoices-first.csv\":\"Client code,Currency,Billing month,Service,Hours,Net\\nclient-north,USD,2026-09,Engineering,5.5,660.00\\nclient-north,USD,2026-09,Support,2,180.00\\n\",\"september-invoices-corrected.csv\":\"Client code,Currency,Billing month,Service,Hours,Net\\nclient-north,USD,2026-09,Engineering,5.75,690.00\\nclient-north,USD,2026-09,Support,2,180.00\\n\",\"october-invoices.csv\":\"Client code,Currency,Billing month,Service,Hours,Net\\nclient-north,USD,2026-10,Engineering,6.25,750.00\\nclient-north,USD,2026-10,Support,2,180.00\\n\"}}")

def workbook(path, table):
    rows = [["Authored example for Worklogs invoice receiving"], [], *table]
    rendered = []
    for number, row in enumerate(rows, 1):
        cells = [f'<c r="{chr(65+column)}{number}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
                 for column, value in enumerate(row)]
        rendered.append(f'<row r="{number}">{"".join(cells)}</row>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Detailed worklogs" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(rendered) + '</sheetData></worksheet>')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="A new private directory; its parent must exist.")
    args = parser.parse_args()
    root = pathlib.Path(args.output).resolve()
    root.mkdir(mode=0o700)
    profile = pathlib.Path(__file__).resolve().parent
    repository = profile.parents[3]
    (root/"tmp").mkdir(mode=0o700)
    os.environ["TMPDIR"] = str(root/"tmp")
    node = shutil.which("node") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE")
    if not node:
        raise ValueError("Node.js 22+ is required.")
    def call(arguments, accept=(0,)):
        run = subprocess.run(arguments, cwd=repository, capture_output=True, text=True, timeout=90)
        if run.returncode not in accept:
            raise RuntimeError(json.dumps({"returncode":run.returncode, "stdout":run.stdout, "stderr":run.stderr}))
        return json.loads(run.stdout)
    fixtures = root/"original-examples"; fixtures.mkdir(mode=0o700)
    workbook(fixtures/"september-worklogs.xlsx", EXAMPLE["source1"])
    workbook(fixtures/"october-worklogs.xlsx", EXAMPLE["source2"])
    for name, content in EXAMPLE["fixtures"].items():
        (fixtures/name).write_text(content, encoding="utf-8")
    contract = EXAMPLE["contract"]
    (fixtures/"september-contract.json").write_text(json.dumps(contract, indent=2))
    october = json.loads(json.dumps(contract)); october["period"] = "2026-10"
    (fixtures/"october-contract.json").write_text(json.dumps(october, indent=2))
    operator = profile.parents[1]/"service/operator.mjs"
    customer = root/"customer"
    records = []
    for edition, month, invoice, expected in [
        ("september-first","september","september-invoices-first.csv","FAIL"),
        ("september-correction","september","september-invoices-corrected.csv","PASS"),
        ("october","october","october-invoices.csv","PASS")]:
        prepared = root/edition
        preparation = call([sys.executable,str(profile/"prepare.py"),"prepare",
          "--worklogs",str(fixtures/(month+"-worklogs.xlsx")),
          "--invoices",str(fixtures/invoice),
          "--contract",str(fixtures/(month+"-contract.json")),"--output",str(prepared)])
        job = "worklogs-" + edition
        command = [node,str(profile/"receive.mjs"),"--prepared",str(prepared),"--directory",str(customer),"--job-id",job]
        if edition == "september-correction":
            command += ["--previous-job-id","worklogs-september-first","--correction-reason","Restore the missing 15 minutes and USD 30 on the original September Engineering invoice line."]
        receiving = call(command,(0,2))
        if receiving["job"]["state"] != "COMPLETED" or receiving["comparison"]["status"] != expected:
            raise ValueError("The authored example differs from its expected complete comparison: " + edition)
        report = call([node,str(operator),"export","--directory",str(customer),"--job-id",job,
          "--destination",str(root/(edition+"-report.json"))])
        review = call([node,str(operator),"review","--directory",str(customer),"--job-id",job,
          "--report-sha256",report["sha256"],"--reviewer","Authored receiving example operator",
          "--decision","changes_requested" if expected == "FAIL" else "accepted",
          "--note","Reviewed complete authored time and invoice exports; September's first invoice requires the missing 15 minutes and USD 30." if expected == "FAIL" else "Reviewed the complete authored period and agreed billing contract."])
        exported = call([node,str(operator),"export-replay","--directory",str(customer),"--job-id",job,
          "--destination",str(root/(edition+"-replay"))])
        replay = call([node,str(root/(edition+"-replay")/"replay.mjs"),
          "--manifest-sha256",exported["manifest"]["sha256"]],(0,2))
        if not replay["matchesDeliveredReport"]:
            raise ValueError("The original report did not reproduce.")
        record = {"edition":edition,"preparation":preparation,"job_id":job,"status":expected,
          "mapping_revision":receiving["mappingRevision"],"previous":receiving["previous"],
          "report":report,"review":review,"replay":replay,"export_manifest":exported["manifest"]}
        records.append(record)
        print(json.dumps({"edition":edition,"status":expected,"expected_net_amount":preparation["expected_net_amount"],
          "previous":receiving["previous"],"replay_matches":True}),flush=True)
    result = {"schema":"worklogs-authored-receiving.v1","input_class":"Authored operator example",
      "runtime":subprocess.check_output([node,"--version"],text=True).strip(),
      "directory":str(root),"runs":records}
    (root/"receiving.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"complete":True,"result":str(root/"receiving.json"),"customer":str(customer),
      "launch":[node,str(profile.parents[1]/"scap-workspace/cli.mjs"),"--directory",str(customer),
        "--profile",str(root/"october/workspace-profile.json"),"--port","0"]}),flush=True)

if __name__ == "__main__":
    main()
