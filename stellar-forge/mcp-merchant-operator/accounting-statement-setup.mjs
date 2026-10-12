// MIT. Customer setup and lifecycle routes over the original statement client and durable CLI.
import {mkdir,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {accountingStatementArguments} from './accounting-statement-client.mjs';
import {prepareAccountingStatementOperation,runAccountingStatementOperation,observeAccountingStatementOperation} from './accounting-statement-cli.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const KINDS=new Set(['save','assign','usage_import','withdraw']);
const FILES=new Set(['statement.json','statement.csv','usage.csv','statement.html','manifest.json','period.csv','period-summary.csv','usage-opening.json','usage-closing.json']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const problem=error=>({code:String(error?.code??'CUSTOMER_OPERATION_ERROR'),message:String(error?.message??'The customer operation could not be completed.')});
function need(ok,message,status=400,code='WORKBENCH_CUSTOMER_ARGUMENTS'){if(!ok)throw Object.assign(new Error(message),{status,code});}
function identifier(value){need(typeof value==='string'&&UUID.test(value),'Choose an original customer operation or statement.');return value;}
async function privateRoot(path){
  await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
  need(info.isDirectory()&&!(info.mode&0o077)&&await realpath(path)===resolve(path)&&
    (!process.getuid||info.uid===process.getuid()),'Use the original private customer operation directory.',400,'WORKBENCH_CUSTOMER_DIRECTORY');
  return path;
}
async function originalJson(client,selection,sha256,maximum=128_000_000){
  const parts=[];let size=0;
  for await(const chunk of client.fileChunks(selection,{expectedSha256:sha256})){
    size+=chunk.bytes.length;need(size<=maximum,'The original customer file exceeds the supported preview size.',413);
    parts.push(chunk.bytes);
  }
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,size)));}
  catch{throw Object.assign(new Error('The original customer file is not valid UTF-8 JSON.'),{status:502,code:'WORKBENCH_CUSTOMER_FILE'});}
}
async function statementHistory(client,statementId,expectedRevision){
  const items=[];let offset=0,total;
  for(;;){
    const result=await client.detail({statementId,view:'history',offset,limit:200}),page=result.page;
    need(result.revision===expectedRevision,'This statement changed while its history was read. Open it again.',409,'WORKBENCH_INVENTORY_CHANGED');
    need(page?.kind==='history'&&Array.isArray(page.items)&&page.offset===offset&&Number.isSafeInteger(page.total)&&page.total>=0,
      'The original statement history was incomplete.',502,'WORKBENCH_CUSTOMER_PAGE');
    total??=page.total;need(total===page.total,'The original statement history changed. Open it again.',409);
    items.push(...page.items);
    if(page.nextOffset===null){need(items.length===total,'The original statement history ended early.',502);return items;}
    need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset&&page.nextOffset<total,'The original statement history did not advance.',502);
    offset=page.nextOffset;
  }
}
/** This adapter owns no merchant records. All saves use the existing durable native operation. */
export async function createCustomerSetupRoutes({directory,url,workspace,actor,tokenEnv,connection,enqueue,signal,bodyJson,sendJson}){
  const root=await privateRoot(join(directory,'customer-operations')),jobs=new Map(),preparing=new Map();let closing=false;
  const operationPath=id=>join(root,identifier(id));
  const jobView=job=>job?{phase:job.phase,action:job.action,startedAt:job.startedAt,finishedAt:job.finishedAt,error:job.error}:null;
  async function observe(id){
    const row=await observeAccountingStatementOperation({directory:operationPath(id)});
    need(row.workspace===workspace&&row.url===url,'Open this saved customer operation with its original merchant connection.',409,'WORKBENCH_WORKSPACE');
    return {...row,id,job:jobView(jobs.get(id))};
  }
  async function prepare(id,kind,value){
    identifier(id);need(KINDS.has(kind),'Choose customer save, order assignment, service import or withdrawal.');
    need(plain(value),'Supply the reviewed original customer changes.');
    const args=accountingStatementArguments(kind,{...value,actor}),signature=JSON.stringify({kind,arguments:args});
    const current=preparing.get(id);
    if(current){need(current.signature===signature,'This saved request has different changes. Review a new operation.',409);return current.promise;}
    const promise=(async()=>{
      await prepareAccountingStatementOperation({directory:operationPath(id),url,workspace,tokenEnv,kind,arguments:args});
      return observe(id);
    })();
    preparing.set(id,{signature,promise});
    try{return await promise;}finally{if(preparing.get(id)?.promise===promise)preparing.delete(id);}
  }
  async function begin(id,execute){
    need(!closing,'The customer workbench is shutting down.',503);
    const previous=jobs.get(id);if(['QUEUED','RUNNING'].includes(previous?.phase))return jobView(previous);
    const original=await observe(id);
    const admitted=jobs.get(id);if(['QUEUED','RUNNING'].includes(admitted?.phase))return jobView(admitted);
    need(KINDS.has(original.kind),'This customer operation belongs to another command.',409);
    const job={phase:'QUEUED',action:execute?'APPLY':'RECONCILE',startedAt:new Date().toISOString(),finishedAt:null,error:null,promise:null};
    jobs.set(id,job);
    job.promise=enqueue(async()=>{
      signal?.throwIfAborted();job.phase='RUNNING';
      if(!original.state)await prepareAccountingStatementOperation({directory:operationPath(id),url,workspace,tokenEnv:original.tokenEnv,kind:original.kind,arguments:original.arguments});
      return runAccountingStatementOperation({directory:operationPath(id),execute,client:await connection(),signal});
    }).then(result=>{job.phase=result.found?'FINISHED':'NOT_OBSERVED';},error=>{job.phase='ERROR';job.error=problem(error);})
      .finally(()=>{job.finishedAt=new Date().toISOString();});
    return jobView(job);
  }
  async function inspectStatement(id){
    const client=await connection(),detail=await client.detail({statementId:identifier(id)});
    const document=await originalJson(client,{kind:'customer-statement',statementId:id,file:'statement.json'},detail.statement.files['statement.json'].sha256);
    const history=await statementHistory(client,id,detail.revision);
    return {...detail,document,history};
  }
  async function reviewOrders(value){
    need(plain(value),'Supply the original order assignments.');
    const args=accountingStatementArguments('assign',{...value.arguments,actor}),client=await connection();
    const [bindings,customers]=await Promise.all([client.allBindings(),client.allCustomers()]);
    need(bindings.revision===customers.revision,'The customer records changed during review. Refresh the workspace.',409,'WORKBENCH_INVENTORY_CHANGED');
    let report=null,run=null;
    if(value.runId){
      identifier(value.runId);let offset=0,total;
      for(;;){
        const result=await client.status({view:'runs',offset,limit:200}),page=result.page;
        need(result.revision===bindings.revision&&page?.kind==='runs'&&page.offset===offset&&Array.isArray(page.items),
          'The accounting run inventory changed during review. Refresh the workspace.',409,'WORKBENCH_INVENTORY_CHANGED');
        total??=page.total;need(total===page.total&&Number.isSafeInteger(total),'The accounting run inventory is incomplete.',502);
        run=page.items.find(row=>row.id===value.runId)??run;
        if(page.nextOffset===null)break;
        need(page.nextOffset===offset+page.items.length&&page.nextOffset>offset&&page.nextOffset<total,'The accounting run inventory did not advance.',502);
        offset=page.nextOffset;
      }
      need(run,'Choose a completed accounting run from this workspace.',404);
      report=await originalJson(client,{kind:'report',runId:run.id,file:'report.json'},run.reportSha256);
      need(report.schema==='stellar-forge.merchant-reconciliation.v1'&&Array.isArray(report.ledger),'The original completed run has no native accounting ledger.',502);
    }
    const byReference=new Map(bindings.items.map(row=>[row.orderRef,row]));
    const byCustomer=new Map(customers.items.map(row=>[row.id,row]));
    const orders=args.orders.map(order=>{
      const binding=byReference.get(order.orderRef),digest=createHash('sha256').update(order.orderRef).digest('hex');
      const events=report?report.ledger.filter(row=>row.orderReferenceDigest===digest):[];
      return {...order,binding:binding??null,currentCustomer:binding?byCustomer.get(binding.customerId)??null:null,
        purchaseEvents:events,runReviewed:Boolean(run)};
    });
    return {revision:bindings.revision,customer:byCustomer.get(args.customerId)??null,run,orders};
  }
  return {
    async handle(request,response,address){
      const path=decodeURIComponent(address.pathname);if(!path.startsWith('/api/setup/'))return false;
      if(request.method==='GET'&&path==='/api/setup/configuration'){
        const result=await (await connection()).sources(),source=result.workspaces?.find(row=>row.workspace===workspace);
        need(source&&Array.isArray(source.statementUsageInputs),'The selected merchant workspace did not return its configured service sources.',502);
        sendJson(response,200,{workspace,label:source.label,usageSources:source.statementUsageInputs});return true;
      }
      if(request.method==='POST'&&path==='/api/setup/usage-preview'){
        const body=await bodyJson(request),client=await connection();
        const source=await client.usageSource(body.source),current=await client.status();
        sendJson(response,200,{source,revision:current.revision});return true;
      }
      if(request.method==='POST'&&path==='/api/setup/order-review'){
        sendJson(response,200,await reviewOrders(await bodyJson(request)));return true;
      }
      if(request.method==='GET'&&path==='/api/setup/operations'){
        const items=[];
        for(const entry of await readdir(root,{withFileTypes:true})){
          if(!entry.isDirectory()||!UUID.test(entry.name))continue;
          try{items.push(await observe(entry.name));}
          catch(error){items.push({id:entry.name,phase:'UNREADABLE',error:problem(error),job:jobView(jobs.get(entry.name))});}
        }
        items.sort((a,b)=>String(b.preparedAt??'').localeCompare(String(a.preparedAt??'')));
        sendJson(response,200,{items});return true;
      }
      if(request.method==='POST'&&path==='/api/setup/operations'){
        const body=await bodyJson(request);
        need(Object.keys(body).every(key=>['operationId','kind','arguments'].includes(key)),'Use the original customer operation fields.');
        sendJson(response,200,await prepare(body.operationId,body.kind,body.arguments));return true;
      }
      const operation=path.match(/^\/api\/setup\/operations\/([^/]+)(?:\/(execute|reconcile))?$/);
      if(operation){
        const id=identifier(operation[1]);
        if(request.method==='GET'&&!operation[2]){sendJson(response,200,await observe(id));return true;}
        if(request.method==='POST'&&operation[2]){
          const body=await bodyJson(request),execute=operation[2]==='execute';
          need(!execute||body.execute===true,'Review these saved customer changes before applying them.');
          sendJson(response,202,{id,job:await begin(id,execute)});return true;
        }
      }
      const statement=path.match(/^\/api\/setup\/statements\/([^/]+)(?:\/file\/([^/]+))?$/);
      if(request.method==='GET'&&statement){
        const id=identifier(statement[1]),file=statement[2];
        if(!file){sendJson(response,200,await inspectStatement(id));return true;}
        need(FILES.has(file),'Choose an original retained statement file.',404);
        const client=await connection(),detail=await client.detail({statementId:id}),metadata=detail.statement.files[file];
        need(metadata,'This statement has no selected file.',404);
        const type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8';
        response.writeHead(200,{'Content-Type':type,'Content-Disposition':'attachment; filename="'+file+'"','Content-Length':metadata.bytes});
        async function* chunks(){for await(const chunk of client.fileChunks({kind:'customer-statement',statementId:id,file},{expectedSha256:metadata.sha256}))yield chunk.bytes;}
        await pipeline(Readable.from(chunks()),response);return true;
      }
      throw Object.assign(new Error('This customer workbench operation could not be found.'),{status:404,code:'WORKBENCH_CUSTOMER_NOT_FOUND'});
    },
    async close(){closing=true;await Promise.allSettled([...preparing.values()].map(row=>row.promise));await Promise.allSettled([...jobs.values()].map(row=>row.promise));}
  };
}
