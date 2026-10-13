/* Complete editable handoff over the original Event column-choice core. */
import { reopen } from './workbook-columns.mjs';
export const EVENT_WORKBOOK_EDITOR='stellar-forge.event-workbook-editor.v1';
export const MAX_EVENT_WORKBOOK_EDITOR_BYTES=128*1024*1024;
const need=(ok,message)=>{if(!ok)throw Error(message);};
const size=value=>new TextEncoder().encode(value).byteLength;
const script=value=>value.replace(/<\/script/gi,'<\\/script');
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export function renderEditableWorkbookColumns(value,{coreSource,controllerSource,view}={}){
  const choices=reopen(value);
  // Complete HTML retains oversized unfinished work; serializeChoices alone guards the native return file.
  need(typeof coreSource==='string'&&coreSource.includes('export function createEventWorkbookColumnReview')&&
    coreSource.length<1024*1024,'Include the complete installed Event workbook-column core.');
  need(typeof controllerSource==='string'&&controllerSource.includes("schema:'stellar-forge.event-workbook-editor.v1'")&&
    controllerSource.length<1024*1024,'Include the complete installed offline worksheet controller.');
  if(view!==undefined)need(view&&Object.keys(view).length===2&&Number.isSafeInteger(view.sheet)&&Number.isSafeInteger(view.page)&&view.page>=0&&
    choices.original.proposal.worksheets.some(sheet=>sheet.sheet===view.sheet),'Choose a view belonging to the complete original worksheet proposal.');
  const state={schema:EVENT_WORKBOOK_EDITOR,choices,...(view===undefined?{}:{view})};
  const html='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Continue the customer worksheet</title><style>'+
    ':root{color-scheme:light;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#fff}*{box-sizing:border-box}body{margin:0}header,main{max-width:1240px;padding:24px;margin:auto}header{border-bottom:1px solid #aaa}h1{font-size:28px;line-height:1.25;margin:8px 0 12px}h2{font-size:22px}p{max-width:90ch}.eyebrow{font-size:14px;color:#555}.toolbar,.row{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:14px 0}.row>label{flex:1 1 190px;min-width:0}.row>button{flex:0 1 auto}label{display:block;font-weight:600}input,textarea,select,button{font:inherit;color:#202020;background:#fff;border:1px solid #777;border-radius:3px;min-height:44px;max-width:100%;padding:9px}input,textarea,select{display:block;width:100%;margin-top:6px}input[type=file]{font-size:14px}button{cursor:pointer;white-space:normal}button:hover{background:#eee}button:disabled{color:#666;background:#f2f2f2;cursor:default}:focus-visible{outline:3px solid #444;outline-offset:3px}fieldset{min-width:0;border:1px solid #aaa;padding:16px;margin:18px 0}legend{font-weight:600;padding:0 7px}dl{display:grid;grid-template-columns:minmax(180px,250px) minmax(0,1fr);gap:6px 14px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}pre{font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}details{margin:14px 0}summary{cursor:pointer;font-weight:600;min-height:44px;padding:9px 0}#editor-status{border-left:3px solid #777;background:#f4f4f4;padding:12px;color:#202020}#editor-status[data-error=true]{border:2px solid #444;font-weight:600}.notice{background:#f4f4f4;padding:12px;border-left:3px solid #888}[hidden]{display:none!important}@media(max-width:700px){header,main{padding:16px}h1{font-size:24px}dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:9px}.toolbar button,.row>button,.row>label{flex:1 1 100%}fieldset{padding:12px}}'+
    '</style></head><body><header><p class="eyebrow">Starforge / Customer worksheet</p><h1>Continue the customer worksheet</h1>'+
    '<p>Review the original source columns and preserve the customer’s headings, conversions, null labels and precision. Save this complete editable file to continue without the private Analysis host.</p></header>'+
    '<main aria-busy="true"><p id="editor-status" role="status" aria-live="polite">Opening the complete saved worksheet…</p>'+
    '<dl id="editor-identity"></dl><p class="notice">These are worksheet choices over the retained native proposal. Return the complete choices JSON to the same original Event programme for explicit apply. Its native workbook checks current definitions, Unicode heading uniqueness and complete source-row conversions.</p>'+
    '<div class="toolbar"><button id="save-editor" type="button">Save complete editable worksheet</button><button id="save-choices" type="button">Download complete choices for original programme</button><button id="save-original" type="button">Download original native proposal</button></div>'+
    '<section id="editor-root" aria-label="Complete worksheet column choices"></section>'+
    '<details><summary>Complete original workspace, programme and native proposal</summary><pre id="editor-original"></pre></details>'+
    '<p>The original acquired event files, report, workbook and complete Analysis archive remain in the customer’s full delivery. This editable file carries the entire native column proposal and every selected column array.</p></main>'+
    '<script id="editor-data" type="application/json">'+json(state)+'</script>'+
    '<script type="module">'+script(coreSource)+'\n'+script(controllerSource)+'</script></body></html>\n';
  need(size(html)<=MAX_EVENT_WORKBOOK_EDITOR_BYTES,'The complete editable worksheet exceeds its 128 MiB allowance.');
  return html;
}
