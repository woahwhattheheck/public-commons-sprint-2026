const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KIND={sample:'Free sample',paid:'Paid lead pack',replacement:'Replacement pack'};
const SIGNAL={paid_request:'Published paid request',problem_signal:'Published problem',company_fit:'Company that fits the brief'};
const STATUS={open:'Open',unconfirmed:'Availability unconfirmed',closed:'Closed',expired:'Expired',excluded:'Excluded'};
function sourceStatus(lead){
  const kind=lead.signal_type||lead.lead_kind;
  if(kind==='company_fit'&&['open','unconfirmed'].includes(lead.source_status)){
    return lead.source_checked_at||lead.checked_at?'Company source reviewed':'Company source';
  }
  return STATUS[lead.source_status]||lead.source_status||'';
}

function href(value,mail=false){
  const s=String(value??'');
  if(mail&&/^mailto:[^@\s<>?#]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s))return s;
  if(mail&&/^tel:\+[1-9]\d{1,14}(?:;ext=\d{1,10})?$/i.test(s))return s.toLowerCase();
  const m=/^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][^\s<>"'\\]*)?$/i.exec(s);
  return m&&!m[2].includes('..')&&(!m[3]||Number(m[3])<=65535)?s:'';
}
function link(value,mail=false){const url=href(value,mail);const label=mail&&/^mailto:/i.test(url)?url.slice(7):mail&&url.startsWith('tel:')?url.slice(4).replace(';ext=',' ext. '):value;return url?'<a href="'+esc(url)+'" rel="noopener noreferrer">'+esc(label)+'</a>':esc(value);}
function pair(label,value){return value?'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>':'';}
function sourceTimePairs(observation){
  if(!observation)return '';
  return pair('Original relative publication label',observation.publication_label)+
    pair('Original relative closing label',observation.closing_label)+
    pair('Labels observed',dateLabel(observation.checked_at))+
    '<dt>Observed source</dt><dd>'+link(observation.source_url)+'</dd>';
}
function money(minor,currency){
  try{const options=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions();return new Intl.NumberFormat('en',{style:'currency',currency}).format(Number(minor)/10**options.maximumFractionDigits);}catch{return esc(currency)+' '+esc(minor)+' minor units';}
}
function dateLabel(value,dateOnly=false){
  const raw=String(value??'');if(!raw)return '';
  const isDate=/^\d{4}-\d\d-\d\d$/.test(raw);
  if(!isDate&&!/^\d{4}-\d\d-\d\dT/.test(raw))return raw;
  const date=new Date(isDate?raw+'T12:00:00Z':raw);
  if(!Number.isFinite(date.getTime()))return raw;
  const day=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(date);
  if(isDate||dateOnly)return day;
  const iso=date.toISOString();
  const time=iso.slice(17,19)==='00'?iso.slice(11,16):iso.slice(11,19);
  return day+', '+time+' UTC';
}
const serviceLabel=value=>String(value??'').replace(/_/g,' ');
function contactKind(lead){
  const route=href(lead.contact_route,true).toLowerCase();
  return route.startsWith('mailto:')?'email':route.startsWith('tel:')?'phone':route?'web':'other';
}
function contactSummary(leads){
  const counts={email:0,phone:0,web:0,other:0};
  for(const lead of leads)counts[contactKind(lead)]++;
  return Object.entries(counts).filter(([,count])=>count).map(([kind,count])=>
    count+' '+({email:'email route',phone:'phone route',web:'web route',other:'other contact route'}[kind])+(count===1?'':'s')).join(' · ');
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
function contactPairs(lead){
  const routes=contactRoutes(lead);
  return routes.length?routes.map(r=>'<dt>'+esc(r.label)+'</dt><dd>'+link(r.url,true)+'</dd>').join(''):
    pair('Published contact route',lead.contact_route);
}
function packIndex(leads){
  if(leads.length<2)return '';
  return '<nav class="contents" aria-labelledby="contents-title"><h2 id="contents-title">Profiles</h2>'+
    '<div class="table-wrap"><table><thead><tr><th scope="col">Company or buyer</th><th scope="col">Published contact</th></tr></thead><tbody>'+
    leads.map((lead,index)=>'<tr><th scope="row"><a href="#lead-'+(index+1)+'">'+esc(index+1)+'. '+esc(lead.organization)+'</a></th>'+
      '<td>'+contactRoutes(lead).map(r=>link(r.url,true)).join('<br>')+'</td></tr>').join('')+'</tbody></table></div></nav>';
}
function renderLeadPackHTML(customerEdition){
  const d=customerEdition,leads=Array.isArray(d.leads)?d.leads:[];
  const css="#lead-customer-report,#lead-customer-report *{box-sizing:border-box}#lead-customer-report{color-scheme:light;max-width:960px;width:100%;margin:0 auto;padding:32px 28px;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#202020;background:#fff}#lead-customer-report :is(h1,h2,h3,p,dl,dt,dd,th,td,li,strong,em,span,div,section){color:#202020}#lead-customer-report h1{font-size:28px;line-height:1.2;margin:6px 0 12px}#lead-customer-report h2{font-size:21px;line-height:1.3;margin:0 0 12px}#lead-customer-report h3{font-size:16px;margin:22px 0 8px}#lead-customer-report header{border-bottom:2px solid #333;padding-bottom:18px;margin-bottom:24px}#lead-customer-report .eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.07em;margin:0;color:#555}#lead-customer-report .meta{font-size:14px;margin:6px 0;color:#444}#lead-customer-report .terms{padding:20px;background:#f5f5f5;border:1px solid #ccc;margin-top:30px}#lead-customer-report article{padding:24px 0 30px;border-bottom:1px solid #bbb;scroll-margin-top:16px}#lead-customer-report .area{margin:0 0 12px}#lead-customer-report dl{display:grid;grid-template-columns:minmax(120px,1fr) 4fr;gap:7px 16px}#lead-customer-report dt{font-weight:600}#lead-customer-report dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}#lead-customer-report p{white-space:pre-wrap;overflow-wrap:anywhere}#lead-customer-report table{width:100%;border-collapse:collapse}#lead-customer-report th,#lead-customer-report td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}#lead-customer-report thead th{font-size:13px;background:#f4f4f4}#lead-customer-report .table-wrap{overflow-x:auto}#lead-customer-report .contents{margin:24px 0}#lead-customer-report a{color:#222;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}#lead-customer-report a:focus-visible{outline:2px solid #333;outline-offset:3px}#lead-customer-report .opening{padding:18px;border-left:3px solid #777;background:#f7f7f7;white-space:pre-wrap;overflow-wrap:anywhere}#lead-customer-report .source-details{font-size:14px}#lead-customer-report footer{margin-top:24px;font-size:13px;color:#555}@media(max-width:600px){#lead-customer-report{padding:22px 16px}#lead-customer-report dl{display:block}#lead-customer-report dt{margin-top:10px}#lead-customer-report th,#lead-customer-report td{padding:8px 6px}#lead-customer-report .opening{padding:14px}}@media print{#lead-customer-report{max-width:none;padding:0;font:10.5pt/1.35 Arial,Helvetica,sans-serif}#lead-customer-report h1{font-size:22pt}#lead-customer-report h2{font-size:16pt}#lead-customer-report h3{font-size:12pt}#lead-customer-report .contents{display:none}#lead-customer-report article{break-before:page;border:0;padding:14px 0}#lead-customer-report header+article{break-before:auto}#lead-customer-report header+.contents+article{break-before:auto}#lead-customer-report h2,#lead-customer-report h3,#lead-customer-report dt{break-after:avoid}#lead-customer-report p{orphans:3;widows:3}#lead-customer-report .opening{background:#fff;break-inside:avoid}#lead-customer-report .terms{background:#fff;break-before:page}#lead-customer-report a{text-decoration:underline}}";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(d.title)+' · '+esc(d.customer)+'</title><style>'+css+'</style></head><body><main id="lead-customer-report"><header>'+
    '<p class="eyebrow">'+esc(d.presentation==='value-first'?'Prospect research':KIND[d.delivery_type]||d.delivery_type)+'</p><h1>'+esc(d.title)+'</h1>'+
    '<p class="meta">Prepared for '+esc(d.customer)+' · '+esc(dateLabel(d.prepared_at,true))+'</p>'+
    '<p class="meta">'+esc(leads.length)+' profile'+(leads.length===1?'':'s')+' · '+esc(contactSummary(leads))+(d.presentation==='value-first'?'':' · '+money(d.price_minor,d.currency))+'</p></header>'+
    packIndex(leads)+
    leads.map((lead,index)=>'<article id="lead-'+(index+1)+'"><h2>'+esc(index+1)+'. '+esc(lead.organization)+'</h2>'+
      (lead.geography?'<p class="area">'+esc(lead.geography)+'</p>':'')+
      '<dl class="contact">'+pair('Contact person / role',lead.person)+contactPairs(lead)+
      (lead.company_url?'<dt>Company website</dt><dd>'+link(lead.company_url)+'</dd>':'')+'</dl>'+
      '<h3>'+esc(lead.signal_type==='company_fit'?'Published workflow':lead.signal_type==='paid_request'?'Published request':'Published problem')+'</h3><p>'+esc(lead.business_need)+'</p>'+
      (lead.opening_message?'<h3>Suggested outreach for '+esc(d.customer)+'</h3><div class="opening">'+esc(lead.opening_message)+'</div>':'')+
      '<h3>Fit and comparison</h3><p>'+esc(lead.why_it_fits)+'</p>'+
      '<section class="source-details"><h3>Sources and contact details</h3>'+
      (lead.contact_instructions?'<p>'+esc(lead.contact_instructions)+'</p>':'')+
      '<dl><dt>Original source</dt><dd>'+link(lead.source_url)+'</dd>'+
      pair('Source signal',SIGNAL[lead.signal_type]||lead.signal_type)+pair('Source status',sourceStatus(lead))+
      pair('Source context',lead.status_note)+pair(lead.signal_type==='company_fit'?'Published financial context':'Published budget',lead.published_budget)+
      pair(lead.signal_type==='company_fit'?'Source publication date':'Original request date',dateLabel(lead.original_request_date))+
      pair(lead.signal_type==='company_fit'?'Last source update':'Last buyer update',dateLabel(lead.last_buyer_update))+
      pair('Source checked',dateLabel(lead.source_checked_at))+pair('Published deadline',dateLabel(lead.deadline))+
      sourceTimePairs(lead.source_time_observation)+'</dl></section></article>').join('')+
    '<section class="terms" aria-labelledby="terms-title"><h2 id="terms-title">Selection and delivery terms</h2>'+(d.presentation==='value-first'?'<p>'+esc(KIND[d.delivery_type]||d.delivery_type)+' · '+money(d.price_minor,d.currency)+'</p>':'')+'<p>'+esc(d.criteria)+'</p>'+
      '<dl>'+pair('Geography',d.geography)+pair('Skills / services',(d.skills||[]).map(serviceLabel).join(', '))+'</dl></section>'+
    '<footer>Research and preparation: TokenJunkieLabs · '+esc(dateLabel(d.prepared_at,true))+' · '+esc(d.customer)+'</footer></main></body></html>';
}
const CSV_FIELDS=[
  ['organization','Company or buyer'],['company_url','Company website'],['person','Contact name'],
  ['signal_type','Source signal'],['source_status','Current source status'],['status_note','Status context'],
  ['business_need','Published need or workflow'],['why_it_fits','Why it fits'],['source_url','Original source URL'],
  ['original_request_date','Original request date'],['last_buyer_update','Last buyer update'],
  ['source_checked_at','Source checked'],['deadline','Published deadline'],['contact_route','Published contact route'],
  ['contact_instructions','Contact instructions'],['geography','Lead geography'],['published_budget','Published budget'],
  ['opening_message','Suggested opening message']
];
const SOURCE_TIME_CSV_FIELDS=[
  ['observed_publication_label','Original relative publication label'],
  ['observed_closing_label','Original relative closing label'],
  ['observed_checked_at','Labels observed'],['observed_source_url','Observed source URL']
];
function customerCell(lead,key){
  if(key.startsWith('observed_')){
    const value=lead.source_time_observation?.[key.slice('observed_'.length)]??'';
    return key==='observed_checked_at'?dateLabel(value):value;
  }
  if(key==='signal_type')return SIGNAL[lead[key]]||lead[key];
  if(key==='source_status')return sourceStatus(lead);
  if(['original_request_date','last_buyer_update','source_checked_at','deadline'].includes(key))return dateLabel(lead[key]);
  return lead[key];
}
function csvCell(value){
  let s=String(value??'');
  if(typeof value!=='number'&&/^[\s]*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function leadPackCSV(customerEdition){
  const d=customerEdition,metadata=['Prepared by','Customer','Pack title','Delivery type','Prepared on','Criteria','Requested geography','Skills or services','Pack quantity','Currency','Pack price'];
  const fields=(d.leads||[]).some(lead=>lead.source_time_observation)?[...CSV_FIELDS,...SOURCE_TIME_CSV_FIELDS]:CSV_FIELDS;
  const head=[...metadata,...fields.map(([,label])=>label)].map(csvCell).join(',');
  const rows=(d.leads||[]).map(lead=>['TokenJunkieLabs',d.customer,d.title,KIND[d.delivery_type]||d.delivery_type,dateLabel(d.prepared_at,true),d.criteria,d.geography,(d.skills||[]).map(serviceLabel).join('; '),d.quantity,d.currency,money(d.price_minor,d.currency),
    ...fields.map(([key])=>customerCell(lead,key))].map(csvCell).join(','));
  return '\ufeff'+[head,...rows].join('\r\n')+'\r\n';
}

module.exports={renderLeadPackHTML,leadPackCSV};
