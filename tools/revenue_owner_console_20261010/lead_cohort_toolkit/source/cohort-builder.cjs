'use strict';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw Error(label + ' must be non-empty text');
  return value;
}
function domain(url) {
  const m = /^https:\/\/([^\/?#]+)(?:[\/?#]|$)/i.exec(required(url, 'source URL'));
  if (!m || /[@:\s]/.test(m[1])) throw Error('Use an original HTTPS business source URL');
  return m[1].toLowerCase().replace(/^www\./, '');
}
function editionNames(config) {
  const mode = config.cohort_mode ?? 'free-and-paid';
  if (mode === 'free-and-paid') return ['sample','paid'];
  if (mode === 'sample-only') return ['sample'];
  throw Error('cohort_mode must be free-and-paid or sample-only');
}
function compile(cohort, config, deps) {
  const {core, renderer, markdown} = deps;
  const at = required(config.prepared_at, 'prepared_at');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(at) || !Number.isFinite(Date.parse(at))) throw Error('prepared_at must be an actual UTC ISO timestamp');
  const names = editionNames(config);
  const sampleOnly = names.length === 1;
  const freeCount = config.pack?.brief?.sample_quantity ?? 1;
  if (!Number.isSafeInteger(freeCount) || freeCount < 1 || !Array.isArray(cohort.free) || cohort.free.length !== freeCount) throw Error('Provide the declared complete free promotional cohort');
  if (sampleOnly) {
    if (cohort.paid !== undefined && (!Array.isArray(cohort.paid) || cohort.paid.length)) throw Error('Sample-only preparation cannot include paid inventory');
  } else if (!Array.isArray(cohort.paid) || !cohort.paid.length) throw Error('Provide the declared complete paid cohort');
  if (required(cohort.customer, 'cohort customer') !== config.pack?.customer?.name) throw Error('Cohort and pack customer must match');
  if (!sampleOnly && config.pack.brief.quantity !== cohort.paid.length) throw Error('Paid quantity differs from prepared inventory');
  const profiles = [...cohort.free, ...(sampleOnly ? [] : cohort.paid)];
  if (!Array.isArray(config.lead_ids) || config.lead_ids.length !== profiles.length || new Set(config.lead_ids).size !== profiles.length) throw Error('Provide one distinct maintained lead ID per profile');
  const seen = new Set();
  const leads = profiles.map((p, i) => {
    for (const field of ['company','person','area','current_workflow','product_fit','demonstration','qualification','opening','contact_page']) required(p[field], field);
    if (!Array.isArray(p.sources) || !p.sources.length) throw Error('Every company needs original source URLs');
    p.sources.forEach(domain); domain(p.contact_page);
    const signalSource = p.signal_source_url === undefined ? p.sources[0] : required(p.signal_source_url, 'signal_source_url');
    domain(signalSource);
    if (!p.sources.includes(signalSource)) throw Error('The signal source must be one of the retained original source URLs');
    const companyDomain = domain(p.sources[0]);
    if (seen.has(companyDomain)) throw Error('Duplicate company domain: ' + companyDomain);
    seen.add(companyDomain);
    if (p.email && !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(p.email)) throw Error('Invalid published email');
    if (p.phone && !/^\+[1-9]\d{6,14}$/.test(p.phone)) throw Error('Published phone must use E.164');
    if (i >= freeCount && config.paid_email_and_phone && (!p.email || !p.phone)) throw Error('Paid profile lacks the promised email and phone');
    const contact = p.email ? 'mailto:' + p.email : p.phone ? 'tel:' + p.phone : p.contact_page;
    const instructions = (p.email ? 'Published business email: ' + p.email + '. ' : '') +
      (p.phone ? 'Published phone: ' + p.phone + '. ' : '') +
      'Contact page: ' + p.contact_page + '. Original sources: ' + p.sources.join(' ; ');
    return {
      lead_kind:'company_fit', checked_at:at, source_status:'open',
      status_note:required(config.status_note,'status_note'),
      published_on:'',author_updated_on:'',deadline_on:'',deadline_at:'',budget:'',buyer_key:'',
      id:required(config.lead_ids[i],'lead ID'),organization:p.company,
      company_domain:companyDomain,company_url:p.sources[0].split('/').slice(0,3).join('/')+'/',
      person:p.person,source_url:signalSource,demand:p.current_workflow,
      fit:p.product_fit+'\n\nDemonstration: '+p.demonstration+'\n\nQualification: '+p.qualification,
      contact_url:contact,contact_instructions:instructions,geography:p.area,opening_message:p.opening,
      tags:[i >= freeCount?(config.paid_tag||'paid-pack'):(config.sample_tag||'free-sample'),...(config.lead_tags||[])],
      operator_note:required(config.lead_operator_note,'lead_operator_note')
    };
  });
  const pack = JSON.parse(JSON.stringify(config.pack));
  if (!Object.hasOwn(pack.brief, 'customer_title')) pack.brief.customer_title = required(pack.brief.title, 'customer-facing title');
  const operations = [];
  let ledger = {};
  function apply(kind,input) {
    const body = {operation_id:required(config.operation_prefix,'operation_prefix')+'-0'+(operations.length+1),kind,expected_root_sha256:core.leadFulfillmentState(ledger).root_sha256,input};
    ledger = core.applyLeadFulfillment(ledger,body,at).ledger;
    operations.push({body,at});
  }
  apply('pack-save',pack);
  apply('leads-save',{pack_id:pack.id,leads});
  apply('edition-prepare',{pack_id:pack.id,id:required(config.editions?.sample,'sample edition ID'),kind:'sample',lead_ids:leads.slice(0,freeCount).map(p=>p.id)});
  if (!sampleOnly) apply('edition-prepare',{pack_id:pack.id,id:required(config.editions?.paid,'paid edition ID'),kind:'paid',lead_ids:leads.slice(freeCount).map(p=>p.id)});
  const record = core.leadFulfillmentExport(ledger,{packId:pack.id,format:'working-record'}).value;
  const assembly = core.createLeadFulfillmentAssembly({});
  assembly.receive(record,{operationId:config.operation_prefix+'-compiled-independent-receive',asOf:at});
  if(JSON.stringify(assembly.export({packId:pack.id,format:'working-record'}).value)!==JSON.stringify(record)) throw Error('Independent original-core receive differs');
  const customerFiles = {};
  for(const name of names) {
    const edition = {...assembly.export({packId:pack.id,editionId:config.editions[name],format:'json'}).value,prepared_by:required(cohort.prepared_by,'prepared_by')};
    for(const [ext,body] of [['json',JSON.stringify(edition,null,2)+'\n'],['html',renderer.renderLeadPackHTML(edition)],['csv',renderer.leadPackCSV(edition)],['md',markdown.render(edition)]]) {
      customerFiles['customer/'+name+'.'+ext] = body;
    }
  }
  return {input:{pack,leads},operations,record,customerFiles};
}
module.exports = {compile, editionNames};
