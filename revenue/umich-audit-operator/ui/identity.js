"use strict";
window.CommonsInstitutionalAccess = (() => {
  const q = (s, root=document) => root.querySelector(s);
  const qa = (s, root=document) => [...root.querySelectorAll(s)];
  const e = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const label = value => String(value ?? "").replaceAll("_"," ").replace(/\b[a-z]/g,c=>c.toUpperCase());
  const pretty = value => JSON.stringify(value, null, 2);
  const lines = value => String(value ?? "").split(/[\r\n,]+/).map(v=>v.trim()).filter(Boolean);
  const words = value => String(value ?? "").split(/[\s,]+/).filter(Boolean);
  const when = value => value ? String(value).replace("T"," ").replace(/\.\d+(?=Z|[+-])/,"").replace("+00:00"," UTC").replace("Z"," UTC") : "To record";
  const isExpired = value => Boolean(value && Date.parse(value) <= Date.now());
  const item = (id, array) => array.find(r=>r.id===id);
  const button = (text, action, id="", more="") => '<button type="button" data-identity-action="'+e(action)+'" data-id="'+e(id)+'" '+more+'>'+e(text)+'</button>';
  const badge = value => '<span class="ip-badge">'+e(value)+'</span>';
  const code = value => '<span class="ip-code">'+e(value)+'</span>';
  const cell = value => e(value || "—");
  const table = (heads, rows, id="") => '<div class="ip-table-wrap" tabindex="0" aria-label="Scrollable operating table"><table '+(id?'id="'+e(id)+'"':"")+'><thead><tr>'+heads.map(h=>'<th scope="col">'+e(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>';
  const row = (values, filter="", id="") => '<tr data-filter="'+e(filter.toLowerCase())+'" '+(id?'data-row-id="'+e(id)+'"':"")+'>'+values.map(v=>"<td>"+v+"</td>").join("")+"</tr>";
  const empty = text => '<p class="ip-empty">'+e(text)+'</p>';
  const input = (id, value="", type="text", attributes="") => '<input id="'+e(id)+'" name="'+e(id)+'" type="'+e(type)+'" value="'+e(value)+'" '+attributes+'>';
  const area = (id, value="", attributes="") => '<textarea id="'+e(id)+'" name="'+e(id)+'" '+attributes+'>'+e(value)+'</textarea>';
  const field = (name, id, control, hint="") => '<div class="field"><label for="'+e(id)+'">'+e(name)+'</label>'+control+(hint?'<small>'+e(hint)+'</small>':"")+'</div>';
  const select = (id, options, value, attributes="") => '<select id="'+e(id)+'" name="'+e(id)+'" '+attributes+'>'+options.map(([v,n])=>'<option value="'+e(v)+'"'+(v===value?" selected":"")+'>'+e(n)+'</option>').join("")+'</select>';
  const check = (id, text, checked, value="1") => '<label class="check"><input type="checkbox" id="'+e(id)+'" name="'+e(id)+'" value="'+e(value)+'"'+(checked?" checked":"")+'> <span>'+e(text)+'</span></label>';
  const stampInput = value => value ? new Date(value).toISOString().slice(0,16) : "";
  const stamp = value => value ? new Date(value+"Z").toISOString() : null;
  const defaultDate = days => new Date(Date.now()+days*86400000).toISOString().slice(0,16);
  const download = (filename, value) => {const url=URL.createObjectURL(new Blob([typeof value==="string"?value:pretty(value)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  let ctx, data, section="overview", requestGeneration=0, contract=null, sessionAccount=null;
  const providerLabel = id => data.provider_options.find(p=>p.id===id)?.label || id;
  const providerStatus = r => !r.payload.enabled ? "Closed" : r.payload.activation_epoch!==data.identity_epoch ? "Receiving review" : "Active";
  const caps = () => data.capabilities;
  const canManage = () => caps().can_administer;
  const current = () => ctx && (!ctx.isCurrent || ctx.isCurrent());

  function tabs() {
    const values=[["overview","Desk"],["accounts","Accounts"],["sessions","Sessions"],["source","Source & receiving"]];
    if(caps().owner) values.splice(1,0,["providers","Providers"],["mappings","Claim mappings"]);
    if(canManage()) values.splice(values.findIndex(v=>v[0]==="sessions"),0,["delegations","Delegated administration"]);
    if(caps().owner) values.splice(values.findIndex(v=>v[0]==="source"),0,["reviews","Access reviews"]);
    if(!values.some(v=>v[0]===section))section="overview";
    return values;
  }
  function shell() {
    const nav=tabs();
    ctx.root.innerHTML='<div class="identity-workspace">'+
      '<div class="page-head"><div><h1>Institutional access</h1><p>Maintain sign-in, named accounts and administration within the audit workspace.</p></div><div class="actions">'+
      (caps().owner?button("Download access review","export"):"")+button("Refresh access","refresh")+'</div></div>'+
      '<div id="ip-notice" role="status" aria-live="polite"></div>'+
      (!data.host.https_configured?'<div class="ip-callout"><strong>Institutional sign-in needs this application’s registered HTTPS address.</strong><p>Use the deployment steps in INSTITUTIONAL_ACCESS.md, then reopen the workspace at that address to configure a provider.</p></div>':"")+
      (data.restored_from && caps().owner?'<div class="ip-callout"><strong>Receiving workspace</strong><p>Review the callback address and provider registration, reactivate sign-in, and explicitly renew delegated administration. The retained editions are available below.</p></div>':"")+
      '<nav class="ip-tabs" aria-label="Institutional access sections">'+nav.map(([id,name])=>'<button type="button" data-identity-action="section" data-id="'+id+'"'+(section===id?' aria-current="page"':"")+'>'+e(name)+'</button>').join("")+'</nav>'+
      '<div id="ip-panel"></div></div>';
    q(".identity-workspace",ctx.root).onclick=async ev=>{
      const b=ev.target.closest("[data-identity-action]");
      if(!b)return;
      b.disabled=true;
      try {await routeAction(b.dataset.identityAction,b.dataset.id,b);}
      catch(error){notify(error.message,true);}
      finally {if(b.isConnected)b.disabled=false;}
    };
    draw();
  }
  function notify(text, error=false) {
    const n=q("#ip-notice",ctx.root);
    if(n){n.className=error?"ip-callout ip-error":"ip-callout";n.textContent=text;}
    else ctx.notice(text,error);
  }
  async function reload() {
    const ticket=++requestGeneration;
    const next=await ctx.api("/api/identity/state");
    if(!current() || ticket!==requestGeneration)return;
    data=next;
    shell();
  }
  async function render(context) {
    ctx=context;
    await reload();
  }
  function search(target, name) {
    return field("Find "+name,"ip-search",input("ip-search","","search",'autocomplete="off" data-filter-target="'+e(target)+'"'),"Filters the retained rows in this view.");
  }
  function draw() {
    const panel=q("#ip-panel",ctx.root);
    if(!panel)return;
    if(section==="overview")panel.innerHTML=overview();
    if(section==="providers")panel.innerHTML=providers();
    if(section==="mappings")panel.innerHTML=mappings();
    if(section==="accounts")panel.innerHTML=accounts();
    if(section==="delegations")panel.innerHTML=delegations();
    if(section==="sessions") {panel.innerHTML=sessions();bindSessionChooser();}
    if(section==="reviews")panel.innerHTML=reviews();
    if(section==="source") {panel.innerHTML=source();loadSource().catch(error=>notify(error.message,true));}
    const f=q("#ip-search",panel);
    if(f)f.oninput=()=>{const needle=f.value.toLowerCase();qa("#"+f.dataset.filterTarget+" tbody tr",panel).forEach(r=>r.hidden=!r.dataset.filter.includes(needle));};
  }
  function overview() {
    const pending=data.accounts.filter(r=>r.payload.status==="pending"), expiring=data.delegations.filter(r=>r.payload.active && isExpired(r.payload.expires_at));
    const due=data.attestations.filter(r=>r.payload.current_configuration && r.payload.review_due);
    const tiles=[["Providers",data.provider_options.filter(p=>p.enabled).length],["Accounts awaiting review",pending.length],["Expired delegations",expiring.length],["Reviews due",due.length]];
    let work=[];
    if(caps().owner){
      for(const r of data.providers){
        const p=r.payload;
        if(!p.metadata)work.push(row([cell(p.configuration.label),"Inspect configured discovery metadata",button("Open provider","provider",r.id)]));
        else if(!p.enabled || p.activation_epoch!==data.identity_epoch)work.push(row([cell(p.configuration.label),"Review the current registration and activate",button("Review provider","provider",r.id)]));
        if(!data.attestations.some(a=>a.payload.provider_id===r.id && a.payload.current_configuration && a.payload.outcome==="approved" && !a.payload.review_due))work.push(row([cell(p.configuration.label),"Record the current access review",button("Prepare review","review",r.id)]));
      }
    }
    for(const r of pending)work.push(row([cell(r.payload.label),cell(r.payload.access_message||"Review this account’s assignment"),canManage()?button("Review account","account",r.id):button("Show account","account-view",r.id)]));
    for(const r of expiring)work.push(row([cell(r.payload.grantee_id),"Delegated authority has expired",caps().owner?button("Review delegation","delegation",r.id):badge("Owner review")]));
    return '<div class="ip-summary">'+tiles.map(([name,value])=>'<div><strong>'+e(value)+'</strong><span>'+e(name)+'</span></div>').join("")+'</div>'+
      '<section class="card"><h2>Current work</h2>'+(work.length?table(["Subject","Work to complete","Open"],work):empty("The current account scope has no outstanding access items in this desk."))+'</section>'+
      '<div class="grid"><section class="card"><h2>Your authority</h2><p>'+badge(label(ctx.actor.role))+'</p><p>'+e(ctx.actor.label)+'</p>'+
      '<dl class="ip-details"><dt>Audit unit scope</dt><dd>'+e((ctx.actor.unit_ids||[]).join(", ")||"Original role scope")+'</dd><dt>Account administration</dt><dd>'+e(caps().owner?"Workspace owner":canManage()?"Explicit delegated roles and units":"Own sessions")+'</dd>'+
      '<dt>Named account</dt><dd>'+code(ctx.actor.id)+'</dd></dl>'+button("View current sessions","section","sessions")+'</section>'+
      '<section class="card"><h2>Operating sequence</h2><ol><li>Register the HTTPS application and accountable integration owners.</li><li>Save and inspect the exact issuer, callback and released claims.</li><li>Review mappings and named assignments in the original audit roles.</li><li>Activate, operate and review access; close affected sessions when assignments change.</li><li>Transfer the encrypted workspace and complete receiving activation.</li></ol>'+button("Open source and receiving guide","section","source")+'</section></div>';
  }
  function providers() {
    return '<section class="card"><div class="ip-heading"><div><h2>Registered providers</h2><p>Configuration changes retain a new edition and require affected accounts to sign in again.</p></div>'+button("Add provider","new-provider","",data.host.https_configured?"":'disabled')+'</div>'+
      search("ip-providers","providers")+
      (data.providers.length?table(["Provider","Issuer / callback","Owners","Metadata","State","Operate"],data.providers.map(r=>{
        const p=r.payload,c=p.configuration;
        return row([cell(c.label)+'<br>'+code(r.id)+'<br>'+badge("Edition "+r.revision),
          code(c.issuer)+'<br><small>'+e(c.redirect_uri)+'</small>',
          c.owners.map(o=>e(o.name)+"<br><small>"+e(o.email)+"</small>").join("<br>"),
          cell(when(p.metadata_checked_at))+'<br>'+code(p.metadata_sha256||""),
          badge(providerStatus(r)),
          '<div class="ip-row-actions">'+button("Edit","provider",r.id)+button("Inspect metadata","inspect-provider",r.id)+
          button(p.enabled && p.activation_epoch===data.identity_epoch?"Close sign-in":"Review activation","activate-provider",r.id)+button("History","history",r.id,'data-kind="identity_provider"')+'</div>'],
          [c.label,c.issuer,...c.owners.map(o=>o.email)].join(" "),r.id);
      }),"ip-providers"):empty("Add the provider registration to begin."))+'</section>';
  }
  function mappings() {
    return '<section class="card"><div class="ip-heading"><div><h2>Verified-claim mappings</h2><p>Exactly one active mapping must match. Overlapping matches require review before access opens.</p></div>'+button("Add mapping","new-mapping","",data.providers.length?"":'disabled')+'</div>'+
      search("ip-mappings","mappings")+
      (data.rules.length?table(["Mapping / provider","All required conditions","Audit access","Expiry / state","Operate"],data.rules.map(r=>{
        const p=r.payload;
        return row([cell(p.label)+'<br><small>'+e(providerLabel(p.provider_id))+'</small><br>'+badge("Edition "+r.revision),
          p.conditions.map(c=>code(c.claim)+" "+e(c.comparison)+" "+code(c.value)).join("<br>"),
          badge(label(p.access.role))+'<br>'+cell(p.access.unit_ids.join(", ")),
          cell(when(p.expires_at))+'<br>'+badge(!p.enabled?"Closed":isExpired(p.expires_at)?"Expired":"Active"),
          button("Edit","mapping",r.id)+button("History","history",r.id,'data-kind="identity_rule"')],[p.label,p.provider_id,p.access.role,...p.access.unit_ids].join(" "),r.id);
      }),"ip-mappings"):empty("Use an explicit named account assignment or add the first reviewed claim mapping."))+'</section>';
  }
  function accounts() {
    return '<section class="card"><div class="ip-heading"><div><h2>Named institutional accounts</h2><p>Issuer and subject identify an account. Email is a contact attribute.</p></div>'+
      (canManage()?button("Add named assignment","new-account"):"")+'</div>'+search("ip-accounts","accounts")+
      (data.accounts.length?table(["Account","Provider / exact subject","Assignment","Lifecycle","Authentication","Operate"],data.accounts.map(r=>{
        const p=r.payload,a=p.current_access;
        return row([cell(p.label)+'<br><small>'+e(p.email)+'</small><br>'+badge("Edition "+r.revision),
          cell(providerLabel(p.provider_id))+'<br>'+code(p.subject),
          a?badge(label(a.role))+'<br>'+cell(a.unit_ids.join(", "))+'<br><small>'+e(p.mode==="manual"?"Named assignment":"Verified-claim mapping")+'</small>':cell("Awaiting assignment"),
          badge(p.status)+'<br>'+cell(p.expires_at?when(p.expires_at):"No account expiry")+
          (p.access_message?'<p class="ip-small">'+e(p.access_message)+'</p>':""),
          cell(when(p.last_authenticated_at)),
          '<div class="ip-row-actions">'+(canManage()?button("Edit assignment","account",r.id):button("View","account-view",r.id))+
          button("Sessions","account-sessions",r.id)+button("History","history",r.id,'data-kind="identity_account"')+'</div>'],
          [p.label,p.email,p.subject,p.status,p.mode,a?.role,...(a?.unit_ids||[])].join(" "),r.id);
      }),"ip-accounts"):empty("The first verified sign-in or reviewed named assignment creates a retained account."))+'</section>'+
      (!caps().owner && canManage()?'<p class="help">Your administration is limited to the roles and units in the active delegations below.</p>':"");
  }
  function delegations() {
    return '<section class="card"><div class="ip-heading"><div><h2>Delegated administration</h2><p>Delegate named unit roles and units with an expiry and retained review note.</p></div>'+
      (caps().owner?button("Grant administration","new-delegation"):"")+'</div>'+
      (data.delegations.length?table(["Administrator","Roles","Unit scope","Expiry / state","Operate"],data.delegations.map(r=>{
        const p=r.payload,person=item(p.grantee_id,data.accounts)?.payload.label || data.named_grants.find(g=>g.id===p.grantee_id)?.label || p.grantee_id;
        const status=!p.active?"Closed":p.epoch!==data.identity_epoch && caps().owner?"Receiving review":isExpired(p.expires_at)?"Expired":"Active";
        return row([cell(person)+'<br>'+code(p.grantee_id),p.roles.map(role=>badge(label(role))).join(" "),cell(p.unit_ids.join(", ")),cell(when(p.expires_at))+'<br>'+badge(status),
          (caps().owner?button("Edit","delegation",r.id):"")+button("History","history",r.id,'data-kind="identity_delegation"')],"",r.id);
      })):empty("No delegated administration is retained for this account scope."))+'</section>';
  }
  function sessions() {
    const options=[[ctx.actor.id,ctx.actor.label+" (your account)"],...data.accounts.filter(r=>r.id!==ctx.actor.id).map(r=>[r.id,r.payload.label])];
    if(!options.some(v=>v[0]===sessionAccount))sessionAccount=ctx.actor.id;
    return '<section class="card"><h2>Sessions</h2><p>Close an individual session, or change an account assignment to require new sign-in for that account.</p>'+
      field("Account","ip-session-account",select("ip-session-account",options,sessionAccount))+
      '<div id="ip-session-rows">'+sessionRows(sessionAccount===ctx.actor.id?data.sessions:[])+'</div></section>';
  }
  function sessionRows(values) {
    return values.length?table(["Session","Method / device","Opened / last used","Expiry","Operate"],values.map(p=>row([
      code(p.id)+(p.id===data.request_session_id?'<br>'+badge("This session"):""),
      badge(p.method==="oidc"?"Institutional sign-in":"Workspace access link")+'<br><small>'+e(p.user_agent||"Device detail not retained")+'</small>',
      cell(when(p.created_at))+'<br>'+cell(when(p.last_seen_at)),
      cell(when(p.expires_at))+'<br>'+badge(p.active?"Active":"Expired"),button("Close session","revoke-session",p.id)
    ],"",p.id))):empty("This account has no retained sessions.");
  }
  function bindSessionChooser() {
    const chooser=q("#ip-session-account",ctx.root);
    if(!chooser)return;
    chooser.onchange=async()=>{sessionAccount=chooser.value;const chosen=sessionAccount;try{const r=await ctx.api("/api/identity/sessions",{account:chosen});if(current() && section==="sessions" && chosen===sessionAccount)q("#ip-session-rows",ctx.root).innerHTML=sessionRows(r.sessions);}catch(error){notify(error.message,true);}};
    if(sessionAccount!==ctx.actor.id)chooser.onchange();
  }
  function reviews() {
    return '<section class="card"><div class="ip-heading"><div><h2>Access review editions</h2><p>Record the named reviewer, current configuration basis, findings and next review date.</p></div>'+
      button("Prepare access review","new-review","",data.providers.length?"":'disabled')+'</div>'+
      (data.attestations.length?table(["Provider / reviewer","Review basis","Decision","Schedule","Operate"],[...data.attestations].reverse().map(r=>{
        const p=r.payload;
        return row([cell(providerLabel(p.provider_id))+'<br>'+cell(p.reviewer_name),code(p.basis_sha256)+'<br>'+badge(p.current_configuration?"Current configuration":"Earlier configuration"),
          badge(label(p.outcome))+'<p class="ip-small">'+e(p.note)+'</p>',cell(when(p.reviewed_at))+'<br>Next: '+cell(when(p.next_review_at))+(p.review_due?'<br>'+badge("Review due"):""),
          button("View retained review","review-view",r.id)+button("History","history",r.id,'data-kind="identity_attestation"')
        ],"",r.id);
      })):empty("Prepare the first review of a saved provider and its access assignments."))+'</section>';
  }
  function source() {
    return '<section class="card"><h2>Source and receiving</h2><p>The issuer’s centralized-authentication questions are implemented against the university’s current Okta integration guidance and the OpenID Connect code-flow specifications.</p>'+
      '<div id="ip-source-content">'+(contract?sourceBody():empty("Opening the retained source edition…"))+'</div></section>'+
      '<section class="card"><h2>Receiving sequence</h2><ol><li>Close or deliberately transfer the source deployment and preserve its encrypted workspace backup.</li><li>Restore into a new private directory with the original restore command or recovery screen.</li><li>Open the new owner access key; inspect retained provider, account, mapping and review editions.</li><li>Provision the receiving HTTPS address, TLS termination, private secret and certificate references.</li><li>Save the receiving callback and registration reference; inspect discovery metadata and activate.</li><li>Review each delegated administrator and renew the intended roles, units and expiry.</li><li>Complete a named sign-in and audit-scope review on the receiving host, then record the access review.</li></ol>'+
      '<p>INSTITUTIONAL_ACCESS.md contains exact launch, enrollment, deployment, recovery and operating commands. The original Backup & recovery page creates the complete encrypted snapshot.</p>'+
      (ctx.actor.role==="auditor"?button("Open original recovery workspace","open-recovery"):"")+'</section>';
  }
  function sourceBody() {
    return '<p class="ip-code">'+e(contract.schema)+' · '+e(contract.edition)+'</p>'+
      '<ul>'+contract.sources.map(s=>'<li><a href="'+e(s.url)+'" target="_blank" rel="noreferrer">'+e(s.title)+'</a> — '+e(s.publisher)+'</li>').join("")+'</ul>'+
      '<details><summary>Retained implementation and source mapping</summary><pre>'+e(pretty(contract))+'</pre></details>';
  }
  async function loadSource() {
    if(!contract)contract=await ctx.api("/api/identity/contract");
    if(current() && section==="source")q("#ip-source-content",ctx.root).innerHTML=sourceBody();
  }
  async function routeAction(action,id,b) {
    if(action==="section"){section=id;await reload();return;}
    if(action==="refresh"){await ctx.refresh();await reload();return;}
    if(action==="export"){location.assign(ctx.endpoint("/api/identity/export"));return;}
    if(action==="open-recovery"){ctx.openRoute("recovery");return;}
    if(action==="new-provider" || action==="provider"){providerForm(id);return;}
    if(action==="inspect-provider"){await inspectProvider(id);return;}
    if(action==="activate-provider"){activationForm(id);return;}
    if(action==="new-mapping" || action==="mapping"){mappingForm(id);return;}
    if(action==="new-account" || action==="account"){accountForm(id);return;}
    if(action==="account-view"){accountView(id);return;}
    if(action==="account-sessions"){sessionAccount=id;section="sessions";shell();return;}
    if(action==="new-delegation" || action==="delegation"){delegationForm(id);return;}
    if(action==="revoke-session"){const r=await ctx.action("identity.session.revoke",{id});if(id===data.request_session_id){location.reload();return;}await reload();notify("The selected session is closed.");return;}
    if(action==="review" || action==="new-review"){await reviewForm(id);return;}
    if(action==="review-view"){reviewView(id);return;}
    if(action==="history"){await historyView(b.dataset.kind,id);return;}
  }

  function form(titleText, body, submit, mounted) {
    ctx.dialogOpen(titleText,'<form id="ip-editor-form"><div id="ip-form-error" class="ip-error" role="alert" hidden></div>'+body+
      '<div class="dialog-actions"><button type="submit" class="primary" id="ip-save">Save reviewed edition</button></div></form>');
    const f=q("#ip-editor-form");
    f.onsubmit=async ev=>{
      ev.preventDefault();
      const save=q("#ip-save",f),err=q("#ip-form-error",f);
      save.disabled=true;err.hidden=true;
      try {
        const result=await submit(new FormData(f),f);
        ctx.dialog.close();
        try {await ctx.refresh();await reload();}
        catch(error){if(error.status===401 || error.status===403){location.reload();return;}throw error;}
        if(result?.message)notify(result.message);
      } catch(error) {err.textContent=error.message;err.hidden=false;err.scrollIntoView({block:"nearest"});}
      finally {if(save.isConnected)save.disabled=false;}
    };
    if(mounted)mounted(f);
    return f;
  }
  function providerForm(id) {
    const r=id?item(id,data.providers):null;
    if(id && !r)throw new Error("Reopen the current provider edition.");
    if(!data.host.https_configured)throw new Error("Reopen this workspace at its configured HTTPS address.");
    const rid=r?.id || "provider-"+crypto.randomUUID(), p=r?.payload, c=p?.configuration||{};
    const callback=data.host.origin+"/api/identity/callback?"+new URLSearchParams({workspace:data.host.workspace,provider:rid});
    const owners=c.owners?.length?c.owners:[{name:"",email:"",affiliation:""},{name:"",email:"",affiliation:""}];
    const ownerRows=values=>values.map((o,n)=>'<fieldset class="ip-owner" data-owner="'+n+'"><legend>Integration owner '+(n+1)+'</legend><div class="ip-form-grid">'+
      field("Name","ip-owner-"+n+"-name",input("ip-owner-"+n+"-name",o.name))+
      field("Individual email","ip-owner-"+n+"-email",input("ip-owner-"+n+"-email",o.email,"email"))+
      field("University affiliation / practice role","ip-owner-"+n+"-affiliation",input("ip-owner-"+n+"-affiliation",o.affiliation))+'</div></fieldset>').join("");
    form(r?"Provider · "+c.label:"Register an institutional provider",
      '<p>Save the registered issuer and application values. Secret fields below contain environment-variable names.</p><div class="ip-form-grid">'+
      field("Provider label","ip-provider-label",input("ip-provider-label",c.label||"","text","required maxlength=120"))+
      field("Provider ID","ip-provider-id",input("ip-provider-id",rid,"text","readonly"))+
      field("Exact HTTPS issuer","ip-provider-issuer",input("ip-provider-issuer",c.issuer||"","url","required"))+
      field("Registered client ID","ip-provider-client",input("ip-provider-client",c.client_id||"","text","required"))+
      field("Client secret environment variable","ip-provider-secret",input("ip-provider-secret",c.client_secret_env||"","text",'required pattern="[A-Za-z_][A-Za-z0-9_]{0,127}"'),"The host reads the actual secret from this private environment variable.")+
      field("Private CA bundle environment variable","ip-provider-ca",input("ip-provider-ca",c.ca_bundle_env||"","text",'pattern="[A-Za-z_][A-Za-z0-9_]{0,127}"'),"Optional; the named variable contains the trusted PEM bundle path.")+
      '</div>'+field("Exact callback to register","ip-provider-callback",area("ip-provider-callback",callback,"readonly"),"The original workspace and provider are both part of this callback.")+
      '<div class="ip-form-grid">'+
      field("Additional endpoint origins","ip-provider-origins",area("ip-provider-origins",(c.allowed_endpoint_origins||[]).join("\n")),"Only the issuer origin and these explicitly registered HTTPS origins can receive protocol requests.")+
      field("Requested scopes","ip-provider-scopes",area("ip-provider-scopes",(c.scopes||["openid","profile"]).join("\n"),"required"),"One per line. Include openid and only the scopes approved in the provider registration.")+
      field("Released additional claims","ip-provider-claims",area("ip-provider-claims",(c.claim_names||["name","email","preferred_username","groups"]).join("\n")),"Only these verified attributes become available to reviewed mappings; unavailable attributes produce no match.")+
      field("Required authentication contexts","ip-provider-acr",area("ip-provider-acr",(c.required_acr_values||[]).join("\n")),"Optional exact acr values agreed with the provider; the returned signed claim must match one.")+
      field("Maximum authentication age, seconds","ip-provider-age",input("ip-provider-age",c.max_age??300,"number","required min=0 max=3600"))+
      field("Maximum session duration, minutes","ip-provider-duration",input("ip-provider-duration",c.session_minutes??480,"number","required min=5 max=480"))+
      field("Idle expiry, minutes","ip-provider-idle",input("ip-provider-idle",c.idle_minutes??30,"number","required min=1 max=60"))+
      field("Technical contact","ip-provider-contact",input("ip-provider-contact",c.technical_contact||""))+
      '</div><h3>Accountable integration owners</h3><p>Activation requires two distinct named owners and their individual email addresses.</p><div id="ip-owner-rows">'+ownerRows(owners)+'</div>'+button("Add owner row","add-owner","",'id="ip-add-owner"')+
      field("Enrollment / registration reference","ip-provider-enrollment",input("ip-provider-enrollment",c.enrollment_reference||""),"Retain the institution’s approved registration reference or the explicit private practice registration used for an operated example.")+
      field("Operational notes","ip-provider-notes",area("ip-provider-notes",c.support_notes||""))+
      field("Reason for this edition","ip-provider-change",area("ip-provider-change","","required")),
      async(fd,f)=>{
        const rows=qa("[data-owner]",f).map(node=>{const n=node.dataset.owner;return{name:fd.get("ip-owner-"+n+"-name"),email:fd.get("ip-owner-"+n+"-email"),affiliation:fd.get("ip-owner-"+n+"-affiliation")};}).filter(o=>o.name||o.email||o.affiliation);
        await ctx.action("identity.provider.save",{id:rid,expected_revision:r?.revision||0,note:fd.get("ip-provider-change"),configuration:{
          label:fd.get("ip-provider-label"),issuer:fd.get("ip-provider-issuer"),client_id:fd.get("ip-provider-client"),
          client_secret_env:fd.get("ip-provider-secret"),ca_bundle_env:fd.get("ip-provider-ca")||null,
          allowed_endpoint_origins:lines(fd.get("ip-provider-origins")),scopes:words(fd.get("ip-provider-scopes")),
          claim_names:lines(fd.get("ip-provider-claims")),required_acr_values:lines(fd.get("ip-provider-acr")),
          max_age:Number(fd.get("ip-provider-age")),session_minutes:Number(fd.get("ip-provider-duration")),idle_minutes:Number(fd.get("ip-provider-idle")),
          owners:rows,technical_contact:fd.get("ip-provider-contact"),enrollment_reference:fd.get("ip-provider-enrollment"),support_notes:fd.get("ip-provider-notes")
        }});
        return{message:"The provider edition is retained. Inspect its current metadata and review activation."};
      },f=>{
        q("#ip-add-owner",f).onclick=()=>{
          const rows=qa("[data-owner]",f),n=rows.length;if(n>=10)return;
          const div=document.createElement("div");div.innerHTML=ownerRows([{name:"",email:"",affiliation:""}]).replaceAll('data-owner="0"','data-owner="'+n+'"').replaceAll("ip-owner-0-","ip-owner-"+n+"-").replace("Integration owner 1","Integration owner "+(n+1));
          q("#ip-owner-rows",f).append(div.firstElementChild);
        };
      });
  }
  async function inspectProvider(id) {
    const r=item(id,data.providers);
    if(!r)throw new Error("Reopen the provider edition.");
    const result=await ctx.action("identity.provider.inspect",{id,expected_revision:r.revision});
    await reload();
    const p=result.record.payload,m=p.metadata;
    ctx.dialogOpen("Discovery metadata retained",'<p>The original response is retained with this provider edition.</p><dl class="ip-details"><dt>Issuer</dt><dd>'+code(m.issuer)+
      '</dd><dt>Authorization endpoint</dt><dd>'+code(m.authorization_endpoint)+'</dd><dt>Token endpoint</dt><dd>'+code(m.token_endpoint)+'</dd><dt>Signing keys</dt><dd>'+code(m.jwks_uri)+
      '</dd><dt>Metadata SHA-256</dt><dd>'+code(p.metadata_sha256)+'</dd><dt>Observed</dt><dd>'+cell(when(p.metadata_checked_at))+'</dd></dl><details><summary>Complete metadata</summary><pre>'+e(pretty(m))+'</pre></details>');
  }
  function activationForm(id) {
    const r=item(id,data.providers);if(!r)throw new Error("Reopen the provider.");
    const p=r.payload,c=p.configuration,enabled=!(p.enabled && p.activation_epoch===data.identity_epoch);
    form(enabled?"Review and activate institutional sign-in":"Close institutional sign-in",
      '<dl class="ip-details"><dt>Provider</dt><dd>'+cell(c.label)+'</dd><dt>Issuer</dt><dd>'+code(c.issuer)+'</dd><dt>Callback</dt><dd>'+code(data.callbacks[id]||"HTTPS address required")+
      '</dd><dt>Registration reference</dt><dd>'+cell(c.enrollment_reference)+'</dd><dt>Named owners</dt><dd>'+c.owners.map(o=>e(o.name)+" · "+e(o.email)).join("<br>")+
      '</dd><dt>Metadata edition</dt><dd>'+code(p.metadata_sha256||"Inspect metadata first")+'</dd></dl>'+
      '<p>'+e(enabled?"Review the exact registration, owners and retained metadata before opening institutional sign-in.":"This closes provider sign-in and affected sessions while retaining the configuration and account history.")+'</p>'+
      field(enabled?"Activation review note":"Closure note","ip-activation-note",area("ip-activation-note","","required")),
      async fd=>{await ctx.action("identity.provider.activate",{id,expected_revision:r.revision,enabled,note:fd.get("ip-activation-note")});return{message:enabled?"Institutional sign-in is active on this registered address.":"Provider sign-in and affected sessions are closed."};});
    q("#ip-save").textContent=enabled?"Activate reviewed provider":"Close provider sign-in";
  }
  function accessFields(prefix,a={},allRoles) {
    const roles=allRoles || (caps().owner?data.roles:caps().roles);
    const chosen=roles.includes(a.role)?a.role:roles[0];
    return '<fieldset class="ip-access"><legend>Original audit access</legend><div class="ip-form-grid">'+
      field("Audit role",prefix+"-role",select(prefix+"-role",roles.map(r=>[r,label(r)]),chosen,"required"))+
      field("Authorized unit IDs",prefix+"-units",area(prefix+"-units",(a.unit_ids||[]).join("\n")),"One original unit ID per line. Unit leadership and IT roles require explicit units.")+
      field("Advisory recipient unit IDs",prefix+"-recipients",area(prefix+"-recipients",(a.recipient_unit_ids||[]).join("\n")),"For advisory access, these must be within the authorized unit scope.")+
      field("Selected advisory memo IDs",prefix+"-records",area(prefix+"-records",(a.selected_record_ids||[]).join("\n")),"For advisory access, retain the exact original memo IDs.")+
      '</div>'+(!caps().owner?'<p class="help">Delegated units by role: '+e(pretty(caps().units_by_role))+'</p>':"")+'</fieldset>';
  }
  function readAccess(fd,prefix) {
    const role=fd.get(prefix+"-role");
    return {role,unit_ids:lines(fd.get(prefix+"-units")),
      recipient_unit_ids:role==="advisory"?lines(fd.get(prefix+"-recipients")):[],
      selected_record_ids:role==="advisory"?lines(fd.get(prefix+"-records")):[]};
  }
  function mappingForm(id) {
    const r=id?item(id,data.rules):null,p=r?.payload||{};
    const rid=r?.id||"mapping-"+crypto.randomUUID(),provider=item(p.provider_id,data.providers)||data.providers[0];
    if(!provider)throw new Error("Save a provider before creating a mapping.");
    const conditions=p.conditions||[{claim:provider.payload.configuration.claim_names[0]||"sub",comparison:"equals",value:""}];
    let conditionGeneration=0;
    const conditionMarkup=(v,n,providerId)=>{
      const record=item(providerId,data.providers),claims=["sub",...(record?.payload.configuration.claim_names||[])];
      return '<div class="ip-condition" data-condition="'+n+'">'+
        field("Verified claim","ip-condition-"+n+"-claim",select("ip-condition-"+n+"-claim",claims.map(k=>[k,k]),claims.includes(v.claim)?v.claim:claims[0],"required"))+
        field("Comparison","ip-condition-"+n+"-comparison",select("ip-condition-"+n+"-comparison",[["equals","Equals (text)"],["contains","Contains (list value)"]],v.comparison||"equals"))+
        field("Exact required value","ip-condition-"+n+"-value",input("ip-condition-"+n+"-value",v.value||"","text","required maxlength=512"))+
        '<button type="button" class="ip-remove-condition" aria-label="Remove claim condition">Remove</button></div>';
    };
    form(r?"Mapping · "+p.label:"Add a verified-claim mapping",
      '<div class="ip-form-grid">'+field("Mapping label","ip-mapping-label",input("ip-mapping-label",p.label||"","text","required maxlength=120"))+
      field("Provider","ip-mapping-provider",select("ip-mapping-provider",data.providers.map(r=>[r.id,r.payload.configuration.label]),provider.id,r?"disabled":"required"))+
      field("Expiry, UTC","ip-mapping-expiry",input("ip-mapping-expiry",stampInput(p.expires_at),"datetime-local"))+
      '</div>'+check("ip-mapping-enabled","Mapping is active",p.enabled??true)+
      '<h3>All required conditions</h3><p>A missing attribute or an overlapping second mapping leaves the account awaiting review.</p><div id="ip-conditions">'+conditions.map((v,n)=>conditionMarkup(v,n,provider.id)).join("")+'</div><button type="button" id="ip-add-condition">Add required condition</button>'+
      accessFields("ip-mapping-access",p.access||{},data.roles)+
      field("Mapping review note","ip-mapping-note",area("ip-mapping-note","","required")),
      async(fd,f)=>{
        const values=qa("[data-condition]",f).map(node=>{const n=node.dataset.condition;return{claim:fd.get("ip-condition-"+n+"-claim"),comparison:fd.get("ip-condition-"+n+"-comparison"),value:fd.get("ip-condition-"+n+"-value")};});
        await ctx.action("identity.rule.save",{id:rid,expected_revision:r?.revision||0,provider_id:q("#ip-mapping-provider",f).value,
          label:fd.get("ip-mapping-label"),conditions:values,access:readAccess(fd,"ip-mapping-access"),
          enabled:fd.get("ip-mapping-enabled")==="1",expires_at:stamp(fd.get("ip-mapping-expiry")),note:fd.get("ip-mapping-note")});
        return{message:"The mapping edition is retained. Affected accounts will use it on their next sign-in."};
      },f=>{
        conditionGeneration=conditions.length;
        q("#ip-add-condition",f).onclick=()=>{if(qa("[data-condition]",f).length>=16)return;const node=document.createElement("div");node.innerHTML=conditionMarkup({},conditionGeneration++,q("#ip-mapping-provider",f).value);q("#ip-conditions",f).append(node.firstElementChild);};
        q("#ip-conditions",f).onclick=ev=>{const b=ev.target.closest(".ip-remove-condition");if(b && qa("[data-condition]",f).length>1)b.closest("[data-condition]").remove();};
        q("#ip-mapping-provider",f).onchange=ev=>{qa("[data-condition]",f).forEach(node=>{const n=node.dataset.condition,old=q("#ip-condition-"+n+"-claim",node),record=item(ev.target.value,data.providers),claims=["sub",...record.payload.configuration.claim_names];old.innerHTML=claims.map(k=>'<option value="'+e(k)+'">'+e(k)+'</option>').join("");});};
      });
  }
  function accountForm(id) {
    const r=id?item(id,data.accounts):null,p=r?.payload||{};
    if(id && !r)throw new Error("Reopen the current account scope.");
    if(r && !caps().owner && p.mode==="rules"){accountView(id);return;}
    const provider=p.provider_id || data.provider_options[0]?.id;
    if(!provider)throw new Error("Save the institutional provider before assigning an account.");
    const modes=caps().owner?[["manual","Reviewed named assignment"],["rules","Verified-claim mappings"]]:[["manual","Reviewed named assignment"]];
    form(r?"Account · "+p.label:"Create a named assignment",
      '<div class="ip-form-grid">'+
      field("Provider","ip-account-provider",select("ip-account-provider",data.provider_options.map(r=>[r.id,r.label]),provider,r?"disabled":"required"))+
      field("Exact provider subject","ip-account-subject",input("ip-account-subject",p.subject||"","text","required maxlength=255"+(r?" readonly":"")),"Use the verified provider subject; this account identifier is case sensitive.")+
      field("Display name","ip-account-label",input("ip-account-label",p.label||"","text","required maxlength=120"))+
      field("Contact email","ip-account-email",input("ip-account-email",p.email||"","email"))+
      field("Assignment method","ip-account-mode",select("ip-account-mode",modes,p.mode||"manual"))+
      field("Lifecycle","ip-account-status",select("ip-account-status",[["active","Active"],["pending","Awaiting review"],["disabled","Disabled"]],p.status||"active"))+
      field("Account expiry, UTC","ip-account-expiry",input("ip-account-expiry",stampInput(p.expires_at),"datetime-local"))+
      '</div><div id="ip-account-access">'+accessFields("ip-account-access",p.manual_access||p.current_access||{})+'</div>'+
      '<p class="help">A rule-managed account opens when exactly one reviewed mapping matches; use Disabled to close access irrespective of mappings.</p>'+
      field("Account review / change note","ip-account-note",area("ip-account-note","","required")),
      async(fd,f)=>{
        const mode=fd.get("ip-account-mode");
        await ctx.action("identity.account.save",{provider_id:q("#ip-account-provider",f).value,subject:fd.get("ip-account-subject"),
          expected_revision:r?.revision||0,label:fd.get("ip-account-label"),email:fd.get("ip-account-email"),mode,status:fd.get("ip-account-status"),
          access:mode==="manual"?readAccess(fd,"ip-account-access"):null,expires_at:stamp(fd.get("ip-account-expiry")),note:fd.get("ip-account-note")});
        return{message:"The account edition is retained and its previous sessions are closed. The next sign-in applies this reviewed assignment."};
      },f=>{
        const refresh=()=>{const manual=q("#ip-account-mode",f).value==="manual";q("#ip-account-access",f).hidden=!manual;qa("input,textarea,select",q("#ip-account-access",f)).forEach(control=>control.disabled=!manual);};
        q("#ip-account-mode",f).onchange=refresh;refresh();
      });
  }
  function accountView(id) {
    const r=item(id,data.accounts);if(!r)throw new Error("Reopen the account.");
    const p=r.payload;
    ctx.dialogOpen("Account · "+p.label,
      '<dl class="ip-details"><dt>Provider</dt><dd>'+cell(providerLabel(p.provider_id))+'</dd><dt>Issuer</dt><dd>'+code(p.issuer)+'</dd><dt>Exact subject</dt><dd>'+code(p.subject)+
      '</dd><dt>State</dt><dd>'+badge(p.status)+'</dd><dt>Assignment</dt><dd>'+e(pretty(p.current_access))+'</dd><dt>Last verified sign-in</dt><dd>'+cell(when(p.last_authenticated_at))+
      '</dd><dt>Review note</dt><dd>'+cell(p.note)+'</dd></dl>'+
      (p.last_verified_claims?'<details><summary>Retained verified attributes</summary><pre>'+e(pretty(p.last_verified_claims))+'</pre></details>':"")+
      '<details><summary>Original account edition</summary><pre>'+e(pretty(r))+'</pre></details>');
  }
  function delegationForm(id) {
    const r=id?item(id,data.delegations):null,p=r?.payload||{};
    const people=new Map();
    data.named_grants.filter(g=>g.id!=="owner").forEach(g=>people.set(g.id,g.label+" · "+g.id));
    data.accounts.forEach(a=>people.set(a.id,a.payload.label+" · "+a.id));
    if(!people.size)throw new Error("Create a named account assignment or original scoped access link first.");
    const rid=r?.id||"delegation-"+crypto.randomUUID();
    form(r?"Review delegated administration":"Delegate account administration",
      field("Named administrator","ip-delegation-grantee",select("ip-delegation-grantee",[...people],p.grantee_id||[...people.keys()][0],r?"disabled":"required"))+
      '<fieldset><legend>Roles this administrator may assign</legend>'+data.delegable_roles.map((role,n)=>check("ip-delegation-role-"+n,label(role),(p.roles||[]).includes(role),role)).join("")+'</fieldset>'+
      field("Explicit unit IDs","ip-delegation-units",area("ip-delegation-units",(p.unit_ids||[]).join("\n"),"required"),"These units apply to every role selected in this delegation. Add a separate delegation for a different role/unit combination.")+
      field("Expiry, UTC","ip-delegation-expiry",input("ip-delegation-expiry",stampInput(p.expires_at)||defaultDate(90),"datetime-local","required"))+
      check("ip-delegation-active","Delegation is active on this receiving workspace",p.active??true)+
      field("Delegation review note","ip-delegation-note",area("ip-delegation-note","","required")),
      async(fd,f)=>{
        await ctx.action("identity.delegation.save",{id:rid,expected_revision:r?.revision||0,grantee_id:q("#ip-delegation-grantee",f).value,
          roles:data.delegable_roles.map((_,n)=>fd.get("ip-delegation-role-"+n)).filter(Boolean),unit_ids:lines(fd.get("ip-delegation-units")),
          expires_at:stamp(fd.get("ip-delegation-expiry")),active:fd.get("ip-delegation-active")==="1",note:fd.get("ip-delegation-note")});
        return{message:"The delegated administration edition is retained and applies to the named administrator’s current requests."};
      });
  }
  async function reviewForm(providerId) {
    const providers=data.providers.map(r=>[r.id,r.payload.configuration.label]);
    if(!providers.length)throw new Error("Save a provider before reviewing it.");
    let selected=providers.some(v=>v[0]===providerId)?providerId:providers[0][0], basis=await ctx.api("/api/identity/attestation-preview",{provider:selected});
    const basisText=()=>'<dl class="ip-details"><dt>Provider edition</dt><dd>'+e(basis.basis.provider.revision)+'</dd><dt>Reviewed mappings</dt><dd>'+e(basis.basis.rules.length)+
      '</dd><dt>Account assignments</dt><dd>'+e(basis.basis.accounts.length)+'</dd><dt>Delegation editions</dt><dd>'+e(basis.basis.delegations.length)+
      '</dd><dt>Configuration basis</dt><dd>'+code(basis.basis_sha256)+'</dd></dl>';
    const rid="attestation-"+crypto.randomUUID();
    form("Record an access review",
      field("Provider","ip-review-provider",select("ip-review-provider",providers,selected,"required"))+
      '<div id="ip-review-basis">'+basisText()+'</div><button type="button" id="ip-review-refresh-basis">Refresh current review basis</button>'+
      '<div class="ip-form-grid">'+field("Named reviewer","ip-review-name",input("ip-review-name","","text","required maxlength=120"))+
      field("Review / institutional attestation reference","ip-review-reference",input("ip-review-reference"))+
      field("Review time, UTC","ip-review-at",input("ip-review-at",defaultDate(0),"datetime-local","required"))+
      field("Next review due, UTC","ip-review-next",input("ip-review-next",defaultDate(365),"datetime-local","required"))+
      field("Review decision","ip-review-outcome",select("ip-review-outcome",[["approved","Approved"],["changes_required","Changes required"]],"changes_required"))+
      '</div>'+field("Review findings and scope","ip-review-note",area("ip-review-note","","required"))+
      field("Exceptions, owners and follow-up work","ip-review-exceptions",area("ip-review-exceptions")),
      async(fd,f)=>{
        if(q("#ip-review-provider",f).value!==selected)throw new Error("Refresh the selected provider’s review basis.");
        await ctx.action("identity.attestation.save",{id:rid,provider_id:selected,basis_sha256:basis.basis_sha256,
          reviewed_at:stamp(fd.get("ip-review-at")),next_review_at:stamp(fd.get("ip-review-next")),reviewer_name:fd.get("ip-review-name"),
          reviewer_reference:fd.get("ip-review-reference"),outcome:fd.get("ip-review-outcome"),note:fd.get("ip-review-note"),exceptions:fd.get("ip-review-exceptions")});
        return{message:"The named review and its exact configuration basis are retained."};
      },f=>{
        let requested=0;
        const refresh=async()=>{const ticket=++requested,chosen=q("#ip-review-provider",f).value;try{const next=await ctx.api("/api/identity/attestation-preview",{provider:chosen});if(ticket!==requested||!f.isConnected)return;selected=chosen;basis=next;q("#ip-review-basis",f).innerHTML=basisText();}catch(error){q("#ip-form-error",f).textContent=error.message;q("#ip-form-error",f).hidden=false;}};
        q("#ip-review-provider",f).onchange=refresh;q("#ip-review-refresh-basis",f).onclick=refresh;
      });
  }
  function reviewView(id) {
    const r=item(id,data.attestations);if(!r)throw new Error("Reopen the retained review.");
    const p=r.payload;
    ctx.dialogOpen("Retained access review",'<dl class="ip-details"><dt>Provider</dt><dd>'+cell(providerLabel(p.provider_id))+'</dd><dt>Reviewer</dt><dd>'+cell(p.reviewer_name)+
      '</dd><dt>Reference</dt><dd>'+cell(p.reviewer_reference)+'</dd><dt>Decision</dt><dd>'+badge(label(p.outcome))+'</dd><dt>Review time</dt><dd>'+cell(when(p.reviewed_at))+
      '</dd><dt>Next review</dt><dd>'+cell(when(p.next_review_at))+'</dd><dt>Findings</dt><dd>'+cell(p.note)+'</dd><dt>Exceptions / assigned work</dt><dd>'+cell(p.exceptions)+
      '</dd><dt>Configuration basis</dt><dd>'+code(p.basis_sha256)+'</dd></dl><details><summary>Retained reviewed configuration</summary><pre>'+e(pretty(p.basis))+'</pre></details>');
  }
  async function historyView(kind,id) {
    const result=await ctx.api("/api/identity/history",{kind,id}),editions=result.editions;
    if(!editions.length)throw new Error("No retained editions are visible in this scope.");
    const options=editions.map(r=>[String(r.revision),"Edition "+r.revision+" · "+when(r.updated_at)]);
    ctx.dialogOpen("Institutional edition history",
      '<p>'+code(kind)+" · "+code(id)+'</p><div class="ip-form-grid">'+
      field("Earlier edition","ip-history-before",select("ip-history-before",options,String(editions[Math.min(1,editions.length-1)].revision)))+
      field("Later edition","ip-history-after",select("ip-history-after",options,String(editions[0].revision)))+
      '</div><div id="ip-history-comparison"></div><button type="button" id="ip-history-export">Download visible editions</button>');
    const draw=()=>{
      const before=editions.find(r=>r.revision===Number(q("#ip-history-before").value)),after=editions.find(r=>r.revision===Number(q("#ip-history-after").value));
      const keys=[...new Set([...Object.keys(before.payload),...Object.keys(after.payload)])].sort();
      const changes=keys.filter(k=>pretty(before.payload[k])!==pretty(after.payload[k]));
      q("#ip-history-comparison").innerHTML=(changes.length?table(["Field","Earlier","Later"],changes.map(k=>row([cell(label(k)),'<pre>'+e(pretty(before.payload[k])??"Absent")+'</pre>','<pre>'+e(pretty(after.payload[k])??"Absent")+'</pre>']))):empty("These selected payloads are identical."))+
        '<details><summary>Selected retained edition</summary><pre>'+e(pretty(after))+'</pre></details>';
    };
    q("#ip-history-before").onchange=draw;q("#ip-history-after").onchange=draw;
    q("#ip-history-export").onclick=()=>download("Institutional_"+id+"_Editions.json",{kind,id,editions});draw();
  }
  async function login(context) {
    const target=q("#institutional-login");
    if(!target)return;
    try {
      const r=await context.api("/api/identity/providers");
      target.replaceChildren();
      if(!r.providers.length)return;
      const heading=document.createElement("h2");heading.textContent="Institutional sign-in";target.append(heading);
      for(const p of r.providers){
        const b=document.createElement("button");b.type="button";b.dataset.providerId=p.id;b.textContent="Sign in with "+p.label;
        b.onclick=async()=>{b.disabled=true;try{const result=await context.api("/api/identity/login",{}, {provider_id:p.id});location.assign(result.authorization_url);}catch(error){q("#login-error").textContent=error.message;b.disabled=false;}};
        target.append(b);
      }
    } catch(error) {q("#login-error").textContent=error.message;}
  }
  return {render,login};
})();
