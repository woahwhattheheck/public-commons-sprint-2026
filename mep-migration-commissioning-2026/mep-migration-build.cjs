/* SPDX-License-Identifier: MIT */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MEPMigrationBuild=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
function createFiles({C,E,catalogue,core,examples,ui,template,worked}){
 const sourceJSON=JSON.stringify(catalogue).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'),safe=s=>s.replace(/<\/script/gi,'<\\/script');
 const replacements={__CORE_JS__:safe(core),__EXAMPLE_JS__:safe(examples),__SOURCE_JSON__:sourceJSON,__UI_JS__:safe(ui)};let html=template;
 for(const [key,value]of Object.entries(replacements)){if(html.split(key).length!==2)throw Error('Exactly one '+key+' placeholder is required.');html=html.replace(key,()=>value);}
 const result=worked||E.build(C,catalogue),w=result.workspace,files=[],add=(path,content)=>{if(files.some(f=>f.path===path))throw Error('Duplicate output '+path);files.push({path,content,bytes:C.bytes(content).length,sha256:C.hash(content)});};
 const working=C.exportWorkspace(w);if(C.exportWorkspace(C.importWorkspace(working,{catalogue}))!==working)throw Error('Complete editable programme changed on reopen.');
 add('mep-migration.html',html);add('examples/worked-migration.json',working);add('examples/walkthrough.json',JSON.stringify(result.walkthrough,null,2)+'\n');
 for(const f of result.originalFiles)add('examples/originals/'+f.name,f.text);
 for(const p of w.programmes){add('examples/reports/'+p.operatorKey+'.html',C.renderProgrammeReport(w,p.id));add('examples/reports/'+p.operatorKey+'.csv',C.programmeCSV(w,p.id));}
 for(const d of w.deliveries)for(const f of C.deliveryFiles(w,d.id))add('examples/handovers/'+f.name,f.content);
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let body='<h1>Six-company migration commissioning</h1><p>Complete fictional operating programme. The public company facts provide workflow context; every customer, site, job, source export and target response below is a demonstration input.</p><p><a href="mep-migration.html">Open the operating application</a> · <a href="examples/worked-migration.json">Complete editable working JSON</a> · <a href="GUIDE.md">Operating guide</a></p><h2>Programme reports</h2><ul>';
 for(const p of w.programmes)body+='<li><a href="examples/reports/'+p.operatorKey+'.html">'+escape(p.title)+'</a> · <a href="examples/reports/'+p.operatorKey+'.csv">Reconciliation CSV</a></li>';
 body+='</ul><h2>All original exports and target-result evidence</h2><ul>';
 for(const f of result.originalFiles)body+='<li><a href="examples/originals/'+escape(f.name)+'">'+escape(f.name)+'</a> — '+escape(f.kind)+'</li>';
 body+='</ul><h2>All exact frozen target handovers</h2><ul>';
 for(const d of w.deliveries){body+='<li>'+escape(d.title)+' — ';for(const ext of ['csv','json','html'])body+='<a href="examples/handovers/'+d.id+'.'+ext+'">'+ext.toUpperCase()+'</a> ';body+='</li>';}body+='</ul>';
 add('index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Complete migration commissioning programme</title><style>html{color-scheme:light}body{margin:0;padding:28px;max-width:1120px;font:15px/1.55 Arial,sans-serif;background:#f4f4f4;color:#171717}h1,h2{line-height:1.25}li{padding:6px 0;overflow-wrap:anywhere}a{color:#222;text-underline-offset:3px}a:focus-visible{outline:3px solid #333}@media(max-width:480px){body{padding:16px}h1{font-size:25px}}</style></head><body>'+body+'</body></html>');
 add('examples/manifest.json',JSON.stringify({schema:'commons.mep-migration.example-files.v1',workspaceId:w.id,revision:w.revision,overview:C.overview(w),files:files.map(({path,bytes,sha256})=>({path,bytes,sha256}))},null,2)+'\n');
 return {files,workspace:w,overview:C.overview(w)};
}
return Object.freeze({createFiles});
});
