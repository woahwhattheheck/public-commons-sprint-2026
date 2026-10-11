import {DEFAULT_WOO_SETUP, WOO_GUIDE, readRoute, validateWooSetup, importWooDraft, createWooPacket, createWooPluginPacket} from './woo-onboarding.mjs';
import {zipWorkspace} from './onboarding.mjs';

const $ = id => document.getElementById(id);
const fields = ['folder','storeOrigin','admissionUrl','facilitatorUrl','privateDirectory'];
const panes = ['products','connection','review','run'];
let input = structuredClone(DEFAULT_WOO_SETUP), active = 0, revision = 0, runnerPromise;

function el(tag,text,className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className; return node;
}
function button(text,action,className = 'button small') {
  const node = el('button',text,className); node.type = 'button'; node.addEventListener('click',action); return node;
}
function status(text) { $('woo-status').textContent = text; $('woo-status').hidden = !text; }
function errors(items = []) {
  $('woo-errors').hidden = !items.length;
  $('woo-error-list').replaceChildren(...items.map(item => {
    const row = el('li'); row.append(button(item.message,() => {
      step(fields.includes(item.field) ? 1 : 0); $('woo-' + item.field)?.focus();
    },'text-button')); return row;
  }));
  fields.forEach(field => $('woo-' + field).setAttribute('aria-invalid',String(items.some(item => item.field === field))));
}
function fail(error) { errors(error.errors || [{field:'import',message:error.message || 'The action could not finish.'}]); }
function changed() {
  revision++; status('Draft changed. Download a draft to keep it, or review the updated packet.');
  $('woo-title').textContent = input.folder || 'Untitled Woo setup';
  $('woo-count').textContent = `${input.routes.length} PRODUCTS`;
}
function download(content,name,type) {
  const url = URL.createObjectURL(new Blob([content],{type})), anchor = el('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),15000);
}
function safeFolder() { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.folder) ? input.folder : 'woo-merchant'; }
async function fileText(file) { return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()); }
function downloadDraft() {
  download(JSON.stringify(input,null,2) + '\n',safeFolder() + '-setup-input.json','application/json');
  status('Editable setup draft downloaded. Open that file here to restore these routes and connection settings.');
}
function terms(route,removeIndex) {
  const box = el('article',undefined,'woo-route'), head = el('div',undefined,'woo-route-head'), title = el('div');
  title.append(el('strong',route.description || 'Woo product ' + route.productId),el('code',`${route.method} ${route.url}`));
  head.append(title);
  if (removeIndex !== undefined) head.append(button('Remove',() => {
    input.routes.splice(removeIndex,1); changed(); errors(); renderRoutes();
  },'text-button'));
  const list = el('dl',undefined,'woo-terms');
  for (const [label,value] of [['Product / route',`${route.productId} / ${route.routeId}`],['Network',route.expect.network],
    ['Native atomic amount',route.expect.maxAtomic],['Asset contract',route.expect.asset],['Recipient',route.expect.payTo],
    ['Payment timeout',`${route.expect.maxTimeoutSeconds} seconds`]]) {
    const row = el('div'); row.append(el('dt',label),el('dd',value)); list.append(row);
  }
  box.append(head,list); return box;
}
function renderRoutes() {
  const list = $('woo-route-list'); list.replaceChildren();
  if (!input.routes.length) list.append(el('p','No products imported. Choose the route JSON from a saved Woo product.','woo-empty'));
  input.routes.forEach((file,index) => {
    try { list.append(terms(readRoute(file.text,file.name),index)); }
    catch (error) { const box = el('div',undefined,'woo-route-head'); box.append(el('p',error.message),button('Remove',() => {input.routes.splice(index,1); changed(); renderRoutes();})); list.append(box); }
  });
  $('woo-count').textContent = `${input.routes.length} PRODUCTS`;
}
function addRoutes(files) {
  files.forEach(file => readRoute(file.text,file.name));
  const candidate = {...input,routes:[...input.routes,...files]};
  const routeErrors = validateWooSetup(candidate).errors.filter(item => item.field === 'routes');
  if (routeErrors.length) { errors(routeErrors); return; }
  input = candidate; changed(); errors(); renderRoutes();
  status(`Imported ${files.length} saved product route${files.length === 1 ? '' : 's'}. Review the exact native terms below.`);
}
async function runner() {
  return runnerPromise ??= fetch(new URL('./woo-runner.mjs',import.meta.url),{credentials:'same-origin'}).then(async response => {
    if (!response.ok) throw new Error('The setup runner could not load. Reload this page and export again.'); return response.text();
  }).catch(error => {runnerPromise = null; throw error;});
}
async function packet() {
  const current = revision, copy = structuredClone(input), source = await runner();
  if (current !== revision) throw new Error('The draft changed during preparation. Review the updated packet again.');
  return createWooPacket(copy,source);
}
async function exportPacket() {
  try {
    const value = await packet(); download(zipWorkspace(value.files),value.summary.folder + '-setup.zip','application/zip');
    errors(); status(`Downloaded ${value.summary.routeCount} original route exports, the native runner, editable setup and full merchant/buyer instructions.`);
  } catch (error) { fail(error); }
}
function command(title,text) {
  const box = el('section',undefined,'woo-command'), head = el('div');
  head.append(el('h3',title),button('Copy',async () => {
    try { await navigator.clipboard.writeText(text); status('Command copied.'); }
    catch { status('Select the command text to copy it. The downloaded README contains the same commands.'); }
  }));
  const pre = el('pre',text); pre.tabIndex = 0; box.append(head,pre); return box;
}
function connectionSummary() {
  const result = validateWooSetup(input), box = $('woo-connection-summary'); box.replaceChildren();
  if (result.sellerOrigin) box.append(el('p','Seller origin from saved routes: ' + result.sellerOrigin,'mono'));
  if (result.admissionUrl) box.append(el('p','Admission endpoint: ' + result.admissionUrl,'mono'));
  if (result.settlementUrl) box.append(el('p','Settlement receiver: ' + result.settlementUrl,'mono'));
}
async function review() {
  const box = $('woo-review-content'); box.replaceChildren(el('p','Preparing the editable packet…','pane-intro'));
  try {
    const result = await packet(); errors(); box.replaceChildren();
    const summary = el('dl',undefined,'woo-terms');
    for (const [label,value] of [['Shop',result.summary.storeOrigin],['Admission',result.summary.admissionUrl],
      ['Settlement receiver',result.summary.settlementUrl],['Facilitator',result.summary.facilitatorUrl],
      ['Private directory',result.summary.privateDirectory]]) {const row=el('div');row.append(el('dt',label),el('dd',value));summary.append(row);}
    box.append(summary,el('h3','Exact saved product terms'));
    result.summary.routes.forEach(route => box.append(terms(route)));
    const files = el('div',undefined,'woo-file-list');
    for (const file of result.files) {
      const item = el('details'), pre = el('pre',file.content); pre.tabIndex = 0;
      item.append(el('summary',file.path),pre); files.append(item);
    }
    box.append(el('h3','Files in the packet'),files,button('Download setup ZIP',exportPacket,'button primary'));
  } catch (error) { box.replaceChildren(el('p','Complete the listed fields to prepare the merchant packet.','setup-notice')); fail(error); }
}
function run() {
  const box = $('woo-run-content'); box.replaceChildren();
  const result = validateWooSetup(input);
  if (!result.valid) { errors(result.errors); box.append(el('p','Complete the setup and review its exact terms before exporting.','setup-notice')); return; }
  errors(); box.append(button('Download setup ZIP',exportPacket,'button primary'));
  box.append(command('1. Prepare from the original toolkit','TOOLKIT=/absolute/path/to/checkout-or-installed-package\nnode merchant.mjs prepare --toolkit "$TOOLKIT"\nnode merchant.mjs inspect --toolkit "$TOOLKIT"'));
  const install = el('p',`Copy the generated wordpress-plugin/starforge-sf98-woo folder from ${input.privateDirectory} into the actual shop’s plugin directory. Activate Starforge SF98 WooCommerce Merchant Bridge and enable native checkout. Define the PHP constant SF98_WEBHOOK_SECRET in wp-config.php from the private key, then provide that same value in both Node service environments.`, 'setup-notice'); box.append(install);
  box.append(command('2. Check the real shop REST route','node merchant.mjs preflight --toolkit "$TOOLKIT"'));
  box.append(el('p','The unsigned check expects the plugin’s 401 signature response. It checks REST routing; it does not establish that the shared key matches. Enable pretty permalinks and WordPress rewrites if it reaches HTML or a missing route. It creates no order.','pane-intro'));
  box.append(command('3. Start seller and delivery worker','node merchant.mjs serve --toolkit "$TOOLKIT"\n# In a second terminal with the same private environment:\nnode merchant.mjs deliver --toolkit "$TOOLKIT"\n# Inspect the same original outbox:\nnode merchant.mjs status --toolkit "$TOOLKIT"'));
  const sequence=el('ol',undefined,'woo-run-sequence');
  for (const text of ['Point the existing seller HTTPS ingress at loopback port 8423. Keep operations on loopback 8424/private operator access; preserve exact methods, bodies, route paths and order queries.',
    'Complete a real classic or Blocks checkout for one mapped digital product. The order remains unpaid and on hold. The buyer downloads its own private handoff and follows the included BUYER.md through the original review, workspace and inbox.',
    'After native settlement, the original worker delivers its signed notice to WooCommerce. Independently reconcile the actual payment and use the original merchant release action. Woo’s normal completion and download permissions then deliver the file.',
    'For an uncertain attempt, reconcile first. Only the original merchant-attested non-settlement reset advances the generation. The buyer imports the current handoff into the same workspace, ledger and inbox; previous reservations remain until independently reconciled.']) sequence.append(el('li',text));
  box.append(sequence); const link=el('a','Open the full original operating guide ↗','text-link');link.href=WOO_GUIDE;link.target='_blank';link.rel='noopener noreferrer';box.append(link);
}
function step(index,focus = false) {
  active = index; panes.forEach((pane,i) => {$('woo-' + pane).hidden = i !== index;});
  document.querySelectorAll('[data-woo-step]').forEach((node,i) => {if(i === index) node.setAttribute('aria-current','step'); else node.removeAttribute('aria-current');});
  $('woo-back').hidden = index === 0; $('woo-next').hidden = index === 3;
  $('woo-next').textContent = ['Store connection →','Review packet →','Run and release →'][index] || '';
  if (index === 1) connectionSummary(); if (index === 2) void review(); if (index === 3) run();
  if (focus) $('woo-' + panes[index] + '-heading').focus();
}

fields.forEach(field => {
  $('woo-' + field).value = input[field];
  $('woo-' + field).addEventListener('input',event => {input[field] = event.target.value;changed();connectionSummary();});
});
document.querySelectorAll('[data-woo-step]').forEach(node => node.addEventListener('click',() => step(Number(node.dataset.wooStep),true)));
$('woo-next').addEventListener('click',() => step(active + 1,true));
$('woo-back').addEventListener('click',() => step(active - 1,true));
$('woo-download-draft').addEventListener('click',downloadDraft);
$('woo-choose-routes').addEventListener('click',() => $('woo-route-input').click());
$('woo-import-draft').addEventListener('click',() => $('woo-draft-input').click());
$('woo-plugin-download').addEventListener('click',async () => {
  try {
    const value=createWooPluginPacket(await runner());
    download(zipWorkspace(value.files),'woo-plugin-setup.zip','application/zip');
    status('Plugin preparation tool downloaded. Follow INSTALL.md to copy the complete original plugin and operating guide from your toolkit, install them in WordPress, then export the saved product routes.');
  }catch(error){fail(error);}
});
$('woo-route-input').addEventListener('change',async event => {
  try {
    const files = [...event.target.files];
    if (files.length + input.routes.length > 64 || files.some(file => file.size > 262144)) throw new Error('Choose up to 64 saved product exports, at most 256 KiB each.');
    addRoutes(await Promise.all(files.map(async file => ({name:file.name,text:await fileText(file)}))));
  } catch(error) {fail(error);} finally {event.target.value='';}
});
$('woo-draft-input').addEventListener('change',async event => {
  try {
    const file=event.target.files[0];if(!file)return;
    if(file.size>524288)throw new Error('Choose a setup draft smaller than 512 KiB.');
    input=importWooDraft(await fileText(file));changed();errors();fields.forEach(field=>{$('woo-'+field).value=input[field];});renderRoutes();step(0,true);status('Setup draft restored. Review the saved routes and current connection settings.');
  } catch(error){fail(error);}finally{event.target.value='';}
});
$('woo-paste-toggle').addEventListener('click',() => {
  $('woo-paste-panel').hidden = !$('woo-paste-panel').hidden;
  $('woo-paste-toggle').setAttribute('aria-expanded',String(!$('woo-paste-panel').hidden));
  if(!$('woo-paste-panel').hidden)$('woo-paste').focus();
});
$('woo-add-paste').addEventListener('click',() => {
  try{const text=$('woo-paste').value,route=readRoute(text);const before=input.routes.length;addRoutes([{name:`product-${route.productId}.json`,text}]);if(input.routes.length>before){$('woo-paste').value='';$('woo-paste-panel').hidden=true;$('woo-paste-toggle').setAttribute('aria-expanded','false');}}catch(error){fail(error);}
});
renderRoutes();
