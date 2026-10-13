// SPDX-License-Identifier: MIT
// Parcel source review and portfolio operations in the original analyst workspace.
const TITLES = {
  'county-assessed': 'County assessed amount',
  'local-assessed': 'Municipal / school assessed amount',
  'base-year-2012-appraisal': '2012 base-year unreduced appraisal',
  'city-reported-square-feet': 'City reported square feet',
  'county-reported-square-feet': 'County reported square feet',
  'publisher-reported-acreage': 'Publisher reported acreage'
};
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value, null, 2);
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value !== null && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const keyPattern = /^[A-Z0-9]{16}$/;

export function acceptParcelResult(draft, input, result) {
  const action = input.action, payload = input.payload;
  if (action === 'source.preview') draft.sourcePreview = {payload: clone(payload), result: clone(result)};
  if (['source.import', 'source.select', 'successor.review'].includes(action)) {
    draft.editionId = result.editionId; draft.offset = 0; draft.selectedKeys = []; draft.key = '';
  }
  if (action === 'review.prepare') {
    draft.batch = {editionId: result.editionId, decisions: clone(result.decisions)};
    draft.batchText = json(draft.batch); draft.batchPreparation = result;
    delete draft.batchPreview;
  }
  if (action === 'review.preview') draft.batchPreview = {payload: clone(payload), result: clone(result)};
  if (action === 'review.save') {
    for (const decision of payload.decisions) delete draft.reviewDrafts?.[payload.editionId + ':' + decision.key];
    draft.lastReview = clone(result);
    delete draft.batchPreview; delete draft.batchPreparation; delete draft.batch; delete draft.batchText;
  }
  if (action === 'entity.save') {
    draft.entity = {...clone(result.definition), expectedVersion: result.version};
  }
  if (action === 'portfolio.preview') draft.portfolioPreview = {payload: clone(payload), result: clone(result)};
  if (action === 'portfolio.create') draft.portfolioId = result.portfolio.id;
  if (action === 'successor.compare') draft.comparison = clone(result);
}

export function acceptParcelCaptureResult(draft, input, result) {
  draft.capture ||= {};
  const capture = draft.capture;
  capture.directory = result.directory || input.payload.directory;
  capture.observed = clone(result);
  capture.section = input.action;
  if (result.capture?.label) capture.label = result.capture.label;
  if (result.receiving) capture.publisherChangeReason = result.receiving.publisherChangeReason || '';
  draft.section = 'Capture';
}

export async function renderParcels(ctx) {
  const {element:e, button, link, panel, detail, note, actions, label, inputValue, selectValue,
    textArea, table, pager, compact, clean, request, run, render, save, jsonDownload,
    requireValue, uploadControl, draft:p} = ctx;
  const data = await request('/api/parcels');
  const editionId = data.editions.some(row => row.id === p.editionId) ? p.editionId : data.activeEditionId;
  p.editionId = editionId || '';
  const edition = data.editions.find(row => row.id === editionId);
  const tabs = ['Sources', 'Capture', 'Parcels', 'Responsibility', 'Portfolios', 'Later edition'];
  const tab = tabs.includes(p.section) ? p.section : 'Sources';
  const update = (name, value) => { p[name] = value; save(); };
  const mutate = (target, field, value) => { target[field] = value; save(); };
  const field = (name, title, options = {}, hint) => label(title, inputValue(p[name] ?? '', value => update(name, value), options), hint);
  const sourceName = (row, recordId) => row.records.find(record => record.id === recordId)?.sourceId || '';
  const claimText = (row, claim) => [claim.value, TITLES[claim.basis] || claim.basis, claim.unit,
    claim.taxYear && 'tax year ' + claim.taxYear, claim.asOfDate && 'as of ' + claim.asOfDate,
    sourceName(row, claim.recordId), claim.field].filter(Boolean).join(' · ');
  const entities = data.entities.filter(row => data.activeEntities[row.entityId] === row.id);
  const sourceLink = value => /^https?:\/\//i.test(value) ? link('Open publisher source', value) : clean(value);
  const editionChoices = data.editions.map(row => [row.id, row.label + ' · ' + (row.capturedAt || row.createdAt || '') + ' · ' + compact(row.id)]);
  const toolbar = panel('Parcel portfolios',
    note('Review source ownership assertions, named responsibility, status, assessment and area choices in this same project. Every saved decision retains the selected source edition and analyst.'),
    actions(...tabs.map(name => button(name, async () => { update('section', name); await render(); },
      {'aria-pressed': name === tab}))),
    edition && label('Working parcel edition', selectValue(editionId, editionChoices, async value => {
      p.editionId = value; p.offset = 0; p.key = ''; p.selectedKeys = []; save(); await render();
    }), 'This is the edition shown in these forms. Use Make current to change the saved project selection.'),
    edition && actions(e('span', {class:'count'}, edition.summary.selectedKeys + ' parcels · ' + (edition.capturedAt ? 'edition captured ' + edition.capturedAt : 'assembled ' + (edition.createdAt || 'see source files'))),
      edition.id !== data.activeEditionId && button('Make current parcel edition', () => run('source.select', {editionId: edition.id})),
      button('Refresh parcel workspace', render)));
  const sections = {Sources: sources, Capture: captures, Parcels: parcels, Responsibility: responsibility,
    Portfolios: portfolios, 'Later edition': laterEdition};
  return [toolbar, ...await sections[tab]()];


  async function captures() {
    p.capture ||= {maxRequests:8, timeout:45};
    const c = p.capture;
    const history = await request('/api/parcels/captures?offset=' + (c.offset || 0) + '&limit=25');
    const current = c.observed?.directory === c.directory?.trim() ? c.observed : null;
    const directory = () => requireValue(c.directory?.trim(), 'Choose this named capture’s absolute directory.');
    const captureField = (key, title, options = {}, hint) =>
      label(title, inputValue(c[key] ?? '', value => mutate(c, key, value), options), hint);
    const read = async path => {
      c.observed = await request('/api/parcels/capture?' + new URLSearchParams({directory:path}));
      c.directory = c.observed.directory; c.label = c.observed.capture.label;
      if (c.observed.receiving) c.publisherChangeReason = c.observed.receiving.publisherChangeReason || '';
      save(); await render();
    };
    const statusRows = current ? [
      ['Status', current.status], ['Completed source requests', current.completed],
      ['Pending source requests', current.pending], ['Split responses', current.splitResponses],
      ['Selected parcel keys', current.selection?.expectedDistinctKeys ?? 'Selection pending'],
      ['Original capture', current.capture.captureId], ['Started by', current.capture.actor],
      ['Started at', current.capture.createdAt]
    ] : [];
    const waiting = current?.waiting || [], blocked = current?.blocked || [];
    const ready = current?.status === 'READY', receiving = current?.receiving;
    const result = [panel('Capture a named publisher refresh',
      note('Use this for a newly requested refresh of the Pittsburgh public sources. The existing retained cohort remains in Sources. Creating or opening a capture makes no publisher request.'),
      captureField('directory', 'Capture working directory on this host', {},
        'Choose an absolute directory outside this project. Keep this folder until its latest checkpoint is saved.'),
      captureField('label', 'Refresh label'),
      actions(button('Create named refresh', () => ctx.runCapture('init', {
        directory:directory(), label:requireValue(c.label?.trim(), 'Name this refresh.')})),
        button('Open capture / refresh status', () => read(directory()))),
      current && table([['Measure', row => row[0]], ['Observed', row => clean(row[1])]], statusRows),
      current && detail('Original selection and coverage', current.selection),
      current && panel('Advance this same capture',
        note('Each click makes at most the selected number of publisher requests. WAITING and BLOCKED are retained outcomes. Review the displayed deadline or issue before continuing.'),
        captureField('maxRequests', 'Maximum publisher requests per action', {type:'number', min:1, max:64}),
        captureField('timeout', 'Per-request timeout in seconds', {type:'number', min:1, max:120}),
        actions(button('Advance capture', () => ctx.runCapture('advance', {
          directory:directory(), maxRequests:Number(c.maxRequests || 8), timeout:Number(c.timeout || 45)}),
          {disabled:ready || !!waiting.length || !!blocked.length}),
          button('Save complete capture checkpoint', () => ctx.runCapture('checkpoint', {directory:directory()}))),
        current.checkpoint && note('Saved checkpoint: ' + current.checkpoint.requestId + ' · ' +
          current.checkpoint.members + ' files · ' + current.checkpoint.expandedBytes + ' expanded bytes')),
      waiting.length > 0 && panel('Publisher cooldown',
        table([['Request', row => row.jobId], ['Retry no earlier than', row => clean(row.retryAfter)],
          ['Original response', row => detail('Retained status and headers', row)]], waiting),
        note('Open capture / refresh status after the deadline. The capture engine preserves the provider’s saved retry deadline across interruption and receiving.')),
      blocked.length > 0 && panel('Review blocked publisher requests',
        table([['Request', row => row.jobId], ['Issue', row => clean(row.error?.message || row.error?.code)],
          ['Original attempt', row => detail('Retained request and response', row)],
          ['Select', row => button('Review ' + row.jobId, async () => {c.jobId = row.jobId; save(); await render();})]], blocked),
        captureField('jobId', 'Publisher request to retry'),
        label('Reason for retry', textArea(c.reason || '', value => mutate(c, 'reason', value))),
        button('Record reviewed retry', () => ctx.runCapture('retry', {directory:directory(),
          jobId:requireValue(c.jobId?.trim(), 'Choose the blocked request.'),
          expectedPreviousSha256:requireValue(blocked.find(row => row.jobId === c.jobId?.trim())?.reviewSha256,
            'Refresh status and choose the displayed blocked attempt.'),
          reason:requireValue(c.reason?.trim(), 'Record the reviewed reason for another attempt.')}))),
      ready && panel('Prepare the complete receiving edition',
        note('Preparation validates every retained source body and complete selected-key coverage through the original parcel intake. Metadata changes require a recorded review before publication.'),
        current.publisherReview && detail('Publisher metadata changed during capture', current.publisherReview, true),
        label('Publisher-change review reason, when required',
          textArea(c.publisherChangeReason || '', value => mutate(c, 'publisherChangeReason', value))),
        button(receiving ? 'Reopen completed receiving edition' : 'Prepare receiving edition',
          () => ctx.runCapture('finalize', {directory:directory(),
            ...(c.publisherChangeReason?.trim() ? {publisherChangeReason:c.publisherChangeReason.trim()} : {})}))),
      receiving && panel('Completed parcel source edition',
        e('p', {class:'break'}, receiving.directory),
        e('p', {class:'break'}, 'Manifest SHA-256: ', e('code', {}, receiving.manifestSha256)),
        detail('Complete receiving receipt', receiving, true),
        button('Use this edition in Sources', async () => {
          p.directory = receiving.directory; p.expectedManifestSha256 = receiving.manifestSha256;
          delete p.sourcePreview; p.section = 'Sources'; save(); await render();
        })))];
    result.push(panel('Saved capture requests and checkpoints',
      note('These records belong to the original workspace journal. History retains every result file and same-request continuation. A checkpoint restores the complete capture, including exact response bodies, attempt receipts and provider deadlines.'),
      table([['Action / capture', row => [row.action, row.result?.capture?.label || row.input.label || ''].filter(Boolean).join(' · ')],
        ['Status', row => row.status + (row.result?.status ? ' / ' + row.result.status : '')],
        ['Operator / time', row => row.actor + ' · ' + row.updatedAt],
        ['Request', row => compact(row.requestId)],
        ['Open', row => button('Open saved capture', () => read(row.input.directory))],
        ['Restore', row => row.checkpoint && row.status === 'COMPLETED' ? button('Choose checkpoint', async () => {
          c.checkpointRequestId = row.requestId; save(); await render();
        }) : '—'],
        ['Details', row => detail('Original request and result', row)]], history.items),
      pager({...history, limit:25}, async offset => {c.offset = offset; save(); await render();})));
    result.push(panel('Restore a saved capture on this host',
      note('Choose a completed checkpoint above and a new empty working directory outside this project. The restore checks every saved byte before allowing another capture action. It makes no publisher request.'),
      captureField('checkpointRequestId', 'Original checkpoint request ID'),
      captureField('restoreDirectory', 'New empty capture directory'),
      button('Restore complete capture', () => ctx.runCapture('restore', {
        directory:requireValue(c.restoreDirectory?.trim(), 'Choose a new receiving directory.'),
        checkpointRequestId:requireValue(c.checkpointRequestId?.trim(), 'Choose a completed original checkpoint.')}))));
    return result;
  }

  async function sources() {
    if (p.directory === undefined && ctx.sourceDirectory) p.directory = ctx.sourceDirectory;
    const ready = p.sourcePreview && p.sourcePreview.payload.directory === p.directory?.trim() &&
      (!p.expectedManifestSha256?.trim() || p.expectedManifestSha256.trim() === p.sourcePreview.result.manifestSha256);
    const preview = ready ? p.sourcePreview.result : null;
    const items = [panel('Receive an original parcel source edition',
      note('Choose the complete directory containing parcel-source-receiving.json and every exact file it names. Both the original City CSV files and the provider’s filtered JSON responses are accepted.'),
      uploadControl('source'),
      field('directory', 'Complete source directory on this host'),
      ctx.sourceDirectory && button('Use last completed source-folder upload', async () => { update('directory', ctx.sourceDirectory); await render(); }),
      field('expectedManifestSha256', 'Expected manifest SHA-256, if already supplied'),
      button('Preview complete parcel source', () => run('source.preview', {
        directory: requireValue(p.directory?.trim(), 'Choose the complete original source directory.'),
        ...(p.expectedManifestSha256?.trim() ? {expectedManifestSha256: p.expectedManifestSha256.trim()} : {})})),
      preview && panel('Source preview',
        table([['Measure', row => row[0]], ['Observed', row => clean(row[1])]],
          Object.entries(preview.summary).filter(([, value]) => typeof value !== 'object')),
        note('The preview retains both conflicting assertions and explicit missing-match outcomes. It does not assign an accountable operator.'),
        detail('Source files and counts', preview.summary.sources, true),
        detail('Source exceptions, first 50', preview.exceptions),
        detail('Selected parcel examples, first 25', preview.examples),
        e('p', {class:'break'}, 'Manifest SHA-256: ', e('code', {}, preview.manifestSha256)),
        button('Import this complete source edition', () => {
          requireValue(p.sourcePreview?.payload.directory === p.directory?.trim() &&
            (!p.expectedManifestSha256?.trim() || p.expectedManifestSha256.trim() === preview.manifestSha256),
            'Preview the selected source directory and manifest before importing.');
          return run('source.import', {directory:p.sourcePreview.payload.directory,
            expectedManifestSha256:preview.manifestSha256, previewSha256:preview.previewSha256});
        })))];
    items.push(panel('Retained source editions',
      table([['Edition', row => button(row.label, async () => { p.editionId = row.id; p.section = 'Parcels'; p.offset = 0; p.key = ''; p.selectedKeys = []; save(); await render(); })],
        ['Edition capture / assembly', row => row.capturedAt ? 'Captured ' + row.capturedAt : 'Assembled ' + clean(row.createdAt)], ['Parcels', row => String(row.summary.selectedKeys)],
        ['County matches', row => String(row.summary.countyMatchedKeys)],
        ['Geometry matches', row => String(row.summary.geometryMatchedKeys)],
        ['Source issues', row => String(row.summary.conflictedKeys)],
        ['Imported by', row => row.actor],
        ['Original edition', row => detail('Identity and receiving files', row)]], data.editions)));
    if (edition) items.push(panel('Original files in ' + edition.label,
      note('Source capture time, underlying source date and ETL date are distinct. Date-only captures remain date-only.'),
      table([['File', row => link(row.path, '/download/parcels/editions/' + edition.id + '/files/' + row.sha256)],
        ['Family', row => row.family], ['Source', row => row.sourceId],
        ['Captured', row => row.capturedAt + (row.captureTimePrecision === 'date' ? ' · date precision' : '')],
        ['Underlying / ETL', row => [row.sourceDate, row.etlDate].filter(Boolean).join(' / ') || '—'],
        ['Bytes', row => String(row.bytes)], ['Publisher', row => sourceLink(row.sourceUrl)],
        ['Identity and coverage', row => detail('Exact original descriptor', row)]], edition.inputs),
      actions(link('Download complete source exceptions', '/download/parcels/editions/' + edition.id + '/exceptions'))));
    return items;
  }

  function noEdition() {
    return panel('Select a parcel edition', note('Receive the complete original source from Sources, then choose its retained edition.'));
  }

  async function parcels() {
    if (!edition) return [noEdition()];
    p.filters ||= {query:'', ward:'', issue:'', review:''};
    const filters = p.filters;
    const params = new URLSearchParams({editionId, offset:String(p.offset || 0), limit:'50', ...filters});
    const page = await request('/api/parcels/rows?' + params);
    p.selectedKeys ||= [];
    const selectKeys = keys => { p.selectedKeys = [...new Set(keys)]; save(); };
    const filterPanel = panel('Original parcels and source assertions',
      e('div', {class:'fields'},
        label('Parcel key, address or assertion', inputValue(filters.query, value => mutate(filters, 'query', value))),
        label('Original ward value', inputValue(filters.ward, value => mutate(filters, 'ward', value))),
        label('Source issue', selectValue(filters.issue, [['','All source outcomes'],
          'SOURCE_ASSERTIONS_DIFFER','SOURCE_RECORD_CONFLICT','SOURCE_GEOMETRY_MISSING',
          'SOURCE_NUMBER_INVALID','PUBLISHED_TOTAL_DIFFERS'], value => mutate(filters, 'issue', value))),
        label('Saved review', selectValue(filters.review, [['','All parcels'],['reviewed','Has a saved review'],
          ['unreviewed','No saved review']], value => mutate(filters, 'review', value)))),
      actions(button('Apply parcel filters', async () => { p.offset = 0; save(); await render(); }),
        button('Select current page for batch review', async () => {
          requireValue(new Set([...p.selectedKeys, ...page.items.map(row => row.key)]).size <= 1000,
            'One review batch contains up to 1,000 selected parcels. Save this batch before selecting more.');
          selectKeys([...p.selectedKeys, ...page.items.map(row => row.key)]); await render();
        }),
        button('Clear selected keys', async () => { selectKeys([]); await render(); }),
        e('span', {class:'count'}, p.selectedKeys.length + ' selected across pages')),
      table([['Select', row => inputValue(p.selectedKeys.includes(row.key), value => {
          const set = new Set(p.selectedKeys); value ? set.add(row.key) : set.delete(row.key);
          p.selectedKeys = [...set]; save();
        }, {type:'checkbox', checked:p.selectedKeys.includes(row.key), 'aria-label':'Select parcel ' + row.key})],
        ['Parcel / addresses', row => [button(row.key, async () => { p.key = row.key; save(); await render(); }), note(row.addresses.join(' · '))]],
        ['Owner assertions', row => row.owners.join(' / ') || '—'],
        ['Status / ward', row => [row.statuses.join(' / ') || '—', note(row.wards.join(' / '))]],
        ['Source lookups', row => ['County ' + row.coverage['county-assessment-json'].state,
          e('br'), 'Geometry ' + row.coverage['pittsburgh-parcels-geojson'].state]],
        ['Review', row => row.decision ? row.decision.actor + ' · ' + row.decision.reviewedAt : 'Unreviewed'],
        ['Source issues', row => row.issues.length ? detail(String(row.issues.length) + ' source issues', row.issues) : '—']],
        page.items),
      pager(page, async offset => { update('offset', offset); await render(); }));
    const items = [filterPanel];
    if (p.key) items.push(await parcelEditor(p.key));
    items.push(batchPreparation(), batchReview());
    return items;
  }

  function inputFor(row, decision) {
    const value = {key:row.key, factsSha256:row.factsSha256, expectedDecisionSha256:decision?.sha256 ?? null,
      owner:{mode:'unresolved'}, status:{mode:'unresolved'}, ward:{mode:'unresolved'},
      accountable:{mode:'unassigned'}, assessmentRecordId:null, areaClaimId:null,
      geometryClaimId:null, reason:'', evidence:[]};
    if (decision) {
      for (const role of ['owner','status','ward']) value[role] = decision[role].mode === 'source'
        ? {mode:'source', claimId:decision[role].claim.id} : {mode:'unresolved'};
      if (decision.accountable.mode === 'entity') value.accountable = {
        mode:'entity', entityId:decision.accountable.entity.entityId, entityVersion:decision.accountable.entity.id};
      Object.assign(value, {assessmentRecordId:decision.assessmentRecordId, areaClaimId:decision.area?.id ?? null,
        geometryClaimId:decision.geometry?.id ?? null, reason:decision.reason, evidence:clone(decision.evidence || [])});
    }
    return value;
  }

  async function parcelEditor(key) {
    const selected = await request('/api/parcels/detail?' + new URLSearchParams({editionId, key}));
    const row = selected.parcel, current = selected.decision, draftKey = editionId + ':' + key;
    p.reviewDrafts ||= {};
    const value = p.reviewDrafts[draftKey] ||= inputFor(row, current);
    const changed = value.factsSha256 !== row.factsSha256 ||
      value.expectedDecisionSha256 !== (current?.sha256 ?? null);
    const set = (field, next) => { value[field] = next; save(); };
    const claimChoice = (role, title, kind) => label(title, selectValue(value[role].mode === 'source' ? value[role].claimId : '',
      [['','Explicitly unresolved'], ...row.claims.filter(claim => claim.kind === kind).map(claim => [claim.id, claimText(row, claim)])],
      next => set(role, next ? {mode:'source', claimId:next} : {mode:'unresolved'})));
    const measureChoice = (field, title, kind) => label(title, selectValue(value[field] ?? '',
      [['','No selected original ' + (kind === 'geometry' ? 'geometry' : 'area')], ...row.claims.filter(claim => claim.kind === kind)
        .map(claim => [claim.id, claimText(row, claim)])], next => set(field, next || null)));
    const county = row.records.filter(record => record.family === 'county-assessment-json');
    const form = panel('Review parcel ' + key,
      changed && note('The saved decision changed after this form was opened. Your draft is retained; reopen current facts before submitting it.'),
      actions(button('Reopen current source and saved decision', async () => { delete p.reviewDrafts[draftKey]; save(); await render(); }),
        button('Close parcel detail', async () => { update('key', ''); await render(); })),
      e('div', {class:'fields'},
        claimChoice('owner', 'Selected owner assertion', 'owner-assertion'),
        label('Accountable entity', selectValue(value.accountable.mode === 'entity' ? value.accountable.entityId : '',
          [['','Explicitly unassigned'], ...entities.map(entity => [entity.entityId, entity.label + ' · ' + entity.kind])],
          next => set('accountable', next ? {mode:'entity', entityId:next, entityVersion:data.activeEntities[next]} : {mode:'unassigned'})),
          'A named staff assignment. The source tax-agent and owner-type fields remain separate observations.'),
        claimChoice('status', 'Selected status assertion', 'status-assertion'),
        claimChoice('ward', 'Selected ward assertion', 'ward-assertion'),
        label('Original County assessment record', selectValue(value.assessmentRecordId ?? '',
          [['','No selected assessment record'], ...county.map(record => [record.id,
            record.sourceId + ' · ' + row.claims.filter(claim => claim.kind === 'assessment' && claim.recordId === record.id)
              .map(claim => (TITLES[claim.basis] || claim.basis) + ': ' + claim.value + ' · ' + (claim.taxYear || 'year absent')).join(' / ')])],
          next => set('assessmentRecordId', next || null))),
        measureChoice('areaClaimId', 'Selected reported area', 'area'),
        measureChoice('geometryClaimId', 'Selected original polygon', 'geometry')),
      label('Reason for this staff decision', textArea(value.reason, next => set('reason', next), {rows:3})),
      label('Additional retained evidence references, optional JSON array',
        textArea(value.evidenceText ?? json(value.evidence), next => { value.evidenceText = next; save(); }, {rows:3}),
        'Each entry: editionId, fileSha256 and optional note. The referenced file must already belong to this project.'),
      button('Preview this parcel decision', async () => {
        requireValue(!changed, 'Reopen the current source and saved decision.');
        const decision = clone(value);
        if (decision.evidenceText !== undefined) decision.evidence = JSON.parse(decision.evidenceText);
        delete decision.evidenceText;
        p.batch = {editionId, decisions:[decision]}; p.batchText = json(p.batch); delete p.batchPreview; save();
        await run('review.preview', p.batch);
      }, {disabled:changed}),
      current && detail('Current saved decision and lineage', current),
      detail('Source assertions and measurement bases', row.claims),
      detail('Lookup coverage and source issues', {coverage:row.coverage, issues:row.issues}, !!row.issues.length));
    const records = panel('Original records for ' + key,
      note('The original record preserves its full provider fields and source file. County owner type and the geometry tax agent do not become a named responsible entity.'),
      table([['Source', record => record.sourceId], ['Family / original record ID', record => [record.family, note(record.recordId)]],
        ['Address', record => record.address || '—'],
        ['Original record', record => button('Read original record', async () => {
          const original = await request('/api/parcels/source-record?' + new URLSearchParams({editionId,key,recordId:record.id}));
          p.originalRecord = {editionId,key,recordId:record.id,value:original}; save(); await render();
        })],
        ['Complete source bytes', record => actions(...record.references.map(ref =>
          link('File · row ' + ref.row, '/download/parcels/editions/' + editionId + '/files/' + ref.fileSha256)))]], row.records));
    const opened = p.originalRecord?.editionId === editionId && p.originalRecord?.key === key ? p.originalRecord.value : null;
    if (opened) records.append(detail('Original provider record', opened, true),
      button('Download selected source-record projection', () => jsonDownload(key + '-original-record.json', opened)));
    return e('div', {}, form, records);
  }

  function batchPreparation() {
    p.rules ||= {uniqueAssertions:false, sourcePreferences:{}, accountableEntityId:null,
      uniqueAssessment:false, areaBasis:null, uniqueGeometry:false, replaceReviewed:false, reason:''};
    const rules = p.rules;
    rules.sourcePreferences ||= {};
    const flag = (field, title) => label(title, inputValue(!!rules[field], value => mutate(rules, field, value),
      {type:'checkbox', checked:!!rules[field]}));
    const ids = [...new Set(edition.inputs.filter(row => row.family !== 'source-metadata').map(row => row.sourceId))];
    const choice = (role, title) => label(title, selectValue(rules.sourcePreferences[role] || '',
      [['','Any sole source assertion'], ...ids], value => {
        if (value) rules.sourcePreferences[role] = value; else delete rules.sourcePreferences[role]; save();
      }));
    return panel('Prepare a staff review batch',
      note('Preparation applies only the rules selected below. Multiple eligible assertions remain unresolved. Existing saved reviews are skipped unless you explicitly choose to replace them. Review the resulting named choices before saving.'),
      e('div', {class:'fields'}, flag('uniqueAssertions', 'Use a sole eligible owner, status and ward assertion'),
        choice('owner','Preferred owner source, optional'), choice('status','Preferred status source, optional'),
        choice('ward','Preferred ward source, optional'),
        label('Assign accountable entity', selectValue(rules.accountableEntityId || '',
          [['','Keep current choice; new parcels remain unassigned'], ...entities.map(row => [row.entityId,row.label])],
          value => mutate(rules, 'accountableEntityId', value || null))),
        flag('uniqueAssessment','Select the sole original County assessment record'),
        label('Select a sole area claim in this basis', selectValue(rules.areaBasis || '',
          [['','Keep current area choice'], ...data.areaBases.map(row => [row.id,TITLES[row.id]])],
          value => mutate(rules,'areaBasis',value || null))),
        flag('uniqueGeometry','Select the sole original polygon'),
        flag('replaceReviewed','Prepare replacements for already reviewed parcels')),
      label('Reason for these preparation rules', textArea(rules.reason, value => mutate(rules,'reason',value), {rows:3})),
      button('Prepare selected keys for review', () => run('review.prepare', {
        editionId, keys:clone(requireValue(p.selectedKeys?.length && p.selectedKeys, 'Select the original parcels in the table.')),
        rules:clone(rules)})),
      p.batchPreparation && detail('Retained preparation and unresolved fields', {
        rules:p.batchPreparation.rules, selectedForReview:p.batchPreparation.decisions.length,
        preservedReviewed:p.batchPreparation.preservedReviewed, unresolved:p.batchPreparation.unresolved}));
  }

  function parsedBatch() {
    const batch = JSON.parse(p.batchText || json(p.batch || {editionId,decisions:[]}));
    requireValue(batch && batch.editionId === editionId && Array.isArray(batch.decisions) &&
      batch.decisions.length > 0 && batch.decisions.length <= 1000, 'Use a review batch for this exact edition with 1–1,000 decisions.');
    return batch;
  }

  function batchReview() {
    let batch = null;
    try { batch = parsedBatch(); } catch {}
    const preview = batch && p.batchPreview && same(batch, p.batchPreview.payload) ? p.batchPreview.result : null;
    const picker = e('input', {type:'file', accept:'.json,application/json', onchange:async event => {
      try {
        const file = event.target.files[0]; if (!file) return;
        requireValue(file.size <= 32 * 1024 * 1024, 'Select a review JSON file of at most 32 MiB.');
        const input = JSON.parse(await file.text());
        const value = Array.isArray(input) ? {editionId,decisions:input} : input;
        requireValue(value?.editionId === editionId && Array.isArray(value.decisions), 'Select a batch for this exact parcel edition.');
        p.batch = value; p.batchText = json(value); delete p.batchPreview; save(); await render();
      } catch (error) { ctx.notice(error.message,true); }
    }});
    return panel('Review and save exact staff decisions',
      label('Open a prepared or edited batch JSON file', picker),
      label('Decision batch', textArea(p.batchText || json(p.batch || {editionId,decisions:[]}), value => {
        p.batchText = value; delete p.batchPreview; save();
      }, {rows:8}), 'Each decision retains the original parcel key, facts digest and previous decision digest. The original server validates every selected claim and entity version.'),
      actions(button('Preview complete decision batch', () => run('review.preview', parsedBatch())),
        button('Download current review worksheet', () => jsonDownload('parcel-review-' + editionId.slice(0,12) + '.json', parsedBatch()), {disabled:!batch})),
      preview && panel('Exact decision preview',
        detail('Batch summary', preview.summary, true),
        table([['Parcel', row => row.key], ['Owner assertion', row => row.owner.claim?.value || 'Unresolved'],
          ['Accountable entity', row => row.accountable.entity?.label || 'Unassigned'],
          ['Status / ward', row => [row.status.claim?.value || 'Unresolved', note(row.ward.claim?.value || 'Unresolved')]],
          ['Assessment record', row => row.assessmentRecordId ? compact(row.assessmentRecordId) : 'Unresolved'],
          ['Area / geometry', row => [(row.area ? row.area.value + ' ' + row.area.unit + ' · ' + (TITLES[row.area.basis] || row.area.basis) : 'No selected area'),
            note(row.geometry ? 'Original polygon selected' : 'No selected polygon')]],
          ['Reason', row => row.reason]], preview.decisions),
        button('Save this reviewed decision batch', () => {
          requireValue(p.batchPreview && same(parsedBatch(),p.batchPreview.payload),
            'Preview the changed decision batch before saving.');
          return run('review.save', {...clone(p.batchPreview.payload),previewSha256:preview.previewSha256});
        }),
        detail('Complete normalized review and evidence', preview)),
      p.lastReview && detail('Last retained review', p.lastReview));
  }

  async function responsibility() {
    const value = p.entity ||= {entityId:'',label:'',kind:'department',parentEntityId:null,note:'',expectedVersion:null};
    const set = (field, next) => mutate(value, field, next);
    return [panel('Named accountable entities',
      note('Create the responsible department, authority or organization from an explicit staff assignment. Source owner names, owner types, service zones and tax agents remain separately retained.'),
      table([['Entity', row => button(row.label, async () => {
        p.entity = {entityId:row.entityId,label:row.label,kind:row.kind,parentEntityId:row.parentEntityId || null,
          note:row.note,expectedVersion:row.id}; save(); await render();
      })], ['Stable entity ID', row => row.entityId], ['Type', row => row.kind],
        ['Parent', row => row.parentEntityId || '—'], ['Version', row => compact(row.id)],
        ['Named by', row => row.actor], ['Assignment context', row => row.note]], entities),
      actions(button('Create another entity', async () => {
        p.entity = {entityId:'',label:'',kind:'department',parentEntityId:null,note:'',expectedVersion:null}; save(); await render();
      })),
      e('div', {class:'fields'},
        label('Stable entity ID', inputValue(value.entityId, next => set('entityId',next), {readOnly:!!value.expectedVersion})),
        label('Name shown in reviews and portfolios', inputValue(value.label,next => set('label',next))),
        label('Entity type', selectValue(value.kind,['government','authority','department','organization','other'],next => set('kind',next))),
        label('Parent entity, optional', selectValue(value.parentEntityId || '',
          [['','No parent'],...entities.filter(row => row.entityId !== value.entityId).map(row => [row.entityId,row.label])],
          next => set('parentEntityId',next || null)))),
      label('Assignment context and reason', textArea(value.note,next => set('note',next),{rows:4})),
      button('Save entity version', () => run('entity.save',{definition:clone(value)})),
      note('A changed entity creates a new retained version. Earlier parcel decisions keep the exact entity version reviewed at that time.')),
      panel('Entity version history',
        table([['Entity',row => row.label],['ID / version',row => [row.entityId,note(compact(row.id))]],
          ['Recorded',row => row.at],['Analyst',row => row.actor],['Original definition',row => detail('Read version',row)]],
          [...data.entities].reverse()))];
  }

  function portfolioDefinition() {
    const form = p.portfolio ||= {title:'',scope:'filters',keysText:'',query:'',ward:'',issue:'',
      assessmentBasis:'county-assessed',areaBasis:'county-reported-square-feet',
      groupBy:['accountable','ward'],note:'',requireCompleteReview:false};
    const scope = form.scope === 'keys'
      ? {keys:[...new Set(form.keysText.split(/[\s,;]+/).filter(Boolean))]}
      : {filters:{query:form.query || '',ward:form.ward || '',issue:form.issue || ''}};
    return {editionId,title:form.title,selection:scope,assessmentBasis:form.assessmentBasis,
      areaBasis:form.areaBasis,groupBy:clone(form.groupBy),note:form.note,requireCompleteReview:!!form.requireCompleteReview};
  }

  function portfolioGroups(groups) {
    return table([['Group / original period',row => detail(Object.entries(row.group).filter(([key]) =>
      !['accountableEntityVersion','assessmentBasis','areaBasis','areaUnit','currency'].includes(key)).map(([key,value]) =>
        key + ': ' + clean(value)).join(' · '),row.group)],
      ['Parcels / reviewed',row => row.parcels + ' / ' + row.reviewed],
      ['Assessment total',row => [clean(row.assessmentTotal),note(row.assessmentCount + ' measured parcels')]],
      ['Area total',row => [clean(row.areaTotal) + ' ' + row.group.areaUnit,note(row.areaCount + ' measured parcels')]],
      ['Paired assessment / acre',row => row.ratio ? [row.ratio.assessmentPerAcreDisplay,note(row.pairedCount + ' parcels with both measures'),
        detail('Exact numerator, denominator and rounding',row.ratio)] : 'No paired measure'],
      ['Polygons',row => String(row.geometryCount)]], groups);
  }

  async function portfolios() {
    if (!edition) return [noEdition()];
    const definition = portfolioDefinition(), form = p.portfolio;
    const set = (field,next) => { form[field] = next; save(); };
    const preview = p.portfolioPreview && same(definition,p.portfolioPreview.payload.definition) ? p.portfolioPreview.result : null;
    const items = [panel('Build an assessment and area portfolio',
      note('Select one explicit assessment basis and one area basis. Groups retain their tax year and as-of date. The per-acre measure pairs amounts and areas from the same parcels. Missing source values remain missing.'),
      e('div',{class:'fields'},
        label('Portfolio title',inputValue(form.title,next => set('title',next))),
        label('Assessment basis',selectValue(form.assessmentBasis,data.assessmentBases.map(row => [row.id,TITLES[row.id]]),next => set('assessmentBasis',next))),
        label('Area basis',selectValue(form.areaBasis,data.areaBases.map(row => [row.id,TITLES[row.id]]),next => set('areaBasis',next))),
        label('Parcel selection',selectValue(form.scope,[['filters','Exact source filters'],['keys','Explicit original parcel keys']],async next => { set('scope',next); await render(); }))),
      form.scope === 'keys'
        ? label('Original parcel keys',textArea(form.keysText,next => set('keysText',next),{rows:5}),'Separate exact 16-character original keys with whitespace, commas or semicolons.')
        : e('div',{class:'fields'},
            label('Source search',inputValue(form.query,next => set('query',next))),
            label('Original ward value',inputValue(form.ward,next => set('ward',next))),
            label('Source issue code, optional',inputValue(form.issue,next => set('issue',next)))),
      actions(button('Use selected parcel keys',async () => {
        requireValue(p.selectedKeys?.length,'Select parcels in the Parcels table first.');
        form.scope = 'keys'; form.keysText = p.selectedKeys.join('\n'); save(); await render();
      }),button('Use current parcel source filters',async () => {
        form.scope = 'filters'; Object.assign(form,{query:p.filters?.query || '',ward:p.filters?.ward || '',issue:p.filters?.issue || ''}); save(); await render();
      })),
      e('div',{class:'fields'},...['owner','accountable','status','ward'].map(group =>
        label('Group by ' + group,inputValue(form.groupBy.includes(group),next => {
          form.groupBy = next ? [...new Set([...form.groupBy,group])] : form.groupBy.filter(value => value !== group); save();
        },{type:'checkbox',checked:form.groupBy.includes(group)}))),
        label('Require every selected parcel to have a saved review',inputValue(!!form.requireCompleteReview,
          next => set('requireCompleteReview',next),{type:'checkbox',checked:!!form.requireCompleteReview}))),
      label('Portfolio scope and interpretation',textArea(form.note,next => set('note',next),{rows:4})),
      note('The 2012 base-year appraisal and historical sale prices are separate source facts. Selecting an assessed amount does not turn it into a current market valuation.'),
      button('Preview complete portfolio',() => run('portfolio.preview',{definition:portfolioDefinition()})),
      preview && panel('Frozen portfolio preview',detail('Scope and coverage',preview.summary,true),
        portfolioGroups(preview.groups),
        button('Save this exact portfolio',() => {
          requireValue(p.portfolioPreview && same(portfolioDefinition(),p.portfolioPreview.payload.definition),
            'Preview the changed portfolio selection and bases before saving.');
          return run('portfolio.create',{definition:clone(p.portfolioPreview.payload.definition),
            previewSha256:preview.previewSha256});
        }),
        detail('Original selection and preview identity',preview)))];
    items.push(panel('Saved portfolios',
      table([['Portfolio',row => button(row.title,async () => { p.portfolioId = row.id; save(); await render(); })],
        ['Edition',row => data.editions.find(value => value.id === row.editionId)?.label || compact(row.editionId)],
        ['Basis',row => TITLES[row.definition.assessmentBasis]],['Parcels',row => String(row.summary.parcels)],
        ['Reviewed',row => String(row.summary.reviewed)],['Saved',row => row.createdAt],['Analyst',row => row.actor]],data.portfolios)));
    if (p.portfolioId && data.portfolios.some(row => row.id === p.portfolioId)) {
      const saved = await request('/api/parcels/portfolio?' + new URLSearchParams({portfolioId:p.portfolioId}));
      items.push(panel('Saved portfolio: ' + saved.portfolio.title,
        detail('Frozen scope and original decisions',saved.portfolio,true),
        portfolioGroups(saved.groups),
        actions(...['portfolio.json','parcels.csv','groups.json'].map(name =>
          link('Download ' + name,'/download/parcels/portfolios/' + saved.portfolio.id + '/' + name))),
        note('The JSON carries the exact reviewed source and decision identities. CSV cells preserve original text and quote spreadsheet formula prefixes; amount and area columns remain exact decimal text.'),
        button('Publish reviewed polygons to the layer draft',() => run('map.publish',{portfolioId:saved.portfolio.id})),
        note('The map source retains the selected original polygons and this frozen portfolio. Continue in Layers to inspect and save the real QGIS layer, then save or render the map in Maps. Export the complete project in Transfers to carry every raw source and review file.'),
        detail('First 25 saved parcel rows',saved.examples)));
    }
    return items;
  }

  async function laterEdition() {
    if (!edition) return [noEdition()];
    p.successor ||= {leftEditionId:editionId,rightEditionId:'',unchanged:'leave-unreviewed',note:''};
    const value = p.successor, changed = (key,next) => { value[key] = next; save(); };
    const comparison = p.comparison?.leftEditionId === value.leftEditionId && p.comparison?.rightEditionId === value.rightEditionId ? p.comparison : null;
    return [panel('Review a later parcel source edition',
      note('Import the later original files through Sources first. Compare exact parcel identities and semantic source facts, then explicitly carry unchanged reviewed decisions or leave them for review. Changed parcels require a new decision; removed parcels remain in history.'),
      e('div',{class:'fields'},
        label('Prior edition',selectValue(value.leftEditionId,editionChoices,next => changed('leftEditionId',next))),
        label('Later edition',selectValue(value.rightEditionId,[['','Choose a later edition'],...editionChoices],next => changed('rightEditionId',next)))),
      button('Compare both complete parcel editions',() => run('successor.compare',{
        leftEditionId:requireValue(value.leftEditionId,'Choose the prior edition.'),
        rightEditionId:requireValue(value.rightEditionId,'Choose the later edition.')})),
      comparison && panel('Original key and source comparison',
        table([['Outcome',row => row[0]],['Parcels',row => String(row[1].length)],
          ['Exact keys',row => detail('Read complete key list',row[1])]],
          ['added','removed','changed','unchanged'].map(name => [name,comparison[name]])),
        label('Unchanged reviewed decisions',selectValue(value.unchanged,[
          ['leave-unreviewed','Leave for explicit review'],['carry-reviewed','Carry exact unchanged reviewed decisions']],
          next => changed('unchanged',next))),
        label('Reason for this edition decision',textArea(value.note,next => changed('note',next),{rows:4})),
        button('Save successor review and select later edition',() => {
          requireValue(comparison.leftEditionId === value.leftEditionId && comparison.rightEditionId === value.rightEditionId,
            'Compare the newly selected source editions before saving.');
          return run('successor.review',{definition:{leftEditionId:value.leftEditionId,rightEditionId:value.rightEditionId,
            comparisonSha256:comparison.comparisonSha256,unchanged:value.unchanged,
            changed:'leave-unreviewed',removed:'retain-history',note:value.note}});
        }),
        note('Existing decisions already saved on the later edition are retained. Earlier portfolios and native maps remain tied to their exact earlier source and review.'))),
      panel('Retained successor decisions',table([['Recorded',row => row.at],['Analyst',row => row.actor],
        ['Prior / later',row => [compact(row.leftEditionId),note(compact(row.rightEditionId))]],
        ['Carried reviews',row => String(row.carriedReviews)],['Source changes',row => detail('Original successor decision',row)]],data.successors))];
  }
}
