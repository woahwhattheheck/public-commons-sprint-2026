import {createHash} from 'node:crypto';

const FORMATS = new Set(['portable', 'html', 'markdown', 'notices', 'reviews', 'changes', 'sources']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text = value => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const label = value => String(value || '').replace(/_/g, ' ');
const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const link = (url, caption) => safeUrl(url) ? '<a href="' + esc(safeUrl(url)) + '" rel="noreferrer">' + esc(caption || url) + '</a>' : esc(caption || url || '—');
function csvCell(value) {
  let result = text(value);
  if (/^[\t\r\n]/.test(result) || /^\s*[=+\-@]/.test(result)) result = "'" + result;
  return '"' + result.replace(/"/g, '""') + '"';
}
const csv = rows => '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
const slug = value => String(value || 'sam-workspace').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'sam-workspace';

function contents(packet) {
  if (packet?.schema !== 'stellar-forge.samgov-packet.v1' || !packet.workspace ||
      !Array.isArray(packet.editions) || !Array.isArray(packet.sources))
    throw Object.assign(new Error('A complete SAM.gov portable packet is required.'), {code: 'SAM_PACKET_REQUIRED', status: 400});
  const workspace = packet.workspace;
  const handoff = packet.handoffId ? (workspace.handoffs || []).find(item => item.id === packet.handoffId) : null;
  const selectionId = packet.selectionId || handoff?.selectionId || null;
  const selection = selectionId ? (workspace.selections || []).find(item => item.id === selectionId) : null;
  if (selectionId && !selection) throw Object.assign(new Error('The named selection is missing from its retained revision.'), {code: 'SAM_SELECTION_MISSING'});
  const rows = [];
  for (const edition of packet.editions) {
    if (selection && edition.id !== selection.editionId) continue;
    const ids = selection ? new Set(selection.noticeIds) : null;
    for (const notice of edition.rows || []) {
      if (ids && !ids.has(notice.noticeId)) continue;
      rows.push({edition, notice, review: (workspace.reviews || []).find(item =>
        item.editionId === edition.id && item.noticeId === notice.noticeId) || null});
    }
  }
  const sourceIds = new Set();
  for (const {notice} of rows) {
    if (notice.source?.sourceId) sourceIds.add(notice.source.sourceId);
    for (const companion of notice.source?.companions || []) sourceIds.add(companion.sourceId);
    for (const resource of notice.resources || []) if (resource.sourceId) sourceIds.add(resource.sourceId);
  }
  const sources = selection ? packet.sources.filter(item => sourceIds.has(item.id)) : packet.sources;
  return {workspace, handoff, selection, rows, sources,
    title: handoff?.name || selection?.name || 'SAM.gov notice workspace'};
}
const selectedNoticeKey = row => row.edition.id + '\0' + row.notice.noticeId;
const relevantChanges = view => {
  const ids=new Set(view.rows.map(row=>row.notice.noticeId)), editions=new Set(view.rows.map(row=>row.edition.id));
  return (view.workspace.changes||[]).filter(item=>ids.has(item.noticeId)&&(editions.has(item.beforeEditionId)||editions.has(item.afterEditionId)));
};
const relevantReviews = view => {
  const keys = new Set(view.rows.map(selectedNoticeKey));
  return (view.workspace.reviews || []).filter(item => keys.has(item.editionId + '\0' + item.noticeId));
};
function sourceCaption(source) {
  return [source.filename || source.id, source.bytes + ' bytes', source.sha256].join(' · ');
}
function visibleSourceText(packet, source) {
  const object = (packet.objects || []).find(item => item.sha256 === source.sha256);
  if (!object?.contentBase64 || !/^(?:text\/|application\/(?:json|xml|[^;]+\+json|[^;]+\+xml))/i.test(source.mediaType || '')) return null;
  const bytes = Buffer.from(object.contentBase64, 'base64');
  if (bytes.length !== source.bytes || digest(bytes) !== source.sha256)
    throw Object.assign(new Error('The retained source body does not match its source metadata.'), {code: 'SAM_SOURCE_BYTES_CHANGED'});
  return bytes.toString('utf8');
}

export function renderSamCsv(packet, kind = 'notices') {
  const view = contents(packet);
  if (kind === 'notices') return csv([
    ['editionId','editionCreatedAt','editionComplete','noticeId','title','solicitationNumber','organization','organizationCode','postedDate','type','baseType','active','responseDeadlineAsIssued','reviewedDeadlineAt','reviewedDeadlineTimeZone','reviewedDeadlineReason','archiveDate','naicsCode','classificationCode','setAsideCode','setAsideDescription','awardAmountAsIssued','awardNumber','awardDate','awardeeName','awardeeUei','reviewStatus','reviewOwner','reviewNotes','descriptionUrl','noticeUrl','resourceUrls','retainedResourceSourceIds','pageSourceId','pageRowPointer','pageOffset','recordSha256'],
    ...view.rows.map(({edition:e,notice:n,review:r}) => [
      e.id,e.createdAt,e.complete,n.noticeId,n.title,n.solicitationNumber,n.fullParentPathName,n.fullParentPathCode,
      n.postedDate,n.type,n.baseType,n.active,n.responseDeadLine,r?.deadline?.at,r?.deadline?.timeZone,r?.deadline?.reason,
      n.archiveDate,n.naicsCode,n.classificationCode,n.setAsideCode,n.setAsideDescription,
      n.awardAmount,n.awardNumber,n.awardDate,n.awardeeName,n.awardeeUei,r?.status || 'unreviewed',r?.owner,r?.notes,
      n.descriptionUrl,n.uiUrl,(n.resourceLinks || []).join('\n'),(n.resources || []).map(item=>item.sourceId).filter(Boolean).join('\n'),
      n.source?.sourceId,n.source?.rowPointer,n.source?.pageOffset,n.recordSha256,
    ]),
  ]);
  if (kind === 'reviews') return csv([
    ['editionId','noticeId','status','owner','notes','reviewedDeadlineAt','timeZone','deadlineReason','reviewId','updatedAt'],
    ...relevantReviews(view).map(r => [r.editionId,r.noticeId,r.status,r.owner,r.notes,r.deadline?.at,r.deadline?.timeZone,r.deadline?.reason,r.id,r.updatedAt || r.createdAt]),
  ]);
  if (kind === 'changes') return csv([
    ['noticeId','earlierEditionId','laterEditionId','decision','owner','note','changeId','reviewedAt'],
    ...relevantChanges(view).map(c=>[c.noticeId,c.beforeEditionId,c.afterEditionId,c.decision,c.owner,c.note,c.id,c.updatedAt||c.createdAt]),
  ]);
  if (kind === 'sources') return csv([
    ['sourceId','kind','filename','url','capturedAt','sourceStatus','mediaType','bytes','retainedSha256','originalSha256','redactions','request'],
    ...view.sources.map(s => [s.id,s.kind,s.filename,s.url,s.capturedAt,s.status,s.mediaType,s.bytes,s.sha256,s.originalSha256,s.redactions,s.request]),
  ]);
  throw Object.assign(new Error('Choose notices, reviews, changes, or sources CSV.'), {code: 'SAM_CSV_FORMAT_INVALID', status: 400});
}

export function renderSamMarkdown(packet) {
  const view = contents(packet), lines = [];
  const line = value => lines.push(String(value ?? ''));
  line('# ' + view.title); line('');
  line('Workspace: ' + packet.id + ' · revision ' + packet.revision);
  line('Prepared: ' + packet.createdAt); line('');
  if (view.handoff) {
    line('Named handoff: ' + view.handoff.id);
    line('Reviewed source revision: ' + view.handoff.sourceRevision);
    line('Selection revision: ' + view.handoff.selectionRevision);
    if (view.handoff.note) line(view.handoff.note); line('');
  }
  if (view.selection?.notes) { line(view.selection.notes); line(''); }
  line('## Notice register'); line('');
  line(view.rows.length + ' notice records across ' + new Set(view.rows.map(row => row.edition.id)).size + ' retained editions.');
  line('The public API supplies the latest available notice version. Edition history records what this workspace captured; original source dates and deadline strings remain attached.'); line('');
  for (const {edition:e,notice:n,review:r} of view.rows) {
    line('### ' + n.title); line('');
    line('- Notice: ' + n.noticeId);
    line('- Solicitation: ' + (n.solicitationNumber || 'Not supplied'));
    line('- Organization: ' + (n.fullParentPathName || 'Not supplied'));
    line('- Type / active: ' + [n.type,n.active].filter(Boolean).join(' / '));
    line('- Posted as issued: ' + (n.postedDate || 'Not supplied'));
    line('- Response deadline as issued: ' + (n.responseDeadLine || 'Not supplied'));
    if (r?.deadline) line('- Reviewed deadline: ' + r.deadline.at + ' · ' + r.deadline.timeZone + ' · ' + r.deadline.reason);
    line('- Operator review: ' + label(r?.status || 'unreviewed') + (r?.owner ? ' · ' + r.owner : ''));
    if (r?.notes) { line(''); line(r.notes); }
    line(''); line('Edition: ' + e.id + ' · captured ' + e.createdAt + ' · ' + (e.complete ? 'complete retained scope' : 'partial retained scope')+' · '+label(e.sourceBasis));
    if (safeUrl(n.uiUrl)) { line(''); line('Notice source: ' + safeUrl(n.uiUrl)); }
    if (n.awardNumber || n.awardAmount) { line(''); line('Award as issued: ' + [n.awardNumber,n.awardAmount,n.awardDate,n.awardeeName,n.awardeeUei].filter(Boolean).join(' · ')); }
    if ((n.pointOfContact || []).length) {
      line(''); line('Published contacts:');
      for (const contact of n.pointOfContact)
        line('- ' + [contact.fullName || contact.fullname,contact.title,contact.email,contact.phone].filter(Boolean).join(' · '));
    }
    line(''); line('Retained source: ' + n.source?.sourceId + ' · row ' + n.source?.rowPointer + ' · record SHA256 ' + n.recordSha256);
    if(n.descriptions?.length){
      line('');line('Issued description:');
      for(const description of n.descriptions){
        line('');line(description.body);line('');
        line('Original pointer: '+description.sourceId+' '+description.rowPointer);
      }
    }
    if(n.noticeHistory?.length){
      line('');line('Published history:');
      for(const entry of n.noticeHistory)
        line('- '+entry.index+' · '+entry.postedDate+' · '+entry.actionType+' · '+entry.opportunityId);
    }
    for (const resource of n.resources || []) {
      line(''); line('Retained ' + label(resource.kind) + ': ' + sourceCaption(resource));
      if (resource.url) line(resource.url);
    }
    const retainedUrls = new Set((n.resources || []).map(item => item.url));
    const remaining = [n.descriptionUrl,...(n.resourceLinks || [])].filter(url => url && !retainedUrls.has(url));
    if (remaining.length) {
      line(''); line('Issued resource links awaiting retained bytes:');
      for (const url of remaining) line('- ' + url);
    }
    line('');
  }
  const changes=relevantChanges(view);
  if(changes.length){line('## Change review');line('');for(const c of changes){line('### '+c.noticeId);line('');line('Earlier edition: '+c.beforeEditionId);line('Later edition: '+c.afterEditionId);line('Decision: '+label(c.decision)+' · '+c.owner);line('');line(c.note);line('');}}
  line('## Retained source index'); line('');
  for (const source of view.sources) {
    line('### ' + (source.filename || source.id)); line('');
    line(source.id + ' · ' + label(source.kind) + ' · ' + source.bytes + ' bytes · ' + source.mediaType);
    line('Captured: ' + source.capturedAt + ' · ' + (source.status==='received_file'?'Received file':'HTTP '+source.status));
    if (source.url) line(source.url);
    line('SHA256: ' + source.sha256);
    if (source.originalSha256 && source.originalSha256 !== source.sha256)
      line('Original response SHA256: ' + source.originalSha256 + ' · retained redactions: ' + text(source.redactions));
    line('');
  }
  line('## Receiving'); line('');
  line('The companion portable JSON contains the retained revision chain, complete editions and original source objects required by the receiving command.');
  line('Packet SHA256: ' + packet.sha256); line('');
  return lines.join('\n');
}

export function renderSamHtml(packet) {
  const view = contents(packet);
  const css = 'body{margin:0;color:#232629;background:#fff;font:14px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:38px 30px}header{border-bottom:2px solid #4a5055;padding-bottom:22px;margin-bottom:26px}h1{font-size:28px;line-height:1.25;margin:5px 0 12px;letter-spacing:-.5px}h2{font-size:21px;margin:30px 0 14px}h3{font-size:17px;line-height:1.45;margin:0 0 12px}p{margin:8px 0 14px}.eyebrow{font-size:10px;letter-spacing:1.4px;color:#646b70;text-transform:uppercase}.muted{color:#687075;font-size:12px}.notice{border:1px solid #cdd2d5;padding:21px;margin:17px 0;break-inside:avoid}.grid{display:grid;grid-template-columns:160px minmax(0,1fr);gap:6px 18px;margin:14px 0;font-size:12px}.grid dt{color:#687075}.grid dd{margin:0;overflow-wrap:anywhere}.table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th{font-size:10px;text-transform:uppercase;color:#636a70;letter-spacing:.6px;background:#f0f2f3}td,th{padding:10px;border:1px solid #d2d7da;vertical-align:top;overflow-wrap:anywhere}a{color:inherit;text-underline-offset:3px}.review{background:#f3f5f6;padding:12px 15px;margin:15px 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.source{border-top:1px solid #ccd2d6;padding:16px 0;break-inside:avoid}.source h3{font-size:14px}.mono{font:11px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}pre{font:11px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;padding:14px;background:#f4f5f6}details{margin:12px 0}summary{font-size:12px;cursor:pointer}footer{border-top:1px solid #cbd0d3;padding-top:18px;margin-top:30px;font-size:11px;color:#626a6f}@media(max-width:650px){main{padding:22px 16px}.notice{padding:16px}.grid{grid-template-columns:110px minmax(0,1fr);gap:6px 10px;font-size:11px}h1{font-size:24px}.table-wrap{overflow-x:auto}.table{min-width:540px}}@media print{main{max-width:none;padding:0}h2{break-after:avoid}a{text-decoration:none}.notice{break-inside:auto}details:not([open]){display:none}footer{font-size:9px}}';
  const kv = pairs => '<dl class="grid">' + pairs.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(text(v))+'</dd>').join('') + '</dl>';
  const notices = view.rows.map(({edition:e,notice:n,review:r}) => {
    const resources = (n.resources || []).map(resource =>
      '<tr><td>'+esc(label(resource.kind))+'</td><td>'+esc(resource.filename || resource.sourceId)+'</td><td>'+esc(resource.bytes)+' B</td><td class="mono">'+esc(resource.sha256)+'</td></tr>').join('');
    const retainedUrls = new Set((n.resources || []).map(item=>item.url));
    const missing = [n.descriptionUrl,...(n.resourceLinks || [])].filter(url=>url&&!retainedUrls.has(url));
    const contacts = (n.pointOfContact || []).map(contact =>
      '<li>'+esc([contact.fullName || contact.fullname,contact.title,contact.email,contact.phone].filter(Boolean).join(' · '))+'</li>').join('');
    return '<article class="notice"><p class="eyebrow">'+esc(n.solicitationNumber || n.noticeId)+'</p><h3>'+esc(n.title)+'</h3>' +
      kv([['Organization',n.fullParentPathName],['Organization ID',n.organizationId],['Issued time zone',n.issuedTimeZone],['Notice type',n.type],['Active as issued',n.active],['Posted as issued',n.postedDate],['Deadline as issued',n.responseDeadLine || 'Not supplied'],['Reviewed deadline',r?.deadline ? [r.deadline.at,r.deadline.timeZone,r.deadline.reason].join(' · ') : null],['NAICS / classification',[n.naicsCode,n.classificationCode].filter(Boolean).join(' / ')],['Set-aside',[n.setAsideCode,n.setAsideDescription].filter(Boolean).join(' · ')],['Review',label(r?.status || 'unreviewed')+(r?.owner?' · '+r.owner:'')]]) +
      (r?.notes?'<div class="review">'+esc(r.notes)+'</div>':'') +
      '<p class="muted">'+link(n.uiUrl,'Open issued notice')+' · Edition '+esc(e.id)+' · '+esc(e.createdAt)+' · '+(e.complete?'Complete retained scope':'Partial retained scope')+' · '+esc(label(e.sourceBasis))+'</p>' +
      (n.awardNumber || n.awardAmount ? '<h4>Award information as issued</h4>'+kv([['Award number',n.awardNumber],['Amount',n.awardAmount],['Award date',n.awardDate],['Awardee',n.awardeeName],['UEI',n.awardeeUei]]) : '') +
      (contacts?'<details><summary>Published contact information</summary><ul>'+contacts+'</ul></details>':'') +
      (n.descriptions?.length?'<h4>Issued description</h4>'+n.descriptions.map(item=>
        '<pre>'+esc(item.body)+'</pre><p class="mono">'+esc(item.sourceId+' '+item.rowPointer)+'</p>').join(''):'')+
      (n.noticeHistory?.length?'<details><summary>Published notice history</summary><div class="table-wrap"><table class="table"><thead><tr><th>Version</th><th>Posted as issued</th><th>Action</th><th>Notice</th></tr></thead><tbody>'+
        n.noticeHistory.map(item=>'<tr><td>'+esc(item.index)+'</td><td>'+esc(item.postedDate)+'</td><td>'+esc(item.actionType)+'</td><td>'+esc(item.opportunityId)+'</td></tr>').join('')+'</tbody></table></div></details>':'')+
      (resources?'<h4>Retained description and attachments</h4><div class="table-wrap"><table class="table"><thead><tr><th>Kind</th><th>File</th><th>Bytes</th><th>SHA256</th></tr></thead><tbody>'+resources+'</tbody></table></div>':'') +
      (missing.length?'<details><summary>'+missing.length+' issued resource links awaiting retained bytes</summary><ul>'+missing.map(url=>'<li>'+link(url,url)+'</li>').join('')+'</ul></details>':'') +
      '<p class="mono">Notice '+esc(n.noticeId)+' · record '+esc(n.recordSha256)+'<br>Source '+esc(n.source?.sourceId)+' · row '+esc(n.source?.rowPointer)+'</p></article>';
  }).join('');
  const changes=relevantChanges(view);
  const changeHtml=changes.length?'<h2>Change review</h2>'+changes.map(c=>'<section class="notice"><h3>'+esc(c.noticeId)+'</h3>'+kv([['Earlier edition',c.beforeEditionId],['Later edition',c.afterEditionId],['Decision',label(c.decision)],['Owner',c.owner]])+'<div class="review">'+esc(c.note)+'</div></section>').join(''):'';
  const sources = view.sources.map(source => {
    const body = source.kind === 'description' ? visibleSourceText(packet, source) : null;
    return '<section class="source"><h3>'+esc(source.filename || source.id)+'</h3>'+kv([['Kind',label(source.kind)],['Captured',source.capturedAt],['Source status',source.status==='received_file'?'Received file':'HTTP '+source.status],['Media type',source.mediaType],['Bytes',source.bytes]]) +
      '<p>'+link(source.url,source.url)+'</p><p class="mono">Source '+esc(source.id)+'<br>SHA256 '+esc(source.sha256)+
      (source.originalSha256 && source.originalSha256!==source.sha256?'<br>Original response '+esc(source.originalSha256)+'<br>Retained redactions '+esc(text(source.redactions)):'')+'</p>' +
      (body!==null?'<details><summary>Read complete retained description source</summary><pre>'+esc(body)+'</pre></details>':'')+'</section>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>'+esc(view.title)+'</title><style>'+css+'</style></head><body><main><header><p class="eyebrow">Starforge · SAM.gov opportunity intake</p><h1>'+esc(view.title)+'</h1><p class="muted">Workspace '+esc(packet.id)+' · revision '+esc(packet.revision)+' · '+esc(packet.createdAt)+'</p>'+
    (view.handoff?kv([['Named handoff',view.handoff.id],['Source revision reviewed',view.handoff.sourceRevision],['Selection revision',view.handoff.selectionRevision],['Prepared by',view.handoff.createdBy]])+'<p>'+esc(view.handoff.note)+'</p>':'')+
    (view.selection?.notes?'<p>'+esc(view.selection.notes)+'</p>':'')+
    '</header><h2>Notice register</h2><p>'+view.rows.length+' notice records across '+new Set(view.rows.map(row=>row.edition.id)).size+' retained editions.</p><p class="muted">Each edition records its original source format and acquisition. Search captures and received notice documents retain their own source history. Source dates, response deadlines and amounts retain the issued strings.</p>'+
    (notices||'<p>No notices are retained in this view.</p>')+changeHtml+'<h2>Retained source index</h2>'+sources+
    '<footer>The companion portable JSON contains the original revision chain, complete retained editions and source objects for receiving.<p class="mono">Packet SHA256 '+esc(packet.sha256)+'</p></footer></main></body></html>\n';
}

export async function exportSamWorkspace(store, {format = 'portable', revision, selectionId, handoffId} = {}) {
  if (format === 'md') format = 'markdown';
  if (!FORMATS.has(format)) throw Object.assign(new Error('Choose portable, html, markdown, notices, reviews, changes, or sources.'), {code:'SAM_EXPORT_FORMAT_INVALID',status:400});
  if (handoffId && revision !== undefined) throw Object.assign(new Error('A named handoff already fixes its revision.'), {code:'SAM_EXPORT_REVISION_CONFLICT',status:400});
  if (handoffId && selectionId) throw Object.assign(new Error('Choose a named handoff or a selection.'), {code:'SAM_EXPORT_SELECTION_CONFLICT',status:400});
  const packet = await store.exportPacket({
    ...(revision===undefined?{}:{revision}), ...(selectionId?{selectionId}:{}), ...(handoffId?{handoffId}:{}),
  });
  const view = contents(packet), base = slug(view.title) + '-r' + packet.revision;
  const [body, mediaType, suffix] = format==='portable' ? [json(packet),'application/json; charset=utf-8','.json']
    : format==='html' ? [renderSamHtml(packet),'text/html; charset=utf-8','.html']
      : format==='markdown' ? [renderSamMarkdown(packet),'text/markdown; charset=utf-8','.md']
        : [renderSamCsv(packet,format),'text/csv; charset=utf-8','-'+format+'.csv'];
  const bytes = Buffer.from(body);
  return {bytes, mediaType, filename:base+suffix, revision:packet.revision,
    packetSha256:packet.sha256, sha256:digest(bytes)};
}
