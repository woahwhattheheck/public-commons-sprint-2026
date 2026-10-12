#!/usr/bin/env python3
# MIT. Standalone native receiving exercise for the complete Lab EDD workbook path.
# Run: python3 workbook-native-receiving.py /absolute/pinned/source/root
# Uses generated software-format fixtures; no customer or competition observations.
import io, json, hashlib, zipfile, tempfile, importlib.util, sys, os, xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape
source_root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path.cwd()
bridge_path=source_root / "stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/workbook_bridge.py"
spec=importlib.util.spec_from_file_location("lab_edd_actual_bridge", bridge_path)
bridge=importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)
defs=json.loads("[{\"name\":\"SiteName\",\"type\":\"text\"},{\"name\":\"StationName\",\"type\":\"text\"},{\"name\":\"SampleDate_D\",\"type\":\"datetime\"},{\"name\":\"SampleTypeCode\",\"type\":\"text\"},{\"name\":\"SampleMatrix\",\"type\":\"text\"},{\"name\":\"SampleTop\",\"type\":\"float32\"},{\"name\":\"SampleBottom\",\"type\":\"float32\"},{\"name\":\"DepthUnits\",\"type\":\"text\"},{\"name\":\"Duplicate\",\"type\":\"int16\"},{\"name\":\"FieldSampleID\",\"type\":\"text\"},{\"name\":\"AltSampleID\",\"type\":\"text\"},{\"name\":\"CoolerID\",\"type\":\"text\"},{\"name\":\"Sampler\",\"type\":\"text\"},{\"name\":\"Description\",\"type\":\"text\"},{\"name\":\"SampleMethodCode\",\"type\":\"text\"},{\"name\":\"LogCode\",\"type\":\"text\"},{\"name\":\"COCNumber\",\"type\":\"text\"},{\"name\":\"DeliveryGroup\",\"type\":\"text\"},{\"name\":\"AmbientBlankLot\",\"type\":\"text\"},{\"name\":\"EquipmentBlankLot\",\"type\":\"text\"},{\"name\":\"TripBlankLot\",\"type\":\"text\"},{\"name\":\"FilteredSample\",\"type\":\"text\"},{\"name\":\"QCSequenceID\",\"type\":\"text\"},{\"name\":\"QCSampleCode\",\"type\":\"text\"},{\"name\":\"TaskNumber\",\"type\":\"text\"},{\"name\":\"PrimarySample\",\"type\":\"text\"},{\"name\":\"SampleResult\",\"type\":\"text\"},{\"name\":\"Container\",\"type\":\"text\"},{\"name\":\"NumContainers\",\"type\":\"int16\"},{\"name\":\"CoolerTemp\",\"type\":\"float32\"},{\"name\":\"FieldEquip\",\"type\":\"text\"},{\"name\":\"GeologicUnitCode\",\"type\":\"text\"},{\"name\":\"LithologyCode\",\"type\":\"text\"},{\"name\":\"Odor\",\"type\":\"text\"},{\"name\":\"Preservation\",\"type\":\"text\"},{\"name\":\"PumpFault\",\"type\":\"text\"},{\"name\":\"Purged\",\"type\":\"text\"},{\"name\":\"QAPlanNumber\",\"type\":\"text\"},{\"name\":\"SampConcentration\",\"type\":\"text\"},{\"name\":\"SampleCollProc\",\"type\":\"text\"},{\"name\":\"SampleEventName\",\"type\":\"text\"},{\"name\":\"SampleEventID\",\"type\":\"int32\"},{\"name\":\"SamplePurposeCode\",\"type\":\"text\"},{\"name\":\"SampleSource\",\"type\":\"text\"},{\"name\":\"Witness\",\"type\":\"text\"},{\"name\":\"TaxonSerial\",\"type\":\"text\"},{\"name\":\"GenderCode\",\"type\":\"text\"},{\"name\":\"LifeStageCode\",\"type\":\"text\"},{\"name\":\"TissueTypeCode\",\"type\":\"text\"},{\"name\":\"ParameterName\",\"type\":\"text\"},{\"name\":\"CASNumber\",\"type\":\"text\"},{\"name\":\"AltParamNumber\",\"type\":\"text\"},{\"name\":\"STORETCode\",\"type\":\"text\"},{\"name\":\"Superseded\",\"type\":\"int16\"},{\"name\":\"AnalyticMethod\",\"type\":\"text\"},{\"name\":\"Value\",\"type\":\"text\"},{\"name\":\"ReportingUnits\",\"type\":\"text\"},{\"name\":\"FlagCode\",\"type\":\"text\"},{\"name\":\"ProblemCode\",\"type\":\"text\"},{\"name\":\"ValidationCode\",\"type\":\"text\"},{\"name\":\"DetectedResult\",\"type\":\"text\"},{\"name\":\"Detect\",\"type\":\"float32\"},{\"name\":\"LimitType\",\"type\":\"text\"},{\"name\":\"Detect2\",\"type\":\"float32\"},{\"name\":\"LimitType2\",\"type\":\"text\"},{\"name\":\"Detect3\",\"type\":\"float32\"},{\"name\":\"LimitType3\",\"type\":\"text\"},{\"name\":\"Detect4\",\"type\":\"float32\"},{\"name\":\"LimitType4\",\"type\":\"text\"},{\"name\":\"Detect5\",\"type\":\"float32\"},{\"name\":\"LimitType5\",\"type\":\"text\"},{\"name\":\"SpikeAmount\",\"type\":\"float32\"},{\"name\":\"RetentionTime\",\"type\":\"float32\"},{\"name\":\"Error\",\"type\":\"float32\"},{\"name\":\"DilutionFactor\",\"type\":\"float32\"},{\"name\":\"Basis\",\"type\":\"text\"},{\"name\":\"FilteredAnalysis\",\"type\":\"text\"},{\"name\":\"LeachMethod\",\"type\":\"text\"},{\"name\":\"LeachateBatch\",\"type\":\"text\"},{\"name\":\"LeachDate_D\",\"type\":\"datetime\"},{\"name\":\"PrepMethod\",\"type\":\"text\"},{\"name\":\"PreparationLot\",\"type\":\"text\"},{\"name\":\"ReportableResult\",\"type\":\"text\"},{\"name\":\"AnalDate_D\",\"type\":\"datetime\"},{\"name\":\"ExtractDate_D\",\"type\":\"datetime\"},{\"name\":\"LabReportDate_D\",\"type\":\"datetime\"},{\"name\":\"LabRecvDate_D\",\"type\":\"datetime\"},{\"name\":\"Lab\",\"type\":\"text\"},{\"name\":\"LabComments\",\"type\":\"text\"},{\"name\":\"AnalysisLabID\",\"type\":\"text\"},{\"name\":\"AnalyticalBatch\",\"type\":\"text\"},{\"name\":\"ValueCode\",\"type\":\"text\"},{\"name\":\"RunCode\",\"type\":\"text\"},{\"name\":\"QCAnalysisCode\",\"type\":\"text\"},{\"name\":\"AnalysisGroup\",\"type\":\"text\"},{\"name\":\"AnalysisLocationCode\",\"type\":\"text\"},{\"name\":\"BatchTypeCode\",\"type\":\"text\"},{\"name\":\"Cleanup\",\"type\":\"text\"},{\"name\":\"DetectorMode\",\"type\":\"text\"},{\"name\":\"DetectorType\",\"type\":\"text\"},{\"name\":\"ExpectedValue\",\"type\":\"float64\"},{\"name\":\"Extracted\",\"type\":\"text\"},{\"name\":\"HandlingBatch\",\"type\":\"text\"},{\"name\":\"HandlingType\",\"type\":\"text\"},{\"name\":\"InstrumentCalibBy\",\"type\":\"text\"},{\"name\":\"InstrumentCalibDate_D\",\"type\":\"datetime\"},{\"name\":\"InstrumentManufacturer\",\"type\":\"text\"},{\"name\":\"InstrumentModel\",\"type\":\"text\"},{\"name\":\"InstrumentNum\",\"type\":\"text\"},{\"name\":\"LabMatrixCode\",\"type\":\"text\"},{\"name\":\"LabPrepDate_D\",\"type\":\"datetime\"},{\"name\":\"LabReportNum\",\"type\":\"text\"},{\"name\":\"LabSampleID\",\"type\":\"text\"},{\"name\":\"MethodBatch\",\"type\":\"text\"},{\"name\":\"NumberDecimals\",\"type\":\"int16\"},{\"name\":\"PercentRecovery\",\"type\":\"float32\"},{\"name\":\"PrepBatch\",\"type\":\"text\"},{\"name\":\"PreserveIntact\",\"type\":\"text\"},{\"name\":\"RunBatch\",\"type\":\"text\"},{\"name\":\"StatTypeCode\",\"type\":\"text\"},{\"name\":\"StdRefMaterial\",\"type\":\"text\"},{\"name\":\"SubcontractLab\",\"type\":\"text\"},{\"name\":\"ValidationComments\",\"type\":\"text\"},{\"name\":\"Validator\",\"type\":\"text\"},{\"name\":\"ValueTypeCode\",\"type\":\"text\"},{\"name\":\"WeightVolume\",\"type\":\"float64\"},{\"name\":\"WeightVolUnits\",\"type\":\"text\"},{\"name\":\"UpperControlLimit\",\"type\":\"float32\"},{\"name\":\"LowerControlLimit\",\"type\":\"float32\"},{\"name\":\"RejectionControlLimit\",\"type\":\"float32\"},{\"name\":\"RPDLimit\",\"type\":\"int16\"},{\"name\":\"APDLimit\",\"type\":\"int16\"},{\"name\":\"CatResult\",\"type\":\"text\"},{\"name\":\"AnalysesTaxonSerial\",\"type\":\"text\"},{\"name\":\"AnalysesLifeStageCode\",\"type\":\"text\"},{\"name\":\"BlankFlagCode\",\"type\":\"text\"},{\"name\":\"FinalValue\",\"type\":\"float64\"},{\"name\":\"FinalQualifier\",\"type\":\"text\"},{\"name\":\"RPD\",\"type\":\"float32\"},{\"name\":\"SampleEndDate_D\",\"type\":\"datetime\"},{\"name\":\"SampleStatusCode\",\"type\":\"text\"},{\"name\":\"Sample_X\",\"type\":\"float64\"},{\"name\":\"Sample_Y\",\"type\":\"float64\"},{\"name\":\"Sample_Z\",\"type\":\"float64\"},{\"name\":\"StationReach\",\"type\":\"float64\"},{\"name\":\"PercentMoisture\",\"type\":\"float64\"},{\"name\":\"ValReason1\",\"type\":\"text\"},{\"name\":\"ValReason2\",\"type\":\"text\"},{\"name\":\"ValReason3\",\"type\":\"text\"},{\"name\":\"ValReason4\",\"type\":\"text\"}]")
names=[x["name"] for x in defs]; kinds=[x["type"] for x in defs]; width=len(names)
S="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P="http://schemas.openxmlformats.org/package/2006/relationships"
MC="http://schemas.openxmlformats.org/markup-compatibility/2006"
value_col=names.index("Value")+1
date_col=names.index("SampleDate_D")+1
num_col=next(i+1 for i,x in enumerate(defs) if x["type"]=="float64")
text_cols=[i+1 for i,x in enumerate(defs) if x["type"]=="text" and i+1 not in (1,2,4,value_col)]
cr_col, changed_cr_col=text_cols[-2:]
def literal(value): return escape(value).replace("\r","&#13;")
def col(i):return bridge.reader.column_label(i)
def cell(i,row,value,kind="inlineStr",implicit=False,formula=False,shared=False):
    ref="" if implicit else ' r="'+col(i)+str(row)+'"'
    if shared:return '<c'+ref+' s="1"><f t="shared" si="0"/><v>1.000</v></c>'
    if formula:return '<c'+ref+' s="1"><f t="shared" si="0">1.23</f><v>1.2300</v></c>'
    if kind=="n":return '<c'+ref+' s="1" t="n"><v>'+value+'</v></c>'
    return '<c'+ref+' t="inlineStr"><is><t xml:space="preserve">'+literal(value)+'</t></is></c>'
def build(formula):
    cells=[]
    for i,x in enumerate(defs,1):
        if i==4:continue
        v="row-"+str(i)
        k="inlineStr"
        if x["type"] in ("int16","int32","float32","float64"):v="1.000";k="n"
        if x["type"]=="datetime":v="45000";k="n"
        if i==value_col:v="001.2300"
        if i==cr_col:v="unchanged\rline\nend"
        if i==changed_cr_col:v="before"
        cells.append(cell(i,2,v,k,implicit=i<=2,formula=formula and i==value_col,shared=formula and i==num_col))
    headers="".join(cell(i,1,n,implicit=i<=2) for i,n in enumerate(names,1))
    extension='<extLst><ext uri="contract" xmlns:p="urn:inner"><mc:AlternateContent><mc:Choice Requires="p"><p:item marker="p:entry"/></mc:Choice></mc:AlternateContent></ext></extLst>'
    sheet=('<worksheet xmlns="'+S+'" xmlns:r="'+R+'" xmlns:mc="'+MC+'" xmlns:p="urn:outer" xmlns:labedd0="urn:reserved" mc:Ignorable="p labedd0"><sheetData><row>'+headers+'</row><row>'+''.join(cells)+'</row><row r="3"><c r="A3"/></row><row r="4">'+cell(1,4,"kept-row")+'</row></sheetData>'+extension+'</worksheet>').encode()
    types=('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+('<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>' if formula else '')+'</Types>').encode()
    relations=('<Relationships xmlns="'+P+'"><Relationship Id="rId1" Type="'+R+'/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="'+R+'/styles" Target="styles.xml"/>'+('<Relationship Id="rId3" Type="'+R+'/calcChain" Target="calcChain.xml"/>' if formula else '')+'</Relationships>').encode()
    parts={"[Content_Types].xml":types,"_rels/.rels":('<Relationships xmlns="'+P+'"><Relationship Id="rId1" Type="'+R+'/officeDocument" Target="xl/workbook.xml"/></Relationships>').encode(),"xl/workbook.xml":('<workbook xmlns="'+S+'" xmlns:r="'+R+'"><workbookPr date1904="1"/><sheets><sheet name="DTS8D" sheetId="1" r:id="rId1"/></sheets></workbook>').encode(),"xl/_rels/workbook.xml.rels":relations,"xl/worksheets/sheet1.xml":sheet,"xl/styles.xml":('<styleSheet xmlns="'+S+'"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>').encode(),"docProps/retained.bin":b"unchanged-original-member\x00\xff"}
    if formula:parts["xl/calcChain.xml"]=('<calcChain xmlns="'+S+'"><c r="'+col(value_col)+'2" i="1"/></calcChain>').encode()
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as z:
        z.comment=b"original-archive-comment"
        for k,v in parts.items():z.writestr(k,v)
    return out.getvalue(),parts
def workbook(data):
    f=tempfile.TemporaryFile(mode="w+b",dir=os.environ.get("LAB_EDD_RECEIVING_TMP"));f.write(data);f.flush();f.seek(0)
    return f,bridge.reader.Workbook(f,{"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
def scopes(data):
    current={"xml":"http://www.w3.org/XML/1998/namespace"};stack=[];pending=[];found=[]
    for event,item in ET.iterparse(io.BytesIO(data),events=("start-ns","start","end")):
        if event=="start-ns":pending.append(item)
        elif event=="start":
            stack.append(current);current=dict(current)
            for p,u in pending:current[p or ""]=u
            pending=[]
            for key,value in item.attrib.items():
                if key=="{"+MC+"}Ignorable" or key=="Requires":
                    found.append((key,[(p,current[p]) for p in value.split()]))
        else:current=stack.pop()
    return found
reports=[]
for formula in (False,True):
    raw,parts=build(formula);f,w=workbook(raw)
    decoded=bridge.decode(w,{"filename":"DTS8D-native-contract.xlsx"})["tables"][0]
    assert len(decoded["headers"])==150 and decoded["headers"]==names
    assert decoded["origin"]["epoch"]=="1904" and decoded["origin"]["blankRows"]==[3]
    assert [x["rowNumber"] for x in decoded["records"]]==[2,4]
    rows=[{"rowNumber":r["rowNumber"],"fields":r["fields"][:],"literalColumns":[]} for r in decoded["records"]]
    req={"sheetName":"DTS8D","headers":names,"fieldTypes":kinds,"rows":rows}
    if formula:
        row=rows[0]
        row["fields"][value_col-1]="001.2300"
        row["literalColumns"]=[value_col]
        assert decoded["records"][0]["cells"][num_col-1]["formula"]==""
        try:
            bridge.render(w,req)
            raise AssertionError("Shared formula follower was accepted without its literal choice")
        except bridge.reader.WorkbookError as error:
            assert error.code=="LAB_EDD_FORMULA_CHOICE" and error.details["cell"]==col(num_col)+"2"
        row["fields"][3]="inserted fourth column"
        row["literalColumns"].append(num_col)
        row["fields"][date_col-1]="2026-05-01T12:30:00"
        row["fields"][num_col-1]="0.00000100"
        row["fields"][changed_cr_col-1]="changed\r\nliteral _x000D_"
    rendered=bridge.render(w,req)
    if not formula:assert rendered==raw
    f2,w2=workbook(rendered)
    reopened=bridge.decode(w2,{"filename":"DTS8D-native-contract.xlsx"})["tables"][0]
    assert reopened["headers"]==names
    for before,after in zip(rows,reopened["records"]):
        assert before["rowNumber"]==after["rowNumber"]
        assert before["fields"]==after["fields"],[(i+1,a,b) for i,(a,b) in enumerate(zip(before["fields"],after["fields"])) if a!=b]
    assert reopened["origin"]["blankRows"]==[3] and reopened["origin"]["epoch"]=="1904"
    if formula:
        assert w2.sheet("DTS8D")["cells"][(value_col,2)]["formula"] is None
        assert w2.sheet("DTS8D")["cells"][(value_col,2)]["type"]=="text"
        assert w2.sheet("DTS8D")["cells"][(date_col,2)]["type"]=="date"
        assert w2.sheet("DTS8D")["cells"][(num_col,2)]["type"]=="number"
        assert "xl/calcChain.xml" not in w2.names
        assert not any(r["type"].endswith("/calcChain") for r in w2.rels.values())
        assert b"calcChain" not in w2.zip.read("[Content_Types].xml")
        assert scopes(w2.zip.read("xl/worksheets/sheet1.xml"))==scopes(parts["xl/worksheets/sheet1.xml"])
        for name,data in parts.items():
            if name not in ("xl/worksheets/sheet1.xml","xl/calcChain.xml","xl/_rels/workbook.xml.rels","[Content_Types].xml"):assert w2.zip.read(name)==data
        assert w2.zip.comment==b"original-archive-comment"
    # Exercise the exact file transport used by the original native process host.
    with tempfile.TemporaryDirectory(prefix="lab-edd-file-receiving-", dir=os.environ.get("LAB_EDD_RECEIVING_TMP")) as folder:
        root=Path(folder); source_path=root/"source.xlsx"; control_path=root/"control.json"
        decode_path=root/"decoded.json"; render_path=root/"prepared.xlsx"
        source_path.write_bytes(raw)
        control={"schema":bridge.SCHEMA,"operation":"decode","filename":"DTS8D-native-contract.xlsx",
                 "source":{"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}}
        control_path.write_text(json.dumps(control),encoding="utf-8")
        bridge.main(["--files",str(control_path),str(source_path),str(decode_path)])
        assert json.loads(decode_path.read_bytes())["tables"][0]==decoded
        control.update({"operation":"render",**req})
        control_path.write_text(json.dumps(control),encoding="utf-8")
        bridge.main(["--files",str(control_path),str(source_path),str(render_path)])
        assert render_path.read_bytes()==rendered
        assert source_path.read_bytes()==raw
        assert (render_path.stat().st_mode & 0o777)==0o600
        try:
            bridge.main(["--files",str(control_path),str(source_path),str(render_path)])
            raise AssertionError("Existing native output was overwritten")
        except FileExistsError:
            assert render_path.read_bytes()==rendered
        control["source"]["sha256"]="0"*64
        control_path.write_text(json.dumps(control),encoding="utf-8")
        try:
            bridge.main(["--files",str(control_path),str(source_path),str(root/"changed-source.xlsx")])
            raise AssertionError("A different source identity was accepted")
        except bridge.reader.WorkbookError:
            assert not (root/"changed-source.xlsx").exists()
    reports.append({"case":"changed-formula-namespace-CR-implicit-cell-native-reissue" if formula else "unchanged-byte-exact-native-reissue","status":"PASS","headers":150,"retained_rows":[2,4],"blank_rows":[3],"source_bytes":len(raw),"output_bytes":len(rendered),"output_sha256":hashlib.sha256(rendered).hexdigest(),"epoch":reopened["origin"]["epoch"],"broker_file_decode_and_render":"PASS","source_unchanged":True,"exclusive_output":True})
    w2.zip.close();f2.close();w.zip.close();f.close()
print(json.dumps({"schema":"lab-edd.native-workbook-contract-exercise.v1","status":"PASS","source_kind":"generated software-format fixture","bridge_sha256":hashlib.sha256(bridge_path.read_bytes()).hexdigest(),"reader_sha256":hashlib.sha256(bridge.READER_PATH.read_bytes()).hexdigest(),"cases":reports},separators=(",",":")))
