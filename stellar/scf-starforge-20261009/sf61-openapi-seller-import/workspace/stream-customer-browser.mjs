// MIT. Customer setup in the original merchant workspace; execution uses SF66.
export function createStreamCustomerPanel({container,make,field,selectField,api,act,notice}) {
  const activity=make('div',undefined,'runtime'),body=make('div');
  container.append(activity,body);
  let packageName=null,options=null,current=null,owned=null;
  const textField=(label,value,id)=>{const x=field(label,value);x.input.id=id;return x;};
  const numberField=(label,value,id,maximum)=>{
    const x=field(label,value,'number');x.input.id=id;x.input.min='1';
    if(maximum!==undefined)x.input.max=String(maximum);return x;
  };
  const jsonField=(label,value,id)=>{
    const labelElement=make('label',label),input=make('textarea');input.id=id;
    input.value=JSON.stringify(value,null,2);input.spellcheck=false;labelElement.append(input);
    return {container:labelElement,input};
  };
  const localLink=(label,url)=>{
    const parsed=new URL(url);
    if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1') throw new Error('Expected the original local customer console');
    const link=make('a',label);link.href=parsed.href;link.target='_blank';link.rel='noopener';return link;
  };
  const shell=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
  function renderRuntime(value) {
    owned=value??null;activity.replaceChildren();
    if(!owned)return;
    activity.append(make('p','Customer console: '+owned.packageName+' / '+owned.name),
      localLink('Open original customer console',owned.operatorUrl),
      make('p','Seller listener: '+owned.seller+' · Keep your HTTPS gateway pointed at this listener.','hint'));
    const close=make('button','Close customer console');close.type='button';close.id='stream-customer-close';
    close.addEventListener('click',()=>act(async()=>{
      const result=await api('customer/close',{packageName:owned.packageName,customerName:owned.name,configSha256:owned.configSha256});
      renderRuntime(result.customer);notice('Customer console closed. Its original purchase and retained output remain saved.');
    }));activity.append(close);
  }
  function clear() {
    packageName=null;options=null;current=null;
    body.replaceChildren(make('p','Save or reopen a merchant with a declared SSE or NDJSON route to prepare its customer session.','small'));
  }
  async function setPackage(name) {
    packageName=name;current=null;
    options=await api('customer/options?name='+encodeURIComponent(name));
    renderRuntime(options.customer);draw();
  }
  function draw() {
    body.replaceChildren();
    if(!options.routes.length) {
      body.append(make('p','This package has no streaming routes. Select a declared SSE or NDJSON response, then save a new package.','small'));return;
    }
    const form=make('div'),fields=make('div',undefined,'fields');
    const route=selectField('Stream route',options.routes.map(r=>[r.routeId,r.method+' '+r.url]),options.routes[0].routeId);
    route.input.id='stream-customer-route';route.container.className='wide';
    const name=textField('New customer name','stream-customer','stream-customer-name');
    const intent=textField('Purchase intent ID','stream-'+crypto.randomUUID(),'stream-customer-intent');
    const inputMode=selectField('Request source',[['json','Parameters and JSON body'],['bodyFile','Exact private body file'],['packet','Original private request packet']],'json');
    inputMode.input.id='stream-customer-input';
    const selectedInfo=make('p',undefined,'hint wide');selectedInfo.id='stream-customer-selected';
    const path=jsonField('Path parameters',{},'stream-customer-path');
    const query=jsonField('Query parameters',{},'stream-customer-query');
    const requestBody=jsonField('JSON request body',{},'stream-customer-body');
    const headers=jsonField('Ordinary request headers',{},'stream-customer-headers');
    const bodyFile=textField('Absolute private body file','','stream-customer-body-file');
    const packet=textField('Absolute original request packet','','stream-customer-packet');
    const omit=field('Omit an optional whole request body','','checkbox');omit.input.checked=false;
    omit.input.id='stream-customer-omit';omit.container.className='check wide';
    const facilitator=textField('Native facilitator configuration file','','stream-customer-facilitator');
    facilitator.container.className='wide';facilitator.input.placeholder='/private/native-facilitator.json';
    const payer=textField('Public buyer account','','stream-customer-payer');payer.container.className='wide';
    const actor=textField('Operator actor','merchant-operator','stream-customer-actor');
    const service=textField('Operator service',packageName,'stream-customer-service');
    const python=textField('Absolute Python executable','/usr/bin/python3','stream-customer-python');
    const signer=selectField('Buyer key source',[['secretEnv','Environment variable'],['signerProvider','Existing signer provider']],'secretEnv');
    signer.input.id='stream-customer-signer-source';
    const secret=textField('Buyer secret environment variable','STELLAR_BUYER_SECRET','stream-customer-secret-env');
    const provider=textField('Absolute signer provider configuration','','stream-customer-provider');
    const proxy=textField('HTTPS proxy environment variable, if used','','stream-customer-proxy');
    const port=numberField('Seller loopback port',options.sellerPort??0,'stream-customer-port',65535);port.input.min='0';
    port.container.append(make('span','Use the port routed by your HTTPS gateway. Zero assigns a new port.','hint'));
    const total=textField('Total budget, atomic units','','stream-customer-total');total.input.inputMode='numeric';
    const daily=textField('Daily budget, atomic units','','stream-customer-daily');daily.input.inputMode='numeric';
    const maximum=numberField('Maximum retained response bytes',67108864,'stream-customer-max-bytes');
    const deadline=numberField('Whole request deadline, milliseconds',120000,'stream-customer-request-timeout',300000);
    const bodyDeadline=numberField('Response capture deadline, milliseconds',120000,'stream-customer-response-timeout',300000);
    const recordBytes=numberField('Maximum record bytes',1048576,'stream-customer-record-bytes',67108864);
    const records=numberField('Maximum records',100000,'stream-customer-records',1000000);
    fields.append(route.container,selectedInfo,name.container,intent.container,inputMode.container,path.container,query.container,
      requestBody.container,bodyFile.container,packet.container,headers.container,omit.container,
      facilitator.container,payer.container,actor.container,service.container,python.container,signer.container,
      secret.container,provider.container,proxy.container,port.container,total.container,daily.container,
      maximum.container,deadline.container,bodyDeadline.container,recordBytes.container,records.container);
    const review=make('div');review.id='stream-customer-review';
    const save=make('button','Save customer review','primary');save.type='button';save.id='stream-customer-save';
    form.append(fields,make('p','Choose the payer and budget independently. The saved review shows the actual output destination and original merchant terms. Payment approval opens in the workspace terminal.','hint'),save);
    const retained=make('div');retained.id='stream-customer-retained';
    body.append(make('h3','New customer review'),form,review,retained);
    const selected=()=>options.routes.find(value=>value.routeId===route.input.value);
    function inputControls() {
      const r=selected(),isPacket=inputMode.input.value==='packet',isFile=inputMode.input.value==='bodyFile';
      const bodyMethod=['POST','PUT','PATCH'].includes(r.method);
      for(const value of [intent,path,query,headers]) {value.container.hidden=isPacket;value.input.disabled=isPacket;}
      requestBody.container.hidden=isPacket||isFile||!bodyMethod||omit.input.checked;
      bodyFile.container.hidden=isPacket||!isFile||!bodyMethod||omit.input.checked;
      packet.container.hidden=!isPacket;omit.container.hidden=isPacket||!bodyMethod||r.bodyRequired;
      omit.input.disabled=isPacket||!bodyMethod||r.bodyRequired;
      secret.container.hidden=signer.input.value!=='secretEnv';provider.container.hidden=signer.input.value!=='signerProvider';
    }
    function routeDefaults() {
      const r=selected();
      selectedInfo.textContent=r.format.toUpperCase()+' · '+r.mimeType+' · '+r.paymentFlow+' payment · '+
        r.terms.amount+' atomic units · '+r.terms.network+' · Request limit '+r.maxRequestBytes+' bytes';
      path.input.value=JSON.stringify(r.request.path,null,2);query.input.value=JSON.stringify(r.request.query,null,2);
      requestBody.input.value=JSON.stringify(r.request.body??{},null,2);omit.input.checked=false;
      maximum.input.value=r.response.maxBytes;deadline.input.value=r.response.requestTimeoutMs;
      bodyDeadline.input.value=r.response.timeoutMs;recordBytes.input.value=r.response.maxRecordBytes;records.input.value=r.response.maxRecords;
      if(r.bodyType==='form-data') inputMode.input.value='bodyFile';
      inputControls();
    }
    function reviewed(value) {
      current=value;review.replaceChildren(make('h3','Saved customer: '+value.name+' · '+value.state));
      const s=value.review,selection=s.selections[0],table=make('table'),tbody=make('tbody');
      const rows=[['Request',selection.method+' '+selection.url],['Intent',selection.intentId],
        ['Payment flow',selection.paymentFlow],['Price',selection.originalTerms.amount+' atomic units / '+selection.originalTerms.asset],
        ['Recipient',selection.originalTerms.payTo],['Public payer',s.payer],
        ['Shared budget','Total '+s.sharedBudget.totalAtomic+' · daily '+s.sharedBudget.dailyAtomic+' atomic units'],
        ['Request bytes',selection.bodyBytes+' · '+(selection.bodySha256??'No body')],
        ['Output destination',selection.responseFile.destination],
        ['Output limits',selection.responseFile.maxBytes+' bytes · '+selection.responseFile.timeoutMs+' ms capture'],
        ['Request deadline',selection.requestTimeoutMs+' ms'],['Configuration SHA-256',value.configSha256]];
      for(const [key,text] of rows){const row=make('tr');row.append(make('th',key),make('td',String(text)));tbody.append(row);}
      table.append(tbody);const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.append(table);review.append(wrap);
      const details=make('details'),source=make('pre',JSON.stringify(s,null,2),'wrap');
      details.append(make('summary','Original configuration details'),source);review.append(details);
      const actions=make('div',undefined,'inline'),prepare=make('button',value.state==='INITIALIZATION_PENDING'?'Resume native preparation':'Prepare customer workspace');
      prepare.type='button';prepare.id='stream-customer-prepare';prepare.disabled=value.state==='PREPARED';
      const open=make('button','Start original customer console');open.type='button';open.id='stream-customer-open';open.disabled=value.state!=='PREPARED';
      prepare.addEventListener('click',()=>act(async()=>{
        reviewed(await api('customer/prepare',{packageName,customerName:value.name,configSha256:value.configSha256}));
        notice('Original buyer workspace and commerce session prepared. Review and execute the retained intent in its console.');
      }));
      open.addEventListener('click',()=>act(async()=>{
        renderRuntime(await api('customer/open',{packageName,customerName:value.name,configSha256:value.configSha256}));
        notice('Original customer console is open. Its link and seller listener are shown above.');
      }));
      actions.append(prepare,open);review.append(actions,
        make('p','Starting the customer console closes this workspace’s separate preview seller for the same package. The saved customer session owns the merchant, original buyer approval, and retained stream output. Reopening uses the same purchase intent.','hint'));
      const commands=make('details');commands.append(make('summary','Use the same saved session from a terminal'),
        make('pre',Object.entries(value.commands).map(([label,args])=>label+':\n'+args.map(shell).join(' ')).join('\n\n'),'wrap'));
      review.append(commands);
    }
    function savedCustomers() {
      retained.replaceChildren(make('h3','Retained customer sessions'));
      for(const customer of options.customers) {
        const button=make('button',customer.name+' · '+customer.state);button.type='button';
        button.disabled=customer.state==='UNAVAILABLE';
        button.addEventListener('click',()=>act(async()=>{
          reviewed(await api('customer/load?name='+encodeURIComponent(packageName)+'&customer='+encodeURIComponent(customer.name)));
          notice('Reopened the same customer configuration and purchase intent.');
        }));retained.append(button);
        if(customer.error)retained.append(make('p',customer.name+': '+customer.error,'hint'));
      }
      if(!options.customers.length)retained.append(make('p','Customer reviews and prepared sessions appear here after saving.','small'));
    }
    save.addEventListener('click',()=>act(async()=>{
      let request;
      if(inputMode.input.value==='packet') request={requestFile:packet.input.value.trim()};
      else {
        const ordinary=JSON.parse(headers.input.value);
        request={intentId:intent.input.value.trim(),path:JSON.parse(path.input.value),query:JSON.parse(query.input.value),
          ...(Object.keys(ordinary).length?{headers:ordinary}:{})};
        if(['POST','PUT','PATCH'].includes(selected().method)&&!omit.input.checked) {
          if(inputMode.input.value==='bodyFile') request.bodyFile=bodyFile.input.value.trim();
          else request.body=JSON.parse(requestBody.input.value);
        }
      }
      const operator={payer:payer.input.value.trim(),actor:actor.input.value.trim(),service:service.input.value.trim(),
        python:python.input.value.trim(),totalAtomic:total.input.value.trim(),dailyAtomic:daily.input.value.trim(),
        ...(signer.input.value==='secretEnv'?{secretEnv:secret.input.value.trim()}:{signerProvider:provider.input.value.trim()}),
        ...(proxy.input.value.trim()?{httpsProxyEnv:proxy.input.value.trim()}:{})};
      const result=await api('customer/create',{packageName,customer:{name:name.input.value.trim(),routeId:route.input.value,
        operator,facilitatorConfig:facilitator.input.value.trim(),sellerPort:Number(port.input.value),request,
        response:{maxBytes:Number(maximum.input.value),timeoutMs:Number(bodyDeadline.input.value),
          requestTimeoutMs:Number(deadline.input.value),maxRecordBytes:Number(recordBytes.input.value),maxRecords:Number(records.input.value)}}});
      reviewed(result);options=await api('customer/options?name='+encodeURIComponent(packageName));savedCustomers();
      notice('Customer inputs saved. Review the exact terms, budget, request and output destination before preparing the workspace.');
    }));
    form.addEventListener('input',()=>{current=null;review.replaceChildren();});
    route.input.addEventListener('change',routeDefaults);inputMode.input.addEventListener('change',inputControls);
    omit.input.addEventListener('change',inputControls);signer.input.addEventListener('change',inputControls);
    routeDefaults();savedCustomers();
  }
  clear();
  return {clear,setPackage,renderRuntime};
}
