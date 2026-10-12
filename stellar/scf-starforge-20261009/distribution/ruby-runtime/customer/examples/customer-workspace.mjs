// MIT. Continue the original completed managed customer through the complete customer desk.
// Reuses its original source, Ruby environment, customer operation and received application.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runCustomerRuntime } from '../../examples/customer-runtime.mjs';
import { openRubyCustomerWorkspace } from '../model.mjs';
import { serveRubyCustomerWorkspace } from '../server.mjs';
import { inspectRubyCustomerLaunch, rubyCustomerWorkspaceStartup } from '../launch.mjs';
import { directory, absolute, id, need, regular, readJSON, once, json, digest, hashObject, exists } from '../../files.mjs';

const SCHEMA='stellar-forge.ruby-customer-workspace-journey.v1';
const INPUT='stellar-forge.ruby-customer-workspace-journey-selection.v1';
function argument(argv,name) {
  const indexes=argv.flatMap((value,index)=>value===name?[index]:[]);
  need(indexes.length===1&&typeof argv[indexes[0]+1]==='string','RUBY_CUSTOMER_ORIGINAL_ARGUMENT');
  return argv[indexes[0]+1];
}
function customerIdentity(value,selected,operations) {
  need(value.id===selected.customerId&&value.customerOperationId===operations.keys.customer&&
    value.registrationId===operations.keys.register&&value.environment.id===selected.environmentId&&
    value.applicationId===selected.applicationId&&value.phase==='READY'&&value.result,
    'RUBY_CUSTOMER_WORKSPACE_ORIGINAL_IDENTITY');
}
export async function runCustomerWorkspace({managedDirectory,customerId}={}) {
  const root=await directory(absolute(managedDirectory)),name=id(customerId);
  need(await exists(join(root,'runtime-customer-result.json')),'RUBY_CUSTOMER_ORIGINAL_RUNTIME_INCOMPLETE',
    'Complete the original managed customer journey first, then continue its same directory.');
  const originalRaw=await regular(join(root,'selection.json'),1048576),original=JSON.parse(originalRaw.toString('utf8'));
  need(original.customer&&['native-dataset-lifecycle','baserow-customer-lifecycle'].includes(original.customer.entry),
    'RUBY_CUSTOMER_ORIGINAL_COMMAND_REQUIRED');
  // Its completed branch verifies the original archive and retained recipient; it never launches another source run.
  const originalResult=await runCustomerRuntime({directory:root,selectionFile:join(root,'selection.json')});
  need(originalResult.state==='COMPLETE'&&originalResult.selectionSha256===digest(originalRaw),
    'RUBY_CUSTOMER_ORIGINAL_RUNTIME_CHANGED');
  const operations=await readJSON(join(root,'operations.json'));
  need(operations.selectionSha256===digest(originalRaw),'RUBY_CUSTOMER_ORIGINAL_OPERATION_CHANGED');
  const runtime=join(root,'producer'),out=await directory(join(root,'customer-workspace'),true);
  const outputDirectory=absolute(argument(original.customer.argv,'--out'));
  const selected={schema:INPUT,managedDirectory:root,customerId:name,
    originalSelectionSha256:digest(originalRaw),originalResultSha256:originalResult.sha256,
    runtimeDirectory:runtime,outputDirectory,environmentId:original.environmentId,
    applicationId:original.applicationId,originalCustomer:original.customer,
    customerOperationId:operations.keys.customer,registrationId:operations.keys.register};
  await once(join(out,'selection.json'),json({...selected,sha256:hashObject(selected)}));
  let request=await readJSON(join(out,'adoption.json'),true),workspace=null,service=null;
  const completed=await readJSON(join(out,'customer-workspace-result.json'),true);
  if(completed) {
    const {sha256,...body}=completed;
    need(completed.schema===SCHEMA&&completed.selectionSha256===hashObject(selected)&&
      hashObject(body)===sha256,'RUBY_CUSTOMER_WORKSPACE_RESULT_CHANGED');
    workspace=await openRubyCustomerWorkspace({directory:runtime});
    try {
      const current=await workspace.customer({id:name});
      customerIdentity(current,selected,operations);
      need(current.selectionSha256===completed.customer.selectionSha256,'RUBY_CUSTOMER_SELECTION_CHANGED');
      for(const descriptor of completed.files) {
        const bytes=await regular(join(out,descriptor.name),Math.max(descriptor.bytes,1));
        need(bytes.length===descriptor.bytes&&digest(bytes)===descriptor.sha256,'RUBY_CUSTOMER_WORKSPACE_FILE_CHANGED');
      }
      return completed;
    } finally {await workspace.close();}
  }
  const retained=[];
  async function save(name,bytes) {
    await once(join(out,name),bytes);
    const descriptor={name,bytes:bytes.length,sha256:digest(bytes)};
    retained.push(descriptor);return descriptor;
  }
  try {
    workspace=await openRubyCustomerWorkspace({directory:runtime});
    const preview=await workspace.previewExisting({directory:outputDirectory});
    need(preview.result&&preview.selected.kind===(original.customer.entry==='native-dataset-lifecycle'?'native':'baserow'),
      'RUBY_CUSTOMER_ORIGINAL_RESULT_REQUIRED');
    if(!request) {
      request={id:name,title:original.title,requestId:randomUUID(),environmentId:original.environmentId,
        outputDirectory,expectedInputSha256:preview.input.sha256,applicationId:original.applicationId,
        operationId:operations.keys.customer,registrationId:operations.keys.register};
      await once(join(out,'adoption.json'),json(request));request=await readJSON(join(out,'adoption.json'));
    }
    need(request.id===name&&request.environmentId===original.environmentId&&request.outputDirectory===outputDirectory&&
      request.expectedInputSha256===preview.input.sha256&&request.applicationId===original.applicationId&&
      request.operationId===operations.keys.customer&&request.registrationId===operations.keys.register,
      'RUBY_CUSTOMER_WORKSPACE_ADOPTION_CHANGED');
    const adopted=await workspace.adoptCustomer(request);
    need(['FINALIZING','READY'].includes(adopted.phase)&&adopted.customerOperationId===operations.keys.customer&&
      adopted.registrationId===operations.keys.register,'RUBY_CUSTOMER_ORIGINAL_OPERATION_CHANGED');
    const launch=await inspectRubyCustomerLaunch({directory:runtime});
    service=await serveRubyCustomerWorkspace({workspace,port:0});
    const startup=await rubyCustomerWorkspaceStartup({launch,workspace,service});
    need(startup.directory===runtime,'RUBY_CUSTOMER_WORKSPACE_STARTUP_CHANGED');
    const session=await fetch(service.origin+'/api/session',{method:'POST',redirect:'error',
      headers:{Origin:service.origin,'x-ruby-runtime-token':service.token,'content-type':'application/json'},
      body:'{}',signal:AbortSignal.timeout(15000)});
    need(session.status===200,'RUBY_CUSTOMER_WORKSPACE_SESSION');
    const cookie=session.headers.get('set-cookie')?.split(';')[0];need(cookie,'RUBY_CUSTOMER_WORKSPACE_SESSION');
    async function requestHttp(path,body) {
      const response=await fetch(service.origin+path,{method:body===undefined?'GET':'POST',
        redirect:'error',headers:{Origin:service.origin,Cookie:cookie,
          ...(body===undefined?{}:{'content-type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
      const bytes=Buffer.from(await response.arrayBuffer());
      need(response.status===200,'RUBY_CUSTOMER_WORKSPACE_HTTP',
        'The original customer route '+path+' returned '+response.status+'.');
      return {response,bytes};
    }
    const assets=[];
    for(const [path,name]of [['/','desk.html'],['/browser.mjs','browser.mjs'],['/panel.mjs','panel.mjs'],
      ['/runtime-browser.mjs','runtime-browser.mjs'],['/style.css','runtime-style.css'],['/customer.css','customer.css']]) {
      const {bytes}=await requestHttp(path);
      need(bytes.length>0,'RUBY_CUSTOMER_WORKSPACE_ASSET');
      assets.push({path,...await save(name,bytes)});
    }
    const reviewed=JSON.parse((await requestHttp('/api/customer/existing',{directory:outputDirectory})).bytes.toString('utf8'));
    need(reviewed.input.sha256===request.expectedInputSha256,'RUBY_CUSTOMER_WORKSPACE_REVIEW_CHANGED');
    const response=await requestHttp('/api/customer/advance',{id:name,expectedSelectionSha256:adopted.selectionSha256});
    const ready=JSON.parse(response.bytes.toString('utf8'));customerIdentity(ready,selected,operations);
    await save('customer.json',response.bytes);
    for(const file of [{name:'selection.json'},...ready.files,{name:'result.json'}]) {
      const {response:reply,bytes}=await requestHttp('/api/customer/file?'+new URLSearchParams({id:name,name:file.name}));
      need(reply.headers.get('x-content-sha256')===digest(bytes)&&
        (file.sha256===undefined||file.sha256===digest(bytes)),'RUBY_CUSTOMER_WORKSPACE_DOWNLOAD_CHANGED');
      const name='received-'+file.name.replaceAll('/','-');
      await save(name,bytes);
    }
    const native=await workspace.operation({operationId:operations.keys.customer});
    const registration=await workspace.operation({operationId:operations.keys.register});
    need(native.phase==='SUCCEEDED'&&!native.active&&registration.phase==='SUCCEEDED'&&!registration.active,
      'RUBY_CUSTOMER_WORKSPACE_ORIGINAL_OPERATION');
    await service.close();service=null;workspace=null;
    workspace=await openRubyCustomerWorkspace({directory:runtime});
    const reopened=await workspace.customer({id:name});customerIdentity(reopened,selected,operations);
    need(reopened.selectionSha256===ready.selectionSha256&&hashObject(reopened.result)===hashObject(ready.result),
      'RUBY_CUSTOMER_WORKSPACE_REOPEN_CHANGED');
    const body={schema:SCHEMA,state:'COMPLETE',selectionSha256:hashObject(selected),
      originalManagedResultSha256:originalResult.sha256,
      customer:{id:name,selectionSha256:ready.selectionSha256,environmentId:ready.environment.id,
        customerOperationId:ready.customerOperationId,registrationId:ready.registrationId,
        applicationId:ready.applicationId,rows:ready.result.rows,fields:ready.result.fields},
      http:{status:200,assets,originalInputSha256:reviewed.input.sha256},
      originalCustomerAndRegistrationReused:true,reopened:true,files:retained};
    const result={...body,sha256:hashObject(body)};
    await once(join(out,'customer-workspace-result.json'),json(result));return result;
  } finally {if(service)await service.close();else if(workspace)await workspace.close();}
}
export async function main(argv=process.argv.slice(2)) {
  need(argv.length===4&&argv[0]==='--managed-directory'&&argv[2]==='--customer-id','RUBY_CUSTOMER_WORKSPACE_OPTIONS',
    'Use --managed-directory ORIGINAL_COMPLETED_MANAGED_JOURNEY --customer-id CUSTOMER_ID.');
  return runCustomerWorkspace({managedDirectory:argv[1],customerId:argv[3]});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{
    process.stderr.write(JSON.stringify({error:{code:error.code??'RUBY_CUSTOMER_WORKSPACE_FAILED',message:error.message}})+'\n');
    process.exitCode=1;
  });
