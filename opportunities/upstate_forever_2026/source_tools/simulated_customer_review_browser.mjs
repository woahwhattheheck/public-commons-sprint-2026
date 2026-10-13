// Copyright 2026 TokenJunkieLabs. Caller for the original retained review desks.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute,sep,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const IDS=['operation_id','original_review_id','response_id','planning_handback_id','revised_review_id','handback_id'];
const canonical=value=>JSON.stringify((function order(x){return Array.isArray(x)?x.map(order):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;})(value));
const equal=(a,b)=>canonical(a)===canonical(b);
const fail=message=>{throw Object.assign(new Error(message),{publicCode:'CUSTOMER_REVIEW_COURSE'});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await fs.readFile(path,'utf8'));
async function regular(root,name){
  if(typeof name!=='string'||!name||name.includes('\\')||isAbsolute(name)||name.split('/').some(x=>!x||x==='.'||x==='..'))fail('The retained customer member path differs.');
  let path=root;
  for(const part of name.split('/')){path=join(path,part);if((await fs.lstat(path)).isSymbolicLink())fail('The retained customer member is a symbolic link.');}
  if(!(await fs.stat(path)).isFile())fail('Select the complete original customer file.');
  return path;
}
async function exactMember(root,item){
  const path=await regular(root,item.path),body=await fs.readFile(path);
  if(body.length!==item.bytes||hash(body)!==item.sha256)fail('The original customer file changed: '+item.path);
  return {path,body};
}
function sourcePath(root,url){
  const parsed=new URL(url);
  if(parsed.protocol!=='file:')fail('The selected review link must retain its original local source.');
  const path=fileURLToPath(parsed),name=relative(root,path);
  if(!name||isAbsolute(name)||name==='..'||name.startsWith('..'+sep))fail('The selected link leaves its complete original customer case.');
  return path;
}
async function safeTarget(root,url){
  const path=sourcePath(root,url);
  await regular(root,relative(root,path).split(sep).join('/'));
  return path;
}
export async function runCustomerReviewChapter({page,choice,output,checkRunning,capture,checkpoint,progress,pause}){
  // The parent owns context/video/server lifecycle and cooperative interruption.
  // This module uses its existing page. It creates no review or handback records.
  checkRunning();
  const root=resolve(choice.directory),manifestFile=await exactMember(root,{path:'case-manifest.json',...choice.manifest});
  const manifest=JSON.parse(manifestFile.body.toString('utf8'));
  for(const key of ['project_id',...IDS])if(manifest[key]!==choice.selected[key])fail('The customer course differs from the selected '+key+'.');
  const selected=await json(await regular(root,'selection.json'));
  for(const [key,value]of Object.entries(selected))if(!equal(value,manifest[key]))fail('The original customer selection differs from its manifest.');
  const binding={manifest:choice.manifest,selected:choice.selected};
  const state=progress.customer_review||{schema:'upstate.simulated-customer-browser/v1',binding,started_at:new Date().toISOString(),phases:{},downloads:[],screenshots:[],actions:[]};
  if(!equal(state.binding,binding))fail('Resume the original customer case, including its six saved identities.');
  progress.customer_review=state;
  const save=async()=>{state.updated_at=new Date().toISOString();await checkpoint();};
  const action=async(name,fn)=>{
    checkRunning();const started=new Date().toISOString();
    try{const value=await fn();checkRunning();state.actions.push({name,state:'complete',started_at:started,completed_at:new Date().toISOString()});await save();return value;}
    catch(error){state.actions.push({name,state:'interrupted_or_incomplete',started_at:started,ended_at:new Date().toISOString(),error:String(error.message||error)});await save();throw error;}
  };
  const shot=async(label,meaning)=>{
    await page.evaluate(()=>document.fonts.ready);checkRunning();
    const member=await capture('customer-'+label,{customer_review:choice.selected,meaning});
    if(!state.screenshots.some(x=>x.path===member.path))state.screenshots.push(member);
    await save();return member;
  };
  const click=async locator=>{checkRunning();await locator.click();checkRunning();};
  const open=async path=>{checkRunning();await page.goto(pathToFileURL(path).href,{waitUntil:'load'});checkRunning();};
  const packet=async expected=>{
    await page.locator('#review-title').waitFor({state:'visible'});
    const value=await page.locator('#review-data').textContent().then(JSON.parse);
    if(value.review?.id!==expected||value.review?.project?.id!==choice.selected.project_id)fail('The rendered review belongs to a different original generation.');
    const fatal=page.locator('#fatal-error');if(await fatal.count()&&await fatal.isVisible())fail(await fatal.innerText());
    return value;
  };
  const tab=async name=>{await click(page.locator('#tab-'+name));await page.locator('#pane-'+name).waitFor({state:'visible'});};
  const download=async(label,trigger,validate)=>{
    checkRunning();const [item]=await Promise.all([page.waitForEvent('download',{timeout:30000}),trigger()]);checkRunning();
    const target=join(output,'downloads','customer-'+label+'-'+Date.now()+'.'+(label.includes('artifact')?'bin':'json'));
    await item.saveAs(target);
    const failure=await item.failure();if(failure)fail('The original customer download did not complete: '+failure);
    const body=await fs.readFile(target);if(!body.length)fail('The original customer download is empty.');
    await validate(body);
    const member={path:relative(output,target).split(sep).join('/'),bytes:body.length,sha256:hash(body),suggested_filename:item.suggestedFilename(),completed_at:new Date().toISOString()};
    state.downloads.push(member);await save();return member;
  };
  const originalPath=await regular(root,manifest.original_review.directory+'/index.html');
  const handbackPath=await regular(root,manifest.engineering_handback.directory+'/index.html');
  const handback=await json(await regular(root,manifest.engineering_handback.directory+'/handback.json'));
  const edition=handback.history?.at(-1);
  if(handback.handback_id!==choice.selected.handback_id||edition?.id!==choice.selected.handback_id||
     edition.review_id!==choice.selected.original_review_id||edition.response_id!==choice.selected.response_id||
     edition.revised_review_id!==choice.selected.revised_review_id||edition.state!=='ready')
    fail('The engineering desk is not the selected ready handback.');
  const revised=handback.reviews.find(item=>item.review_id===choice.selected.revised_review_id&&item.response_id===edition.revised_response_id);
  if(!revised)fail('The ready handback lacks its exact revised generation.');
  const revisedPath=await regular(root,manifest.engineering_handback.directory+'/'+revised.path+'/index.html');
  state.handback={id:edition.id,state:edition.state,revised_response_id:edition.revised_response_id,
    request_ids:edition.items.map(item=>item.request_id),dispositions:edition.items.map(item=>({request_id:item.request_id,disposition:item.disposition}))};
  await save();
  if(!state.phases.original){
    await action('open-original-customer-response',async()=>{
      await page.setViewportSize({width:1440,height:1000});await open(originalPath);
      const value=await packet(choice.selected.original_review_id);
      if(value.latest_response_id!==choice.selected.response_id)fail('The opened original desk does not carry the selected saved response.');
      await shot('original-overview-desktop','Original populated customer review and its retained scientific source selection.');
      await tab('history');
      const record=value.responses.find(row=>(row.id||row.response_id)===choice.selected.response_id);
      if(!record)fail('The original saved customer response is absent.');
      await click(page.locator('#history-list button').filter({hasText:choice.selected.response_id}));
      await shot('original-response-desktop','The saved customer request remains distinguishable from subsequent engineering dispositions.');
      await download('original-response-record',()=>click(page.getByRole('button',{name:'Download full record',exact:true})),
        body=>{if(!equal(JSON.parse(body.toString('utf8')),record))fail('The downloaded response record differs from the original saved response.');});
      await tab('files');
      const artifact=value.review.artifacts.find(row=>value.files.some(file=>file.artifact_id===row.id));
      if(!artifact)fail('The populated original review has no retained artifact.');
      await page.locator('#file-search').fill('NO_MATCH_'+choice.selected.operation_id);await page.locator('#files-empty').waitFor({state:'visible'});
      await shot('files-empty','The ordinary search shows its real empty state.');
      await page.locator('#file-search').fill('');
      await click(page.locator('[data-artifact-id="'+artifact.id+'"] button.file-link'));
      await click(page.locator('#file-detail summary').filter({hasText:'Source, file identity and meaning'}));
      await shot('original-file-source','Selected original file, physical file identity, and source metadata.');
      const file=value.files.find(row=>row.artifact_id===artifact.id);
      await download('original-artifact',()=>click(page.getByRole('link',{name:'Download file',exact:true})),body=>{
        if(body.length!==file.bytes||hash(body)!==file.sha256)fail('The browser artifact download differs from the retained original file.');
      });
      await tab('requirements');await shot('original-requirements','The original purpose and requirements remain attached to this review.');
      state.phases.original={state:'complete',completed_at:new Date().toISOString()};await save();
    });
  }
  if(!state.phases.draft){
    await action('save-and-reopen-explicit-teaching-draft',async()=>{
      await open(originalPath);await packet(choice.selected.original_review_id);await tab('history');
      await click(page.locator('#history-list button').filter({hasText:choice.selected.response_id}));
      await click(page.getByRole('button',{name:'Use as starting point',exact:true}));
      await page.locator('#pane-overview').waitFor({state:'visible'});
      await page.locator('#reviewer-name').fill('');
      await click(page.locator('#export-response'));
      await shot('draft-required-name','The existing response form displays its actual required reviewer-name error.');
      const name='SIMULATED teaching walkthrough';
      await page.locator('#reviewer-name').fill(name);
      const summary=page.locator('#reviewer-form textarea');
      const note='SIMULATED local teaching draft from the saved original response. Native review, customer response, and engineering handback identities remain the recorded source.';
      await summary.fill(note);await page.locator('#reviewer-name').blur();
      await page.waitForFunction(({project,review,name,note,parent})=>{
        const key='upstate.review-draft/v1:'+encodeURIComponent(project)+':'+encodeURIComponent(review);
        const saved=JSON.parse(localStorage.getItem(key)||'null');
        return saved?.response?.reviewer?.name===name&&saved.response.summary===note&&saved.response.previous_response_id===parent;
      },{project:choice.selected.project_id,review:choice.selected.original_review_id,name,note,parent:choice.selected.response_id});
      await open(originalPath);await packet(choice.selected.original_review_id);
      if(await page.locator('#reviewer-name').inputValue()!==name||await page.locator('#reviewer-form textarea').inputValue()!==note)
        fail('The ordinary local customer draft did not survive reopening.');
      await shot('draft-reopened','Explicitly simulated local draft reopened through the original customer desk; no native response was imported.');
      await download('simulated-local-draft',()=>click(page.locator('#export-response')),body=>{
        const result=JSON.parse(body.toString('utf8'));
        if(result.review_id!==choice.selected.original_review_id||result.project_id!==choice.selected.project_id||
           result.previous_response_id!==choice.selected.response_id||result.reviewer?.name!==name||result.summary!==note)
          fail('The downloaded local teaching draft lost its original parent response.');
      });
      state.phases.draft={state:'complete',completed_at:new Date().toISOString(),native_imported:false};await save();
    });
  }
  if(!state.phases.handback){
    await action('open-ready-handback-and-revised-work',async()=>{
      await open(handbackPath);await page.getByRole('heading',{name:'Engineering handback',exact:true}).waitFor({state:'visible'});
      if(!(await page.locator('body').innerText()).includes(choice.selected.handback_id))fail('The visible handback omits its selected engineering edition.');
      await shot('ready-handback-desktop','Ready engineering treatment of the original requests with links to the original and revised complete desks.');
      const revisedLink=page.getByRole('link',{name:'Revised review and replacement files',exact:true});
      if(resolve(await safeTarget(root,await revisedLink.getAttribute('href').then(href=>new URL(href,page.url()).href)))!==revisedPath)
        fail('The handback link names a different revised review.');
      await click(revisedLink);await packet(choice.selected.revised_review_id);
      await shot('revised-review-desktop','The exact revised review selected by the ready engineering edition.');
      await tab('files');await shot('revised-files-desktop','Revised retained files and their native source lineage.');
      await open(handbackPath);
      await click(page.getByRole('link',{name:'Original customer response and files',exact:true}));
      const original=await packet(choice.selected.original_review_id);
      if(original.latest_response_id!==choice.selected.response_id)fail('The engineering original-response link changed generation.');
      await tab('history');await shot('handback-original-response','The handback reopens the original customer response generation.');
      state.phases.handback={state:'complete',completed_at:new Date().toISOString()};await save();
    });
  }
  if(!state.phases.narrow){
    await action('inspect-original-and-revised-narrow-layouts',async()=>{
      await page.setViewportSize({width:390,height:844});
      for(const [name,path,id]of [['original',originalPath,choice.selected.original_review_id],['revised',revisedPath,choice.selected.revised_review_id]]){
        await open(path);await packet(id);await shot(name+'-overview-narrow','Actual populated 390-pixel customer review.');
        for(const panel of ['files','requirements','history']){await tab(panel);await shot(name+'-'+panel+'-narrow','Actual 390-pixel '+panel+' controls and retained contents.');}
      }
      await open(handbackPath);await shot('ready-handback-narrow','Actual ready engineering handback at 390 pixels, including the resolutions table and source links.');
      await page.setViewportSize({width:1440,height:1000});state.phases.narrow={state:'complete',completed_at:new Date().toISOString()};await save();
    });
  }
  // These real frames are also traversed on a retry whose earlier partial recording
  // was retained, so the completed original video still contains both generations.
  for(const [name,path]of [['original_review',originalPath],['ready_handback',handbackPath],['revised_review',revisedPath]]){
    await open(path);await pause(1400);
    state.actions.push({name:'recorded-frame-'+name,state:'displayed',displayed_at:new Date().toISOString()});
  }
  state.state='COMPLETE';state.completed_at=new Date().toISOString();await save();
  return {...state,files:[...state.downloads,...state.screenshots]};
}
