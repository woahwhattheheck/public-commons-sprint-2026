import {escape as E,csvOutput} from "./core.mjs";
export function sourceState(value={}) {
  value=value&&typeof value==="object"?value:{};
  return {query:typeof value.query==="string"?value.query.slice(0,500):"",
    page:Number.isSafeInteger(value.page)&&value.page>=0?value.page:0,
    size:[25,50,100].includes(value.size)?value.size:25};
}
export function sourceSelection(c,state={}) {
  const selected=sourceState(state),query=selected.query.toLocaleLowerCase();
  const rows=query?c.source_rows.filter(r=>JSON.stringify([r.row,r.cells??r.item,r.item]).toLocaleLowerCase().includes(query)):c.source_rows;
  const pages=Math.max(1,Math.ceil(rows.length/selected.size));
  selected.page=Math.min(selected.page,pages-1);
  return {state:selected,rows,total:c.source_rows.length,matched:rows.length,pages,
    visible:rows.slice(selected.page*selected.size,(selected.page+1)*selected.size)};
}
export function sourceCSV(c,state) {
  const rows=state?sourceSelection(c,state).rows:c.source_rows;
  return csvOutput([["source_row","original_cells_json","selected_item_json"],
    ...rows.map(r=>[r.row,JSON.stringify(r.cells??r.item),JSON.stringify(r.item)])]);
}
const volatileStates=new Map();
export function mountSourceReader(element,c,{key=c.id,initial,onState=()=>{},download}={}) {
  const storageKey="defarm.source-reader.v1:"+key;
  let stored=volatileStates.get(storageKey);
  if(!stored)try{stored=JSON.parse(localStorage.getItem(storageKey)||"null");}catch{}
  let state=sourceState(initial??stored??{}),active=true;
  element.innerHTML='<label>Find in all original rows and selected items<input data-reader-query maxlength="500" type="search" value="'+E(state.query)+'"></label><div class="actions"><label>Rows per page<select data-reader-size>'+[25,50,100].map(n=>'<option value="'+n+'" '+(n===state.size?"selected":"")+'>'+n+'</option>').join("")+'</select></label><button data-reader-prev>Previous</button><button data-reader-next>Next</button><button data-reader-csv>Download matching rows</button></div><p data-reader-count role="status"></p><div class="scroll" tabindex="0" aria-label="Original source rows and selected items"><table><thead><tr><th>Original row</th><th>Original cells / item</th><th>Selected gateway item</th></tr></thead><tbody data-reader-body></tbody></table></div>';
  const q=selector=>element.querySelector(selector);
  function draw(){
    if(!active)return;const selected=sourceSelection(c,state);state=selected.state;
    q("[data-reader-count]").textContent=selected.matched+" matching of "+selected.total+" original rows · page "+(state.page+1)+" of "+selected.pages+(selected.matched?" · showing "+(state.page*state.size+1)+"–"+(state.page*state.size+selected.visible.length):"");
    q("[data-reader-prev]").disabled=state.page===0;
    q("[data-reader-next]").disabled=state.page+1>=selected.pages;
    q("[data-reader-body]").innerHTML=selected.visible.map(r=>'<tr><td>'+r.row+'</td><td><pre>'+E(JSON.stringify(r.cells??r.item,null,2))+'</pre></td><td><pre>'+E(JSON.stringify(r.item,null,2))+'</pre></td></tr>').join("")||'<tr><td colspan="3">No original rows match this search.</td></tr>';
    volatileStates.set(storageKey,{...state});try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}
    onState({...state});
  }
  q("[data-reader-query]").oninput=e=>{state.query=e.target.value.slice(0,500);state.page=0;draw();};
  q("[data-reader-size]").onchange=e=>{state.size=Number(e.target.value);state.page=0;draw();};
  q("[data-reader-prev]").onclick=()=>{state.page=Math.max(0,state.page-1);draw();};
  q("[data-reader-next]").onclick=()=>{state.page++;draw();};
  q("[data-reader-csv]").onclick=()=>download?.(c.id+"-matching-rows.csv",sourceCSV(c,state),"text/csv");
  if(!download)q("[data-reader-csv]").disabled=true;
  draw();
  return {getState:()=>({...state}),destroy:()=>{active=false;}};
}
