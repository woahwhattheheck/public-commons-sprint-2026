/** One large-cohort behavior/performance check. Mechanical fixture; no model run. */
import {mount,DEFAULT_METRICS} from "./scenario_decisions.mjs";

class CheckNode {
  constructor(document,tag,nodeType=1,text="") {
    this.ownerDocument=document;this.tagName=tag;this.nodeType=nodeType;this.parentNode=null;
    this.children=[];this.attributes={};this.listeners={};this._text=text;this.scrollLeft=0;this.disabled=false;
  }
  setAttribute(key,value) {this.attributes[key]=String(value);if(key==="id")this.id=String(value);}
  getAttribute(key) {return this.attributes[key] ?? null;}
  appendChild(node) {if(node.parentNode)node.remove();node.parentNode=this;this.children.push(node);return node;}
  append(...nodes) {nodes.forEach(node=>this.appendChild(node));}
  replaceChildren(...nodes) {this.children.forEach(node=>{node.parentNode=null;});this.children=[];this.append(...nodes);}
  remove() {if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
  contains(node) {for(let current=node;current;current=current.parentNode)if(current===this)return true;return false;}
  addEventListener(type,handler) {(this.listeners[type] ||= []).push(handler);}
  fire(type,values={}) {const event={target:this,preventDefault(){},stopPropagation(){},...values};(this.listeners[type]||[]).forEach(handler=>handler(event));}
  focus() {if(!this.disabled)this.ownerDocument.activeElement=this;}
  get textContent() {return this.nodeType===3?this._text:this.children.map(node=>node.textContent).join("");}
  set textContent(value) {if(this.nodeType===3)this._text=String(value);else this.replaceChildren(this.ownerDocument.createTextNode(String(value)));}
  get options() {return this.children.filter(node=>node.tagName==="option");}
  get selectedOptions() {return this.options.filter(node=>node.selected);}
  querySelectorAll(selector) {
    const found=[];
    const matches=node=>selector==="*" ||
      selector.startsWith(".") && (node.attributes.class||"").split(/\s+/).includes(selector.slice(1)) ||
      selector.startsWith("#") && node.id===selector.slice(1) ||
      selector.startsWith("[") && Object.prototype.hasOwnProperty.call(node.attributes,selector.slice(1,-1)) ||
      node.tagName===selector;
    const visit=node=>{node.children.forEach(child=>{if(matches(child))found.push(child);visit(child);});};
    visit(this);return found;
  }
  querySelector(selector) {return this.querySelectorAll(selector)[0]||null;}
}
function createDocument() {
  const document={
    activeElement:null,createElement:tag=>new CheckNode(document,tag),
    createTextNode:text=>new CheckNode(document,"#text",3,text),
    getElementById:id=>document.body.querySelector("#"+id)
  };
  document.body=document.createElement("body");
  return document;
}
function assert(value,message) {if(!value)throw new Error(message);}
function fixture() {
  const zoneCount=80,candidateCount=120;
  const input={workspace_id:"mechanical-page-check",metrics:DEFAULT_METRICS,alternatives:[]};
  for(let candidate=0;candidate<=candidateCount;candidate+=1) {
    const id=candidate ? "case-"+String(candidate).padStart(3,"0") : "baseline";
    const alternative={
      id,label:candidate?"Scenario "+candidate:"Baseline",run_id:"run-"+id,grid_id:"grid-one",
      profile_id:"profile-one",scenario_id:"scenario-"+id,invest_version:"retained-fixture",
      domain_id:"domain-one",period_id:"annual-model:grid-one",summaries:[]
    };
    for(let zone=0;zone<zoneCount;zone+=1) {
      const catchment="zone-"+String(zone).padStart(3,"0");
      const summary={catchment_id:catchment,label:"Reporting scope "+zone,scope_id:catchment,metrics:{}};
      DEFAULT_METRICS.forEach((metric,index)=>{
        const value=1000 + zone*11 + index*100 + (candidate ? (index===1 ? -candidate : candidate) : 0);
        summary.metrics[metric.id]={value,unit:metric.unit,valid_cells:100,support_id:catchment+":"+metric.id};
      });
      if(candidate===candidateCount&&zone===0) summary.metrics.sediment_export.value=null;
      alternative.summaries.push(summary);
    }
    input.alternatives.push(alternative);
  }
  return {input,zoneCount,candidateCount};
}
const {input,zoneCount,candidateCount}=fixture();
const document=createDocument(),container=document.createElement("main");
document.body.appendChild(container);
const selected={
  baseline_id:"baseline",directions:Object.fromEntries(DEFAULT_METRICS.map(metric=>[metric.id,"minimize"])),
  priority:{enabled:true,weights:{nitrogen_export:2,phosphorus_export:1,sediment_export:0}}
};
let callbacks=0,unexpectedAssessment=0;
const started=Date.now();
const controller=mount(container,input,{initialState:selected,notifyAssessment:false,
  onChange:(state,assessment)=>{callbacks+=1;if(assessment!==undefined)unexpectedAssessment+=1;}});
const initialMilliseconds=Date.now()-started;
const totalRows=candidateCount*zoneCount*DEFAULT_METRICS.length;
const physicalRows=()=>container.querySelectorAll("[data-sdc-row]");
assert(controller.getTableView().total_rows===totalRows&&physicalRows().length===50,"Initial bounded page/full selection");
let original=controller.getComparison();
const cohortSignature=JSON.stringify(original.groups);
const choiceSignature=JSON.stringify(original.rows.map(row=>[row.key,row.priority_score,row.priority_rank,row.pareto_status]));
assert(original.groups[0].common_alternative_ids.length===119&&original.groups[1].common_alternative_ids.length===120,"Complete selected metrics determine per-scope eligibility");
original=null;
const prefix=container.querySelector(".sdc-panel").getAttribute("aria-labelledby").replace(/title$/,"");
const pageMilliseconds=[];
for(let index=0;index<20;index+=1) {
  const field=document.getElementById(prefix+"page-top-number");
  field.value=String(2+index*7);field.focus();
  const before=Date.now();field.fire("change");pageMilliseconds.push(Date.now()-before);
  assert(physicalRows().length<=controller.getState().table_page_size,"Page row cap");
}
controller.setState({table_page:999999});
assert(controller.getState().table_page===Math.ceil(totalRows/50),"Oversized saved page is clamped");
const size=document.getElementById(prefix+"page-top-size");size.value="25";size.fire("change");
assert(controller.getState().table_page===1&&physicalRows().length===25,"Page size resets page and bounds rows");
const search=document.getElementById(prefix+"search");search.value="Scenario 120";search.fire("input");
assert(controller.getTableView().filtered_rows===zoneCount*3&&physicalRows().length===25,"Search spans the complete comparison");
controller.setState({query:"",pinned_ids:["case-120"],sort_key:"value",sort_direction:"desc"});
assert(JSON.parse(physicalRows()[0].getAttribute("data-sdc-row"))[0]==="case-120","Pins order the global set before slicing");
controller.setState({only_pinned:true});
assert(controller.getTableView().filtered_rows===zoneCount*3,"Pinned-only filter spans every scope");
controller.setState({only_pinned:false,status_filter:"excluded"});
assert(controller.getTableView().filtered_rows===1&&physicalRows().length===1,"Exclusion filter finds a row outside the original page");
const full=controller.getComparison();
assert(full.rows.length===totalRows&&JSON.stringify(full.groups)===cohortSignature,"Filters/pages preserve full cohorts and ranges");
assert(JSON.stringify(full.rows.map(row=>[row.key,row.priority_score,row.priority_rank,row.pareto_status]))===choiceSignature,"Filters/pages preserve every computed choice");
assert(unexpectedAssessment===0&&callbacks>20,"Lightweight notifications omit only the assessment copy");
const exportStarted=Date.now();
const csv=controller.exportCSV();
assert(csv.split("\r\n").length-2===totalRows,"CSV exports all computed rows");
const json=controller.exportJSON();
assert(JSON.parse(json).rows.length===totalRows,"JSON exports all computed rows");
const text=controller.exportText();
assert((text.match(/^Delta: /gm)||[]).length===totalRows,"Accessible text exports all computed rows");
const exportMilliseconds=Date.now()-exportStarted;
const details=container.querySelector(".sdc-method");
assert(!container.querySelector(".sdc-scope-method"),"Method scope content is lazy");
details.open=true;details.fire("toggle");
const method=document.getElementById(prefix+"method-catchment");method.value="zone-055";method.fire("change");
assert(container.querySelector(".sdc-scope-method").textContent.includes("Reporting scope 55")&&
  container.querySelector(".sdc-scope-method").textContent.includes("120 distinct alternatives"),"Method details identify actual scope and complete eligible cohort");
controller.setState({method_catchment_id:"missing-scope"});
assert(controller.getState().method_catchment_id==="zone-000"&&
  container.querySelector(".sdc-scope-method").textContent.includes("Reporting scope 0"),"Missing saved method scope resolves to a valid current group");
pageMilliseconds.sort((a,b)=>a-b);
const report={
  check:"large-cohort pagination and complete-assessment preservation",result:"PASS",
  runtime:"JavaScript DOM stub; browser receiving check remains separate",
  retained_runs:input.alternatives.length,alternatives:candidateCount,reporting_scopes:zoneCount,
  metrics:DEFAULT_METRICS.length,computed_rows:totalRows,default_rendered_rows:50,
  initial_compute_and_dom_ms:initialMilliseconds,
  page_change_median_ms:pageMilliseconds[Math.floor(pageMilliseconds.length/2)],
  page_change_max_ms:pageMilliseconds[pageMilliseconds.length-1],
  complete_exports_ms:exportMilliseconds,
  csv_characters:csv.length,json_characters:json.length,text_characters:text.length,
  callback_count:callbacks,assessment_copies_on_change:unexpectedAssessment
};
controller.destroy();
if(typeof console!=="undefined")console.log(JSON.stringify(report,null,2));
export default report;
