// MIT. SensorThings Operations Desk over the original workspace API.
import {createDeskClient} from './api.mjs';
import {h,button,detail,note,field,form,busy} from './ui.mjs';
import {renderSection} from './views.mjs';
const main=document.querySelector('#main'),notice=document.querySelector('#notice'),pendingHost=document.querySelector('#pending'),nav=document.querySelector('#navigation'),identity=document.querySelector('#identity'),session=document.querySelector('#session'),refresh=document.querySelector('#refresh'),dialog=document.querySelector('#record-dialog'),dialogBody=document.querySelector('#record-body');
const tabs=[['sources','Sources & selection'],['captures','Capture & continuation'],['editions','Editions & review'],['publish','Publish & receive'],['delivery','Delivery & receiving'],['history','History & recovery']];
const ctx={client:null,tab:'sources',selected:{},streams:new Map(),editionReviews:new Map(),buyerReviews:new Map(),operator:'',schema:null,uploaded:null};
ctx.error=error=>notice.replaceChildren(note((error.code?error.code+': ':'')+error.message,'error'));
ctx.showNode=(title,node)=>{document.querySelector('#record-title').textContent=title;dialogBody.replaceChildren(node);if(!dialog.open)dialog.showModal();};
ctx.show=(title,value)=>ctx.showNode(title,detail(title,value,true));
ctx.closeDialog=()=>dialog.close();
document.querySelector('#record-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
ctx.render=()=>{if(!ctx.client?.view)return;for(const b of nav.querySelectorAll('button')){if(b.dataset.tab===ctx.tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}main.replaceChildren(renderSection(ctx));};
ctx.action=async(action,payload)=>{
  const result=await ctx.client.act(action,payload);
  notice.replaceChildren(note((result.state==='RUNNING'?'Original operation running: ':'Original operation completed: ')+action+' · '+result.operationId,'success'),button('Open result',()=>ctx.show(action,result)));
  ctx.render();return result;
};
function renderPending(){
  const p=ctx.client.pending;if(!p){pendingHost.replaceChildren();return;}
  const title=h('h2',{},'Saved request · '+p.body.action),explanation=note('Operation '+p.body.operationId+' · submitted revision '+p.body.expectedRevision+' · '+p.state+'. Its exact request stays in this browser until the original outcome is reconciled.');
  const resultNode=h('div'),perform=async fn=>{const r=await fn();resultNode.replaceChildren(detail('Original reconciliation result',r,true));ctx.render();return r;};
  const row=h('div',{class:'row'},
    button('Inspect original outcome',busy(()=>perform(()=>ctx.client.reconcile()),ctx.error)),
    button('Replay exact request',busy(()=>perform(()=>ctx.client.replay()),ctx.error)),
    button('Review latest revision and replay',busy(async()=>{if(!confirm('If this exact original operation is still unobserved, retain the same action/payload and rebind it to the displayed current workspace revision?'))return;return perform(()=>ctx.client.replay({reviewLatestRevision:true}));},ctx.error)),
    button('Keep ended request in history',busy(async()=>{if(!confirm('Keep this confirmed failed operation or ended, unobserved validation response in local history and clear its browser slot?'))return;await ctx.client.dismissFailed();ctx.render();},ctx.error)),
    button('Review saved payload',()=>ctx.show('Exact saved native request',p)));
  pendingHost.replaceChildren(title,explanation,p.lastError?note(p.lastError.message,'error'):null,row,resultNode);
}
async function connect(token){
  session.replaceChildren();notice.replaceChildren(note('Opening the original workspace…'));
  try{
    const client=createDeskClient(token),opened=await client.open();ctx.client=client;ctx.schema=opened.schema;
    identity.textContent='Workspace '+opened.view.workspaceId+' · revision '+opened.view.revision;
    client.subscribe(({view})=>{if(view)identity.textContent='Workspace '+view.workspaceId+' · revision '+view.revision;renderPending();});
    nav.replaceChildren(...tabs.map(([id,label])=>{const b=button(label,()=>{ctx.tab=id;ctx.render();});b.dataset.tab=id;return b;}));
    if(opened.schema.analysis&&opened.schema.actions?.['analysis.create'])nav.append(button('Analysis & reports',busy(()=>client.openAnalysis(),ctx.error)));
    refresh.disabled=false;refresh.onclick=busy(async()=>{await client.refresh();ctx.render();notice.replaceChildren(note('Original workspace refreshed.','success'));},ctx.error);
    notice.replaceChildren();renderPending();ctx.render();
  }catch(error){ctx.error(error);login();}
}
function login(){
  session.replaceChildren(form('Open private workspace',[field('Private session token','token',{type:'password',required:true,help:'Use the token from the installed application’s original Start/Open link.'})],async x=>{await connect(x.token);},{label:'Open workspace'}));
}
const token=location.hash.slice(1);if(token){history.replaceState(null,'',location.pathname+location.search);void connect(token);}else login();
