// MIT. Receive full cost reviews and carry them into the original local editor.
export function createReceivedCostView(){
  let chosen=null,label='',file=null,selection=null,localPricing=null,review=null;
  let packages=[],selected=null,drafts=[],pendingUpload=null,pendingImport=null,reviewElement=null;
  const memoryKey='starforge.cost-receiving.pending.v1';
  const sameFile=(a,b)=>a&&b&&a.name===b.name&&a.size===b.size&&a.lastModified===b.lastModified;
  try{
    const saved=JSON.parse(sessionStorage.getItem(memoryKey)||'null');
    if(saved?.schema===memoryKey){pendingUpload=saved.upload??null;pendingImport=saved.import??null;}
  }catch{}
  function retain(){
    try{sessionStorage.setItem(memoryKey,JSON.stringify({schema:memoryKey,upload:pendingUpload,import:pendingImport}));}catch{}
  }
  const clearReview=()=>{review=null;reviewElement?.remove();reviewElement=null;};
  function hasPending(){return Boolean(pendingUpload||pendingImport);}
  function render(ctx){
    const {host,state,cost,refresh,status,el,note,muted,button,link,section,field,select,table,facts,inspect,renderReport,onAdopt}=ctx;
    const rows=new Map(packages.map(row=>[row.packageId,row]));
    for(const row of state.receivedPackages??[])rows.set(row.packageId,row);
    packages=[...rows.values()].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.packageId.localeCompare(b.packageId));
    const redraw=()=>ctx.redraw();
    async function open(packageId){
      const [next,nextDrafts]=await Promise.all([cost('received',{packageId}),cost('received-drafts',{packageId})]);
      selected=next;drafts=nextDrafts.items;selection=null;localPricing=null;clearReview();chosen=packageId;redraw();
    }
    async function adopt(result){
      await onAdopt(result.book,{packageId:result.packageId,requestId:result.requestId});
      status(result.replayed?'Original receiving draft reopened.':'Original files and the reviewed local draft are retained. Review the local period and coverage before saving.');
    }
    host.append(section('Receive an original cost review',
      muted('Select the complete COST_EDITION TAR made by Supplier costs. Its full original files, allocations, pricing source and earlier receiving history remain available here.'),
      el('div',{class:'grid'},
        el('label',{},'Complete original TAR · up to 512 MiB',el('input',{type:'file',accept:'.tar,application/x-tar',
          onchange:event=>{file=event.target.files[0]??null;if(file&&!label)label=file.name;}})),
        field('Received review name',label,value=>label=value,{max:160})),
      file?muted('Selected '+file.name+' · '+file.size+' bytes'):null,
      pendingUpload?note('Original upload request '+pendingUpload.requestId+' is retained. Recover its committed outcome, or reselect the same file and continue it.'):null,
      pendingUpload?.rejected?note('The server rejected this upload: '+pendingUpload.rejected.message+'. Choose another package to replace this rejected request.'):null,
      el('div',{class:'actions'},button(pendingUpload?'Continue original package upload':'Receive complete package',async()=>{
        if(!pendingUpload){
          if(!file||!file.size||file.size>state.receivedPackageLimit)throw new Error('Choose a nonempty original TAR of at most 512 MiB.');
          pendingUpload={requestId:crypto.randomUUID(),label:label||file.name,name:file.name,
            file:{name:file.name,size:file.size,lastModified:file.lastModified}};retain();
        }
        if(!sameFile(file,pendingUpload.file))throw new Error('Reselect the same original file, or recover the received request already on the server.');
        const request=pendingUpload;delete request.rejected;retain();
        try{
        const response=await fetch('/api/economics/received-uploads/'+request.requestId,{method:'POST',
          headers:{'content-type':'application/octet-stream','x-sf97-workspace':state.token,
            'x-sf97-received':encodeURIComponent(JSON.stringify({label:request.label,name:request.name,expectedBytes:request.file.size}))},
          body:file});
        let result;try{result=await response.json();}catch{throw new Error('Upload reply was interrupted. The original receiving request is retained above.');}
        if(!response.ok){
          if(response.status<500){request.rejected={status:response.status,code:result.code,message:result.message??'Upload rejected'};retain();}
          throw Object.assign(new Error(result.message??'Upload failed.'),{status:response.status,code:result.code});
        }
        await refresh();await open(result.packageId);pendingUpload=null;file=null;label='';retain();redraw();
        status(result.replayed?'Original complete package receiving recovered.':'Complete original cost package received.');
        }catch(error){redraw();throw error;}
      },{primary:true}),pendingUpload?button('Recover received request',async()=>{
        const result=await cost('received-request',{packageId:pendingUpload.requestId});
        if(result.status!=='COMMITTED')throw new Error('The completed package is not yet listed. Continue the retained upload with the same original file.');
        await refresh();await open(result.record.packageId);pendingUpload=null;file=null;label='';retain();redraw();status('The original received package was recovered.');
      }):null,pendingUpload?.rejected?button('Choose another package',async()=>{
        const result=await cost('received-request',{packageId:pendingUpload.requestId});
        if(result.status==='COMMITTED'){
          await refresh();await open(result.record.packageId);pendingUpload=null;file=null;label='';retain();redraw();
          status('This original package was committed and is now open. You can receive another package above.');return;
        }
        if(result.status!=='UNKNOWN')throw new Error('Recover the original receiving outcome before replacing this request.');
        pendingUpload=null;file=null;label='';retain();redraw();status('The rejected upload request is cleared. Choose the complete COST_EDITION TAR.');
      }):null)));
    if(pendingImport)host.append(section('Retained local-draft request',
      note('The exact reviewed mapping and request '+pendingImport.requestId+' remain available after an interrupted reply.'),
      button('Recover original local draft',async()=>{
        const result=await cost('received-import',pendingImport);await adopt(result);pendingImport=null;retain();
      },{primary:true})));
    host.append(section('Received review history',
      table(packages,[['Name','label'],['Received','receivedAt'],['Supplier originals','sourceCount'],['Cost lines','lineCount'],['Bytes','bytes'],
        ['Open',row=>button('Open complete review',()=>open(row.packageId))]]),
      packages.length<(state.receivedPackageCount??0)?button('Load more received reviews',async()=>{
        const result=await cost('list',{kind:'RECEIVED',after:String(packages.length),limit:100});
        packages.push(...result.items);redraw();
      }):null));
    if(ctx.savedDrafts?.length)host.append(section('Other open local drafts',
      muted('Opening a received draft keeps your earlier local editor state here for this tab.'),
      table(ctx.savedDrafts,[['Draft','label'],['Pricing source','pricingVersion'],['Return',row=>button('Return to this draft',()=>ctx.restoreDraft(row.id))]])));
    if(!selected)return;
    const value=selected;
    host.append(section('Original received review · '+value.label,
      facts([['Original cost edition',value.edition],['Original pricing source',value.pricingVersion],
        ['Original files',value.fileCount],['Archive bytes',value.bytes]]),
      muted('Archive SHA-256 '+value.sha256),
      el('div',{class:'actions'},link('Download complete original TAR',value.download)),
      inspect('Original source, pricing and cost bindings',value.binding),
      renderReport(value.report,[])));
    host.append(section('Complete original files',
      table(value.files,[['Original path','name'],['Bytes','bytes'],['SHA-256',row=>el('code',{},row.sha256)],
        ['Download',row=>link('Original file',row.download)]]),
      table(value.sources,[['Original source',row=>row.metadata.label],['Kind',row=>row.metadata.kind],
        ['Supplier',row=>row.metadata.supplier],['Original ID','sourceId'],['Local source ID','localSourceId'],
        ['Bytes','bytes']])));
    let selectedPricing=selection?.pricingVersion??'';
    host.append(section('Choose the local pricing source',
      muted('Receiving a local draft keeps the original period and exact amounts. Review how the original routes correspond to this saved local merchant.'),
      select('Local saved pricing review',selectedPricing,[['','Choose a local saved review'],
        ...ctx.pricingReviews.map(row=>[row.version,row.label+' · '+row.savedAt])],version=>{selectedPricing=version;}),
      el('div',{class:'actions'},button('Open local route correspondence',async()=>{
        if(!selectedPricing)throw new Error('Choose a local saved pricing review.');
        const version=selectedPricing,previousSelection=JSON.stringify(selection),loaded=await cost('pricing',{version});
        if(selectedPricing!==version||JSON.stringify(selection)!==previousSelection)
          throw new Error('The pricing choice or route mapping changed while loading. Open the current selection again.');
        localPricing=loaded;
        selection={packageId:value.packageId,expectedPackageSha256:value.sha256,pricingVersion:version,
          expectedPricingReportSha256:loaded.reportSha256,
          label:(value.label+' · received review').slice(0,160),
          reason:'Review received supplier costs against the selected local merchant pricing source.',
          routeMappings:value.pricing.routes.map(row=>{
            const exact=localPricing.report.routes.find(local=>local.routeId===row.routeId&&local.method===row.method&&local.path===row.path);
            return {from:row.routeId,to:exact?.routeId??null};
          })};
        review=null;redraw();
      }),ctx.pricingReviews.length<state.pricingReviewCount?button('Load more local pricing reviews',()=>ctx.loadMorePricing()):null)));
    if(selection&&localPricing){
      const target=[['','Leave amount unassigned'],...localPricing.report.routes.map(row=>[row.routeId,row.routeId+' · '+row.method+' '+row.path])];
      host.append(section('Review original routes and their local destinations',
        table(value.pricing.routes,[['Original route',row=>row.routeId+' · '+row.method+' '+row.path],
          ['Local destination',row=>select('Destination for '+row.routeId,selection.routeMappings.find(x=>x.from===row.routeId)?.to??'',target,routeId=>{
            selection.routeMappings.find(x=>x.from===row.routeId).to=routeId||null;clearReview();
          })]]),
        note('A local route can receive one original route mapping. Leaving a route unassigned preserves the supplier amount in the native unassigned remainder. The original mapping remains in the received package.'),
        field('Local cost edition name',selection.label,text=>{selection.label=text;clearReview();},{max:160}),
        field('Reason for this receiving and allocation decision',selection.reason,text=>{selection.reason=text;clearReview();},{type:'textarea'}),
        button('Review complete mapped costs',async()=>{
          const sent=JSON.stringify(selection),result=await cost('received-review',JSON.parse(sent));
          if(JSON.stringify(selection)!==sent){review=null;redraw();throw new Error('The route or draft selection changed during review. Review the current selection.');}
          review=result;redraw();status('Exact mapped costs reviewed. Review the local period and coverage in the receiving draft.');
        },{primary:true})));
    }
    if(review){
      const exact=review;
      reviewElement=section('Local receiving review',
        renderReport(exact.report,[]),
        note('The new local draft starts with UNKNOWN route coverage and unconfirmed period alignment. Its original cost amounts, signs, currencies, source rows and mappings are retained for the ordinary cost editor.'),
        inspect('Original-to-local source, line and route correspondence',exact.origin),
        button('Retain original files and open local draft',async()=>{
          if(pendingImport)throw new Error('Recover the retained local-draft request before starting another mapping.');
          pendingImport={...structuredClone(exact.selection),reviewSha256:exact.reviewSha256,requestId:crypto.randomUUID()};retain();
          const result=await cost('received-import',pendingImport);await adopt(result);pendingImport=null;retain();
        },{primary:true}));
      host.append(reviewElement);
    }
    if(drafts.length)host.append(section('Saved receiving drafts',
      table(drafts,[['Name','label'],['Prepared','createdAt'],['Local pricing source','pricingVersion'],
        ['Reopen',row=>button('Reopen local draft',async()=>{
          const result=await cost('received-draft',{packageId:value.packageId,requestId:row.requestId});await adopt(result);
        })]])));
  }
  return {render,hasPending};
}
