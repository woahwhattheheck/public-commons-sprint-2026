"use strict";
function assembleReportDelivery({core,sha,zip,api,view,operate,compose,original,seeds,sourceFiles,at}){
 const get=path=>{const f=sourceFiles.find(f=>f.path===path);if(!f)throw Error("Missing complete source "+path);return f.content;};
 const sourcePaths=["desk/report-core.cjs","desk/report-view.cjs","runtime/host/connected_sha256.cjs","desk/README.txt","rebuild.cjs","conversion-adapter.mjs","CONVERSION-ADAPTER.md","conversion-return-contract.json"];
 const customerFiles={"report-desk-README.txt":get("desk/README.txt"),"rebuild.cjs":get("rebuild.cjs"),"conversion-adapter.mjs":get("conversion-adapter.mjs"),"CONVERSION-ADAPTER.md":get("CONVERSION-ADAPTER.md"),"conversion-return-contract.json":get("conversion-return-contract.json")},examples={},apps={};
 for(const kind of ["sample","paid"]){
  const workspace=api.create(seeds[kind]),working=api.exportWorking(workspace);
  const files=[...sourcePaths.map(path=>({path,content:get(path),...sha.sha256Utf8(get(path))})),{path:"initial-working.json",content:working,...sha.sha256Utf8(working)}];
  const html=view.reportHtml({workspace,coreSource:get("desk/report-core.cjs"),shaSource:get("runtime/host/connected_sha256.cjs"),sourceFiles:files,guide:get("desk/README.txt")});
  customerFiles["report-"+kind+"/app.html"]=html;
  customerFiles["report-"+kind+"/application-source.json"]=JSON.stringify({schema:"jsonsupport.report-application-source.v1",files},null,2)+"\n";
  customerFiles["report-"+kind+"/working.json"]=working;
  apps[kind]={bytes:sha.sha256Utf8(html).bytes,sha256:sha.sha256Utf8(html).sha256,sourceFiles:files.length,seed_sha256:workspace.seed_sha256};
  examples[kind]=operate(api,workspace);
 }
 const result=compose(core,sha,original,customerFiles,at),archives={};
 for(const kind of ["sample","paid"]){
  const selection=result.packages[kind],entries=selection.files.map(f=>{const data=zip.fromBase64(f.document.content_base64);if(data.length!==f.document.bytes||sha.sha256Utf8(zip.utf8Text(data)).sha256!==f.document.sha256)throw Error("Original selected member changed: "+f.document.name);return{name:f.document.name,data};});
  const data=zip.packStoredZip(entries,{timestamp:"2026-10-13T14:45:00.000Z"}),reopened=zip.readStoredZip(data);
  if(reopened.length!==entries.length)throw Error("Whole package member count changed.");
  for(let i=0;i<entries.length;i++){const found=reopened.find(f=>f.name===entries[i].name);if(!found||zip.base64(found.data)!==zip.base64(entries[i].data))throw Error("Reopened customer member differs: "+entries[i].name);}
  archives[kind]={data,files:entries.map(f=>({name:f.name,...sha.sha256Utf8(zip.utf8Text(f.data))}))};
 }
 return{customerFiles,examples,apps,...result,archives};
}
module.exports={assembleReportDelivery};
