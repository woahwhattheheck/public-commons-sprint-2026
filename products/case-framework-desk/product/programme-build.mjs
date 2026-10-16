// MIT. Complete editable standalone programme; all code and original writing travel together.
export function buildCASEProgrammeHTML(work,assets) {
 const required=['product/source-json.mjs','product/case-source.mjs','product/case-report.mjs','product/programme.mjs','product/programme-host.mjs','product/programme-app.mjs','product/programme-boot.mjs','product/programme-build.mjs','product/desk.css','examples/framework-v1.json','examples/framework-v2.json'];
 for(const p of required)if(typeof assets[p]!=='string')throw Error('Complete standalone source missing '+p);
 const body=p=>assets[p].replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
 const wrap=(name,p,returns,prefix='')=>'const '+name+'=(()=>{'+prefix+'\n'+body(p)+'\nreturn {'+returns+'};})();\n';
 let script=wrap('Parser','product/source-json.mjs','readExactJSON,readCASEEnvelope');
 script+=wrap('Engine','product/case-source.mjs','compareCASEEditions,createCASEDelivery,inspectCASEDelivery,inspectCASESource,caseChangeCSV','const {readExactJSON}=Parser;');
 script+=wrap('Reports','product/case-report.mjs','renderCASEReport');
 script+=wrap('Model','product/programme.mjs','createCASEProgramme,parseCASEProgrammeJSON');
 script+=wrap('Host','product/programme-host.mjs','createCASEProgrammeHost');
 script+=wrap('App','product/programme-app.mjs','startCASEProgramme');
 script+=wrap('Builder','product/programme-build.mjs','buildCASEProgrammeHTML');
 script+=wrap('Boot','product/programme-boot.mjs','bootCASEProgramme');
 script+='const packet=JSON.parse(document.getElementById("programme-packet").textContent);Boot.bootCASEProgramme({engine:Engine,model:Model,host:Host,app:App,builder:Builder,reportHTML:Reports.renderCASEReport,assets:packet.assets,initial:packet.work}).catch(e=>{document.querySelector("main").textContent=e.message;});';
 const json=JSON.stringify({work,assets}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CASE commissioning working programme</title><style>'+assets['product/desk.css']+'</style></head><body><main><h1>CASE commissioning programme</h1><p>Opening the selected complete file…</p></main><script type="application/json" id="programme-packet">'+json+'</script><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body></html>\n';
}
