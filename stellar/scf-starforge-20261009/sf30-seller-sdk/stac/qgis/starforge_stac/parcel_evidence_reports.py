# SPDX-License-Identifier: MIT
"""Human-readable findings and explicitly selected original native map views."""
from __future__ import annotations
import base64
import copy
import html
import json
import re
from pathlib import Path
from .model import require, member, descriptor, file_digest, value_sha, json_bytes, read_json, sha_bytes

def selected_map_views(root, snapshot, operations, request_ids):
    require(isinstance(request_ids,list) and len(request_ids)<=20 and
            all(isinstance(v,str) for v in request_ids) and len(set(request_ids))==len(request_ids),
            "EVIDENCE_REPORT_MAPS","Choose up to twenty distinct original completed native map requests.")
    projects={s["mapObservation"]["projectId"] for s in snapshot["case"]["subjects"] if s.get("mapObservation")}
    by_id={r["requestId"]:r for r in operations}
    output=[]
    total=0
    for request_id in request_ids:
        row=by_id.get(request_id)
        require(row is not None and row["status"]=="COMPLETED" and row["input"]["action"]=="map.render" and
                row["input"]["workspaceId"]==snapshot["workspaceId"],"EVIDENCE_REPORT_MAP",
                "Select a completed native map render from this original workspace.")
        original,result=row["input"],row["result"]
        require(original["payload"]["projectId"] in projects and result["projectId"]==original["payload"]["projectId"] and
                result.get("schema")=="starforge.stac-qgis-map-view.v1" and
                result["viewInputSha256"]==value_sha({"workspaceId":snapshot["workspaceId"],"payload":original["payload"]}),
                "EVIDENCE_REPORT_MAP","The native map must show an original project bound to a case subject.")
        file=descriptor(result["file"])
        require(file in [descriptor(r) for r in row["files"]],"EVIDENCE_REPORT_MAP",
                "Keep the map image in its original completed analyst request.")
        require(all(type(result.get(k)) is int and 64<=result[k]<=4096 for k in ("width","height")),
                "EVIDENCE_REPORT_MAP","Keep the original native image dimensions.")
        total+=file["bytes"]
        require(total<=128*1024*1024,"EVIDENCE_REPORT_MAP_SIZE","Use the full project handover for more than128MiB of map images.")
        file_digest(member(root,file["path"]),expected=file)
        output.append({"requestId":request_id,"inputSha256":row["inputSha256"],"input":copy.deepcopy(original),
                       "result":copy.deepcopy(result),"image":file,"reportPath":"maps/"+request_id+".png"})
    return output

def map_members(root, snapshot):
    result={"map-views.json":json_bytes(snapshot.get("mapViews",[]))}
    for view in snapshot.get("mapViews",[]):
        path=member(root,view["image"]["path"])
        file_digest(path,expected=view["image"])
        body=path.read_bytes()
        require(len(body)==view["image"]["bytes"] and sha_bytes(body)==view["image"]["sha256"],
                "EVIDENCE_REPORT_MAP","The original map bytes changed during report reading.")
        require(body.startswith(b"\x89PNG\r\n\x1a\n"),"EVIDENCE_REPORT_MAP","Keep the original native PNG bytes.")
        result[view["reportPath"]]=body
    return result

def validate_report_views(root, snapshot, operations):
    views=snapshot.get("mapViews",[])
    require(views==selected_map_views(root,snapshot,operations,[r["requestId"] for r in views]),
            "EVIDENCE_REPORT_MAP","The frozen map or its original request changed.")
    return map_members(root,snapshot)

def render_report(snapshot,title,interpretation,files):
    esc=lambda v:html.escape("" if v is None else str(v),quote=True)
    def human(v):
        return str(v).replace("_"," ").lower().capitalize()
    def paragraph(v):
        return '<p class="multiline">'+esc(v)+'</p>'
    def source_ref(ref):
        item=next((s for s in snapshot["sources"] if s["id"]==ref["sourceId"]),None)
        name=item["title"] if item else ref["sourceId"]
        locator=[ref.get("locator")]
        if ref.get("sourcePageIndex0") is not None:locator.append("PDF page "+str(ref["sourcePageIndex0"]+1)+" (index "+str(ref["sourcePageIndex0"])+")")
        if ref.get("printedPage"):locator.append("printed page "+ref["printedPage"])
        if ref.get("section"):locator.append("section "+ref["section"])
        return '<li><a href="#source-'+esc(ref["sourceId"])+'">'+esc(name)+'</a> — '+esc(" · ".join(filter(None,locator)))+'</li>'
    def refs(values):
        return '<ul class="references">'+"".join(source_ref(v) for v in values)+'</ul>'
    case=snapshot["case"];findings=snapshot["currentFindings"]
    reviews={r["findingVersionId"]:r for r in snapshot.get("findingReview",[])}
    page='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title>'
    page+='<style>html{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f4f3;color:#202020;font:15px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1180px;margin:auto;padding:36px 28px}header{border-bottom:2px solid #333;padding-bottom:20px}h1{font-size:30px;line-height:1.2;margin:8px 0 16px}h2{font-size:22px;margin:30px 0 12px}h3{font-size:18px;margin:0 0 12px}.eyebrow,.label{font-size:12px;font-weight:650;letter-spacing:.035em;text-transform:uppercase}.muted{color:#595959}.multiline{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 16px}a{color:#202020;text-underline-offset:3px;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{background:#fff;border:1px solid #bdbdbb;padding:20px;margin:14px 0;break-inside:avoid}.meta{display:flex;gap:8px 18px;flex-wrap:wrap;font-size:13px;margin:8px 0}.tag{border:1px solid #aaa;padding:2px 8px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;background:#fff;font-size:14px}th,td{border:1px solid #bdbdbb;padding:10px 12px;text-align:left;vertical-align:top;min-width:115px;overflow-wrap:anywhere}th{background:#e9e9e7}.references{padding-left:20px;font-size:13px}.references li{margin:7px 0}figure{margin:20px 0;border:1px solid #bdbdbb;background:#fff;padding:16px;break-inside:avoid}figure img{display:block;width:100%;height:auto}figcaption{font-size:13px;margin-top:12px;overflow-wrap:anywhere}details{border-top:1px solid #ddd;margin-top:14px;padding-top:10px}summary{cursor:pointer}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.4 ui-monospace,monospace}.source-grid{display:grid;grid-template-columns:155px 1fr;gap:6px 14px}.source-grid dt{font-weight:600}.source-grid dd{margin:0;overflow-wrap:anywhere}.download-links{display:flex;flex-wrap:wrap;gap:9px 20px}.question{padding-left:20px}.question li{margin:10px 0}@media(max-width:600px){main{padding:20px 14px}h1{font-size:25px}.grid{grid-template-columns:1fr;gap:0}.card{padding:15px}.source-grid{grid-template-columns:1fr;gap:3px}.source-grid dd{margin-bottom:10px}figure{padding:10px}}@media print{@page{size:A4;margin:16mm}body{background:#fff;font-size:10pt}main{max-width:none;padding:0}h1{font-size:22pt}h2{font-size:15pt;break-after:avoid}.card{padding:12px}details{display:none}.table-wrap{overflow:visible}table{font-size:8pt}td,th{min-width:0;padding:5px}.download-links{display:none}a{color:inherit;text-decoration:none}.grid{display:block}figure{max-height:none}header{break-after:avoid}}</style></head><body><main>'
    page+='<header><div class="eyebrow">Parcel evidence review</div><h1>'+esc(title)+'</h1><div class="meta"><span>'+esc(case["jurisdiction"])+'</span><span>Research as of '+esc(case["asOf"] or "Unspecified")+'</span><span>'+str(len(findings))+' findings</span><span>'+str(len(snapshot["sources"]))+' source editions</span></div><p class="muted">Prepared from the retained case, original source records and named review decisions below.</p></header>'
    page+='<section class="grid"><div><h2>Decision and proposed use</h2>'+paragraph(case["purpose"])+paragraph(case["proposedUse"])+'</div><div><h2>Scope and assumptions</h2>'+paragraph(case["scope"])+paragraph(case["assumptions"])+'</div></section><section><h2>Review interpretation</h2>'+paragraph(interpretation)+'</section>'
    page+='<section><h2>Subjects</h2><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Original identity</th><th>Kind / jurisdiction</th><th>Evidence</th></tr></thead><tbody>'
    for subject in case["subjects"]:
        feature=subject.get("feature") or {}
        coverage=feature.get("coverage",{})
        status="Original feature "+str(feature.get("index","")) if feature else "Document reference"
        if coverage.get("exceededTransferLimit") is True:status+="; publisher response is incomplete"
        if subject.get("mapObservation"):status+="; retained native QGIS feature"
        page+='<tr><td>'+esc(subject["label"])+'</td><td>'+esc(subject["identity"])+'</td><td>'+esc(human(subject["kind"]))+'<br>'+esc(subject["jurisdiction"])+'</td><td>'+esc(status)+refs(subject["sourceReferences"])+'</td></tr>'
    page+='</tbody></table></div></section><section><h2>Findings and decisions</h2>'
    if not findings:page+=paragraph("No findings have been recorded for this case.")
    for finding in findings:
        review=reviews.get(finding["id"],{})
        page+='<article class="card" id="finding-'+esc(finding["findingId"])+'"><div class="meta"><span class="tag">'+esc(human(finding["classification"]))+'</span><span class="tag">'+esc(human(finding["status"]))+'</span><span>'+esc(human(review.get("state","REVIEW_REQUIRED")))+'</span></div><h3>'+esc(finding["title"])+'</h3>'+paragraph(finding["statement"])
        page+='<div class="grid"><div><div class="label">Applicability</div>'+paragraph(finding["applicability"])+'</div><div><div class="label">Assumptions and limits</div>'+paragraph(finding["assumptions"])+'</div></div><div class="label">Original sources</div>'+refs(finding["sourceReferences"])
        if finding["answer"]:page+='<div class="label">Retained answer</div>'+paragraph(finding["answer"])+refs(finding["answerReferences"])
        page+='<div class="label">Next action</div>'+paragraph(finding["nextAction"])+'<div class="meta"><span>Responsible: '+esc(finding["responsibleRole"])+'</span><span>Due: '+esc(finding["dueDate"] or "Unspecified")+'</span><span>Reviewed by '+esc(finding["reviewer"])+' · '+esc(finding["reviewedAt"])+'</span></div>'
        if review.get("reasons"):page+=paragraph("Review required: "+"; ".join(str(v) for v in review["reasons"]))
        page+='</article>'
    page+='</section><section><h2>Native map views</h2>'
    if not snapshot.get("mapViews"):page+=paragraph("No native map view was selected for this report.")
    for view in snapshot.get("mapViews",[]):
        result=view["result"];data=base64.b64encode(files[view["reportPath"]]).decode("ascii")
        page+='<figure><img alt="Retained native QGIS map of the selected case project" src="data:image/png;base64,'+data+'"><figcaption>Original request '+esc(view["requestId"])+' · '+str(result["width"])+'×'+str(result["height"])+' pixels. Project CRS: '+esc(json.dumps(result["projectCrs"],ensure_ascii=False))+'. Visible extent: '+esc(json.dumps(result["extent"]))+'. The original map view and measurement records retain their separate purposes.</figcaption></figure>'
    page+='</section><section><h2>Spatial observations</h2>'
    if not snapshot.get("observations"):page+=paragraph("No native geometric observation has been recorded.")
    for row in snapshot.get("observations",[]):
        r=row["result"]
        page+='<article class="card"><h3>'+esc(row["leftSubjectId"])+' / '+esc(row["rightSubjectId"])+'</h3>'+paragraph(row["purpose"])+'<div class="meta"><span>Intersects: '+esc(r["intersects"])+'</span><span>Left within right: '+esc(r["leftWithinRight"])+'</span><span>Touches: '+esc(r["touches"])+'</span></div>'+paragraph("Intersection area: "+r["intersectionArea"]+" "+r["areaUnit"]+"\nIntersection length: "+r["intersectionLength"]+" "+r["lengthUnit"])+'<p class="muted">'+esc(r["meaning"])+'</p><details><summary>Original method and coordinate system</summary><pre>'+esc(json.dumps({"method":row["measurementMethod"],"coordinateSystem":row["measurementCrs"],"qgisVersion":r["qgisVersion"]},ensure_ascii=False,indent=2))+'</pre></details></article>'
    page+='</section><section><h2>Original source editions</h2>'
    for source in snapshot["sources"]:
        path="sources/"+source["id"]+"/"+re.sub(r"[^A-Za-z0-9._-]","_",source["filename"])
        page+='<article class="card" id="source-'+esc(source["id"])+'"><h3>'+esc(source["title"])+'</h3><dl class="source-grid">'
        for label,key in (("Role","role"),("Publisher","issuer"),("Edition","edition"),("Jurisdiction","jurisdiction"),("Published","publishedDate"),("Effective","effectiveDate"),("Retrieved","retrievedAt"),("Document scope","documentScope"),("Coverage","coverageNotes"),("Query scope","queryDescription"),("Coordinate system","coordinateReference")):
            page+='<dt>'+esc(label)+'</dt><dd>'+esc(source.get(key) or "Unspecified")+'</dd>'
        page+='</dl>'+paragraph(source.get("notes",""))+'<p><a href="'+esc(path)+'">Open retained original file</a></p>'+paragraph(source["sourceUri"])+'<details><summary>Exact original file identity</summary><pre>'+esc(json.dumps(source["file"],ensure_ascii=False,indent=2))+'</pre></details></article>'
    page+='</section><section><h2>Open case questions</h2><ul class="question">'+''.join('<li>'+esc(q)+'</li>' for q in case["professionalQuestions"])+'</ul></section>'
    page+='<footer><h2>Editable case and source records</h2><div class="download-links">'
    for name,label in (("case.json","Complete case and review history"),("report.json","Report interpretation"),("findings.csv","Findings matrix"),("actions.csv","Action matrix"),("observations.json","Native spatial observations"),("map-views.json","Original map requests")):
        page+='<a href="'+name+'">'+label+'</a>'
    page+='</div><p class="muted">The complete QGIS project handover carries the editable workspace, original maps and sources, named reviews, operation history and application source. Effective FEMA, preliminary mapping, LOMC and DNR best-available sources retain their separate authority, date and coverage.</p></footer></main></body></html>'
    return page.encode("utf-8")
