// MIT. Complete browser consumer of the original supplier-order HTTPS transport.
import { label, dateText, properties, technicalDetails, historyCard, labelTable, wireTabs } from '/presentation.mjs';
export function createSupplierOrderTransportDesk({api,mutate,downloadFile,selectDocument,message,guard,getDocument,getPrepared,refreshWorkspace}){
  const $=id=>document.getElementById(id),copy=value=>JSON.parse(JSON.stringify(value));
  const stringify=value=>JSON.stringify(value,null,2),encoded=value=>encodeURIComponent(String(value)),PAGE=30;
  const state={channels:[],configured:false,items:[],offset:0,total:0,selected:null,historyOffset:0,historyTotal:0,
    listSequence:0,selectionSequence:0,historySequence:0,nextOffset:null,historyNextOffset:null,listOffsets:[0],historyOffsets:[0],preparing:null,busy:false};
  const names={READY:'Ready to send',SENDING:'Sending',ACKNOWLEDGED:'HTTPS acknowledged',UNKNOWN:'Delivery outcome unknown',
    REJECTED:'Rejected',NOT_ACCEPTED:'Confirmed not accepted',CANCELLED:'Cancelled',RECEIVING:'Receiving',RECEIVED:'Received'};
  const kinds={ORDER:'Order',ORDERRESPONSE:'Confirmation',DISPATCHNOTIFICATION:'Dispatch',INVOICE:'Invoice'};
  const processing={NOT_REPORTED:'Awaiting recipient report',REVIEW:'Document review required',RETAINED:'Retained in workspace'};
  const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(className)n.className=className;return n;};
  const clear=n=>{n.replaceChildren();return n;};
  const button=(text,action)=>{const b=node('button',text);b.type='button';b.addEventListener('click',guard(action));return b;};
  const show=(id,visible)=>{$(id).hidden=!visible;};
  const addOption=(select,value,text)=>{const option=node('option',text);option.value=value;select.append(option);};
  function query(path,values){const q=new URLSearchParams();for(const [key,value]of Object.entries(values))
    if(value!==undefined&&value!==null&&value!=='')q.set(key,String(value));return path+(q.size?'?'+q:'');}
  function checkedPage(value,offset){
    if(!value||!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.total<0||
      value.offset!==offset||!Number.isSafeInteger(value.limit)||value.limit<1||
      !Object.hasOwn(value,'nextOffset')||value.nextOffset!==null&&(!Number.isSafeInteger(value.nextOffset)||value.nextOffset!==offset+value.items.length||value.nextOffset<=offset||value.nextOffset>=value.total))
      throw new Error('The original transport page has no complete record list or page identity.');
    return value;
  }
  function pager(prefix,page){
    $(prefix+'-page').textContent=page.total?(page.offset+1)+'–'+Math.min(page.total,page.offset+page.items.length)+' of '+page.total:'0 records';
    $(prefix+'-previous').disabled=page.offset===0;
    $(prefix+'-next').disabled=page.nextOffset===null;
  }
  function view(name){
    for(const b of document.querySelectorAll('[data-transport-view]')){const active=b.dataset.transportView===name;
      b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;show('transport-view-'+b.dataset.transportView,active);}
  }
  function displayChannels(){
    $('transport-channel-status').textContent=state.configured?
      state.channels.length+' configured channel'+(state.channels.length===1?'':'s')+'. Select the actual test or live channel for each document.':
      'Configure an agreed HTTPS channel in the supplier host to enable direct receiving and delivery.';
    const list=clear($('transport-channel-list'));
    for(const channel of state.channels){
      const section=node('section',null,'transport-channel');section.append(node('h3',channel.title),node('span',label(channel.mode)+' channel','badge'));
      const meta=node('dl',null,'metadata');properties(meta,[['Supplier',channel.supplierId],['Agreement',channel.agreement?.reference]]);section.append(meta);
      if(channel.incoming){section.append(node('h4','Incoming orders'));const d=node('dl',null,'metadata');
        properties(d,[['HTTPS intake',channel.incoming.url],['Authentication',channel.incoming.authentication?.type],
          ['Message identity header',channel.incoming.messageIdHeader],
          ['Response status',channel.incoming.acknowledgment?.statusCode],['Response content type',channel.incoming.acknowledgment?.contentType],
          ['Acknowledgment',channel.incoming.acknowledgment?.body]]);section.append(d);}
      if(channel.outgoing){section.append(node('h4','Outgoing documents'));const d=node('dl',null,'metadata');
        properties(d,[...Object.entries(channel.outgoing.endpoints??{}).map(([kind,url])=>[kinds[kind]??kind,url]),
          ['XML content type',channel.outgoing.contentType],['Authentication',channel.outgoing.authentication?.type],
          ['Accepted HTTP statuses',channel.outgoing.acknowledgment?.acceptedStatusCodes],['Confirmed rejection statuses',channel.outgoing.acknowledgment?.rejectedStatusCodes],
          ['Provider receipt header',channel.outgoing.acknowledgment?.receiptHeader],
          ['Request timeout',channel.outgoing.timeoutMs+' ms'],['Retained response limit',channel.outgoing.maxResponseBytes+' bytes']]);section.append(d);}
      const details=node('details');details.append(node('summary','Complete channel declaration'),node('pre',stringify(channel)));section.append(details);list.append(section);
    }
  }
  async function loadChannels(){
    const value=await api('/transport/channels');
    if(!value||!Array.isArray(value.channels)||typeof value.configured!=='boolean')throw new Error('The host returned no complete channel configuration.');
    state.channels=value.channels;state.configured=value.configured;displayChannels();return value;
  }
  function filters(){return{direction:$('transport-direction').value,state:$('transport-state').value,orderId:$('transport-order-id').value,offset:state.offset,limit:PAGE};}
  function renderList(page){
    const body=clear($('transport-table').tBodies[0]);
    if(!page.items.length){const row=node('tr'),cell=node('td','No deliveries match this selection.','empty');cell.colSpan=6;row.append(cell);body.append(row);}
    for(const record of page.items){
      const row=node('tr');if(record.id===state.selected?.id)row.classList.add('selected');
      const documentCell=node('td');documentCell.append(node('strong',kinds[record.kind]??record.kind),
        node('span',(record.orderIds??[]).join(', ')||record.source?.name||'Document details available','transport-table-sub'),
        node('span',record.direction==='incoming'?'Incoming':'Outgoing','transport-table-sub'));
      const channelCell=node('td');channelCell.append(node('strong',record.channel?.title??record.channel?.id??''),
        node('span',[record.channel?.mode?label(record.channel.mode):null,record.channel?.supplierId].filter(Boolean).join(' · '),'transport-table-sub'));
      const statusCell=node('td');statusCell.append(node('span',names[record.state]??record.state,'badge'),
        node('span','Revision '+record.revision+' · '+record.attemptCount+' attempt'+(record.attemptCount===1?'':'s'),'transport-table-sub'));
      const action=node('td');action.append(button('Open',()=>openTransmission(record.id)));
      row.append(documentCell,channelCell,statusCell,node('td',processing[record.recipientProcessing]??record.recipientProcessing??''),
        node('td',dateText(record.updatedAt??record.createdAt)),action);body.append(row);
    }
    labelTable($('transport-table'));pager('transport',page);
  }
  async function loadList(){
    const sequence=++state.listSequence,selected=filters();
    const page=checkedPage(await api(query('/transport/transmissions',selected)),selected.offset);
    if(sequence!==state.listSequence)return;
    state.items=page.items;state.total=page.total;state.nextOffset=page.nextOffset;renderList(page);
  }
  function stateExplanation(record){
    if(record.foreign)return 'This is received delivery history from another workspace. Its original attempts remain available. Prepare a local delivery from the retained document to use this host’s configured channel.';
    if(record.direction==='incoming'){
      if(record.state==='RECEIVED')return 'The original XML is retained in this workspace. Open its document to review the order and any later revisions.';
      if(record.state==='REJECTED')return record.error?.message??'The received source and its original rejection details remain available below.';
      return 'The original incoming document is being retained and processed. Refresh this delivery to read its completed result.';
    }
    return{
      READY:'The complete reviewed XML and selected channel are retained. Sending uses this exact document and channel selection.',
      SENDING:'The original HTTPS attempt is active. Refresh this delivery or reopen its original request to read the returned outcome.',
      ACKNOWLEDGED:'The configured HTTPS acknowledgment matched. The recipient record shown below tracks the reported processing state separately.',
      UNKNOWN:'The attempt has no confirmed delivery outcome. Review the retained response and obtain the original provider result, then record that result here.',
      REJECTED:'The configured rejection outcome was received. Review the response and document before preparing the same transmission for another send.',
      NOT_ACCEPTED:'Provider readback confirms that the original attempt was not accepted. It can be prepared for another send or cancelled.',
      CANCELLED:'This delivery intent is cancelled. Its history remains available, and a reasoned retry can return it to ready for a separate send.'
    }[record.state]??'Review the complete original transmission and its history.';
  }
  function resetActionFields(){
    for(const id of ['transport-provider-reference','transport-action-reason','transport-evidence-file','transport-evidence-sha'])$(id).value='';
    $('transport-resolution').value='ACKNOWLEDGED';
  }
  function actionFields(){
    const action=$('transport-action').value,isResolution=action==='resolve';
    show('transport-resolution-label',isResolution);show('transport-provider-label',isResolution);show('transport-evidence',isResolution);
    $('transport-provider-reference').required=isResolution;
    $('transport-action-submit').textContent=action==='retry'?'Prepare another attempt':action==='cancel'?'Cancel delivery':'Record provider result';
    $('transport-action-hint').textContent=action==='retry'?
      'This returns the existing delivery to ready. Its next send is a separate action.':
      action==='cancel'?'The unsent or confirmed-not-accepted intent will remain available in the complete history.':
      'Record the result from the original receiving provider and retain its reference and reason.';
  }
  function renderSelected(record,{reset=false}={}){
    $('transport-detail-title').textContent=(kinds[record.kind]??record.kind)+' delivery'+(record.orderIds?.length?' · '+record.orderIds.join(', '):'');
    clear($('transport-selected-status')).append(node('strong',names[record.state]??record.state),node('p',stateExplanation(record)));
    properties($('transport-metadata'),[['Revision',record.revision],['Direction',label(record.direction)],
      ['Channel',record.channel?.title??record.channel?.id],['Mode',record.channel?.mode?label(record.channel.mode):null],['Supplier',record.channel?.supplierId],
      ['Received history',record.foreign?'Received from another workspace':'Local delivery'],['Agreement',record.channel?.agreement?.reference],['Order references',record.orderIds],
      ['Original XML',record.source?.name],['File size',record.source?.bytes===undefined?null:record.source.bytes.toLocaleString()+' bytes'],
      ['Recipient record',processing[record.recipientProcessing]??record.recipientProcessing],['Attempts',record.attemptCount],
      ['Provider receipt',record.providerReceipt],['Created',dateText(record.createdAt)],['Updated',dateText(record.updatedAt)]]);
    const files=clear($('transport-file-actions'));
    if(record.source?.fileId)files.append(button('Download original XML',()=>downloadFile({...record.source,id:record.source.fileId,mimeType:'application/xml'})));
    if(record.documentId)files.append(button('Open document',async()=>{await selectDocument(record.documentId);$('transport-dialog').close();}));
    if(record.foreign&&record.direction==='outgoing'&&record.documentId)files.append(button('Prepare local delivery',()=>openPrepare({id:record.documentId})));
    if(record.http?.response?.fileId)files.append(button('Download HTTPS response',()=>downloadFile({...record.http.response,id:record.http.response.fileId})));
    show('transport-http',Boolean(record.http));
    if(record.http){properties($('transport-http-metadata'),[['HTTP status',record.http.statusCode],['Response complete',record.http.complete?'Yes':'No'],
      ['Response file',record.http.response?.name],['Response size',record.http.response?.bytes===undefined?null:record.http.response.bytes.toLocaleString()+' bytes']]);
      $('transport-http-headers').textContent=stringify(record.http.headers??{});}
    $('transport-record-json').textContent=stringify(record);
    const outgoing=record.direction==='outgoing'&&!record.foreign;
    show('transport-send-row',outgoing&&record.state==='READY');
    $('transport-send-description').textContent='Send '+(record.source?.name??'this document')+' through '+(record.channel?.title??record.channel?.id??'the selected channel')+' ('+(record.channel?.mode??'')+').';
    const previous=$('transport-action').value;clear($('transport-action'));
    if(outgoing&&record.state==='UNKNOWN')addOption($('transport-action'),'resolve','Record provider result');
    if(outgoing&&['REJECTED','NOT_ACCEPTED','CANCELLED'].includes(record.state))addOption($('transport-action'),'retry','Prepare another attempt');
    if(outgoing&&['READY','REJECTED','NOT_ACCEPTED'].includes(record.state))addOption($('transport-action'),'cancel','Cancel delivery');
    if([...$('transport-action').options].some(o=>o.value===previous))$('transport-action').value=previous;
    show('transport-action-form',$('transport-action').options.length>0);
    if(reset)resetActionFields();actionFields();
    $('transport-use-response').disabled=!record.http?.response?.fileId;
    $('transport-history-count').textContent=(record.historyCount??0)+' retained events';
    show('transport-detail',true);
  }
  async function loadHistory(){
    if(!state.selected)return;const sequence=++state.historySequence,id=state.selected.id,revision=state.selected.revision,offset=state.historyOffset;
    const page=checkedPage(await api(query('/transport/transmissions/'+encoded(id)+'/history',{offset,limit:PAGE})),offset);
    if(sequence!==state.historySequence||state.selected?.id!==id)return;
    if(page.transmissionId!==undefined&&page.transmissionId!==id||page.revision!==undefined&&page.revision!==revision)
      throw new Error('This delivery has newer activity. Refresh it to continue through one complete history revision.');
    state.historyTotal=page.total;state.historyNextOffset=page.nextOffset;const list=clear($('transport-history-list'));
    if(!page.items.length)list.append(node('p','No retained events in this selection.','muted'));
    for(const event of page.items)list.append(historyCard({
      title:[event.revision===undefined?null:'Revision '+event.revision,label(event.action??event.state??'Delivery event')].filter(Boolean).join(' · '),
      at:event.at??event.createdAt,reason:event.reason,rows:[['Outcome',event.state?label(event.state):null],['Provider receipt',event.providerReceipt]],record:event}));
    pager('transport-history',page);
  }
  async function openTransmission(id){
    const sequence=++state.selectionSequence,oldId=state.selected?.id;
    const record=await api('/transport/transmissions/'+encoded(id));
    if(sequence!==state.selectionSequence)return;
    if(record?.id!==id||!Number.isSafeInteger(record.revision))throw new Error('The workspace returned another transmission identity.');
    state.selected=record;state.historyOffset=0;state.historyOffsets=[0];state.historyNextOffset=null;renderSelected(record,{reset:oldId!==id});
    renderList({items:state.items,total:state.total,offset:state.offset,limit:PAGE,nextOffset:state.nextOffset});
    view('deliveries');if(!$('transport-dialog').open)$('transport-dialog').showModal();
    await loadHistory();
  }
  async function refresh(){
    await Promise.all([loadChannels(),loadList()]);
    if(state.selected)await openTransmission(state.selected.id);
  }
  async function open(){
    if(!$('transport-dialog').open)$('transport-dialog').showModal();
    view('deliveries');await refresh();
  }
  function prepareChannelInfo(){
    const prepared=state.preparing,channel=prepared?.channels.find(c=>c.id===$('transport-prepare-channel').value),target=clear($('transport-prepare-channel-info'));
    $('transport-prepare-submit').disabled=!channel;
    if(!channel){target.append(node('p','No declared outgoing channel supports this document. Open Configured channels to review the host setup.','hint'));return;}
    const d=node('dl',null,'metadata');properties(d,[['Channel',channel.title],['Mode',label(channel.mode)],['Supplier',channel.supplierId],
      ['Destination',channel.outgoing?.endpoints?.[prepared.document.kind]],['XML content type',channel.outgoing?.contentType],['Agreement',channel.agreement?.reference],
      ['Accepted HTTP statuses',channel.outgoing?.acknowledgment?.acceptedStatusCodes]]);
    target.append(d,technicalDetails('Complete selected channel',channel));
  }
  async function openPrepare(original){
    if(!original?.id)throw new Error('Select a prepared outgoing document first.');
    const [record,channels]=await Promise.all([api('/documents/'+encoded(original.id)),api('/transport/channels')]);
    if(record?.id!==original.id||record.direction!=='outgoing'||!['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE'].includes(record.kind))
      throw new Error('Prepare the complete outgoing confirmation, dispatch or invoice before arranging delivery.');
    if(!Array.isArray(channels?.channels))throw new Error('The workspace returned no declared channels.');
    const usable=channels.channels.filter(c=>c.outgoing?.endpoints?.[record.kind]);
    state.preparing={document:copy(record),channels:copy(usable)};
    properties($('transport-prepare-document'),[['Document',record.documentId],['Kind',kinds[record.kind]],['Revision',record.revision],
      ['Orders',record.orderIds],['Source XML',record.source?.name],['File size',record.source?.bytes===undefined?null:record.source.bytes.toLocaleString()+' bytes']]);
    clear($('transport-prepare-channel'));for(const c of usable)addOption($('transport-prepare-channel'),c.id,c.title+' · '+label(c.mode));
    $('transport-prepare-reason').value='';prepareChannelInfo();if(!$('transport-prepare-dialog').open)$('transport-prepare-dialog').showModal();
  }
  async function mutation(kind,path,body){
    if(state.busy)throw new Error('The selected delivery action is still running.');
    state.busy=true;for(const id of ['transport-prepare-form','transport-action-form','transport-send-row'])$(id).inert=true;
    try{return await mutate(kind,path,body);}
    finally{state.busy=false;for(const id of ['transport-prepare-form','transport-action-form','transport-send-row'])$(id).inert=false;}
  }
  async function prepare(){
    const selected=state.preparing,channel=selected?.channels.find(c=>c.id===$('transport-prepare-channel').value),reason=$('transport-prepare-reason').value;
    if(!selected||!channel)throw new Error('Select a declared outgoing channel.');
    if(!reason.trim())throw new Error('Describe why this document should be delivered.');
    return mutation('transport-prepare','/transport/prepare',{documentId:selected.document.id,expectedDocumentSha256:selected.document.sha256,
      channelId:channel.id,expectedChannelSha256:channel.sha256,reason});
  }
  async function send(){
    const record=state.selected;if(!record||record.foreign||record.direction!=='outgoing'||record.state!=='READY')throw new Error('Reopen the original ready transmission.');
    return mutation('transport-send','/transport/transmissions/'+encoded(record.id)+'/send',{transmissionId:record.id,expectedRevision:record.revision});
  }
  async function act(){
    const record=state.selected,action=$('transport-action').value,reason=$('transport-action-reason').value;
    if(!record||!['retry','resolve','cancel'].includes(action))throw new Error('Select an available delivery action.');
    if(!reason.trim())throw new Error('Describe the reason for this delivery decision.');
    const body={transmissionId:record.id,expectedRevision:record.revision,reason};
    if(action==='resolve'){
      body.outcome=$('transport-resolution').value;body.providerReference=$('transport-provider-reference').value;
      if(!body.providerReference.trim())throw new Error('Retain the original provider result reference.');
      const file=$('transport-evidence-file').value,sha=$('transport-evidence-sha').value;
      if(Boolean(file)!==Boolean(sha))throw new Error('Supply both the original evidence file ID and SHA-256.');
      if(file){if(!/^[a-f0-9]{64}$/.test(sha))throw new Error('Use the complete retained evidence SHA-256.');body.evidenceFileId=file;body.expectedEvidenceSha256=sha;}
    }
    return mutation('transport-'+action,'/transport/transmissions/'+encoded(record.id)+'/'+action,body);
  }
  async function receiveResult(kind,result,request){
    const id=result.transmissionId??result.transmission?.id;
    if(!id)throw new Error('The completed delivery operation omitted its original transmission identity.');
    if(kind==='transport-prepare'&&$('transport-prepare-dialog').open)$('transport-prepare-dialog').close();
    await Promise.all([loadChannels(),loadList()]);
    if(!state.selected||state.selected.id===id||kind==='transport-prepare')await openTransmission(id);
    if(kind!=='transport-prepare'&&request?.body?.transmissionId===state.selected?.id)resetActionFields();
    if(refreshWorkspace)await refreshWorkspace();
    message((kinds[result.transmission?.kind]??'Document')+' delivery · '+(names[result.transmission?.state]??result.transmission?.state??'saved')+'.');
  }
  async function reviewRequest(request){
    if(request.kind==='transport-prepare'){
      await openPrepare({id:request.body.documentId});
      if(state.preparing.channels.some(c=>c.id===request.body.channelId))$('transport-prepare-channel').value=request.body.channelId;
      $('transport-prepare-reason').value=request.body.reason??'';prepareChannelInfo();
      message('The current document and channel are open. Review this complete selection before preparing a new request.');
      return;
    }
    const id=request.body.transmissionId;if(!id)return;
    await openTransmission(id);
    const action=request.kind.slice('transport-'.length);
    if([...$('transport-action').options].some(o=>o.value===action))$('transport-action').value=action;
    $('transport-action-reason').value=request.body.reason??'';
    $('transport-provider-reference').value=request.body.providerReference??'';
    $('transport-evidence-file').value=request.body.evidenceFileId??'';
    $('transport-evidence-sha').value=request.body.expectedEvidenceSha256??'';
    if(request.body.outcome)$('transport-resolution').value=request.body.outcome;
    actionFields();message('The current delivery revision is open with the earlier decision text retained for review.');
  }
  for(const [value,label]of Object.entries(names))addOption($('transport-state'),value,label);
  for(const b of document.querySelectorAll('[data-transport-view]'))b.addEventListener('click',()=>view(b.dataset.transportView));
  wireTabs(document.querySelectorAll('[data-transport-view]'),view,b=>b.dataset.transportView);
  $('open-transport').addEventListener('click',guard(open));
  $('transport-refresh').addEventListener('click',guard(refresh));
  $('transport-filter-form').addEventListener('submit',guard(async()=>{state.offset=0;state.listOffsets=[0];state.nextOffset=null;await loadList();}));
  $('transport-clear-filters').addEventListener('click',guard(async()=>{for(const id of ['transport-direction','transport-state','transport-order-id'])$(id).value='';state.offset=0;state.listOffsets=[0];state.nextOffset=null;await loadList();}));
  $('transport-previous').addEventListener('click',guard(async()=>{if(state.listOffsets.length<2)return;state.listOffsets.pop();state.offset=state.listOffsets.at(-1);await loadList();}));
  $('transport-next').addEventListener('click',guard(async()=>{if(!Number.isSafeInteger(state.nextOffset)||state.nextOffset<=state.offset)return;state.offset=state.nextOffset;state.listOffsets.push(state.offset);await loadList();}));
  $('transport-close-detail').addEventListener('click',()=>{state.selected=null;state.selectionSequence++;state.historySequence++;show('transport-detail',false);});
  $('transport-history-previous').addEventListener('click',guard(async()=>{if(state.historyOffsets.length<2)return;state.historyOffsets.pop();state.historyOffset=state.historyOffsets.at(-1);await loadHistory();}));
  $('transport-history-next').addEventListener('click',guard(async()=>{if(!Number.isSafeInteger(state.historyNextOffset)||state.historyNextOffset<=state.historyOffset)return;state.historyOffset=state.historyNextOffset;state.historyOffsets.push(state.historyOffset);await loadHistory();}));
  $('transport-prepare-channel').addEventListener('change',prepareChannelInfo);
  $('transport-prepare-form').addEventListener('submit',guard(prepare));
  $('transport-send').addEventListener('click',guard(send));
  $('transport-action').addEventListener('change',actionFields);
  $('transport-action-form').addEventListener('submit',guard(act));
  $('transport-use-response').addEventListener('click',()=>{const response=state.selected?.http?.response;if(response?.fileId){$('transport-evidence-file').value=response.fileId;$('transport-evidence-sha').value=response.sha256;}});
  $('document-deliver').addEventListener('click',guard(()=>openPrepare(getDocument())));
  $('prepared-deliver').addEventListener('click',guard(()=>openPrepare(getPrepared())));
  return Object.freeze({open,openPrepare,openTransmission,receiveResult,reviewRequest,refreshIfOpen:()=>$('transport-dialog').open?refresh():Promise.resolve(),
    documentSelected:record=>{$('document-deliver').disabled=record?.direction!=='outgoing'||!['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE'].includes(record?.kind);}});
}
