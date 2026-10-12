#!/usr/bin/env node
// Actual retained Treasury comparison -> complete offline colleague report.
import {readFile,writeFile,open,mkdir,lstat,rename,readdir} from 'node:fs/promises';
import {join,resolve,relative,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

process.umask(0o077);
const root=dirname(fileURLToPath(import.meta.url));
const workspace='/workspace/scratch/7108267765ab/fiscal-customer/retained-workspace';
const cli=join(root,'source/stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/briefing-cli.mjs');
const output=join(root,'native-output'),delivery=join(root,'customer-delivery');
const receiver=join(root,'customer-receiver'),operationId='treasury-debt-comparison-briefing-7108-20261012';
const comparisonId='1e596687-510e-47bd-8cd0-cc27c93d3214';
const comparisonSha256='d26fd89fec959136fa5332ad188cefb86b306df97c2150301133f514101bc195';
const exportId='8128e1aa-4363-43c4-ba3b-c3567089a66e';
const sourceArchiveSha256='25fb62bd12948b0bf3d93bfbfb5881e5bf707e88f1a2d25e323b65c824e4aa15';
const title='Debt to the Penny: October 1–8, 2026';
const audience='Treasury data analysts and colleagues reviewing the retained daily debt observations';
const notes=[
 'The left edition contains October 1–8, 2026; the right edition begins October 2.',
 'The comparison therefore has one removed date and five matching observations.',
 'All three original reviewed measures are daily stocks in USD, scale 1. The first-to-last changes retain their original decimal strings.',
 'The total public debt change across the left edition is USD 44,674,238,439.69, measured from October 1 to October 8. This is a dated stock change.',
 'The complete original source archive contains both field reviews, capture receipts and Treasury response pages.'
].join('\n\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(value,message)=>{if(!value)throw new Error(message);};
let stage='PREPARE',browser=null;
const attempt={schema:'fiscal-briefing-actual-receiving.v1',attemptId:randomUUID(),startedAt:new Date().toISOString(),
 operationId,workspace,comparisonId,comparisonSha256,exportId,steps:[]};
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});
 const part=path+'.'+attempt.attemptId+'.part';const f=await open(part,'w',0o600);
 try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}
 await rename(part,path);
}
async function step(name,value){stage=name;attempt.steps.push({name,at:new Date().toISOString(),...value});
 await json(join(output,'progress.json'),{...attempt,currentStage:name});process.stdout.write(name+'\n');}
async function run(label,command,args,{max=8*1024*1024}={}){
 const result=await new Promise((ok,bad)=>{
  const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const stdout=[],stderr=[];let n=0;
  child.stdout.on('data',b=>{n+=b.length;if(n>max){child.kill('SIGTERM');bad(new Error(label+':OUTPUT_LIMIT'));}else stdout.push(b)});
  child.stderr.on('data',b=>{if(Buffer.concat(stderr).length<1024*1024)stderr.push(b)});
  child.on('error',bad);child.on('close',(code,signal)=>ok({command,args,code,signal,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()}));
 });
 await json(join(output,label+'.json'),result);
 check(result.code===0,label+': '+result.stderr.slice(0,2200));
 return result;
}
async function runCli(label,args){const r=await run(label,process.execPath,[cli,...args]);return JSON.parse(r.stdout);}
async function inspectLinks(page){
 const refs=await page.locator('a[href]').evaluateAll(els=>els.map(x=>({href:x.getAttribute('href'),url:x.href,text:x.textContent.trim()})));
 for(const ref of refs){
  const u=new URL(ref.url);if(u.protocol!=='file:')continue;
  const p=fileURLToPath(u),rel=relative(receiver,p);
  check(rel!== '..'&&!rel.startsWith('../')&&!rel.startsWith('/'),'Link escaped extracted report: '+ref.href);
  check(await exists(p),'Missing complete report link: '+ref.href);
 }
 return refs.length;
}
async function view(page,name,url,width){
 await page.setViewportSize({width,height:950});await page.goto(url,{waitUntil:'load'});
 await page.waitForSelector('h1');const links=await inspectLinks(page);
 const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
 check(dimensions.document<=dimensions.width+1,name+': document overflow');
 const screenshot=join(output,'qa',attempt.attemptId,name+'.png');await mkdir(dirname(screenshot),{recursive:true,mode:0o700});
 await page.screenshot({path:screenshot,fullPage:true});return {url:page.url(),dimensions,links,screenshot};
}
try{
 await mkdir(output,{recursive:true,mode:0o700});
 const complete=join(output,'receiving-result.json');
 if(await exists(complete)){const r=JSON.parse(await readFile(complete,'utf8'));check(r.state==='COMPLETE','Existing result changed');process.stdout.write(JSON.stringify(r)+'\n');process.exit(0);}
 const headerBefore=await readFile(join(workspace,'workspace.json'));
 const originalHeader=JSON.parse(headerBefore);check(originalHeader.id==='dab0a492-74e0-4e10-8d99-861880b3153d'&&originalHeader.revision===60,'Original accepted workspace identity/revision changed');
 await step('ORIGINAL_REVIEW_SELECTED',{workspaceId:originalHeader.id,revision:originalHeader.revision,headerSha256:sha(headerBefore)});
 const selection=await runCli('01-original-selection',['list','--dir',workspace]);
 const comparison=selection.comparisons.find(x=>x.id===comparisonId);
 check(comparison?.sha256===comparisonSha256&&comparison.status==='READY','Original comparison selection missing');
 check(comparison.exports.some(x=>x.id===exportId),'Original comparison export missing');
 await step('ORIGINAL_SELECTION_OPENED',{revision:selection.revision,comparisonId,exportId});
 const args=['create','--dir',workspace,'--comparison',comparisonId,'--expected-comparison-sha256',comparisonSha256,
 '--source-export',exportId,'--out',delivery,'--operation',operationId,'--title',title,'--audience',audience,
 '--notes-file',join(output,'analyst-notes.txt'),'--rows-per-page','2'];
 const notesPath=join(output,'analyst-notes.txt');if(await exists(notesPath))check((await readFile(notesPath,'utf8'))===notes,'Commentary changed');
 else await writeFile(notesPath,notes,{flag:'wx',mode:0o600});
 const created=await runCli('02-create-briefing',args);
 check(created.state==='COMPLETE'&&created.comparisonSha256===comparisonSha256&&created.archive?.sha256,'Complete briefing did not publish');
 await step('COMPLETE_BRIEFING_CREATED',{directory:created.directory,manifestSha256:created.manifestSha256,files:created.files,archive:created.archive});
 const retry=await runCli('03-same-operation-retry',args);
 check(retry.reused===true&&retry.manifestSha256===created.manifestSha256&&retry.archive.sha256===created.archive.sha256&&retry.directory===created.directory,'Same operation changed report');
 await step('SAME_OPERATION_REOPENED',{reused:true,manifestSha256:retry.manifestSha256,archiveSha256:retry.archive.sha256});
 const listing=await run('04-original-archive-members','tar',['-tzf',created.archive.path]);
 const names=listing.stdout.trim().split('\n');
 for(const name of names)check(name&&!name.startsWith('/')&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Unsafe selected archive path');
 const manifest=JSON.parse(await readFile(join(created.directory,'manifest.json'),'utf8'));
 check(names.length===manifest.files.length+1&&names.includes('manifest.json')&&manifest.files.every(f=>names.includes(f.path)),'Archive is not complete selected manifest');
 await mkdir(receiver,{recursive:true,mode:0o700});
 if(!(await exists(join(receiver,'manifest.json'))))await run('05-extract-complete-report','tar',['-xzf',created.archive.path,'-C',receiver,'--no-same-owner']);
 const verified=await runCli('06-verify-extracted-report',['verify','--report',receiver,'--manifest-sha256',created.manifestSha256]);
 check(verified.state==='COMPLETE'&&verified.files===created.files,'Extracted complete report does not verify');
 const report=JSON.parse(await readFile(join(receiver,'briefing.json'),'utf8'));
 check(report.comparison.id===comparisonId&&report.comparison.sha256===comparisonSha256,'Report selection changed');
 const summary=report.comparison.summary;
 check(summary.leftRows===6&&summary.rightRows===5&&summary.removed===1&&summary.unchanged===5&&summary.added===0&&summary.changed===0,'Original row classification changed');
 check(report.datedMeasures.length===6,'Three measures by two editions missing');
 const debt=report.datedMeasures.find(x=>x.field==='tot_pub_debt_out_amt'&&x.side==='left');
 check(debt?.first?.date==='2026-10-01'&&debt.last.date==='2026-10-08'&&debt.change==='44674238439.69'&&debt.unit==='USD'&&String(debt.scale)==='1','Dated stock/units changed');
 check(report.pages.all.length===3&&report.pages.removed.length===1&&report.pages.unchanged.length===3,'Complete row pagination changed');
 const retainedArchive=await readFile(join(receiver,'source-delivery.tar.gz'));
 check(retainedArchive.length===36963&&sha(retainedArchive)===sourceArchiveSha256,'Original source archive changed');
 for(const f of manifest.files){const bytes=await readFile(join(receiver,f.path));check(bytes.length===f.size&&sha(bytes)===f.sha256,'Extracted file changed: '+f.path);}
 await step('COMPLETE_CUSTOMER_EXTRACTION_VERIFIED',{files:verified.files,bytes:verified.bytes,archiveMembers:names.length,originalArchiveSha256:sourceArchiveSha256,datedMeasures:report.datedMeasures.length,rowPages:report.pages});
 const require=createRequire(import.meta.url),runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
 const {chromium}=require(join(runtime,'playwright'));
 browser=await chromium.launch({headless:true,executablePath:'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',
  args:['--no-sandbox','--disable-dev-shm-usage'],downloadsPath:join(output,'downloads')});
 const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const home=pathToFileURL(join(receiver,'index.html')).href;
 const desktop=await view(page,'briefing-desktop',home,1440);
 check((await page.locator('h1').textContent())===title,'Actual briefing title differs');
 check((await page.locator('body').innerText()).includes('44,674,238,439.69'),'Actual dated change is unreadable');
 await page.getByRole('link',{name:'All row detail',exact:true}).click();
 await page.waitForURL('**/rows/all-0001.html');
 check((await page.locator('body').innerText()).includes('2026-10-01'),'First original row is absent');
 await inspectLinks(page);
 await page.getByRole('link',{name:'Next',exact:true}).first().click();await page.waitForURL('**/rows/all-0002.html');
 await page.locator('details').first().locator('summary').click();
 check((await page.locator('body').innerText()).includes('debt_held_public_amt'),'Original complete field detail is absent');
 await page.getByRole('link',{name:'Next',exact:true}).first().click();await page.waitForURL('**/rows/all-0003.html');
 check((await page.locator('body').innerText()).includes('2026-10-08'),'Last original row is absent');
 const detail=await view(page,'removed-observation-desktop',pathToFileURL(join(receiver,'rows/removed-0001.html')).href,1440);
 check(await page.locator('details[open]').count()===1,'Removed observation details should open');
 check((await page.locator('body').innerText()).includes('Absent'),'Missing-side field meaning is absent');
 const mobile=await view(page,'briefing-mobile',home,390);
 const mobileDetail=await view(page,'removed-observation-mobile',pathToFileURL(join(receiver,'rows/removed-0001.html')).href,390);
 check(errors.length===0,'Browser errors: '+errors.join('; '));
 await context.close();await browser.close();browser=null;
 await step('OFFLINE_COLLEAGUE_VIEW_COMPLETE',{desktop,detail,mobile,mobileDetail,browserErrors:errors});
 const finalVerification=await runCli('07-customer-reopen',['verify','--report',receiver,'--manifest-sha256',created.manifestSha256]);
 const headerAfter=await readFile(join(workspace,'workspace.json'));
 check(headerAfter.equals(headerBefore),'Original reviewed workspace changed while creating a briefing');
 await step('SOURCE_AND_CUSTOMER_REOPENED',{sourceRevision:originalHeader.revision,sourceHeaderSha256:sha(headerAfter),files:finalVerification.files,manifestSha256:finalVerification.manifestSha256});
 const final={...attempt,state:'COMPLETE',completedAt:new Date().toISOString(),output:created,receiver,sourceHeaderSha256:sha(headerAfter),
  comparisonSummary:summary,sourceArchive:{bytes:retainedArchive.length,sha256:sourceArchiveSha256},
  screenshotFiles:[desktop.screenshot,detail.screenshot,mobile.screenshot,mobileDetail.screenshot],browserErrors:errors};
 await json(complete,final);await json(join(output,'attempts',attempt.attemptId+'.json'),final);
 process.stdout.write(JSON.stringify({state:final.state,result:complete,archive:created.archive,manifestSha256:created.manifestSha256,files:created.files})+'\n');
}catch(error){
 if(browser)await browser.close().catch(()=>{});
 const failure={...attempt,state:'INTERRUPTED',stage,failedAt:new Date().toISOString(),error:{message:error.message,code:error.code,stack:error.stack}};
 await json(join(output,'attempts',attempt.attemptId+'.json'),failure).catch(()=>{});
 await json(join(output,'progress.json'),failure).catch(()=>{});
 process.stderr.write(JSON.stringify({state:'INTERRUPTED',stage,error:failure.error})+'\n');process.exitCode=1;
}
