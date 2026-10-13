/** Original SF30 CSV pages -> original SF100 finalized delivery.
 * The Python preparation owner holds its permanent operation flock and passes
 * the actual descriptor through this process for the entire native lifetime.
 */
import {createHash} from 'node:crypto';
import {open,lstat,realpath,mkdir,readFile,readdir,rename} from 'node:fs/promises';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadCsvDataset} from '../vendor/original-paired/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-handler.mjs';
import {init,appendMany,scan,finalize} from '../vendor/original-paired/stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs';
const SHA=/^[0-9a-f]{64}$/;
const sha=b=>createHash('sha256').update(b).digest('hex');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const need=(v,m)=>{if(!v)throw new Error(m);};
async function privateDir(path) {
  try {await mkdir(path,{mode:0o700});} catch(e) {if(e.code!=='EEXIST')throw e;}
  const st=await lstat(path); need(st.isDirectory()&&!st.isSymbolicLink()&&!(st.mode&0o077),'Private real directory required: '+path);
  need(await realpath(path)===resolve(path),'Use the canonical directory: '+path);
}
async function bytes(path,max=64*1024*1024) {
  const h=await open(path,'r');
  try {
    const a=await h.stat(),named=await lstat(path);
    need(a.isFile()&&!named.isSymbolicLink()&&a.ino===named.ino&&a.dev===named.dev&&a.size<=max,'Bounded original regular file required');
    const b=await h.readFile(),z=await h.stat();
    need(b.length===a.size&&z.size===a.size&&z.mtimeMs===a.mtimeMs&&z.ctimeMs===a.ctimeMs,'Original file changed during read');
    return b;
  } finally {await h.close();}
}
async function syncDir(path) {const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
async function immutable(path,b) {
  b=Buffer.isBuffer(b)?b:Buffer.from(b);
  try {const old=await bytes(path);need(old.equals(b),'Original retained file differs: '+path);return;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  // The original parent flock serializes this exact temporary path.
  const tmp=path+'.partial';
  let h;try{h=await open(tmp,'w',0o600);await h.writeFile(b);await h.sync();}finally{if(h)await h.close();}
  await rename(tmp,path);await syncDir(dirname(path));
}
async function inventory(root) {
  const result=[];
  async function walk(dir) {
    for(const name of (await readdir(dir)).sort()) {
      const path=join(dir,name),st=await lstat(path);
      need(!st.isSymbolicLink(),'Output contains a symbolic link');
      if(st.isDirectory())await walk(path);
      else {need(st.isFile(),'Output contains a special file');if(name.endsWith('.partial')||name==='result.json')continue;
        const b=await bytes(path);result.push({path:relative(root,path).split('\\').join('/'),bytes:b.length,sha256:sha(b)});}
    }
  } await walk(root);return result;
}
export async function produceLocalDelivery(input) {
  need(input&&Object.keys(input).sort().join(',')==='directory,operationId,producerOptions,sourceBindingSha256','Use the complete producer input');
  need(typeof input.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(input.operationId),'Stable original operation ID required');
  need(SHA.test(input.sourceBindingSha256),'Exact source binding required');
  const root=resolve(input.directory);await privateDir(root);
  const options=input.producerOptions;
  need(options&&typeof options.file==='string'&&options.nullEncoding==='unquoted-empty','Use the reviewed exact CSV projection');
  const csvPath=await realpath(options.file);need(csvPath===options.file,'Use the canonical original CSV path');
  const csv=await bytes(csvPath),csvIdentity={path:csvPath,bytes:csv.length,sha256:sha(csv)};
  const intent={schema:'geocove.local-delivery-intent.v1',input,csv:csvIdentity};
  await immutable(join(root,'intent.json'),stable(intent)+'\n');
  await privateDir(join(root,'inputs'));
  const delivery=join(root,'delivery');await init(delivery);
  const dataset=await loadCsvDataset(options);
  await immutable(join(root,'description.json'),stable(await dataset.describe())+'\n');
  let state=await scan(delivery,{retainPayload:false}),index=0,cursor=null;
  for(;;) {
    need(index<10000,'Full source exceeds the reviewed page capacity');
    const query=new URLSearchParams({limit:'100'});
    if(index)query.set('cursor',cursor);
    const response=await dataset.handle({query});
    need(response.status===200,'Original CSV handler rejected page: '+response.status);
    const payload=Buffer.from(typeof response.body==='string'?response.body:JSON.stringify(response.body));
    const parsed=JSON.parse(payload.toString('utf8'));
    need(parsed.page&&('nextCursor' in parsed.page),'Original page continuation is missing');
    const stem=String(index).padStart(6,'0');
    const pagePath=join(root,'inputs',stem+'.page.json'),evidencePath=join(root,'inputs',stem+'.authorization.json');
    const pageIntent=input.operationId+'.page.'+index;
    const evidence={schema:'geocove.local-page-authorization.v1',operationId:input.operationId,
      intent:pageIntent,sourceBindingSha256:input.sourceBindingSha256,csv:csvIdentity,
      pageIndex:index,requestCursor:cursor,query:query.toString(),
      purpose:'Operator-authorized local delivery of the retained capture or approved local proposal; no purchase, signature, settlement, or County edit.'};
    const evidenceBytes=Buffer.from(stable(evidence)+'\n');
    await immutable(pagePath,payload);await immutable(evidencePath,evidenceBytes);
    const old=state.pages[index];
    if(old) {
      need(old.index===index&&old.intent===pageIntent&&old.requestCursor===cursor&&
        old.sourceSha256===sha(payload)&&old.evidenceSha256===sha(evidenceBytes),'Original SF100 accepted prefix differs from retained projection');
    } else {
      need(!state.finalized&&state.pages.length===index,'Original delivery contains an unrelated suffix');
      await appendMany(delivery,[{page:pagePath,intent:pageIntent,evidence:evidencePath,...(index?{cursor}:{})}]);
      state=await scan(delivery,{retainPayload:false});
    }
    index++;cursor=parsed.page.nextCursor;
    if(cursor===null)break;
    need(typeof cursor==='string'&&cursor.length>0,'Invalid original next cursor');
  }
  need(state.pages.length===index&&state.count===state.total&&state.nextCursor===null,'Delivery does not cover the complete original dataset');
  // Original finalize also verifies/reconciles already-published final files.
  await finalize(delivery);
  state=await scan(delivery,{retainPayload:false});
  need(state.finalized&&state.count===state.total,'Original finalization did not complete');
  const report=Buffer.from(JSON.stringify(state)+'\n'),reportPath=join(root,'finalized-scan.json');
  await immutable(reportPath,report);
  const finalCsv=await bytes(csvPath);need(finalCsv.equals(csv),'Selected CSV changed during native delivery');
  const result={schema:'geocove.local-delivery-result.v1',operationId:input.operationId,
    sourceBindingSha256:input.sourceBindingSha256,reportPath,reportSha256:sha(report),reportBytes:report.length,
    directory:root,deliveryDirectory:delivery,rowCount:state.count,pageCount:index,files:await inventory(root)};
  await immutable(join(root,'result.json'),stable(result)+'\n');
  return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    let total=0;const chunks=[];
    for await(const b of process.stdin){total+=b.length;need(total<=8*1024*1024,'Producer input exceeds capacity');chunks.push(b);}
    const result=await produceLocalDelivery(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error){process.stderr.write(JSON.stringify({state:'INTERRUPTED',error:String(error.message||error)})+'\n');process.exitCode=2;}
}

