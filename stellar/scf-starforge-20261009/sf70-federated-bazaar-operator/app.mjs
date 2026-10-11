// MIT. Browser uses DOM textContent exclusively for external native provider data.
const $ = id => document.getElementById(id);
const results = $('results');
const sources = $('sources');
const state = {data:null,loading:false};
const elem = (tag, className = '', content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
};
const show = (value, fallback = 'Not declared') => typeof value === 'string' && value.trim() ? value : fallback;
const short = (s, n=500) => show(s).slice(0,n);

function renderSource(source) {
  const isAvailable = source.status === 'COMPLETE_GET_CAPTURE';
  const card = elem('article','source '+(isAvailable?'okay':'failed'));
  card.append(elem('strong','',source.name + ' · ' + (isAvailable?'Native GET captured':'Source unavailable')));
  card.append(elem('p','',short(source.endpoint)));
  if (isAvailable) {
    card.append(elem('p','',source.rows + ' rows across ' + source.pages + ' page(s) · '+source.coverage+
      (source.declaredTotal === null ? '' : ' · declared total '+source.declaredTotal)));
  } else card.append(elem('p','error','Fetch did not complete: '+short(source.error,180)));
  return card;
}

function detail(container, name, value) {
  const div=elem('p','detail');
  div.append(elem('b','',name+'  '),elem('span','',short(value,800)));
  container.append(div);
}

function renderPayment(option, index) {
  const section=elem('section','terms');
  section.append(elem('h4','',`Declared option ${index + 1}`));
  detail(section,'Network',option.network);
  detail(section,'Scheme',option.scheme);
  detail(section,'Asset',option.asset);
  detail(section,'Atomic amount',option.amount);
  detail(section,'Pay to',option.payTo);
  return section;
}

function renderListing(listing) {
  const card=elem('article','listing');
  const top=elem('div','listing-top');
  const source=elem('span','chip '+listing.source,listing.source.toUpperCase());
  const id=elem('span','index','Source row '+listing.sourceRow);
  top.append(source,id);
  card.append(top);
  card.append(elem('h3','',short(listing.label,200)));
  if (listing.description) card.append(elem('p','description',short(listing.description)));
  detail(card,'Resource URL (not invoked)',listing.url);
  if (listing.method) detail(card,'HTTP method',listing.method);
  if (listing.kind) detail(card,'Type',listing.kind);
  if (listing.toolName) detail(card,'MCP tool',listing.toolName);
  const section=elem('div','options');
  section.append(elem('h4','options-title',listing.paymentOptions.length+' observed payment option(s)'));
  for (const [index,option] of listing.paymentOptions.entries()) section.append(renderPayment(option,index));
  if (listing.hiddenPaymentOptions) section.append(elem('p','warning','Additional options not displayed: '+listing.hiddenPaymentOptions));
  card.append(section);
  return card;
}

function renderListings() {
  if (!state.data) return;
  const q=$('query').value.trim().toLocaleLowerCase();
  const source=$('provider').value;
  const visible=state.data.listings.filter(row =>
    (!source || row.source===source) &&
    (!q || [row.label,row.url,row.description,row.kind,row.toolName].some(x=>String(x??'').toLocaleLowerCase().includes(q))));
  $('matches').textContent=visible.length+' of '+state.data.listings.length+' native source rows match filters; separate provider observations are not merged.';
  results.replaceChildren();
  if (!visible.length) {
    results.append(elem('p','empty','No observed rows match this filter. This does not imply a seller is absent from all Bazaar providers.'));
    return;
  }
  const LIMIT=300;
  const grid=document.createDocumentFragment();
  for (const row of visible.slice(0,LIMIT)) grid.append(renderListing(row));
  if (visible.length>LIMIT) grid.append(elem('p','warning','Displayed first 300 matching rows; narrow your search to see others.'));
  results.append(grid);
}

async function load() {
  if(state.loading)return;
  state.loading=true;
  $('refresh').disabled=true;
  $('status').textContent='Performing the original public GETs with native pagination…';
  $('status').className='status';
  try {
    const response=await fetch('/api/federated',{method:'GET',cache:'no-store',credentials:'omit'});
    const data=await response.json();
    if(!Array.isArray(data.sources)||!Array.isArray(data.listings))throw new Error(data.error||'Invalid native federation response');
    state.data=data;
    const good=data.sources.filter(x=>x.status==='COMPLETE_GET_CAPTURE').length;
    $('row-count').textContent=data.observedListingRows;
    $('source-count').textContent=good+' / '+data.sources.length;
    $('time').textContent=new Date(data.observedAt).toLocaleTimeString();
    sources.replaceChildren(...data.sources.map(renderSource));
    $('status').className='status'+(good!==data.sources.length?' caution':'');
    $('status').textContent=data.state==='BOTH_SOURCES_COMPLETE'?
      'Both independent original-source catalogs captured. Browse complete native advertised rows.' :
      'Source coverage is incomplete. Available entries are shown with provider errors; do not infer absence in unavailable sources.';
    renderListings();
  } catch(error) {
    $('status').textContent='Unable to load source catalogs: '+String(error.message).slice(0,150);
    $('status').className='status caution';
    if(!state.data)results.replaceChildren(elem('p','empty','No current original-source observations.'));
  } finally {state.loading=false;$('refresh').disabled=false;}
}
$('filters').addEventListener('submit',e=>e.preventDefault());
$('query').addEventListener('input',renderListings);
$('provider').addEventListener('change',renderListings);
$('refresh').addEventListener('click',load);
load();