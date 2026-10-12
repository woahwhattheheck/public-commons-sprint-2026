import {AGENTSMITH_SCHEMA, AGENTSMITH_SOURCE, readAgentSmithBundle, importAgentSmithDraft,
  createAgentSmithPacket, sha256} from './agentsmith-onboarding.mjs';

const $ = id => document.getElementById(id);
let sourceText = '', source = null, generation = 0, assetsPromise, exporting = false;
const controls = ['packet-folder','private-directory','intent-id','actor','payer'];
const keys = ['folder','privateDirectory','intentId','actor','payer'];
const facts = ['capture-time','resource-url','http-response','offer-network','offer-amount',
  'offer-lifetime','offer-asset','offer-recipient','request-size','request-body','original-choices','request-sha','bundle-sha'];
const notice = (text, kind = 'success') => { $('notice').textContent = text; $('notice').dataset.kind = kind; $('notice').hidden = !text; };
const show = (id, value) => { $(id).textContent = value; };
const input = () => ({schema:AGENTSMITH_SCHEMA,...Object.fromEntries(controls.map((id,index)=>[keys[index],$(id).value.trim()])),sourceText});
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
  assetsPromise ??= Promise.all([asset('/agentsmith-runner.mjs'),asset('/agentsmith-capture.py'),asset('/agentsmith-LICENSE.txt')])
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
  const parsed = await readAgentSmithBundle(text);
  if (current !== generation) return false;
  sourceText = text; source = parsed;
  show('capture-time',parsed.capturedAt); show('resource-url',parsed.bundle.seller); $('resource-url').href = parsed.bundle.seller;
  show('http-response','POST 402 · facilitator GET 200');
  show('offer-network',parsed.selected.network);
  show('offer-amount',atomicUSDC(parsed.selected.amount) + ' USDC · ' + parsed.selected.amount + ' atomic units');
  show('offer-lifetime',parsed.selected.maxTimeoutSeconds + ' seconds · sponsored fees');
  show('offer-asset',parsed.selected.asset); show('offer-recipient',parsed.selected.payTo);
  show('request-size',parsed.requestBytes + ' original UTF-8 bytes'); show('request-body',parsed.bundle.requestUtf8);
  show('original-choices',JSON.stringify(parsed.offer.accepts,null,2));
  show('request-sha',parsed.bundle.challenge.requestBodySha256); show('bundle-sha',parsed.bundleSha256);
  show('source-status',label + ' · original bytes retained'); enable(true); notice(''); return true;
}
async function defaultSource() {
  const current = beginSource();
  try {
    const text = await asset('/agentsmith-source-http.json');
    if (await sha256(text) !== AGENTSMITH_SOURCE.capturedBundleSha256) throw new Error('The retained source bundle changed. Reload its matching receiving page.');
    await applySource(text,'Captured AgentSmith METAR',current);
  } catch (error) { failSource(error,current); }
}
async function selectedFile(element) {
  const file = element.files?.[0];
  if (!file) return null;
  if (file.size > 24 * 1024 * 1024) throw new Error('Open a complete source or draft of at most 24 MiB.');
  return file.text();
}
$('intent-id').value = 'agentsmith-metar-' + crypto.randomUUID();
$('load-default').addEventListener('click',defaultSource);
$('source-file').addEventListener('change',async event => {
  if (!event.target.files?.[0]) return;
  const current = beginSource();
  try { await applySource(await selectedFile(event.target),'Imported HTTP source',current); }
  catch (error) { failSource(error,current); } finally { event.target.value = ''; }
});
$('draft-file').addEventListener('change',async event => {
  if (!event.target.files?.[0]) return;
  const current = beginSource();
  try {
    const draft = importAgentSmithDraft(await selectedFile(event.target));
    if (!await applySource(draft.sourceText,'Reopened receiving draft',current)) return;
    controls.forEach((id,index)=>{ $(id).value = typeof draft[keys[index]] === 'string' ? draft[keys[index]] : ''; });
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
    const packet = await createAgentSmithPacket(saved,await nativeAssets());
    download(saved.folder + '.zip',packet.zip,'application/zip');
    notice('Receiving packet downloaded: ' + packet.files.length + ' files with the original request, source and native run guide.');
  } catch (error) { notice(error.message,'error'); }
  finally { exporting = false; enable(Boolean(source)); }
});
defaultSource();
