#!/usr/bin/env node
// Actual original customer documents; supplied HTML works without loopback navigation.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';
import Zip from './runtime/host/connected_zip.cjs';
const require=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
function installedPlaywright(selected){
 let entry,packagePath;
 if(selected){
  entry=path.resolve(selected);let directory=path.dirname(entry);
  while(true){
   const candidate=path.join(directory,'package.json');
   if(fs.existsSync(candidate)){
    const p=JSON.parse(fs.readFileSync(candidate,'utf8'));
    if(['playwright','playwright-core'].includes(p.name)){packagePath=candidate;break;}
   }
   const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
 }else{
  for(const name of ['playwright','playwright-core']){
   try{entry=require.resolve(name);packagePath=require.resolve(name+'/package.json');break;}catch{}
  }
 }
 if(!entry||!packagePath)throw Error('Select the existing Playwright installation with --playwright-module; this course performs no installation.');
 const metadata=JSON.parse(fs.readFileSync(packagePath,'utf8'));
 const version=/^(\d+)\.(\d+)\./.exec(metadata.version);
 if(!version||Number(version[1])<1||(Number(version[1])===1&&Number(version[2])<60))throw Error('The selected existing Playwright must support connectOverCDP noDefaults (version 1.60 or later).');
 return {entry,metadata};
}

function args(values){const out={};for(let i=0;i<values.length;i++){const k=values[i];if(!['--input','--out','--cdp','--chromium','--playwright-module'].includes(k)||!values[i+1]||values[i+1].startsWith('--')||out[k.slice(2)])throw Error('Use --input BUILT_DIRECTORY --out NEW_DIRECTORY and exactly one --cdp AUTHORIZED_ENDPOINT or --chromium EXISTING_EXECUTABLE.');out[k.slice(2)]=values[++i];}if(!out.input||!out.out||!!out.cdp===!!out.chromium)throw Error('Select original input, new output and one browser mode.');if(out.cdp){const u=new URL(out.cdp);if(!['http:','https:','ws:','wss:'].includes(u.protocol)||u.username||u.password)throw Error('Use the authorized endpoint without embedded credentials.');}return out;}
async function run(){
 const o=args(process.argv.slice(2)),input=path.resolve(o.input),output=path.resolve(o.out),installed=installedPlaywright(o['playwright-module']);
 if(input===output||input.startsWith(output+path.sep)||output.startsWith(input+path.sep))throw Error('Input and output must be separate directories.');
 const sourceManifest=JSON.parse(fs.readFileSync(path.join(here,'source-manifest.json'),'utf8'));for(const f of sourceManifest.files){if(path.isAbsolute(f.path)||f.path.split('/').includes('..'))throw Error('Invalid source member');const b=fs.readFileSync(path.join(here,f.path));if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('Complete source differs: '+f.path);}
 const originalArchives=JSON.parse(fs.readFileSync(path.join(here,'customer-archives.json'),'utf8'));
 const receipt=JSON.parse(fs.readFileSync(path.join(input,'build-receipt.json'),'utf8')),original=JSON.parse(fs.readFileSync(path.join(here,'working-record.json'),'utf8')),working=JSON.parse(fs.readFileSync(path.join(input,'working-record.json'),'utf8'));
 if(JSON.stringify(original)!==JSON.stringify(working)||receipt.working_sha256!==working.sha256)throw Error('Select the exact complete original working record.');
 const documents=[];
 for(const kind of ['sample','paid']){const archive=fs.readFileSync(path.join(input,'BuyHub-'+kind+'-profiles.zip')),expected=originalArchives[kind];if(receipt.archives[kind].bytes!==expected.bytes||receipt.archives[kind].sha256!==expected.sha256)throw Error('Original build receipt archive differs.');if(archive.length!==expected.bytes||hash(archive)!==expected.sha256)throw Error('Original ZIP identity differs.');const members=Zip.readStoredZip(new Uint8Array(archive));if(members.length!==5)throw Error('Expected all five original members.');for(const identity of expected.members){const member=members.find(m=>m.name===identity.name);if(!member||member.bytes!==identity.bytes||hash(member.data)!==identity.sha256)throw Error('Original archive member differs: '+identity.name);}documents.push({kind,html:Zip.utf8Text(members.find(m=>m.name==='profiles.html').data),expected_count:kind==='sample'?1:5});}
 fs.mkdirSync(output,{mode:0o700});fs.mkdirSync(path.join(output,'screens'),{mode:0o700});fs.mkdirSync(path.join(output,'source'),{mode:0o700});for(const d of documents)fs.writeFileSync(path.join(output,'source',d.kind+'.html'),d.html,{flag:'wx'});
 const result={schema:'commons.buyhub-original-document-review/v1',status:'RUNNING',working_sha256:working.sha256,views:[],errors:[],events:[],visual_inspection:'Producing peer must personally inspect each actual full document and image.'};const save=()=>fs.writeFileSync(path.join(output,'run.json'),JSON.stringify(result,null,2)+'\n');const event=(stage,data={})=>{result.events.push({stage,...data});save();console.log(JSON.stringify({stage,...data}));};
 let browser;const contexts=new Set();save();
 try{const runtime=await import(pathToFileURL(installed.entry).href),chromium=runtime.chromium||runtime.default?.chromium;if(!chromium)throw Error('Selected runtime has no Chromium.');
 browser=o.cdp?await chromium.connectOverCDP(o.cdp,{timeout:20000,noDefaults:true}):await chromium.launch({headless:true,executablePath:path.resolve(o.chromium),args:['--no-sandbox','--disable-dev-shm-usage']});event('browser_started',{mode:o.cdp?'existing-authorized-private-contexts':'owned-installed'});
 for(const width of [1440,390]){const context=await browser.newContext({viewport:{width,height:width===390?844:1080},serviceWorkers:'block'});contexts.add(context);await context.route('**/*',r=>r.abort());
 for(const d of documents){const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));await page.setContent(d.html,{waitUntil:'domcontentloaded'});await page.locator('article').nth(d.expected_count-1).waitFor();if(await page.locator('article').count()!==d.expected_count||await page.locator('a[href^="mailto:"]').count()!==d.expected_count)throw Error('Customer profile/contact count differs.');
 const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyFont:getComputedStyle(document.body).fontSize,title:document.title}));if(layout.documentWidth>layout.width+1)throw Error('Customer document overflows: '+d.kind+'/'+width);
 const file=d.kind+'-'+width+'.jpg';await page.screenshot({path:path.join(output,'screens',file),fullPage:true,type:'jpeg',quality:88});result.views.push({kind:d.kind,width,file,html_sha256:hash(Buffer.from(d.html)),...layout});save();await page.close();}
 await context.close();contexts.delete(context);}
 if(result.errors.length)throw Error(result.errors.join('\n'));result.status='PASS';event('complete_documents_reviewed',{views:result.views.length});
 }catch(e){result.status='FAILED';result.error={message:e.message,stack:e.stack};save();throw e;}
 finally{for(const c of contexts){try{await c.close();}catch(e){result.status='FAILED';(result.cleanup_errors??=[]).push(e.message);}}if(browser&&!o.cdp){try{await browser.close();}catch(e){result.status='FAILED';(result.cleanup_errors??=[]).push(e.message);}}event('owned_browser_lifetime_closed',{attached_browser_preserved:!!o.cdp});}
 return result;
}
run().then(r=>{console.log(JSON.stringify({status:r.status,views:r.views.length}));process.exit(r.status==='PASS'?0:1);}).catch(e=>{console.error(e.stack);process.exit(1);});
