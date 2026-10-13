import { semanticModelRead, semanticModelRows, semanticOutput } from "./semantic-model.mjs";
import { canonical, csv, escapeHtml as esc, need, now, clone } from "./util.mjs";

const STYLE = "body{font:14px/1.5 system-ui,sans-serif;color:#171717;max-width:1200px;margin:32px auto;padding:0 20px}h1,h2{line-height:1.15}table{width:100%;border-collapse:collapse;margin:16px 0;table-layout:fixed}th,td{border:1px solid #aaa;padding:7px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #aaa;padding:12px}.subtle{color:#555}.bad{font-weight:bold}section{break-inside:auto}tr{break-inside:avoid}@media print{body{font-size:10px;margin:0;max-width:none}thead{display:table-header-group}h2{break-after:avoid}}";
function table(columns, rows) {
  return "<table><thead><tr>" + columns.map(([key,label])=>"<th>"+esc(label)+"</th>").join("") + "</tr></thead><tbody>" +
    rows.map(row=>"<tr>"+columns.map(([key])=>"<td>"+esc(typeof row[key]==="object"?canonical(row[key]):row[key])+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
}
function entityRows(model) {
  return model.version.content.entities.map(row=>({
    id:row.id,name:row.name,label:row.label,kind:row.kind,iri:model.version.content.namespace+encodeURIComponent(row.id),
    classes:row.classes,tags:row.tags,sourceRefs:row.sourceRefs,attributes:row.attributes,
    observationStatus:row.observation.status,observationDate:row.observation.date,
    observationAuthor:row.observation.author,observationEvidence:row.observation.evidence,note:row.note
  }));
}
export function makeSemanticReport(state,args) {
  const model=semanticModelRead(state,args), content=model.version.content, format=args.format||"json";
  need(["json","csv","html"].includes(format),"Choose a complete JSON, CSV or HTML model handover.");
  const id="semantic-model-"+model.model.id+"-"+model.version.id.slice(0,12);
  if(args.kind==="semantic-dictionary") {
    need(format==="json"||format==="csv","Download the complete dictionary as JSON or CSV.");
    const metadata={format:"commons.haystack.semantic-dictionary.v1",workspaceId:state.workspaceId,modelId:model.model.id,versionId:model.version.id,contextId:model.contextId,naming:content.naming,dictionary:content.dictionary};
    return format==="json"?{name:id+"-dictionary.json",mediaType:"application/json",bytes:Buffer.from(canonical(metadata)+"\n")}:
      {name:id+"-dictionary.csv",mediaType:"text/csv; charset=utf-8",bytes:Buffer.from(csv(["id","term","iri","kind","definition","sourceUrl","note"],content.dictionary))};
  }
  const report={format:"commons.haystack.semantic-report.v1",generatedAt:now(),workspaceId:state.workspaceId,revision:state.revision,
    meaning:"Reviewed source mappings and actual native standard validation are retained separately from physical/liveness observations. The complete editable workspace handover retains all source and report bytes.",
    model:clone(model)};
  if(format==="json")return {name:id+".json",mediaType:"application/json",bytes:Buffer.from(canonical(report)+"\n")};
  if(format==="csv")return {name:id+"-entities.csv",mediaType:"text/csv; charset=utf-8",bytes:Buffer.from(csv(["id","name","label","kind","iri","classes","tags","sourceRefs","attributes","observationStatus","observationDate","observationAuthor","observationEvidence","note"],entityRows(model)))};
  const validation=model.latestValidation, review=model.latestReview;
  const html="<!doctype html><html><head><meta charset=\"utf-8\"><title>"+esc(content.title)+"</title><style>"+STYLE+"</style></head><body>"+
    "<h1>"+esc(content.title)+"</h1><p class=\"subtle\">Point-list model and contractor handover · "+esc(report.generatedAt)+"</p>"+
    "<p>"+esc(report.meaning)+"</p><p>Workspace "+esc(state.workspaceId)+" · Model "+esc(model.model.id)+"<br>Version "+esc(model.version.id)+"<br>Source context "+esc(model.contextId)+"</p>"+
    "<h2>Review and native validation</h2><p>Model review: "+esc(review?review.decision+" · "+review.author+" · "+review.reviewedAt:"No review retained for this exact version")+"</p>"+
    (review?"<pre>"+esc(review.note)+"</pre>":"")+
    "<p>Native validation: "+esc(validation?(validation.conforms?"conforms":"does not conform")+" · "+validation.id:"No native validation retained for this exact version")+"</p>"+
    (validation?"<pre>"+esc(canonical({runtime:validation.native.runtime,results:validation.native.results,mappingObservations:validation.native.mappingObservations,outputs:validation.outputs}))+"</pre>":"")+
    "<h2>Naming and source mapping</h2><pre>"+esc(canonical({namespace:content.namespace,naming:content.naming,mappings:content.mappings,selection:model.context.selection}))+"</pre>"+
    "<h2>Mapping observations</h2>"+table([["code","Observation"],["entityId","Entity"],["sourceRef","Original row"],["message","Meaning"]],model.assessment.observations)+
    "<h2>Entities</h2>"+table([["id","Stable identity"],["name","Reviewed name"],["kind","Kind"],["classes","Declared classes"],["sourceRefs","Original source"],["observationStatus","Physical observation"],["observationEvidence","Evidence"]],entityRows(model))+
    "<h2>Relationships</h2>"+table([["id","Identity"],["subjectId","Subject"],["predicate","Native predicate"],["objectId","Object"],["note","Source/review note"]],content.relations)+
    "<h2>Dictionary</h2>"+table([["term","Term"],["iri","IRI"],["kind","Kind"],["definition","Definition"],["sourceUrl","Original source"],["note","Review note"]],content.dictionary)+
    "<h2>Complete notes</h2><pre>"+esc(content.notes)+"</pre><h2>Version history</h2>"+table([["id","Version"],["parents","Parents"],["author","Author"],["createdAt","Saved"],["note","Reason"]],model.history)+
    "<h2>Complete editable model</h2><pre>"+esc(canonical(content))+"</pre>"+
    "<h2>Complete source context</h2><pre>"+esc(canonical(model.context))+"</pre></body></html>";
  return {name:id+".html",mediaType:"text/html; charset=utf-8",bytes:Buffer.from(html)};
}
export function semanticNativeDelivery(state,args) {
  const output=semanticOutput(state,args);
  return {name:output.metadata.name,mediaType:output.metadata.mediaType,bytes:output.bytes};
}
