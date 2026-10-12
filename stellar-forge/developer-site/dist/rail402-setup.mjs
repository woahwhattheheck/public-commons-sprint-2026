import {RAIL402_SCHEMA, RAIL402_SOURCE, readRail402Bundle, importRail402Draft,
  createRail402Packet, sha256} from './rail402-onboarding.mjs';

const $ = id => document.getElementById(id);
let sourceText = '', source = null, generation = 0, assetsPromise, indexPromise, exporting = false;
const controls = ['packet-folder','private-directory','intent-id','actor','payer'];
const keys = ['folder','privateDirectory','intentId','actor','payer'];
const facts = ['capture-time','resource-url','http-response','offer-network','offer-amount',
  'offer-lifetime','offer-asset','offer-recipient','request-size','request-body','original-choices','request-sha','bundle-sha'];
const notice = (text, kind = 'success') => { $('notice').textContent = text; $('notice').dataset.kind = kind; $('notice').hidden = !text; };
const show = (id, value) => { $(id).textContent = value; };
const input = () => ({schema:RAIL402_SCHEMA,...Object.fromEntries(controls.map((id,index)=>[keys[index],$(id).value.trim()])),sourceText});
const enable = value => { $('download-packet').disabled = !value || exporting; $('save-draft').disabled = !value || exporting; };
function atomicUSDC(value) {
  const padded = value.padStart(8,'0');
  return padded.slice(0,-7) + '.' + padded.slice(-7).replace(/0+$/,'').padEnd(1,'0');
}
async function asset(path, limit = 24 * 1024 * 1024) {
  const response = await fetch(path,{credentials:'same-origin',cache:'no-cache'});
  if (!response.ok) throw new Error('The receiving file could not be loaded: ' + path + ' (HTTP ' + response.status + ').');
  const text = await response.text();
  if (new TextEncoder().encode(text).length > limit) throw new Error('The receiving file exceeds its size limit.');
  return text;
}
function nativeAssets() {
  assetsPromise ??= Promise.all([asset('/rail402-runner.mjs'),asset('/rail402-capture.py'),asset('/rail402-LICENSE.txt')])
    .then(([runnerSource,captureSource,licenseSource]) => ({runnerSource,captureSource,licenseSource}))
    .catch(error => { assetsPromise = undefined; throw error; });
  return assetsPromise;
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function beginSource() {
  enable(false); sourceText = ''; source = null;
  show('source-status','Reading original request and response bytes…');
  facts.forEach(id=>show(id,'Loading…')); $('resource-url').removeAttribute('href');
  return ++generation;
}
function failSource(error, current) {
  if (current !== generation) return;
  facts.forEach(id=>show(id,'—')); $('resource-url').removeAttribute('href');
  show('source-status','Choose a complete original source bundle.');
  notice(error.message,'error'); enable(false);
}
async function applySource(text, label, current) {
  const parsed = await readRail402Bundle(text);
  if (current !== generation) return false;
  sourceText = text; source = parsed;
  show('capture-time',parsed.capturedAt); show('resource-url',parsed.bundle.seller); $('resource-url').href = parsed.bundle.seller;
  show('http-response',parsed.bundle.method + ' 402 · facilitator GET 200');
  show('offer-network',parsed.selected.network);
  show('offer-amount',atomicUSDC(parsed.selected.amount) + ' USDC · ' + parsed.selected.amount + ' atomic units');
  show('offer-lifetime',parsed.selected.maxTimeoutSeconds + ' seconds · sponsored fees');
  show('offer-asset',parsed.selected.asset); show('offer-recipient',parsed.selected.payTo);
  show('request-size',parsed.requestBytes + ' original UTF-8 bytes');
  show('request-body',parsed.bundle.method === 'GET' ? parsed.bundle.seller : parsed.bundle.requestUtf8);
  show('request-label',parsed.bundle.method === 'GET' ? 'Original URL and query' : 'Original JSON body');
  show('original-choices',JSON.stringify(parsed.offer.accepts,null,2));
  show('request-sha',parsed.bundle.challenge.requestBodySha256); show('bundle-sha',parsed.bundleSha256);
  show('source-status',label + ' · original bytes retained'); enable(true); notice(''); return true;
}
async function capturedSources() {
  indexPromise ??= asset('/rail402-captures.json',65536).then(text => {
    const index = JSON.parse(text);
    if (index.schema !== 'stellar-forge.rail402.captures.v1' || !Array.isArray(index.captures) ||
        index.captures.length !== 3) throw new Error('Load the complete original merchant source index.');
    const expected = new Set(['weather','profile','translate']);
    for (const entry of index.captures) {
      if (!expected.delete(entry.id) || entry.path !== '/rail402-source-' + entry.id + '.json' ||
          typeof entry.label !== 'string' || typeof entry.behavior !== 'string' ||
          !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('The retained source index changed.');
    }
    return index.captures;
  }).catch(error => { indexPromise = undefined; throw error; });
  return indexPromise;
}
async function defaultSource() {
  const current = beginSource();
  try {
    const chosen = $('capture-choice').value;
    const entry = (await capturedSources()).find(row => row.id === chosen);
    if (!entry) throw new Error('Select one of the original merchant requests.');
    const text = await asset(entry.path);
    if (await sha256(text) !== entry.sha256) throw new Error('The retained source bundle changed. Reload its matching receiving page.');
    if (await applySource(text,entry.label,current)) show('source-meaning',entry.behavior);
  } catch (error) { failSource(error,current); }
}
async function selectedFile(element) {
  const file = element.files?.[0];
  if (!file) return null;
  if (file.size > 24 * 1024 * 1024) throw new Error('Open a complete source or draft of at most 24 MiB.');
  return file.text();
}
$('intent-id').value = 'rail402-weather-' + crypto.randomUUID();
$('capture-choice').addEventListener('change',() => {
  const choice = $('capture-choice').value;
  $('intent-id').value = 'rail402-' + choice + '-' + crypto.randomUUID();
  $('packet-folder').value = 'rail402-' + choice + '-receiving';
  $('private-directory').value = '';
  defaultSource();
});
$('load-default').addEventListener('click',defaultSource);
$('source-file').addEventListener('change',async event => {
  if (!event.target.files?.[0]) return;
  const current = beginSource();
  try { if (await applySource(await selectedFile(event.target),'Imported HTTP source',current)) show('source-meaning','Imported merchant request. The complete original response and selected terms are shown below.'); }
  catch (error) { failSource(error,current); } finally { event.target.value = ''; }
});
$('draft-file').addEventListener('change',async event => {
  if (!event.target.files?.[0]) return;
  const current = beginSource();
  try {
    const draft = importRail402Draft(await selectedFile(event.target));
    if (!await applySource(draft.sourceText,'Reopened receiving draft',current)) return;
    controls.forEach((id,index)=>{ $(id).value = typeof draft[keys[index]] === 'string' ? draft[keys[index]] : ''; });
    show('source-meaning','The saved draft retains its original merchant request and receiving settings.');
    notice('Draft reopened with its original request and stable operation ID.');
  } catch (error) { failSource(error,current); } finally { event.target.value = ''; }
});
$('save-draft').addEventListener('click',()=>{
  if (!source) return;
  download('setup-input.json',JSON.stringify(input(),null,2) + '\n','application/json');
  notice('Editable draft downloaded. Open this file here to continue the same preparation.');
});
$('receiving-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (!source || exporting) return;
  const saved = input();
  exporting = true; enable(false);
  try {
    const packet = await createRail402Packet(saved,await nativeAssets());
    download(saved.folder + '.zip',packet.zip,'application/zip');
    notice('Receiving packet downloaded: ' + packet.files.length + ' files with the original request, source and native run guide.');
  } catch (error) { notice(error.message,'error'); }
  finally { exporting = false; enable(Boolean(source)); }
});
defaultSource();
