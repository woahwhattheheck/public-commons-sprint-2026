/* MIT. Explicit research intake using original objects, portfolio and custody history. */
export async function mountGleifIntake({root,api,refresh,getState,escape,download,openPortfolio,useMonitoringPolicy,message}) {
  const e=escape,context=await api("cycle-context"),branch=context.workspace;
  root.innerHTML='<h2>Receive GLEIF company research</h2><p>Open a complete handover from the Company research application. Review its exact source edition and LegalEntity fields before receiving the portfolio.</p>'+
    '<form data-intake-form><label>Complete GLEIF Monitoring handover<input name="file" type="file" accept=".json,application/json" required></label>'+
    '<div class="form-grid"><label>Receiving reviewer<input name="reviewer" required maxlength="160"></label><label>Intake note<textarea name="note" rows="2" maxlength="4000"></textarea></label></div>'+
    '<button type="submit">Inspect source and field mapping</button></form>'+
    '<div data-intake-preview aria-live="polite"></div><div class="actions"><button type="button" data-intake-receive disabled>Receive reviewed counterparties</button>'+
    '<button type="button" data-intake-prev hidden>Previous companies</button><button type="button" data-intake-next hidden>Next companies</button></div>'+
    '<div data-intake-pending></div><h3>Original research handovers</h3><div data-intake-history></div>';
  const form=root.querySelector('[data-intake-form]'),panel=root.querySelector('[data-intake-preview]'),receiveButton=root.querySelector('[data-intake-receive]');
  const field=name=>form.elements.namedItem(name),slot='gleif-monitoring-intake/'+branch;
  let selected=null,preview=null,pending=null,generation=0,busy=false,policy=null;
  const call=(path,body,options={})=>api(path,body,{...options,headers:{"X-Review-Workspace":encodeURIComponent(branch),...options.headers}});
  let saved;try{saved=JSON.parse(localStorage.getItem(slot)??'null');}catch{}
  if(saved){field('reviewer').value=saved.reviewer??'';field('note').value=saved.note??'';pending=saved.pending??null;}
  const save=()=>localStorage.setItem(slot,JSON.stringify({reviewer:field('reviewer').value,note:field('note').value,pending}));
  const current=turn=>turn===generation&&root.isConnected;
  function pendingView(){
    const node=root.querySelector('[data-intake-pending]');
    node.innerHTML=pending?'<p><strong>Original intake request retained.</strong> Continue its exact file and reviewer choices after an uncertain response.</p><button type="button" data-intake-resume>Continue original intake</button><details><summary>Request identity</summary><pre>'+e(JSON.stringify(pending,null,2))+'</pre></details>':'';
    node.querySelector('[data-intake-resume]')?.addEventListener('click',()=>perform(pending));
    receiveButton.disabled=busy||!!pending||!preview;
  }
  function render(){
    if(!preview)return;
    policy=preview.monitoringDefaults;
    panel.innerHTML='<h3>'+e(preview.title)+'</h3><p>'+preview.count+' companies · portfolio '+e(preview.portfolioKey)+' · original capture '+e(preview.captureIds[0])+'</p>'+
      '<p>'+e(preview.interpretation)+'</p><div class="table-wrap"><table><thead><tr><th>Company / LEI</th><th>Exact copied fields</th></tr></thead><tbody>'+
      preview.rows.map(row=>'<tr><td>'+e(row.caption)+'<br><code>'+e(row.properties.leiCode[0])+'</code></td><td><pre>'+e(JSON.stringify(row.properties,null,2))+'</pre></td></tr>').join('')+
      '</tbody></table></div><p>Companies '+(preview.offset+1)+'–'+(preview.offset+preview.rows.length)+' of '+preview.count+'. All selected records and the complete original project travel with this intake.</p>';
    root.querySelector('[data-intake-prev]').hidden=preview.offset===0;
    root.querySelector('[data-intake-next]').hidden=preview.nextOffset===null;pendingView();
  }
  async function inspect(offset=0) {
    const turn=++generation,original=selected;
    receiveButton.disabled=true;panel.textContent='Verifying the complete original project, response pages and mapping…';
    try{const value=await call("gleif-preview",{original,offset,limit:50});if(!current(turn)||selected!==original)return;
      if(value.workspace!==branch)throw Error('The preview belongs to another workspace.');
      preview=value;render();
    }catch(error){if(current(turn)){preview=null;panel.textContent=error.message;message(error.message,true);}}
  }
  form.addEventListener('input',()=>save());
  field('file').addEventListener('change',()=>{generation++;selected=null;preview=null;receiveButton.disabled=true;panel.textContent='Inspect the selected original file.';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const file=field('file').files[0];if(!file)return;
    const turn=++generation;busy=true;receiveButton.disabled=true;
    try{const object=await call("object",file,{headers:{"Content-Type":"application/json","X-Original-Name":encodeURIComponent(file.name)}});
      if(!current(turn)||field('file').files[0]!==file)return;selected=object.id;await inspect();
    }catch(error){if(current(turn))message(error.message,true);}
    finally{busy=false;pendingView();}
  });
  async function perform(original) {
    if(busy||!original)return;busy=true;pendingView();
    try{
      const result=await call("gleif-receive",original);
      if(result.receipt?.requestId!==original.requestId||result.receipt.original!==original.original)throw Error('The retained intake response belongs to a different request.');
      localStorage.setItem(slot+'/history/'+original.requestId,JSON.stringify({request:original,result}));
      if(pending?.requestId===original.requestId){pending=null;save();}
      await refresh();await openPortfolio(result.portfolio.id);
      message('The original research portfolio and complete project are retained. Native matching remains an explicit separate operation.');
    }catch(error){
      if(error.native?.notCommitted===true&&error.native?.requestId===original.requestId){
        localStorage.setItem(slot+'/history/'+original.requestId,JSON.stringify({request:original,rejected:error.native}));
        if(pending?.requestId===original.requestId){pending=null;save();}
      }
      message(error.message,true);
    }finally{busy=false;pendingView();}
  }
  receiveButton.addEventListener('click',()=>{
    if(!preview||busy||pending)return;
    if(!field('reviewer').value.trim()){message('Enter the receiving reviewer before accepting the portfolio.',true);return;}
    pending={requestId:crypto.randomUUID(),original:preview.original,expectedPreviewSha256:preview.previewSha256,
      reviewer:field('reviewer').value,note:field('note').value};save();pendingView();perform(pending);
  });
  root.querySelector('[data-intake-prev]').addEventListener('click',()=>{if(preview&&!busy)inspect(Math.max(0,preview.offset-50));});
  root.querySelector('[data-intake-next]').addEventListener('click',()=>{if(preview?.nextOffset!==null&&preview&&!busy)inspect(preview.nextOffset);});
  const history=root.querySelector('[data-intake-history]');
  history.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.dataset.object)await download("object?"+new URLSearchParams({id:button.dataset.object}),button.dataset.name);
      if(button.dataset.portfolio)await openPortfolio(button.dataset.portfolio);
      if(button.dataset.policy){const source=await call("gleif-preview",{original:button.dataset.policy,limit:1});useMonitoringPolicy(source.monitoringDefaults);}
    }catch(error){message(error.message,true);}
  });
  pendingView();
  return {refresh(state){
    const receipts=state?.research_intakes??[];
    history.innerHTML=receipts.length?receipts.map(receipt=>'<article><h4>'+e(state.portfolios.find(row=>row.id===receipt.portfolioId)?.label??receipt.portfolioId)+'</h4>'+
      '<p>'+e(receipt.reviewer)+' · original capture '+e(receipt.captureIds.join(', '))+'</p><p>'+e(receipt.note)+'</p><div class="actions">'+
      '<button type="button" data-portfolio="'+e(receipt.portfolioId)+'">Open original portfolio</button>'+
      '<button type="button" data-policy="'+e(receipt.original)+'">Use LEI in this case monitoring draft</button>'+
      '<button type="button" data-object="'+e(receipt.original)+'" data-name="gleif-monitoring-portfolio.json">Complete handover</button>'+
      Object.entries(receipt.files).map(([name,id])=>'<button type="button" data-object="'+e(id)+'" data-name="'+e(name)+'">'+e(name)+'</button>').join('')+
      '</div><details><summary>Complete receiving identity</summary><pre>'+e(JSON.stringify(receipt,null,2))+'</pre></details></article>').join(''):'<p>No GLEIF research handover has been received.</p>';
    pendingView();
  }};
}
