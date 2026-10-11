// MIT. Private file selection and retained request review in the original console.
export function createFileInput({binding,runtimeId,request,make,api,act,notice}) {
  const element=make('div',undefined,'wide'), form=binding.bodyType==='form-data';
  const omit=make('input'); omit.type='checkbox';
  const omission=make('label',undefined,'check wide');
  omission.append(omit,make('span','Send no body (the source declares the whole request body optional)'));
  if (!binding.bodyRequired) element.append(omission);
  const fileControls=[], review=make('div'), savedLabel=make('label','Retained file request'), saved=make('select');
  saved.setAttribute('aria-label','Retained file request');
  let retained=null;
  const currentRequest=()=>JSON.parse(request.value);
  function invalidate() {
    retained=null; review.replaceChildren(); saved.value='';
  }
  function show(value) {
    retained=value;
    review.replaceChildren(make('p','Retained request: '+value.bodyBytes.toLocaleString()+' bytes','small'),
      make('p','SHA-256: '+value.bodySha256,'hint wrap'));
    for (const file of value.review.files) review.append(make('p',file.field+': '+file.filename+' · '+file.contentType+' · '+file.bytes.toLocaleString()+' bytes','small'),
      make('p','File SHA-256: '+file.sha256,'hint wrap'));
    review.append(make('pre',JSON.stringify(value.review.fields,null,2),'wrap'),
      make('p','These saved bytes, including the multipart boundary, are used for the ticket and later buyer attempts.','hint'));
  }
  async function refresh() {
    const value=await api('operations/requests?runtimeId='+encodeURIComponent(runtimeId));
    saved.replaceChildren(); const empty=make('option','Select a previously retained request');empty.value='';saved.append(empty);
    for (const row of value.requests.filter(row=>row.binding===binding.binding)) {
      const option=make('option',new Date(row.createdAt).toLocaleString()+' · '+row.bodyBytes.toLocaleString()+' bytes · '+row.files.map(file=>file.filename).join(', '));
      option.value=row.fileId;saved.append(option);
    }
    saved.value=retained?.fileId??'';
  }
  if (form) {
    element.append(make('p','Multipart upload · Request limit '+binding.maxRequestBytes.toLocaleString()+' bytes, including form fields and framing. Required fields apply whenever a body is sent.','hint'));
    for (const definition of binding.fileFields) {
      const label=make('label',definition.name+(definition.required?' (required)':'')), input=make('input');
      input.type='file';input.multiple=definition.multiple;input.name=definition.name;
      label.append(input);if(definition.description)label.append(make('span',definition.description,'hint'));
      input.addEventListener('change',invalidate);fileControls.push(input);element.append(label);
    }
    const stage=make('button','Retain and review selected files');stage.type='button';
    stage.addEventListener('click',()=>act(async()=>{
      if (omit.checked) throw new Error('Clear “Send no body” before selecting an upload');
      const selection=currentRequest();delete selection.omitBody;
      const data=new FormData();data.append('@selection',JSON.stringify({runtimeId,binding:binding.binding,request:selection}));
      for (const input of fileControls) for (const file of input.files) data.append(input.name,file,file.name);
      show(await api('operations/stage',data));await refresh();
      notice('The selected file request is retained privately. Review its fields and file hashes before creating a ticket.');
    }));
    savedLabel.append(saved);element.append(stage,savedLabel,review);
    saved.addEventListener('change',()=>act(async()=>{
      if (!saved.value) {invalidate();return;}
      const value=await api('operations/load',{runtimeId,fileId:saved.value});
      const headers=Object.fromEntries(Object.entries(value.request.headers).filter(([key])=>key.toLowerCase()!=='content-type'));
      request.value=JSON.stringify({...value.request,headers,body:value.review.fields},null,2);
      for (const input of fileControls) input.value='';
      omit.checked=false;
      show(value);notice('Reopened the retained upload. Its original body bytes are ready for a new operation ticket.');
    }));
    refresh().catch(error=>{if(element.isConnected)notice(error.message,true);});
  }
  request.addEventListener('input',invalidate);
  omit.addEventListener('change',invalidate);
  function issueSelection() {
    if (omit.checked) {
      const value=currentRequest();delete value.body;
      value.headers=Object.fromEntries(Object.entries(value.headers??{}).filter(([key])=>key.toLowerCase()!=='content-type'));
      return {request:{...value,omitBody:true}};
    }
    if (form) {
      if (!retained) throw new Error('Retain and review files, or reopen a retained request, before creating its ticket');
      return {stagedFileId:retained.fileId};
    }
    return {request:currentRequest()};
  }
  return {element,issueSelection,dispose:()=>request.removeEventListener('input',invalidate)};
}
