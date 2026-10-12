#!/usr/bin/env python3
"""MIT. Receive original BIFF8 formula bytes and the complete DTS8D format path.

The upstream workbook is an xlrd software fixture. The 150-field DTS workbook is
a generated software-format fixture, not a laboratory delivery. No source fetch,
spreadsheet application, package installer or formula evaluator is invoked.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys

HERE = Path(__file__).resolve().parent
UPSTREAM_SHA = "318ce6ee18977add9852993aea79e41a9ddea9131e3f9bcc85febbca3e4059e0"
OPERATION = "GEOTECH-DTS8D-LEGACY-XLS-9F77-20261012"

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def exact(path, body):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        assert path.is_file() and not path.is_symlink() and path.read_bytes() == body, path
        return
    temporary = path.with_name("." + path.name + ".prepare-" + str(os.getpid()))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(body); target.flush(); os.fsync(target.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            assert path.is_file() and not path.is_symlink() and path.read_bytes() == body, path
    finally:
        temporary.unlink(missing_ok=True)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(parent)
    finally: os.close(parent)

def receipt(body):
    return {"bytes":len(body), "sha256":hashlib.sha256(body).hexdigest()}

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

def record(code, body):
    assert len(body) <= 8224
    return struct.pack("<HH", code, len(body)) + body

def compound(stream):
    """Small unencrypted CFB container for this explicitly generated BIFF fixture."""
    stream = stream.ljust(4096, b"\0")
    count = (len(stream) + 511) // 512
    assert count + 2 <= 128
    free, end, fat_marker = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD
    header = bytearray(512)
    header[:8] = bytes.fromhex("d0cf11e0a1b11ae1")
    struct.pack_into("<HHHHH", header, 24, 0x003E, 3, 0xFFFE, 9, 6)
    struct.pack_into("<IIIIIIIII", header, 40, 0, 1, count, 0, 4096, end, 0, end, 0)
    struct.pack_into("<109I", header, 76, count+1, *([free]*108))
    directory = bytearray(512)
    def entry(index, name, kind, child, start, size):
        at = index * 128
        encoded = (name + "\0").encode("utf-16-le")
        directory[at:at+len(encoded)] = encoded
        struct.pack_into("<HBBIII", directory, at+64, len(encoded), kind, 1, free, free, child)
        struct.pack_into("<IQ", directory, at+116, start, size)
    entry(0, "Root Entry", 5, 1, end, 0)
    entry(1, "Workbook", 2, free, 0, len(stream))
    fat = [index+1 for index in range(count)]
    fat[-1] = end
    fat += [end, fat_marker]
    fat += [free] * (128-len(fat))
    return bytes(header) + stream.ljust(count*512,b"\0") + bytes(directory) + struct.pack("<128I",*fat)

def generated(original, definitions, formulas=False):
    """Reuse actual upstream BIFF formatting records; generate declared test cells."""
    retained = [(code, payload) for code,payload,_ in original.records(0)
                if code in (0x0809,0x0031,0x041E,0x00E0,0x0293,0x0042)]
    assert retained and retained[0][0] == 0x0809
    xfs = [payload for code,payload in retained if code == 0x00E0]
    assert xfs
    # A native date style using Excel's original built-in calendar format.
    date_xf = len(xfs)
    date_style = bytearray(xfs[-1]); struct.pack_into("<H",date_style,2,14)
    retained.append((0x00E0,bytes(date_style)))
    globals_before = b"".join(record(code,payload) for code,payload in retained)
    globals_before += record(0x0022,struct.pack("<H",1))
    name = "DTS8D"
    def bounds(position):
        return record(0x0085,struct.pack("<IBBB",position,0,0,len(name))+b"\x01"+name.encode("utf-16-le"))
    position = len(globals_before) + len(bounds(0)) + 4
    globals_bytes = globals_before + bounds(position) + record(0x000A,b"")
    worksheet_bof = next(payload for code,payload,_ in original.records(original.sheets[0]["offset"]) if code==0x0809)
    cells = [record(0x0809,worksheet_bof)]
    default_xf = min(15,len(xfs)-1)
    def label(row,column,value,xf=default_xf):
        assert len(value)<32768
        return record(0x0204,struct.pack("<HHHHB",row,column,xf,len(value),1)+value.encode("utf-16-le"))
    def number(row,column,value,xf=default_xf):
        return record(0x0203,struct.pack("<HHHd",row,column,xf,value))
    for column, definition in enumerate(definitions):
        cells.append(label(0,column,definition["name"]))
    for column, definition in enumerate(definitions):
        name,kind = definition["name"],definition["type"]
        if name == "SampleTypeCode": continue
        if name == "Value": value = "001.2300"
        elif name == "Description": value = "original\rline\n_x000D_ literal"
        else: value = "format-"+str(column+1)
        if kind in ("int16","int32","float32","float64"):
            cells.append(number(1,column,1.25 if kind.startswith("float") else 1))
        elif kind == "datetime": cells.append(number(1,column,45000.5,date_xf))
        else: cells.append(label(1,column,value))
    # A physically present blank row, then a distinct, sparsely populated row.
    cells.append(record(0x0208,struct.pack("<HHHHHHI",2,0,0,300,0,0,0x20)))
    cells.append(label(3,0,"original-row-four"))
    value_column = next(i for i,field in enumerate(definitions) if field["name"]=="Value")
    description_column = next(i for i,field in enumerate(definitions) if field["name"]=="Description")
    if formulas:
        tokens = b"\x1e\x02\x00\x1e\x03\x00\x03"  # Native ptgInt(2), ptgInt(3), ptgAdd.
        payload = struct.pack("<HHHdHIH",3,value_column,default_xf,5.0,0,0,len(tokens))+tokens
        cells.append(record(0x0006,payload))
        cells.append(record(0x0205,struct.pack("<HHHBB",3,description_column,default_xf,7,1)))
    else:
        cells.append(label(3,value_column,"<0.0100"))
        cells.append(label(3,description_column,"unchanged value"))
    cells.append(record(0x000A,b""))
    return compound(globals_bytes+b"".join(cells))

def decode(bridge, path):
    body=path.read_bytes()
    with path.open("rb") as original:
        return json.loads(bridge.native_result(original,{"schema":bridge.SCHEMA,"operation":"decode",
            "filename":path.name,"source":receipt(body)}))

def render(bridge,path,table,definitions,changes=None):
    changes=changes or {}
    rows=[]
    for row in table["records"]:
        fields=list(row["fields"]); literal=[]
        for column in range(1,len(fields)+1):
            key=(row["rowNumber"],column)
            if key in changes:
                fields[column-1]=changes[key];literal.append(column)
        rows.append({"rowNumber":row["rowNumber"],"fields":fields,"literalColumns":literal})
    with path.open("rb") as original:
        result=bridge.native_result(original,{"schema":bridge.SCHEMA,"operation":"render","filename":path.name,
            "source":receipt(path.read_bytes()),"sheetName":table["origin"]["sheetName"],
            "headers":table["headers"],"fieldTypes":[field["type"] for field in definitions],"rows":rows})
    return result,rows


def cli_receiving(out, node, definitions, bridge):
    """Operate the original full CLI and result reader on the retained format source."""
    import csv
    import subprocess
    import zipfile
    node=Path(node).resolve(strict=True)
    directory=out/"cli";directory.mkdir(mode=0o700,exist_ok=True)
    scratch=directory/"scratch";scratch.mkdir(mode=0o700,exist_ok=True)
    source=out/"explicit-formula-values.xls"
    source_bytes=source.read_bytes()
    source_identity=receipt(source_bytes)
    env={**os.environ,"LAB_EDD_PYTHON":sys.executable,"LAB_EDD_TEMP_ROOT":str(scratch)}
    calls=[]
    def run(name,*arguments):
        command=[str(node),"--max-old-space-size=192",str(HERE/"cli.mjs"),*map(str,arguments)]
        completed=subprocess.run(command,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE,timeout=180)
        record={"name":name,"command":command,"exitCode":completed.returncode,
                "stdout":completed.stdout.decode("utf-8"),"stderr":completed.stderr.decode("utf-8")}
        calls.append(record)
        exact(directory/(name+".command.json"),json_bytes(record))
        if completed.returncode:
            raise RuntimeError("The original CLI operation failed: "+name+"\n"+record["stderr"])
        return completed.stdout
    common=["--source",source,"--profile","geotech-dts8d"]
    run("inspect","inspect",*common,"--out",directory/"inspection.json")
    inspection=json.loads((directory/"inspection.json").read_bytes())
    source_sha=inspection["source"]["sourceSha256"]
    run("editable-original","table",*common,"--scope","all","--format","tsv",
        "--out",directory/"original-decisions.tsv")
    with (directory/"original-decisions.tsv").open(newline="",encoding="utf-8") as original:
        rows=list(csv.reader(original,delimiter="\t"))
    header=rows[0];indices={name:index for index,name in enumerate(header)}
    assert rows[1][indices["kind"]]=="source"
    assert len(rows[2:])==300
    choices=[]
    for row in rows[2:]:
        if row[indices["row"]]=="4" and row[indices["field"]] in ("value","description"):
            row[indices["action"]]="set"
            row[indices["value"]]=("001.2300" if row[indices["field"]]=="value" else "reviewed\rline\n_x000D_")
            row[indices["reason"]]="Explicit literal from the complete labelled native format receiving; retain the original BIFF cell and cached result."
            choices.append({"recordId":row[indices["record_id"]],"field":row[indices["field"]],
                            "before":row[indices["before"]],"value":row[indices["value"]]})
    assert len(choices)==2
    edited=io.StringIO(newline="")
    csv.writer(edited,delimiter="\t",lineterminator="\r\n").writerows(rows)
    exact(directory/"reviewed-decisions.tsv",edited.getvalue().encode("utf-8"))
    run("initial-receive","receive",*common,"--scope","all","--review","dts8d-legacy-original",
        "--out",directory/"original-result.zip")
    run("initial-reopen","result","--file",directory/"original-result.zip",
        "--out",directory/"original-result.json")
    original_result=json.loads((directory/"original-result.json").read_bytes())
    assert original_result["manifest"]["nativePreparation"]["status"]=="REVIEW_REQUIRED"
    with zipfile.ZipFile(directory/"original-result.zip") as retained:
        assert "report.html" in retained.namelist() and "decisions.tsv" in retained.namelist()
        assert retained.read(original_result["manifest"]["originalMembers"]["source"])==source_bytes
    run("preview","preview",*common,"--decisions",directory/"reviewed-decisions.tsv","--format","tsv",
        "--out",directory/"preview.json")
    preview=json.loads((directory/"preview.json").read_bytes())["review"]
    assert preview["source"]["sourceSha256"]==source_sha and preview["changes"]["set"]==2
    for kind in ("csv","tsv"):
        path=directory/("complete-decisions."+kind)
        run("table-"+kind,"table",*common,"--decisions",directory/"reviewed-decisions.tsv",
            "--scope","all","--format",kind,"--out",path)
        run("roundtrip-"+kind,"preview",*common,"--decisions",path,"--format",kind,
            "--out",directory/("preview-"+kind+".json"))
        recovered=json.loads((directory/("preview-"+kind+".json")).read_bytes())["review"]
        assert recovered["document"]==preview["document"] and recovered["reviewSha256"]==preview["reviewSha256"]
    run("reviewed-receive","receive",*common,"--scope","all","--review","dts8d-legacy-reviewed",
        "--decisions",directory/"complete-decisions.tsv","--format","tsv",
        "--out",directory/"reviewed-result.zip")
    run("reviewed-reopen","result","--file",directory/"reviewed-result.zip",
        "--out",directory/"reviewed-result.json")
    received=json.loads((directory/"reviewed-result.json").read_bytes())
    manifest=received["manifest"]
    assert manifest["sourceSha256"]==source_sha
    assert manifest["reviewSha256"]==preview["reviewSha256"]
    assert manifest["documentSha256"]==preview["documentSha256"]
    assert manifest["nativePreparation"]["status"]=="PREPARED"
    expected={"filename":source.name,"bytes":len(source_bytes),"sha256":source_identity["sha256"]}
    native_record=manifest["prepared"]["files"][0]
    assert native_record["filename"]==source.name+".xlsx" and native_record["sourceFile"]==expected
    assert native_record["formatConversion"]=={"from":"xls-biff8","to":"xlsx","profileId":"geotech-dts8d","originalRetained":True}
    assert manifest["nativePreparation"]["conversions"]==[
        {"filename":native_record["filename"],"sourceFile":expected,**native_record["formatConversion"]}]
    with zipfile.ZipFile(directory/"reviewed-result.zip") as retained:
        assert retained.read(manifest["originalMembers"]["source"])==source_bytes
        assert json.loads(retained.read("decisions.json"))==preview["document"]
        native_archive=retained.read(manifest["prepared"]["archive"])
        assert receipt(native_archive)=={"bytes":manifest["prepared"]["bytes"],"sha256":manifest["prepared"]["sha256"]}
        with zipfile.ZipFile(io.BytesIO(native_archive)) as native_zip:
            assert native_zip.namelist()==[source.name+".xlsx"]
            native=native_zip.read(source.name+".xlsx")
        native_path=directory/(source.name+".xlsx");exact(native_path,native)
        native_table=decode(bridge,native_path)["tables"][0]
        assert native_table["headers"]==[field["name"] for field in definitions]
        assert [{"rowNumber":row["rowNumber"],"fields":row["fields"]} for row in native_table["records"]]==[
            {"rowNumber":row["rowNumber"],"fields":row["fields"]} for row in preview["tables"][0]["rows"]]
        assert native_table["origin"]["epoch"]=="1904"
        assert native_table["origin"]["blankRows"]==[3] and native_table["origin"]["hiddenRows"]==[3]
        editor=retained.read("report.html")
        exact(directory/"reviewed-report.html",editor)
    assert source.read_bytes()==source_bytes and not list(scratch.iterdir())
    report={"schema":"starforge.lab-edd-legacy-cli-receiving.v1","operationId":OPERATION,
        "status":"COMPLETE","sourceKind":"generated software-format fixture",
        "source":source_identity,"sourceSha256":source_sha,"documentSha256":preview["documentSha256"],
        "reviewSha256":preview["reviewSha256"],"commands":len(calls),"sourceRows":2,"fieldsPerRow":150,
        "completeEditableRows":300,"explicitLiterals":choices,"tableRoundTrips":["csv","tsv"],
        "initialNativePreparation":original_result["manifest"]["nativePreparation"],
        "reviewedNativePreparation":manifest["nativePreparation"],"prepared":native_record,
        "initialResult":receipt((directory/"original-result.zip").read_bytes()),
        "reviewedResult":receipt((directory/"reviewed-result.zip").read_bytes()),
        "originalReopened":True,"completeNativeFieldsReopened":True,"scratchRetired":True}
    exact(out/"cli-result.json",json_bytes(report))
    return report

def execute(out, fixture_only=None, node=None):
    bridge=module("lab_legacy_receiving_bridge",HERE/"workbook_bridge.py")
    legacy=module("lab_legacy_receiving_reader",HERE/"workbook_legacy.py")
    profile=(HERE/"profiles"/"dts8.mjs").read_text()
    declaration=profile.split("DTS8D_FIELDS = Object.freeze(",1)[1]
    definitions,_=json.JSONDecoder().raw_decode(declaration)
    assert len(definitions)==150
    upstream=HERE/"examples"/"xlrd"/"formula_test_sjmachin.xls"
    raw=upstream.read_bytes()
    assert hashlib.sha256(raw).hexdigest()==UPSTREAM_SHA
    with upstream.open("rb") as source:
        original=legacy.LegacyWorkbook(source,receipt(raw),bridge.reader)
        try:
            native_sheets=[]
            formulas=[]
            for descriptor in original.sheets:
                sheet=original.sheet(descriptor["name"])
                cells=list(sheet["cells"].values())
                native_sheets.append({"descriptor":descriptor,"cells":cells,"metadata":sheet["metadata"],
                    "mergedRanges":sheet["merged"],"hiddenRows":sorted(sheet["hidden"])})
                formulas.extend({"sheet":descriptor["name"],**cell} for cell in cells if cell["formula"] is not None)
            assert formulas
            assert all(cell["biff"]["formula"]["recordBase64"] and cell["biff"]["formula"]["cachedResult"] for cell in formulas)
            plain=generated(original,definitions,False)
            calculated=generated(original,definitions,True)
            upstream_view={"sourceKind":"original upstream xlrd software-format fixture",
                "upstream":"https://github.com/python-excel/xlrd/blob/d8302dc39b16c03d643ef1eee89605c2e007ed2b/tests/samples/formula_test_sjmachin.xls",
                "source":receipt(raw),"legacy":original.legacy,"sheets":native_sheets,
                "formulaCells":len(formulas)}
        finally: original.close()
    if fixture_only:
        exact(fixture_only,plain)
        return {"operationId":OPERATION,"status":"FIXTURE_READY","sourceKind":"generated software-format fixture",
            "path":str(fixture_only),**receipt(plain),"headers":150,"epoch":"1904"}
    out.mkdir(parents=True,exist_ok=True,mode=0o700)
    assert out.resolve()==out and not out.is_symlink()
    exact(out/"upstream-original.xls",raw)
    exact(out/"upstream-original.json",json_bytes(upstream_view))
    all_cases=[]
    for label,body in (("original-values",plain),("explicit-formula-values",calculated)):
        path=out/(label+".xls");exact(path,body)
        decoded=decode(bridge,path)
        table=decoded["tables"][0]
        assert len(decoded["tables"])==1 and table["headers"]==[field["name"] for field in definitions]
        assert table["origin"]["format"]=="xls" and table["origin"]["epoch"]=="1904"
        assert table["origin"]["blankRows"]==[3] and table["origin"]["hiddenRows"]==[3]
        assert [row["rowNumber"] for row in table["records"]]==[2,4]
        date=table["records"][0]["cells"][2]
        assert date["dateStyle"] and date["calendar"]["date"] and date["biff"]["ieee754"]
        changes={}
        refusal=None
        if label=="explicit-formula-values":
            try:render(bridge,path,table,definitions)
            except bridge.reader.WorkbookError as error:
                refusal={"code":error.code,"message":str(error),"details":error.details}
            assert refusal and refusal["code"] in ("LAB_EDD_FORMULA_CHOICE","LAB_EDD_ERROR_CHOICE")
            for row in table["records"]:
                for column,cell in enumerate(row["cells"],1):
                    if cell is not None and (cell["formula"] is not None or cell["type"]=="error"):
                        changes[(row["rowNumber"],column)] = ("001.2300" if cell["formula"] is not None else "reviewed\rline\n_x000D_")
        prepared,expected_rows=render(bridge,path,table,definitions,changes)
        native=path.with_name(path.name+".xlsx");exact(native,prepared)
        received=decode(bridge,native)["tables"][0]
        assert received["origin"]["format"]=="xlsx" and received["origin"]["epoch"]=="1904"
        assert received["headers"]==table["headers"] and received["keys"]==table["keys"]
        assert received["origin"]["blankRows"]==[3] and received["origin"]["hiddenRows"]==[3]
        assert [{"rowNumber":row["rowNumber"],"fields":row["fields"]} for row in received["records"]]==[
            {"rowNumber":row["rowNumber"],"fields":row["fields"]} for row in expected_rows]
        for before,after in zip(table["records"],received["records"]):
            for column,(a,b) in enumerate(zip(before["cells"],after["cells"]),1):
                if a is None: continue
                if (before["rowNumber"],column) not in changes:
                    assert b is not None and a["type"]==b["type"] and a["value"]==b["value"]
                    assert a["numberFormat"]==b["numberFormat"]
                assert b is None or b["formula"] is None
        assert path.read_bytes()==body and upstream.read_bytes()==raw
        exact(out/(label+".source.json"),json_bytes(decoded))
        exact(out/(label+".received.json"),json_bytes(received))
        exact(out/(label+".choices.json"),json_bytes({"source":receipt(body),"sourceKind":"generated software-format fixture",
            "choices":[{"rowNumber":row,"column":column,"value":value,
                "reason":"Explicit literal software-format receiving choice; preserve the complete original BIFF record separately."}
                for (row,column),value in changes.items()]}))
        all_cases.append({"name":label,"source":receipt(body),"prepared":receipt(prepared),
            "nativeFilename":native.name,"headers":150,"rows":2,"epoch":"1904",
            "formulaAndErrorRefusal":refusal,"explicitLiterals":len(changes),
            "completeFieldsReopened":True,"sourceUnchanged":True,"unchangedCellTypesAndFormats":True})
    result={"schema":"starforge.lab-edd-legacy-native-receiving.v1","operationId":OPERATION,"status":"COMPLETE",
        "sourceKind":"original upstream and generated software-format fixtures",
        "python":sys.version.split()[0],"upstream":upstream_view["source"],
        "upstreamWorksheets":len(upstream_view["sheets"]),"upstreamFormulaCells":upstream_view["formulaCells"],
        "cases":all_cases,"acknowledgement":legacy.ACKNOWLEDGEMENT}
    exact(out/"result.json",json_bytes(result))
    if node: return {**result,"cli":cli_receiving(out,node,definitions,bridge)}
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out",type=Path)
    parser.add_argument("--fixture-only",type=Path)
    parser.add_argument("--node",type=Path,help="Run the original complete Laboratory CLI after native format receiving.")
    args=parser.parse_args()
    if bool(args.out)==bool(args.fixture_only):parser.error("Choose --out or --fixture-only.")
    if args.node and args.fixture_only:parser.error("--node operates the complete --out receiving workflow.")
    output=execute(args.out.resolve() if args.out else None,args.fixture_only.resolve() if args.fixture_only else None,args.node)
    print(json.dumps(output,ensure_ascii=False),flush=True)

if __name__=="__main__":
    main()
