import {inflateRawSync} from 'node:zlib';
import {receiveIssuerContext} from './grant-issuer-context.mjs';
import {selectedIssuerContext,MAX_ISSUER_BYTES} from './dist/grant-issuer-core.mjs';
import {selectIssuerProgramme,reopenIssuerProgramme,issuerContextSection} from './dist/grant-issuer-source.mjs';
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, join, basename} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {ENVELOPE, MAX_BYTES, validateDraft, makeSource, createDraft, importFormMap, exportFormMap, measureText, applicationOutput} from './dist/grant-submission-core.mjs';
import {emptyHandover} from './dist/grant-handover-core.mjs';
import {openDraftEnvelope, createDraftEnvelope, verifyHandover, createSourceBundle, retainSourceBundle, prepareSubmission,
  fileBytes,MAX_SOURCE_PACKAGE_BYTES,openReviewerSourcePackage,receiveReviewerSource,reviewerSourceFromDraft,createReviewerSourcePackage} from './dist/grant-handover-source.mjs';

// MIT. Command-line receiving for the original SCF submission model.
const EXPORT_SCHEMA = 'stellar-forge.grant-cli-export.v1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const copy = value => JSON.parse(JSON.stringify(value));
const nativePlanningOptions={digest:async bytes=>sha256(bytes),inflate:async(bytes,maximum)=>new Uint8Array(inflateRawSync(bytes,{maxOutputLength:maximum}))};

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function fieldFilename(index, id) {
  const slug = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0,60) || 'field';
  return String(index + 1).padStart(2, '0') + '-' + slug + '.txt';
}
function exceeded(field, counts) {
  return (field.wordLimit !== null && counts.words > field.wordLimit) ||
    (field.characterLimit !== null && field.characterMethod !== 'unspecified' && counts[field.characterMethod] > field.characterLimit);
}

export function renderExportReview(prepared) {
  const cards = prepared.fields.map((field, index) => {
    const id = 'field-' + index;
    const limits = [];
    if (field.wordLimit !== null) limits.push(field.wordLimit + ' whitespace-counted words');
    if (field.characterLimit !== null) limits.push(field.characterLimit + ' ' + field.characterMethod);
    const issues = field.issues.length ? '<ul>' + field.issues.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ul>' : '';
    return '<section><header><h2>' + escapeHtml(field.label) + '</h2><button type="button" data-copy="' + id + '">Copy text</button></header>' +
      '<p class="counts">' + field.counts.words + ' words · ' + field.counts.characters + ' Unicode code points · ' + field.counts.utf16 + ' UTF-16 units · ' + field.counts.utf8Bytes + ' UTF-8 bytes</p>' +
      '<p>' + escapeHtml(limits.length ? 'Recorded limits: ' + limits.join('; ') : 'No issuer limits recorded for this selection.') + '</p>' + issues +
      '<label class="sr-only" for="' + id + '">' + escapeHtml(field.label) + '</label><textarea id="' + id + '" readonly spellcheck="false">\n' + escapeHtml(field.value) +
      '</textarea><pre class="print-value"><span>' + escapeHtml(field.value) + '</span></pre></section>';
  }).join('\n');
  const script = "document.addEventListener('click',async function(event){var button=event.target.closest('button[data-copy]');if(!button)return;var area=document.getElementById(button.dataset.copy),copied=false;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(area.value);copied=true;}}catch(error){}if(!copied){area.focus();area.select();try{copied=document.execCommand('copy');}catch(error){}}document.getElementById('copy-status').textContent=copied?'Text copied.':'Text selected. Use your device copy command.';});";
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>' + escapeHtml(prepared.title) + ' — prepared answers</title><style>' +
    '*{box-sizing:border-box}body{margin:0;color:#181818;background:#f4f4f4;font:16px/1.5 system-ui,sans-serif}main{max-width:960px;margin:auto;padding:40px 24px}h1{font-size:30px;line-height:1.2}h2{font-size:21px;margin:0}section{background:white;border:1px solid #a9a9a9;padding:24px;margin:24px 0}section header{display:flex;justify-content:space-between;align-items:center;gap:20px}button{background:white;color:#111;border:1px solid #333;padding:9px 16px;cursor:pointer;font:inherit;white-space:nowrap}button:focus-visible,textarea:focus-visible{outline:2px solid #111;outline-offset:3px}.counts{font-size:14px}textarea{display:block;width:100%;height:330px;resize:vertical;border:1px solid #999;padding:12px;color:#111;background:#fff;font:14px/1.5 ui-monospace,monospace}.print-value{display:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}#copy-status{min-height:24px}footer{border-top:1px solid #aaa;padding-top:16px;font-size:14px}' +
    '@media(max-width:600px){main{padding:24px 12px}section{padding:16px}section header{align-items:flex-start;flex-direction:column;gap:12px}h1{font-size:25px}}' +
    '@media print{body{background:white}main{max-width:none;padding:0}button,textarea,#copy-status{display:none}section{break-inside:auto}section header{break-after:avoid}.print-value{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}}</style></head><body><main>' +
    '<h1>' + escapeHtml(prepared.title) + '</h1><p>' + prepared.fields.length + ' ' + (prepared.selection === 'fields' ? 'mapped issuer fields' : 'canonical answers') + ' · ' + escapeHtml(prepared.format) + ' output</p>' +
    '<p>These values come from the complete saved submission draft. Keep draft.json to reopen its source editions, manual edits, planning and review history in the existing submission workspace.</p><p id="copy-status" role="status" aria-live="polite"></p>' +
    cards + (prepared.issuerContextHtml||'') + '<footer>Each text file contains exactly its displayed value. Printing includes complete answers across as many pages as needed. Use the original submission workspace to edit the draft or its issuer field map.</footer></main><script>' + script + '</script></body></html>\n';
}

export async function prepareGrantExport(input, {selection='auto', format='plain', generatedAt=new Date().toISOString(), planningOptions=nativePlanningOptions} = {}) {
  let draft = copy(validateDraft(input));
  requireValue(['auto','answers','fields'].includes(selection), 'Select auto, answers or fields.');
  requireValue(['plain','markdown'].includes(format), 'Select plain or markdown output.');
  requireValue(Number.isFinite(Date.parse(generatedAt)), 'Use a valid export date.');
  const selected = selection === 'auto' ? (draft.fields.length ? 'fields' : 'answers') : selection;
  requireValue(selected !== 'fields' || draft.fields.length > 0, 'This draft has no mapped issuer fields.');
  draft.handover ||= emptyHandover();
  Object.assign(draft.handover.selection,{outputKind:selected,format});
  const received = await prepareSubmission(draft,{at:generatedAt,planningOptions});
  draft = received.draft;
  const edition = received.edition;
  const fields = edition.body.output.items.map((item,index) => {
    const original = selected === 'fields' ? draft.fields.find(row=>row.id===item.id) : {
      wordLimit:null, characterLimit:null, characterMethod:'unspecified'
    };
    const status = selected === 'fields' ? edition.body.fieldIssues.find(row=>row.id===item.id) : {counts:measureText(item.text),issues:[]};
    return {id:item.id,label:item.label,prompt:item.prompt,answerIds:[...item.answerIds],filename:fieldFilename(index,item.id),value:item.text,
      counts:status.counts,wordLimit:original.wordLimit,characterLimit:original.characterLimit,characterMethod:original.characterMethod,
      issues:[...status.issues],overLimit:exceeded(original,status.counts)};
  });
  const issuer=selectedIssuerContext(draft,edition.body.issuerProgrammeId??null);
  const prepared = {schema:EXPORT_SCHEMA,generatedAt,draftId:draft.id,title:draft.title,currentSource:draft.currentSource,
    editionId:edition.id,selection:selected,format,form:copy(draft.form),fields,
    issuerProgramme:issuer?{id:issuer.id,caseId:issuer.body.programme.id,caseVersion:issuer.body.programme.version,terms:copy(issuer.body.selection),plan:copy(issuer.body.plan),stage:issuer.body.document.stage,proposalTrack:issuer.body.document.proposalTrack,issuerTrack:issuer.body.document.issuerTrack}:null,
    overLimit:fields.some(field=>field.overLimit),needsFieldReview:fields.some(field=>field.issues.length>0)};
  const files = new Map();
  files.set('draft.json',await createDraftEnvelope(draft,{exportedAt:generatedAt,planningOptions}));
  files.set('form-map.json',JSON.stringify(exportFormMap(draft),null,2)+'\n');
  if(draft.handover.selection.bundleId)files.set('source-package.json',await createReviewerSourcePackage(
    await reviewerSourceFromDraft(draft,draft.handover.selection.bundleId),{exportedAt:generatedAt}));
  files.set('application.md',applicationOutput(draft,{format:'markdown',useFields:false}));
  files.set('prepared.txt',edition.body.output.text);
  files.set('prepared.json',JSON.stringify(prepared,null,2)+'\n');
  const issuerHtml=issuer?issuerContextSection(draft,issuer.id):'';
  files.set('review.html',renderExportReview({...prepared,issuerContextHtml:issuerHtml}));
  if(issuer){
    const receivedIssuer=await reopenIssuerProgramme(draft,issuer.id,{planningOptions});
    files.set('issuer-programme.zip',fileBytes(draft,issuer.body.file.sha256));
    files.set('issuer-context.json',JSON.stringify(issuer,null,2)+'\n');
    files.set('issuer-native-planning.zip',receivedIssuer.files.get('planning.zip'));
    files.set('issuer-context.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Issuer programme</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1080px;margin:auto;padding:2rem;color:#181818;background:white}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border:1px solid #aaa;text-align:left;vertical-align:top;padding:.6rem;overflow-wrap:anywhere}.table{overflow:auto}h2{border-top:2px solid #222;padding-top:1rem}p,code{overflow-wrap:anywhere}@media print{body{padding:0}}</style></head><body>'+issuerHtml+'</body></html>\n');
  }
  for (const field of fields) files.set('fields/'+field.filename,field.value);
  return {draft,edition,prepared,files};
}

async function readBounded(path, label, maxBytes=MAX_BYTES) {
  const size = (await stat(path)).size;
  requireValue(size <= maxBytes, label + ' exceeds the supported complete-file size.');
  const bytes = await readFile(path);
  requireValue(bytes.length <= maxBytes, label + ' exceeds the supported complete-file size.');
  let text;
  try { text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
  catch { throw new Error(label + ' must be complete UTF-8 text.'); }
  return {bytes,text};
}
async function readJson(path, label) {
  const read = await readBounded(path,label);
  try { return JSON.parse(read.text.replace(/^\uFEFF/,'')); }
  catch { throw new Error(label + ' must be complete JSON.'); }
}
export async function writeGrantExport(options) {
  const fromDraft = Boolean(options.draft);
  requireValue(fromDraft !== Boolean(options.source), 'Choose a saved draft or an application source.');
  requireValue(options.out, 'Choose a new output directory with --out.');
  requireValue(!options['receive-source-package'] || fromDraft, 'Receive a source package into the original saved draft with --draft.');
  requireValue(Boolean(options['receive-issuer-case'])===Boolean(options['issuer-profile']),'Receive an issuer case together with its explicit --issuer-profile.');
  requireValue(!(options['receive-issuer-case']&&options['issuer-context']),'Receive a new issuer case or select an existing context.');
  if (fromDraft) requireValue(!options['source-index'] && !options['source-url'] && !options.budget && !options.companion && !options.id && !options.title, 'A saved draft retains its own source, identity and title.');
  let draft;
  if (fromDraft) {
    const saved = await readBounded(resolve(options.draft),'Saved submission',MAX_BYTES*2+65536);
    const document = JSON.parse(saved.text.replace(/^\uFEFF/,''));
    draft = document.schema === ENVELOPE ? await openDraftEnvelope(saved.text,{planningOptions:nativePlanningOptions}) : await verifyHandover(document,{planningOptions:nativePlanningOptions});
    if(options['receive-source-package']) {
      const incoming=await readBounded(resolve(options['receive-source-package']),'Reviewer source package',MAX_SOURCE_PACKAGE_BYTES);
      draft=await receiveReviewerSource(draft,await openReviewerSourcePackage(incoming.text),{planningOptions:nativePlanningOptions});
    }
  } else {
    requireValue(options['source-index'] && options['source-url'], 'A new draft needs --source-index and --source-url from the same application edition.');
    const {bytes,text} = await readBounded(resolve(options.source),'Application');
    const originalIndex = await readBounded(resolve(options['source-index']),'Application source index');
    const index = JSON.parse(originalIndex.text.replace(/^\uFEFF/,''));
    const source = makeSource({markdown:text,index,url:options['source-url']});
    requireValue(sha256(bytes) === source.sha256 && gitBlob(bytes) === source.gitBlob, 'The application file does not match its supplied source index.');
    draft = createDraft(source,{id:options.id || 'scf-export-' + randomUUID(), ...(options.title ? {title:options.title} : {})});
    requireValue(Boolean(options.budget) === Boolean(options.companion),'Supply both --budget and --companion to retain the complete reviewer bundle.');
    if (options.budget) {
      const budget = await readBounded(resolve(options.budget),'Original budget');
      const companion = await readBounded(resolve(options.companion),'Product and finance companion');
      const bundle = await createSourceBundle(source,{indexBytes:originalIndex.bytes,budgetBytes:budget.bytes,companionBytes:companion.bytes});
      draft = retainSourceBundle(draft,bundle);
    }
  }
  if(options['receive-issuer-case']){
    const issuerPath=resolve(options['receive-issuer-case']),size=(await stat(issuerPath)).size;
    requireValue(size>0&&size<=MAX_ISSUER_BYTES,'Receive the complete original issuer case up to 32 MiB.');
    const bytes=await readFile(issuerPath);
    requireValue(bytes.length===size,'Keep the original issuer file stable during reception.');
    const profile=await readJson(resolve(options['issuer-profile']),'Issuer receiving profile');
    draft=(await receiveIssuerContext(draft,new Uint8Array(bytes),profile,{filename:basename(issuerPath),planningOptions:nativePlanningOptions})).draft;
  }
  if(options['issuer-context'])draft=selectIssuerProgramme(draft,options['issuer-context']==='none'?null:options['issuer-context']);
  if (options['form-map']) draft = importFormMap(draft,await readJson(resolve(options['form-map']),'Issuer form map'));
  const exported = await prepareGrantExport(draft,{selection:options.select || 'auto',format:options.format || 'plain'});
  draft = exported.draft;
  const {prepared,files} = exported;
  for (const field of prepared.fields) requireValue(Buffer.from(field.value,'utf8').toString('utf8') === field.value, 'Correct invalid Unicode text in field ' + field.id + '.');
  const directory = resolve(options.out);
  await mkdir(dirname(directory),{recursive:true,mode:0o700});
  await mkdir(directory,{mode:0o700});
  await mkdir(join(directory,'fields'),{mode:0o700});
  const manifest = {schema:EXPORT_SCHEMA,generatedAt:prepared.generatedAt,draftId:draft.id,currentSource:draft.currentSource,editionId:prepared.editionId,
    selection:prepared.selection,format:prepared.format,fields:prepared.fields.length,overLimit:prepared.overLimit,needsFieldReview:prepared.needsFieldReview,
    issuerProgramme:prepared.issuerProgramme,
    sources:draft.sources.map(source=>({sha256:source.sha256,gitBlob:source.gitBlob,bytes:source.bytes,url:source.url,receivedAt:source.receivedAt})),files:[]};
  for (const [name,text] of files) {
    const bytes = typeof text==='string'?Buffer.from(text,'utf8'):Buffer.from(text);
    await writeFile(join(directory,name),bytes,{flag:'wx',mode:0o600});
    manifest.files.push({path:name,bytes:bytes.length,sha256:sha256(bytes)});
  }
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {directory,draftId:draft.id,editionId:prepared.editionId,selection:prepared.selection,fields:prepared.fields.length,files:files.size+1,overLimit:prepared.overLimit,needsFieldReview:prepared.needsFieldReview};
}

export async function runCLI(args=process.argv.slice(2)) {
  const {values} = parseArgs({args,options:{
    help:{type:'boolean'},draft:{type:'string'},source:{type:'string'},'source-index':{type:'string'},'source-url':{type:'string'},budget:{type:'string'},companion:{type:'string'},
    'receive-source-package':{type:'string'},'receive-issuer-case':{type:'string'},'issuer-profile':{type:'string'},'issuer-context':{type:'string'},'form-map':{type:'string'},out:{type:'string'},select:{type:'string'},format:{type:'string'},id:{type:'string'},title:{type:'string'}
  },allowPositionals:false});
  if (values.help) {
    process.stdout.write('Export the existing SCF submission model.\n\n' +
      '  node grant-export.mjs --draft saved-submission.json --out /private/new-export\n' +
      '  node grant-export.mjs --draft saved-submission.json --receive-source-package source-package.json --out /private/received-export\n' +
      '  node grant-export.mjs --draft saved-submission.json --receive-issuer-case complete-issuer-case.zip --issuer-profile issuer-profile.json --out /private/issuer-export\n' +
      '  node grant-export.mjs --source application.md --source-index source-index.json --source-url https://original/source --out /private/new-export\n\n' +
      'Options: --budget budget.csv --companion product-and-finance.md; --form-map native-map.json; --select auto|answers|fields; --format plain|markdown.\n' +
      'New source drafts may use --id and --title. Saved draft identities and all history are retained.\n' +
      'A selected complete reviewer bundle is also exported as source-package.json for source receiving.\n' +
      'Issuer receiving retains the original case, terms, correspondence and exact selected native plan. The profile explicitly chooses whether to receive that plan.\n' +
      'Select an existing issuer context with --issuer-context ID, or clear the working selection with --issuer-context none. Complete receiving guide: GRANT_ISSUER_CONTEXT.md.\n');
    return 0;
  }
  const result = await writeGrantExport(values);
  process.stdout.write(JSON.stringify(result)+'\n');
  return result.overLimit ? 2 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCLI().then(code=>{process.exitCode=code;}).catch(error=>{
    process.stderr.write('Grant export: ' + error.message + '\n');process.exitCode=1;
  });
}

