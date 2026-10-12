import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const OPERATION='NETBOX-INVENTORY-RECEIVING-20261012-B9D2';
const entry=JSON.parse(fs.readFileSync(process.env.NETBOX_DESK_ENTRY,'utf8'));
const fixture=JSON.parse(fs.readFileSync(entry.fixture,'utf8'));
const original=JSON.parse(fs.readFileSync(entry.receipt,'utf8'));
const require=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'));
const {chromium}=require('playwright');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const requireValue=(ok,message)=>{if(!ok)throw new Error(message);};
const networkMode=entry.network!==undefined;
requireValue(!networkMode||(entry.network&&typeof entry.network==='object'
  &&typeof entry.network.fixture==='string'&&typeof entry.network.original_desk_result==='string'),
  'The network continuation needs its exact fixture and completed original desk result.');
requireValue(fixture.operation_id===OPERATION&&fixture.actual_netbox_version==='4.7.2','Select the original actual4.7.2 receiving fixture.');
const networkFixture=networkMode?JSON.parse(fs.readFileSync(entry.network.fixture,'utf8')):null;
const networkRoot=networkMode?path.dirname(path.resolve(entry.network.fixture)):null;
const originalDeskRaw=networkMode?fs.readFileSync(entry.network.original_desk_result):null;
const originalDesk=networkMode?JSON.parse(originalDeskRaw):null;
const networkBinding=networkMode?{
  phase:'network-commissioning-v1',fixture_sha256:sha(fs.readFileSync(entry.network.fixture)),
  original_desk_sha256:sha(originalDeskRaw),
  inventory_receipt_sha256:original.receipt_sha256,
  migration_source_sha256:networkFixture.binding.migration_source_sha256
}:null;
if(networkMode){
  requireValue(networkFixture.schema==='tjlabs.netbox.native-network-fixture/v1'
    &&networkFixture.operation_id===OPERATION&&networkFixture.binding.netbox_url===fixture.netbox_url
    &&networkFixture.binding.inventory_receipt_sha256===original.receipt_sha256
    &&networkFixture.binding.tenant_id===fixture.tenant_id
    &&originalDesk.operation_id===OPERATION&&originalDesk.state==='COMPLETE',
    'Join the same completed native inventory, tenant and customer desk before network receiving.');
  requireValue(path.resolve(entry.output)!==path.dirname(path.resolve(entry.network.original_desk_result)),
    'Use a separate network output directory to preserve the original v1 customer delivery.');
  for(const item of networkFixture.files){
    const file=path.resolve(networkRoot,item.path);
    requireValue(file.startsWith(networkRoot+path.sep),'An original network source escaped its retained directory.');
    const raw=fs.readFileSync(file);
    requireValue(raw.length===item.bytes&&sha(raw)===item.sha256,'The retained network source changed: '+item.path);
  }
}
fs.mkdirSync(entry.output,{recursive:true,mode:0o700});
const progressPath=path.join(entry.output,networkMode?'network-progress.json':'desk-progress.json');
const archiveSha=sha(fs.readFileSync(entry.archive));
const result=fs.existsSync(progressPath)?JSON.parse(fs.readFileSync(progressPath,'utf8')):{
  schema:networkMode?'tjlabs.netbox.network-native-receiving/v1':'tjlabs.netbox.desk-native-receiving/v1',
  operation_id:OPERATION,
  ...(networkMode?{network_binding:networkBinding}:{product_source:'351dd7d53629417215154a75e47562c17cf74f2f'}),
  input_archive_sha256:archiveSha,original_receipt_sha256:original.receipt_sha256,
  steps:[],screenshots:[],downloads:[],page_errors:[],attempts:[]
};
requireValue(result.operation_id===OPERATION&&result.input_archive_sha256===archiveSha
  &&result.original_receipt_sha256===original.receipt_sha256,'The original receiving input changed.');
if(networkMode)requireValue(JSON.stringify(result.network_binding)===JSON.stringify(networkBinding),
  'The same network continuation must retain its original source and completed v1 result.');
function atomic(file,value){
  const temp=file+'.partial-'+crypto.randomUUID(),raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function save(){atomic(progressPath,result);}
async function stage(name,fn){
  const retained=result.steps.find(item=>item.name===name);if(retained)return retained.value;
  result.current_stage=name;save();
  const value=await fn();result.steps.push({name,value,at:new Date().toISOString()});delete result.current_stage;save();
  console.log(JSON.stringify({operation_id:OPERATION,stage:name,state:'COMPLETE'}));return value;
}
result.attempts.push({at:new Date().toISOString(),driver_sha256:sha(fs.readFileSync(new URL(import.meta.url)))});
save();
const browser=await chromium.launch({headless:true,executablePath:entry.chromium||undefined,
  args:['--no-sandbox','--disable-dev-shm-usage']});
let context,page;
async function connect(width=1440){
  await context?.close();context=await browser.newContext({viewport:{width,height:width===390?844:1000},acceptDownloads:true});
  page=await context.newPage();page.on('pageerror',error=>{result.page_errors.push({at:new Date().toISOString(),message:error.message});save();});
  await page.goto(entry.url+'/#token='+entry.token);
  await page.getByRole('button',{name:'New project',exact:true}).waitFor({state:'attached'});
}
async function api(suffix,method='GET',body,raw=false){
  const response=await context.request.fetch(entry.url+suffix,{method,headers:{
    Authorization:'Bearer '+entry.token,'X-Workspace-Token':entry.token,Origin:entry.url},data:body});
  if(raw)return response;
  const value=await response.json();requireValue(response.ok()&&value.ok!==false,
    JSON.stringify({status:response.status(),code:value.code,error:value.error??value.message}));
  return value;
}
const projectPath=id=>'/api/projects/'+encodeURIComponent(id);
const editionPath=(id,edition)=>projectPath(id)+'/editions/'+encodeURIComponent(edition);
async function project(id){return(await api(projectPath(id))).project;}
async function detail(id,edition){return api(editionPath(id,edition));}
async function openProject(id,tab='Source files',edition){
  await page.setViewportSize({width:1440,height:1000});
  const current=await project(id);
  await page.locator('.project-button').filter({hasText:current.label}).click();
  await page.getByRole('button',{name:tab,exact:true}).click();
  if(edition)await page.getByLabel('Migration edition',{exact:true}).selectOption(edition);
  return current;
}
async function getOrCreate(label){
  let state=await api('/api/state');const matches=state.projects.filter(item=>item.label===label);
  requireValue(matches.length<=1,'The original named customer project is ambiguous.');
  if(matches.length)return matches[0];
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'New project',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Project name',{exact:true}).fill(label);
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();
  // The first project's heading may already be present in a fresh browser.
  // Join the actual saved project by its unique label after this create.
  for(let n=0;n<120;n++){
    state=await api('/api/state');const selected=state.projects.filter(item=>item.label===label);
    requireValue(selected.length<=1,'The original browser-created project is ambiguous.');
    if(selected.length===1)return selected[0];
    await page.waitForTimeout(250);
  }
  throw new Error('The original create remains available for same-label reconciliation.');
}
async function screenshot(name,width=1440){
  await page.setViewportSize({width,height:width===390?844:1000});
  const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  requireValue(geometry.document<=geometry.viewport+1&&geometry.body<=geometry.viewport+1,name+' has horizontal overflow.');
  const file=path.join(entry.output,name);await page.screenshot({path:file,fullPage:true});
  const raw=fs.readFileSync(file),value={name,bytes:raw.length,sha256:sha(raw),geometry};
  result.screenshots=result.screenshots.filter(x=>x.name!==name).concat(value);save();return value;
}
function receivedEdition(projectValue,operation){
  const matches=projectValue.editions.filter(item=>item.kind==='received'&&item.operation_id===operation);
  requireValue(matches.length<=1,'The original received operation has ambiguous customer editions.');
  return matches[0];
}
async function restoreArchive(id,file){
  await openProject(id);
  await page.getByRole('button',{name:'Restore handover archive',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Handover archive',{exact:true}).setInputFiles(file);
  await dialog.getByRole('button',{name:'Restore archive',exact:true}).click();
  await page.getByRole('heading',{name:'Migration delivery',exact:true}).waitFor();
  return project(id);
}
async function waitEdition(id,edition,wanted){
  const resumed=new Set();
  for(let n=0;n<240;n++){
    const value=await detail(id,edition);
    const current=value.actions?.find(item=>item.id===value.edition.active_action_id);
    if(current?.state==='FAILED')throw new Error('Original saved action failed: '+JSON.stringify(current.error));
    if(wanted.includes(value.edition.state)){
      if(current&&!['COMPLETE','FAILED'].includes(current.state))return(await waitAction(id,edition,current.id)).detail;
      return value;
    }
    if(current?.state==='RECOVERY_REQUIRED'&&!resumed.has(current.id)){
      await openProject(id,'Native review',edition);
      const join=page.getByRole('button',{name:'Join saved action',exact:true});
      await join.waitFor();await join.click();resumed.add(current.id);
    }
    if(value.edition.state==='AWAITING_NATIVE_RESULT'&&(!current||current.state==='COMPLETE')){
      // A completed local action can still be waiting on its original native
      // job. Observe that same job/journal through a fresh read-only recovery.
      const observed=await nativeRecovery(id,edition);
      if(wanted.includes(observed.detail.edition.state))return observed.detail;
    }
    if(value.edition.state==='CORRECTION_REQUIRED')throw new Error('The original native edition requires its saved correction: '+JSON.stringify(value.corrections));
    await page.waitForTimeout(1500);
  }
  throw new Error('Continue the retained native action from this edition; it has not finished.');
}
async function waitAction(id,edition,identity){
  const resumed=new Set();
  for(let n=0;n<240;n++){
    const value=await detail(id,edition),action=value.actions.find(item=>item.id===identity);
    requireValue(action,'The original saved action disappeared.');
    if(action.state==='COMPLETE')return {action,detail:value};
    if(action.state==='FAILED')throw new Error('Original '+action.kind+' action failed: '+JSON.stringify(action.error));
    if(action.state==='RECOVERY_REQUIRED'&&!resumed.has(identity)){
      await openProject(id,'Native review',edition);
      await page.getByRole('button',{name:'Join saved action',exact:true}).click();
      resumed.add(identity);
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('Continue the same retained '+identity+' action; it has not finished.');
}
async function nativeRecovery(id,edition){
  let value=await detail(id,edition),action=value.actions.filter(item=>item.kind==='recover').at(-1);
  if(action?.state==='COMPLETE'&&value.edition.state==='AWAITING_NATIVE_RESULT')action=null;
  if(!action){
    const priorIds=new Set(value.actions.map(item=>item.id));
    await openProject(id,'Native review',edition);
    await page.getByRole('button',{name:'Recover native result',exact:true}).click();
    for(let n=0;n<120;n++){
      value=await detail(id,edition);action=value.actions.filter(item=>item.kind==='recover'&&!priorIds.has(item.id)).at(-1);
      if(action)break;
      await page.waitForTimeout(250);
    }
  }
  requireValue(action,'The original recovery action has not reached its retained request; reopen the same browser intent.');
  return waitAction(id,edition,action.id);
}
async function localAction(id,edition,kind,button){
  let value=await detail(id,edition);
  const previous=value.actions.filter(item=>item.kind===kind).at(-1);
  if(previous?.state!=='COMPLETE'){
    await openProject(id,'Delivery',edition);
    if(previous&&['QUEUED','RUNNING','RECOVERY_REQUIRED'].includes(previous.state)){
      if(previous.state==='RECOVERY_REQUIRED')await page.getByRole('button',{name:'Join saved action',exact:true}).click();
    }else await page.getByRole('button',{name:button,exact:true}).click();
    for(let n=0;n<160;n++){
      value=await detail(id,edition);const action=value.actions.filter(item=>item.kind===kind).at(-1);
      if(action?.state==='COMPLETE')return action;
      if(action?.state==='FAILED')throw new Error('Original '+kind+' action failed: '+JSON.stringify(action.error));
      await page.waitForTimeout(500);
    }
    throw new Error('The original '+kind+' action remains available for continuation.');
  }
  return previous;
}
async function download(file,expectedName){
  await page.getByRole('button',{name:'Delivery',exact:true}).click();
  const awaiting=page.waitForEvent('download');await page.getByRole('button',{name:'Download '+file,exact:true}).click();
  const received=await awaiting;requireValue(received.suggestedFilename()===expectedName,'Original download filename differs: '+received.suggestedFilename());
  const target=path.join(entry.output,expectedName);await received.saveAs(target);
  const raw=fs.readFileSync(target),reference={selection:file,name:expectedName,path:target,bytes:raw.length,sha256:sha(raw)};
  result.downloads=result.downloads.filter(x=>x.selection!==file).concat(reference);save();return reference;
}

function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const fieldTitles={key:'Source key',match_id:'Existing NetBox ID',device_type:'Device type',
  u_height:'Height (U)',mgmt_only:'Management only',dns_name:'DNS name',vrf:'VRF',primary:'Primary address',
  vid:'VLAN ID',rd:'Route distinguisher',enforce_unique:'Enforce unique prefixes and addresses',
  scope_site:'Site scope',ipam_role:'IPAM role',untagged_vlan:'Untagged VLAN',tagged_vlans:'Tagged VLANs',
  import_targets:'Import route targets',export_targets:'Export route targets',
  a_interface:'A interface',b_interface:'B interface',is_pool:'Address pool',
  mark_utilized:'Mark utilized',length_unit:'Length unit'};
const fieldTitle=name=>fieldTitles[name]??name.split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');
async function idle(){await page.waitForFunction(()=>!document.body.classList.contains('busy'));}
async function saveMapping(){
  const button=page.getByRole('button',{name:'Save mapping',exact:true});
  if(await button.isEnabled())await button.click();
  await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Saved'
    &&!document.body.classList.contains('busy'));
}
async function chooseNative(buttonName,query,identity){
  await page.getByRole('button',{name:buttonName,exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Catalogue search',{exact:true}).fill(query);
  await dialog.getByRole('button',{name:'Search',exact:true}).click();
  const choice=dialog.locator('.catalogue-choice').filter({
    has:page.locator('code').filter({hasText:new RegExp('^#'+identity+'$')})});
  await choice.click();await dialog.waitFor({state:'hidden'});
}
async function mappingOptions(name,rule,{replaceValues=false}={}){
  const label=fieldTitle(name);
  await page.getByLabel(label+' conversion options',{exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Blank value behavior',{exact:true}).selectOption(rule.blank??'omit');
  await dialog.getByLabel('Trim surrounding spaces',{exact:true}).setChecked(rule.trim!==false);
  await dialog.getByLabel('Convert text to lowercase',{exact:true}).setChecked(rule.lower===true);
  if(rule.separator!==undefined)await dialog.getByLabel('Membership separator',{exact:true}).fill(rule.separator);
  if(replaceValues||rule.values){
    while(await dialog.getByRole('button',{name:/^Remove value rule /}).count())
      await dialog.getByRole('button',{name:/^Remove value rule /}).last().click();
    let index=0;
    for(const [key,value]of Object.entries(rule.values??{})){
      index++;
      await dialog.getByRole('button',{name:'Add value rule',exact:true}).click();
      await dialog.getByLabel('Source value '+index,{exact:true}).fill(key);
      const type=value===null?'null':Array.isArray(value)?'array':typeof value;
      await dialog.getByLabel('Replacement type '+index,{exact:true}).selectOption(type);
      if(type!=='null'){
        const target=dialog.getByLabel('Replacement value '+index,{exact:true});
        if(type==='boolean')await target.selectOption(String(value));
        else await target.fill(type==='array'?JSON.stringify(value):String(value));
      }
    }
  }
  await dialog.getByRole('button',{name:'Apply options',exact:true}).click();
}
async function configureSource(definition){
  const rules=[['key',definition.key],['match_id',definition.match_id],
    ...Object.entries(definition.fields??{}),...Object.entries(definition.links??{}),
    ...Object.entries(definition.many??{}),...Object.entries(definition.catalog??{}),
    ['primary',definition.primary]];
  for(const [name,rule]of rules){
    if(!rule)continue;
    const label=fieldTitle(name),mode=Object.hasOwn(rule,'column')?'column':'value';
    const selector=page.getByLabel(label+' source mode',{exact:true});
    if(await selector.inputValue()!==mode)await selector.selectOption(mode);
    if(mode==='column')await page.getByLabel(label+' CSV column',{exact:true}).selectOption(rule.column);
    else{
      const control=page.getByLabel(label+' fixed value',{exact:true});
      if(typeof rule.value==='boolean')await control.selectOption(String(rule.value));
      else await control.fill(rule.value===null?'':Array.isArray(rule.value)?rule.value.join(rule.separator??';'):String(rule.value));
    }
    if(rule.by)await page.getByLabel(label+' reference type',{exact:true}).selectOption(rule.by);
    if(rule.blank!==undefined||rule.lower!==undefined||rule.trim!==undefined||rule.values)
      await mappingOptions(name,rule);
  }
}
function networkRow(view,kind,key){
  const row=view.network?.objects?.[kind]?.find(item=>item.key===key);
  requireValue(row,'The native network result is missing '+kind+'/'+key);return row;
}
function hasReference(value,kind,key){
  return value&&typeof value==='object'&&value.kind===kind&&value.key===key;
}
function referenceKeys(values,kind){
  requireValue(Array.isArray(values),'The native membership must retain its complete array.');
  requireValue(values.every(value=>value?.kind===kind&&typeof value.key==='string'),'A native membership lost its original source identity.');
  return values.map(value=>value.key).sort();
}
function assertNetwork(view,{corrected=false,applied=false}={}){
  const report=view.network;
  requireValue(report?.schema==='tjlabs.netbox.network-commissioning/v1'
    &&report.operation_id===view.result.operation_id&&report.netbox_version==='4.7.2',
    'Use the network projection from the exact original native result.');
  for(const kind of ['route_targets','vrfs','vlans','prefixes','interfaces','ip_addresses','cables'])
    requireValue(report.objects[kind].length===networkFixture.counts[kind],'Native '+kind+' rows differ from the complete source.');
  const expectedCreate=corrected?0:networkFixture.expected_creates;
  requireValue(view.result.counts.CREATE===expectedCreate,'The native source created an unexpected number of objects.');
  const prod=networkRow(view,'vrfs','vrf-prod').after,guest=networkRow(view,'vrfs','vrf-guest').after;
  requireValue(stable(referenceKeys(prod.import_targets,'route_targets'))
    ===stable(corrected?['rt-prod']:['rt-guest','rt-prod']),'Production route-target imports differ.');
  requireValue(stable(referenceKeys(guest.export_targets,'route_targets'))===stable(corrected?[]:['rt-guest']),
    'The guest export membership clear was not retained.');
  const uplink=networkRow(view,'interfaces','switch-uplink');
  requireValue(uplink.after.mode===(corrected?'access':'tagged'),'The original interface mode differs.');
  requireValue(stable(referenceKeys(uplink.after.tagged_vlans,'vlans'))
    ===stable(corrected?[]:['vlan-guest','vlan-prod']),'The original native tagged VLAN membership differs.');
  if(corrected)requireValue(uplink.before.mode==='tagged'&&uplink.before.tagged_vlans.length===2,
    'The corrected report lost the actual pre-change interface memberships.');
  const groups=new Map(report.prefix_groups.map(group=>[group.id,group]));
  const memberships={};
  for(const [key,wanted,vrf]of [['switch-v4','192.0.2.0/28','vrf-prod'],
    ['uplink-v4','192.0.2.0/24','vrf-prod'],['guest-v4','192.0.2.0/24','vrf-guest'],
    ['switch-v6','2001:db8::/64','vrf-prod']]){
    const row=networkRow(view,'ip_addresses',key),group=groups.get(row.selected_prefix_group);
    requireValue(group?.prefix===wanted&&hasReference(group.vrf,'vrfs',vrf),
      'The most specific selected prefix/VRF differs for '+key);
    memberships[key]=group.id;
  }
  requireValue(memberships['guest-v4']!==memberships['uplink-v4'],
    'Overlapping IPv4 ranges in separate VRFs were collapsed.');
  for(const key of ['prefix-prod-parent','prefix-prod-leaf','prefix-prod-v6','prefix-guest'])
    requireValue(hasReference(networkRow(view,'prefixes',key).after.scope_site,'sites','site-b'),
      'The native prefix lost its explicitly selected Site scope.');
  const cable=networkRow(view,'cables','uplink-cable').after;
  const peer=networkFixture.peers[corrected?'b':'a'];
  requireValue(Array.isArray(cable.a_interface)&&cable.a_interface.length===1
    &&hasReference(cable.a_interface[0],'interfaces','switch-uplink')
    &&Array.isArray(cable.b_interface)&&cable.b_interface.length===1
    &&cable.b_interface[0].model==='dcim.interface'&&cable.b_interface[0].id===peer.id,
    'The native Cable terminations differ from the reviewed source-key/native-ID selection.');
  requireValue(report.objects.native_effects.some(row=>row.kind==='cable_paths')
    &&report.objects.native_effects.some(row=>row.kind==='cable_terminations'),
    'The original Cable path/termination effects are absent.');
  if(corrected){
    const channel=report.objects.native_effects.filter(row=>row.kind==='interface_channels'
      &&row.key===String(networkFixture.channel.child_id));
    requireValue(channel.length===1&&channel[0].action==='UPDATE'
      &&channel[0].before?.name===networkFixture.channel.original_child_name
      &&channel[0].after?.name===networkFixture.channel.target_child_name,
      'The network delivery lost the original deferred channel rename.');
    for(const side of ['a','b']){
      const effect=view.result.changes.find(row=>row.kind==='cable_endpoints'
        &&row.endpoint?.model==='dcim.interface'&&row.endpoint.id===networkFixture.peers[side].id);
      requireValue(effect, 'The corrected cable omitted the existing native peer '+side);
      requireValue(side==='a'?effect.after.cable===null:hasReference(effect.after.cable,'cables','uplink-cable'),
        'The original old/new peer cable cache was not preserved.');
    }
  }
  if(applied)requireValue(view.result.state==='APPLIED'&&view.result.resolved.length===Object.values(networkFixture.counts).reduce((sum,value)=>sum+value,0)&&view.result.journal?.id,
    'The network result must retain all committed original IDs and its native tenant journal.');
  return {counts:report.counts,prefix_memberships:memberships,
    original_native_effects:report.objects.native_effects.length};
}
async function networkScreens(view,stem){
  for(const kind of ['vrfs','prefixes','interfaces','cables','native_effects']){
    await page.getByLabel('Network object family',{exact:true}).selectOption(kind);
    await page.locator('#network-results table').waitFor();
    if(kind==='prefixes'||kind==='cables')await screenshot(stem+'-'+kind+'.png');
  }
  await page.getByLabel('Network object family',{exact:true}).selectOption('ip_addresses');
  await page.getByLabel('Search network commissioning',{exact:true}).fill('switch-v4');
  await page.locator('#network-results tbody tr').filter({hasText:'switch-v4'}).waitFor();
  requireValue(await page.locator('#network-results tbody tr').count()===1,'The actual network filter did not select its source address.');
  await page.getByLabel('Search network commissioning',{exact:true}).fill('');
  await screenshot(stem+'-mobile.png',390);
  await page.setViewportSize({width:1440,height:1000});
}
async function prepareNetwork(id,revision,expectedObjects){
  const intentFile=path.join(entry.output,'network-prepare-'+revision+'-intent.json');
  const objectsSha=sha(Buffer.from(stable(expectedObjects)));
  const saved=fs.existsSync(intentFile)?JSON.parse(fs.readFileSync(intentFile,'utf8')):null;
  if(saved)requireValue(saved.project_id===id&&saved.project_revision===revision
    &&saved.objects_sha256===objectsSha&&saved.body?.expected_revision===revision
    &&typeof saved.body.request_id==='string'
    &&/^[a-f0-9]{64}$/.test(saved.body.preview_sha256),
    'The saved preparation request belongs to another exact network mapping.');
  let value=await openProject(id,'Mapping');await idle();
  // A carrier can end after the immutable edition header is published but
  // before the original native preparation and command receipt are complete.
  // Join the exact saved browser request even when that header is listed.
  if(saved){
    await api(projectPath(id)+'/prepare','POST',saved.body);
    value=await project(id);
  }
  let editions=value.editions.filter(item=>item.kind==='prepared'&&item.project_revision===revision);
  requireValue(editions.length<=1,'The reviewed saved mapping has ambiguous prepared editions.');
  if(!editions.length){
    let captured=false;
    await page.route('**/api/projects/*/prepare',async route=>{
      const request=route.request();
      if(request.method()!=='POST'||new URL(request.url()).pathname!==projectPath(id)+'/prepare')
        return route.continue();
      const body=request.postDataJSON();
      requireValue(!captured&&body.expected_revision===revision
        &&typeof body.request_id==='string'&&/^[a-f0-9]{64}$/.test(body.preview_sha256),
        'The browser preparation changed the selected saved mapping or request.');
      captured=true;
      const intent={project_id:id,project_revision:revision,objects_sha256:objectsSha,body};
      if(fs.existsSync(intentFile))requireValue(stable(JSON.parse(fs.readFileSync(intentFile,'utf8')))===stable(intent),
        'The original network preparation request changed before dispatch.');
      else atomic(intentFile,intent);
      await route.continue();
    });
    try{
      await page.getByRole('button',{name:'Check source mapping',exact:true}).click();
      const prepare=page.getByRole('button',{name:'Prepare native edition',exact:true});
      await prepare.waitFor();await prepare.click();
      await page.getByRole('heading',{name:'Native inventory changes',exact:true}).waitFor();
    }finally{await page.unroute('**/api/projects/*/prepare');}
    value=await project(id);editions=value.editions.filter(item=>item.kind==='prepared'&&item.project_revision===revision);
  }
  requireValue(editions.length===1,'The exact saved network mapping has no prepared native edition.');
  const edition=editions[0],request=await api(editionPath(id,edition.id)+'/download/request.json');
  requireValue(stable(request.objects)===stable(expectedObjects),
    'The original customer mapping compiled different network source objects.');
  return {edition_id:edition.id,operation_id:edition.operation_id,project_revision:revision,
    objects:request.objects.length,request_sha256:sha(Buffer.from(stable(request)))};
}
async function reviewNetwork(id,prepared,corrected){
  let value=await detail(id,prepared.edition_id);
  await openProject(id,'Native review',prepared.edition_id);await idle();
  if(value.edition.state==='PREPARED'&&!value.edition.active_action_id)
    await page.getByRole('button',{name:'Review against NetBox',exact:true}).click();
  value=await waitEdition(id,prepared.edition_id,['REVIEWED','APPLIED']);
  const summary=assertNetwork(value,{corrected});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await idle();
  await networkScreens(value,corrected?'network-corrected-review':'network-initial-review');
  return {...summary,review_digest:value.result.review_digest,counts:value.result.counts};
}
async function applyNetwork(id,prepared,review,{corrected=false,loseReply=false,stageKey}){
  const intentFile=path.join(entry.output,stageKey+'-apply-intent.json');
  const discardedFile=path.join(entry.output,stageKey+'-discarded-response.json');
  let value=await detail(id,prepared.edition_id);
  let existing=value.actions.find(item=>item.kind==='apply');
  const retained=fs.existsSync(intentFile)?JSON.parse(fs.readFileSync(intentFile,'utf8')):null;
  if(retained)requireValue(retained.project_id===id&&retained.edition_id===prepared.edition_id
    &&retained.body.action==='apply'&&retained.body.review_digest===review.review_digest,
    'The retained apply intent belongs to another exact network review.');
  if(!existing&&value.edition.state==='REVIEWED'&&retained){
    // The receiving carrier may have ended after retaining the original browser
    // request but before observing the server. Repeat that exact native request.
    await api(editionPath(id,prepared.edition_id)+'/actions','POST',retained.body);
    value=await detail(id,prepared.edition_id);existing=value.actions.find(item=>item.kind==='apply');
  }
  let intercepted=false;
  if(!existing&&value.edition.state==='REVIEWED'){
    await openProject(id,'Native review',prepared.edition_id);await idle();
    await page.route('**/api/projects/*/editions/*/actions',async route=>{
      const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
      if(body?.action!=='apply'||intercepted)return route.continue();
      intercepted=true;
      const intent={project_id:id,edition_id:prepared.edition_id,body};
      if(fs.existsSync(intentFile))requireValue(stable(JSON.parse(fs.readFileSync(intentFile,'utf8')))===stable(intent),
        'The original network browser apply request changed.');
      else atomic(intentFile,intent);
      const response=await route.fetch(),raw=await response.body();
      requireValue(response.ok(),'The original network apply action was rejected before receiving.');
      if(loseReply){
        const returned=JSON.parse(raw.toString('utf8'));
        atomic(discardedFile,{request_id:body.request_id,action_id:returned.action.id,
          response_status:response.status(),response_sha256:sha(raw),at:new Date().toISOString()});
        await route.abort('failed');
      }else await route.fulfill({response,body:raw});
    });
    await page.getByRole('button',{name:'Apply reviewed changes',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Apply reviewed changes',exact:true}).click();
  }
  try{value=await waitEdition(id,prepared.edition_id,['APPLIED']);}
  finally{await page.unroute('**/api/projects/*/editions/*/actions');}
  requireValue(value.result.review_digest===review.review_digest,'The actual network receipt changed its selected review digest.');
  let actions=value.actions.filter(item=>item.kind==='apply');
  requireValue(actions.length===1,'The network continuation allocated a second Apply action.');
  if(retained)requireValue(actions[0].request_id===undefined||actions[0].request_id===retained.body.request_id,
    'The native saved action differs from the retained browser request.');
  await waitAction(id,prepared.edition_id,actions[0].id);
  await page.reload();
  value=(await nativeRecovery(id,prepared.edition_id)).detail;
  assertNetwork(value,{corrected,applied:true});
  actions=value.actions.filter(item=>item.kind==='apply');
  requireValue(actions.length===1,'Native journal recovery created another network Apply.');
  const receiptFile=path.join(entry.output,stageKey+'-native-result.json');atomic(receiptFile,value.result);
  return {operation_id:prepared.operation_id,edition_id:prepared.edition_id,
    review_digest:value.result.review_digest,receipt_sha256:value.result.receipt_sha256,
    resolved:value.result.resolved,journal:value.result.journal,apply_action_id:actions[0].id,
    retained_result:{path:receiptFile,sha256:sha(fs.readFileSync(receiptFile))},
    transport:fs.existsSync(discardedFile)?JSON.parse(fs.readFileSync(discardedFile,'utf8')):
      {outcome:'ORIGINAL_APPLY_REOPENED'}};
}
async function currentNative(kind,identity,query,filters={}){
  const params=new URLSearchParams({kind,q:query,...Object.fromEntries(Object.entries(filters).map(([k,v])=>[k,String(v)]))});
  const response=await api('/api/catalogue?'+params.toString());
  const found=response.items.filter(item=>item.id===identity);
  requireValue(found.length===1,'The fresh native '+kind+' read did not return its committed identity.');
  return {record:found[0].record,observed_at:response.observed_at,sha256:response.sha256};
}

async function correctedNetworkDraft(id,prepared,applied,expected){
  const intentFile=path.join(entry.output,'network-corrected-draft-intent.json');
  const ids=new Map(applied.resolved.map(row=>[row.kind+'/'+row.key,row.id]));
  function bound(value){
    return value.mapping.sources.length===10&&expected.objects.every(row=>{
      const definition=value.mapping.sources.find(item=>item.kind===row.kind);
      return definition?.match_id?.column==='source_key'
        &&definition.match_id.values?.[row.key]===ids.get(row.kind+'/'+row.key);
    });
  }
  let value=await project(id);
  if(bound(value))return value;
  const saved=fs.existsSync(intentFile)?JSON.parse(fs.readFileSync(intentFile,'utf8')):null;
  if(saved){
    requireValue(saved.project_id===id&&saved.edition_id===prepared.edition_id,
      'The retained corrected-draft request belongs to another network edition.');
    await api(editionPath(id,prepared.edition_id)+'/draft','POST',saved.body);
  }else{
    let captured=false;
    await page.route('**/api/projects/*/editions/*/draft',async route=>{
      if(route.request().method()!=='POST'||captured)return route.continue();
      captured=true;
      atomic(intentFile,{project_id:id,edition_id:prepared.edition_id,body:route.request().postDataJSON()});
      await route.continue();
    });
    try{
      await page.getByRole('button',{name:'Start a corrected draft',exact:true}).click();
      for(let n=0;n<120;n++){
        value=await project(id);if(bound(value))break;await page.waitForTimeout(250);
      }
      await idle();
    }finally{await page.unroute('**/api/projects/*/editions/*/draft');}
  }
  value=await project(id);
  requireValue(bound(value),'The exact original corrected draft has not retained all committed native IDs.');
  await openProject(id,'Mapping');await idle();return value;
}

async function receiveNetwork(){
  const expected=JSON.parse(fs.readFileSync(path.join(networkRoot,networkFixture.expected_source),'utf8'));
  const selected=await stage('N01-original-network-customer',async()=>{
    const state=await api('/api/state');
    requireValue(state.schema.many?.vrfs?.import_targets==='route_targets'
      &&state.schema.many?.interfaces?.tagged_vlans==='vlans','Select the complete original network customer desk.');
    return getOrCreate('Network commissioning · b9d2');
  });
  const id=selected.id;
  const mapped=await stage('N02-complete-network-source-and-mapping',async()=>{
    await openProject(id);await idle();
    const definitions=networkFixture.mapping.sources;
    let value=await project(id);
    const files=definitions.map(item=>path.join(networkRoot,'ipam-input',item.file));
    const missing=files.filter(file=>!value.uploads.some(item=>item.name===path.basename(file)&&item.sha256===sha(fs.readFileSync(file))));
    if(missing.length){
      await page.getByLabel('Source CSV files',{exact:true}).setInputFiles(missing);
      for(let n=0;n<160;n++){
        value=await project(id);
        if(files.every(file=>value.uploads.some(item=>item.name===path.basename(file)&&item.sha256===sha(fs.readFileSync(file)))))break;
        await page.waitForTimeout(250);
      }
      await idle();
    }
    value=await project(id);
    requireValue(value.uploads.length===10&&files.every(file=>value.uploads.some(item=>
      item.name===path.basename(file)&&item.sha256===sha(fs.readFileSync(file)))),
      'The customer project must retain all ten exact original network CSVs.');
    if(value.tenant_id!==networkFixture.tenant_id){
      await chooseNative('Choose',networkFixture.tenant_name,networkFixture.tenant_id);await saveMapping();
    }
    for(const definition of definitions){
      value=await project(id);
      const upload=value.uploads.find(item=>item.name===definition.file);
      let matching=value.mapping.sources.filter(item=>item.kind===definition.kind&&item.file===upload.file);
      requireValue(matching.length<=1,'The selected network source mapping is ambiguous.');
      if(!matching.length){
        await page.getByRole('button',{name:'Source files',exact:true}).click();await idle();
        await page.locator('tbody tr').filter({hasText:definition.file}).getByRole('button',{name:'Map',exact:true}).click();
        await page.getByRole('dialog').getByLabel('Native object kind',{exact:true}).selectOption(definition.kind);
        await page.getByRole('dialog').getByRole('button',{name:'Add mapping',exact:true}).click();
      }else{
        await page.getByRole('button',{name:'Mapping',exact:true}).click();
        await page.locator('.source-button').filter({hasText:definition.file}).click();
      }
      await configureSource(definition);await saveMapping();
    }
    value=await project(id);requireValue(value.mapping.sources.length===10,'The complete network source lost a family.');
    await screenshot('network-source-mapping.png');await screenshot('network-source-mapping-mobile.png',390);
    return {project_id:id,revision:value.revision,uploads:value.uploads.map(({name,bytes,row_count,sha256})=>({name,bytes,row_count,sha256}))};
  });
  const prepared=await stage('N03-original-network-edition',async()=>prepareNetwork(id,mapped.revision,expected.objects));
  const reviewed=await stage('N04-original-network-native-review',async()=>reviewNetwork(id,prepared,false));
  const applied=await stage('N05-original-network-apply-and-lost-reply',async()=>
    applyNetwork(id,prepared,reviewed,{stageKey:'network-001',loseReply:true}));
  const corrected=await stage('N06-corrected-network-source',async()=>{
    let value=await openProject(id,'Delivery',prepared.edition_id);await idle();
    const firstApplied=await detail(id,prepared.edition_id);
    requireValue(firstApplied.result.receipt_sha256===applied.receipt_sha256,'The original committed network edition changed.');
    value=await correctedNetworkDraft(id,prepared,applied,expected);
    requireValue(value.mapping.sources.length===10,'The corrected draft lost original network source mappings.');
    await page.getByRole('button',{name:'Mapping',exact:true}).click();
    await page.locator('.source-button').filter({hasText:'network-vrfs.csv'}).click();
    await mappingOptions('import_targets',{blank:'null',separator:';',
      values:{'rt-prod;rt-guest':['rt-prod']}},{replaceValues:true});
    await mappingOptions('export_targets',{blank:'null',separator:';',
      values:{'rt-guest':[]}},{replaceValues:true});
    await page.locator('.source-button').filter({hasText:'network-interfaces.csv'}).click();
    await mappingOptions('name',{values:{
      [networkFixture.channel.original_parent_name]:networkFixture.channel.target_parent_name
    }},{replaceValues:true});
    await page.getByLabel('Mode source mode',{exact:true}).selectOption('value');
    await page.getByLabel('Mode fixed value',{exact:true}).fill('access');
    await page.getByLabel('Tagged VLANs source mode',{exact:true}).selectOption('none');
    await page.locator('.source-button').filter({hasText:'network-cables.csv'}).click();
    await page.getByLabel('B interface source mode',{exact:true}).selectOption('value');
    await page.getByLabel('B interface reference type',{exact:true}).selectOption('id');
    await chooseNative('Choose B interface from NetBox',networkFixture.peers.b.name,networkFixture.peers.b.id);
    await saveMapping();value=await project(id);
    const packet=JSON.parse(JSON.stringify(expected.objects));
    const ids=new Map(applied.resolved.map(row=>[row.kind+'/'+row.key,row.id]));
    for(const row of packet){
      row.match_id=ids.get(row.kind+'/'+row.key);requireValue(Number.isSafeInteger(row.match_id),'A corrected source has no committed native ID.');
      if(row.kind==='vrfs'&&row.key==='vrf-prod')row.many.import_targets=[{key:'rt-prod'}];
      if(row.kind==='vrfs'&&row.key==='vrf-guest')row.many.export_targets=[];
      if(row.kind==='interfaces'){row.fields.mode='access';delete row.many;
        if(row.key==='switch-channel')row.fields.name=networkFixture.channel.target_parent_name;}
      if(row.kind==='cables')row.links.b_interface={id:networkFixture.peers.b.id};
    }
    await screenshot('network-corrected-native-endpoint.png');
    return {revision:value.revision,expected_objects:packet,original_receipt_sha256:applied.receipt_sha256};
  });
  const revised=await stage('N07-corrected-network-edition',async()=>
    prepareNetwork(id,corrected.revision,corrected.expected_objects));
  const rereview=await stage('N08-corrected-network-native-review',async()=>reviewNetwork(id,revised,true));
  const final=await stage('N09-corrected-network-apply',async()=>{
    const value=await applyNetwork(id,revised,rereview,{stageKey:'network-002',corrected:true});
    const identity=rows=>rows.map(row=>[row.kind,row.key,row.id].join(':')).sort();
    requireValue(stable(identity(applied.resolved))===stable(identity(value.resolved)),
      'The corrected network edition replaced a committed native object.');
    return value;
  });
  await stage('N10-fresh-native-membership-and-endpoint-readback',async()=>{
    const ids=new Map(final.resolved.map(row=>[row.kind+'/'+row.key,row.id]));
    const peerA=await currentNative('interfaces',networkFixture.peers.a.id,networkFixture.peers.a.name,
      {device_id:networkFixture.peers.a.device_id});
    const peerB=await currentNative('interfaces',networkFixture.peers.b.id,networkFixture.peers.b.name,
      {device_id:networkFixture.peers.b.device_id});
    requireValue(peerA.record.cable===null&&peerB.record.cable?.id===ids.get('cables/uplink-cable'),
      'Fresh native endpoint caches differ from the original corrected cable.');
    const uplink=await currentNative('interfaces',ids.get('interfaces/switch-uplink'),'b9d2-nbx-20261012-uplink');
    requireValue((uplink.record.mode?.value??uplink.record.mode)==='access'
      &&Array.isArray(uplink.record.tagged_vlans)&&uplink.record.tagged_vlans.length===0,
      'The actual native mode did not clear the omitted tagged VLAN membership.');
    const prod=await currentNative('vrfs',ids.get('vrfs/vrf-prod'),'b9d2-nbx-20261012-production',{tenant_id:fixture.tenant_id});
    const guest=await currentNative('vrfs',ids.get('vrfs/vrf-guest'),'b9d2-nbx-20261012-guest',{tenant_id:fixture.tenant_id});
    requireValue(stable(prod.record.import_targets.map(item=>item.id).sort((a,b)=>a-b))
      ===stable([ids.get('route_targets/rt-prod')])&&guest.record.export_targets.length===0,
      'The fresh native VRF memberships differ from the reviewed correction.');
    const channelParent=await currentNative('interfaces',networkFixture.channel.parent_id,
      networkFixture.channel.target_parent_name,{device_id:networkFixture.channel.device_id});
    const channelChild=await currentNative('interfaces',networkFixture.channel.child_id,
      networkFixture.channel.target_child_name,{device_id:networkFixture.channel.device_id});
    requireValue(channelParent.record.name===networkFixture.channel.target_parent_name
      &&channelChild.record.name===networkFixture.channel.target_child_name
      &&channelChild.record.parent?.id===networkFixture.channel.parent_id
      &&channelChild.record.channel_id===1,
      'The original post-commit channel child rename differs from its reviewed parent continuation.');
    const nativeResult=JSON.parse(fs.readFileSync(final.retained_result.path,'utf8'));
    const childChanges=nativeResult.changes.filter(row=>row.kind==='interface_channels'
      &&row.key===String(networkFixture.channel.child_id));
    requireValue(childChanges.length===1&&childChanges[0].action==='UPDATE'
      &&childChanges[0].interface?.model==='dcim.interface'
      &&childChanges[0].interface.id===networkFixture.channel.child_id
      &&childChanges[0].parent_id===networkFixture.channel.parent_id
      &&childChanges[0].before?.name===networkFixture.channel.original_child_name
      &&childChanges[0].after?.name===networkFixture.channel.target_child_name,
      'The actual renamed channel child differs from its retained original native review.');
    return {peerA,peerB,uplink,production:prod,guest,channelParent,channelChild,
      retained_channel_changes:childChanges};
  });
  const delivery=await stage('N11-complete-network-handover',async()=>{
    await localAction(id,revised.edition_id,'report','Create report');
    await localAction(id,revised.edition_id,'handover','Build handover');
    await openProject(id,'Delivery',revised.edition_id);await idle();
    const files=[];
    for(const [choice,name]of [['handover.zip','inventory-handover.zip'],
      ['report.html','inventory-review.html'],['network.html','network-commissioning.html'],
      ['network.csv','network-commissioning.csv'],['network.json','network-commissioning.json'],
      ['result.json','native-inventory-result.json'],['resolved.csv','resolved-objects.csv'],
      ['request.json','request.json'],['mapping.json','mapping.json']])files.push(await download(choice,name));
    const receipt=JSON.parse(fs.readFileSync(path.join(entry.output,'native-inventory-result.json'),'utf8'));
    const report=JSON.parse(fs.readFileSync(path.join(entry.output,'network-commissioning.json'),'utf8'));
    requireValue(receipt.receipt_sha256===final.receipt_sha256&&report.receipt_sha256===final.receipt_sha256,
      'The delivered network files belong to another native receipt.');
    assertNetwork({result:receipt,network:report},{corrected:true,applied:true});
    requireValue(fs.readFileSync(path.join(entry.output,'network-commissioning.csv'),'utf8').includes('before_json')
      &&fs.readFileSync(path.join(entry.output,'network-commissioning.html'),'utf8').includes(final.operation_id),
      'The full customer network report/CSV lost its native before/after or operation.');
    await screenshot('network-complete-delivery.png');await screenshot('network-complete-delivery-mobile.png',390);
    return {files,receipt_sha256:final.receipt_sha256,network_report:report};
  });
  await stage('N12-fresh-network-customer-receiving',async()=>{
    await connect();
    const second=await getOrCreate('Received network handover · b9d2');
    const archive=delivery.files.find(item=>item.selection==='handover.zip');
    requireValue(sha(fs.readFileSync(archive.path))===archive.sha256,'The complete selected network archive changed.');
    let value=await project(second.id),edition=receivedEdition(value,revised.operation_id);
    if(!edition){value=await restoreArchive(second.id,archive.path);edition=receivedEdition(value,revised.operation_id);}
    requireValue(edition,'The fresh customer project did not receive the original network edition.');
    const reopened=(await nativeRecovery(second.id,edition.id)).detail;
    requireValue(reopened.result.receipt_sha256===final.receipt_sha256
      &&reopened.actions.every(action=>action.kind!=='apply'),'Fresh customer receiving changed the original native transaction.');
    assertNetwork(reopened,{corrected:true,applied:true});
    requireValue(stable(reopened.network)===stable(delivery.network_report),
      'The original full network projection changed on cold receiving.');
    await openProject(second.id,'Native review',edition.id);await idle();
    await networkScreens(reopened,'network-customer-reopened');
    return {project_id:second.id,edition_id:edition.id,operation_id:edition.operation_id,
      receipt_sha256:reopened.result.receipt_sha256,journal:reopened.result.journal,
      actions:reopened.actions.map(({id,kind,state})=>({id,kind,state}))};
  });
  requireValue(sha(fs.readFileSync(entry.network.original_desk_result))===networkBinding.original_desk_sha256
    &&sha(fs.readFileSync(entry.archive))===archiveSha,
    'The accepted original v1 delivery changed during its network continuation.');
}

try{
  await connect();
  if(networkMode)await receiveNetwork();
  else{
  const selected=await stage('01-customer-project',async()=>getOrCreate('Native inventory receiving · b9d2'));
  const id=selected.id;
  await stage('02-original-csv-intake',async()=>{
    await openProject(id);
    const names=['sites.csv','racks.csv','devices.csv','interfaces.csv','ip_addresses.csv'];
    let value=await project(id);
    const missing=names.filter(name=>!value.uploads.some(item=>item.name===name&&item.sha256===sha(fs.readFileSync(path.join(entry.inputs,name)))));
    if(missing.length){
      await page.getByLabel('Source CSV files',{exact:true}).setInputFiles(missing.map(name=>path.join(entry.inputs,name)));
      for(let n=0;n<120;n++){value=await project(id);if(names.every(name=>value.uploads.some(x=>x.name===name)))break;await page.waitForTimeout(250);}
    }
    value=await project(id);
    requireValue(value.uploads.length===5,'The same five original source files must be retained.');
    for(const upload of value.uploads)requireValue(upload.sha256===sha(fs.readFileSync(path.join(entry.inputs,upload.name))),'A retained original CSV differs.');
    await page.locator('tbody tr').filter({hasText:'devices.csv'}).getByRole('button',{name:'Preview',exact:true}).click();
    await page.getByRole('dialog').locator('tbody tr').first().waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Choose',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByLabel('Catalogue search',{exact:true}).fill('b9d2-nbx-20261012');
    await dialog.getByRole('button',{name:'Search',exact:true}).click();
    await dialog.getByRole('button',{name:'Select b9d2-nbx-20261012',exact:true}).click();
    await page.getByRole('button',{name:'Save mapping',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Saved');
    value=await project(id);
    requireValue(value.tenant_id===fixture.tenant_id,'The selected actual tenant was not saved.');
    return {project_id:id,uploads:value.uploads.map(({name,bytes,row_count,sha256})=>({name,bytes,row_count,sha256})),
      actual_tenant_id:fixture.tenant_id};
  });
  const received=await stage('03-original-handover-receiving',async()=>{
    let value=await project(id),edition=receivedEdition(value,original.operation_id);
    if(!edition){value=await restoreArchive(id,entry.archive);edition=receivedEdition(value,original.operation_id);}
    requireValue(edition,'The original archive has no retained edition.');
    const actual=await detail(id,edition.id);
    requireValue(actual.result?.state==='APPLIED'&&actual.result.receipt_sha256===original.receipt_sha256,
      'The browser did not receive the original applied native receipt.');
    return {edition_id:edition.id,operation_id:edition.operation_id,receipt_sha256:actual.result.receipt_sha256};
  });
  await stage('04-corrected-mapping-and-catalogue',async()=>{
    let value=await openProject(id,'Delivery',received.edition_id);
    if(value.mapping.sources.length===0){
      await page.getByRole('button',{name:'Start a corrected draft',exact:true}).click();
      await page.getByRole('button',{name:'Check source mapping',exact:true}).waitFor();
    }else await page.getByRole('button',{name:'Mapping',exact:true}).click();
    value=await project(id);
    requireValue(value.mapping.sources.length===5&&value.tenant_id===fixture.tenant_id,'The corrected draft must preserve the five original mappings and native tenant.');
    await page.locator('.source-button').filter({hasText:'devices.csv'}).click();
    await page.getByLabel('Description source mode',{exact:true}).selectOption('value');
    await page.getByLabel('Description fixed value',{exact:true}).fill('Customer desk corrected edition · b9d2');
    await page.getByLabel('Serial conversion options',{exact:true}).click();
    await page.getByRole('dialog').getByLabel('Blank value behavior',{exact:true}).selectOption('empty');
    await page.getByRole('dialog').getByRole('button',{name:'Apply options',exact:true}).click();
    await page.getByRole('button',{name:'Save mapping',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='Saved');
    value=await project(id);
    const devices=value.mapping.sources.find(x=>x.kind==='devices');
    requireValue(devices.fields.description.value==='Customer desk corrected edition · b9d2'&&devices.match_id,
      'The original matched devices and edited expression were not retained.');
    await screenshot('desk-desktop-mapping.png');await screenshot('desk-mobile-mapping.png',390);
    return {revision:value.revision,tenant_id:value.tenant_id,mappings:5,description:devices.fields.description};
  });
  const prepared=await stage('05-native-edition-preparation',async()=>{
    let value=await openProject(id,'Mapping');
    let edition=value.editions.find(item=>item.kind==='prepared');
    if(!edition){
      await page.getByRole('button',{name:'Check source mapping',exact:true}).click();
      await page.getByRole('button',{name:'Prepare native edition',exact:true}).waitFor();
      await page.getByRole('button',{name:'Prepare native edition',exact:true}).click();
      await page.getByRole('heading',{name:'Native inventory changes',exact:true}).waitFor();
      value=await project(id);edition=value.editions.find(item=>item.kind==='prepared');
    }
    requireValue(edition,'The exact corrected mapping has no original prepared edition.');
    const request=await api(editionPath(id,edition.id)+'/download/request.json');
    requireValue(request.operation_id===edition.operation_id&&request.objects.every(x=>x.match_id),
      'Every corrected object must retain its actual native ID.');
    return {edition_id:edition.id,operation_id:edition.operation_id,objects:request.objects.length};
  });
  const review=await stage('06-native-review',async()=>{
    let value=await detail(id,prepared.edition_id);
    await openProject(id,'Native review',prepared.edition_id);
    if(value.edition.state==='PREPARED'&&!value.edition.active_action_id)
      await page.getByRole('button',{name:'Review against NetBox',exact:true}).click();
    value=await waitEdition(id,prepared.edition_id,['REVIEWED','APPLIED']);
    requireValue(value.result.netbox_version==='4.7.2'&&value.result.counts.CREATE===0&&value.result.review_digest,
      'The actual review must update the original inventory without replacement objects.');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await screenshot('desk-desktop-native-review.png');await screenshot('desk-mobile-native-review.png',390);
    return {review_digest:value.result.review_digest,counts:value.result.counts,
      actions:value.actions.map(({id,kind,state})=>({id,kind,state}))};
  });
  const applied=await stage('07-apply-lost-browser-reply-and-recovery',async()=>{
    let value=await detail(id,prepared.edition_id),intercepted=false;
    await openProject(id,'Native review',prepared.edition_id);
    const existing=value.actions.find(item=>item.kind==='apply');
    if(value.edition.state==='REVIEWED'&&!existing){
      await page.route('**/api/projects/*/editions/*/actions',async route=>{
        const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
        if(body?.action!=='apply'||intercepted)return route.continue();
        intercepted=true;
        const response=await route.fetch(),raw=await response.body();
        requireValue(response.ok(),'The original apply action was rejected before the deliberate browser interruption.');
        const returned=JSON.parse(raw.toString('utf8'));
        atomic(path.join(entry.output,'browser-response-discarded.json'),{
          operation_id:OPERATION,request_id:body.request_id,review_digest:body.review_digest,
          action_id:returned.action.id,response_status:response.status(),response_sha256:sha(raw)});
        await route.abort('failed');
      });
      await page.getByRole('button',{name:'Apply reviewed changes',exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'Apply reviewed changes',exact:true}).click();
    }
    value=await waitEdition(id,prepared.edition_id,['APPLIED']);
    await page.unroute('**/api/projects/*/editions/*/actions');
    requireValue(value.result.review_digest===review.review_digest&&value.result.counts.CREATE===0,'The applied native receipt differs from the selected review.');
    const originalIds=original.resolved.map(x=>[x.kind,x.key,x.id].join(':')).sort();
    const actualIds=value.result.resolved.map(x=>[x.kind,x.key,x.id].join(':')).sort();
    requireValue(JSON.stringify(originalIds)===JSON.stringify(actualIds),'The corrected desk edition created replacement inventory.');
    const applyActions=value.actions.filter(item=>item.kind==='apply');
    requireValue(applyActions.length===1,'The browser recovery created a second apply action.');
    await waitAction(id,prepared.edition_id,applyActions[0].id);
    await page.reload();
    const recovered=await nativeRecovery(id,prepared.edition_id);
    value=recovered.detail;
    requireValue(value.edition.state==='APPLIED'&&recovered.action.state==='COMPLETE',
      'The original native recovery has not completed.');
    // Reopen the original saved action, including when the carrier ended before
    // the deliberate response-discard file could be written.
    const current=await detail(id,prepared.edition_id);
    requireValue(current.actions.filter(item=>item.kind==='apply').length===1&&current.result.receipt_sha256===value.result.receipt_sha256,
      'The same original receipt did not survive native recovery.');
    const marker=path.join(entry.output,'browser-response-discarded.json');
    return {operation_id:prepared.operation_id,review_digest:review.review_digest,
      receipt_sha256:current.result.receipt_sha256,journal:current.result.journal,
      resolved:current.result.resolved,apply_action_id:applyActions[0].id,
      transport:fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):
        {outcome:'ORIGINAL_APPLY_RECOVERED_AFTER_CARRIER_INTERRUPTION'}};
  });
  const delivery=await stage('08-report-and-complete-handover',async()=>{
    await localAction(id,prepared.edition_id,'report','Create report');
    await localAction(id,prepared.edition_id,'handover','Build handover');
    await openProject(id,'Delivery',prepared.edition_id);
    const files=[];
    for(const [choice,name]of [['handover.zip','inventory-handover.zip'],['report.html','inventory-review.html'],
      ['result.json','native-inventory-result.json'],['resolved.csv','resolved-objects.csv'],
      ['request.json','request.json'],['mapping.json','mapping.json']])files.push(await download(choice,name));
    const native=JSON.parse(fs.readFileSync(path.join(entry.output,'native-inventory-result.json'),'utf8'));
    requireValue(native.receipt_sha256===applied.receipt_sha256,'The delivered native JSON has another receipt.');
    requireValue(fs.readFileSync(path.join(entry.output,'inventory-review.html'),'utf8').includes(prepared.operation_id),
      'The readable report does not identify its actual operation.');
    await screenshot('desk-desktop-delivery.png');
    return {files,receipt_sha256:native.receipt_sha256};
  });
  await stage('09-fresh-customer-receiving-and-native-reopen',async()=>{
    await connect();
    const second=await getOrCreate('Received customer handover · b9d2');
    const file=delivery.files.find(item=>item.selection==='handover.zip');
    requireValue(sha(fs.readFileSync(file.path))===file.sha256,'The selected complete customer archive changed.');
    let value=await project(second.id),edition=receivedEdition(value,prepared.operation_id);
    if(!edition){value=await restoreArchive(second.id,file.path);edition=receivedEdition(value,prepared.operation_id);}
    requireValue(edition?.operation_id===prepared.operation_id,'The fresh customer workspace restored another operation.');
    await openProject(second.id,'Native review',edition.id);
    let current=await detail(second.id,edition.id);
    const recovered=await nativeRecovery(second.id,edition.id);
    current=recovered.detail;
    requireValue(recovered.action.state==='COMPLETE','The received native journal recovery has not completed.');
    requireValue(current.result.receipt_sha256===applied.receipt_sha256
      &&current.actions.every(item=>item.kind!=='apply'),'Fresh receiving must read the original native journal without another apply.');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await screenshot('desk-mobile-customer-reopened.png',390);
    return {project_id:second.id,edition_id:edition.id,operation_id:edition.operation_id,
      receipt_sha256:current.result.receipt_sha256,journal:current.result.journal,
      actions:current.actions.map(({id,kind,state})=>({id,kind,state}))};
  });
}
  requireValue(result.page_errors.length===0,'The original browser emitted page errors.');
  result.state='COMPLETE';result.completed_at=new Date().toISOString();delete result.error;
  save();atomic(path.join(entry.output,networkMode?'network-result.json':'desk-result.json'),result);
}catch(error){
  result.state='CONTINUATION_REQUIRED';result.error={message:error.message,stack:error.stack};
  save();throw error;
}finally{
  await context?.close().catch(()=>{});await browser.close();
  console.log(JSON.stringify({operation_id:OPERATION,state:result.state,steps:result.steps.length,
    error:result.error?.message,output:entry.output}));
}
