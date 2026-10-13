/* Rainfall Release Review: complete offline handover. No network calls. */
(function(root) {
"use strict";
function bytes(text){return new TextEncoder().encode(text);}
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(entries) {
 const local=[],central=[];let offset=0,total=0;
 if(entries.length>65535)throw Error("Too many ZIP members.");
 const names=new Set();
 for(const entry of entries){
  if(typeof entry.path!=="string"||entry.path.startsWith("/")||entry.path.includes("\\")||entry.path.split("/").some(p=>!p||p==="."||p==="..")||/[\x00-\x1f]/.test(entry.path)||names.has(entry.path))throw Error("Invalid or duplicate handover path.");
  names.add(entry.path);const name=bytes(entry.path),body=bytes(entry.content);if(name.length>65535||body.length>0xffffffff)throw Error("ZIP64 input is not supported.");
  const crc=crc32(body),head=new Uint8Array(30+name.length),h=new DataView(head.buffer);
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,body.length,true);h.setUint32(22,body.length,true);h.setUint16(26,name.length,true);head.set(name,30);
  const c=new Uint8Array(46+name.length),v=new DataView(c.buffer);
  v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x0800,true);v.setUint16(14,33,true);v.setUint32(16,crc,true);v.setUint32(20,body.length,true);v.setUint32(24,body.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);c.set(name,46);
  local.push(head,body);central.push(c);offset+=head.length+body.length;total+=c.length;
  if(offset+total>0xffffffff)throw Error("ZIP64 input is not supported.");
 }
 const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,total,true);v.setUint32(16,offset,true);
 const output=new Uint8Array(offset+total+end.length);let p=0;for(const part of [...local,...central,end]){output.set(part,p);p+=part.length;}return output;
}
function preparedHtml(html,project) {
 if(!html.includes("async function importFiles(files)")||!html.includes("</body>"))throw Error("The maintained reviewer import seam is missing.");
 const body=JSON.stringify(project).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 if(bytes(body).length>40*1024*1024)throw Error("The complete embedded project exceeds the reviewer\u0027s 40 MB import limit.");
 const preload='<script type="application/json" id="prepared-project">'+body+'</script><script>importFiles([new File([document.getElementById("prepared-project").textContent],"review-project.json",{type:"application/json"})]);</script>';
 const close=html.lastIndexOf("</body>");return html.slice(0,close)+preload+html.slice(close);
}
function build({R,sourceFiles,captureTexts,notes="",publicSourceTexts=[],createdAt=new Date().toISOString()}) {
 if(!R||!sourceFiles||!Array.isArray(captureTexts)||captureTexts.length<1||captureTexts.length>2)throw Error("Provide maintained source and one or two original captures.");
 if(typeof notes!=="string")throw Error("Reviewer notes must be text.");
 const required=["core.js","index.html","capture.mjs","portable.js","handover.mjs","receive_handover.mjs","README.md","SOURCES.md","HANDOVER.md","AGENTS.md"];
 for(const name of required)if(typeof sourceFiles[name]!=="string")throw Error("Missing complete source: "+name);
 if(!sourceFiles["index.html"].includes("<script>"+sourceFiles["core.js"]+"</script>"))throw Error("The reviewer and editable calculation source differ. Build from one complete source edition.");
 const releases=captureTexts.map(text=>R.release(JSON.parse(text)));
 if(releases.length===2)R.compare(...releases);
 const project=R.project(releases,notes),projectText=JSON.stringify(project,null,2)+"\n";if(bytes(projectText).length>40*1024*1024)throw Error("The complete saved project exceeds the reviewer\u0027s 40 MB import limit. Choose a smaller original review window.");const members=[],add=(path,content)=>{if(typeof content!=="string")throw Error("Text content required: "+path);members.push({path,content});};
 add("review-project.json",projectText);
 add("reviewer.html",preparedHtml(sourceFiles["index.html"],project));
 add("report.html",R.report(releases,notes));
 add("OPEN_FIRST.html",opening(R,releases));
 for(let i=0;i<releases.length;i++){
  add("originals/release-"+(i+1)+".json",captureTexts[i]);
  add("originals/provider-response-"+(i+1)+".json",releases[i].capture.raw_text);
  add("tables/release-"+(i+1)+"-coverage.csv",R.csv(releases[i].summaries));
  add("tables/release-"+(i+1)+"-intervals.csv",R.csv(R.intervalRows(releases[i])));
 }
 const comparison=releases.length===2?R.compare(...releases):null;
 if(comparison)add("tables/interval-comparison.csv",R.csv(comparison.rows));
 add("summary.json",JSON.stringify({schema:"rainfall-handover-summary/v1",created_at:createdAt,releases:releases.map(r=>({metadata:r.metadata,fingerprint:r.fingerprint,summaries:r.summaries,warnings:r.warnings})),comparison:comparison?{summary:comparison.summary,source_transitions:comparison.sourceTransitions}:null},null,2)+"\n");
 for(const name of required)add("source/"+name,sourceFiles[name]);
 for(let i=0;i<publicSourceTexts.length;i++){const text=publicSourceTexts[i];JSON.parse(text);add("originals/public-source-"+(i+1)+".json",text);}
 const manifest={schema:"rainfall-handover/v1",created_at:createdAt,release_fingerprints:releases.map(r=>r.fingerprint),files:members.map(m=>({path:m.path,bytes:bytes(m.content).length,sha256:R.sha256Text(m.content)}))};
 add("manifest.json",JSON.stringify(manifest,null,2)+"\n");
 return {members,manifest,zip:zip(members),project};
}
function opening(R,releases) {
 const esc=R.escaped;
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rainfall review handover</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{max-width:1000px;margin:36px auto;padding:0 24px;font:16px/1.55 system-ui;color:#25292e;background:#fff}h1{font-size:28px}h2{font-size:20px;margin-top:28px}a{color:#303a45}nav{display:flex;gap:12px;flex-wrap:wrap}nav a{display:block;border:1px solid #9ba3ab;border-radius:4px;padding:12px 16px;text-decoration:none;background:#f5f6f7}li{margin:8px 0}code{overflow-wrap:anywhere}p{max-width:80ch}.source{overflow-wrap:anywhere;font-size:13px;color:#555e68}</style><h1>Rainfall review handover</h1><p>Open the prepared review to inspect rainfall coverage, interval values and the original data. Your saved review includes the original responses and your notes.</p><nav><a href="reviewer.html">Open prepared review</a><a href="report.html">Open report</a><a href="review-project.json" download>Download saved review</a></nav><h2>Included rainfall</h2>'+releases.map((r,i)=>'<section><h3>'+esc(r.metadata.label)+'</h3><p>'+esc(r.metadata.start+' to '+r.metadata.end)+'<br>'+esc(r.metadata.sensor_type+' '+r.metadata.sensors.join(', ')+' · '+r.metadata.interval_minutes+' minute intervals')+'</p><p><a href="tables/release-'+(i+1)+'-intervals.csv">Complete interval table</a> · <a href="tables/release-'+(i+1)+'-coverage.csv">Coverage table</a> · <a href="originals/release-'+(i+1)+'.json">Original capture</a></p><p class="source">Source: '+esc(r.metadata.source_url)+'<br>Retrieved: '+esc(r.metadata.retrieved_at)+'</p></section>').join('')+'<h2>Use and reopen</h2><ol><li>Open the prepared review. Select a sensor, inspect its interval table, and add your notes.</li><li>Choose Save review project. Keep that JSON file with this folder.</li><li>To continue later, open <a href="source/index.html">the empty reviewer</a> and load your saved project.</li><li>Use Export HTML report and Export CSV to retain your current review.</li></ol><p>Observed totals include available valid intervals. Coverage below 100% means the total is incomplete. Missing observations remain missing.</p><h2>Editable source and complete originals</h2><p>The <a href="source/HANDOVER.md">handover guide</a> includes source editing and package rebuilding. The <a href="source/README.md">operating guide</a> describes capture and comparison. Full original provider responses, acquisition history when present, and the captured publisher metadata are in the originals folder. <a href="manifest.json">The manifest</a> records every file’s size and SHA-256.</p><p class="source">Files work offline after extraction. This handover does not start a new public-data request.</p></html>';
}
root.RainfallHandover={build,zip,preparedHtml,crc32};
})(typeof globalThis!=="undefined"?globalThis:this);
