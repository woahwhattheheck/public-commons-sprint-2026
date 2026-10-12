// MIT. Local command preparation for the existing grant reviewer; the host owns all execution.
export function grantReviewerCommand(input){
  const path=(value,label)=>{
    if(typeof value!=='string'||!value.startsWith('/')||value==='/'||/[\u0000-\u001f\u007f]/.test(value)||value.split('/').some(part=>part==='..'))
      throw new TypeError('Choose an absolute '+label+' under its existing private parent.');
    return value;
  };
  if(!['installed','source'].includes(input.installation))throw new TypeError('Choose the installed command or source checkout.');
  if(!['bundled','received'].includes(input.purchaseSource))throw new TypeError('Choose the bundled purchase or a complete received packet.');
  const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
  const argv=input.installation==='installed'?['starforge','grant-demo','workbench']:['node','stellar/scf_2026/presentation/reviewer/cli.mjs','workbench'];
  let command=argv.join(' ')+' --dir '+quote(path(input.directory,'workbench directory'));
  if(input.purchaseSource==='received'){
    const packet=path(input.packetFile,'packet file');
    if(typeof input.packetSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.packetSha256))
      throw new TypeError('Use the exact 64-character lowercase SHA-256 from the exported packet.');
    command+=' --packet '+quote(packet)+' --sha256 '+input.packetSha256;
  }
  return command+' --port 0';
}
export function grantReviewerOpeningGuide({command,reviewerGuide,runtimeGuide}){
  return '# Open and receive the retained grant purchase\n\n'+
    'Run this command from the selected maintained runtime or source checkout, beneath an existing private parent directory:\n\n'+
    '~~~sh\n'+command+'\n~~~\n\n'+
    'Use Applications or this workbench’s saved workbench-connection.json to open its current private instance.\n\n'+
    '## Source and complete result\n\n'+
    '1. In Packet intake, choose Review bundled purchase, or select the complete receiving packet.\n'+
    '2. Open Source and query. Inspect the original query, terms and source documents.\n'+
    '3. Choose Receive this packet and Open original Buyer.\n'+
    '4. In Buyer results, select each quote and Read complete saved result. Retain both original outcomes and full result files.\n\n'+
    '## Handover and receiving\n\n'+
    '1. Choose Handover → Close Buyer and export packet.\n'+
    '2. Retain the full packet and its displayed SHA-256.\n'+
    '3. The receiving operator selects that file and digest in another private workbench, receives it and opens its original results.\n'+
    '4. Keep the original directory and action identities when reopening or continuing interrupted work.\n\n'+
    '## Maintained instructions\n\n'+
    '- Reviewer and customer delivery: '+reviewerGuide+'\n'+
    '- Runtime installation: '+runtimeGuide+'\n';
}
export function bindGrantReviewerEntry(document){
  const form=document.getElementById('grant-entry-command-form');
  if(!form)return null;
  const command=document.getElementById('grant-entry-command'),fields=document.getElementById('grant-entry-packet-fields'),
    status=document.getElementById('grant-entry-status'),copy=document.getElementById('grant-entry-copy'),
    download=document.getElementById('grant-entry-download');
  let selected=null,sequence=0;
  const input=()=>Object.fromEntries(new FormData(form).entries());
  function invalidate(){
    sequence++;selected=null;copy.disabled=true;download.disabled=true;
    fields.hidden=form.elements.purchaseSource.value!=='received';
    for(const name of ['packetFile','packetSha256']){form.elements[name].disabled=fields.hidden;form.elements[name].required=!fields.hidden;}
    status.textContent='Prepare the command after selecting the directory.';
  }
  function sourceLink(label){
    return [...document.querySelectorAll('#review-operate a')].find(node=>node.textContent===label)?.href;
  }
  form.addEventListener('input',invalidate);
  form.addEventListener('change',invalidate);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    try{
      const text=grantReviewerCommand(input());
      const reviewerGuide=sourceLink('Full reviewer operating guide'),runtimeGuide=sourceLink('Install or inspect the maintained runtime');
      if(!reviewerGuide||!runtimeGuide)throw new TypeError('Open the complete current grant page with its operating guides.');
      selected={command:text,reviewerGuide,runtimeGuide};sequence++;
      command.textContent=text;copy.disabled=false;download.disabled=false;
      status.textContent='Command prepared for the selected installation. Run it on that host, then open the original local workbench instance.';
    }catch(error){
      selected=null;copy.disabled=true;download.disabled=true;status.textContent=error.message;
    }
  });
  copy.addEventListener('click',async()=>{
    if(!selected)return;
    const current=sequence;
    try{
      if(!globalThis.navigator?.clipboard?.writeText)throw new Error('Clipboard access unavailable');
      await globalThis.navigator.clipboard.writeText(selected.command);
      if(current===sequence)status.textContent='Command copied.';
    }catch{
      if(current!==sequence)return;
      const range=document.createRange();range.selectNodeContents(command);
      const selection=globalThis.getSelection?.();selection?.removeAllRanges();selection?.addRange(range);
      status.textContent='The command is selected. Copy it with your keyboard or browser menu.';
    }
  });
  download.addEventListener('click',()=>{
    if(!selected)return;
    const blob=new Blob([grantReviewerOpeningGuide(selected)],{type:'text/markdown;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='grant-reviewer-opening.md';document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    status.textContent='Downloaded the opening guide with this command and the complete review and handover steps.';
  });
  invalidate();
  return {form,invalidate};
}
if(typeof document!=='undefined')bindGrantReviewerEntry(document);
