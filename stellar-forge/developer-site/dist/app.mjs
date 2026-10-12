import { exampleOffer, parseOffer, shown } from './offer.mjs';
import { ROLES as roles } from './recipes.mjs';

const $ = id => document.getElementById(id);
const root = 'https://github.com/woahwhattheheck/public-commons-sprint-2026';
const base = root + '/blob/main/stellar/scf-starforge-20261009/';
const steps = [
  { label: 'CLIENT → SELLER', status: 'UNSIGNED REQUEST', title: 'Begin with an ordinary HTTP request.', description: 'The client asks for a resource. No payment has been authorized or signed. A protected seller endpoint responds with the terms required to continue.', code: 'GET /dataset HTTP/1.1\nHost: seller.example\nAccept: application/json\n\n# No PAYMENT-SIGNATURE\n# No wallet connected' },
  { label: 'SELLER → CLIENT', status: '402 PAYMENT REQUIRED', title: 'Read the terms before authorizing.', description: 'The response declares payment choices. Compare the network, asset, atomic amount, recipient, and resource. A listed recipient is not proof of identity.', code: 'HTTP/1.1 402 Payment Required\nPAYMENT-REQUIRED: <Base64 JSON>\n\n' + JSON.stringify(exampleOffer, null, 2) },
  { label: 'BUYER REVIEW', status: 'EXPLICIT AUTHORIZATION', title: 'An offer does not give permission to spend.', description: 'In an integrated buyer, approval and a configured signer authorize the chosen terms. The buyer obtains a fresh challenge and enforces its policy before sending a signed retry.', code: '# Illustrative review — not a signing payload\nresource   https://seller.example/dataset\nnetwork    stellar:testnet\nscheme     exact\namount     10000 atomic units\nrecipient  INVALID_DEMO_RECIPIENT_NOT_A_WALLET\n\nauthority  A separate approval + signer are required' },
  { label: 'BUYER → NATIVE SELLER', status: 'VERIFY → EXECUTE', title: 'Keep payment logic in the native SDK.', description: 'The configured native runtime verifies the payment, invokes the application, and validates the response before settlement. Application failure follows the native cancellation path.', code: 'GET /dataset HTTP/1.1\nPAYMENT-SIGNATURE: <authorized native payload>\n\n# Simplified native seller lifecycle\nverify payment\n  → invoke application\n  → validate response\n  → request settlement\n\n# The site does not run these operations.' },
  { label: 'SELLER → BUYER', status: 'DELIVERY + RECEIPT', title: 'Keep delivery and settlement evidence distinct.', description: 'The seller releases successful content after native success. Preserve the receipt and original operation evidence; independently verify a chain transfer before treating it as confirmed settlement.', code: 'HTTP/1.1 200 OK\nContent-Type: application/json\nPAYMENT-RESPONSE: <native receipt>\n\n{"dataset": "illustrative response"}\n\nHTTP delivery        observed response\nSeller receipt       reported settlement\nIndependent evidence separate verification' }
];
let currentStep = 0;
function setStep(index) {
  currentStep = index;
  const step = steps[index];
  $('trace-label').textContent = step.label;
  $('trace-status').textContent = step.status;
  $('trace-code').textContent = step.code;
  $('trace-title').textContent = step.title;
  $('trace-description').textContent = step.description;
  $('trace-position').textContent = `0${index + 1} / 05`;
  $('next-step').textContent = index === 4 ? 'Back to start ↺' : 'Next step →';
  document.querySelectorAll('[data-step]').forEach(button => {
    const selected = Number(button.dataset.step) === index;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
}
document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => setStep(Number(button.dataset.step))));
$('next-step').addEventListener('click', () => setStep((currentStep + 1) % steps.length));

function activateTab(button) {
  const list = button.closest('[role=tablist]');
  list.querySelectorAll('[role=tab]').forEach(tab => {
    const selected = tab === button;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !selected;
  });
}
document.querySelectorAll('[role=tab]').forEach(button => {
  button.addEventListener('click', () => activateTab(button));
  button.addEventListener('keydown', event => {
    const siblings = Array.from(button.closest('[role=tablist]').querySelectorAll('[role=tab]'));
    let index = siblings.indexOf(button);
    if (event.key === 'ArrowRight') index = (index + 1) % siblings.length;
    else if (event.key === 'ArrowLeft') index = (index + siblings.length - 1) % siblings.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = siblings.length - 1;
    else return;
    event.preventDefault();
    activateTab(siblings[index]);
    siblings[index].focus();
  });
});
document.querySelectorAll('[data-open-inspector]').forEach(link => link.addEventListener('click', () => activateTab($('tab-inspector'))));

let currentRole = 'seller';
function renderRole(name) {
  currentRole = name;
  const role = roles[name];
  $('workflow-select').value = name;
  $('role-meta').textContent = role.meta;
  $('role-title').textContent = role.title;
  $('role-description').textContent = role.description;
  $('role-checklist').replaceChildren(...role.checklist.map(text => {const li = document.createElement('li'); li.textContent = text; return li;}));
  $('role-docs').href = role.docs;
  $('command-label').textContent = role.label;
  $('setup-command').textContent = role.command;
  $('command-result').textContent = role.result;
}
$('workflow-select').addEventListener('change', event => renderRole(event.target.value));
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => $('toast').hidden = true, 4000);
}
$('copy-command').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(roles[currentRole].command); toast('Setup commands copied.'); }
  catch {
    const range = document.createRange(); range.selectNodeContents($('setup-command'));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    toast('Commands selected. Copy them with your keyboard or device menu.');
  }
});

$('download-command').addEventListener('click', () => {
  const content = '# Stellar Forge: ' + roles[currentRole].title + '\n# Review the paths and configuration before running.\n# ' + roles[currentRole].docs + '\n\n' + roles[currentRole].command + '\n';
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'stellar-forge-' + currentRole + '-commands.sh';
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
  toast('Setup commands downloaded.');
});

let parsed = null;
function clearResult() { parsed = null; $('inspect-empty').hidden = false; $('inspect-result').hidden = true; $('inspect-error').hidden = true; }
function inspect() {
  try {
    parsed = parseOffer($('offer-input').value);
    $('inspect-error').hidden = true;
    $('inspect-empty').hidden = true;
    $('inspect-result').hidden = false;
    $('input-format').textContent = parsed.encoding;
    $('resource-url').textContent = shown(parsed.offer.resource?.url);
    $('payment-choice').replaceChildren(...parsed.offer.accepts.map((choice, i) => {const option = document.createElement('option'); option.value = String(i); option.textContent = `Option ${i + 1} · ${shown(choice.network)} · ${shown(choice.amount)} atomic units`; return option;}));
    $('offer-notes').replaceChildren(...(parsed.warnings.length ? parsed.warnings : ['The inspected fields have the expected basic shape. Their authenticity and payment validity have not been checked.']).map(text => {const p = document.createElement('p');p.textContent = text; return p;}));
    $('decoded-json').textContent = JSON.stringify(parsed.offer, null, 2);
    showChoice(0);
  } catch (error) { clearResult(); $('inspect-error').textContent = error.message; $('inspect-error').hidden = false; }
}
function showChoice(index) {
  const choice = parsed?.offer.accepts[index];
  if (!choice) return;
  const fields = [['Scheme','scheme'],['Network','network'],['Atomic amount','amount'],['Asset','asset'],['Recipient','payTo'],['Timeout (sec)','maxTimeoutSeconds']];
  $('terms-list').replaceChildren(...fields.map(([label,key]) => {const div = document.createElement('div'),dt = document.createElement('dt'),dd = document.createElement('dd');dt.textContent=label;dd.textContent=shown(choice[key]);div.append(dt,dd);return div;}));
}
$('inspect-form').addEventListener('submit', event => {event.preventDefault();inspect();});
$('payment-choice').addEventListener('change', () => showChoice(Number($('payment-choice').value)));
$('load-example').addEventListener('click', () => {$('offer-input').value=JSON.stringify(exampleOffer,null,2);inspect();});
$('clear-input').addEventListener('click', () => {$('offer-input').value='';clearResult();$('offer-input').focus();});
$('offer-input').addEventListener('input', clearResult);
$('download-offer').addEventListener('click', () => {
  if (!parsed) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(parsed.offer,null,2)+'\n'],{type:'application/json'}));
  const a = document.createElement('a');a.href=url;a.download='decoded-payment-offer.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Decoded offer downloaded. Terms remain unverified.');
});

const components = [
  {
    "id": "01",
    "title": "Merchant distribution",
    "code": "INSTALL / RUN",
    "kind": "seller",
    "description": "Install one local source package and launch an editable merchant workspace with the original seller and operations tools.",
    "path": "distribution/README.md"
  },
  {
    "id": "02",
    "title": "Developer workspace",
    "code": "SELLER / LIVE RESOURCES",
    "kind": "seller",
    "description": "Inspect the running merchant’s offers, method inputs, OpenAPI and request recipes.",
    "path": "sf30-seller-sdk/DEVELOPER.md"
  },
  {
    "id": "03",
    "title": "OpenAPI onboarding",
    "code": "API / IMPORT",
    "kind": "seller",
    "description": "Choose actual API operations, configure terms, prepare a private release and run it through the original seller.",
    "path": "sf61-openapi-seller-import/workspace/README.md"
  },
  {
    "id": "04",
    "title": "PostgreSQL workspace",
    "code": "DATABASE / CONFIGURE",
    "kind": "seller",
    "description": "Select source tables and metadata, configure merchant routes and produce a reusable private package.",
    "path": "sf30-seller-sdk/postgres/workspace/README.md"
  },
  {
    "id": "05",
    "title": "DuckDB and Parquet",
    "code": "DATABASE / PREPARE",
    "kind": "seller",
    "description": "Prepare paid routes from original named analytical queries, package their local data and run the original reader.",
    "path": "sf30-seller-sdk/duckdb/PREPARE.md"
  },
  {
    "id": "06",
    "title": "S3 object merchant",
    "code": "OBJECTS / DELIVERY",
    "kind": "seller",
    "description": "Describe selected objects and expose the original chunked file delivery through native merchant routes.",
    "path": "sf30-seller-sdk/s3/README.md"
  },
  {
    "id": "07",
    "title": "Native buyer workspace",
    "code": "BUYER / SETUP",
    "kind": "buyer",
    "description": "Prepare, review and execute an approved request with the original signer, spend governor and retained output.",
    "path": "sf88-operator-buyer-cli/README.md"
  },
  {
    "id": "08",
    "title": "Persistent buyer inbox",
    "code": "BUYER / OPERATIONS",
    "kind": "buyer",
    "description": "Queue prepared requests, retain outcomes and recover interrupted operations in the existing buyer.",
    "path": "sf88-operator-buyer-cli/QUEUE.md"
  },
  {
    "id": "09",
    "title": "MCP operator workspace",
    "code": "AGENTS / HISTORY",
    "kind": "buyer",
    "description": "Run the original MCP server with durable quotes, native host approval/signing and retained JSON, CSV or HTML history.",
    "url": "https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar-forge/mcp-paid-agent/DURABILITY.md"
  },
  {
    "id": "10",
    "title": "Commerce session",
    "code": "MERCHANT + BUYER",
    "kind": "operations",
    "description": "Start and reopen one persistent merchant, operations and selected buyer session through the original launchers.",
    "path": "sf66-demo-launcher/COMMERCE.md"
  },
  {
    "id": "11",
    "title": "Seller release manager",
    "code": "OPERATIONS / RELEASES",
    "kind": "operations",
    "description": "Stage and compare source configurations, explicitly activate or roll back and run the retained seller release.",
    "path": "sf82-seller-pilot/RELEASES.md"
  },
  {
    "id": "12",
    "title": "Merchant revenue operations",
    "code": "OPERATIONS / ACCOUNTING",
    "kind": "operations",
    "description": "Join original seller observations with native settlement events, delivery journals and merchant reports.",
    "path": "sf97-merchant-revenue-ops/NATIVE_RECONCILIATION.md"
  },
  {
    "id": "13",
    "title": "WooCommerce merchant setup",
    "code": "DIGITAL PRODUCT / NATIVE CHECKOUT",
    "kind": "seller",
    "description": "Import saved Woo product routes, prepare the original merchant and plugin, and complete buyer, settlement, review and download release.",
    "url": "/woo.html"
  },
  {
    "id": "14",
    "title": "OpenSearch workspace",
    "code": "SEARCH / RELEVANCE",
    "kind": "seller",
    "description": "Author native searches, retain result editions, review judged query variants and export the original merchant, customer client and relevance report.",
    "path": "sf30-seller-sdk/opensearch/workspace/README.md"
  }
];
let filter='all';
function renderComponents() {
  const query = $('toolkit-search').value.trim().toLowerCase();
  const selected=components.filter(c=>(filter==='all'||c.kind===filter)&&`${c.title} ${c.code} ${c.description}`.toLowerCase().includes(query));
  $('toolkit-rows').replaceChildren(...selected.map(c=>{
    const row=document.createElement('div');row.className='toolkit-row';
    const name=document.createElement('div');name.className='toolkit-name';
    const num=document.createElement('span');num.className='toolkit-number';num.textContent=c.id;
    const title=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=c.title;small.textContent=c.code;title.append(strong,small);name.append(num,title);
    const description=document.createElement('p');description.textContent=c.description;
    const link=document.createElement('a');link.href=c.url??base+c.path;link.textContent='Open docs ↗';link.setAttribute('aria-label',`Open ${c.title} documentation`);link.target='_blank';link.rel='noopener noreferrer';
    row.append(name,description,link);return row;
  }));
  $('toolkit-empty').hidden=selected.length!==0;
  $('toolkit-count').textContent=`${String(selected.length).padStart(2,'0')} / ${String(components.length).padStart(2,'0')} CURATED COMPONENTS`;
}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  filter=button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  renderComponents();
}));
$('toolkit-search').addEventListener('input',renderComponents);
setStep(0);renderRole('seller');renderComponents();
