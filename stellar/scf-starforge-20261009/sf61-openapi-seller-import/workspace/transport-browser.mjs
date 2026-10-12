// MIT. Environment-reference transport controls for the original merchant workspace.
const make=(tag,text,cls)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(cls)node.className=cls;
  return node;
};
const button=label=>{const node=make('button',label);node.type='button';return node;};
const field=(label,value='')=>{
  const element=make('label',label),input=make('input');
  input.value=value;input.autocomplete='off';input.spellcheck=false;element.append(input);
  return {element,input};
};
const select=(label,options,value)=>{
  const element=make('label',label),input=make('select');
  for(const [key,text] of options){const option=make('option',text);option.value=key;input.append(option);}
  input.value=value;element.append(input);return {element,input};
};
const modeLabel=profile=>profile?.mode==='environment-proxy'?'Proxy from '+profile.proxyEnv:'Direct connection';
export function transportLabel(profile) {
  if(!profile)return 'Direct connection';
  return (profile.profile?profile.profile+' · ':'')+modeLabel(profile);
}

/** Missing saved aliases remain selected until the operator explicitly replaces them. */
export function createTransportSelector({label='Backend transport profile',value,profiles,onChange,ariaLabel}) {
  const element=make('label',label),input=make('select'),hint=make('span','','hint');
  if(ariaLabel)input.setAttribute('aria-label',ariaLabel);
  element.append(input,hint);
  let selected=value??'';
  function refresh(){
    selected=input.options.length?input.value:selected;
    const available=profiles()??{};input.replaceChildren();
    const direct=make('option','Direct connection (default)');direct.value='';input.append(direct);
    for(const [alias,profile] of Object.entries(available)){
      const option=make('option',alias+' · '+modeLabel(profile));option.value=alias;input.append(option);
    }
    if(selected&&!Object.hasOwn(available,selected)){
      const missing=make('option',selected+' · saved profile needs configuration');missing.value=selected;input.append(missing);
    }
    input.value=selected;
    hint.textContent=selected&&!Object.hasOwn(available,selected)
      ?'Restore this named profile or choose the intended replacement before saving.'
      :selected&&available[selected].mode==='environment-proxy'
        ?'The receiving host supplies '+available[selected].proxyEnv+'. The package stores its variable name.'
        :'Use the original direct backend connection.';
  }
  function set(value){selected=value??'';input.replaceChildren();refresh();}
  input.addEventListener('change',()=>{selected=input.value;refresh();onChange?.(selected||undefined);});
  refresh();
  return {element,input,refresh,set,read:()=>input.value||undefined};
}

export function createTransportPanel({container,onChanged,onAssign,notice}) {
  const rows=[],selectors=new Set();
  let blocked=false;
  const list=make('div',undefined,'transport-profiles'),add=button('Add transport profile');
  const assignment=createTransportSelector({label:'Apply to selected routes',profiles:looseProfiles});
  assignment.input.setAttribute('aria-label','Transport profile for selected routes');
  const apply=button('Apply profile to selected routes');
  const actions=make('div',undefined,'inline');actions.append(add,assignment.element,apply);
  container.append(make('h2','Backend transport profiles'),
    make('p','Choose direct connections or a proxy supplied by the receiving host. Save profile names and environment-variable references with the API package.','muted'),
    make('p','Each named profile must be assigned to a selected route. Enter variable names here; configure their actual proxy URLs in the host launch environment.','hint'),
    list,actions);
  function looseProfiles(){
    return Object.fromEntries(rows.filter(row=>row.alias.value.trim()).map(row=>[row.alias.value.trim(),
      row.mode.value==='direct'?{mode:'direct'}:{mode:'environment-proxy',proxyEnv:row.environment.value.trim()}]));
  }
  function available(value=blocked){
    blocked=value;add.disabled=blocked||rows.length>=16;
    apply.disabled=blocked;assignment.input.disabled=blocked;
    for(const row of rows){
      row.alias.disabled=blocked;row.mode.disabled=blocked;row.environment.disabled=blocked||row.mode.value!=='environment-proxy';
      row.remove.disabled=blocked;row.environmentLabel.hidden=row.mode.value!=='environment-proxy';
    }
  }
  function changed(){
    for(const selection of selectors){
      if(selection.element.isConnected)selection.refresh();else selectors.delete(selection);
    }
    assignment.refresh();available();onChanged?.();
  }
  function append(alias,profile){
    const card=make('div',undefined,'transport-profile');
    const name=field('Profile name',alias),mode=select('Connection',[
      ['environment-proxy','Proxy from an environment variable'],['direct','Direct connection']],profile.mode);
    const environment=field('Proxy URL environment variable',profile.proxyEnv??'');
    name.input.maxLength=64;name.input.placeholder='merchant_proxy';environment.input.placeholder='MERCHANT_HTTPS_PROXY';
    const remove=button('Remove profile');remove.setAttribute('aria-label','Remove transport profile '+(alias||rows.length+1));
    const row={element:card,alias:name.input,mode:mode.input,environment:environment.input,environmentLabel:environment.element,remove};
    card.append(name.element,mode.element,environment.element,remove);rows.push(row);list.append(card);
    name.input.addEventListener('input',()=>{remove.setAttribute('aria-label','Remove transport profile '+name.input.value);changed();});
    mode.input.addEventListener('change',changed);environment.input.addEventListener('input',changed);
    remove.addEventListener('click',()=>{rows.splice(rows.indexOf(row),1);card.remove();changed();});
  }
  add.addEventListener('click',()=>{
    if(blocked||rows.length>=16)return;
    let number=1;while(rows.some(row=>row.alias.value.trim()==='transport'+number))number++;
    append('transport'+number,{mode:'environment-proxy'});changed();rows.at(-1).environment.focus();
  });
  apply.addEventListener('click',()=>{
    if(blocked)return;
    const count=onAssign?.(assignment.read())??0;
    notice?.(count+' selected route'+(count===1?'':'s')+' assigned to '+(assignment.read()??'the direct connection')+'.');
  });
  return {
    load(profiles={}){
      rows.splice(0);list.replaceChildren();
      for(const [alias,profile] of Object.entries(profiles))append(alias,profile);
      assignment.set(undefined);available();
    },
    read(){
      const profiles=Object.create(null);
      for(const row of rows){
        const alias=row.alias.value.trim();
        if(!alias)throw new Error('Enter a name for every backend transport profile');
        if(Object.hasOwn(profiles,alias))throw new Error('Use a distinct backend transport profile name: '+alias);
        profiles[alias]=row.mode.value==='direct'?{mode:'direct'}:{mode:'environment-proxy',proxyEnv:row.environment.value.trim()};
      }
      return profiles;
    },
    select(value,operation){
      const selection=createTransportSelector({value,profiles:looseProfiles,onChange:onChanged,
        ariaLabel:'Backend transport for '+operation.method+' '+operation.path});
      selectors.add(selection);return selection;
    },
    available
  };
}

export function appendTransportReview(container,review){
  const routes=review?.routes??[],named=routes.filter(route=>route.transport);
  if(!named.length){container.append(make('p','Backend transport: direct connections.','hint'));return;}
  const section=make('div',undefined,'transport-review');
  section.append(make('h3','Reviewed backend transports'));
  const table=make('table'),head=make('tr');for(const label of ['Operation','Profile','Receiving host'])head.append(make('th',label));
  const thead=make('thead'),body=make('tbody');thead.append(head);table.append(thead,body);
  for(const route of routes){
    const row=make('tr'),profile=route.transport;
    for(const text of [route.method+' '+route.path,profile?.profile??'Direct connection',
      profile?.mode==='environment-proxy'?'Proxy URL supplied by '+profile.proxyEnv:'Direct backend connection'])row.append(make('td',text));
    body.append(row);
  }
  const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('aria-label','Reviewed backend transport references');wrap.append(table);
  section.append(wrap,make('p','These are saved configuration references. The original launcher resolves the selected host variables when the seller starts.','hint'));
  container.append(section);
}

export function createTransportDelivery({container,api,act,notice}){
  let selected=null,blocked=false;
  const title=make('h3','Backend connection configuration'),summary=make('p','','hint');
  const download=button('Download original upstream configuration');
  container.append(title,summary,download);
  function available(value=blocked){blocked=value;download.disabled=blocked||!selected;}
  download.addEventListener('click',()=>act(async()=>{
    if(!selected)throw new Error('Save or reopen the original API package first');
    const name=selected.name,result=await api('transports/export?name='+encodeURIComponent(name));
    const bytes=new TextEncoder().encode(result.text);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(bytes.length!==result.bytes||hash!==result.sha256||result.filename!=='upstreams.json')
      throw new Error('Original upstream configuration changed while downloading. Reopen the saved package.');
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),link=make('a');
    link.href=url;link.download=name+'-upstreams.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice('Downloaded the original backend configuration for '+name+'.');
  }));
  return {available,clear(){selected=null;container.hidden=true;available();},select(name,preview){
    selected={name};container.hidden=false;
    const profiles=preview?.transports??[];
    summary.textContent=name+' · '+(profiles.length?profiles.map(transportLabel).join('; '):'Direct backend connections')+
      '. The download retains the original backend declarations and environment references.';
    available();
  }};
}

export function renderTransportRuntime(container,bindings=[]){
  container.replaceChildren();
  if(!bindings.length)return;
  container.append(make('h3','Active backend transports'));
  for(const row of bindings)container.append(make('p',row.method+' '+row.path+' · '+
    transportLabel(row.profile?row:undefined),'small wrap'));
}
