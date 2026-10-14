'use strict';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function preparedDate(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('Customer edition requires its valid prepared_at date.');
  return date.getUTCDate()+' '+MONTHS[date.getUTCMonth()]+' '+date.getUTCFullYear();
}
function text(value){return String(value??'').replace(/\\/g,'\\\\').replace(/&(?=(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);)/g,'&amp;').replace(/[<>]/g,c=>({'<':'&lt;','>':'&gt;'}[c])).replace(/([*_#[\]`])/g,'\\$1');}
function field(label,value){return value?'**'+label+'.** '+text(value)+'\n\n':'';}
function block(value){
  const body=String(value??''),runs=body.match(/`+/g)||[];
  const fence='`'.repeat(Math.max(3,...runs.map(r=>r.length+1)));
  return fence+'text\n'+body+'\n'+fence+'\n\n';
}
function price(c){try{const f=new Intl.NumberFormat('en',{style:'currency',currency:c.currency});return f.format(Number(c.price_minor)/10**f.resolvedOptions().maximumFractionDigits);}catch{return String(c.currency||'')+' '+String(c.price_minor)+' minor units';}}
function href(value,mail=false){
  const s=String(value??'');
  if(mail&&/^mailto:[^@\s<>?#]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s))return s;
  if(mail&&/^tel:\+[1-9]\d{1,14}(?:;ext=\d{1,10})?$/i.test(s))return s.toLowerCase();
  const m=/^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][^\s<>"'\\]*)?$/i.exec(s);
  return m&&!m[2].includes('..')&&(!m[3]||Number(m[3])<=65535)?s:'';
}
function contactRoutes(lead){
  const found=[],seen=new Set();
  function add(value){const url=href(value,true);if(!url)return;const key=url.toLowerCase();if(!seen.has(key)){seen.add(key);found.push({url,label:url.startsWith('mailto:')?'Email':url.startsWith('tel:')?'Phone':'Contact page'});}}
  add(lead.contact_route);
  const note=String(lead.contact_instructions||'');
  const email=note.match(/(?:^|\s)Published business email:\s*([^\s<>]+)/i);
  if(email)add('mailto:'+email[1].replace(/\.$/,''));
  const phone=note.match(/(?:^|\s)Published phone:\s*(\+[1-9]\d{1,14})(?=[.\s;]|$)/i);
  if(phone)add('tel:'+phone[1]);
  return found;
}

function sourceLine(label,value){return value?'**'+label+'.** '+(href(value,true)?'<'+href(value,true)+'>':text(value))+'\n\n':'';}
function render(c){
  if(!c||typeof c.customer!=='string'||!c.customer.trim())throw new Error('Customer edition requires its customer name.');
  if(!Array.isArray(c.leads))throw new Error('Customer edition requires its lead records.');
  const by=typeof c.prepared_by==='string'&&c.prepared_by.trim()?c.prepared_by:'TokenJunkieLabs';
  const profiles=c.leads.map((l,i)=>{
    const contacts=contactRoutes(l);
    const originalTime=l.source_time_observation||{};
    return '## '+(i+1)+'. '+text(l.organization)+'\n\n'+
      field('Area',l.geography||'Area to confirm')+
      field('Contact person / role',l.person||'Decision-maker role to confirm')+
      (contacts.length?contacts.map(r=>sourceLine(r.label,r.url)).join(''):field('Published contact route',l.contact_route))+
      sourceLine('Company website',l.company_url)+
      '### '+(l.signal_type==='company_fit'?'Published workflow':l.signal_type==='paid_request'?'Published request':'Published problem')+'\n\n'+text(l.business_need)+'\n\n'+
      (l.opening_message?'### Suggested outreach for '+text(c.customer)+'\n\n'+block(l.opening_message):'')+
      '### Fit and comparison\n\n'+text(l.why_it_fits)+'\n\n'+
      '### Sources and contact details\n\n'+field('Published contact details',l.contact_instructions)+
      sourceLine('Original source',l.source_url)+
      field('Source signal',l.signal_type==='company_fit'?'Company that fits the brief':l.signal_type==='paid_request'?'Published paid request':l.signal_type==='problem_signal'?'Published problem':l.signal_type)+
      field('Source status',l.signal_type==='company_fit'&&['open','unconfirmed'].includes(l.source_status)?(l.source_checked_at||l.checked_at?'Company source reviewed':'Company source'):l.source_status)+
      field('Source context',l.status_note)+
      field(l.signal_type==='company_fit'?'Published financial context':'Published budget',l.published_budget)+
      field(l.signal_type==='company_fit'?'Source publication date':'Original request date',l.original_request_date)+
      field(l.signal_type==='company_fit'?'Last source update':'Last buyer update',l.last_buyer_update)+
      field('Source checked',l.source_checked_at)+field('Published deadline',l.deadline)+
      field('Original relative publication label',originalTime.publication_label)+
      field('Original relative closing label',originalTime.closing_label)+
      field('Labels observed',originalTime.checked_at)+sourceLine('Observed source',originalTime.source_url);
  }).join('\n');
  return '# '+text(c.title)+'\n\nPrepared for '+text(c.customer)+' by '+text(by)+' · '+preparedDate(c.prepared_at)+'\n\n'+
    c.leads.length+' profile'+(c.leads.length===1?'':'s')+(c.presentation==='value-first'?'':' · '+text(price(c)))+'\n\n'+profiles+
    '## Selection and delivery terms\n\n'+(c.presentation==='value-first'?field('Included pack price',price(c)):'')+text(c.criteria)+'\n\n'+field('Geography',c.geography)+
    field('Skills / services',(c.skills||[]).map(s=>String(s).replace(/_/g,' ')).join(', '));
}
module.exports={render};
