'use strict';
// Receive the complete original Gmail draft, then send it through the maintained
// first-contact carrier. The draft remains the body of record on Gmail.
const clone = value => JSON.parse(JSON.stringify(value));
function nativeValue(raw) {
  if (raw?.isError) throw Object.assign(new Error('Original Gmail draft read failed'), {native_result:raw});
  return raw?.structuredContent ?? raw?.result ?? raw;
}
function draftIdentity(value) {
  const keys = ['draft_id','message_id','thread_id'];
  if (!value || Object.keys(value).length !== keys.length ||
      keys.some(key => typeof value[key] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value[key])))
    throw new TypeError('Exact reviewed Gmail draft, current message and original thread IDs required');
  return Object.freeze(Object.fromEntries(keys.map(key => [key,value[key]])));
}
async function exactDraft(listDrafts, link_id, draft_id) {
  if (typeof listDrafts !== 'function' || typeof draft_id !== 'string' || !draft_id)
    throw new TypeError('native list_drafts binding and existing draft_id required');
  let token = ''; const seen = new Set();
  for (let page = 0; page < 25; page++) {
    const response = nativeValue(await listDrafts({link_id,max_results:100,
      ...(token ? {next_page_token:token} : {})}));
    if (!response || !Array.isArray(response.drafts)) throw new Error('Gmail draft listing failed');
    const hits = response.drafts.filter(x => x && (x.draft_id ?? x.id) === draft_id);
    if (hits.length > 1) throw new Error('Gmail draft listing repeats the selected draft');
    if (hits.length) return hits[0];
    const next = response.next_page_token;
    if (!next) return null;
    if (typeof next !== 'string' || seen.has(next) || page === 24)
      throw new Error('Gmail draft listing pagination incomplete');
    seen.add(next); token = next;
  }
  throw new Error('Gmail draft listing pagination incomplete');
}
function address(value) {
  if (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(value)) return null;
  const found = /^(?:[^<>,;]*<)?([^<>\s,;]+@[^<>\s,;]+)(?:>)?$/.exec(value.trim());
  return found ? found[1].toLowerCase() : null;
}
function matchesDraft(draft, mail, attachments = []) {
  return Boolean(draft && draft.subject === mail.subject && Array.isArray(draft.to)
    && draft.to.length === 1 && address(draft.to[0]) === address(mail.to)
    && !(draft.cc || []).length && !(draft.bcc || []).length
    && draft.has_attachment === (attachments.length > 0));
}
function createReviewedFirstContactDraft({input,modules} = {}) {
  const identity = draftIdentity(input?.native_draft);
  if (typeof modules?.sha256Utf8 !== 'function' ||
      typeof modules?.attachments?.prepareNative !== 'function' ||
      typeof modules.attachments.receive !== 'function' ||
      typeof modules.attachments.receiveNativeBody !== 'function')
    throw new TypeError('Complete maintained native MIME and hash modules required');
  const original = clone(input.native_arguments);
  if (!original || original.link_id !== input.link_id || original.to !== input.to ||
      original.subject !== input.subject || typeof original.from_address !== 'string')
    throw new TypeError('Original reviewed native draft envelope required');
  const source = modules.attachments.prepareNative(original.payload);
  if (source.bodies[0].content !== input.body ||
      source.bodies[0].mime_type !== input.body_type)
    throw new TypeError('The first complete original reviewed draft text part is required');
  if (!Array.isArray(input.attachments) ||
      input.attachments.length !== source.prepared.attachments.length)
    throw new TypeError('Explicit complete original draft attachment manifest required');
  const metadata = ['filename','mime_type','bytes','sha256'];
  source.prepared.attachments.forEach((actual,index) => {
    if (metadata.some(key => actual[key] !== input.attachments[index]?.[key]))
      throw new TypeError('Reviewed draft file bytes differ from their original manifest');
  });
  const prepared = modules.attachments.prepare({attachments:input.attachments,
    attachment_data:source.prepared.attachment_data.map((file,index) =>
      ({...file,item_id:input.attachments[index].item_id}))});
  const argumentsSha = modules.sha256Utf8(JSON.stringify(original)).sha256;
  const sendArguments = Object.freeze({link_id:input.link_id,draft_id:identity.draft_id});
  function header(message,name) {
    const matches = (message.payload?.headers ?? []).filter(x => x.name?.toLowerCase() === name);
    if (matches.length > 1 || matches.some(x => typeof x.value !== 'string'))
      throw new Error('Duplicate or incomplete original draft header: '+name);
    return matches[0]?.value ?? '';
  }
  async function receive({listDrafts,readEmail} = {}) {
    if (typeof readEmail !== 'function') throw new TypeError('Native full/raw Gmail reader required');
    const listed = await exactDraft(listDrafts,input.link_id,identity.draft_id);
    const messageId = listed?.message_id ?? listed?.message?.id;
    const threadId = listed?.thread_id ?? listed?.message?.thread_id ?? listed?.message?.threadId;
    if (!matchesDraft(listed,{to:original.to,subject:original.subject},prepared.attachments) ||
        messageId !== identity.message_id || threadId !== identity.thread_id)
      throw Object.assign(new Error('The reviewed original draft revision changed'),{code:'DRAFT_CHANGED'});
    const full = nativeValue(await readEmail({link_id:input.link_id,
      message_id:identity.message_id,format:'full'}));
    const labels = full?.label_ids ?? full?.labelIds;
    let receivedBody;
    try {
      receivedBody = modules.attachments.receiveNativeBody(original.payload, full?.payload);
    } catch (cause) {
      throw Object.assign(new Error('The complete reviewed draft body changed', {cause}),
        {code:'DRAFT_CHANGED'});
    }
    if (full?.id !== identity.message_id ||
        (full.thread_id ?? full.threadId) !== identity.thread_id ||
        !Array.isArray(labels) || !labels.includes('DRAFT') || labels.includes('SENT') ||
        address(header(full,'from')) !== address(original.from_address) ||
        address(header(full,'to')) !== address(original.to) ||
        header(full,'cc') || header(full,'bcc') ||
        header(full,'subject') !== original.subject)
      throw Object.assign(new Error('The complete reviewed draft envelope changed'),{code:'DRAFT_CHANGED'});
    const received = await modules.attachments.receive(prepared,full,{
      readRaw:message_id=>readEmail({link_id:input.link_id,message_id,format:'raw'})
    });
    return {schema:'commons.reviewed-original-draft/v1',...identity,link_id:input.link_id,
      native_arguments_sha256:argumentsSha,
      body_sha256:modules.sha256Utf8(input.body).sha256,
      body_manifest:clone(receivedBody.bodies),
      attachment_manifest:clone(prepared.attachments),
      native_message:received,observed_at:new Date().toISOString()};
  }
  function revise(nextInput) {
    const nextIdentity = draftIdentity(nextInput?.native_draft);
    if (nextInput?.link_id !== input.link_id || nextInput?.to !== input.to ||
        nextIdentity.draft_id !== identity.draft_id || nextIdentity.thread_id !== identity.thread_id)
      throw new TypeError('Revise the same original Gmail draft, sender, recipient and thread');
    return createReviewedFirstContactDraft({input:clone(nextInput),modules});
  }
  return Object.freeze({identity,metadata:draftIdentity,sendArguments,
    nativeArguments:clone(original),prepared,receive,revise});
}
function createConnectedExistingFirstContactDraft(options = {}) {
  const {createConnectedFirstContact, input, modules, ...rest} = options;
  if (typeof createConnectedFirstContact !== 'function')
    throw new TypeError('The maintained createConnectedFirstContact factory is required');
  const selected = clone(input), nativeDraft = createReviewedFirstContactDraft({input:selected,modules});
  selected.attachment_data = clone(nativeDraft.prepared.attachment_data);
  return createConnectedFirstContact({...rest,input:selected,modules,nativeDraft});
}
// Existing ordinary callers retain their original body-only sender contract.
// Multipart callers use the connected factory above, including account admission.
async function sendExistingFirstContactDraft(options) {
  if (options?.createConnectedFirstContact)
    return createConnectedExistingFirstContactDraft(options).run();
  const {draft_id,listDrafts,sendDraft,...params} = options;
  const {mail} = params;
  if (!mail || typeof mail.link_id !== 'string' || typeof sendDraft !== 'function')
    throw new TypeError('a selected Gmail account and native send_draft required');
  const start = await exactDraft(listDrafts,mail.link_id,draft_id);
  if (!matchesDraft(start,mail)) return {status:'DRAFT_NOT_MATCHING_REVIEWED_INTENT',sent:false};
  let changed = false;
  const sendEmail = async () => {
    const current = await exactDraft(listDrafts,mail.link_id,draft_id);
    if (!matchesDraft(current,mail)) {
      changed = true; throw Object.assign(new Error('draft changed'),{code:'DRAFT_CHANGED'});
    }
    return sendDraft({link_id:mail.link_id,draft_id});
  };
  const {sendNativeFirstContact} = require('./revenue_first_contact_sender.cjs');
  const outcome = await sendNativeFirstContact({...params,sendEmail});
  return changed && outcome.status === 'SEND_OUTCOME_UNCERTAIN'
    ? {...outcome,status:'DRAFT_CHANGED_BEFORE_SEND',sent:false} : outcome;
}
module.exports={sendExistingFirstContactDraft,exactDraft,matchesDraft,draftIdentity,
  createReviewedFirstContactDraft,createConnectedExistingFirstContactDraft};
