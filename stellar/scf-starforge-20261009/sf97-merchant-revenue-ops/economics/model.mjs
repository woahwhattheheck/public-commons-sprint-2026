// MIT. Source-to-cost editions and handoff to the original SF97 pricing workflow.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { openSources, SOURCE_KINDS, MAX_LINES, CHARGE_FIELDS } from './inputs.mjs';
import { normalizeBook, costReport, allocateByWeights, compareCostReports } from './engine.mjs';
import { openChain, privateDir, writeOnce, readPrivate, encode, digest, canonical, fault, string, id, page,
  MAX_SOURCE, MAX_DOCUMENT, csv } from './common.mjs';
import { writeBundle } from './archive.mjs';

export async function openEconomics({directory,pricingSource,listPricing,savePricing,previewPricing,pricingBackup,supplierUsage,accountingReport}) {
  const root=join(directory,'economics');await privateDir(root,true);
  const sources=await openSources(join(root,'sources'));
  const chain=await openChain(join(root,'books'),'stellar-forge.merchant-cost-edition.v1');
  for(const name of ['pricing-links','exports'])await privateDir(join(root,name),true);
  const configured=new Map([['USAGE',supplierUsage],['ACCOUNTING',accountingReport]].filter(([,v])=>v).map(([k,v])=>[k,resolve(v)]));
  const summary=entry=>({edition:entry.value.edition,revision:entry.revision,label:entry.value.label,savedAt:entry.value.savedAt,
    pricingVersion:entry.value.pricingVersion,period:entry.value.period,lineCount:entry.value.lineCount,sourceCount:entry.value.sourceCount,
    groups:entry.value.groups,issueCount:entry.value.issueCount,requestId:entry.value.requestId,files:[...Object.keys(entry.value.files),'manifest.json']});
  async function exportRecords(){
    const rows=[];for(const name of await readdir(join(root,'exports'))){
      if(!name.endsWith('.json'))continue;
      if(!/^[a-f0-9-]{36}\.json$/.test(name))throw fault('EXPORT_RECEIPT_CHANGED','Unexpected private export receipt.');
      const row=JSON.parse((await readPrivate(join(root,'exports',name))).toString('utf8'));
      if(row.schema!=='stellar-forge.merchant-cost-export-receipt.v1'||row.requestId+'.json'!==name)
        throw fault('EXPORT_RECEIPT_CHANGED','The private export receipt does not match its identity.');
      rows.push(row);
    }
    return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.requestId.localeCompare(b.requestId));
  }
  async function state(){
    const [entries,receipts,pricing,exports]=await Promise.all([chain.history(),sources.all(),listPricing(),exportRecords()]);
    return {schema:'stellar-forge.merchant-cost-workspace.v1',revision:entries.at(-1)?.revision??null,
      editions:entries.slice(-100).reverse().map(summary),editionCount:entries.length,sources:receipts.slice(0,100),
      sourceCount:receipts.length,pricingReviews:pricing.slice(0,100),pricingReviewCount:pricing.length,
      exports:exports.slice(0,100),exportCount:exports.length,
      configuredCaptures:[...configured.keys()],limits:{sourceBytes:MAX_SOURCE,inputBytes:MAX_DOCUMENT,chargeLines:MAX_LINES},
      sourceKinds:SOURCE_KINDS,chargeFields:CHARGE_FIELDS};
  }
  async function pricing(version){
    const original=await pricingSource(version);
    return {version:original.version,revision:original.revision,label:original.label,sellerSha256:original.sellerSha256,
      reportSha256:digest(original.reportBytes),commercial:original.commercial,report:original.report,
      files:Object.keys(original.files),sellerChanged:original.sellerChanged};
  }
  async function prepare(input){
    const original=await pricingSource(input.pricingVersion),all=await sources.all(),sourceMap=new Map(all.map(x=>[x.sourceId,x]));
    const book=normalizeBook(input,original.report,sourceMap),seenImports=new Set();
    const normalizedImports=[];for(const spec of book.imports){
      if(seenImports.has(spec.sourceId))throw fault('DUPLICATE_IMPORT','Use one mapping per original source in an edition.');
      seenImports.add(spec.sourceId);const mapped=await sources.mapCharges(spec),excluded=spec.excludedRows??[];
      if(!Array.isArray(excluded)||excluded.length>mapped.rowCount)throw fault('EXCLUSIONS_INVALID','Retain explicit source row exclusions.');
      const ignored=new Map();for(const row of excluded){
        if(!Number.isSafeInteger(row.row)||row.row<1||row.row>mapped.rowCount||ignored.has(row.row))
          throw fault('EXCLUSIONS_INVALID','Each excluded row must identify one original data row.');
        ignored.set(row.row,string(row.reason,'Source-row exclusion reason',1000));
      }
      const represented=new Set(book.lines.filter(x=>x.sourceId===spec.sourceId&&x.sourceRow!==null).map(x=>x.sourceRow));
      for(let row=1;row<=mapped.rowCount;row++){
        if(represented.has(row)&&ignored.has(row))throw fault('EXCLUSIONS_INVALID','A row cannot be both allocated and excluded.');
        if(!represented.has(row)&&!ignored.has(row))throw fault('SOURCE_ROW_UNREVIEWED','Original row '+row+' needs an allocation or an explicit exclusion.');
      }
      if([...represented].some(row=>row>mapped.rowCount))throw fault('SOURCE_ROW_INVALID','A mapped line exceeds the original row count.');
      normalizedImports.push({sourceId:spec.sourceId,sourceSha256:mapped.sourceSha256,delimiter:mapped.delimiter,mapping:mapped.mapping,
        rowCount:mapped.rowCount,excludedRows:[...ignored].map(([row,reason])=>({row,reason}))});
    }book.imports=normalizedImports;
    const ids=new Set([...book.lines.map(x=>x.sourceId),...book.contextSourceIds,...book.imports.map(x=>x.sourceId)]),originals=[];
    for(const sourceId of ids)originals.push(await sources.get(sourceId,{verify:true}));
    const context=[];for(const sourceId of book.contextSourceIds)context.push(await sources.inspect(sourceId));
    return {book,original,originals,context,report:costReport(book,original.report,sourceMap)};
  }
  async function preview({book}){const result=await prepare(book);
    return {input:result.book,report:result.report,context:result.context,
      sourceSummary:result.originals.map(x=>({sourceId:x.sourceId,metadata:x.metadata,sha256:x.sha256,bytes:x.bytes}))};}
  async function save(input){
    const entry=await chain.publish(input,async()=>{
      const {book,report,original,originals,context}=await prepare(input.book);
      const binding={schema:'stellar-forge.merchant-cost-binding.v1',pricingVersion:original.version,pricingRevision:original.revision,
        sellerSha256:original.sellerSha256,pricingReportSha256:digest(original.reportBytes),
        sources:originals.map(x=>({sourceId:x.sourceId,sha256:x.sha256,receiptSha256:x.receiptSha256,bytes:x.bytes})),reason:book.reason};
      const allocationRows=report.lines.flatMap(line=>line.allocations.map(allocation=>({
        lineId:line.id,sourceId:line.sourceId,sourceRow:line.sourceRow,supplier:line.supplier,reference:line.reference,
        kind:line.kind,currency:line.currency,unit:line.unit,...allocation})));
      return {metadata:{label:book.label,pricingVersion:book.pricingVersion,period:book.period,lineCount:book.lines.length,
        sourceCount:originals.length,groups:report.groups,issueCount:report.issues.length},files:{
        'input.json':encode(book),'report.json':encode(report),'binding.json':encode(binding),'context.json':encode(context),
        'source-index.json':encode(originals),'original-pricing-report.json':original.reportBytes,
        'allocations.csv':csv(allocationRows,[['Line ID','lineId'],['Source ID','sourceId'],['Source row','sourceRow'],['Supplier','supplier'],
          ['Reference','reference'],['Kind','kind'],['Currency','currency'],['Route','routeId'],['Amount','amount'],['Quantity','quantity'],
          ['Unit','unit'],['Allocation basis','basis'],['Reason','reason']]),
        'unassigned.csv':csv(report.lines.filter(x=>x.unassigned!=='0'||x.unassignedQuantity!==null&&x.unassignedQuantity!=='0'),
          [['Line ID','id'],['Supplier','supplier'],['Currency','currency'],['Unassigned amount','unassigned'],['Quantity unit','unit'],['Unassigned quantity','unassignedQuantity']])}};
    });return {status:'COST_EDITION_SAVED',...summary(entry),replayed:entry.replayed};
  }
  async function links(editionId){
    const rows=[];for(const name of await readdir(join(root,'pricing-links'))){
      if(!/^[a-f0-9-]{36}\.json$/.test(name))throw fault('PRICING_LINK_CHANGED','Unexpected private pricing link.');
      const value=JSON.parse((await readPrivate(join(root,'pricing-links',name))).toString('utf8'));
      if(value.edition===editionId)rows.push(value);}
    return rows.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  }
  async function edition(editionId){
    const entry=await chain.find(editionId);
    const [input,report,binding,context]=await Promise.all(['input.json','report.json','binding.json','context.json'].map(async name=>
      JSON.parse((await chain.file(entry,name)).toString('utf8'))));
    return {...summary(entry),input,report,binding,context,pricingLinks:await links(editionId)};
  }
  async function proposal(input){
    const saved=await edition(input.edition),basis=input.basis;
    if(!['BILLED','QUOTED'].includes(basis)||!Array.isArray(input.routeIds)||!input.routeIds.length||
        new Set(input.routeIds).size!==input.routeIds.length)throw fault('PROPOSAL_SELECTION_REQUIRED','Select a cost basis and distinct routes.');
    const original=await pricingSource(saved.pricingVersion),commercial=structuredClone(original.commercial),changes=[];
    for(const routeId of input.routeIds){
      const row=saved.report.routes.find(x=>x.routeId===routeId),cost=row?.proposals[basis];
      if(!cost||cost.status!=='AVAILABLE')throw fault('COST_PROPOSAL_UNAVAILABLE','Route '+routeId+' still needs a complete compatible cost assessment.');
      const before=commercial.routes[routeId].perFulfilledUsd;commercial.routes[routeId].perFulfilledUsd=cost.perFulfilledUsd;
      changes.push({routeId,beforePerFulfilledUsd:before,afterPerFulfilledUsd:cost.perFulfilledUsd,allocatedUsd:cost.allocatedUsd,
        originalHttp2xx:cost.originalHttp2xx,exactRatio:cost.exactRatio,roundedReconstructionDifferenceUsd:cost.roundedReconstructionDifferenceUsd});
    }
    const value={schema:'stellar-forge.merchant-cost-pricing-proposal.v1',edition:saved.edition,editionRevision:saved.revision,
      pricingVersion:saved.pricingVersion,sellerSha256:original.sellerSha256,basis,routeIds:[...input.routeIds],
      reportSha256:saved.binding.pricingReportSha256,commercial,changes};
    return {...value,proposalSha256:digest(canonical(value)),
      originalReview:await previewPricing({sourceVersion:saved.pricingVersion,commercial}),sellerChanged:original.sellerChanged};
  }
  async function applyPricing(input){
    id(input.requestId,'Pricing request ID');const proposed=await proposal(input);
    if(input.proposalSha256!==proposed.proposalSha256)throw fault('PROPOSAL_CHANGED','Review the exact cost proposal before saving.',409);
    const saved=await edition(input.edition),binding={schema:'stellar-forge.merchant-cost-pricing-origin.v1',
      edition:saved.edition,editionRevision:saved.revision,sourcePricingVersion:saved.pricingVersion,
      proposalSha256:proposed.proposalSha256,basis:proposed.basis,routeIds:proposed.routeIds,
      originalSourceBindings:saved.binding.sources,semantics:saved.report.semantics};
    const result=await savePricing({sourceVersion:saved.pricingVersion,commercial:proposed.commercial,requestId:input.requestId,
      expectedRevision:input.expectedPricingRevision,label:string(input.label,'Pricing review name',100),costBinding:binding,
      costFiles:{'supplier-cost-provenance.json':encode(binding),'supplier-cost-input.json':encode(saved.input),
        'supplier-cost-report.json':encode(saved.report),'supplier-cost-proposal.json':encode(proposed)}});
    const receipt={schema:'stellar-forge.merchant-cost-pricing-link.v1',edition:saved.edition,editionRevision:saved.revision,
      proposalSha256:proposed.proposalSha256,requestId:input.requestId,pricingVersion:result.version,
      pricingRevision:result.revision,label:result.label,savedAt:result.savedAt};
    const path=join(root,'pricing-links',input.requestId+'.json');
    try{await writeOnce(path,encode(receipt));}catch(e){if(e.code!=='EEXIST')throw e;
      if(canonical(JSON.parse((await readPrivate(path)).toString('utf8')))!==canonical(receipt))
        throw fault('PRICING_LINK_CHANGED','The cost proposal has a different saved pricing link.',409);}
    return {status:'ORIGINAL_PRICING_REVIEW_SAVED',pricing:result,link:receipt,replayed:result.recovered===true,
      next:{pricingWorkspace:'/',paymentChanges:'/#repricing-panel'}};
  }
  async function capture(input){
    const path=configured.get(input.kind);if(!path)throw fault('CAPTURE_NOT_CONFIGURED','No host source of that kind is configured.');
    const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_SOURCE)
      throw fault('CAPTURE_SOURCE_INVALID','Configured source must be a regular file up to 16 MiB.');
    const raw=await readFile(path);if(raw.length>MAX_SOURCE)throw fault('CAPTURE_SOURCE_INVALID','Configured source exceeds 16 MiB.');
    return sources.upload({requestId:input.requestId,metadata:{label:input.label??('Configured '+input.kind.toLowerCase()),name:basename(path),
      kind:input.kind,reference:input.reference??'',period:input.period??null,supplier:input.supplier??'',note:input.note??''},body:[raw],origin:'HOST_CAPTURE'});
  }
  async function weights(input){
    const original=await pricingSource(input.pricingVersion),available=new Set(original.report.routes.map(x=>x.routeId));
    let selected=input.weights;
    if(input.basis==='HTTP_2XX_WEIGHT'){
      if(!Array.isArray(input.routeIds)||new Set(input.routeIds).size!==input.routeIds.length)throw fault('WEIGHTS_REQUIRED','Choose distinct original routes.');
      selected=input.routeIds.map(routeId=>{const row=original.report.routes.find(x=>x.routeId===routeId);
        if(!row)throw fault('ALLOCATION_ROUTE_INVALID','Weight route is absent from the saved pricing source.');
        return {routeId,weight:row.actual2xx};}).filter(x=>x.weight!=='0');
    }
    if(!Array.isArray(selected)||selected.some(x=>!available.has(x.routeId)))throw fault('ALLOCATION_ROUTE_INVALID','Weight routes must belong to the saved seller.');
    return {allocations:allocateByWeights(input.line,selected,{basis:input.basis??'OPERATOR_WEIGHT',reason:input.reason}),
      pricingVersion:original.version,pricingReportSha256:digest(original.reportBytes),
      semantics:'Explicit weights allocate the selected original amount. HTTP weights do not assert supplier-billed calls.'};
  }
  async function download(editionId,name){const entry=await chain.find(editionId);return name==='manifest.json'?encode(entry.value):chain.file(entry,name);}
  async function compare(input){const [a,b]=await Promise.all([edition(input.before),edition(input.after)]);
    return {...compareCostReports(a.report,b.report),beforeEdition:{edition:a.edition,revision:a.revision,label:a.label},
      afterEdition:{edition:b.edition,revision:b.revision,label:b.label}};}
  async function bundle(input){
    id(input.requestId,'Export request ID');const path=join(root,'exports',input.requestId+'.tar'),record=join(root,'exports',input.requestId+'.json');
    const requestHash=digest(canonical(input));let prior;
    try{prior=JSON.parse((await readPrivate(record)).toString('utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(prior){if(prior.requestSha256!==requestHash)throw fault('REQUEST_CHANGED','This export request identifies another package.',409);return prior;}
    const items=[],add=(name,read)=>items.push(typeof read==='function'?{name,read}:{name,bytes:read});let descriptor;
    if(input.kind==='COST_EDITION'){
      const saved=await edition(input.edition),entry=await chain.find(input.edition);
      for(const name of Object.keys(entry.value.files))add('cost/'+name,()=>chain.file(entry,name));
      add('cost/manifest.json',encode(entry.value));
      for(const source of saved.binding.sources){
        add('originals/'+source.sourceId+'/original',()=>sources.bytes(source.sourceId));
        add('originals/'+source.sourceId+'/source.json',()=>readPrivate(join(sources.records,source.sourceId,'source.json')));
      }
      const original=await pricingSource(saved.pricingVersion);
      for(const name of Object.keys(original.files))add('pricing/'+name,()=>original.readFile(name));
      add('cost/pricing-links.json',encode(saved.pricingLinks));
      descriptor={schema:'stellar-forge.merchant-cost-export.v1',kind:input.kind,edition:saved.edition,revision:saved.revision,pricingVersion:saved.pricingVersion};
    }else if(input.kind==='WORKSPACE_BACKUP'){
      // Capture a closed immutable graph. A cost edition can create a later pricing
      // review, which can itself be the source of another cost edition. Retain the
      // pricing prefix and extend the cost prefix only to its referenced editions.
      const before=await chain.history(),pricingSnapshot=await pricingBackup(),current=await chain.history();
      const required=new Set([...before.map(x=>x.value.edition),...pricingSnapshot.requiredCostEditions]);
      let last=-1;for(const editionId of required){
        const index=current.findIndex(x=>x.value.edition===editionId);
        if(index<0)throw fault('BACKUP_DEPENDENCY_MISSING','A committed pricing review references a missing cost edition.');
        last=Math.max(last,index);
      }
      const entries=current.slice(0,last+1),editionIds=new Set(entries.map(x=>x.value.edition)),
        pricingVersions=new Set(pricingSnapshot.pricingVersions);
      if(entries.some(x=>!pricingVersions.has(x.value.pricingVersion)))
        throw fault('BACKUP_SOURCE_CHANGED','A cost edition has no matching retained pricing source. Reopen the complete original workspace.',409);
      for(const item of pricingSnapshot.files)add(item.name,item.read);
      for(const source of await sources.all()){
        add('economics/sources/records/'+source.sourceId+'/original',()=>sources.bytes(source.sourceId));
        add('economics/sources/records/'+source.sourceId+'/source.json',()=>readPrivate(join(sources.records,source.sourceId,'source.json')));
      }
      for(const entry of entries){
        for(const name of Object.keys(entry.value.files))add('economics/books/editions/'+entry.value.edition+'/'+name,()=>chain.file(entry,name));
        add('economics/books/editions/'+entry.value.edition+'/manifest.json',encode(entry.value));
        add('economics/books/successors/'+(entry.value.previousRevision??'root')+'.json',encode(entry.value));
      }
      for(const name of await readdir(join(root,'pricing-links'))){
        if(!/^[a-f0-9-]{36}\.json$/.test(name))throw fault('PRICING_LINK_CHANGED','Unexpected private pricing link.');
        const bytes=await readPrivate(join(root,'pricing-links',name)),value=JSON.parse(bytes.toString('utf8'));
        if(editionIds.has(value.edition)&&pricingVersions.has(value.pricingVersion))add('economics/pricing-links/'+name,bytes);
      }
      descriptor={schema:'stellar-forge.merchant-cost-backup.v1',kind:input.kind,
        snapshot:{pricingRevision:pricingSnapshot.pricingRevision,decisionRevision:pricingSnapshot.decisionRevision,
          costRevision:entries.at(-1)?.revision??null},
        restore:'Restore into a new directory and reopen with original host-selected seller and observation paths.',
        excludes:['environment and credentials','external release-store runtime and processes','uncommitted pending attempts','previous export packages']};
    }else throw fault('EXPORT_KIND_INVALID','Choose a cost edition or private workspace backup.');
    descriptor={...descriptor,requestId:input.requestId,requestSha256:requestHash};
    const output=await writeBundle({path,descriptor,items});
    const result={schema:'stellar-forge.merchant-cost-export-receipt.v1',requestId:input.requestId,requestSha256:requestHash,
      kind:input.kind,edition:input.edition??null,createdAt:new Date().toISOString(),bytes:output.bytes,sha256:output.sha256,
      fileCount:output.fileCount,filename:input.requestId+'.tar',download:'/cost-files/export/'+input.requestId};
    try{await writeOnce(record,encode(result));}catch(e){if(e.code!=='EEXIST')throw e;prior=JSON.parse((await readPrivate(record)).toString('utf8'));
      if(prior.requestSha256!==requestHash||prior.sha256!==result.sha256)throw fault('EXPORT_CHANGED','Export receipt differs from its original package.',409);return prior;}
    return result;
  }
  async function exportFile(requestId){id(requestId);const value=JSON.parse((await readPrivate(join(root,'exports',requestId+'.json'))).toString('utf8'));
    return {path:join(root,'exports',requestId+'.tar'),bytes:value.bytes,sha256:value.sha256,filename:value.filename};}
  async function list(input={}){
    if(input.kind==='SOURCES')return page(await sources.all(),input);
    if(input.kind==='PRICING')return page(await listPricing(),input);
    if(input.kind==='EXPORTS')return page(await exportRecords(),input);
    return page((await chain.history()).reverse().map(summary),input);
  }
  return {root,state,pricing,preview,save,edition,proposal,applyPricing,capture,weights,download,compare,bundle,exportFile,list,
    upload:sources.upload,inspectSource:sources.inspect,mapCharges:sources.mapCharges,
    sourceDownload:async sourceId=>({source:await sources.get(sourceId),bytes:await sources.bytes(sourceId)})};
}
