/** Four-card recipient orientation. It never invokes scientific actions or navigation. */
export const STARTUP_GUIDE_SCHEMA = 'upstate.operator-startup-guide/v1';
export const startupCards = Object.freeze([
  {id:'workspace', selector:'#workspace-select', label:'Workspace', title:'Open the right workspace',
   text:'Choose the workspace you were given. Its retained sources, studies and results stay together. Changing workspace opens a different working project.'},
  {id:'science', selector:'.sidebar [data-view="sources"]', label:'Original sources', title:'Follow the scientific workflow',
   text:'Start with Original sources. The nearby desks keep model grids, parameter profiles and land-cover scenarios separate, so you can inspect the inputs and assumptions behind each run.'},
  {id:'operations', selector:'.top-actions [data-action="tasks"]', label:'Operations', title:'See what is running',
   text:'Operations shows saved tasks, progress and logs. Open an existing task to inspect its outcome or continue available work. A calculation starts only when you choose its own run control.'},
  {id:'handover', selector:'.sidebar [data-action="backup"]', label:'Back up workspace', title:'Keep and share the working project',
   text:'Back up workspace saves the complete editable project and application, including retained sources, results and saved view notes. Use Maps and delivery for selected reports and maps.'}
]);

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
export function startupScope(snapshot, person) {
  const workspace = snapshot?.workspace_key, project = snapshot?.data?.project?.id, operator = person?.id;
  if (![workspace, project, operator].every(validId)) return null;
  return [operator, workspace, project];
}
export function startupStorageKey(scope) {
  return 'upstate:startup-guide:v1:' + scope.map(encodeURIComponent).join(':');
}
export function readStartupProgress(raw, scope) {
  if (raw === null) return {progress:{schema:STARTUP_GUIDE_SCHEMA,scope:[...scope],step:0,status:'active'}, writable:true};
  try {
    const record = JSON.parse(raw);
    if (record?.schema === STARTUP_GUIDE_SCHEMA && JSON.stringify(record.scope) === JSON.stringify(scope) &&
        Number.isInteger(record.step) && record.step >= 0 && record.step < startupCards.length &&
        ['active','paused','complete'].includes(record.status)) return {progress:record,writable:true};
  } catch {}
  // A future version, malformed record or somebody else's state is never replaced.
  return {progress:{schema:STARTUP_GUIDE_SCHEMA,scope:[...scope],step:0,status:'paused'},writable:false};
}

/** Pure placement used for the real viewport; a missing/clipped control gets no false pointer. */
export function startupPlacement(target, card, viewport) {
  const margin=12, gap=16, width=Math.min(card.width,Math.max(0,viewport.width-2*margin));
  const height=Math.min(card.height,Math.max(0,viewport.height-2*margin));
  const bound=(value,low,high)=>Math.max(low,Math.min(value,Math.max(low,high)));
  let x=viewport.left+viewport.width-width-margin, y=viewport.top+margin;
  if(target){
    const below=viewport.top+viewport.height-margin-target.bottom-gap;
    const above=target.top-gap-(viewport.top+margin);
    const right=viewport.left+viewport.width-margin-target.right-gap;
    const left=target.left-gap-(viewport.left+margin);
    if(right>=width){x=target.right+gap;y=target.top;}
    else if(left>=width){x=target.left-gap-width;y=target.top;}
    else if(below>=height){x=target.left;y=target.bottom+gap;}
    else if(above>=height){x=target.left;y=target.top-gap-height;}
    else {x=target.left;y=below>=above?target.bottom+gap:target.top-gap-height;}
  }
  x=bound(x,viewport.left+margin,viewport.left+viewport.width-width-margin);
  y=bound(y,viewport.top+margin,viewport.top+viewport.height-height-margin);
  const overlap=target&&x<target.right&&x+width>target.left&&y<target.bottom&&y+height>target.top;
  return {left:x,top:y,width,height,point:!!target&&!overlap};
}

export function attachStartupGuide({document:doc=globalThis.document,window:win=globalThis.window}={}) {
  const trigger=doc.getElementById('startup-guide-open');
  if(!trigger)return {observe(){},suspend(){},destroy(){}};
  let currentKey=null,scope=null,progress=null,writable=true,frame=0,disposed=false,lastFocus=null;
  const memory=new Map();
  const panel=doc.createElement('section');
  panel.id='startup-guide-card';panel.className='startup-guide';panel.hidden=true;
  panel.setAttribute('role','region');panel.setAttribute('aria-labelledby','startup-guide-title');
  panel.innerHTML='<header class="startup-guide-header"><span data-startup-count></span><button type="button" data-startup="pause" aria-label="Dismiss quick guide for now">Not now</button></header><h2 id="startup-guide-title" tabindex="-1"></h2><p data-startup-copy></p><p class="startup-guide-target" data-startup-target></p><footer><button type="button" data-startup="show">Show control</button><span class="startup-guide-pager"><button type="button" data-startup="back">Back</button><button type="button" data-startup="next">Next</button></span></footer>';
  const outline=doc.createElement('div');outline.className='startup-guide-outline';outline.hidden=true;outline.setAttribute('aria-hidden','true');
  const connector=doc.createElement('div');connector.className='startup-guide-connector';connector.setAttribute('aria-hidden','true');connector.hidden=true;
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),line=doc.createElementNS('http://www.w3.org/2000/svg','path');svg.append(line);connector.append(svg);
  const announce=doc.createElement('div');announce.className='startup-guide-sr';announce.setAttribute('aria-live','polite');announce.setAttribute('aria-atomic','true');
  doc.body.append(outline,connector,panel,announce);
  const title=panel.querySelector('h2'),copy=panel.querySelector('[data-startup-copy]'),targetNote=panel.querySelector('[data-startup-target]');
  const back=panel.querySelector('[data-startup="back"]'),next=panel.querySelector('[data-startup="next"]'),show=panel.querySelector('[data-startup="show"]');
  trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');trigger.disabled=true;

  function hiddenByWork() {
    return !!doc.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([hidden])') ||
      (doc.getElementById('task-panel') && !doc.getElementById('task-panel').hidden) ||
      !!doc.activeElement?.closest('#content input, #content textarea, #content select, [contenteditable="true"]');
  }
  function hide() {panel.hidden=true;outline.hidden=true;connector.hidden=true;trigger.setAttribute('aria-expanded','false');}
  function viewport() {
    const v=win.visualViewport;
    return {left:v?.offsetLeft||0,top:v?.offsetTop||0,width:v?.width||win.innerWidth,height:v?.height||win.innerHeight};
  }
  function visibleBox(element,v) {
    if(!element?.isConnected||element.hidden||!element.getClientRects().length)return null;
    const style=win.getComputedStyle(element);
    if(style.visibility==='hidden'||style.display==='none')return null;
    const raw=element.getBoundingClientRect();let left=Math.max(raw.left,v.left),top=Math.max(raw.top,v.top),right=Math.min(raw.right,v.left+v.width),bottom=Math.min(raw.bottom,v.top+v.height);
    for(let parent=element.parentElement;parent&&parent!==doc.body;parent=parent.parentElement){
      const css=win.getComputedStyle(parent),r=parent.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}
      if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}
    }
    return right-left>=24&&bottom-top>=18?{left,top,right,bottom,width:right-left,height:bottom-top}:null;
  }
  function updateTrigger() {
    trigger.disabled=!currentKey;
    trigger.textContent=progress?.status==='paused'?'Resume guide':progress?.status==='complete'?'Replay guide':'Quick guide';
  }
  function save() {
    if(!currentKey||!progress)return;
    memory.set(currentKey,{progress:{...progress,scope:[...scope]},writable});
    if(!writable)return;
    try {
      const existing=win.localStorage.getItem(currentKey);
      if(existing!==null&&!readStartupProgress(existing,scope).writable){writable=false;memory.set(currentKey,{progress:{...progress,scope:[...scope]},writable:false});return;}
      win.localStorage.setItem(currentKey,JSON.stringify(progress));
    } catch { /* The in-memory choice remains usable when browser storage is unavailable. */ }
  }
  function schedule() {
    if(disposed||frame)return;
    frame=win.requestAnimationFrame(()=>{frame=0;position();});
  }
  function position() {
    if(!currentKey||!progress||progress.status!=='active'||hiddenByWork()){hide();return;}
    const card=startupCards[progress.step],element=doc.querySelector(card.selector),v=viewport();
    if(v.width<220||v.height<180){hide();return;}
    const rect=visibleBox(element,v);
    show.disabled=!element||element.disabled;
    targetNote.textContent=rect?'Control: '+card.label:card.label+' is outside the visible area. Show control brings it into view.';
    panel.hidden=false;panel.style.width=Math.min(348,v.width-24)+'px';panel.style.maxHeight=Math.max(0,v.height-24)+'px';
    const measured=panel.getBoundingClientRect(),placed=startupPlacement(rect,{width:measured.width,height:measured.height},v);
    panel.style.left=placed.left+'px';panel.style.top=placed.top+'px';
    trigger.setAttribute('aria-expanded','true');
    outline.hidden=!rect||!placed.point;connector.hidden=!rect||!placed.point;
    if(rect&&placed.point){
      outline.style.left=(rect.left-3)+'px';outline.style.top=(rect.top-3)+'px';
      outline.style.width=(rect.width+6)+'px';outline.style.height=(rect.height+6)+'px';
      const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
      const px=Math.max(placed.left,Math.min(cx,placed.left+placed.width)),py=Math.max(placed.top,Math.min(cy,placed.top+placed.height));
      svg.setAttribute('viewBox','0 0 '+win.innerWidth+' '+win.innerHeight);
      line.setAttribute('d','M '+px+' '+py+' L '+cx+' '+cy);
    }
  }
  function render({focus=false,announceStep=false}={}) {
    updateTrigger();
    if(!progress){hide();return;}
    const card=startupCards[progress.step];
    panel.querySelector('[data-startup-count]').textContent=(progress.step+1)+' of '+startupCards.length;
    title.textContent=card.title;copy.textContent=card.text;
    back.disabled=progress.step===0;next.textContent=progress.step===startupCards.length-1?'Done':'Next';
    if(announceStep&&progress.status==='active')announce.textContent='Quick guide, '+(progress.step+1)+' of '+startupCards.length+'. '+card.title;
    position();
    if(focus&&!panel.hidden)title.focus({preventScroll:true});
  }
  function pause(complete=false) {
    const restore=panel.contains(doc.activeElement);
    progress={...progress,status:complete?'complete':'paused'};save();render();
    if(restore)(lastFocus?.isConnected&&!lastFocus.disabled?lastFocus:trigger).focus({preventScroll:true});
  }
  function open() {
    if(!currentKey||hiddenByWork())return;
    lastFocus=doc.activeElement;progress={...progress,status:'active',step:progress.status==='complete'?0:progress.step};
    save();render({focus:true,announceStep:true});
  }
  function click(event) {
    const button=event.target.closest('[data-startup]');if(!button||button.disabled||!currentKey)return;
    const action=button.dataset.startup;
    if(action==='pause')pause();
    if(action==='back'||action==='next'){
      if(action==='next'&&progress.step===startupCards.length-1){pause(true);return;}
      progress={...progress,step:progress.step+(action==='next'?1:-1)};save();render({focus:true,announceStep:true});
    }
    if(action==='show'){
      const target=doc.querySelector(startupCards[progress.step].selector);
      if(target&&!target.disabled){target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});target.focus({preventScroll:true});schedule();}
    }
  }
  function keydown(event) {
    if(event.key==='Escape'&&!panel.hidden&&panel.contains(doc.activeElement)){
      event.preventDefault();event.stopPropagation();pause();
    }
  }
  function observe(snapshot,person) {
    const incoming=startupScope(snapshot,person);
    if(!incoming){suspend();return;}
    const key=startupStorageKey(incoming);
    if(key===currentKey){schedule();return;}
    hide();scope=incoming;currentKey=key;lastFocus=null;
    let value=memory.get(key);
    if(!value){let raw=null;try{raw=win.localStorage.getItem(key);}catch{}value=readStartupProgress(raw,scope);}
    progress={...value.progress,scope:[...scope]};writable=value.writable;
    memory.set(key,{progress,writable});render({announceStep:progress.status==='active'});
  }
  function suspend() {hide();currentKey=null;scope=null;progress=null;lastFocus=null;updateTrigger();}
  function onStorage(event) {
    if(!currentKey||!scope||event.key!==currentKey)return;
    const value=readStartupProgress(event.newValue,scope);
    if(!value.writable){writable=false;progress={...progress,status:'paused'};memory.set(currentKey,{progress,writable});render();return;}
    progress=value.progress;writable=true;memory.set(currentKey,value);render();
  }
  trigger.addEventListener('click',open);panel.addEventListener('click',click);panel.addEventListener('keydown',keydown);
  win.addEventListener('resize',schedule);win.addEventListener('scroll',schedule,true);win.addEventListener('storage',onStorage);
  win.visualViewport?.addEventListener('resize',schedule);win.visualViewport?.addEventListener('scroll',schedule);
  doc.addEventListener('focusin',schedule);doc.addEventListener('focusout',schedule);
  const observer=new win.MutationObserver(records=>{if(records.some(record=>![panel,outline,connector].includes(record.target)&&!panel.contains(record.target)))schedule();});
  observer.observe(doc.body,{subtree:true,attributes:true,attributeFilter:['open','hidden','aria-modal']});
  return {observe,suspend,destroy(){
    disposed=true;if(frame)win.cancelAnimationFrame(frame);observer.disconnect();
    trigger.removeEventListener('click',open);panel.removeEventListener('click',click);panel.removeEventListener('keydown',keydown);
    win.removeEventListener('resize',schedule);win.removeEventListener('scroll',schedule,true);win.removeEventListener('storage',onStorage);
    win.visualViewport?.removeEventListener('resize',schedule);win.visualViewport?.removeEventListener('scroll',schedule);
    doc.removeEventListener('focusin',schedule);doc.removeEventListener('focusout',schedule);
    panel.remove();outline.remove();connector.remove();announce.remove();
  }};
}
