// MIT. Durable POST configuration and ticket files in the existing API workspace.
export function createOperationSettings({ make, field }, previous, method) {
  if (method !== 'POST') return null;
  const policy = previous?.idempotency;
  const element = make('details'), title = make('summary','Durable POST operations');
  const fields = make('div',undefined,'fields'), label = make('label',undefined,'check wide');
  const enabled = make('input'); enabled.type = 'checkbox'; enabled.checked = Boolean(policy);
  label.append(enabled,document.createTextNode(' Require a merchant-issued operation ticket for this POST'));
  const controls = {
    scope: field('Stable merchant operation scope',policy?.scope ?? ''),
    stateDir: field('Private operation state directory',policy?.stateDir ?? ''),
    keyEnv: field('Operation key environment variable',policy?.keyEnv ?? 'MERCHANT_OPERATION_KEY'),
    requestHeader: field('Buyer ticket header',policy?.requestHeader ?? 'x-merchant-operation'),
    backendHeader: field('Backend operation-key header',policy?.backendHeader ?? 'idempotency-key'),
    maxEntries: field('Maximum stored operations',policy?.maxEntries ?? 10000,'number'),
    maxStoredBytes: field('Stored response budget, bytes',policy?.maxStoredBytes ?? 268435456,'number'),
    maxTicketSeconds: field('Maximum ticket lifetime, seconds',policy?.maxTicketSeconds ?? 86400,'number'),
    waitMs: field('Duplicate request wait, milliseconds',policy?.waitMs ?? 15000,'number'),
  };
  controls.stateDir.container.className = 'wide';
  controls.scope.input.placeholder = 'merchant-orders-v1';
  controls.stateDir.input.placeholder = '/private/merchant/orders';
  for (const key of ['maxEntries','maxStoredBytes','maxTicketSeconds','waitMs']) controls[key].input.min = '1';
  fields.append(label,...Object.values(controls).map(control=>control.container),
    make('p','The workspace creates a missing private state directory at launch. Preserve its path and the operation scope across restarts and releases.','hint wide'),
    make('p','Set a 32-byte hexadecimal operation key in the named environment variable before starting this workspace. This form stores only the variable name.','hint wide'));
  element.append(title,fields);
  let routeEnabled = false;
  function setEnabled(value) {
    routeEnabled = value; enabled.disabled = !value;
    for (const control of Object.values(controls)) control.input.disabled = !value || !enabled.checked;
  }
  enabled.addEventListener('change',()=>setEnabled(routeEnabled));
  function read() {
    if (!enabled.checked) return undefined;
    return { ...(policy?.admission ? {admission:policy.admission} : {}),
      ...Object.fromEntries(Object.entries(controls).map(([key,control])=>[key,
        control.input.type === 'number' ? Number(control.input.value) : control.input.value.trim()])) };
  }
  return { element,setEnabled,read };
}

export function createOperationPanel({ container, make, field, api, act, notice }) {
  let runtimeId;
  function render(runtime) {
    if (runtime.state !== 'RUNNING' || !runtime.operationBindings?.length) {
      runtimeId = undefined; container.replaceChildren(); return;
    }
    // Cache/status refreshes preserve an operator's unfinished request form.
    if (runtime.runtimeId === runtimeId) return;
    runtimeId = runtime.runtimeId;
    const captured = runtimeId, bindings = runtime.operationBindings;
    const heading = make('h3','Durable POST operations'), fields = make('div',undefined,'fields');
    const selectLabel = make('label','Operation'), select = make('select');
    for (const binding of bindings) { const option = make('option',binding.method+' '+binding.path); option.value=binding.binding; select.append(option); }
    selectLabel.append(select); selectLabel.className = 'wide';
    const scope = make('p',undefined,'hint wide');
    const operationId = field('Merchant operation ID','');
    const subject = field('Opaque customer reference','');
    const expiry = field('Ticket valid for, seconds','','number'); expiry.input.min='1';
    const requestLabel = make('label','Exact public request'), request = make('textarea');
    request.rows = 12; request.spellcheck = false; requestLabel.className = 'wide'; requestLabel.append(request);
    const result = make('div',undefined,'wide');
    const issue = make('button','Create private buyer ticket file'); issue.type = 'button';
    function selected() { return bindings.find(binding=>binding.binding===select.value); }
    function fill() {
      const binding = selected();
      scope.textContent = 'Scope: '+binding.scope+'. Buyer header: '+binding.requestHeader+'.';
      if (binding.forwardedHeaders?.length) scope.textContent += ' Forwarded request headers: '+binding.forwardedHeaders.join(', ')+'. Include the buyer’s exact values in the request below.';
      request.value = JSON.stringify(binding.request,null,2);
      expiry.input.value = String(Math.min(3600,binding.maxTicketSeconds)); expiry.input.max=String(binding.maxTicketSeconds);
      result.replaceChildren();
    }
    select.addEventListener('change',fill); fill();
    issue.addEventListener('click',()=>act(async()=>{
      const binding = selected();
      const issued = await api('operations/issue',{runtimeId:captured,binding:binding.binding,
        id:operationId.input.value.trim(),subject:subject.input.value.trim(),
        expiresAt:Date.now()+Number(expiry.input.value)*1000,request:JSON.parse(request.value)});
      result.replaceChildren(make('p','Private ticket file created. This does not execute or charge for the operation.','small'),
        make('p',issued.path,'hint'),make('p','Operation: '+issued.operationKey,'hint'),
        make('p','Request: '+issued.requestHash,'hint'),make('p','Expires: '+new Date(issued.expiresAt).toISOString(),'hint'));
      const command = make('pre',issued.reviewCommand,'wrap');
      result.append(make('p','The original buyer review is prepared with the exact request body, headers, merchant offer and private ticket. Review it on this host:','hint'),command,
        make('p','Body: '+issued.bodyPath,'hint'),make('p','Headers: '+issued.headersPath,'hint'),
        make('p','Offer: '+issued.offersPath,'hint'),
        make('p','Continue with the existing buyer workspace and inbox using this review config. Keep the same intent '+issued.intentId+' when resuming this operation.','hint'));
      const download = make('button','Download ticket for another host'); download.type = 'button';
      download.addEventListener('click',()=>act(async()=>{
        const document = await api('operations/download',{runtimeId:captured,fileId:issued.fileId});
        const url = URL.createObjectURL(new Blob([JSON.stringify(document,null,2)+'\n'],{type:'application/json'}));
        const link = make('a'); link.href=url; link.download=issued.filename;
        link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        notice('Ticket downloaded. On Linux or macOS run chmod 600 on that file before the original buyer imports it.');
      }));
      result.append(download,make('p','A browser cannot preserve the private file mode. Before importing a download on Linux or macOS, run:','hint'));
      const permission = make('pre','chmod 600 '+issued.filename,'wrap'); result.append(permission,
        make('p','When moving to another host, transfer the matching body, headers and offer files through your normal private channel. Use the original buyer --prepare with --body-file and --headers-file at those local paths; keep the ticket separate in --ticket-file.','hint'));
      notice('Created an exact operation ticket in the private merchant package.');
    }));
    fields.append(selectLabel,scope,operationId.container,subject.container,expiry.container,requestLabel,issue,result);
    container.replaceChildren(heading,
      make('p','The original merchant issuer binds this ticket to the selected route, request and expiry. Use the existing operations dashboard to inspect or recover executed operations.','small'),fields);
  }
  return { render };
}
