/** Complete original Community report handovers in the maintained operator. */
const rows=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const identity=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const button=(action,label,id='',workspace='',style='small')=>'<button type="button" class="'+esc(style)+'" data-action="community-handover-'+esc(action)+'"'+(id?' data-id="'+esc(id)+'"':'')+' data-workspace="'+esc(workspace)+'">'+esc(label)+'</button>';
const description=(label,value)=>'<dt>'+esc(label)+'</dt><dd>'+esc(value??'Unspecified')+'</dd>';

export function communityHandoverSummary(handover){
  return '<div class="community-form-source"><h3>'+esc(handover.title||'Original Community report')+'</h3>'+
    '<p>This handover retains the complete original report, its source files and saved scientific context.</p>'+
    '<dl>'+description('Report edition',handover.format_version??handover.report_format)+
    description('Original project',handover.original_project_id)+description('Original report',handover.report_id)+
    description('Original saved plan',handover.plan_id)+description('Original community table',handover.table_id)+
    description('Original report members',handover.member_count)+'</dl></div>';
}

export function attachCommunityReportHandover({getState,api,endpoint,openForm,submitAction,detail,fileList,getReport,beginOpening=()=>null,isOpeningCurrent=()=>true}){
  let generation=0;
  const current=()=>getState()||{};
  const workspace=()=>current().workspace_key||'';
  const project=()=>current().data?.project?.id||'';
  function invalidate(){generation++;}
  function reportButton(report){return button('export','Export source handover',report.id,workspace());}
  function receiveButton(){return button('receive','Receive source handover','',workspace());}
  function chosenWorkspace(expected){
    if(!expected||expected!==workspace()||!project())throw Error('Open this Community action in the intended workspace.');
    const opening=beginOpening();
    return {workspace:expected,project:project(),generation:++generation,opening};
  }
  const same=ticket=>workspace()===ticket.workspace&&project()===ticket.project&&generation===ticket.generation;
  function formLifetime(ticket,marker){
    let originalForm=null,originalDialog=null,originalMarker=null;
    return {
      capture(){
        originalForm=document.getElementById('operation-form');
        originalDialog=document.getElementById('form-dialog');
        originalMarker=originalForm?.querySelector(marker);
      },
      valid(){
        return same(ticket)&&originalForm&&originalDialog?.open&&originalMarker&&
          document.getElementById('operation-form')===originalForm&&
          document.getElementById('form-dialog')===originalDialog&&
          originalForm.querySelector(marker)===originalMarker;
      },
      form(){return originalForm;},
      marker(){return originalMarker;},
      require(){
        if(!this.valid())throw Error('Reopen the source handover in its original workspace.');
        return originalForm;
      }
    };
  }
  async function exportReport(id,expectedWorkspace){
    const ticket=chosenWorkspace(expectedWorkspace);
    let report;
    try{report=await getReport(id);}
    catch(error){if(same(ticket)&&isOpeningCurrent(ticket.opening))throw error;return;}
    if(!same(ticket)||!isOpeningCurrent(ticket.opening))return;
    const original=report.files?.['community-report.json'];
    if(report.id!==id||!identity(id)||!identity(original?.sha256)||!report.files?.['community-report.zip']||!report.files?.['REPORT.json'])
      throw Error('Choose a complete retained Community report.');
    const lifetime=formLifetime(ticket,'[data-community-handover-export]');
    document.getElementById('detail-dialog')?.close();
    openForm('Export Community source handover',
      'Keep the complete report and the information needed to receive it in another workspace together in one file.',
      '<div data-community-handover-export class="community-form-source"><h3>'+esc(report.title||'Community report')+'</h3>'+
      '<p>The handover includes this report’s original ZIP, saved report record, original project identity and source file inventory.</p>'+
      '<p>Receiving it creates a retained report source for the scientific report composer. Its original report edition and authored plans stay identified.</p>'+
      '<dl>'+description('Report edition',report.format_version)+description('Original project',ticket.project)+
      description('Original report',report.id)+'</dl></div>',
      'Export complete source handover',()=>{
        lifetime.require();
        return submitAction('community.report.handover.export',{report_id:report.id,report_sha256:original.sha256});
      },()=>lifetime.capture());
  }
  function receive(expectedWorkspace){
    const ticket=chosenWorkspace(expectedWorkspace);
    const deliveries=rows(current().data?.deliveries);
    const lifetime=formLifetime(ticket,'[name="community_handover_file"]');
    let preview=null,uploaded=null,uploadFile=null,reading=null,sequence=0;
    const input=()=>lifetime.marker();
    const selectedFile=()=>input()?.files?.[0];
    const status=()=>lifetime.form()?.querySelector('[data-community-handover-preview]');
    const validFile=(file,readSequence)=>lifetime.valid()&&selectedFile()===file&&sequence===readSequence;
    const deliveryId=()=>{
      const value=lifetime.require().elements.namedItem('community_handover_delivery').value;
      if(value&&!deliveries.some(item=>item.id===value))throw Error('Choose a retained delivery in this workspace.');
      return value;
    };
    function reset(){
      sequence++;preview=null;
      if(selectedFile()!==uploadFile){uploaded=null;uploadFile=null;}
      const target=status();
      if(target)target.textContent='Review the selected file to read its original report and source identities.';
    }
    async function review(){
      lifetime.require();
      const file=selectedFile();
      if(!file)throw Error('Choose the complete Community source handover ZIP.');
      if(reading?.file===file)return reading.promise;
      const readSequence=++sequence;
      preview=null;
      const target=status();
      target.textContent='Receiving the original file and reading its report…';
      const promise=(async()=>{
        try{
          let original=uploaded;
          if(uploadFile!==file||!original){
            original=await api('/api/upload',{method:'POST',raw:file,filename:file.name});
            if(!validFile(file,readSequence))return null;
            if(!identity(original?.id)||!identity(original?.sha256)||original.bytes!==file.size)
              throw Error('The received handover does not match the selected original file.');
            uploaded=original;uploadFile=file;
          }
          const result=await api(endpoint('/api/community-report-context/handover-preview',{upload_id:original.id}));
          if(!validFile(file,readSequence))return null;
          if(result.workspace_key!==ticket.workspace||result.upload?.id!==original.id||
             result.upload?.sha256!==original.sha256||result.upload?.bytes!==original.bytes||
             !identity(result.handover?.report_id)||!result.handover?.original_project_id)
            throw Error('The inspected handover belongs to a different original upload.');
          preview={file,upload:original,handover:result.handover};
          target.innerHTML=communityHandoverSummary(result.handover)+
            '<p class="note">Receive this original report source in '+esc(current().data?.project?.title||'the selected workspace')+
            '. After receiving, choose Open this report only to prepare its own scientific report, or Add to current report to keep the current draft and append this original source once.</p>';
          return preview;
        }catch(error){
          if(validFile(file,readSequence)){preview=null;target.textContent=error.message||String(error);}
          throw error;
        }finally{
          if(reading?.sequence===readSequence)reading=null;
        }
      })();
      reading={file,sequence:readSequence,promise};
      return promise;
    }
    document.getElementById('detail-dialog')?.close();
    openForm('Receive Community source handover',
      'Open a complete original report as a retained scientific source in the current workspace.',
      '<label class="full"><span>Community source handover</span><input type="file" name="community_handover_file" accept=".zip,application/zip" required></label>'+
      '<p class="note">Choose the file made by Export source handover. It includes the original report and its source metadata.</p>'+
      '<button type="button" data-community-handover-review>Review original report</button>'+
      '<div data-community-handover-preview role="status" aria-live="polite">Choose a handover file to inspect its original report.</div>'+
      '<label class="full"><span>Delivery selection</span><select name="community_handover_delivery"><option value="">Prepare a new report selection</option>'+
      deliveries.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.title||item.selection?.title||item.id)+'</option>').join('')+
      '</select><small>An existing selection keeps its original runs, maps and ordered report sources.</small></label>',
      'Receive original report source',async()=>{
        lifetime.require();
        const selected=selectedFile(),delivery=deliveryId();
        if(!selected)throw Error('Choose the complete Community source handover ZIP.');
        if(!preview||preview.file!==selected){
          await review();
          if(!lifetime.valid())return;
          throw Error('Review the original report shown above, then receive its source.');
        }
        const accepted=preview;
        lifetime.require();
        if(selectedFile()!==accepted.file||deliveryId()!==delivery)
          throw Error('Review the current handover file and delivery selection.');
        return submitAction('community.report.handover.receive',{
          upload_id:accepted.upload.id,archive_sha256:accepted.upload.sha256,
          ...(delivery?{delivery_id:delivery}:{})});
      },()=>{
        lifetime.capture();
        if(!lifetime.valid())return;
        input().addEventListener('change',reset);
        lifetime.form().querySelector('[data-community-handover-review]').addEventListener('click',()=>{
          review().catch(()=>{});
        });
      });
  }
  function taskActions(task){
    if(task?.workspace!==workspace()||task.action!=='community.report.handover.export'||task.state!=='complete')
      return '';
    return '<div class="page-actions">'+button('open-export','Open source handover',task.id,workspace(),'primary')+'</div>';
  }
  async function openExport(id,expectedWorkspace){
    const ticket=chosenWorkspace(expectedWorkspace);
    const task=await api(endpoint('/api/task',{id}));
    if(!same(ticket))return;
    if(task.id!==id||task.workspace!==ticket.workspace||task.action!=='community.report.handover.export'||
       task.state!=='complete'||!rows(task._downloads).length)
      throw Error('Open a completed source handover in its original workspace.');
    detail(task.result?.title||'Community source handover',
      '<p>The complete handover includes the original report ZIP, saved record and source metadata. Use Communities → Reports → Receive source handover in the receiving workspace.</p>'+
      fileList(task._downloads),{kind:'task',id});
  }
  function dispatch(node){
    const action=node.dataset.action;
    if(action==='community-handover-export')return exportReport(node.dataset.id,node.dataset.workspace);
    if(action==='community-handover-receive')return receive(node.dataset.workspace);
    if(action==='community-handover-open-export')return openExport(node.dataset.id,node.dataset.workspace);
    throw Error('Choose an available Community source handover action.');
  }
  return {reportButton,receiveButton,taskActions,dispatch,invalidate};
}
