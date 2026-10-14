'use strict';
/** Pure, source-bound preparation of complete lead-pack value in a message.
 * No mailbox access, ledger mutation, recipient lookup or send operation.
 */
function createLeadValueMessage({sha256Utf8}) {
  if(typeof sha256Utf8!=='function')throw TypeError('Use the maintained exact UTF-8 identity function.');
  const VERSION='dealscout.lead-value-message.v1',INPUT='lead-value-message.input.v1';
  const clone=v=>JSON.parse(JSON.stringify(v));
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const json=v=>JSON.stringify(v,null,2)+'\n';
  const need=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'LEAD_VALUE_MESSAGE'});};
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  function text(v,label,{empty=false,line=false}={}) {
    need(typeof v==='string'&&(empty||v.trim().length>0),label+' must be complete text.');
    sha256Utf8(v);
    need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),label+' contains an unsupported control character.');
    if(line)need(!/[\r\n]/.test(v),label+' must be a single line.');
    return v;
  }
  function sourceURL(v,label){
    text(v,label,{line:true});
    need(/^https?:\/\/[^/?#\s<>]+(?:[/?#][^\s<>]*)?$/i.test(v)&&!/^https?:\/\/[^/?#]*@/i.test(v),label+' must retain a published HTTP(S) URL.');
    return v;
  }
  function mailbox(v){text(v,'buyer.email',{line:true});need(/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(v),'Use one exact published buyer mailbox.');return v;}
  function contact(v){
    text(v,'Original contact route',{line:true});
    if(v.startsWith('mailto:')){mailbox(v.slice(7));return v;}
    if(v.startsWith('tel:')){need(/^\+[1-9]\d{6,14}$/.test(v.slice(4)),'Retain the original published phone in E.164.');return v;}
    return sourceURL(v,'Original contact route');
  }
  function amount(v,label){need(Number.isSafeInteger(v)&&v>=0,label+' must be nonnegative integer minor units.');return v;}
  function quantity(v,label){need(Number.isSafeInteger(v)&&v>0,label+' must be a positive integer.');return v;}
  function money(minor,currency){return currency+' '+Math.floor(minor/100).toLocaleString('en-US')+'.'+String(minor%100).padStart(2,'0');}
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paras=v=>text(v,'Rendered text',{empty:true}).split(/\r?\n\r?\n/).map(p=>'<p>'+esc(p).replace(/\r?\n/g,'<br>')+'</p>').join('\n');
  const link=(url,label=url)=>'<a href="'+esc(url)+'">'+esc(label)+'</a>';
  function offerPart(v,label){
    need(plain(v),label+' must be explicit.');
    quantity(v.quantity,label+'.quantity');amount(v.price_minor,label+'.price_minor');
    need(v.currency==='USD',label+' currency must be USD; this message contract uses cents.');
    text(v.description,label+'.description');
  }
  function composeRecord({editionText,recipe},renderVersion){
    const legacy=renderVersion===1;
    const contactLabel=value=>renderVersion>=3?value.replace(/^(?:mailto:|tel:)/i,''):value;
    text(editionText,'Complete original customer JSON');
    const source=sha256Utf8(editionText);
    need(plain(recipe)&&recipe.schema===INPUT,'Use the complete value-message input schema.');
    need(recipe.edition_sha256===source.sha256,'Selected edition bytes changed; reselect the exact original customer JSON.');
    text(recipe.prepared_at,'prepared_at',{line:true});
    need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(recipe.prepared_at)&&Number.isFinite(Date.parse(recipe.prepared_at)),'Use the actual UTC preparation timestamp.');
    const edition=JSON.parse(editionText);
    need(plain(edition)&&edition.version==='dealscout.lead-pack.v1','Select the maintained exported lead-pack JSON.');
    need(Array.isArray(edition.leads)&&edition.leads.length>0&&edition.quantity===edition.leads.length,'Keep the entire selected edition and its exact quantity.');
    need(['sample','paid','replacement'].includes(edition.delivery_type),'Use a maintained sample, paid or replacement edition.');
    const buyer=recipe.buyer;
    need(plain(buyer)&&buyer.name===edition.customer,'Buyer name must equal the selected customer edition.');
    text(buyer.name,'buyer.name',{line:true});text(buyer.recipient_name,'buyer.recipient_name',{line:true});mailbox(buyer.email);
    sourceURL(buyer.company_url,'buyer.company_url');sourceURL(buyer.contact_source_url,'buyer.contact_source_url');
    for(const key of ['fit','product_scope','pricing_fit'])text(buyer[key],'buyer.'+key);
    need(Array.isArray(buyer.sources)&&buyer.sources.length>0,'Retain current buyer product/pricing/source evidence.');
    for(const row of buyer.sources){need(plain(row),'Keep each complete buyer source.');sourceURL(row.url,'buyer source URL');text(row.note,'buyer source note');}
    text(recipe.subject,'subject',{line:true});text(recipe.opening,'opening');text(recipe.next_question,'next_question');text(recipe.signature,'signature');
    need(plain(recipe.offer)&&recipe.offer.scope==='lead-pack','This composer prepares the selected lead-pack service; managed outreach has a separate scope.');
    const current=recipe.offer.current,next=recipe.offer.next;
    offerPart(current,'offer.current');
    need(current.quantity===edition.quantity&&current.price_minor===edition.price_minor&&current.currency===edition.currency,'Message quantity, currency and price must equal the actual selected edition.');
    if(edition.delivery_type==='sample')need(current.price_minor===0,'The original sample edition must remain free.');
    need(next===null||plain(next),'Set offer.next to null or explicit proposed follow-on terms.');
    if(next!==null){
      offerPart(next,'offer.next');text(next.timing,'offer.next.timing');text(next.corrections,'offer.next.corrections');
      need(next.price_minor>0,'A paid follow-on must have its own explicit price.');
    }
    const witnesses=[];
    const sections=edition.leads.map((lead,index)=>{
      need(plain(lead),'Keep every original lead.');
      for(const key of ['organization','business_need','contact_instructions','why_it_fits','opening_message'])text(lead[key],'Lead '+(index+1)+' '+key);
      for(const key of ['person','source_status','status_note'])text(lead[key]??'','Lead '+(index+1)+' '+key,{empty:true});
      for(const key of ['source_url','company_url'])sourceURL(lead[key],'Lead '+(index+1)+' '+key);
      contact(lead.contact_route);
      for(const key of ['geography','source_checked_at'])text(lead[key],'Lead '+(index+1)+' '+key);
      const title=(index+1)+'. '+lead.organization+(lead.person?' — '+lead.person:'');
      const witness={index,organization:lead.organization,person:lead.person??'',contact_route:lead.contact_route,source_url:lead.source_url,source_checked_at:lead.source_checked_at,lead_sha256:sha256Utf8(JSON.stringify(canonical(lead))).sha256};
      witnesses.push(witness);
      const lines=[title,'Location: '+lead.geography,'Published contact: '+contactLabel(lead.contact_route),lead.contact_instructions,
        'Observed workflow:\n'+lead.business_need,'Possible use and qualification:\n'+lead.why_it_fits,
        'Proposed opening:\n'+lead.opening_message,
        'Source: '+lead.source_url,'Source checked: '+lead.source_checked_at,
        [lead.source_status?'Recorded source status: '+lead.source_status:'',lead.status_note||''].filter(Boolean).join('\n')];
      const html='<section><h2>'+esc(title)+'</h2><p><strong>Location:</strong> '+esc(lead.geography)+'</p>'+
        '<p><strong>Published contact:</strong> '+link(lead.contact_route,contactLabel(lead.contact_route))+'</p>'+paras(lead.contact_instructions)+
        '<h3>Observed workflow</h3>'+paras(lead.business_need)+'<h3>Possible use and qualification</h3>'+paras(lead.why_it_fits)+
        '<h3>Proposed opening</h3><blockquote style="white-space:pre-wrap">'+esc(lead.opening_message)+'</blockquote>'+
        '<p>Source: '+link(lead.source_url)+'</p><p>Source checked: '+esc(lead.source_checked_at)+'</p>'+
        (lead.source_status?'<p>Recorded source status: '+esc(lead.source_status)+'</p>':'')+paras(lead.status_note||'')+'</section>';
      return {plain:lines.filter(Boolean).join('\n\n'),html};
    });
    const layout=recipe.layout??{mode:'complete'};
    need(plain(layout)&&['complete','concise'].includes(layout.mode),'Select complete or concise message layout.');
    let selectedSections=sections,selectedOpenings=[];
    if(layout.mode==='concise'){
      need(Array.isArray(layout.cards)&&layout.cards.length===edition.leads.length,'Concise layout needs one reviewed card for every original lead.');
      need(Array.isArray(layout.opening_indices)&&layout.opening_indices.length>0&&new Set(layout.opening_indices).size===layout.opening_indices.length,'Select at least one distinct complete original opening.');
      need(layout.opening_indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<edition.leads.length),'Select original opening indices from this exact edition.');
      selectedSections=layout.cards.map((card,index)=>{
        need(plain(card)&&card.index===index&&card.lead_sha256===witnesses[index].lead_sha256,'Editorial cards must retain every original lead in source order and its exact content hash.');
        for(const key of ['observed_workflow','product_use','contact_qualification'])text(card[key],'Card '+(index+1)+' '+key);
        const lead=edition.leads[index],title=(index+1)+'. '+lead.organization+(lead.person?' — '+lead.person:'');
        return {plain:[title,'Published contact: '+contactLabel(lead.contact_route),card.contact_qualification,'Observed workflow: '+card.observed_workflow,'Possible use: '+card.product_use,'Source: '+lead.source_url].join('\n\n'),
          html:'<section><h2>'+esc(title)+'</h2><p><strong>Published contact:</strong> '+link(lead.contact_route,contactLabel(lead.contact_route))+'</p>'+paras(card.contact_qualification)+
            '<p><strong>Observed workflow:</strong> '+esc(card.observed_workflow)+'</p><p><strong>Possible use:</strong> '+esc(card.product_use)+'</p><p>Source: '+link(lead.source_url)+'</p></section>'};
      });
      selectedOpenings=layout.opening_indices.map(index=>{
        const lead=edition.leads[index],title='Complete proposed opening — '+lead.organization;
        return {plain:title+'\n\n'+lead.opening_message,html:'<section><h2>'+esc(title)+'</h2><blockquote style="white-space:pre-wrap">'+esc(lead.opening_message)+'</blockquote></section>'};
      });
    }
    const currentLine='Included now: '+current.quantity+' complete profiles — '+(current.price_minor===0?'free ('+money(0,current.currency)+')':money(current.price_minor,current.currency))+'. '+current.description;
    const nextLine=next===null?'':'Optional follow-on: '+next.quantity+' new, distinct profiles — '+money(next.price_minor,next.currency)+' total. '+next.description+' '+next.timing+' '+next.corrections;
    const intro=layout.mode==='concise'?[recipe.opening]:[recipe.opening,buyer.fit,buyer.product_scope,...(legacy?[buyer.pricing_fit,currentLine]:[])];
    const closing=legacy
      ? [...(layout.mode==='concise'?[currentLine]:[]),nextLine,recipe.next_question,recipe.signature].filter(Boolean)
      : [...(layout.mode==='concise'?[]:[buyer.pricing_fit]),currentLine,nextLine,recipe.next_question,recipe.signature].filter(Boolean);
    const bodyPlain=[...intro,...selectedSections.map(s=>s.plain),...selectedOpenings.map(s=>s.plain),...closing].join('\n\n')+'\n';
    const bodyHtml='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(recipe.subject)+'</title></head>'+
      '<body style="font:16px/1.55 Arial,sans-serif;color:#17202a;max-width:800px;margin:24px auto;padding:0 16px">'+
      intro.map(paras).join('\n')+selectedSections.map(s=>s.html).join('\n')+selectedOpenings.map(s=>s.html).join('\n')+closing.map(paras).join('\n')+'</body></html>\n';
    const basis={schema:VERSION,...(legacy?{}:{render_version:renderVersion}),state:'PREPARED_UNSENT',prepared_at:recipe.prepared_at,
      source:{schema:edition.version,...source,customer:edition.customer,title:edition.title,delivery_type:edition.delivery_type,quantity:edition.quantity,currency:edition.currency,price_minor:edition.price_minor},
      original_edition_text:editionText,recipe:clone(recipe),lead_witnesses:witnesses,
      message:{to:buyer.email,subject:recipe.subject,plain:bodyPlain,html:bodyHtml},
      outputs:{plain:sha256Utf8(bodyPlain),html:sha256Utf8(bodyHtml)},
      interpretation:'Prepared content only. The original edition, prospect interest, existing delivery events and buyer decisions are unchanged. Actual sending and reply ownership remain with the original authorized case.'};
    return {...basis,sha256:sha256Utf8(JSON.stringify(canonical(basis))).sha256};
  }
  function compose(input){return composeRecord(input,3);}
  function receive(record){
    need(plain(record)&&record.schema===VERSION&&record.state==='PREPARED_UNSENT','Reopen the complete unsent value-message record.');
    need(record.render_version===undefined||record.render_version===2||record.render_version===3,'Use a supported complete message rendering version.');
    const expected=composeRecord({editionText:record.original_edition_text,recipe:record.recipe},record.render_version===undefined?1:record.render_version);
    need(JSON.stringify(canonical(expected))===JSON.stringify(canonical(record)),'The prepared message, exact source or reviewed recipe changed.');
    return expected;
  }
  function files(record){
    const r=receive(record);
    return [
      {path:'message.txt',content:r.message.plain,...r.outputs.plain},
      {path:'message.html',content:r.message.html,...r.outputs.html},
      {path:'prepared-message.json',content:json(r),...sha256Utf8(json(r))},
      {path:'message-recipe.json',content:json(r.recipe),...sha256Utf8(json(r.recipe))},
      {path:'original-customer-edition.json',content:r.original_edition_text,...sha256Utf8(r.original_edition_text)}
    ];
  }
  function sourceBindings(editionText){
    text(editionText,'Complete original customer JSON');
    const edition=JSON.parse(editionText);need(edition?.version==='dealscout.lead-pack.v1'&&Array.isArray(edition.leads),'Select the maintained complete customer edition.');
    return {source:sha256Utf8(editionText),customer:edition.customer,leads:edition.leads.map((lead,index)=>({index,organization:lead.organization,person:lead.person??'',contact_route:lead.contact_route,source_url:lead.source_url,lead_sha256:sha256Utf8(JSON.stringify(canonical(lead))).sha256}))};
  }
  return {compose,receive,files,sourceBindings,VERSION,INPUT};
}
module.exports={createLeadValueMessage};
