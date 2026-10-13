/** Complete maintained application source for browser and CLI handovers.
 * Source data remains in the original workspace; this module packages code only. */
export const APPLICATION_SOURCE_PATHS=Object.freeze([
  "AGENTS.md",
  "services/fixed-asset-migration/APPLICATION_DELIVERY.md",
  "services/fixed-asset-migration/BROWSER_OPERATING.md",
  "services/fixed-asset-migration/ISSUER_REFERENCE.md",
  "services/fixed-asset-migration/README.md",
  "services/fixed-asset-migration/WORK_ORDER_OPERATING.md",
  "services/fixed-asset-migration/app.mjs",
  "services/fixed-asset-migration/migration-rehearsals.mjs",
  "services/fixed-asset-migration/migration-rehearsals-ui.mjs",
  "services/fixed-asset-migration/migration-rehearsals-receiving.mjs",
  "services/fixed-asset-migration/MIGRATION_REHEARSALS.md",
  "services/fixed-asset-migration/asset-crosswalk.mjs",
  "services/fixed-asset-migration/asset-crosswalk-ui.mjs",
  "services/fixed-asset-migration/asset-crosswalk-receiving.mjs",
  "services/fixed-asset-migration/ASSET_CROSSWALK.md",
  "services/fixed-asset-migration/application-source-node.mjs",
  "services/fixed-asset-migration/application-source.mjs",
  "services/fixed-asset-migration/build-standalone.mjs",
  "services/fixed-asset-migration/cli.mjs",
  "services/fixed-asset-migration/engine.mjs",
  "services/fixed-asset-migration/examples/port-bellingham-2025/README.md",
  "services/fixed-asset-migration/examples/port-bellingham-2025/assets.csv",
  "services/fixed-asset-migration/examples/port-bellingham-2025/balances.csv",
  "services/fixed-asset-migration/examples/port-bellingham-2025/books.csv",
  "services/fixed-asset-migration/examples/port-bellingham-2025/published-capital.csv",
  "services/fixed-asset-migration/examples/port-bellingham-2025/published-capital.json",
  "services/fixed-asset-migration/integrations/business-central/FIELD_MAPPING.csv",
  "services/fixed-asset-migration/integrations/business-central/MICROSOFT_CONTEXT_CONTRACT.json",
  "services/fixed-asset-migration/integrations/business-central/MICROSOFT_RECONCILIATION.md",
  "services/fixed-asset-migration/integrations/business-central/MICROSOFT_SOURCE_INDEX.json",
  "services/fixed-asset-migration/integrations/business-central/PROVIDER_CONTRACTS.json",
  "services/fixed-asset-migration/integrations/business-central/README.md",
  "services/fixed-asset-migration/integrations/business-central/SOURCE_INDEX.json",
  "services/fixed-asset-migration/integrations/business-central/WORK_ORDER_SOURCE.md",
  "services/fixed-asset-migration/integrations/business-central/WORK_ORDER_SOURCE_CONTRACT.json",
  "services/fixed-asset-migration/integrations/business-central/capture-example.json",
  "services/fixed-asset-migration/integrations/business-central/prepare-master-cli.mjs",
  "services/fixed-asset-migration/integrations/business-central/prepare-master.mjs",
  "services/fixed-asset-migration/integrations/business-central/prepare-work-orders-cli.mjs",
  "services/fixed-asset-migration/integrations/business-central/prepare-work-orders.mjs",
  "services/fixed-asset-migration/integrations/business-central/source-preparation-ui.mjs",
  "services/fixed-asset-migration/integrations/business-central/source-preparation-receiving.mjs",
  "services/fixed-asset-migration/integrations/business-central/SOURCE_PREPARATION_OPERATING.md",
  "services/fixed-asset-migration/integrations/business-central/work-order-capture-example.json",
  "services/fixed-asset-migration/issuer-annex.mjs",
  "services/fixed-asset-migration/issuer-ui.mjs",
  "services/fixed-asset-migration/run_browser_receiving.mjs",
  "services/fixed-asset-migration/sha256.mjs",
  "services/fixed-asset-migration/styles.css",
  "services/fixed-asset-migration/template.html",
  "services/fixed-asset-migration/templates/assets.csv",
  "services/fixed-asset-migration/templates/balances.csv",
  "services/fixed-asset-migration/templates/books.csv",
  "services/fixed-asset-migration/templates/controls.csv",
  "services/fixed-asset-migration/templates/events.csv",
  "services/fixed-asset-migration/templates/journals.csv",
  "services/fixed-asset-migration/work-orders-ui.mjs",
  "services/fixed-asset-migration/work-orders.mjs",
  "services/migration-receiving/continuation.mjs"
]);
export const APPLICATION_SOURCE_SCHEMA='tjlabs.fixed-asset-application-source.v1';

export function createApplicationSource({sha256Utf8}){
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 const mime=path=>path.endsWith('.json')?'application/json':path.endsWith('.csv')?'text/csv;charset=utf-8':path.endsWith('.html')?'text/html;charset=utf-8':path.endsWith('.mjs')?'text/javascript;charset=utf-8':path.endsWith('.css')?'text/css;charset=utf-8':'text/plain;charset=utf-8';
 const descriptor=({text,base64,...record})=>record;
 function prepare(input){
  need(Array.isArray(input)&&input.length===APPLICATION_SOURCE_PATHS.length,'Retain every declared application source file.');
  const by=new Map();
  for(const row of input){
   need(row&&typeof row.path==='string'&&typeof row.text==='string','Retain complete original application source text.');
   need(!by.has(row.path)&&APPLICATION_SOURCE_PATHS.includes(row.path),'Duplicate or undeclared application source path: '+row.path);
   const identity=sha256Utf8(row.text);
   need(identity.bytes<=32*1024*1024,'An application source file exceeds the complete member limit.');
   if(row.bytes!==undefined)need(row.bytes===identity.bytes,'Application source size changed: '+row.path);
   if(row.sha256!==undefined)need(row.sha256===identity.sha256,'Application source hash changed: '+row.path);
   by.set(row.path,{path:row.path,type:mime(row.path),text:row.text,...identity});
  }
  const files=APPLICATION_SOURCE_PATHS.map(path=>{need(by.has(path),'Missing application source: '+path);return by.get(path);});
  need(files.reduce((n,f)=>n+f.bytes,0)<=64*1024*1024,'Application source closure exceeds64 MiB.');
  const manifest={schema:APPLICATION_SOURCE_SCHEMA,files:files.map(descriptor)};
  return {...manifest,id:sha256Utf8(JSON.stringify(manifest)).sha256,files};
 }
 function verify(bundle){
  need(bundle&&bundle.schema===APPLICATION_SOURCE_SCHEMA,'Retain the complete application source bundle.');
  const checked=prepare(bundle.files);
  need(bundle.id===checked.id,'The application source manifest changed.');
  return checked;
 }
 function assertRuntime(bundle,boot){
  const checked=verify(bundle),by=new Map(checked.files.map(f=>[f.path,f.text]));
  const bindings={engineSource:'engine.mjs',shaSource:'sha256.mjs',appSource:'app.mjs',issuerSource:'issuer-annex.mjs',issuerUISource:'issuer-ui.mjs',workOrderSource:'work-orders.mjs',workOrderUISource:'work-orders-ui.mjs',applicationSourceModule:'application-source.mjs',masterPreparationSource:'integrations/business-central/prepare-master.mjs',workOrderPreparationSource:'integrations/business-central/prepare-work-orders.mjs',sourcePreparationUISource:'integrations/business-central/source-preparation-ui.mjs',assetCrosswalkSource:'asset-crosswalk.mjs',assetCrosswalkUISource:'asset-crosswalk-ui.mjs',migrationRehearsalsSource:'migration-rehearsals.mjs',migrationRehearsalsUISource:'migration-rehearsals-ui.mjs'};
  for(const [key,path]of Object.entries(bindings))need(boot[key]===by.get('services/fixed-asset-migration/'+path),'The operating module differs from its retained source: '+path);
  return checked;
 }
 function append(packet,bundle){
  const checked=verify(bundle);
  need(packet&&Array.isArray(packet.files)&&packet.manifest,'Retain the original complete workspace handover.');
  const files=packet.files.filter(f=>f.path!=='MANIFEST.json');
  const names=new Set(files.map(f=>f.path));
  need(names.size===files.length,'The original handover contains duplicate paths.');
  function add(record){need(!names.has(record.path),'Application member collides with an original handover file: '+record.path);names.add(record.path);files.push(record);}
  for(const member of checked.files)add({...member,path:'application/'+member.path});
  const sourceManifest={schema:APPLICATION_SOURCE_SCHEMA,id:checked.id,files:checked.files.map(descriptor),entrypoints:{
   browser:'../Fixed_Asset_Finance_Workspace.html',
   rebuild:'services/fixed-asset-migration/build-standalone.mjs',
   cli:'services/fixed-asset-migration/cli.mjs',
   sourcePreparation:'services/fixed-asset-migration/integrations/business-central/prepare-work-orders-cli.mjs',
   browserSourcePreparation:'services/fixed-asset-migration/integrations/business-central/SOURCE_PREPARATION_OPERATING.md',
   guide:'services/fixed-asset-migration/APPLICATION_DELIVERY.md'
  }};
  const manifestText=JSON.stringify(sourceManifest,null,2)+'\n';
  add({path:'application/SOURCE_MANIFEST.json',type:'application/json',text:manifestText,...sha256Utf8(manifestText)});
  const open='Complete editable migration delivery\n\nOpen Fixed_Asset_Finance_Workspace.html to use this exact workspace offline.\nRead application/services/fixed-asset-migration/APPLICATION_DELIVERY.md for original CLI, source preparation, rebuild and independent reopening.\nThe application/ tree retains all '+checked.files.length+' declared source files, including the Business Central/Dynaway preparers and Microsoft accounting context. Source identity: '+checked.id+'.\n\nworkspace.json retains the original records and reviews; application/ retains executable code and operating guides. Neither is a completed supplier import. Preserve every original attachment and actual source/target acceptance result.\n';
  add({path:'OPEN_DELIVERY.txt',type:'text/plain;charset=utf-8',text:open,...sha256Utf8(open)});
  const manifest={...packet.manifest,applicationSource:{schema:checked.schema,id:checked.id,files:checked.files.length,manifest:'application/SOURCE_MANIFEST.json'},files:files.map(descriptor)};
  const text=JSON.stringify(manifest,null,2)+'\n';files.push({path:'MANIFEST.json',type:'application/json',text,...sha256Utf8(text)});
  return {...packet,manifest,files};
 }
 return Object.freeze({prepare,verify,assertRuntime,append});
}
