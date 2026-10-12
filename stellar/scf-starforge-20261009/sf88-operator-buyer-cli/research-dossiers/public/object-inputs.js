// MIT. Original Object Buyer files in the existing managed Pipelines intake.
export function createObjectInputsPanel({root,api,task,notify,getDossier,isBusy,onPrepared}) {
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const copy=value=>JSON.parse(JSON.stringify(value));
  const initial=new URLSearchParams(location.hash.slice(1));
  const wanted=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(initial.get('object')??'')&&
    /^[a-f0-9-]{36}$/.test(initial.get('objectSession')??'')?
    {session:initial.get('object'),sessionId:initial.get('objectSession')}:null;
  const state={id:null,epoch:0,source:null,profiles:[],provider:false,items:[],next:null,snapshot:null,
    reviews:[],reviewsNext:null,selected:wanted,review:null,busy:false,shown:false,journal:null};
  root.className='pipelines-intake';
  root.innerHTML="\n<h3>Use a completed Object Buyer file</h3>\n<p class=\"muted small\" id=\"research-object-source\"></p>\n<div class=\"button-row\"><button type=\"button\" id=\"research-object-refresh\">Read saved acquisitions</button>\n<button type=\"button\" id=\"research-object-more\" hidden>More acquisitions</button>\n<button type=\"button\" id=\"research-object-history\">Read captured reviews</button></div>\n<label>Saved acquisition<select id=\"research-object-session\"><option value=\"\">Choose a saved file</option></select></label>\n<p id=\"research-object-selection\" class=\"muted small\"></p>\n<div class=\"button-row\"><button type=\"button\" id=\"research-object-review\">Review exact delivered file</button>\n<button type=\"button\" id=\"research-object-resume\" hidden>Continue saved request</button></div>\n<p id=\"research-object-pending\" class=\"muted small\" role=\"status\"></p>\n<div id=\"research-object-reviews\" aria-label=\"Captured file reviews\"></div>\n<button type=\"button\" id=\"research-object-reviews-more\" hidden>More captured reviews</button>\n<section id=\"research-object-detail\" hidden>\n<h4>Captured original file</h4><dl id=\"research-object-facts\" class=\"pipelines-facts\"></dl>\n<details class=\"original-record\"><summary>Original acquisition reference</summary><pre id=\"research-object-reference\"></pre></details>\n<form id=\"research-object-prepare-form\"><div class=\"pipelines-fields\">\n<label>Processing profile<select id=\"research-object-profile\" required></select></label>\n<label>Research question<select id=\"research-object-question\" required></select></label>\n<label>Job label<input id=\"research-object-label\" maxlength=\"240\" required></label></div>\n<button type=\"submit\" id=\"research-object-prepare\">Save processing preparation</button><p class=\"form-error\" hidden></p>\n</form></section>\n<p class=\"muted small\">Review retains the verified delivery and its original session identity in this Research workspace.\nSaving a preparation preserves that reviewed input. Submit the original plan below when you are ready to start processing.</p>";
  const $=name=>root.querySelector('#research-object-'+name);
  const context=()=>({id:state.id,epoch:state.epoch,workspaceId:state.source?.workspaceId??null,
    sourceSha256:state.source?.sourceSha256??null});
  const live=ctx=>ctx.id===state.id&&ctx.epoch===state.epoch&&ctx.workspaceId===state.source?.workspaceId&&
    ctx.sourceSha256===state.source?.sourceSha256;
  const key=ctx=>'research-original-object:v1:'+ctx.workspaceId+':'+ctx.sourceSha256+':'+ctx.id;
  const endpoint=(ctx,suffix)=>'/api/dossiers/'+encodeURIComponent(ctx.id)+'/pipelines/'+suffix;
  function readJournal(ctx) {
    try {
      const value=JSON.parse(localStorage.getItem(key(ctx))??'null');
      if(value?.schema==='research-original-object.v1'&&value.dossierId===ctx.id&&
        value.workspaceId===ctx.workspaceId&&value.sourceSha256===ctx.sourceSha256)return value;
    }catch{}
    return {schema:'research-original-object.v1',dossierId:ctx.id,workspaceId:ctx.workspaceId,
      sourceSha256:ctx.sourceSha256,pending:null,selectedReview:null};
  }
  function save(ctx,value) {
    try{localStorage.setItem(key(ctx),JSON.stringify(value));}
    catch{if(live(ctx))notify('This browser could not save the request for a restart. Keep the displayed request ID.','error');}
    if(live(ctx))state.journal=value;
  }
  function selectOptions(select,rows,selected,placeholder) {
    select.replaceChildren(...[{id:'',label:placeholder},...rows].map(row=>{
      const option=node('option',row.label);option.value=row.id;return option;
    }));
    if(rows.some(row=>row.id===selected))select.value=selected;
  }
  function render() {
    const configured=state.source?.configured===true,pending=state.journal?.pending;
    $('source').textContent=configured?'Original Object workspace '+state.source.workspaceId+
      '. Only saved sessions from the launcher-selected workspace are available.':
      'The Research launcher can select the original Object Buyer state with --object-state.';
    const rows=state.items.filter(row=>row.sessionId).map(row=>({id:row.session,label:
      (row.name||row.session)+' · '+new Intl.NumberFormat().format(row.bytes)+' bytes'+
      (row.unavailable?' · '+row.unavailable.replaceAll('_',' ').toLowerCase():'')}));
    if(state.selected&&!rows.some(row=>row.id===state.selected.session))
      rows.unshift({id:state.selected.session,label:'Selected original session '+state.selected.session});
    selectOptions($('session'),rows,state.selected?.session,'Choose a saved acquisition');
    $('selection').textContent=state.selected?'Original session '+state.selected.sessionId:
      'Choose an acquisition, then explicitly review its recorded complete file.';
    $('more').hidden=!state.next;$('resume').hidden=!pending;
    $('pending').textContent=pending?'Saved '+pending.kind.toLowerCase()+' request '+pending.body.requestId+
      '. Continue this exact request to recover its result.':state.journal?.last?.message??'';
    $('review').textContent=pending?.kind==='REVIEW'?'Continue exact file review':'Review exact delivered file';
    $('reviews').replaceChildren(...state.reviews.map(review=>{
      const button=node('button',review.reference.filename+' · '+new Intl.NumberFormat().format(review.reference.bytes)+
        ' bytes · '+review.capturedAt,'pipelines-item');
      button.type='button';button.dataset.objectReview=review.reviewId;
      button.onclick=()=>{if(isBusy()||state.busy||state.journal?.pending)return;
        state.review=review;const ctx=context(),j=readJournal(ctx);j.selectedReview=review.reviewId;save(ctx,j);render();};
      return button;
    }));
    $('reviews-more').hidden=!state.reviewsNext;
    const review=state.review,ref=review?.reference;$('detail').hidden=!review;
    if(ref) {
      const fields=[['File',ref.filename],['Bytes',String(ref.bytes)],['SHA-256',ref.sha256],
        ['Original session',ref.sessionId],['Snapshot',ref.snapshot],['Delivery',ref.deliveryMode],
        ['Configuration',ref.configurationSha256],['Captured',review.capturedAt]];
      $('facts').replaceChildren(...fields.flatMap(([label,value])=>[node('dt',label),node('dd',value)]));
      $('reference').textContent=JSON.stringify(ref,null,2);
    }
    const saved=pending?.kind==='PREPARE'?pending.body:null;
    selectOptions($('profile'),state.profiles.map(p=>({id:p.id,label:p.label})),
      saved?.profileId??$('profile').value,'Choose a processing profile');
    const dossier=getDossier();
    selectOptions($('question'),(dossier?.id===state.id?dossier.questions:[]).map(q=>({id:q.id,label:q.text})),
      saved?.questionId??$('question').value,'Choose a research question');
    if(saved)$('label').value=saved.label;
    updateBusy();
  }
  function updateBusy(parentBusy=false) {
    const busy=parentBusy||isBusy()||state.busy||!state.id,configured=state.source?.configured===true;
    root.querySelectorAll('button,input,select').forEach(el=>{el.disabled=busy;});
    if(busy)return;
    $('refresh').disabled=!configured;$('history').disabled=!configured;
    $('more').disabled=!configured||!state.next;$('reviews-more').disabled=!configured||!state.reviewsNext;
    $('session').disabled=!configured||!!state.journal?.pending;
    const selected=state.items.find(row=>row.session===state.selected?.session);
    $('review').disabled=!configured||!state.selected||!!selected?.unavailable||state.journal?.pending?.kind==='PREPARE';
    $('resume').disabled=!configured||!state.journal?.pending;
    $('prepare').disabled=!configured||!state.provider||!state.review||!!state.journal?.pending||
      !$('profile').value||!$('question').value||!$('label').value.trim();
    for(const name of ['profile','question','label'])$(name).disabled=!state.provider||!!state.journal?.pending;
    root.querySelectorAll('[data-object-review]').forEach(el=>{el.disabled=!!state.journal?.pending;});
  }
  async function run(work,form) {
    return task(async()=>{state.busy=true;updateBusy();
      try{await work();}finally{state.busy=false;updateBusy();}
    },form);
  }
  async function inventory(more=false) {
    const ctx=context();if(!ctx.id||!state.source?.configured)return;
    const query=new URLSearchParams({limit:'25'});
    if(more&&state.next){query.set('after',state.next);query.set('snapshot',state.snapshot);}
    const result=await api(endpoint(ctx,'objects?'+query));
    if(!live(ctx))return;
    state.items=more?[...state.items,...result.items]:result.items;state.next=result.nextAfter;state.snapshot=result.snapshot;
    if(!result.available)notify('The original source is unavailable. Previously captured reviews remain usable.','error');
    render();
  }
  async function reviews(more=false) {
    const ctx=context();if(!ctx.id||!state.source?.configured)return;
    const query=new URLSearchParams({limit:'25'});if(more&&state.reviewsNext)query.set('after',state.reviewsNext);
    const result=await api(endpoint(ctx,'object-reviews?'+query));if(!live(ctx))return;
    state.reviews=more?[...state.reviews,...result.items]:result.items;state.reviewsNext=result.nextAfter;
    const selected=state.reviews.find(row=>row.reviewId===state.journal?.selectedReview);if(selected)state.review=selected;
    render();
  }
  async function dispatch(ctx,pending) {
    const j=readJournal(ctx);j.pending=copy(pending);save(ctx,j);if(live(ctx))render();
    let result;
    try{result=await api(endpoint(ctx,pending.kind==='REVIEW'?'objects/review':'objects/prepare'),
      {method:'POST',body:pending.body});}
    catch(error) {
      if(Number.isInteger(error.status)&&error.status>=400&&error.status<500&&error.status!==429) {
        const saved=readJournal(ctx);saved.pending=null;
        saved.last={requestId:pending.body.requestId,error:error.code,
          message:'Request '+pending.body.requestId+' returned '+error.code+'. Its original records remain retained.'};save(ctx,saved);
      }
      throw error;
    }
    const saved=readJournal(ctx);
    if(pending.kind==='REVIEW') {
      if(result.requestId!==pending.body.requestId||result.dossierId!==ctx.id||
        result.reference?.session!==pending.body.session||result.reference?.sessionId!==pending.body.expectedSessionId||
        result.source?.workspaceId!==ctx.workspaceId||result.source?.sourceSha256!==ctx.sourceSha256)
        throw new Error('RESEARCH_OBJECT_REVIEW_REPLY_CHANGED');
      saved.selectedReview=result.reviewId;
      if(live(ctx)){state.review=result;state.reviews=[result,...state.reviews.filter(row=>row.reviewId!==result.reviewId)];}
    } else {
      const request=result.plan?.payload?.request;
      if(request?.requestId!==pending.body.requestId||request.context?.dossierId!==ctx.id||
        request.context?.objectInput?.reviewId!==pending.body.reviewId||
        request.context?.objectInput?.reviewSha256!==pending.body.expectedReviewSha256)
        throw new Error('RESEARCH_OBJECT_PREPARATION_REPLY_CHANGED');
      saved.last={requestId:pending.body.requestId,operationId:result.plan.id,
        message:'Original processing preparation '+result.plan.id+' is saved. Review and submit its plan below.'};
    }
    saved.pending=null;save(ctx,saved);if(!live(ctx))return;
    render();
    if(pending.kind==='PREPARE')await onPrepared(result,ctx.id);
    else notify((result.replayed?'Recovered':'Captured')+' the original delivered file for review.');
  }
  $('session').onchange=()=>{
    const row=state.items.find(row=>row.session===$('session').value);
    state.selected=row?{session:row.session,sessionId:row.sessionId}:null;render();
  };
  $('review').onclick=()=>run(async()=>{
    const ctx=context(),pending=state.journal?.pending;if(pending){await dispatch(ctx,copy(pending));return;}
    if(!state.selected)return;
    await dispatch(ctx,{kind:'REVIEW',body:{requestId:'research-object-review-'+crypto.randomUUID(),
      session:state.selected.session,expectedSessionId:state.selected.sessionId}});
  });
  $('resume').onclick=()=>run(()=>state.journal?.pending?dispatch(context(),copy(state.journal.pending)):Promise.resolve());
  $('prepare-form').onsubmit=event=>{event.preventDefault();run(async()=>{
    const ctx=context(),review=state.review,dossier=getDossier();if(!review||dossier?.id!==ctx.id)return;
    await dispatch(ctx,{kind:'PREPARE',body:{requestId:'research-object-prepare-'+crypto.randomUUID(),
      profileId:$('profile').value,questionId:$('question').value,label:$('label').value,
      expectedRevision:dossier.revision,reviewId:review.reviewId,expectedReviewSha256:review.reviewSha256}});
  },event.currentTarget);};
  $('refresh').onclick=()=>run(()=>inventory());$('more').onclick=()=>run(()=>inventory(true));
  $('history').onclick=()=>run(()=>reviews());$('reviews-more').onclick=()=>run(()=>reviews(true));
  for(const name of ['profile','question','label'])$(name).oninput=()=>updateBusy();
  function reset(id) {
    state.id=id;state.epoch++;state.shown=false;state.items=[];state.next=null;state.snapshot=null;
    state.reviews=[];state.reviewsNext=null;state.review=null;
    state.journal=id&&state.source?.configured?readJournal(context()):null;$('label').value='';render();
  }
  render();
  return {
    configure(value) {
      const source=value?.objects??{configured:false},changed=source.sourceSha256!==state.source?.sourceSha256;
      state.source=source;state.provider=value?.configured===true;state.profiles=value?.source?.profiles??[];
      if(changed)reset(state.id);else render();
    },
    setDossier(view) {if((view?.id??null)!==state.id)reset(view?.id??null);else render();},
    async show(visible) {
      const changed=state.shown!==visible;state.shown=visible;
      if(visible&&changed&&state.id&&state.source?.configured) {
        state.busy=true;updateBusy();
        try{await inventory();await reviews();}catch(error){notify(error.message,'error');}
        finally{state.busy=false;updateBusy();}
      }
    },
    updateBusy,
  };
}
