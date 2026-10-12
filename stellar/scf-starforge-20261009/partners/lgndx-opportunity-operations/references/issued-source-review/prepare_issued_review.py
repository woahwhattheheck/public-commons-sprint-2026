#!/usr/bin/env python3
"""Prepare the actual MCC issued-source review for the existing LGNDX project.

This tool reads the original retained files and the closed revision-133 portable.
It writes source and dispatch inputs only. The maintained opportunity store applies
them through its original API in the owner's receiving operation.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse, base64, copy, hashlib, json, re, shutil, unicodedata, zipfile
import xml.etree.ElementTree as ET

NS={"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W="{"+NS["w"]+"}"
NOTICE="ec4254f4fdf24f8998bd4e10d5b58050"
PROJECT="opp_c414e4b0-302f-0005-bda6-cb8906d7a644"
PORTABLE_SHA="9512b0bf69c34748df36bdc08f8b2aa0b06117eaacbafb6d38e035f5dd797140"
REF="8505a3ec99d584261754a2edcfca4113766dcc5b"
SPECS=[
 ("rfi","Request_for_Information_RFI_Final.docx","6e2eabe5e1ee4bcda2fcbaafdb74516f",74797,"ae7ac0ed596426c1d26e66b7d6e85261e4df07849e6a4e16b413c7a88129f8d5"),
 ("pws","Performance_Work_Statement_PWS_Final.docx","1e4efc774a704cec90dd0765337362ac",177688,"93fa078cd166baed8a3e8a8aa7ab9f82a63c3573f13b4fd02b4304413535fd0a"),
 ("event","RFI_Notice_of_Intent.docx","a3d570210e8a45eb8ad831c4f6886174",41236,"5fc2a085f29d4ab820bba65107316414f26409bc8ba4481e417ca23f9d0932c3"),
]
def sha(b): return hashlib.sha256(b).hexdigest()
def rawjson(x): return (json.dumps(x,ensure_ascii=False,indent=2)+"\n").encode()
def write_json(path,x): path.write_bytes(rawjson(x))
def norm(s): return re.sub(r"\s+"," ",unicodedata.normalize("NFKC",s)).strip()
def unspace(s): return re.sub(r"\s+","",unicodedata.normalize("NFKC",s))
def roman(n):
    out=""
    for v,s in [(1000,"m"),(900,"cm"),(500,"d"),(400,"cd"),(100,"c"),(90,"xc"),(50,"l"),(40,"xl"),(10,"x"),(9,"ix"),(5,"v"),(4,"iv"),(1,"i")]:
        while n>=v: out+=s;n-=v
    return out
def fmt(n,kind):
    if kind=="decimal": return str(n)
    if kind=="lowerLetter": return chr(96+n)
    if kind=="lowerRoman": return roman(n)
    raise ValueError("Unsupported original numbering format "+kind)
def ptext(p):
    out=[]
    for e in p.iter():
        if e.tag==W+"t": out.append(e.text or "")
        elif e.tag==W+"tab": out.append("\t")
        elif e.tag in (W+"br",W+"cr"): out.append("\n")
        elif e.tag==W+"noBreakHyphen": out.append("\u2011")
        elif e.tag==W+"softHyphen": out.append("\u00ad")
    return "".join(out)
def extract(path,key):
    with zipfile.ZipFile(path) as z:
        document=z.read("word/document.xml")
        d=ET.fromstring(document);body=d.find("w:body",NS)
        numbering=ET.fromstring(z.read("word/numbering.xml"))
        n=numbering.find("w:num[@w:numId='1']",NS)
        assert n is not None and not n.findall("w:lvlOverride",NS),"Review numbering override"
        aid=n.find("w:abstractNumId",NS).get(W+"val")
        abstract=numbering.find("w:abstractNum[@w:abstractNumId='"+aid+"']",NS)
        levels={}
        for e in abstract.findall("w:lvl",NS):
            levels[int(e.get(W+"ilvl"))]={
                "start":int(e.find("w:start",NS).get(W+"val")),
                "format":e.find("w:numFmt",NS).get(W+"val"),
                "template":e.find("w:lvlText",NS).get(W+"val")
            }
        counts=[0]*9;current_section="";blocks=[]
        for i,e in enumerate(body,1):
            kind=e.tag.rsplit("}",1)[-1]
            if kind=="p":
                text=ptext(e)
                if not text.strip(): continue
                style=e.find("w:pPr/w:pStyle",NS);num=e.find("w:pPr/w:numPr",NS)
                item={"id":"B%03d"%i,"bodyIndex":i,"kind":"paragraph","text":text,
                      "xmlLocator":"/w:document/w:body/*[%d]"%i,
                      "style":style.get(W+"val") if style is not None else ""}
                if num is not None:
                    numid=num.find("w:numId",NS).get(W+"val")
                    level=int(num.find("w:ilvl",NS).get(W+"val"))
                    item["numbering"]={"numId":numid,"level":level}
                    if numid=="1":
                        counts[level]=(counts[level]+1) if counts[level] else levels[level]["start"]
                        for j in range(level+1,9): counts[j]=0
                        label=levels[level]["template"]
                        for j in range(9):
                            if "%"+str(j+1) in label: label=label.replace("%"+str(j+1),fmt(counts[j],levels[j]["format"]))
                        item["displayNumber"]=label
                        if key=="rfi": item["question"]=".".join(fmt(counts[j],levels[j]["format"]) for j in range(level+1))
                        elif key=="pws": current_section=label
                if key=="pws": item["section"]=current_section
                blocks.append(item)
            elif kind=="tbl":
                for ri,row in enumerate(e.findall("w:tr",NS),1):
                    for ci,cell in enumerate(row.findall("w:tc",NS),1):
                        text="\n".join(ptext(p) for p in cell.findall("w:p",NS))
                        if text.strip(): blocks.append({"id":"B%03d/R%03d/C%03d"%(i,ri,ci),"bodyIndex":i,"row":ri,"cell":ci,"kind":"table_cell","text":text,"xmlLocator":"/w:document/w:body/*[%d]/w:tr[%d]/w:tc[%d]"%(i,ri,ci)})
            elif kind=="sdt":
                for pi,p in enumerate(e.findall(".//w:p",NS),1):
                    text=ptext(p)
                    if text.strip(): blocks.append({"id":"B%03d/P%03d"%(i,pi),"bodyIndex":i,"kind":"content_control_paragraph","text":text,"xmlLocator":"/w:document/w:body/*[%d]//w:p[%d]"%(i,pi)})
        stories={}
        for f in z.namelist():
            if f.startswith(("word/header","word/footer")) or f in ("word/footnotes.xml","word/endnotes.xml"):
                stories[f]="\n".join(ptext(p) for p in ET.fromstring(z.read(f)).findall(".//w:p",NS))
        return {"schema":"tjlabs.docx-original-extraction.v1","file":path.name,"documentXmlSha256":sha(document),
                "numberingAbstractId":aid,"numberingLevels":levels,"blocks":blocks,"stories":stories,
                "commentsPresent":"word/comments.xml" in z.namelist(),
                "trackedInsertions":len(d.findall(".//w:ins",NS)),"trackedDeletions":len(d.findall(".//w:del",NS))}
def source_bytes(portable,source):
    bind=source["editionBindings"][0]
    blob=next(b for b in portable["dossier"]["blobs"] if b["sha256"]==bind["sha256"])
    body=base64.b64decode(blob["bodyBase64"],validate=True)
    assert len(body)==bind["bytes"] and sha(body)==bind["sha256"]
    retained=json.loads(body)["results"][0]["metadata"]["opportunitySource"]
    assert retained["id"]==source["id"] and retained["sha256"]==source["sha256"]
    content=base64.b64decode(retained["contentBase64"],validate=True)
    assert len(content)==source["bytes"] and sha(content)==source["sha256"]
    return content
def evidence(key,locator,excerpt=""):
    return {"sourceKey":key,"locator":locator,"excerpt":excerpt}
def strip_number(s): return re.sub(r"^(?:\d+|[a-z]+)\.\s*","",s.strip(),count=1)
def main():
    ap=argparse.ArgumentParser();ap.add_argument("--originals",required=True);ap.add_argument("--native-handoff",required=True);ap.add_argument("--prior");ap.add_argument("--published-references",default=str(Path(__file__).resolve().parent.parent));ap.add_argument("--editor-input",default=str(Path(__file__).with_name("review-edits.json")));ap.add_argument("--output",required=True);a=ap.parse_args()
    original=Path(a.originals);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    for name in ("originals","extracted","review"): (out/name).mkdir(exist_ok=True)
    if a.prior:
        prior=json.loads(Path(a.prior).read_bytes())
    else:
        references=Path(a.published_references)
        prior={key:{"text":(references/name).read_text()} for key,name in [
            ("rfi","mcc-rfi-government-text.txt"),("pws","mcc-pws-government-text.txt"),("event","mcc-industry-day-excerpt.txt")]}
        prior["requirements"]=json.loads((references/"mcc-requirements.json").read_bytes())
    editor_raw=Path(a.editor_input).read_bytes();edit=json.loads(editor_raw)
    with zipfile.ZipFile(a.native_handoff) as z:raw=z.read("handoff/current-receiving-portable.json")
    assert len(raw)==14822528 and sha(raw)==PORTABLE_SHA,"Original project portable changed"
    portable=json.loads(raw);project=portable["project"]
    assert project["id"]==PROJECT and project["revision"]==133
    bynumber={r["number"]:r for r in project["requirements"]}
    assert len(bynumber)==34 and set(bynumber)==set(edit["pwsBindings"])
    preparation_inputs={"scriptSha256":sha(Path(__file__).read_bytes()),"editorSha256":sha(editor_raw),
                        "priorSha256":sha(rawjson(prior)),"portableSha256":PORTABLE_SHA}
    preparation_path=out/"preparation.json"
    if preparation_path.exists():
        preparation=json.loads(preparation_path.read_bytes())
        assert preparation["inputs"]==preparation_inputs,"Prepared edition has different inputs; retain it and select a new output directory"
        captured=preparation["createdAt"]
    else:
        captured=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
        write_json(preparation_path,{"schema":"tjlabs.mcc-issued-preparation.v1","createdAt":captured,"inputs":preparation_inputs})
    index_bytes=(original/"sam-notice-resources.json").read_bytes()
    assert len(index_bytes)==1760 and sha(index_bytes)=="6eaa112f27c3908a6127d1a030be30334320f30bb7d21cc32eacf75a0ea8187d"
    index=json.loads(index_bytes);attachments=index["_embedded"]["opportunityAttachmentList"][0]["attachments"]
    assert len(attachments)==3
    index_by_id={x["resourceId"]:x for x in attachments}
    oldnames={"rfi":"mcc-rfi-government-text.txt","pws":"mcc-pws-government-text.txt","event":"mcc-industry-day-excerpt.txt"}
    sources=[];docs={};manifest=[];comparisons=[]
    receipt_files=["sam-notice-resources.json.receipt.json"]
    for key,name,rid,size,expected in SPECS:
        raw=(original/name).read_bytes();assert len(raw)==size and sha(raw)==expected
        meta=index_by_id[rid];assert meta["size"]==size and meta["accessStatus"]=="public"
        receipt_name=name+".receipt.json";receipt_raw=(original/receipt_name).read_bytes();receipt=json.loads(receipt_raw)
        assert receipt["http_status"]==200 and receipt["bytes"]==size and receipt["sha256"]==expected
        receipt_files.append(receipt_name)
        (out/"originals"/name).write_bytes(raw)
        (out/"originals"/receipt_name).write_bytes(receipt_raw)
        x=extract(original/name,key);x.update({"originalSha256":expected,"originalBytes":size,"issuedFilename":meta["name"],"resourceId":rid,"extractedAt":captured})
        docs[key]=x
        write_json(out/"extracted"/(key+".structure.json"),x)
        lines=["MCC original SAM attachment text", "Issued file: "+meta["name"],"Resource ID: "+rid,"Original file SHA-256: "+expected,
               "Source: https://sam.gov/api/prod/opps/v3/opportunities/resources/files/"+rid+"/download",
               "Derived from word/document.xml with original numbering and run breaks. Original Word bytes remain in the paired source.",
               "Captured original: "+receipt["captured_at"],"Extracted: "+captured,""]
        for b in x["blocks"]:
            label=b.get("displayNumber","")
            lines.extend(["["+b["id"]+("; section "+b["section"] if b.get("section") else "")+"] "+b["xmlLocator"],
                          (label+" " if label else "")+b["text"],""])
        lines.append("ORIGINAL HEADER AND FOOTER STORIES")
        for name2,body in x["stories"].items(): lines.extend(["["+name2+"]",body,""])
        text="\n".join(lines);text_raw=text.encode()
        filename="mcc-"+key+"-issued-primary.txt";(out/"extracted"/filename).write_bytes(text_raw)
        url="https://sam.gov/api/prod/opps/v3/opportunities/resources/files/"+rid+"/download"
        common={"role":"solicitation","url":url,"sourceTerms":"Original public U.S. Government attachment from SAM notice 95332427K0001, posted "+meta["postedDate"]+". Original filename, document labels and acquisition receipt are retained."}
        sources.append({"key":"mcc-issued-"+key+"-docx","payload":{**common,"title":meta["name"]+" — original Word file","capturedAt":receipt["captured_at"],"filename":name,"mediaType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","contentBase64":base64.b64encode(raw).decode()},"originalSha256":expected})
        old=next(s for s in project["sources"] if s["filename"]==oldnames[key])
        sources.append({"key":"mcc-issued-"+key+"-text","payload":{**common,"title":meta["name"]+" — source-bound text","capturedAt":captured,"filename":filename,"mediaType":"text/plain; charset=utf-8","contentText":text,"replacesSourceId":old["id"]},"originalSha256":expected})
        prior_text=re.sub(r"^L\d+:\s*","",prior[key]["text"],flags=re.M);nprior=norm(prior_text);fprior=unspace(prior_text)
        candidates=[];spacing=[]
        meaningful=[b for b in x["blocks"] if b["kind"]=="paragraph" and len(norm(b["text"]))>30]
        for b in meaningful:
            if norm(b["text"]) not in nprior:
                if unspace(b["text"]) in fprior: spacing.append(b["id"])
                else:candidates.append({"id":b["id"],"text":b["text"]})
        comparisons.append({"key":key,"priorSourceId":old["id"],"priorSha256":old["sha256"],"originalSha256":expected,"substantiveParagraphs":len(meaningful),"whitespaceBoundaryOnly":spacing,"additionalOrChangedParagraphs":candidates,"fullTextSha256":sha(text_raw)})
        manifest.append({"key":key,"issuedFilename":meta["name"],"localFilename":name,"resourceId":rid,"attachmentId":meta["attachmentId"],"postedDate":meta["postedDate"],"bytes":size,"sha256":expected,"httpStatus":receipt["http_status"],"capturedAt":receipt["captured_at"],"receiptFile":receipt_name,"receiptSha256":sha(receipt_raw),"textFile":filename,"textSha256":sha(text_raw)})
    (out/"originals"/"sam-notice-resources.json").write_bytes(index_bytes)
    for name in receipt_files:
        if not (out/"originals"/name).exists():(out/"originals"/name).write_bytes((original/name).read_bytes())
    assert not next(c for c in comparisons if c["key"]=="rfi")["additionalOrChangedParagraphs"],"Review RFI content difference"
    assert not next(c for c in comparisons if c["key"]=="pws")["additionalOrChangedParagraphs"],"Review PWS content difference"
    acquisition={"schema":"tjlabs.mcc-issued-attachments.v1","noticeId":"95332427K0001","noticeUuid":NOTICE,"reviewedAt":captured,"attachments":manifest,"resourceIndex":{"file":"sam-notice-resources.json","bytes":len(index_bytes),"sha256":sha(index_bytes),"jsonPointer":"/_embedded/opportunityAttachmentList/0/attachments"},"receipts":[{"file":n,"bytes":len((original/n).read_bytes()),"sha256":sha((original/n).read_bytes()),"body":json.loads((original/n).read_bytes())} for n in receipt_files]}
    write_json(out/"review"/"issued-attachments-manifest.json",acquisition)
    sources.append({"key":"mcc-issued-resource-index","payload":{"role":"solicitation","title":"MCC original three-attachment SAM resource index","url":"https://sam.gov/api/prod/opps/v3/opportunities/"+NOTICE+"/resources?withScanResult=false&excludeDeleted=false","capturedAt":json.loads((original/receipt_files[0]).read_bytes())["captured_at"],"filename":"sam-notice-resources.json","mediaType":"application/hal+json","sourceTerms":"Exact original HTTP 200 resource-index body.","contentText":index_bytes.decode()}})
    sources.append({"key":"mcc-issued-acquisition","payload":{"role":"other","title":"MCC original attachment acquisition and source bindings","url":"https://sam.gov/workspace/contract/opp/"+NOTICE+"/view","capturedAt":captured,"filename":"issued-attachments-manifest.json","mediaType":"application/json","sourceTerms":"Acquisition/source manifest tied to the unchanged original files and receipts.","contentText":rawjson(acquisition).decode()}})
    qmap={b["question"]:b for b in docs["rfi"]["blocks"] if b.get("question")}
    pmap={b["bodyIndex"]:b for b in docs["pws"]["blocks"] if b["kind"]=="paragraph"}
    assert len([b for b in docs["rfi"]["blocks"] if b.get("question") and "." not in b["question"]])==15
    current_workbook_source=next(s for s in project["sources"] if s["filename"]=="response-workbook-exchange-v2.json")
    current_workbook_raw=source_bytes(portable,current_workbook_source);workbook=json.loads(current_workbook_raw)
    assert len(workbook["rows"])==34
    matrix=[]
    for number,req in bynumber.items():
        b=qmap[number];oldreq=next(r for r in prior["requirements"]["requirements"] if r["number"]==number)
        rfi_blocks=[qmap["14"],b] if number=="14.a" else [b]
        prior_question=oldreq["sourceText"]
        if number=="14.a":
            prior_question=re.sub(r"(?m)^(?:14|a)\.\s*","",prior_question.strip())
        else:
            prior_question=strip_number(prior_question)
        assert norm(prior_question)==norm("\n".join(p["text"] for p in rfi_blocks)),"RFI row wording difference "+number
        rfi_refs=[evidence("mcc-issued-rfi-text","word/document.xml "+p["id"]+"; RFI question "+p["question"],p["text"]) for p in rfi_blocks]
        refs=list(rfi_refs)
        contexts=[]
        for bi in edit["pwsBindings"][number]:
            p=pmap[bi];contexts.append({"bodyIndex":bi,"section":p.get("section",""),"text":p["text"]})
            refs.append(evidence("mcc-issued-pws-text","word/document.xml "+p["id"]+"; PWS "+p.get("section",""),p["text"]))
        coverage=next(c for c in project["coverage"] if c["requirementId"]==req["id"])
        row=next(r for r in workbook["rows"] if r["number"]==number)
        original_row=copy.deepcopy(row)
        if number in edit["edits"]:
            row["response"]=edit["edits"][number]["response"];row["reviewNote"]=edit["edits"][number]["reviewNote"]
        assert row["decision"]==original_row["decision"] and row["responseDisposition"]==original_row["responseDisposition"] and row["status"]==original_row["status"]
        row["issuedEvidence"]=refs
        matrix.append({"number":number,"requirementId":req["id"],"requirementVersion":req["version"],"coverageId":coverage["id"],"coverageVersion":coverage["version"],"title":req["title"],"questionTextUnchanged":True,"primaryRfi":{"bodyIndex":b["bodyIndex"],"xmlLocator":b["xmlLocator"],"excerpt":b["text"]},"rfiEvidence":rfi_refs,"pwsContext":contexts,"evidence":refs,"responseUpdated":number in edit["edits"],"responseDisposition":req["responseDisposition"],"coverageDecision":coverage["decision"]})
    workbook["issuedSourceReview"]={"reviewedAt":captured,"kind":"original_source_strengthening","previousWorkbookSourceId":current_workbook_source["id"],"previousWorkbookSha256":sha(current_workbook_raw),"applicationSourceRef":REF,"questionGroups":15,"requirements":34,"questionTextChanges":0,"responseUpdates":list(edit["edits"]),"sourceBindings":manifest,"resourceIndexSha256":sha(index_bytes),"timing":"Preserve the issued EST/COB strings and the separately observed SAM 18:00 EDT response field."}
    workbook_name="response-workbook-issued-v3.json";workbook_raw=rawjson(workbook);(out/"review"/workbook_name).write_bytes(workbook_raw)
    sources.append({"key":"mcc-issued-workbook","payload":{"role":"other","title":"MCC response workbook with original issued-source review","url":"","capturedAt":captured,"filename":workbook_name,"mediaType":"application/json","sourceTerms":"Existing authored response workbook advanced through original attachment review. Company decisions, authoring lineage and receiving exchange remain retained.","contentText":workbook_raw.decode(),"replacesSourceId":current_workbook_source["id"]}})
    report={"schema":"tjlabs.mcc-issued-source-reconciliation.v1","reviewedAt":captured,"projectId":PROJECT,"baselineRevision":133,"baselinePortableSha256":PORTABLE_SHA,"applicationSourceRef":REF,"comparison":comparisons,"requirements":matrix,"questionGroups":15,"requirementCount":34,"questionTextChanges":0,"responseUpdates":list(edit["edits"]),"pageRules":{"maxPages":20,"capabilityMaxPages":1,"excludedSections":["cover page","table of contents"],"rfiBodyElements":[7,9,11,17,23]},"confirmedCrossReferences":[{"rfi":"5.c; B021","pws":"5.0; B320","finding":"RFI Section 5.0 deliverables versus PWS Section 5.0 Labor Requirements; documentation provisions occur in PWS 4.3.1."},{"pws":"1.0; B044 and 4.4; B310","finding":"Scope names Section 4.4 Infrastructure; actual section is Application Administration."},{"pws":"2.2 B055; 4.2.1.1 B153; 5.1 B322","finding":"Appendix B and Section H are referenced and are not included in the acquired three-resource packet."}],"sourceEditionMeaning":"The original October 6 attachments strengthen source custody and locators; their acquisition does not establish a new procurement amendment.","existingCase":"lgndx-opportunity-teaming-operations-20261012","existingSentMessage":"1a12e6cb1542aa63"}
    write_json(out/"review"/"attachment-reconciliation.json",report)
    source_key_by_filename={s["payload"]["filename"]:s["key"] for s in sources}
    old_ids={next(s for s in project["sources"] if s["filename"]==oldnames[k])["id"]:"mcc-issued-"+k+"-text" for k in oldnames}
    old_ids[current_workbook_source["id"]]="mcc-issued-workbook"
    def rebased(refs):
        values=[]
        for ref in refs:
            if ref["sourceId"] in old_ids:continue
            values.append({k:ref[k] for k in ("sourceId","locator","excerpt")})
        return values
    actions=[]
    for m in matrix:
        actions.append({"key":"requirement-"+m["number"],"action":"save_requirement","payload":{"requirementId":m["requirementId"],"evidence":m["rfiEvidence"]},"baseline":{"collection":"requirements","id":m["requirementId"],"version":m["requirementVersion"]}})
    for m in matrix:
        old=next(c for c in project["coverage"] if c["requirementId"]==m["requirementId"]);row=next(r for r in workbook["rows"] if r["number"]==m["number"])
        refs=rebased(old["evidence"])+m["evidence"]+[evidence("mcc-issued-workbook","rows question "+m["number"])]
        actions.append({"key":"coverage-"+m["number"],"action":"save_coverage","payload":{"requirementId":m["requirementId"],"evidence":refs,"response":row["response"],"reviewNote":row["reviewNote"]},"baseline":{"collection":"coverage","id":old["id"],"version":old["version"]}})
    rb={b["bodyIndex"]:b for b in docs["rfi"]["blocks"] if b["kind"]=="paragraph"}
    rules=copy.deepcopy(project["responseRules"]);rules.pop("reviewRequired",None);rules["evidence"]=[evidence("mcc-issued-rfi-text","word/document.xml B%03d"%i,rb[i]["text"]) for i in [7,9,11,17,23]]
    actions.append({"key":"response-rules","action":"update","payload":{"responseRules":rules}})
    event={b["bodyIndex"]:b for b in docs["event"]["blocks"] if b["kind"]=="paragraph"}
    tq=next(q for q in project["questions"] if q["id"]=="qa_42cc5d76-91a6-4eb8-983b-1707a443d9f3")
    source_notice=next(s for s in project["sources"] if s["filename"]=="mcc-notice-record.json")
    actions.append({"key":"deadline-question","action":"save_question","payload":{"questionId":tq["id"],"text":"Deadline timezone: the original Industry Day notice states 10:00–12:00 EST on October 15, registration by 18:00 EST on October 14, and RFI responses by COB October 29. The retained official SAM response field states October 29 at 18:00 EDT (22:00 UTC). Preserve each original string and confirm the event's intended wall-clock timezone and submission cutoff through the same issuer correspondence when the responding company selects participation.","evidence":[evidence("mcc-issued-event-text","word/document.xml B003–B004/B012"," ".join(event[i]["text"] for i in [3,4,12])),{"sourceId":source_notice["id"],"locator":"responseDateText","excerpt":"Oct 29, 2026 6:00 PM EDT"}]},"baseline":{"collection":"questions","id":tq["id"],"version":tq["version"]}})
    aq=next(q for q in project["questions"] if q["id"]=="qa_a6cf460f-75eb-4523-8247-2c944c86b9ad")
    actions.append({"key":"attachment-question","action":"save_question","payload":{"questionId":aq["id"],"text":"Referenced source clarification: please provide the Appendix B application/technology inventory and the Section H key-personnel designations referenced in the issued PWS. The acquired original resource index lists only the PWS, RFI and Industry Day notice. Please reconcile RFI 5.c's Section 5.0 deliverables reference with PWS 5.0 Labor Requirements and identify the applicable deliverable/acceptance schedule. Please also reconcile the Scope paragraph's Section 4.4 Infrastructure reference with the actual Section 4.4 Application Administration heading.","requirementIds":[bynumber[n]["id"] for n in ["2","5.c","5.d","7.a","11.a","12.a","14.a"]],"evidence":[evidence("mcc-issued-resource-index","/_embedded/opportunityAttachmentList/0/attachments")]+[evidence("mcc-issued-pws-text","word/document.xml B%03d; PWS %s"%(i,pmap[i].get("section","")),pmap[i]["text"]) for i in [44,55,153,310,320,322]]+[evidence("mcc-issued-rfi-text","word/document.xml B021; RFI 5.c",rb[21]["text"])]},"baseline":{"collection":"questions","id":aq["id"],"version":aq["version"]}})
    for key,title,at,indices,note in [
      ("industry-registration","MCC issued Industry Day registration deadline","2026-10-14T23:00:00Z",[4,6],"Literal EST (UTC−05:00) conversion of the issued 18:00 EST. The existing timezone question retains the difference from Eastern daylight time. Registration requires actual attendee names, job titles and email addresses sent to the published softwaredev@mcc.gov route by the responding-company owner."),
      ("industry-day","MCC issued Virtual Industry Day","2026-10-15T15:00:00Z",[3,8,11],"Literal EST (UTC−05:00) start from the issued notice; the stated event ends 17:00 UTC under the same literal interpretation. Confirm intended event timezone through the existing question. Original meeting details remain in the full retained notice."),
    ]:
        actions.append({"key":key,"action":"save_milestone","payload":{"title":title,"owner":"Responding-company capture lead","dueAt":at,"timeZone":"Etc/GMT+5","status":"open","dependsOn":[],"requirementIds":[bynumber["2"]["id"]],"evidence":[evidence("mcc-issued-event-text","word/document.xml B%03d"%i,event[i]["text"]) for i in indices],"note":note}})
    ms=next(m for m in project["milestones"] if m["id"]=="ms_0ce934c2-45e6-46e9-82e0-79bb432b9609")
    actions.append({"key":"response-window-source","action":"save_milestone","payload":{"milestoneId":ms["id"],"evidence":[{"sourceId":source_notice["id"],"locator":"responseDateText","excerpt":"Oct 29, 2026 6:00 PM EDT"},evidence("mcc-issued-event-text","word/document.xml B012",event[12]["text"])],"note":"The retained SAM field specifies October 29 at 18:00 EDT / 22:00 UTC; the issued Word notice says COB October 29. Both original forms are retained in the existing deadline question."},"baseline":{"collection":"milestones","id":ms["id"],"version":ms["version"]}})
    reviews=[]
    for s in sources:
        if s["payload"].get("replacesSourceId"):
            reviews.append({"key":s["key"],"beforeSourceId":s["payload"]["replacesSourceId"],"decision":"Original source and response review adopted","note":("All 34 original numbered RFI texts and both page limits are preserved. The issued PWS text matches the previously retained government text. Primary Word files, original receipts and exact paragraph/section locators are retained. The original notice's full meeting instructions are added. Seven authored operating responses incorporate explicit PWS context; company evidence, staffing availability, existing coverage decisions and correspondence retain their prior states.")})
    packet={"schema":"tjlabs.opportunity-issued-review.v1","operation":"LGNDX-MCC-ISSUED-SOURCE-REVIEW-0C7A-20261012","createdAt":captured,"projectId":PROJECT,"baselineRevision":133,"baselinePortableSha256":PORTABLE_SHA,"applicationSourceRef":REF,"existingCase":"lgndx-opportunity-teaming-operations-20261012","existingSentMessage":"1a12e6cb1542aa63","sources":sources,"actions":actions,"sourceReviews":reviews,"package":{"title":"MCC original issued attachments and response review","status":"ready_for_review","note":"Original October 6 SAM attachments and receipts received; all 34 question texts and response rules preserved; seven operating responses strengthened against the PWS. Existing company-evidence decisions, teaming, original packages and sent commercial relationship remain part of this same project."},"businessPreservation":{"requirementCore":[{k:r[k] for k in ["id","number","title","text","mandatory","evidenceRule","responseDisposition","status","owner","category"]} for r in project["requirements"]],"company":project["company"],"opportunity":project["opportunity"],"capabilities":project["capabilities"],"teaming":project["teaming"],"coverageDecisions":[{"requirementId":r["requirementId"],"decision":r["decision"],"capabilityIds":r["capabilityIds"],"teamIds":r["teamIds"]} for r in project["coverage"]],"requirementDispositions":[{"id":r["id"],"responseDisposition":r["responseDisposition"],"evidenceRule":r["evidenceRule"],"status":r["status"]} for r in project["requirements"]],"existingPackages":[p["id"] for p in project["packages"]]}}
    write_json(out/"review"/"project-update.json",packet)
    files=[{"path":str(p.relative_to(out)),"bytes":p.stat().st_size,"sha256":sha(p.read_bytes())} for p in sorted(out.rglob("*")) if p.is_file() and p.name!="FILES.json"]
    write_json(out/"FILES.json",{"schema":"tjlabs.mcc-issued-review-files.v1","createdAt":captured,"files":files})
    print(json.dumps({"complete":True,"output":str(out),"projectId":PROJECT,"baselineRevision":133,"sourceCount":len(sources),"actions":len(actions),"sourceReviews":len(reviews),"requirements":len(matrix),"questionTextChanges":0,"responseUpdates":list(edit["edits"]),"files":len(files),"projectUpdateBytes":len(rawjson(packet)),"projectUpdateSha256":sha(rawjson(packet)),"comparison":[{"key":x["key"],"substantiveParagraphs":x["substantiveParagraphs"],"newOrChanged":len(x["additionalOrChangedParagraphs"]),"spacingOnly":x["whitespaceBoundaryOnly"]} for x in comparisons]}))
if __name__=="__main__":main()
