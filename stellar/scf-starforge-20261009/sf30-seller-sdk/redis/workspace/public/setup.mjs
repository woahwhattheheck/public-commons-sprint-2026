// MIT. Local connection setup; the original workspace owns all created products.
const $=id=>document.getElementById(id);
const clone=value=>structuredClone(value);
const json=value=>JSON.stringify(value,null,2);
const ids=['workspace-label','deployment','host','port','master-name','database','tls','username','password-env',
  'sentinel-username','sentinel-password-env','sentinel-tls','endpoint','token-env','address-map','max-connections',
  'max-pending','connect-timeout','idle-timeout','startup-timeout','queries','plan'];
let token='',state,reviewed=null,lastPreview=null,created=null,seeds=[],certificates={},busy=false,draftKey;
const limitFields=[['maxConnections','max-connections',4],['maxPending','max-pending',32],
  ['connectTimeoutMs','connect-timeout',3000],['idleTimeoutMs','idle-timeout',30000],['startupTimeoutMs','startup-timeout',5000]];
function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);}
function ordinary(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function parse(value,label){
  let result;try{result=JSON.parse(value);}catch{throw new Error('Correct the JSON in '+label+'.');}
  if(!ordinary(result))throw new Error(label+' must be a JSON object.');
  return result;
}
function integer(id){
  const value=$(id).value;
  if(!/^(0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error('Use a whole number for '+$(id).parentElement.childNodes[0].textContent.trim()+'.');
  return Number(value);
}
function node(tag,text,attributes={}){
  const element=document.createElement(tag);if(text!==undefined)element.textContent=text;
  for(const [key,value]of Object.entries(attributes))element.setAttribute(key,value);
  return element;
}
function table(columns,rows){
  const result=node('table'),head=node('thead'),line=node('tr');
  for(const column of columns)line.append(node('th',column));
  head.append(line);result.append(head);const body=node('tbody');
  for(const row of rows){const tr=node('tr');for(const value of row)tr.append(node('td',typeof value==='string'?value:json(value)));body.append(tr);}
  result.append(body);return result;
}
function selectTab(name){
  for(const button of document.querySelectorAll('[data-tab]')){
    const selected=button.dataset.tab===name;
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    $('panel-'+button.dataset.tab).hidden=!selected;
  }
}
function invalidate(){
  reviewed=null;lastPreview=null;$('review-result').hidden=true;$('review-empty').hidden=false;
  $('next-preview').hidden=true;$('download-preview').hidden=true;
  remember();
}
function layout(){
  const deployment=$('deployment').value,upstash=deployment==='upstash-rest',discovery=['cluster','sentinel'].includes(deployment);
  $('standalone-fields').hidden=deployment!=='standalone';$('resp-fields').hidden=upstash;
  $('discovery-fields').hidden=!discovery;$('sentinel-fields').hidden=deployment!=='sentinel';
  $('sentinel-name-field').hidden=deployment!=='sentinel';$('upstash-fields').hidden=!upstash;
  $('mapping-fields').hidden=!discovery;$('database').disabled=deployment==='cluster'||busy;
  if(deployment==='cluster')$('database').value='0';
  $('seed-heading').textContent=deployment==='sentinel'?'Sentinel monitor nodes':'Cluster seed nodes';
  $('data-ca-field').hidden=$('tls').value==='local-plaintext';
  $('sentinel-ca-field').hidden=$('sentinel-tls').value==='local-plaintext';
  $('data-ca-name').textContent=certificates.caFile?'Selected CA bundle · '+new Blob([certificates.caFile]).size+' bytes':Object.hasOwn(certificates,'caFile')?'Select the referenced CA bundle':'Host trust store';
  $('sentinel-ca-name').textContent=certificates.sentinelCaFile?'Selected monitor CA bundle · '+new Blob([certificates.sentinelCaFile]).size+' bytes':Object.hasOwn(certificates,'sentinelCaFile')?'Select the referenced monitor CA bundle':'Host trust store';
  $('add-seed').disabled=busy||seeds.length>=16;
  $('create').disabled=busy||!!created;
}
function renderSeeds(){
  const target=$('seed-list');target.replaceChildren();
  seeds.forEach((seed,index)=>{
    const row=node('div',undefined,{class:'seed-row'});
    const hostLabel=node('label','Host'),host=node('input',undefined,{'aria-label':'Node '+(index+1)+' host',maxlength:'1024',spellcheck:'false'});
    host.value=seed.host;hostLabel.append(host);
    const portLabel=node('label','Port'),port=node('input',undefined,{type:'number',min:'1',max:'65535','aria-label':'Node '+(index+1)+' port'});
    port.value=seed.port;portLabel.append(port);
    const remove=node('button','Remove',{'aria-label':'Remove node '+(index+1)});
    host.addEventListener('input',()=>{seeds[index].host=host.value;invalidate();});
    port.addEventListener('input',()=>{seeds[index].port=port.value;invalidate();});
    remove.addEventListener('click',()=>{seeds.splice(index,1);renderSeeds();layout();invalidate();});
    row.append(hostLabel,portLabel,remove);target.append(row);
  });
}
function renderDraft(draft){
  if(!ordinary(draft)||!ordinary(draft.source)||!ordinary(draft.source.connection)||!ordinary(draft.plan))
    throw new Error('Import a setup containing source and merchant plan objects.');
  const c=draft.source.connection,mode=c.transport==='upstash-rest'?'upstash-rest':c.topology??'standalone';
  if(!['standalone','cluster','sentinel','upstash-rest'].includes(mode))throw new Error('Choose a supported Redis deployment.');
  const common=['database','username','passwordEnv','tls','caFile','topology'];
  const allowed=mode==='upstash-rest'?['transport','endpoint','tokenEnv']:common.concat(mode==='standalone'?['host','port']:
    mode==='cluster'?['rootNodes','nodeAddressMap']:['name','sentinelRootNodes','nodeAddressMap','sentinelUsername','sentinelPasswordEnv','sentinelTls','sentinelCaFile']);
  if(Object.keys(c).some(key=>!allowed.includes(key)))throw new Error('The imported connection contains unsupported fields. Use environment references for credentials.');
  if(Object.keys(draft.source).some(key=>!['schema','connection','queries',...limitFields.map(item=>item[0])].includes(key)))
    throw new Error('Import the original source declarations before generated customer bindings.');
  $('workspace-label').value=draft.label??'Redis merchant';$('deployment').value=mode;
  $('host').value=c.host??'127.0.0.1';$('port').value=c.port??6379;$('database').value=c.database??0;
  $('master-name').value=c.name??'mymaster';$('tls').value=c.tls??'verify-full';
  $('username').value=c.username??'';$('password-env').value=c.passwordEnv??'';
  $('sentinel-username').value=c.sentinelUsername??'';$('sentinel-password-env').value=c.sentinelPasswordEnv??'';
  $('sentinel-tls').value=c.sentinelTls??'verify-full';$('endpoint').value=c.endpoint??'';
  $('token-env').value=c.tokenEnv??'UPSTASH_REDIS_REST_TOKEN';
  seeds=clone(c.rootNodes??c.sentinelRootNodes??[{host:'127.0.0.1',port:mode==='sentinel'?26379:6379}]);
  certificates=clone(draft.certificates??{});
  for(const item of ['caFile','sentinelCaFile'])if(c[item]&&!certificates[item]){
    certificates[item]='';
    status('Choose the PEM bundle referenced by '+c[item]+' before reviewing.',true);
  }
  $('address-map').value=json(c.nodeAddressMap??{});
  for(const [name,id,fallback]of limitFields)$(id).value=draft.source[name]??fallback;
  $('queries').value=json(draft.source.queries);$('plan').value=json(draft.plan);
  renderSeeds();layout();invalidate();
}
function draft(){
  const mode=$('deployment').value;
  let connection;
  if(mode==='upstash-rest')connection={transport:mode,endpoint:$('endpoint').value.trim(),tokenEnv:$('token-env').value.trim()};
  else{
    connection={topology:mode,database:mode==='cluster'?0:integer('database'),tls:$('tls').value};
    for(const [name,id]of [['username','username'],['passwordEnv','password-env']]){
      const value=$(id).value.trim();if(value)connection[name]=value;
    }
    if(mode==='standalone')Object.assign(connection,{host:$('host').value.trim(),port:integer('port')});
    else{
      const roots=seeds.map(item=>{
        if(!/^[0-9]{1,5}$/.test(String(item.port)))throw new Error('Use a port from 1 to 65535 for each node.');
        return {host:item.host.trim(),port:Number(item.port)};
      });
      connection[mode==='cluster'?'rootNodes':'sentinelRootNodes']=roots;
      const mapping=parse($('address-map').value,'node address mapping');
      if(Object.keys(mapping).length)connection.nodeAddressMap=mapping;
      if(mode==='sentinel'){
        connection.name=$('master-name').value.trim();connection.sentinelTls=$('sentinel-tls').value;
        for(const [name,id]of [['sentinelUsername','sentinel-username'],['sentinelPasswordEnv','sentinel-password-env']]){
          const value=$(id).value.trim();if(value)connection[name]=value;
        }
      }
    }
  }
  const selectedCertificates={};
  if(mode!=='upstash-rest'&&connection.tls!=='local-plaintext'&&Object.hasOwn(certificates,'caFile')){
    connection.caFile='database-ca.pem';selectedCertificates.caFile=certificates.caFile;
  }
  if(mode==='sentinel'&&connection.sentinelTls!=='local-plaintext'&&Object.hasOwn(certificates,'sentinelCaFile')){
    connection.sentinelCaFile='sentinel-ca.pem';selectedCertificates.sentinelCaFile=certificates.sentinelCaFile;
  }
  const source={schema:'stellar-forge.redis-source.v1',connection,queries:parse($('queries').value,'product declarations')};
  for(const [name,id]of limitFields)source[name]=integer(id);
  return {label:$('workspace-label').value.trim(),source,plan:parse($('plan').value,'merchant plan'),certificates:selectedCertificates};
}
function remember(){
  if(!draftKey||created)return;
  try{sessionStorage.setItem(draftKey,JSON.stringify({fields:Object.fromEntries(ids.map(id=>[id,$(id).value])),seeds,certificates}));}
  catch{/* The complete setup remains downloadable if browser storage is full. */}
}
function restore(){
  let value;try{value=JSON.parse(sessionStorage.getItem(draftKey)??'null');}catch{return false;}
  if(!ordinary(value)||!ordinary(value.fields)||!Array.isArray(value.seeds)||!ordinary(value.certificates))return false;
  for(const id of ids)if(typeof value.fields[id]==='string')$(id).value=value.fields[id];
  seeds=value.seeds;certificates=value.certificates;renderSeeds();layout();return true;
}
async function api(path,input){
  const response=await fetch('/api/'+path,{method:input===undefined?'GET':'POST',
    headers:{'x-workspace-token':token,...(input===undefined?{}:{'content-type':'application/json'})},
    ...(input===undefined?{}:{body:JSON.stringify(input)})});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.message??result.error??'Setup could not complete.'),{code:result.error});
  return result;
}
async function run(action){
  if(busy)return;
  busy=true;
  const controls=[...document.querySelectorAll('button,input,select,textarea')].map(element=>[element,element.disabled]);
  for(const [element]of controls)element.disabled=true;
  try{return await action();}
  catch(error){status(error.message,true);}
  finally{busy=false;for(const [element,disabled]of controls)element.disabled=disabled;layout();}
}
function showReview(result,captured){
  reviewed={result,draft:captured};lastPreview=null;
  $('review-empty').hidden=true;$('review-result').hidden=false;
  const c=captured.source.connection,mode=c.transport??c.topology??'standalone',details=$('review-summary');
  details.replaceChildren();
  const rows=[['Workspace',result.label],['Directory',state.directory],['Deployment',mode],
    ['Connection',mode==='upstash-rest'?c.endpoint:mode==='standalone'?c.host+':'+c.port:
      (c.rootNodes??c.sentinelRootNodes).map(value=>value.host+':'+value.port).join(', ')],
    ['Certificate bundles',Object.entries(result.certificates).map(([name,digest])=>name+' · '+digest).join('\n')||'Host trust store']];
  for(const [label,value]of rows)details.append(node('dt',label),node('dd',value));
  const environment=$('environment');environment.replaceChildren();
  if(!result.environment.length)environment.append(node('p','This connection has no credential environment references.'));
  for(const ref of result.environment)environment.append(node('p',ref.name+' · '+(ref.available?'Available on this host':'Set this variable on the host to run live reads')));
  $('review-routes').replaceChildren(table(['Route','Customer URL','Payment options'],result.routes.map(route=>[route.id,route.url,route.payment])));
  $('review-json').textContent=json({review:result,source:captured.source,plan:captured.plan});
  $('preview-query').replaceChildren(...Object.keys(captured.source.queries).map(name=>node('option',name,{value:name})));
  seedPreviewInput();clearPreview();selectTab('review');
}
function seedPreviewInput(){
  if(!reviewed)return;
  const name=$('preview-query').value,route=reviewed.draft.plan.routes.find(value=>value.query===name);
  $('preview-input').value=json(route?.example??{});clearPreview();
}
function clearPreview(){
  lastPreview=null;$('preview-summary').textContent='';$('preview-table').replaceChildren();
  $('preview-detail').hidden=true;$('next-preview').hidden=true;$('download-preview').hidden=true;
}
function showPreview(result){
  lastPreview=result;
  const data=result.data;
  $('preview-summary').textContent=data.rowCount+' rows · '+(data.truncated?'More results available':'Read complete')+' · '+result.observedAt;
  const names=(data.columns??[]).map(value=>typeof value==='string'?value:value.name);
  const rows=(data.rows??[]).map(row=>Array.isArray(row)?row:names.map(name=>row[name]));
  $('preview-table').replaceChildren(table(names,rows));
  $('preview-json').textContent=json(result);$('preview-detail').hidden=false;
  $('next-preview').hidden=!data.nextInput;$('download-preview').hidden=false;
}
async function reviewDraft(){
  const captured=draft();status('Reviewing the connection and merchant configuration…');
  const result=await api('review',captured);showReview(result,captured);status('Review complete. You can preview a product or create the workspace.');
}
async function preview(){
  if(!reviewed)throw new Error('Review the current setup before previewing.');
  status('Reading the selected product from the configured source…');
  const result=await api('preview',{draft:reviewed.draft,digest:reviewed.result.digest,
    query:$('preview-query').value,input:parse($('preview-input').value,'preview input')});
  showPreview(result);status('Source preview completed.');
}
function download(name,value){
  const url=URL.createObjectURL(new Blob([json(value)+'\n'],{type:'application/json'})),a=node('a',undefined,{href:url,download:name});
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function readUpload(file,maximum=262144){
  if(!file||file.size>maximum)throw new Error('Choose a file within '+Math.floor(maximum/1024)+' KiB.');
  return new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
}
function displayCreated(value){
  created=value;$('created-panel').hidden=false;
  $('created-description').textContent=value.directory+' · '+value.workspaceId;
  $('create').disabled=true;status('Workspace created. Open it to edit products, preview, prepare customer packages and manage releases.');
  try{sessionStorage.removeItem(draftKey);sessionStorage.removeItem(draftKey+':create');}catch{}
}
async function openCreated(){
  const result=await api('open',{});displayCreated(result);location.assign(result.operatorUrl);
}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>selectTab(button.dataset.tab));
for(const button of document.querySelectorAll('[data-next]'))button.addEventListener('click',()=>selectTab(button.dataset.next));
for(const id of ids)$(id).addEventListener('input',()=>{layout();invalidate();});
$('deployment').addEventListener('change',()=>{
  if(!seeds.length)seeds=[{host:'127.0.0.1',port:$('deployment').value==='sentinel'?26379:6379}];
  renderSeeds();layout();invalidate();
});
$('add-seed').addEventListener('click',()=>{if(seeds.length<16)seeds.push({host:'',port:$('deployment').value==='sentinel'?26379:6379});renderSeeds();layout();invalidate();});
for(const [input,name,clear]of [['data-ca-upload','caFile','clear-data-ca'],['sentinel-ca-upload','sentinelCaFile','clear-sentinel-ca']]){
  $(input).addEventListener('change',()=>run(async()=>{
    certificates[name]=await readUpload($(input).files[0],1048576);layout();invalidate();status('Certificate bundle selected. Review validates it with the connection.');
  }));
  $(clear).addEventListener('click',()=>{delete certificates[name];$(input).value='';layout();invalidate();});
}
$('review').addEventListener('click',()=>run(reviewDraft));$('review-terms').addEventListener('click',()=>run(reviewDraft));
$('preview').addEventListener('click',()=>run(preview));
$('preview-query').addEventListener('change',seedPreviewInput);
$('preview-input').addEventListener('input',clearPreview);
$('next-preview').addEventListener('click',()=>run(async()=>{
  if(!lastPreview?.data.nextInput)throw new Error('This result has no following page.');
  $('preview-input').value=json(lastPreview.data.nextInput);await preview();
}));
$('download-preview').addEventListener('click',()=>{if(lastPreview)download('redis-source-preview.json',lastPreview);});
$('export-draft').addEventListener('click',()=>run(async()=>{download('redis-connection-setup.json',draft());status('Complete source setup downloaded.');}));
$('import-draft').addEventListener('change',()=>run(async()=>{
  renderDraft(parse(await readUpload($('import-draft').files[0],3145728),'setup'));
  status('Setup imported. Review the selected connection and terms.');selectTab('connection');
}));
$('import-source').addEventListener('change',()=>run(async()=>{
  const source=parse(await readUpload($('import-source').files[0]),'source');
  renderDraft({label:$('workspace-label').value,source,plan:parse($('plan').value,'merchant plan'),certificates:{}});
  status('Source imported. Choose any referenced CA bundles, then review it.');selectTab('connection');
}));
$('import-plan').addEventListener('change',()=>run(async()=>{
  $('plan').value=json(parse(await readUpload($('import-plan').files[0]),'merchant plan'));invalidate();status('Merchant plan imported.');
}));
$('create').addEventListener('click',()=>run(async()=>{
  if(!reviewed)throw new Error('Review the current setup before creating.');
  let prior;try{prior=JSON.parse(sessionStorage.getItem(draftKey+':create')??'null');}catch{}
  const requestId=prior?.digest===reviewed.result.digest?prior.requestId:'create-'+crypto.randomUUID();
  try{sessionStorage.setItem(draftKey+':create',JSON.stringify({digest:reviewed.result.digest,requestId}));}catch{}
  status('Creating the retained workspace…');
  const result=await api('create',{draft:reviewed.draft,digest:reviewed.result.digest,requestId});
  displayCreated(result);location.assign(result.operatorUrl);
}));
$('open-workspace').addEventListener('click',()=>run(openCreated));
$('download-connection').addEventListener('click',()=>{
  if(created){const {operatorUrl,...binding}=created;download('redis-workspace-connection.json',binding);}
});
await run(async()=>{
  const key='redis-setup-token:'+location.origin;
  token=location.hash.slice(1);if(token){try{sessionStorage.setItem(key,token);}catch{}history.replaceState(null,'',location.pathname);}
  else{try{token=sessionStorage.getItem(key)??'';}catch{}}
  if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Open the original setup URL printed by the host process.');
  state=await api('state');$('directory').textContent=state.directory;draftKey='redis-setup-draft:'+state.setupId;
  // Read any saved form before rendering defaults, since rendering remembers its current state.
  let retained;try{retained=sessionStorage.getItem(draftKey);}catch{}
  renderDraft(state.initial);
  if(retained){try{sessionStorage.setItem(draftKey,retained);}catch{}restore();}
  $('setup').hidden=false;
  if(state.created){displayCreated({...state.created,operatorUrl:state.operatorUrl});}
  else status('Configure the source, review its products and terms, then create the workspace.');
});
