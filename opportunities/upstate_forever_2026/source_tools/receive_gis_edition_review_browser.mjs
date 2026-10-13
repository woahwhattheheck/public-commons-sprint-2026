#!/usr/bin/env node
/** Open the actual retained GIS edition report in the operator and offline. */
import {promises as fs,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const SCHEMA='upstate.gis-edition-review-browser-request/v1';
const RESULT='upstate.gis-edition-review-browser-result/v1';
const ID=/^[0-9a-f]{64}$/;
const now=()=>new Date().toISOString();
const copy=value=>JSON.parse(JSON.stringify(value));
function demand(value,message){if(!value)throw new Error(message);}
function member(value){
  demand(typeof value==='string'&&value&&!value.includes('\\')&&!value.includes('\0')&&!isAbsolute(value)&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Use a declared report-relative file.');
  return value;
}
async function hashFile(path){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){bytes+=chunk.length;hash.update(chunk);}
  return {bytes,sha256:hash.digest('hex')};
}
async function json(path){return JSON.parse((await fs.readFile(path,'utf8')).replace(/^\uFEFF/,''));}
async function writeJSON(path,value){
  const temporary=path+'.'+process.pid+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await fs.rename(temporary,path);
}
function parseArgs(argv){
  const result={};
  for(let i=0;i<argv.length;i+=2){
    demand(['--request','--playwright-module','--executable'].includes(argv[i])&&argv[i+1]&&!result[argv[i]],
      'Use --request FILE, optional --playwright-module PATH and --executable PATH.');
    result[argv[i]]=argv[i+1];
  }
  demand(result['--request'],'Provide the native receiving command’s complete browser request.');
  return result;
}
function readPayload(html){
  const match=html.match(/<script\b[^>]*\bid=["']gis-review-payload["'][^>]*>([\s\S]*?)<\/script>/i);
  demand(match,'The original geographic report payload is missing.');
  return JSON.parse(match[1]);
}
export function describeRequest(request){
  demand(request?.schema===SCHEMA,'Use the current native GIS report receiving request.');
  for(const key of ['id','receipt_id','export_id'])demand(ID.test(request.report?.[key]||''),'The request must retain full original report and pair IDs.');
  for(const key of ['output_directory','original_directory','reopened_directory'])demand(isAbsolute(request[key]||''),'Use actual absolute receiving directories.');
  const original=resolve(request.original_directory),reopened=resolve(request.reopened_directory),output=resolve(request.output_directory);
  demand(original!==reopened,'Reopen the complete archive in its independent receiving directory.');
  for(const root of [original,reopened])demand(output!==root&&!output.startsWith(root+sep)&&!root.startsWith(output+sep),
    'Keep browser output separate from both original and reopened report directories.');
  demand(Array.isArray(request.report.files)&&request.report.files.length>0,'Retain the complete native report file inventory.');
  const files=new Map();
  for(const row of request.report.files){
    const name=member(row.path);
    demand(!files.has(name)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&ID.test(row.sha256||''),'The report inventory contains an invalid or repeated file.');
    files.set(name,{path:name,bytes:row.bytes,sha256:row.sha256});
  }
  for(const name of ['REVIEW.html','review.json','layers.csv','exported-project.json','received-project.json','review.zip'])
    demand(files.has(name),'Missing original report member: '+name);
  for(const [key,root] of [['offline',original],['reopened',reopened]]){
    const url=new URL(request.locations?.[key]);
    demand(url.protocol==='file:'&&fileURLToPath(url)===join(root,'REVIEW.html')&&!url.search&&!url.hash,
      'The offline report must open its original declared REVIEW.html.');
  }
  const login=new URL(request.locations?.operator_url),origin=new URL(request.locations?.operator_origin);
  demand(['http:','https:'].includes(login.protocol)&&['127.0.0.1','localhost','[::1]'].includes(login.hostname)&&
    !login.username&&!login.password&&!login.search&&['','/'].includes(login.pathname)&&
    login.origin===origin.origin&&!origin.search&&!origin.hash&&['','/'].includes(origin.pathname),
    'Use the actual original loopback operator startup URL.');
  const fragment=new URLSearchParams(login.hash.slice(1));
  demand(fragment.getAll('token').length===1&&fragment.get('token')&&[...fragment.keys()].every(key=>key==='token'),
    'Open the original private operator capability through its login page.');
  demand(ID.test(request.workspace_key||''),'Use the original operator Workspace key.');
  const expected='/api/file/gis-project/'+[request.workspace_key,'review',request.report.receipt_id,request.report.id].map(encodeURIComponent).join('/')+'/REVIEW.html';
  demand(request.locations.operator_review_path===expected,'The operator report route belongs to another retained review.');
  return {original,reopened,output,files,origin:origin.origin,token:fragment.get('token'),operatorPath:expected};
}
export async function receiveBrowser(request,{playwrightModule=null,executable=null}={}){
  const spec=describeRequest(request),started=Date.now();
  await fs.mkdir(spec.output,{recursive:true,mode:0o700});
  for(const name of ['screens','downloads'])await fs.mkdir(join(spec.output,name),{recursive:true,mode:0o700});
  const result={schema:RESULT,operation_id:request.operation_id,report_id:request.report.id,
    export_id:request.report.export_id,receipt_id:request.report.receipt_id,workspace_key:request.workspace_key,
    started_at:now(),state:'running',contexts:[],downloads:[],opened_documents:[],artifacts:[],errors:[]};
  const artifacts=new Map();
  const safeError=value=>{
    let text=String(value?.message||value);
    for(const secret of [request.locations.operator_url,spec.token])if(secret)text=text.split(secret).join('[private operator session]');
    return text.replace(/https?:\/\/[^\s"'<>]+/g,'[operator resource]').slice(0,5000);
  };
  async function artifact(path,kind,details={}){
    const rel=relative(spec.output,resolve(path)).split(sep).join('/');
    member(rel);demand(!rel.startsWith('..'),'Return artifacts only inside the browser receiving folder.');
    const descriptor={path:rel,...await hashFile(path),kind,...details};
    artifacts.set(rel,descriptor);return descriptor;
  }
  async function checkpoint(){
    result.artifacts=[...artifacts.values()];result.updated_at=now();result.elapsed_seconds=(Date.now()-started)/1000;
    await writeJSON(join(spec.output,'result.json'),result);
  }
  const sourceHTML=await fs.readFile(join(spec.original,'REVIEW.html'),'utf8');
  const actualHTML=await hashFile(join(spec.original,'REVIEW.html')),expectedHTML=spec.files.get('REVIEW.html');
  demand(actualHTML.bytes===expectedHTML.bytes&&actualHTML.sha256===expectedHTML.sha256,'Original REVIEW.html differs from its declared native edition.');
  const reopenedHTML=await hashFile(join(spec.reopened,'REVIEW.html'));
  demand(reopenedHTML.bytes===actualHTML.bytes&&reopenedHTML.sha256===actualHTML.sha256,'The independently reopened report differs from its original HTML.');
  const payload=readPayload(sourceHTML);
  demand(payload.id===request.report.id&&payload.selection?.receipt_id===request.report.receipt_id&&
    payload.selection?.export_id===request.report.export_id&&payload.layers?.length===request.report.layer_count,
    'The report payload does not match the original accepted pair.');
  const rasterIDs=new Set((request.report.raster_layers||[]).map(row=>row.layer_id));
  demand(payload.layers.filter(row=>row.kind==='raster').every(row=>rasterIDs.has(row.layer_id))&&
    rasterIDs.size===payload.layers.filter(row=>row.kind==='raster').length,'The native report raster roster changed.');
  let browser=null,context=null;
  const moduleName=playwrightModule?pathToFileURL(resolve(playwrightModule)).href:'playwright';
  const imported=await import(moduleName),chromium=imported.chromium||imported.default?.chromium;
  demand(typeof chromium?.launch==='function','Use the existing Playwright module with Chromium support.');
  const launchOptions={headless:true};
  if(executable||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)launchOptions.executablePath=resolve(executable||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  try{
    browser=await chromium.launch(launchOptions);
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,colorScheme:'light'});
    context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
    // Original report pages are self-contained. Keep browser reads on files or the current local operator.
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(['http:','https:'].includes(url.protocol)&&url.origin!==spec.origin)return route.abort('blockedbyclient');
      return route.continue();
    });
    context.on('page',page=>page.on('pageerror',error=>result.errors.push({context:'browser-script',message:safeError(error)})));
    async function settled(page){
      await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    }
    async function populated(page){
      await page.locator('#application').waitFor({state:'visible'});await settled(page);
      demand(!await page.locator('#fatal').isVisible(),'The actual report displayed its fatal error.');
      const actual=await page.locator('#gis-review-payload').textContent();
      const parsed=JSON.parse(actual);
      demand(parsed.id===request.report.id&&parsed.selection?.receipt_id===request.report.receipt_id&&
        parsed.selection?.export_id===request.report.export_id,'The browser opened another native report.');
      demand(await page.locator('#layer-list button').count()===payload.layers.length,'The report omitted a retained layer.');
    }
    async function capture(page,label,details){
      await settled(page);const target=join(spec.output,'screens',label+'.png');
      await page.screenshot({path:target,fullPage:true});
      return artifact(target,'rendered-screen',details);
    }
    async function geometry(page){
      return page.evaluate(()=>{
        const canvas=document.querySelector('#raster-map'),rect=canvas?.getBoundingClientRect();
        return {document_width:document.documentElement.scrollWidth,viewport_width:innerWidth,
          document_height:document.documentElement.scrollHeight,
          map:rect?{width:rect.width,height:rect.height}:null};
      });
    }
    async function downloadLink(page,selector,name,contextName){
      name=member(name);const expected=spec.files.get(name);
      demand(expected,'A visible download is absent from the original report inventory: '+name);
      const locator=page.locator(selector).first();await locator.waitFor({state:'visible'});
      const promised=page.waitForEvent('download');
      await locator.click();
      const download=await promised;
      const target=join(spec.output,'downloads',contextName,name);
      await fs.mkdir(dirname(target),{recursive:true,mode:0o700});await download.saveAs(target);
      demand(!await download.failure(),'The original browser download did not finish.');
      const saved=await artifact(target,'downloaded-report-member',{member:name,context:contextName});
      demand(saved.bytes===expected.bytes&&saved.sha256===expected.sha256,'The browser download changed original file bytes: '+name);
      result.downloads.push({context:contextName,member:name,artifact:saved.path,suggested_filename:download.suggestedFilename()});
      return saved;
    }
    async function browse(page,label,{controls=true,downloads=false}={}){
      await populated(page);const entry={context:label,started_at:now(),layers:[],documents:[]};
      result.contexts.push(entry);
      for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
        await page.setViewportSize(viewport);
        if(!payload.layers.length){
          entry.empty={message:await page.locator('#layer-title').innerText(),...await geometry(page)};
          await capture(page,label+'-'+viewport.width+'-empty',{context:label,viewport});
        }
        for(let index=0;index<payload.layers.length;index++){
          const layer=payload.layers[index],buttons=page.locator('#layer-list button');
          await buttons.nth(index).click();await settled(page);
          demand(await buttons.nth(index).getAttribute('aria-pressed')==='true','The layer selection did not remain selected.');
          const prefix=label+'-'+viewport.width+'-layer-'+String(index+1).padStart(3,'0');
          const record={layer_id:layer.layer_id,title:await page.locator('#layer-title').innerText(),
            viewport,counts:await page.locator('#comparison-counts').innerText(),
            explanation:await page.locator('#layer-notices').innerText(),...await geometry(page)};
          const visible=await page.locator('#raster-region').isVisible();
          demand(visible===Boolean(layer.raster_view),'The retained raster view and visible report disagree.');
          if(visible){
            const canvas=page.locator('#raster-map');
            demand((await canvas.evaluate(node=>({width:node.width,height:node.height}))).width>0,'The actual map has no rendered backing pixels.');
            record.aggregation=await page.locator('#aggregation-description').innerText();
            record.modes=[];
            const options=await page.locator('#map-mode option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,disabled:node.disabled})));
            for(const option of options){
              if(option.disabled)continue;
              await page.locator('#map-mode').selectOption(option.value);await settled(page);
              record.modes.push({mode:option.value,legend:await page.locator('#map-legend').innerText(),meaning:await page.locator('#map-measure').innerText()});
              if(option.value==='increase'||option.value==='decrease')
                await capture(page,prefix+'-'+option.value,{context:label,viewport,layer_id:layer.layer_id,mode:option.value});
            }
            await page.locator('#map-mode').selectOption('support');
            if(controls){
              const before=await page.locator('#bin-intro').innerText();
              if(await page.locator('#next-bin').isEnabled())await page.locator('#next-bin').click();
              const next=await page.locator('#bin-intro').innerText();
              if(await page.locator('#previous-bin').isEnabled())await page.locator('#previous-bin').click();
              await canvas.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
              const keyboard=await page.locator('#bin-intro').innerText();
              await page.locator('#zoom-in').click();await page.locator('#zoom-out').click();
              await canvas.focus();await page.keyboard.press('+');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Home');
              const box=await canvas.boundingBox();demand(box&&box.width>0&&box.height>0,'The visible map has no usable layout.');
              await page.mouse.move(box.x+box.width*.45,box.y+box.height*.48);
              await page.mouse.down();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.52,{steps:5});await page.mouse.up();
              await page.locator('#reset-map').click();
              await canvas.click({position:{x:box.width/2,y:box.height/2}});
              const coordinates=page.locator('#bin-coordinates').locator('..');
              if(await coordinates.getAttribute('open')===null)await coordinates.locator('summary').click();
              record.controls={first_bin:before,next_bin:next,keyboard_bin:keyboard,
                selected_bin:await page.locator('#bin-intro').innerText(),
                counts:await page.locator('#bin-table').innerText(),coordinates:await page.locator('#bin-coordinates').innerText(),
                crs:await page.locator('#original-crs').innerText(),used:['layer','display mode','bin next/previous','keyboard selection','zoom','keyboard pan','pointer pan','fit','pointer select','CRS details']};
            }
          }
          const rendered=await capture(page,prefix,{context:label,viewport,layer_id:layer.layer_id,mode:visible?'support':null});
          record.screenshot=rendered.path;entry.layers.push(record);
          if(downloads&&viewport.width===1440){
            const links=await page.locator('#layer-files a[download]').evaluateAll(nodes=>nodes.map(node=>({href:node.getAttribute('href')})));
            for(const link of links){
              const name=member(decodeURIComponent(link.href));
              const escaped=JSON.stringify(link.href);
              await downloadLink(page,'#layer-files a[href='+escaped+']',name,label);
            }
          }
          await checkpoint();
        }
      }
      await page.setViewportSize({width:1440,height:1000});
      entry.completed_at=now();await checkpoint();return entry;
    }
    const original=await context.newPage();
    await original.goto(request.locations.offline,{waitUntil:'load'});
    await browse(original,'original-offline',{downloads:true});
    // Open the original JSON/manifest links normally. CSV uses the browser's native download handling.
    for(const name of ['review.json','exported-project.json','received-project.json']){
      const actual=await hashFile(join(spec.original,name)),expected=spec.files.get(name);
      demand(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'Original report attachment changed: '+name);
      const doc=await context.newPage();
      await doc.goto(new URL(name,request.locations.offline).href,{waitUntil:'load'});
      const displayed=await doc.locator('body').innerText();
      const parsed=JSON.parse(displayed);
      result.opened_documents.push({context:'original-offline',member:name,bytes:actual.bytes,sha256:actual.sha256,
        json_type:Array.isArray(parsed)?'array':'object'});
      await doc.close();
    }
    // The normal application login establishes the original HttpOnly download session cookie.
    const operator=await context.newPage();
    await operator.goto(request.locations.operator_url,{waitUntil:'domcontentloaded'});
    await operator.locator('#workspace-select').waitFor({state:'visible'});
    await operator.locator('#workspace-select option[value="'+request.workspace_key+'"]').waitFor({state:'attached'});
    if(await operator.locator('#workspace-select').inputValue()!==request.workspace_key)
      await operator.locator('#workspace-select').selectOption(request.workspace_key);
    await operator.evaluate(()=>{location.hash='gis-projects';});
    const operatorLink='a[href='+JSON.stringify(request.locations.operator_review_path)+']';
    const anchor=operator.locator(operatorLink).first();
    await anchor.waitFor({state:'attached'});
    const details=anchor.locator('xpath=ancestor::details');
    for(let index=0;index<await details.count();index++){
      const group=details.nth(index);
      if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();
    }
    await anchor.waitFor({state:'visible'});await anchor.scrollIntoViewIfNeeded();
    await capture(operator,'operator-1440-project-card',{context:'operator',viewport:{width:1440,height:1000}});
    const popupPromise=context.waitForEvent('page');await anchor.click();
    const preview=await popupPromise;await preview.waitForLoadState('domcontentloaded');
    demand(new URL(preview.url()).origin===spec.origin&&new URL(preview.url()).pathname===spec.operatorPath,
      'The application opened a different review resource.');
    await browse(preview,'operator-preview',{downloads:true});
    const prefix=spec.operatorPath.slice(0,-'REVIEW.html'.length);
    const zipSelector='a[href='+JSON.stringify(prefix+'review.zip?download=1')+']';
    await downloadLink(operator,zipSelector,'review.zip','operator');
    for(const name of ['review.json','layers.csv']){
      const selector='a[href='+JSON.stringify(prefix+name+'?download=1')+']';
      await downloadLink(operator,selector,name,'operator');
    }
    await operator.setViewportSize({width:390,height:844});
    await anchor.scrollIntoViewIfNeeded();
    await capture(operator,'operator-390-project-card',{context:'operator',viewport:{width:390,height:844}});
    await context.close();context=null;
    // A fresh browser context opens the independently extracted complete report with no operator session.
    context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,colorScheme:'light'});
    context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      return ['http:','https:'].includes(url.protocol)?route.abort('blockedbyclient'):route.continue();
    });
    context.on('page',page=>page.on('pageerror',error=>result.errors.push({context:'reopened-script',message:safeError(error)})));
    const reopened=await context.newPage();
    await reopened.goto(request.locations.reopened,{waitUntil:'load'});
    await browse(reopened,'independent-reopen',{downloads:false});
    demand(result.errors.length===0,'The actual report browser returned a script exception; see the retained result.');
    result.state='complete';result.completed_at=now();await checkpoint();
    return result;
  }catch(error){
    result.state='failed';result.failed_at=now();result.error=safeError(error);await checkpoint();throw new Error(result.error);
  }finally{
    if(context)await context.close().catch(()=>{});
    if(browser)await browser.close().catch(()=>{});
  }
}
async function main(){
  let request;
  try{
    const args=parseArgs(process.argv.slice(2));request=await json(resolve(args['--request']));
    const result=await receiveBrowser(request,{playwrightModule:args['--playwright-module'],executable:args['--executable']});
    process.stdout.write(JSON.stringify({state:result.state,report_id:result.report_id,result:'result.json',
      artifacts:result.artifacts.length,elapsed_seconds:result.elapsed_seconds})+'\n');
  }catch(error){
    let message=String(error?.message||error);
    if(request?.locations?.operator_url){
      const url=request.locations.operator_url;message=message.split(url).join('[private operator session]');
      try{const token=new URLSearchParams(new URL(url).hash.slice(1)).get('token');if(token)message=message.split(token).join('[private operator session]');}catch{}
    }
    process.stderr.write(JSON.stringify({state:'failed',error:message})+'\n');process.exitCode=1;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
