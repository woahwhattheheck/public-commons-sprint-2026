function readStoredMember(bytes,name){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decode=new TextDecoder("utf-8",{fatal:true});let offset=0;
 while(offset+4<=bytes.length){
  const signature=view.getUint32(offset,true);if(signature===0x02014b50||signature===0x06054b50)break;
  if(signature!==0x04034b50||offset+30>bytes.length)throw Error("The selected archive could not be opened.");
  const flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true),size=view.getUint32(offset+18,true),raw=view.getUint32(offset+22,true),n=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+n+extra,end=start+size;
  if(flags&9||method!==0||raw!==size||end>bytes.length)throw Error("The selected archive needs its normal ZIP reader.");
  const path=decode.decode(bytes.subarray(offset+30,offset+30+n));if(path===name)return bytes.subarray(start,end);offset=end;
 }
 throw Error("The selected document is missing from this package.");
}

function parseCsvText(source){
 const rows=[];let row=[],field="",quoted=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){if(c==='"'&&source[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
  else if(c==='"'&&field==="")quoted=true;
  else if(c===","){row.push(field);field="";}
  else if(c==="\r"||c==="\n"){if(c==="\r"&&source[i+1]==="\n")i++;row.push(field);rows.push(row);row=[];field="";}
  else field+=c;
 }
 if(quoted)throw Error("The saved CSV ends inside a quoted field.");
 if(field!==""||row.length){row.push(field);rows.push(row);}
 return rows;
}

function documentPreview(name,source){
 if(/\.html?$/i.test(name))return source;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 let body;
 if(/\.csv$/i.test(name)){const rows=parseCsvText(source);body="<p>CSV preview. Scroll horizontally to read every column; download the original file to edit it in your spreadsheet.</p><div class=\"table\"><table>"+rows.map((r,i)=>"<tr>"+r.map(c=>(i?"<td>":"<th>")+esc(c)+(i?"</td>":"</th>")).join("")+"</tr>").join("")+"</table></div>";}
 else body="<pre>"+esc(/\.json$/i.test(name)?JSON.stringify(JSON.parse(source),null,2):source)+"</pre>";
 return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+esc(name)+"</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;margin:0;padding:1rem;color:#171717;background:#fff}h1{font-size:1.2rem;overflow-wrap:anywhere}p{max-width:70ch}.table{overflow:auto;border:1px solid #aaa}table{border-collapse:collapse}th,td{text-align:left;vertical-align:top;min-width:160px;max-width:340px;border:1px solid #bbb;padding:.65rem;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}pre{font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>"+esc(name)+"</h1>"+body+"</body></html>";
}

function packagePanelMain(){
 const payload=JSON.parse(document.getElementById("source").textContent),box=document.getElementById("downloads"),status=document.getElementById("status"),frame=document.getElementById("preview"),previewBox=document.getElementById("document-preview"),heading=document.getElementById("document-title");
 const unbase=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)),decode=new TextDecoder("utf-8",{fatal:true}),cache=new Map();let previewVersion=0;
 const hex=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),n=>n.toString(16).padStart(2,"0")).join("");
 const packageBytes=async p=>{let promise=cache.get(p.name);if(!promise){promise=(async()=>{const b=unbase(p.payload);if(b.length!==p.bytes||await hex(b)!==p.sha256)throw Error("The complete package could not be read.");return b;})();cache.set(p.name,promise);}return promise;};
 const memberBytes=async(p,f)=>{const b=readStoredMember(await packageBytes(p),f.name);if(b.length!==f.bytes||await hex(b)!==f.sha256)throw Error("The selected document could not be read completely.");return b;};
 function save(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 const mime=name=>/\.html?$/i.test(name)?"text/html;charset=utf-8":/\.csv$/i.test(name)?"text/csv;charset=utf-8":/\.json$/i.test(name)?"application/json":"text/plain;charset=utf-8";
 async function show(p,f){
  const version=++previewVersion;status.textContent="Opening "+f.name+"…";
  try{
   const source=decode.decode(await memberBytes(p,f));if(version!==previewVersion)return;
   heading.textContent=p.title+" — "+f.name;previewBox.hidden=false;frame.title=heading.textContent;
   frame.onload=()=>{
    if(version!==previewVersion)return;const doc=frame.contentDocument;if(!doc)return;
    frame.style.height=Math.min(1100,Math.max(420,doc.documentElement.scrollHeight+36))+"px";
    doc.addEventListener("click",event=>{
     const a=event.target.closest?.("a[href]");if(!a)return;const href=a.getAttribute("href");
     if(!href||href.startsWith("#"))return;
     if(/^(https?:|mailto:|tel:)/i.test(href)){a.target="_blank";a.rel="noopener noreferrer";return;}
     try{const current=new URL(f.name,"https://package.invalid/"),target=new URL(href,current);if(target.origin!=="https://package.invalid")return;
      const path=decodeURIComponent(target.pathname.slice(1)),next=p.files.find(x=>x.name===path);if(!next)return;event.preventDefault();show(p,next);
     }catch{}
    });
   };
   frame.srcdoc=documentPreview(f.name,source);status.textContent="Opened "+f.name+". The complete ZIP keeps its companion files together.";previewBox.scrollIntoView({block:"nearest",behavior:"smooth"});
  }catch(error){if(version===previewVersion)status.textContent=error.message;}
 }
 document.getElementById("close-preview").onclick=()=>{previewVersion++;previewBox.hidden=true;frame.removeAttribute("srcdoc");status.textContent="Choose a document to open, or download the complete package.";};
 async function start(){
  const stream=new Blob([unbase(payload.payload)]).stream().pipeThrough(new DecompressionStream("gzip")),bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  if(bytes.length!==payload.bytes||await hex(bytes)!==payload.sha256)throw Error("The saved packages could not be read completely.");
  const data=JSON.parse(decode.decode(bytes));
  for(const [i,p] of data.packages.entries()){
   const row=document.createElement("section"),title=document.createElement("h2"),info=document.createElement("p"),controls=document.createElement("div"),download=document.createElement("button"),label=document.createElement("label"),select=document.createElement("select"),open=document.createElement("button"),fileDownload=document.createElement("button");
   title.textContent=p.title;info.textContent=p.quantity+" "+(p.quantity===1?"profile":"profiles")+" · "+p.files.length+" complete documents · "+(p.bytes/1024).toFixed(1)+" KB ZIP";
   download.textContent="Download complete pack";download.onclick=async()=>{download.disabled=true;try{save(await packageBytes(p),p.name,"application/zip");status.textContent="Downloaded "+p.title+".";}catch(e){status.textContent=e.message;}finally{download.disabled=false;}};
   const order=["lead-pack.html","support/guide.html","support/pilot-workbook.csv","support/outreach-tracker.csv","supporting-files.html","leads.csv","leads.json","support/guide.md","START_HERE.txt","customer-package.json","manifest.json"];
   for(const f of [...p.files].sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name))){const o=document.createElement("option");o.value=f.name;o.textContent=f.name;select.append(o);}
   select.id="document-"+i;label.htmlFor=select.id;label.textContent="Document";open.textContent="Open document";open.className="secondary";
   open.onclick=()=>show(p,p.files.find(f=>f.name===select.value));
   fileDownload.textContent="Download document";fileDownload.className="secondary";fileDownload.onclick=async()=>{fileDownload.disabled=true;try{const f=p.files.find(f=>f.name===select.value);save(await memberBytes(p,f),f.name.split("/").pop(),mime(f.name));status.textContent="Downloaded "+f.name+".";}catch(e){status.textContent=e.message;}finally{fileDownload.disabled=false;}};
   controls.className="controls";controls.append(open,fileDownload);row.append(title,info,download,label,select,controls);box.append(row);
  }status.textContent="Open any included document here. Download the complete ZIP to keep the original files and links together.";
 }
 start().catch(e=>{status.textContent=e.message;});
}

function renderCustomerPackagePanel({customer,envelope}){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const scripts=[readStoredMember,parseCsvText,documentPreview,packagePanelMain].map(fn=>fn.toString()).join("\n")+"\npackagePanelMain();";
 return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+esc(customer)+" — complete documents</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0;padding:1.2rem}h1{font-size:1.4rem;margin:0 0 .5rem}h2{font-size:1.05rem;margin:0;overflow-wrap:anywhere}section{border:1px solid #aaa;padding:1rem;margin:1rem 0}button{border:1px solid #333;background:#222;color:#fff;padding:.6rem .8rem;cursor:pointer;border-radius:2px;font:inherit;min-height:44px}.secondary{background:#fff;color:#222}button:disabled{opacity:.6}button:focus-visible,select:focus-visible{outline:3px solid #333;outline-offset:2px}p{margin:.6rem 0}label{display:block;margin:.85rem 0 .25rem}select{width:100%;min-height:44px;padding:.5rem;background:#fff;color:#171717;border:1px solid #777;font:inherit}.controls{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.65rem}.preview-head{display:flex;justify-content:space-between;gap:1rem;align-items:start}iframe{display:block;width:100%;height:680px;border:1px solid #aaa;margin-top:1rem;background:#fff}#document-preview[hidden]{display:none}@media(max-width:480px){body{padding:.7rem}section{padding:.8rem}.preview-head{flex-direction:column}}</style></head><body><h1>"+esc(customer)+"</h1><p id=\"status\" role=\"status\">Opening the saved packages…</p><div id=\"downloads\"></div><section id=\"document-preview\" hidden><div class=\"preview-head\"><h2 id=\"document-title\"></h2><button id=\"close-preview\" class=\"secondary\">Close document</button></div><iframe id=\"preview\" title=\"Selected document\" sandbox=\"allow-same-origin allow-popups allow-popups-to-escape-sandbox\"></iframe></section><script id=\"source\" type=\"application/json\">"+JSON.stringify(envelope).replace(/</g,"\\u003c")+"</script><script>"+scripts.replace(/<\/script/gi,"<\\/script")+"</script></body></html>";
}

export {readStoredMember,parseCsvText,documentPreview,renderCustomerPackagePanel};
