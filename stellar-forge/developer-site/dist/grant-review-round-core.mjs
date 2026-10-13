// MIT. Review the exact original submission draft; retain every review and received edition.
import { SCHEMA as DRAFT_SCHEMA, ENVELOPE as DRAFT_ENVELOPE, MAX_BYTES as DRAFT_MAX,
  ANSWERS, REQUIREMENTS, validateDraft, outputText, measureText, fieldStatus, applicationOutput } from './grant-submission-core.mjs';

export const REVIEW_SCHEMA = 'stellar-forge.grant-review-round.v1';
export const REVIEW_ENVELOPE = 'stellar-forge.grant-review-round-export.v1';
export const REVIEW_MAX_BYTES = 64 * 1024 * 1024;
export const REVIEW_DECISIONS = ['accepted', 'changes-requested', 'not-applicable'];
export const REVIEW_PRIORITIES = ['blocking', 'major', 'minor'];
const clone = value => JSON.parse(JSON.stringify(value));
// Cache only a bounded amount of complete serialized content. The source round
// remains authoritative; every cache hit still requires the exact export bytes.
const captureCache = new Map();
const CAPTURE_CACHE_BYTES = 8 * 1024 * 1024;
let captureCacheBytes = 0;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function need(value, message) { if (!value) throw new Error(message); }
function object(value, label) { need(value && typeof value === 'object' && !Array.isArray(value), label + ' must be a complete object.'); return value; }
function list(value, label, maximum = 10000) { need(Array.isArray(value) && value.length <= maximum, label + ' must be a complete bounded list.'); return value; }
function text(value, label, maximum = 1000000, required = false) {
  need(typeof value === 'string' && value.length <= maximum, label + ' must be text within its allowance.');
  if (required) need(value.trim().length > 0, label + ' is required.');
  return value;
}
function identity(value, label = 'Identity') { text(value, label, 200, true); need(!/[\u0000-\u001f\u007f]/.test(value), label + ' cannot contain control characters.'); return value; }
function iso(value, label = 'Date') { text(value, label, 40, true); need(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, label + ' must be a complete UTC ISO timestamp.'); return value; }
function hex(value, label) { need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), label + ' must retain its full SHA-256.'); return value; }
function exact(value, keys, label) { object(value, label); need(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => own(value, key)), label + ' must retain its exact fields.'); }
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function same(a, b) { return stable(a) === stable(b); }
function bytes(value) { return new TextEncoder().encode(value); }
export async function reviewSha256(value) {
  need(typeof crypto !== 'undefined' && crypto.subtle, 'Open the original workspace through HTTPS or its loopback host to retain source identities.');
  const result = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? bytes(value) : value);
  return Array.from(new Uint8Array(result), x => x.toString(16).padStart(2, '0')).join('');
}
async function sha1(value) {
  const result = await crypto.subtle.digest('SHA-1', value);
  return Array.from(new Uint8Array(result), x => x.toString(16).padStart(2, '0')).join('');
}
async function verifyNativeDraft(draft) {
  validateDraft(draft);
  for (const source of draft.sources) {
    const body = bytes(source.markdown), prefix = bytes('blob ' + body.length + '\0');
    const framed = new Uint8Array(prefix.length + body.length); framed.set(prefix); framed.set(body, prefix.length);
    need(body.length === source.bytes && await reviewSha256(body) === source.sha256 && await sha1(framed) === source.gitBlob,
      'The complete original application differs from its retained source identity.');
  }
  return draft;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
async function verifyCapture(capture, parsedEnvelope = null) {
  exact(capture, ['id', 'fileName', 'receivedAt', 'bytes', 'draftSha256', 'exportText'], 'Received draft');
  hex(capture.id, 'Original export identity'); hex(capture.draftSha256, 'Original draft identity');
  text(capture.fileName, 'Original file name', 300, true); iso(capture.receivedAt, 'Receiving date');
  text(capture.exportText, 'Complete original draft export', DRAFT_MAX * 2 + 65536, true);
  need(Number.isSafeInteger(capture.bytes) && capture.bytes === measureText(capture.exportText).utf8Bytes && capture.bytes <= DRAFT_MAX * 2 + 65536,
    'Retain the entire original draft export within its original receiving allowance.');
  const cached = captureCache.get(capture.id);
  if (cached && cached.text === capture.exportText) {
    need(cached.draftSha256 === capture.draftSha256, 'Retain the original draft identity.');
    captureCache.delete(capture.id); captureCache.set(capture.id, cached);
    return cached.draft;
  }
  need(await reviewSha256(capture.exportText) === capture.id, 'The received draft file has changed.');
  const envelope = parsedEnvelope || JSON.parse(capture.exportText);
  need(envelope?.schema === DRAFT_ENVELOPE && envelope.draft?.schema === DRAFT_SCHEMA,
    'Open the complete draft exported by Prepare submission.');
  hex(envelope.sha256, 'Submission export digest');
  need(await reviewSha256(JSON.stringify(envelope.draft)) === envelope.sha256 && capture.draftSha256 === envelope.sha256,
    'The complete draft differs from its original export.');
  await verifyNativeDraft(envelope.draft);
  // This envelope was parsed inside this module; freeze its owned draft directly.
  const draft = freeze(envelope.draft);
  if (capture.bytes <= CAPTURE_CACHE_BYTES) {
    const previous = captureCache.get(capture.id);
    if (previous) { captureCacheBytes -= previous.bytes; captureCache.delete(capture.id); }
    while (captureCache.size && (captureCache.size >= 2 || captureCacheBytes + capture.bytes > CAPTURE_CACHE_BYTES)) {
      const oldest = captureCache.keys().next().value;
      captureCacheBytes -= captureCache.get(oldest).bytes; captureCache.delete(oldest);
    }
    captureCache.set(capture.id, {text: capture.exportText, bytes: capture.bytes, draftSha256: envelope.sha256, draft});
    captureCacheBytes += capture.bytes;
  }
  return draft;
}
export async function readSubmissionExport(exportText, {fileName = 'complete-submission-draft.json', receivedAt = new Date().toISOString()} = {}) {
  text(exportText, 'Complete draft export', DRAFT_MAX * 2 + 65536, true);
  const envelope = JSON.parse(exportText);
  need(envelope?.schema === DRAFT_ENVELOPE && envelope.draft, 'Choose the full draft from Prepare submission.');
  const capture = {id: await reviewSha256(exportText), fileName, receivedAt, bytes: measureText(exportText).utf8Bytes,
    draftSha256: envelope.sha256, exportText};
  await verifyCapture(capture, envelope); return capture;
}
/** Use the original export schema for an existing shared-store draft; preserve every extension field. */
export async function captureSubmissionDraft(draft, {fileName = 'browser-submission-draft.json', receivedAt = new Date().toISOString()} = {}) {
  await verifyNativeDraft(draft);
  const body = JSON.stringify(draft), digest = await reviewSha256(body);
  const exported = '{"schema":' + JSON.stringify(DRAFT_ENVELOPE) + ',"exportedAt":' + JSON.stringify(receivedAt) +
    ',"sha256":' + JSON.stringify(digest) + ',"draft":' + body + '}\n';
  return readSubmissionExport(exported, {fileName, receivedAt});
}
function person(value) {
  exact(value, ['id', 'label'], 'Named participant'); identity(value.id, 'Participant identity'); text(value.label, 'Participant name', 200, true);
  need(value.label === value.label.trim(), 'Remove leading or trailing space from the participant name.'); return value;
}
function target(value) {
  exact(value, ['kind', 'id'], 'Review target'); need(['application', 'answer', 'field', 'requirement'].includes(value.kind), 'Select an original review target.');
  identity(value.id, 'Review target identity'); if (value.kind === 'application') need(value.id === 'application', 'Retain the complete application target.');
  return value;
}
function targetKey(value) { return value.kind + ':' + value.id; }
function evidence(value) {
  list(value, 'Supporting references', 40);
  for (const item of value) {
    exact(item, ['label', 'url', 'note'], 'Supporting reference');
    text(item.label, 'Reference label', 500, true); text(item.note, 'Reference observation', 20000); text(item.url, 'Reference URL', 4000);
    if (item.url) {
      let url; try { url = new URL(item.url); } catch { throw new Error('Use a complete HTTPS reference URL, or leave it empty and retain the observation.'); }
      need(url.protocol === 'https:' && !url.username && !url.password, 'Use an HTTPS reference without embedded credentials.');
    }
    need(item.url || item.note.trim(), 'Retain a reference URL or the complete supporting observation.');
  }
}
function projection(draft, selected, format) {
  target(selected);
  const answer = id => {
    const row = draft.answers.find(x => x.id === id); need(row, 'The selected answer is absent from this draft.');
    return clone({title: ANSWERS.find(x => x[0] === id)[1], ...row});
  };
  if (selected.kind === 'application') {
    // All descriptor drafts are owned, verified JSON. Omit history before
    // materializing the binding rather than cloning history and discarding it.
    const retained = {};
    for (const key of Object.keys(draft)) if (!['id', 'folder', 'createdAt', 'updatedAt', 'versions'].includes(key))
      retained[key] = draft[key];
    return {title: 'Complete prepared submission', body: retained, text: applicationOutput(draft, {format, useFields: false}),
      context: 'All current answers, form metadata, field mappings, source editions and complete draft extensions.'};
  }
  if (selected.kind === 'answer') {
    const row = answer(selected.id);
    return {title: row.title, body: row, text: outputText(row.text, format), context: 'Original answer identity, current text and its retained source baseline.'};
  }
  if (selected.kind === 'field') {
    const row = draft.fields.find(x => x.id === selected.id); need(row, 'The selected issuer field is absent from this draft.');
    return {title: row.label || 'Unlabeled issuer field', body: {field: clone(row), form: clone(draft.form), answers: row.answerIds.map(answer)},
      text: outputText(row.text, format), context: 'Complete issuer prompt, labels, limits, form observations and selected source answers.'};
  }
  const rule = REQUIREMENTS.find(x => x.id === selected.id), review = draft.reviews.find(x => x.id === selected.id);
  need(rule && review, 'The selected original requirement is absent from this draft.');
  const rows = review.answers.map(answer);
  return {title: rule.title, body: {requirement: clone(rule), editorialReview: clone(review), answers: rows},
    text: rows.map(x => x.title + '\n\n' + outputText(x.text, format)).join('\n\n'),
    context: 'Original required-content criterion, author review note and its complete selected answers.'};
}
function targets(draft) {
  return [{kind:'application',id:'application'}, ...ANSWERS.map(x=>({kind:'answer',id:x[0]})),
    ...draft.fields.map(x=>({kind:'field',id:x.id})), ...REQUIREMENTS.map(x=>({kind:'requirement',id:x.id}))];
}
async function descriptor(draft, selected, format) {
  const value = projection(draft, selected, format);
  return {target: clone(selected), key: targetKey(selected), title: value.title, text: value.text, context: value.context,
    bindingSha256: await reviewSha256(stable({target:selected,format,body:value.body,text:value.text})), counts: measureText(value.text)};
}
function nextState(round, initialDraftId) {
  return {revision:0, selectedEdition:round.initialEdition, draftId:initialDraftId,
    participants:[clone(round.creator)], decisions:[], decisionsHistory:[], changes:[], selections:[], status:'OPEN', completion:null};
}
function targetTitle(draft, selected) {
  if (selected.kind === 'application') return 'Complete prepared submission';
  if (selected.kind === 'answer') return ANSWERS.find(row => row[0] === selected.id)[1];
  if (selected.kind === 'field') return draft.fields.find(row => row.id === selected.id).label || 'Unlabeled issuer field';
  return REQUIREMENTS.find(row => row.id === selected.id).title;
}
function readyIssues(state, draft, format) {
  const issues = [];
  for (const selected of targets(draft)) {
    const rows = state.decisions.filter(x => targetKey(x.target) === targetKey(selected));
    if (!rows.length) issues.push({kind:'unreviewed', target:clone(selected), message:targetTitle(draft,selected) + ' has no current reviewer decision.'});
    else if (rows.some(x=>x.decision==='changes-requested')) issues.push({kind:'changes-requested',target:clone(selected),message:targetTitle(draft,selected) + ' still has a requested change.'});
  }
  for (const change of state.changes) if (change.status !== 'resolved') issues.push({kind:'open-change',changeId:change.id,message:change.title + ' remains ' + change.status + '.'});
  for (const field of draft.fields) for (const message of fieldStatus(field,draft.form,format).issues) issues.push({kind:'field',target:{kind:'field',id:field.id},message});
  return issues;
}
async function reduce(round, state, event, drafts) {
  const input=event.input, currentEdition=state.selectedEdition, current=await drafts.get(currentEdition);
  need(event.expectedRevision === state.revision && event.sequence === state.revision+1, 'Retain the original review event order.');
  need(state.participants.some(x=>x.id===event.actorId), 'Retain the named participant selected for this action.');
  if (state.status === 'COMPLETE') need(event.kind === 'reopen', 'Reopen the completed review explicitly before adding work or receiving a revised draft.');
  if (event.kind === 'participant') {
    exact(input,['person'],'Participant action'); person(input.person);
    need(!state.participants.some(x=>x.id===input.person.id || x.label.toLowerCase()===input.person.label.toLowerCase()),
      'Select the original participant identity for this name.');
    state.participants.push(clone(input.person));
  } else if (event.kind === 'review') {
    exact(input,['editionId','target','bindingSha256','decision','note','references'],'Reviewer decision');
    need(input.editionId===state.selectedEdition,'Review the currently selected original draft.'); target(input.target); hex(input.bindingSha256,'Reviewed content');
    const selected=await drafts.describe(state.selectedEdition,input.target,round.format);
    need(selected.bindingSha256===input.bindingSha256,'The selected answer, field or source context changed before this review.');
    need(REVIEW_DECISIONS.includes(input.decision),'Select an explicit reviewer decision.'); text(input.note,'Reviewer note',100000,input.decision!=='accepted'); evidence(input.references);
    const row={id:event.id,originalReviewId:event.id,actorId:event.actorId,editionId:state.selectedEdition,target:clone(input.target),
      bindingSha256:input.bindingSha256,decision:input.decision,note:input.note,references:clone(input.references),at:event.at,carriedBy:null};
    state.decisions=state.decisions.filter(x=>!(x.actorId===row.actorId && targetKey(x.target)===targetKey(row.target)));
    state.decisions.push(row); state.decisionsHistory.push(clone(row));
  } else if (event.kind === 'change') {
    exact(input,['editionId','target','bindingSha256','title','priority','quote','note','references'],'Requested change');
    need(input.editionId===state.selectedEdition,'Request a change against the selected original draft.'); target(input.target); hex(input.bindingSha256,'Requested-change content');
    const selected=await drafts.describe(state.selectedEdition,input.target,round.format);
    need(selected.bindingSha256===input.bindingSha256,'The selected content changed before the request.');
    text(input.title,'Requested change title',300,true); need(REVIEW_PRIORITIES.includes(input.priority),'Select the change priority.');
    text(input.quote,'Original quoted text',100000); need(!input.quote||selected.text.includes(input.quote),'The quoted text must appear exactly in the selected answer or field.');
    text(input.note,'Requested change',100000,true); evidence(input.references);
    state.changes.push({id:event.id,actorId:event.actorId,at:event.at,...clone(input),status:'open',responses:[],resolutions:[]});
  } else if (event.kind === 'respond') {
    exact(input,['changeId','editionId','response','note','references'],'Author response');
    const row=state.changes.find(x=>x.id===input.changeId); need(row,'Select the original requested change.');
    need(input.editionId===state.selectedEdition,'Respond against the currently selected draft.');
    need(['addressed','declined','question'].includes(input.response),'Select the author response.'); text(input.note,'Author response note',100000,true); evidence(input.references);
    row.responses.push({id:event.id,actorId:event.actorId,at:event.at,...clone(input)});
    if(row.status==='resolved') row.status='open';
  } else if (event.kind === 'resolve') {
    exact(input,['changeId','editionId','status','note'],'Review resolution');
    const row=state.changes.find(x=>x.id===input.changeId); need(row,'Select the original requested change.');
    need(input.editionId===state.selectedEdition,'Resolve the request against the currently selected draft.');
    need(['resolved','deferred','open'].includes(input.status),'Choose resolved, deferred or reopened.'); text(input.note,'Review resolution note',100000,true);
    row.status=input.status; row.resolutions.push({id:event.id,actorId:event.actorId,at:event.at,...clone(input)});
  } else if (event.kind === 'receive') {
    exact(input,['editionId','fromEdition','note','decisions'],'Revised draft selection');
    need(input.fromEdition===state.selectedEdition && input.editionId!==input.fromEdition,'Compare and explicitly select a different received edition.');
    const incoming=await drafts.get(input.editionId); need(incoming && incoming.id===state.draftId,'A review round receives editions of its original submission draft. Start a new round for a different draft identity.');
    text(input.note,'Draft-selection note',100000,true); list(input.decisions,'Review carry-forward choices');
    need(input.decisions.length===state.decisions.length && new Set(input.decisions.map(x=>x.decisionId)).size===input.decisions.length,
      'Choose carry forward or reopen for every current reviewer decision.');
    const retained=[];
    for(let i=0;i<input.decisions.length;i++){
      const choice=input.decisions[i]; exact(choice,['decisionId','choice','note'],'Review carry-forward');
      const previous=state.decisions.find(x=>x.id===choice.decisionId); need(previous,'Select the original reviewer decision.');
      need(['carry','reopen'].includes(choice.choice),'Explicitly carry forward or reopen each decision.'); text(choice.note,'Carry-forward note',20000,choice.choice==='reopen');
      if(choice.choice==='carry'){
        let selected; try{selected=await drafts.describe(input.editionId,previous.target,round.format);}catch{throw new Error('An absent or replaced field cannot carry its earlier review. Reopen that decision.');}
        need(selected.bindingSha256===previous.bindingSha256,'Changed text, source context, issuer prompt or limits require a new review.');
        const row={...clone(previous),id:event.id+':carry:'+i,editionId:input.editionId,at:event.at,carriedBy:event.actorId,carryNote:choice.note,carriedFrom:previous.id};
        retained.push(row); state.decisionsHistory.push(clone(row));
      }
    }
    state.selections.push({id:event.id,actorId:event.actorId,at:event.at,...clone(input)});
    state.decisions=retained; state.selectedEdition=input.editionId;
    // A resolved request remains historical. A later draft requires its explicit renewed resolution.
    for(const change of state.changes) if(change.status==='resolved') {
      let before=null,after=null;
      try{before=(await drafts.describe(currentEdition,change.target,round.format)).bindingSha256;}catch{}
      try{after=(await drafts.describe(input.editionId,change.target,round.format)).bindingSha256;}catch{}
      if(before!==after){change.status='open';change.resolutions.push({id:event.id+':reopen:'+change.id,actorId:event.actorId,at:event.at,changeId:change.id,editionId:input.editionId,status:'open',note:'The selected target or its source context changed in the explicitly received draft.'});}
    }
  } else if (event.kind === 'finish') {
    exact(input,['editionId','outcome','note'],'Review completion'); need(input.editionId===state.selectedEdition,'Finish the selected draft review.');
    need(['return-changes','ready-for-author-check'].includes(input.outcome),'Select the editorial handover outcome.'); text(input.note,'Completion note',100000,true);
    if(input.outcome==='ready-for-author-check') need(readyIssues(state,current,round.format).length===0,'Review every current target, resolve requested changes and complete the recorded issuer-field checks before selecting ready for author check.');
    state.status='COMPLETE'; state.completion={id:event.id,actorId:event.actorId,at:event.at,...clone(input)};
  } else if (event.kind === 'reopen') {
    exact(input,['note'],'Reopen action'); need(state.status==='COMPLETE','This review is already open.'); text(input.note,'Reopen note',100000,true);
    state.status='OPEN';state.completion=null;
  } else throw new Error('Unknown review action. Preserve the complete original supported round.');
  state.revision=event.sequence; return state;
}
// Validate every original capture, but retain at most two decoded editions while
// replaying. Compact edition metadata and bounded descriptors do not own drafts.
function editionReader(captures) {
  const originals = new Map(captures.map(capture => [capture.id, {...capture}]));
  const decoded = new Map(), summaries = new Map(), bindings = new Map();
  let bindingBytes = 0;
  async function get(id) {
    if (!originals.has(id)) return undefined;
    if (decoded.has(id)) {
      const value = decoded.get(id); decoded.delete(id); decoded.set(id, value); return value;
    }
    const value = await verifyCapture(originals.get(id));
    summaries.set(id, {id:value.id, title:value.title, sourceSha256:value.currentSource,
      sourceCount:value.sources.length, versionCount:value.versions.length});
    decoded.set(id, value);
    while (decoded.size > 2) decoded.delete(decoded.keys().next().value);
    return value;
  }
  async function describe(id, selected, format) {
    target(selected);
    const key = id + '\0' + format + '\0' + targetKey(selected);
    if (bindings.has(key)) {
      const value = bindings.get(key); bindings.delete(key); bindings.set(key, value); return value.descriptor;
    }
    const draft = await get(id); need(draft,'Select a retained original draft edition.');
    const value = await descriptor(draft, selected, format);
    const size = 2 * (value.text.length + value.title.length + value.context.length) + 1024;
    if (size <= 2 * 1024 * 1024) {
      while (bindings.size && (bindings.size >= 64 || bindingBytes + size > 2 * 1024 * 1024)) {
        const first = bindings.keys().next().value;
        bindingBytes -= bindings.get(first).bytes; bindings.delete(first);
      }
      bindings.set(key, {descriptor:value, bytes:size}); bindingBytes += size;
    }
    return value;
  }
  return {get, describe, has:id=>originals.has(id), summary:id=>summaries.get(id)};
}
async function build(round) {
  exact(round,['schema','id','title','folder','createdAt','updatedAt','format','creator','initialEdition','editions','events'],'Complete review round');
  need(round.schema===REVIEW_SCHEMA,'Open the complete review round.'); identity(round.id,'Review identity'); text(round.title,'Review title',300,true);
  need(round.folder==='SCF review — '+round.title,'Retain the original review folder and title.'); iso(round.createdAt,'Review creation');iso(round.updatedAt,'Review update');
  need(['plain','markdown'].includes(round.format),'Retain the review’s selected copy format.');person(round.creator);hex(round.initialEdition,'Initial draft edition');
  list(round.editions,'Complete received drafts',100);need(round.editions.length>0,'Retain the original complete draft.');
  need(new Set(round.editions.map(x=>x.id)).size===round.editions.length,'Retain distinct original export identities.');
  need(measureText(JSON.stringify(round)).utf8Bytes<=REVIEW_MAX_BYTES,'This complete review exceeds 64 MiB. Keep its full export and start a separately named round for additional drafts.');
  const drafts=editionReader(round.editions);
  for(const capture of round.editions)await drafts.get(capture.id);
  need(drafts.has(round.initialEdition),'Retain the first received draft.');
  const state=nextState(round,drafts.summary(round.initialEdition).id);
  list(round.events,'Complete review actions',20000);const eventIds=new Set(),usedEditions=new Set([round.initialEdition]);let previous=null;
  for(const event of round.events){
    exact(event,['id','sequence','expectedRevision','at','actorId','kind','input','previousSha256','sha256'],'Saved review action');
    identity(event.id,'Review request identity');need(!eventIds.has(event.id),'Retain unique original request identities.');eventIds.add(event.id);
    need(Number.isSafeInteger(event.sequence)&&Number.isSafeInteger(event.expectedRevision),'Retain the exact review revision.');iso(event.at,'Review action date');identity(event.actorId,'Action participant');
    text(event.kind,'Review action kind',40,true);object(event.input,'Review action input');hex(event.sha256,'Review action digest');
    need(event.previousSha256===previous,'Retain the complete review history in its original order.');
    const body=clone(event);delete body.sha256;
    need(await reviewSha256(stable(body))===event.sha256,'A saved review action differs from its retained original input.');
    await reduce(round,state,event,drafts);previous=event.sha256;
    if(event.kind==='receive')usedEditions.add(event.input.editionId);
  }
  need(round.editions.every(x=>usedEditions.has(x.id)),'Every retained draft must belong to an explicit source selection.');
  need(round.updatedAt===(round.events.at(-1)?.at||round.createdAt),'Retain the current review’s last saved action date.');
  return {state,drafts};
}
export async function validateReviewRound(round) { await build(round); return round; }
export async function createReviewRound(capture,{id,title='SCF submission review',reviewer,format='plain',now=new Date().toISOString()}={}){
  await verifyCapture(capture);const round={schema:REVIEW_SCHEMA,id,title,folder:'SCF review — '+title,createdAt:now,updatedAt:now,format,
    creator:clone(person(reviewer)),initialEdition:capture.id,editions:[clone(capture)],events:[]};
  await validateReviewRound(round);return round;
}
/** Every mutation receives a stable request ID and the selected event revision. Same-input replay preserves later work. */
export async function applyReviewAction(round,{requestId,expectedRevision,actorId,kind,input,at=new Date().toISOString()},incomingCapture=null){
  const {state:{revision}}=await build(round);identity(requestId,'Original request identity');
  const previous=round.events.find(x=>x.id===requestId);
  if(previous){
    need(same({expectedRevision,actorId,kind,input},{expectedRevision:previous.expectedRevision,actorId:previous.actorId,kind:previous.kind,input:previous.input}),
      'The original request identity is already bound to different review input.');
    if(incomingCapture)need(round.editions.some(x=>same(x,incomingCapture)),'Retain the original complete received export on replay.');
    return clone(round);
  }
  need(expectedRevision===revision,'This review advanced. Reopen its latest saved state before applying the prepared action.');
  const next=clone(round);
  if(incomingCapture){
    need(kind==='receive'&&input.editionId===incomingCapture.id,'Bind the complete incoming draft to the selected receive action.');
    await verifyCapture(incomingCapture);
    const current=next.editions.find(x=>x.id===incomingCapture.id);
    if(current)need(current.exportText===incomingCapture.exportText&&current.draftSha256===incomingCapture.draftSha256,'Retain the original received draft bytes.');
    else next.editions.push(clone(incomingCapture));
  }
  const event={id:requestId,sequence:expectedRevision+1,expectedRevision,at,actorId,kind,input:clone(input),previousSha256:next.events.at(-1)?.sha256||null};
  event.sha256=await reviewSha256(stable(event));next.events.push(event);next.updatedAt=at;
  await validateReviewRound(next);return next;
}
export async function reviewRoundView(round,{editionId=null}={}){
  const {state,drafts}=await build(round),selectedId=editionId||state.selectedEdition,draft=await drafts.get(selectedId);
  need(draft,'Select a retained original draft edition.');
  const rows=[];for(const selected of targets(draft)) rows.push(await drafts.describe(selectedId,selected,round.format));
  return {...clone(state),viewedEdition:selectedId,isCurrent:selectedId===state.selectedEdition,format:round.format,title:round.title,
    draft:clone(draft),capture:clone(round.editions.find(x=>x.id===selectedId)),targets:rows,
    readiness:readyIssues(state,await drafts.get(state.selectedEdition),round.format),
    editions:round.editions.map(x=>({id:x.id,fileName:x.fileName,receivedAt:x.receivedAt,bytes:x.bytes,draftSha256:x.draftSha256,
      title:drafts.summary(x.id).title,sourceSha256:drafts.summary(x.id).sourceSha256,sourceCount:drafts.summary(x.id).sourceCount,versionCount:drafts.summary(x.id).versionCount}))};
}
export async function compareReviewDraft(round,incomingCapture){
  const {state,drafts}=await build(round),incoming=await verifyCapture(incomingCapture),current=await drafts.get(state.selectedEdition);
  need(incoming.id===state.draftId,'This is a different submission draft. Start a new review round instead of replacing the original identity.');
  const keys=new Map();for(const selected of [...targets(current),...targets(incoming)]) keys.set(targetKey(selected),selected);
  const rows=[];
  for(const selected of keys.values()){
    let before=null,after=null;
    if(targets(current).some(x=>targetKey(x)===targetKey(selected)))before=await drafts.describe(state.selectedEdition,selected,round.format);
    if(targets(incoming).some(x=>targetKey(x)===targetKey(selected)))after=await descriptor(incoming,selected,round.format);
    rows.push({target:clone(selected),before,after,change:!before?'added':!after?'removed':before.bindingSha256===after.bindingSha256?'unchanged':'changed'});
  }
  return {fromEdition:state.selectedEdition,toEdition:incomingCapture.id,draftId:state.draftId,
    rows,decisions:state.decisions.map(decision=>{
      const row=rows.find(x=>targetKey(x.target)===targetKey(decision.target));
      return {decision:clone(decision),canCarry:!!row?.after&&row.after.bindingSha256===decision.bindingSha256,
        change:row?.change||'removed',title:row?.after?.title||row?.before?.title||decision.target.id};
    })};
}
export async function exportReviewRound(round,{now=new Date().toISOString()}={}){
  await validateReviewRound(round);iso(now,'Export date');
  const body=JSON.stringify(round),digest=await reviewSha256(body);
  return '{"schema":'+JSON.stringify(REVIEW_ENVELOPE)+',"exportedAt":'+JSON.stringify(now)+
    ',"sha256":'+JSON.stringify(digest)+',"round":'+body+'}\n';
}
export async function importReviewRound(serialized){
  text(serialized,'Complete review export',REVIEW_MAX_BYTES+65536,true);need(measureText(serialized).utf8Bytes<=REVIEW_MAX_BYTES+65536,'The complete review export exceeds its receiving allowance.');
  const packet=JSON.parse(serialized);need(packet?.schema===REVIEW_ENVELOPE&&packet.round,'Open the complete review-round export.');
  hex(packet.sha256,'Review export digest');need(await reviewSha256(JSON.stringify(packet.round))===packet.sha256,'The review packet differs from its original full export.');
  await validateReviewRound(packet.round);return packet.round;
}
export async function reviewReport(round){
  const view=await reviewRoundView(round),personLabel=id=>view.participants.find(x=>x.id===id)?.label||id;
  const lines=['# '+round.title,'','Review identity: '+round.id,'Selected original draft: '+view.draft.title+' ('+view.draft.id+')',
    'Draft SHA-256: '+view.capture.draftSha256,'Original export SHA-256: '+view.capture.id,'Review copy format: '+round.format,
    'Current review state: '+view.status,'Saved actions: '+view.revision,'',
    'These are named editorial observations. Names and file digests do not authenticate a reviewer or record an issuer decision.','',
    '## Handover status','',view.completion?view.completion.outcome+' — '+personLabel(view.completion.actorId)+': '+view.completion.note:'Review remains open.','',
    ...view.readiness.map(x=>'- '+x.message),'','## Current reviewer decisions',''];
  for(const row of view.decisions){
    const selected=view.targets.find(x=>x.key===targetKey(row.target));
    lines.push('### '+(selected?.title||row.target.id),'',row.decision+' — '+personLabel(row.actorId),
      'Reviewed content SHA-256: '+row.bindingSha256,row.carriedBy?'Carried forward for unchanged content by '+personLabel(row.carriedBy)+'.':'Recorded '+row.at,
      '',row.note||'(No additional note.)','');
    for(const ref of row.references)lines.push('- '+ref.label+(ref.url?' — '+ref.url:'')+(ref.note?' — '+ref.note:''));
    lines.push('');
  }
  lines.push('## Requested changes and author replies','');
  for(const row of view.changes){
    lines.push('### '+row.title,'',row.priority+' · '+row.status+' · requested by '+personLabel(row.actorId),
      'Original target: '+targetKey(row.target),'Original draft export: '+row.editionId,'',row.note,'');
    if(row.quote)lines.push('Exact selected quote:','',row.quote,'');
    for(const ref of row.references)lines.push('- '+ref.label+(ref.url?' — '+ref.url:'')+(ref.note?' — '+ref.note:''));
    for(const response of row.responses){lines.push('', 'Author response — '+personLabel(response.actorId)+' / '+response.response+' / '+response.at,
      'Response draft export: '+response.editionId,'',response.note);
      for(const ref of response.references)lines.push('- '+ref.label+(ref.url?' — '+ref.url:'')+(ref.note?' — '+ref.note:''));
    }
    for(const resolution of row.resolutions)lines.push('', 'Review resolution — '+personLabel(resolution.actorId)+' / '+resolution.status+' / '+resolution.at,'',resolution.note);
    lines.push('');
  }
  lines.push('## Complete selected application text','',applicationOutput(view.draft,{format:round.format,useFields:false}));
  if(view.draft.fields.length)lines.push('## Complete selected issuer fields','',applicationOutput(view.draft,{format:round.format,useFields:true}));
  lines.push('## Retained source editions','');
  for(const edition of view.editions)lines.push('- '+edition.fileName+' — export '+edition.id+'; draft '+edition.draftSha256+'; received '+edition.receivedAt);
  lines.push('','The complete review JSON retains every original draft export, reviewer identity, action input, earlier decision, source edition and author reply. Open that JSON in the same review workspace to continue.','');
  return lines.join('\n');
}
