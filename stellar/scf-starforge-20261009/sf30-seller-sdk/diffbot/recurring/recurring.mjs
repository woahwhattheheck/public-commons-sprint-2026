/* Pure browser consumer for the original retained Diffbot workspace.
 * Persistence belongs to the parent: onChange(nextConfig) must await its save.
 * Return {report,config} after the original preview, or call update() with it.
 * This module makes no network requests and uses no local/session storage.
 */
const DEFAULT_FIELDS = ["title","text","date","author","siteName","brand","productId","sku",
  "offerPrice","regularPrice","offerPriceDetails","availability","specs"];
const SELECTORS = ["kinds","sourceUrls","sourceIds","recordIds"];
const SCHEMA = "tj.diffbot-recurring-report.v1";
// The parent serves recurring.css under its original external-style CSP.
const clone = value => JSON.parse(JSON.stringify(value));
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function show(value) {
  return value === undefined ? "Not provided" : value === null ? "null" :
    typeof value === "object" ? JSON.stringify(value,null,2) : String(value);
}
function unique(values) { return [...new Set(values)]; }
function lines(value) { return unique(value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)); }
function cfg(value) {
  value = clone(value || {});
  return {
    watchlist:(value.watchlist || []).map(w=>({
      id:w.id,label:w.label || w.id,enabled:w.enabled !== false,
      selectors:Object.fromEntries([...SELECTORS.map(k=>[k,unique((w.selectors || {})[k] || [])]),
        ["text",(w.selectors || {}).text || ""]])
    })),
    decisions:value.decisions || [],
    delivery:{title:(value.delivery || {}).title || "Recurring web intelligence",
      fields:unique((value.delivery || {}).fields === undefined ? DEFAULT_FIELDS : value.delivery.fields)}
  };
}
function el(tag, attrs={}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key === "className") node.className=value;
    else if (key === "text") node.textContent=value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(),value);
    else if (value === true) node.setAttribute(key,"");
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key,String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function button(text,handler,options={}) {
  return el("button",{type:"button",onClick:handler,...options},text);
}
function link(url) {
  try {
    const value = new URL(url);
    if (["https:","http:"].includes(value.protocol) && !value.username && !value.password)
      return el("a",{href:url,target:"_blank",rel:"noopener noreferrer"},url);
  } catch (_) {}
  return el("span",{},url || "Not provided");
}
function label(text,input) { return el("label",{},el("span",{},text),input); }
function meta(entries) {
  return el("dl",{className:"meta"},entries.flatMap(([key,value])=>[el("dt",{},key),el("dd",{},value)]));
}
function table(headers,rows) {
  return el("table",{},el("thead",{},el("tr",{},headers.map(h=>el("th",{},h)))),
    el("tbody",{},rows.map(cells=>el("tr",{},cells.map(cell=>el("td",{},cell))))));
}
function recordOf(row) { return row.record || row.previous; }
function titleOf(row) { return show((recordOf(row) || {}).fields?.title || row.recordId); }
function watchesFor(config,row) {
  const record=recordOf(row);
  if (!record) return [];
  const source=row.record ? row.source : row.previousSource;
  const values={kinds:[record.kind],sourceUrls:[record.sourceUrl,source?.request?.pageUrl],
    sourceIds:[record.sourceId],recordIds:[row.recordId]};
  return config.watchlist.filter(w=>{
    if (!w.enabled) return false;
    if (SELECTORS.some(k=>w.selectors[k].length && !w.selectors[k].some(v=>values[k].includes(v)))) return false;
    return !w.selectors.text || stable(record.fields || {}).toLowerCase().includes(w.selectors.text.toLowerCase());
  }).map(w=>w.id);
}
function selected(config,row) { return !config.watchlist.length || watchesFor(config,row).length > 0; }
function historyFor(config,row) {
  return config.decisions.map((event,index)=>({...event,sequence:index+1})).filter(event=>
    event.recordId===row.recordId && event.editionId===row.editionId);
}
function stateFor(config,row) { return historyFor(config,row).at(-1)?.decision || "unreviewed"; }
function download(name,body,type) {
  const url=URL.createObjectURL(new Blob([body],{type}));
  const anchor=el("a",{href:url,download:name});
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function identifier() {
  return "watch-" + (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() :
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
}
function verifyReport(report) {
  if (!report || report.schema !== SCHEMA || !Array.isArray(report.rows))
    throw new TypeError("mountRecurring requires a " + SCHEMA + " report");
  return clone(report);
}

export function mountRecurring(element,{report,config,onChange,readOnly=false}) {
  if (!element || typeof element.replaceChildren !== "function") throw new TypeError("A mount element is required");
  if (typeof onChange !== "function") throw new TypeError("onChange must save through the original parent workspace");
  let current=verifyReport(report),saved=cfg(config || current.config),busy=false,destroyed=false,generation=0;
  let selectedId=current.rows[0]?.recordId || null;
  let search="",classification="all",reviewFilter="all",message="Loaded the saved recurring workspace.";
  let lastReviewer="",shell,statusNode,workFields=[],tableHost,detailHost,countHost;
  const exportFresh=()=>stable(saved)===stable(cfg(current.config));
  function status(text) {
    message=text;
    if(statusNode)statusNode.textContent=text;
  }
  function lock(value) {
    busy=value;
    workFields=workFields.filter(field=>shell?.contains(field));
    workFields.forEach(field=>{field.disabled=value||readOnly;});
  }
  async function save(next,success) {
    if (busy || destroyed || readOnly) return;
    const stamp=generation;
    const normalized=cfg(next);
    if(stable(normalized.decisions.slice(0,saved.decisions.length))!==stable(saved.decisions))
      throw new Error("Review history is append-only");
    lock(true);status("Saving through the original workspace…");
    try {
      const response=await onChange(clone(normalized));
      if(destroyed || generation!==stamp) return;
      const returned=response?.schema===SCHEMA ? response : response?.report;
      const nextReport=returned ? verifyReport(returned) : current;
      const authoritative=cfg(response?.config || (returned ? nextReport.config : normalized));
      current=nextReport;saved=authoritative;
      message=success + (exportFresh() ? "" : " Saved; waiting for the parent to refresh the report preview.");
      busy=false;render();
    } catch(error) {
      if(!destroyed && generation===stamp) {
        lock(false);status("The save/preview did not complete. Your edit is still on screen; reopen the original saved state to see its retained outcome. " + (error?.message || String(error)));
      }
    }
  }
  function editable(...children) {
    const field=el("fieldset",{disabled:busy||readOnly},children);workFields.push(field);return field;
  }
  function coveragePanel() {
    const coverage=current.coverage || {};
    const details=el("details",{},el("summary",{},"Current and previous acquisition coverage"));
    const counts=["selectedUrls","successfulUrls","failedUrls","notSeenUrls"];
    details.append(table(["Acquisition","Current","Previous"],[
      ["Declared state",show(coverage.current?.state),show(coverage.previous?.state)],
      ...counts.map(k=>[k,String(coverage.current?.[k]?.length ?? 0),
        coverage.previous ? String(coverage.previous[k]?.length ?? 0) : "Not supplied"])
    ]));
    for(const side of ["current","previous"]) {
      if(!coverage[side])continue;
      details.append(el("details",{},el("summary",{},side==="current"?"Current original URL sets":"Previous original URL sets"),
        el("pre",{},show(coverage[side]))));
    }
    details.append(meta([
      ["Current edition",current.currentEdition.id],
      ["Previous edition",current.previousEdition?.id || "Not supplied"],
      ["Base expected",coverage.comparison?.baseEditionId || "None"],
      ["Comparable scope",coverage.comparison?.scopeComparable ? "Declared comparable" : "Not declared comparable"],
      ["Previous base matches",coverage.comparison?.baseMatches ? "Yes" : "No"],
      ["Current source report",el("code",{},current.inputSha256.current)],
      ["Previous source report",el("code",{},current.inputSha256.previous || "Not supplied")],
    ]));
    return el("section",{className:"notice"},el("strong",{},"Coverage remains part of every customer delivery."),
      el("ul",{},(coverage.warnings || []).map(w=>el("li",{},w))),details);
  }
  function watchForm(watch,isNew=false) {
    const draft=clone(watch);
    const name=el("input",{value:draft.label,required:true,maxlength:300});
    const enabled=el("input",{type:"checkbox",checked:draft.enabled});
    const controls={};
    for(const key of SELECTORS) controls[key]=el("textarea",{rows:2,spellcheck:false},draft.selectors[key].join("\n"));
    const text=el("input",{value:draft.selectors.text,maxlength:2000});
    const form=el("form",{onSubmit:event=>{
      event.preventDefault();
      if(!name.value.trim())return;
      const next=clone(saved);
      const value={id:draft.id,label:name.value,enabled:enabled.checked,
        selectors:Object.fromEntries([...SELECTORS.map(k=>[k,lines(controls[k].value)]),["text",text.value]])};
      if(isNew)next.watchlist.push(value);
      else next.watchlist=next.watchlist.map(w=>w.id===value.id ? value : w);
      void save(next,isNew ? "Watch added." : "Watch updated.");
    }},editable(
      label("Watch name",name),
      el("label",{className:"check"},enabled,"Enabled"),
      el("div",{className:"watch-grid"},
        label("Kinds · exact values, one per line",controls.kinds),
        label("Source URLs · exact original request/source URLs",controls.sourceUrls),
        label("Source IDs · one per line",controls.sourceIds),
        label("Record IDs · one per line",controls.recordIds)),
      label("Contains text in original fields",text),
      el("p",{className:"small muted"},"Nonempty selectors within one watch must all match. Enabled watches are combined. Identity is never inferred from a title or SKU."),
      el("div",{className:"row"},el("button",{type:"submit",className:"primary"},isNew ? "Save new watch" : "Save watch"),
        !isNew && button("Remove watch",()=>{
          const next=clone(saved);next.watchlist=next.watchlist.filter(w=>w.id!==draft.id);
          void save(next,"Watch removed. Review history was retained.");
        }))
    ));
    return form;
  }
  function watchPanel() {
    const list=el("div",{});
    for(const watch of saved.watchlist) {
      const count=current.rows.filter(row=>watchesFor({...saved,watchlist:[watch]},row).length).length;
      list.append(el("details",{},el("summary",{},watch.label+" · "+(watch.enabled ? "enabled" : "disabled")+" · "+count+" observations"),
        watchForm(watch)));
    }
    const add=el("details",{},el("summary",{},"Add a watch"),
      watchForm({id:identifier(),label:"Watch "+(saved.watchlist.length+1),enabled:true,
        selectors:{kinds:[],sourceUrls:[],sourceIds:[],recordIds:[],text:""}},true));
    return el("section",{className:"panel"},el("h3",{},"Saved watchlist"),
      el("p",{className:"muted"},saved.watchlist.length ?
        "Only records matching an enabled watch are selected. Disabling every watch selects none." :
        "No watches are configured; all retained observations are selected."),
      list,add);
  }
  function sourcePanel(source,labelText) {
    if(!source)return el("p",{className:"muted"},labelText+": metadata unavailable.");
    return el("details",{},el("summary",{},labelText),meta([
      ["Source ID",source.id],["Retained source SHA-256",el("code",{},source.sha256 || "Not supplied")],
      ["Bytes / format",show(source.bytes)+" / "+show(source.format)],
      ["Captured",show(source.capturedAt)],["Source page",link(source.request?.pageUrl)],
      ["Source representation",show(source.sourceKind)],
      ["Original wire bytes",show(source.originalWireBytes)],
      ["Original request",el("pre",{},show(source.request))],
      ["Provider request",el("pre",{},show(source.providerRequest))],
      ["Acquisition provenance",el("pre",{},show(source.provenance))],
      ["Original capture relationship",el("pre",{},show(source.original))],
      ["Explicit credential redactions",el("pre",{},show(source.redactions))],
      ["Bulk job",el("pre",{},source.job ? show(source.job) : "Not a recorded Bulk source")]
    ]));
  }
  function originalFields(record,labelText) {
    if(!record)return el("p",{className:"muted"},labelText+": no retained object.");
    return el("details",{},el("summary",{},labelText),table(["Field","Original value"],
      Object.entries(record.fields || {}).map(([key,value])=>[key,el("pre",{},show(value))])),
      el("details",{},el("summary",{},"Exact numeric tokens, lineage and conflicts"),
        el("pre",{},show({numberTokens:record.numberTokens,lineage:record.lineage,conflicts:record.conflicts}))));
  }
  function quickWatch(row,bySource) {
    const record=recordOf(row);
    if(!record)return;
    const selector={kinds:[],sourceUrls:[],sourceIds:[],recordIds:[],text:""};
    const source=row.record ? row.source : row.previousSource;
    const sourceUrl=source?.request?.pageUrl || record.sourceUrl;
    if(bySource && sourceUrl)selector.sourceUrls=[sourceUrl];
    else selector.recordIds=[row.recordId];
    const next=clone(saved);
    next.watchlist.push({id:identifier(),label:(bySource?"Source ":"Record ")+(bySource?sourceUrl:row.recordId),
      enabled:true,selectors:selector});
    void save(next,"Exact-identity watch added.");
  }
  function renderDetail() {
    const row=current.rows.find(item=>item.recordId===selectedId);
    if(!row){detailHost.replaceChildren(el("p",{className:"empty"},"Select an observation to review its original source and change evidence."));return;}
    const record=recordOf(row);
    const history=historyFor(saved,row),decision=history.at(-1);
    const reviewer=el("input",{value:lastReviewer || decision?.reviewer || "",required:true,maxlength:1000,autocomplete:"name"});
    const note=el("textarea",{rows:3,maxlength:20000,placeholder:"Reason or follow-up. This note stays in the saved workspace."});
    const choice=el("select",{},...["accept","ignore","revisit"].map(value=>el("option",{value,selected:value===(decision?.decision || "revisit")},value)));
    const review=el("form",{onSubmit:event=>{
      event.preventDefault();
      if(!reviewer.value.trim())return;
      lastReviewer=reviewer.value.trim();
      const next=clone(saved);
      next.decisions.push({recordId:row.recordId,editionId:row.editionId,decision:choice.value,
        reviewer:lastReviewer,at:new Date().toISOString(),note:note.value});
      void save(next,"Review decision appended for this exact record and edition.");
    }},editable(
      el("h4",{},"Record a review decision"),
      el("p",{className:"small muted"},row.status==="notSeen" ?
        "Accept includes the explicitly labelled not-seen observation in the customer report. It does not assert deletion." :
        "Accept includes this edition in customer delivery; ignore excludes it; revisit leaves it for further review."),
      label("Decision",choice),label("Reviewer",reviewer),label("Review note · workspace only",note),
      el("button",{type:"submit",className:"primary"},"Save decision"),
      el("p",{className:"small muted"},"A new decision supersedes the prior decision for this edition without deleting it.")
    ));
    const content=[
      el("div",{className:"row"},el("span",{className:"tag"},row.status),el("span",{className:"tag"},stateFor(saved,row))),
      el("h3",{},titleOf(row)),
      !row.record && el("p",{className:"notice"},"No current object was observed. Previous values, when available, are labelled by their original edition. Not seen does not establish deletion."),
      !selected(saved,row) && el("p",{className:"notice"},"This observation is outside the enabled watch selection. Its saved decision remains in history, but it is excluded from customer delivery."),
      meta([["Record ID",el("code",{},row.recordId)],["Kind",show(record?.kind)],
        ["Identity basis",show(record?.identityKind)],["Provider identity",show(record?.providerId)],
        ["Review edition",row.editionId],["Observed edition",row.observedEditionId || "Unavailable"],
        ["Original source URL",link(record?.sourceUrl)],["Resolved URL",link(record?.resolvedUrl)],
        ["Captured",show(record?.capturedAt)]]),
      editable(el("div",{className:"row"},button("Watch this exact record",()=>quickWatch(row,false)),
        (row.source?.request?.pageUrl || row.previousSource?.request?.pageUrl || record?.sourceUrl) && button("Watch this source URL",()=>quickWatch(row,true)))),
      sourcePanel(row.source,"Current source provenance"),sourcePanel(row.previousSource,"Previous source provenance"),
      el("details",{open:row.fieldChanges.length>0},el("summary",{},"Exact field differences · "+row.fieldChanges.length),
        el("p",{className:"small muted"},row.comparison.exactPreviousComparisonAvailable ?
          "The supplied previous edition matches the original comparison base and comparable scope." :
          "The original comparison is incomplete or its scopes differ. These values must be interpreted with the coverage record."),
        row.fieldChanges.length ? table(["Path","Previous","Current"],row.fieldChanges.map(change=>[
          change.path,el("pre",{},change.beforePresent ? show(change.before) : "Not provided"),
          el("pre",{},change.afterPresent ? show(change.after) : "Not provided")])) :
          el("p",{className:"muted"},"No joined field differences are available."),
        el("details",{},el("summary",{},"Original classification entries"),el("pre",{},show(row.changeEvidence)))),
      row.findings.length>0 && el("div",{className:"notice"},el("strong",{},"Recorded interpretation findings"),el("pre",{},show(row.findings))),
      originalFields(row.record,"Current original object fields"),originalFields(row.previous,"Previous original object fields"),
      review,
      el("details",{open:history.length>0},el("summary",{},"Append-only review history · "+history.length),
        history.length ? table(["Event","Reviewer / time","Workspace note"],history.map(event=>[
          String(event.sequence)+" · "+event.decision,event.reviewer+" · "+event.at,
          el("pre",{},event.note || "No note")])) : el("p",{className:"muted"},"No decision has been recorded for this edition."))
    ];
    detailHost.replaceChildren(...content.filter(Boolean));
  }
  function renderRows() {
    const visible=current.rows.filter(row=>selected(saved,row)).filter(row=>
      (classification==="all" || row.status===classification) &&
      (reviewFilter==="all" || stateFor(saved,row)===reviewFilter) &&
      (!search || stable(recordOf(row) || {recordId:row.recordId}).toLowerCase().includes(search.toLowerCase())));
    const selectedRows=current.rows.filter(row=>selected(saved,row));
    countHost.replaceChildren(...[
      [selectedRows.length,"selected"],
      [selectedRows.filter(r=>stateFor(saved,r)==="accept").length,"accepted"],
      [selectedRows.filter(r=>stateFor(saved,r)==="revisit").length,"revisit"],
      [selectedRows.filter(r=>stateFor(saved,r)==="unreviewed").length,"unreviewed"]
    ].map(([n,labelText])=>el("span",{},el("b",{},n),labelText)));
    if(!visible.length){tableHost.replaceChildren(el("p",{className:"empty"},"No observations match the enabled watches and current filters."));return;}
    const body=el("tbody",{});
    for(const row of visible) {
      body.append(el("tr",{className:row.recordId===selectedId?"selected":""},
        el("td",{},button(titleOf(row),()=>{selectedId=row.recordId;renderRows();renderDetail();},{className:"record-button"}),
          el("p",{className:"small muted"},recordOf(row)?.kind || "Unresolved"),
          el("code",{className:"small"},row.recordId)),
        el("td",{},row.status),
        el("td",{},stateFor(saved,row))));
    }
    tableHost.replaceChildren(el("table",{},el("thead",{},el("tr",{},
      el("th",{},"Observation"),el("th",{},"Change"),el("th",{},"Review"))),body));
  }
  function reviewPanel() {
    const query=el("input",{type:"search",value:search,placeholder:"Filter retained fields",onInput:event=>{search=event.target.value;renderRows();}});
    const changes=el("select",{onChange:event=>{classification=event.target.value;renderRows();}},
      el("option",{value:"all"},"All classifications"),
      unique(current.rows.map(row=>row.status)).sort().map(value=>el("option",{value,selected:value===classification},value)));
    const reviews=el("select",{onChange:event=>{reviewFilter=event.target.value;renderRows();}},
      el("option",{value:"all"},"All reviews"),
      ["unreviewed","accept","ignore","revisit"].map(value=>el("option",{value,selected:value===reviewFilter},value)));
    countHost=el("div",{className:"counts"});tableHost=el("div",{className:"scroll"});detailHost=el("div",{className:"panel"});
    const list=el("section",{className:"panel"},el("h3",{},"Observation review"),countHost,
      el("div",{className:"filters"},label("Search",query),label("Change classification",changes),label("Decision",reviews)),tableHost);
    const result=el("div",{className:"grid"},list,detailHost);
    renderRows();renderDetail();return result;
  }
  function deliveryPanel() {
    const title=el("input",{value:saved.delivery.title,maxlength:300,required:true});
    const fields=unique([...current.availableFields,...saved.delivery.fields]);
    const checks=new Map(fields.map(field=>[field,el("input",{type:"checkbox",checked:saved.delivery.fields.includes(field)})]));
    const form=el("form",{onSubmit:event=>{
      event.preventDefault();
      if(!title.value.trim())return;
      const next=clone(saved);next.delivery={title:title.value,fields:fields.filter(field=>checks.get(field).checked)};
      void save(next,"Customer delivery settings saved.");
    }},editable(label("Customer report title",title),
      el("p",{className:"small muted"},"Choose source fields for customer delivery. Exact identifiers, source digests, coverage and review identity accompany accepted observations. Free-text operator notes stay in the saved workspace."),
      el("div",{className:"row"},button("Select all fields",()=>checks.forEach(input=>{input.checked=true;})),
        button("Select no fields",()=>checks.forEach(input=>{input.checked=false;}))),
      el("div",{className:"fields"},fields.map(field=>el("label",{className:"check"},checks.get(field),field))),
      el("button",{type:"submit",className:"primary"},"Save delivery settings")));
    const fresh=exportFresh();
    const stem=(saved.delivery.title.replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,70) || "recurring-report")+
      "-"+current.currentEdition.id.replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,60);
    const exports=el("div",{className:"row"},
      button("Download reviewed JSON",()=>download(stem+".json",JSON.stringify(current.customer,null,2)+"\n","application/json"),{disabled:!fresh||busy}),
      button("Download self-contained HTML",()=>download(stem+".html",current.customerHtml,"text/html;charset=utf-8"),{disabled:!fresh||busy||!current.customerHtml}));
    const preview=el("details",{},el("summary",{},"Preview the customer report"));
    if(fresh) {
      const body=el("div",{className:"customer-preview"},
        el("h4",{},current.customer.title),
        el("p",{className:"muted"},"Current edition: "+current.customer.currentEdition.id+
          (current.customer.previousEdition ? " · Previous: "+current.customer.previousEdition.id : "")),
        el("details",{},el("summary",{},"Delivery coverage"),el("pre",{},show(current.customer.coverage))));
      for(const item of current.customer.records) {
        const record=item.record || item.previous;
        body.append(el("article",{className:"customer-observation"},
          el("h4",{},record?.fields?.title || item.recordId),
          meta([["Record",item.recordId],["Status",item.status],["Observed in",item.observedEditionId],
            ["Review",item.review.reviewer+" · "+item.review.decision+" · "+item.review.at]]),
          originalFields(record,"Delivered source fields"),sourcePanel(item.source || item.previousSource,"Delivered source provenance")));
      }
      preview.append(body);
    } else preview.append(el("p",{className:"muted"},"The parent must refresh the saved report before a new customer preview can be exported."));
    return el("section",{className:"panel"},el("h3",{},"Customer delivery"),form,
      el("p",{className:"muted"},fresh ?
        String(current.customer.records.length)+" accepted observations in the current saved delivery." :
        "The watchlist or decisions have changed. Exports wait for the matching parent-generated preview."),
      exports,preview,
      fresh && el("p",{className:"small muted"},"Customer content SHA-256: ",el("code",{},current.customer.contentSha256)));
  }
  function render() {
    if(destroyed)return;
    workFields=[];
    shell=el("section",{className:"db-recurring"});
    statusNode=el("p",{className:"status",role:"status","aria-live":"polite"},message);
    shell.append(
      el("header",{},el("p",{className:"muted"},"Diffbot · recurring customer workspace"),
        el("h2",{},current.currentEdition.label || current.currentEdition.id),
        el("p",{className:"muted"},"Review retained article and product observations, then deliver the accepted edition.")),
      statusNode,coveragePanel(),watchPanel(),reviewPanel(),deliveryPanel());
    if(current.orphanedDecisions?.length)
      shell.append(el("details",{className:"panel"},el("summary",{},"Review decisions retained outside this edition · "+current.orphanedDecisions.length),
        el("p",{},"These decisions were preserved and do not approve observations in the current edition."),
        el("pre",{},show(current.orphanedDecisions))));
    if(current.findings?.length || current.originalFindings?.current?.length)
      shell.append(el("details",{className:"panel"},el("summary",{},"Original dataset and consumer findings"),
        el("pre",{},show({consumer:current.findings,original:current.originalFindings}))));
    element.replaceChildren(shell);lock(busy);
  }
  render();
  return {
    update(next) {
      if(destroyed)return;
      const nextReport=next.report ? verifyReport(next.report) : current;
      const nextConfig=cfg(next.config || (next.report ? nextReport.config : saved));
      generation++;current=nextReport;saved=nextConfig;busy=false;
      if(Object.prototype.hasOwnProperty.call(next,"readOnly"))readOnly=Boolean(next.readOnly);
      if(!current.rows.some(row=>row.recordId===selectedId))selectedId=current.rows[0]?.recordId || null;
      message="Refreshed from the original saved workspace.";render();
    },
    destroy() {
      destroyed=true;generation++;
      if(shell?.parentNode===element)shell.remove();
    },
    getConfig() { return clone(saved); }
  };
}
