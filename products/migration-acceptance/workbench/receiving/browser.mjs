// SPDX-License-Identifier: MIT
// Browser continuation of receiving/receive.mjs. The caller owns both hosts
// and the original native programme; this module never launches a native database.
import { existsSync, readFileSync, lstatSync, realpathSync, openSync, closeSync,
  readSync, fsyncSync, renameSync, mkdirSync, accessSync, constants } from 'node:fs';
import { resolve, join, dirname, basename, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { acquireWorkspaceLease, privateDirectory } from '../vendor/dlt/vendor/sling/vendor/stellar-expert/store.mjs';
import { atomicBytes, atomicJson, canonical, requireValue, safeRelative, now } from '../vendor/dlt/vendor/sling/core/common.mjs';

const SCHEMA = 'definian.browser-receiving.v1';
const PANES = { overview:'Overview', sources:'Sources', plans:'Migration plans',
  runs:'Native runs', comparisons:'Comparison', acceptance:'Business acceptance', cutover:'Cutover & consumers',
  delivery:'Delivery & history' };
const sha = body => createHash('sha256').update(body).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const same = (a, b) => canonical(a) === canonical(b);
const css = value => JSON.stringify(String(value));
const pick = (rows, id) => {
  const value = rows.find(row => row.id === id);
  requireValue(value, 'BROWSER_SELECTION', 'The selected original entity is absent.', 409, { id });
  return value;
};
function regular(path) {
  const info = lstatSync(path);
  requireValue(info.isFile() && !info.isSymbolicLink() && realpathSync(path) === path,
    'BROWSER_FILE', 'Select an ordinary file in the retained operation.', 409);
  return info;
}
function digestFile(path) {
  const before = regular(path), hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  const fd = openSync(path, 'r');
  try { for (;;) { const n = readSync(fd, buffer, 0, buffer.length, null); if (!n) break; hash.update(buffer.subarray(0, n)); } }
  finally { closeSync(fd); }
  const after = regular(path);
  requireValue(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'BROWSER_FILE_CHANGED', 'The selected file changed while its complete bytes were read.', 409);
  return { bytes:after.size, sha256:hash.digest('hex') };
}
function verify(path, descriptor) {
  const actual = digestFile(path);
  requireValue(actual.bytes === descriptor.bytes && actual.sha256 === descriptor.sha256,
    'BROWSER_ARTIFACT_CHANGED', 'The retained complete browser artifact differs.', 409,
    { file:basename(path) });
  return actual;
}
function sync(path) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function validateIds(values, label) {
  requireValue(Array.isArray(values) && values.length > 0 && new Set(values).size === values.length &&
    values.every(value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)),
    'BROWSER_ARGUMENT', label + ' must contain the original unique stable IDs.');
  return [...values];
}
function expectedRows(options,streamId){
  if(!options.expectedRowsByStream)return options.expectedRows;
  requireValue(Object.hasOwn(options.expectedRowsByStream,streamId),'BROWSER_NATIVE_STREAM','The native stream must belong to the complete original population selection.',409,{streamId});
  return options.expectedRowsByStream[streamId];
}
function completeStreams(options,streams){
  if(options.expectedRowsByStream)requireValue(same(streams.map(x=>x.streamId).sort(),Object.keys(options.expectedRowsByStream).sort()),
    'BROWSER_NATIVE_COVERAGE','The complete original stream set differs from the selected programme.',409);
}
function publicError(error) {
  return { code:error.code || 'BROWSER_RECEIVING_FAILED', message:String(error.message || error) };
}
async function jsonGet(origin, token, path) {
  const response = await fetch(new URL(path, origin), {
    headers:{ Authorization:'Bearer ' + token }, redirect:'error', cache:'no-store',
    signal:AbortSignal.timeout(30000)
  });
  const value = await response.json();
  requireValue(response.ok, value.error?.code || 'BROWSER_READ_FAILED',
    value.error?.message || 'The original installation could not be read.', response.status);
  return value;
}

class Journey {
  constructor(options, directory, lease, selection, info) {
    this.o = options; this.root = directory; this.operationRoot = dirname(dirname(directory));
    this.lease = lease; this.selection = selection; this.info = info;
    this.statePath = join(directory, 'browser-operation.json');
    this.context = null; this.page = null; this.routes = new Set(); this.routeErrors = [];
    if (existsSync(this.statePath)) {
      this.data = read(this.statePath);
      requireValue(this.data.schema === SCHEMA && same(this.data.selection, selection),
        'BROWSER_SELECTION_CHANGED', 'Continue the same browser, source, actor and project selection.', 409);
      requireValue(options.resume || this.data.status === 'complete' || this.data.finalCandidate,
        'BROWSER_RESUME_REQUIRED', 'Use the original programme with --resume.', 409);
    } else {
      this.data = { schema:SCHEMA, id:'definian_browser_' + randomUUID(), selection,
        status:'prepared', createdAt:now(), steps:{}, roles:{}, files:{}, candidates:{},
        pageErrors:[], rejectedNavigation:[], currentStep:null };
      this.save();
    }
  }
  save() { this.lease.assert(); atomicJson(this.statePath, this.data); }
  rel(path) {
    const value = relative(this.operationRoot, path).split('\\').join('/');
    safeRelative(value); return value;
  }
  local(value) {
    safeRelative(value); const selected = resolve(this.operationRoot, value);
    requireValue(selected.startsWith(this.root + '/'), 'BROWSER_ARTIFACT_PATH',
      'Browser artifacts must remain in this original phase directory.', 409);
    return selected;
  }
  async step(name, work) {
    this.data.currentStep = name; this.save();
    const old = this.data.steps[name];
    if (old?.state === 'complete') return old.result;
    if (!old) this.data.steps[name] = { state:'running', startedAt:now() };
    else { old.state = 'running'; old.continuedAt = now(); }
    this.save();
    const result = await work();
    this.data.steps[name] = { ...this.data.steps[name], state:'complete', completedAt:now(), result };
    this.save(); return result;
  }
  async inspect(page = this.page) {
    return page.evaluate(() => window.dltOperator?.inspect() || null);
  }
  async ready(actor, { revision, historical = false } = {}) {
    await this.page.waitForFunction(({ actorId, projectId, instanceId, revision, historical }) => {
      const value = window.dltOperator?.inspect();
      const title = document.querySelector('#page-subtitle')?.textContent || '';
      return value && value.actorId === actorId && value.instanceId === instanceId &&
        value.projectId === projectId && value.storageReady && !value.storageError &&
        !value.busy && value.historical === historical &&
        (revision === null || value.revision === revision) &&
        title.includes('revision ' + value.revision) &&
        (historical ? title.includes('retained historical edition') : !title.includes('retained historical edition'));
    }, { actorId:actor.id, projectId:this.o.projectId, instanceId:this.info.instanceId,
      revision:revision ?? null, historical }, { timeout:45000 });
    return this.inspect();
  }
  async open(actor, revision) {
    const page = this.page;
    await page.waitForFunction(() => !!window.dltOperator, null, { timeout:45000 });
    const initial = await this.inspect();
    if (!initial?.actorId) {
      await page.locator('#token').fill(actor.token);
      await page.locator('#login-form').evaluate(form => form.requestSubmit());
      await page.waitForFunction(id => window.dltOperator?.inspect()?.actorId === id,
        actor.id, { timeout:45000 });
    }
    const observed = await this.inspect();
    requireValue(observed.actorId === actor.id, 'BROWSER_ACTOR',
      'The browser profile belongs to a different actual actor.', 409);
    if (observed.projectId !== this.o.projectId) {
      await page.locator('#project-select').selectOption(this.o.projectId);
    }
    await page.waitForFunction(({ actorId, projectId, instanceId }) => {
      const x = window.dltOperator?.inspect();
      return x?.actorId === actorId && x.projectId === projectId && x.instanceId === instanceId &&
        x.storageReady && !x.storageError && !x.busy;
    }, { actorId:actor.id, projectId:this.o.projectId, instanceId:this.info.instanceId }, { timeout:45000 });
    if (revision === undefined) {
      // Even an already-current view must actually refresh before its revision is selected.
      const response = page.waitForResponse(r => r.request().method() === 'GET' &&
        new URL(r.url()).pathname === '/api/projects/' + this.o.projectId &&
        !new URL(r.url()).searchParams.has('revision'), { timeout:45000 });
      await page.locator('#current').click(); await response;
      return this.ready(actor);
    }
    const response = page.waitForResponse(r => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/projects/' + this.o.projectId &&
      new URL(r.url()).searchParams.get('revision') === String(revision), { timeout:45000 });
    await page.locator('#revision').fill(String(revision));
    await page.locator('#revision').dispatchEvent('change');
    await response;
    return this.ready(actor, { revision, historical:true });
  }
  async pane(name) {
    requireValue(Object.hasOwn(PANES, name), 'BROWSER_PANE', 'Select a documented operator pane.');
    if (await this.page.locator('#detail-dialog').evaluate(e => e.open)) await this.page.locator('#detail-close').click();
    if (await this.page.locator('#form-dialog').evaluate(e => e.open)) await this.page.locator('#form-close').click();
    await this.page.locator('[data-pane=' + css(name) + ']').click();
    await this.page.waitForFunction(({ name, title }) =>
      document.querySelector('[data-pane="' + name + '"]')?.getAttribute('aria-current') === 'page' &&
      document.querySelector('#page-title')?.textContent === title, { name, title:PANES[name] });
  }
  async recordFromStore(key) {
    return this.page.evaluate(key => new Promise((yes, no) => {
      const request = indexedDB.open('definian-migration-requests-v1', 1);
      request.onerror = () => no(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('records', 'readonly');
        let value = null; const get = tx.objectStore('records').get(key);
        get.onsuccess = () => value = get.result?.value || null;
        tx.oncomplete = () => { db.close(); yes(value); };
        tx.onerror = () => { db.close(); no(tx.error); };
      };
    }), key);
  }
  async restoreOriginalPending(wire) {
    const selected = await this.inspect();
    requireValue(selected.storageReady && selected.scope === wire.pending.scope &&
      selected.actorId === this.o.operator.id && selected.instanceId === this.info.instanceId,
      'BROWSER_PENDING_SCOPE', 'Open the exact original actor and installation before request recovery.', 409);
    // Use the application's original persisted record and CAS contract. No new
    // operation ID, body, revision or transport-only substitution is introduced.
    await this.page.evaluate(p => new Promise((yes, no) => {
      const request = indexedDB.open('definian-migration-requests-v1', 1);
      request.onerror = () => no(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('records', 'readwrite');
        const store = tx.objectStore('records'), key = 'pending:' + p.scope;
        let error = null; const get = store.get(key);
        get.onsuccess = () => {
          const old = get.result?.value;
          if (old && (old.requestId !== p.requestId || old.bodyText !== p.bodyText || old.scope !== p.scope)) {
            error = new Error('Another unresolved original browser request occupies this scope.'); tx.abort(); return;
          }
          if (!old) store.put({ key, value:p });
        };
        tx.oncomplete = () => { db.close(); yes(); };
        tx.onabort = () => { db.close(); no(error || tx.error); };
        tx.onerror = () => { db.close(); no(error || tx.error); };
      };
    }), wire.pending);
    await this.page.reload({ waitUntil:'domcontentloaded' });
    await this.open(this.o.operator);
  }
  async handleMutation(route, role) {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue();
    const bodyText = request.postData() || '';
    if (role === 'viewer' && this.data.viewerProbe &&
      path === this.data.viewerProbe.path && bodyText === this.data.viewerProbe.bodyText) {
      return route.continue();
    }
    requireValue(role === 'operator' && this.o.phase === 'primary' &&
      path === '/api/projects/' + this.o.projectId + '/actions',
      'BROWSER_UNEXPECTED_MUTATION', 'The browser must not start another native or business action.', 409);
    const body = JSON.parse(bodyText);
    if(body.action==='acceptance.decide')return this.handleAcceptanceMutation(route,body,bodyText,path);
    const note = this.data.note;
    requireValue(note && body.action === 'project.update' && body.projectId === this.o.projectId &&
      body.expectedRevision === note.revision && same(body.payload, note.payload),
      'BROWSER_REQUEST_CHANGED', 'The UI prepared a different original review action.', 409);
    const state = await this.inspect(), pending = await this.recordFromStore('pending:' + state.scope);
    requireValue(pending && pending.bodyText === bodyText && pending.requestId === body.requestId &&
      pending.expectedRevision === body.expectedRevision && pending.scope === state.scope,
      'BROWSER_PENDING_UNSAVED', 'The UI must retain the complete original request before dispatch.', 409);
    if (this.data.wire) {
      requireValue(this.data.wire.bodyText === bodyText && this.data.wire.path === path &&
        this.data.wire.pending.requestId === pending.requestId && this.data.wire.pending.scope === pending.scope,
        'BROWSER_REPLAY_CHANGED', 'Retry must use the saved original UI request.', 409);
    } else {
      this.data.wire = { path, bodyText, bodySha256:sha(bodyText), pending,
        observedAt:now(), attempts:[] };
      this.save();
    }
    const wire = this.data.wire, attempt = { startedAt:now(), state:'sending' };
    wire.attempts.push(attempt); this.save();
    let response;
    try {
      response = await route.fetch({ timeout:30000, maxRedirects:0 });
      const text = await response.text(), value = JSON.parse(text);
      attempt.status = response.status(); attempt.bodySha256 = sha(text);
      requireValue(response.ok() && value.view?.id === this.o.projectId &&
        value.view.revision === note.revision + 1 && value.view.notes === note.payload.notes &&
        value.view.title === note.payload.title && Number.isSafeInteger(value.currentRevision),
        value.error?.code || 'BROWSER_COMMIT_RESPONSE',
        value.error?.message || 'The original UI mutation has another committed result.', 409);
      if (wire.response) requireValue(same(wire.response.result, value.result) &&
        wire.response.view.revision === value.view.revision,
        'BROWSER_REPLAY_RESULT', 'An original request replay changed its committed identity.', 409);
      wire.response = value; attempt.state = 'received'; attempt.completedAt = now(); this.save();
      if (!wire.acknowledgementSuppressed) {
        wire.acknowledgementSuppressed = true; this.save();
        await route.abort('failed'); return;
      }
      await route.fulfill({ response }); attempt.deliveredAt = now(); this.save();
    } finally { if (response) await response.dispose(); }
  }

  async handleAcceptanceMutation(route, body, bodyText, path) {
    const review=this.data.acceptanceReview;
    requireValue(review && body.action==='acceptance.decide' && body.projectId===this.o.projectId &&
      body.expectedRevision===review.revision && same(body.payload,review.payload),
      'BROWSER_ACCEPTANCE_REQUEST','Continue the exact selected finding and decision request.',409);
    const state=await this.inspect(),pending=await this.recordFromStore('pending:'+state.scope);
    requireValue(pending && pending.bodyText===bodyText && pending.requestId===body.requestId &&
      pending.expectedRevision===body.expectedRevision && pending.scope===state.scope,
      'BROWSER_PENDING_UNSAVED','Retain the complete acceptance decision before dispatch.',409);
    if(this.data.acceptanceWire) requireValue(this.data.acceptanceWire.bodyText===bodyText &&
      this.data.acceptanceWire.path===path && this.data.acceptanceWire.pending.scope===pending.scope,
      'BROWSER_REPLAY_CHANGED','Replay the original saved acceptance request.',409);
    else {this.data.acceptanceWire={path,bodyText,bodySha256:sha(bodyText),pending,observedAt:now(),attempts:[]};this.save();}
    const wire=this.data.acceptanceWire,attempt={startedAt:now(),state:'sending'};
    wire.attempts.push(attempt);this.save();let response;
    try {
      response=await route.fetch({timeout:30000,maxRedirects:0});
      const text=await response.text(),value=JSON.parse(text);
      attempt.status=response.status();attempt.bodySha256=sha(text);
      const selected=value.view?.acceptanceDecisions?.find(x=>x.id===value.view.currentAcceptanceDecisionId);
      const decision=selected?.decisions.find(x=>x.findingId===review.payload.decisions[0].findingId);
      requireValue(response.ok() && value.view?.id===this.o.projectId && value.view.revision===review.revision+1 &&
        selected?.reportId===review.payload.reportId && decision?.disposition===review.payload.decisions[0].disposition &&
        decision?.reason===review.payload.decisions[0].reason && decision?.actorId===this.o.operator.id &&
        Number.isSafeInteger(value.currentRevision),
        value.error?.code||'BROWSER_ACCEPTANCE_COMMIT',
        value.error?.message||'The exact finding, reason and authenticated operator must be retained.',409);
      if(wire.response) requireValue(same(wire.response.result,value.result) &&
        wire.response.view.revision===value.view.revision,'BROWSER_REPLAY_RESULT','Decision replay changed its committed identity.',409);
      wire.response=value;attempt.state='received';attempt.completedAt=now();this.save();
      if(!wire.acknowledgementSuppressed){wire.acknowledgementSuppressed=true;this.save();await route.abort('failed');return;}
      await route.fulfill({response});attempt.deliveredAt=now();this.save();
    } finally {if(response)await response.dispose();}
  }
  async acceptanceReview() {
    if(!this.o.acceptanceReview)return null;
    return this.step('original-acceptance-decision',async()=>{
      const view=await this.view(),current=await this.inspect(),wanted=this.o.acceptanceReview;
      if(!this.data.acceptanceReview){
        requireValue(!current.pending&&current.storageReady,'BROWSER_ORIGINAL_PENDING','Resolve the original pending request first.',409);
        const report=pick(view.acceptanceReports,wanted.reportId),finding=report.findings.find(x=>x.findingId===wanted.findingId);
        requireValue(report.id===view.currentAcceptanceReportId&&finding&&finding.acceptance==='reviewable',
          'BROWSER_CURRENT_FINDING','Select an actual current reviewable finding in the original measured edition.',409);
        this.data.acceptanceReview={revision:view.revision,measured:report,
          decisionIds:view.acceptanceDecisions.map(x=>x.id),
          payload:{reportId:report.id,decisions:[{findingId:finding.findingId,disposition:wanted.disposition,reason:wanted.reason}]},createdAt:now()};
        this.save();
      }
      if(!this.data.acceptanceWire){
        await this.pane('acceptance');
        await this.page.locator('[data-action="quality.report"][data-id='+css(wanted.reportId)+']').click();
        await this.page.locator('#detail-dialog').waitFor({state:'visible'});
        const key=JSON.stringify({reportId:wanted.reportId,findingId:wanted.findingId,offset:0});
        await this.page.locator('[data-action="quality.review"][data-id='+css(key)+']').click();
        await this.page.locator('#form-fields [name="disposition"]').selectOption(wanted.disposition);
        await this.page.locator('#form-fields [name="reason"]').fill(wanted.reason);
        await this.page.locator('#operation-form').evaluate(form=>form.requestSubmit());
        await this.page.waitForFunction(()=>{const x=window.definianOperator?.inspect();return x?.pending&&!x.busy;},null,{timeout:45000});
      }
      requireValue(this.data.acceptanceWire,'BROWSER_REQUEST_UNOBSERVED','The original decision request was not observed.',409);
      await Promise.all([...this.routes]);const wire=this.data.acceptanceWire;
      const original=await this.recordFromStore('pending:'+wire.pending.scope),last=await this.recordFromStore('last:'+wire.pending.scope);
      if(!original&&last?.requestId===wire.pending.requestId){
        requireValue(last.bodyText===wire.bodyText&&last.response?.view?.revision===this.data.acceptanceReview.revision+1,
          'BROWSER_REPLAY_RESULT','The saved decision receipt differs from the original request.',409);
        wire.response=last.response;this.save();
      }else{
        if(!original)await this.restoreOriginalPending(wire);
        else{
          requireValue(original.requestId===wire.pending.requestId&&original.bodyText===wire.bodyText,
            'BROWSER_ORIGINAL_PENDING','Another pending request occupies this scope.',409);
          await this.page.reload({waitUntil:'domcontentloaded'});await this.open(this.o.operator);
        }
        await this.page.locator('[data-action="retry-pending"]').click();
        await this.page.waitForFunction(id=>{const x=window.definianOperator?.inspect();return x&&!x.busy&&x.storageReady&&!x.pending&&x.projectId===id;},this.o.projectId,{timeout:45000});
      }
      await Promise.all([...this.routes]);await this.open(this.o.operator);
      const after=await this.view(),events=after.history.filter(x=>x.data?.requestId===wire.pending.requestId);
      const report=pick(after.acceptanceReports,wanted.reportId);
      const edition=pick(after.acceptanceDecisions,after.currentAcceptanceDecisionId);
      requireValue(wire.response&&wire.acknowledgementSuppressed&&events.length===1&&
        events[0].revision===this.data.acceptanceReview.revision+1&&same(report,this.data.acceptanceReview.measured)&&
        !this.data.acceptanceReview.decisionIds.includes(edition.id)&&
        after.acceptanceDecisions.length===this.data.acceptanceReview.decisionIds.length+1,
        'BROWSER_ACCEPTANCE_REPLAY','The decision must commit once while retaining the measured report and earlier decisions.',409);
      return {reportId:report.id,semanticReportId:report.reportId,findingId:wanted.findingId,decisionId:edition.id,
        requestId:wire.pending.requestId,bodySha256:wire.bodySha256,committedRevision:events[0].revision,
        eventId:events[0].id,attempts:wire.attempts.length,originalAcknowledgementSuppressed:true,
        sameRequestReconciled:true,measuredReportUnchanged:true};
    });
  }
  async acceptanceDetails(view,viewer=false) {
    const result={plans:[],reports:[],decisions:[]};
    await this.pane('acceptance');
    const close=async()=>{if(await this.page.locator('#detail-dialog').evaluate(x=>x.open))await this.page.locator('#detail-close').click();};
    const readonly=async()=>{if(viewer)requireValue(await this.page.locator('#detail-dialog [data-write]').evaluateAll(ns=>ns.every(n=>n.disabled)),
      'BROWSER_VIEWER_WRITE','Acceptance detail actions must respect viewer authority.',409);};
    for(const id of this.o.acceptancePlanIds){
      const plan=pick(view.acceptancePlans,id);
      await this.page.locator('[data-action="quality.plan"][data-id='+css(id)+']').click();
      await this.page.locator('#detail-dialog').waitFor({state:'visible'});
      const full=JSON.parse(await this.page.locator('#detail-content pre').innerText());
      requireValue(full.planId===plan.acceptancePlanId&&full.pipelinePlanId===plan.semanticPlanId,
        'BROWSER_ACCEPTANCE_PLAN','The full rule edition differs from its original pipeline.',409);
      await readonly();await close();result.plans.push({id,sha256:plan.compiled.sha256,objects:full.objects.length,relationships:full.relationships.length,controls:full.controls.length});
    }
    for(const id of this.o.acceptanceReportIds){
      const report=pick(view.acceptanceReports,id);
      await this.page.locator('[data-action="quality.report"][data-id='+css(id)+']').click();
      await this.page.locator('#detail-dialog').waitFor({state:'visible'});
      requireValue(await this.page.locator('#detail-content [data-report-id='+css(id)+']').count()===1,
        'BROWSER_ACCEPTANCE_REPORT','The operator must display the selected complete measured edition.',409);
      const shown=await this.page.locator('#detail-content [data-action="quality.evidence"]').evaluateAll(ns=>ns.map(n=>JSON.parse(n.dataset.id).findingId).sort());
      requireValue(same(shown,report.findings.map(f=>f.findingId).sort()),'BROWSER_ACCEPTANCE_FINDINGS','Display every retained measured finding.',409);
      await readonly();await close();
      for(const finding of report.findings){
        await this.page.locator('[data-action="quality.report"][data-id='+css(id)+']').click();
        await this.page.locator('#detail-dialog').waitFor({state:'visible'});
        const key=JSON.stringify({reportId:id,findingId:finding.findingId,offset:0});
        await this.page.locator('[data-action="quality.evidence"][data-id='+css(key)+']').click();
        let count=0;
        for(let offset=0;offset<Math.max(1,finding.rows.length);offset+=50){
          const shownRows=await this.page.locator('#detail-content tbody tr pre').allTextContents();
          const parsed=shownRows.map(x=>JSON.parse(x));
          requireValue(same(parsed,finding.rows.slice(offset,offset+50)),
            'BROWSER_ACCEPTANCE_EVIDENCE','Read every full original row reference in order.',409);
          count+=parsed.length;
          if(offset+50<finding.rows.length)await this.page.locator('#detail-content [data-action="quality.evidence"]').filter({hasText:'Next rows'}).click();
        }
        requireValue(count===finding.rows.length,'BROWSER_ACCEPTANCE_EVIDENCE','The complete evidence population must be retained.',409);
        await close();
      }
      for(const action of ['quality.controls','quality.relationships']){
        await this.page.locator('[data-action="'+action+'"][data-id='+css(id)+']').click();
        await this.page.locator('#detail-dialog').waitFor({state:'visible'});await readonly();await close();
      }
      result.reports.push({id,sha256:report.report.sha256,findings:report.findings.length,
        rowReferences:report.findings.reduce((n,f)=>n+f.rows.length,0),measuredReady:report.readyForCutover});
    }
    const decisionIds=[...new Set([...this.o.acceptanceDecisionIds,
      ...(this.data.steps['original-acceptance-decision']?.result?[this.data.steps['original-acceptance-decision'].result.decisionId]:[])])];
    for(const id of decisionIds){
      const edition=pick(view.acceptanceDecisions,id);
      await this.page.locator('[data-action="quality.decision"][data-id='+css(id)+']').click();
      await this.page.locator('#detail-dialog').waitFor({state:'visible'});
      const full=JSON.parse(await this.page.locator('#detail-content pre').innerText());
      requireValue(full.decisionId===edition.decisionId&&same(full.decisions,edition.decisions),
        'BROWSER_ACCEPTANCE_DECISIONS','The complete retained decision edition differs.',409);
      await readonly();await close();result.decisions.push({id,reportId:edition.reportId,sha256:edition.decision.sha256,ready:edition.readyForCutover});
    }
    if(!viewer){
      const selections=[
        ...this.o.acceptancePlanIds.map(id=>({kind:'plan',id,sourceId:pick(view.acceptancePlans,id).compiledSourceId})),
        ...this.o.acceptanceReportIds.map(id=>({kind:'report',id,sourceId:pick(view.acceptanceReports,id).sourceId})),
        ...decisionIds.map(id=>({kind:'decision',id,sourceId:pick(view.acceptanceDecisions,id).sourceId}))
      ];
      for(const selected of selections){
        const source=pick(view.sources,selected.sourceId);
        await this.download('acceptance-'+selected.kind+'-'+selected.id,{...source,originalId:selected.id,
          requestPath:'/api/projects/'+this.o.projectId+'/sources/'+source.id},
          ()=>this.page.locator('[data-action="quality.'+selected.kind+'.download"][data-id='+css(selected.id)+']').click());
      }
    }
    return result;
  }

  async begin(role) {
    const actor = this.o[role], previous = this.data.roles[role]; this.activeRole = role;
    if (previous?.state === 'complete' && previous.closedAt) return false;
    this.data.roles[role] = { ...previous, state:'running', openedAt:previous?.openedAt || now(),
      attempts:(previous?.attempts || 0) + 1 };
    this.save();
    const module = await import(pathToFileURL(this.selection.playwright.path).href);
    const chromium = module.chromium || module.default?.chromium;
    requireValue(chromium, 'BROWSER_RUNTIME', 'The selected original Playwright module lacks Chromium.');
    const temp = join(this.root, 'temporary'); mkdirSync(temp, { recursive:true, mode:0o700 });
    this.context = await chromium.launchPersistentContext(join(this.root, 'profiles', role), {
      executablePath:this.selection.chromium.path, headless:true, acceptDownloads:true,
      viewport:{ width:1440, height:1000 }, locale:'en-GB', timezoneId:'UTC',
      args:['--no-sandbox'], env:{ ...process.env, TMPDIR:temp }
    });
    this.context.setDefaultTimeout(45000);
    const pages = this.context.pages(); this.page = pages[0] || await this.context.newPage();
    for (const page of pages.slice(1)) await page.close();
    this.page.on('pageerror', error => {
      this.data.pageErrors.push({ role, step:this.data.currentStep, at:now(), message:error.message });
      try { this.save(); } catch (saveError) { this.routeErrors.push(publicError(saveError)); }
    });
    await this.context.route('**/api/**', route => {
      const task = this.handleMutation(route, role).catch(async error => {
        this.routeErrors.push(publicError(error));
        try { await route.abort('failed'); } catch {}
      });
      this.routes.add(task); task.finally(() => this.routes.delete(task)); return task;
    });
    await this.page.goto(this.o.origin, { waitUntil:'domcontentloaded' });
    await this.open(actor);
    return true;
  }
  async end(role, complete) {
    let routeFailure = null;
    try { await Promise.all([...this.routes]); }
    catch (error) { routeFailure = error; }
    const context = this.context;
    if (context) {
      // The same original browser is the only fallback owner. A failed close
      // must retain these handles and the phase lease until closure succeeds.
      let browser = null;
      try { browser = context.browser(); } catch {}
      const closing = this.data.roles[role]?.closing || {
        startedAt:now(), attempts:0, state:'closing', errors:[]
      };
      for (;;) {
        closing.attempts += 1; closing.lastAttemptAt = now(); closing.state = 'closing';
        this.data.roles[role] = { ...this.data.roles[role], state:'closing', closing };
        let storageError = null;
        try { this.save(); } catch (error) { storageError = publicError(error); }
        let closedBy = null, contextError = null, browserError = null;
        try { await context.close(); closedBy = 'context.close'; }
        catch (error) { contextError = publicError(error); }
        if (!closedBy && browser) {
          try { await browser.close(); closedBy = 'browser.close'; }
          catch (error) { browserError = publicError(error); }
        }
        if (contextError && !closing.errors.some(error => same(error, contextError)))
          closing.errors.push(contextError);
        if (browserError && !closing.errors.some(error => same(error, browserError)))
          closing.errors.push(browserError);
        if (closedBy) {
          const closedAt = now();
          closing.state = 'closed'; closing.closedBy = closedBy; closing.closedAt = closedAt;
          this.context = null; this.page = null;
          this.data.roles[role] = { ...this.data.roles[role],
            state:complete && !routeFailure && this.routeErrors.length === 0 ? 'complete' : 'interrupted',
            closedAt, closing };
          this.save();
          break;
        }
        closing.state = 'unconfirmed';
        closing.lastFailureAt = now();
        try { this.save(); } catch (error) { storageError = publicError(error); }
        // Keep the original owner and lock alive. Neither transport loss nor a
        // failed journal write is a positive observation of browser closure.
        try {
          process.stderr.write(JSON.stringify({ schema:SCHEMA, event:'browser-close-pending',
            phase:this.o.phase, role, attempts:closing.attempts,
            contextError, browserError, storageError }) + '\n');
        } catch {}
        await new Promise(resolveWait => setTimeout(resolveWait, 5000));
      }
    }
    if (routeFailure) throw routeFailure;
    requireValue(this.routeErrors.length === 0, 'BROWSER_REQUEST_ROUTE',
      'An original browser request could not be reconciled.', 409, { errors:this.routeErrors });
  }
  async view(actor = this.o.operator, revision) {
    const envelope = await jsonGet(this.o.origin, actor.token, '/api/projects/' +
      this.o.projectId + (revision === undefined ? '' : '?revision=' + revision));
    requireValue(envelope.view?.id === this.o.projectId && Number.isSafeInteger(envelope.currentRevision),
      'BROWSER_PROJECT', 'The original project response is incomplete.');
    return envelope.view;
  }
  async noteReview() {
    if (this.o.phase !== 'primary') return null;
    return this.step('original-review-request', async () => {
      const view = await this.view(), current = await this.inspect();
      if (!this.data.note) {
        requireValue(!current.pending && current.storageReady, 'BROWSER_ORIGINAL_PENDING',
          'Resolve the original pending request before preparing the review note.', 409);
        const paragraph = 'Operator receiving review: inspected the retained source, selected migration plans, ' +
          'all selected native files and complete typed comparisons. The observed final population is ' +
          this.o.expectedRows + ' rows. Source manifest ' + this.o.sourceManifestSha256 +
          '. This is reference engineering evidence; customer acceptance remains separately attributed.';
        this.data.note = { revision:view.revision, payload:{ title:view.title,
          notes:view.notes + (view.notes ? '\n\n' : '') + paragraph }, createdAt:now() };
        this.save();
      }
      if (!this.data.wire) {
        await this.pane('overview');
        await this.page.locator('[data-action="project.edit"]').click();
        await this.page.locator('#form-fields [name="title"]').fill(this.data.note.payload.title);
        await this.page.locator('#form-fields [name="notes"]').fill(this.data.note.payload.notes);
        await this.page.locator('#operation-form').evaluate(form => form.requestSubmit());
        await this.page.waitForFunction(() => {
          const x = window.dltOperator?.inspect();
          return x?.pending && !x.busy;
        }, null, { timeout:45000 });
      }
      requireValue(this.data.wire, 'BROWSER_REQUEST_UNOBSERVED',
        'The original UI request was not observed before the browser stopped.', 409);
      await Promise.all([...this.routes]);
      const wire = this.data.wire;
      const original = await this.recordFromStore('pending:' + wire.pending.scope);
      const last = await this.recordFromStore('last:' + wire.pending.scope);
      if (!original && last?.requestId === wire.pending.requestId) {
        requireValue(last.bodyText === wire.bodyText && last.response?.view?.id === this.o.projectId &&
          last.response.view.revision === this.data.note.revision + 1,
          'BROWSER_REPLAY_RESULT', 'The saved final UI receipt differs from the original request.', 409);
        wire.response = last.response; this.save();
      } else {
        if (!original) await this.restoreOriginalPending(wire);
        else {
          requireValue(original.requestId === wire.pending.requestId && original.bodyText === wire.bodyText,
            'BROWSER_ORIGINAL_PENDING', 'Another pending request occupies the original scope.', 409);
          await this.page.reload({ waitUntil:'domcontentloaded' }); await this.open(this.o.operator);
        }
        await this.page.locator('[data-action="retry-pending"]').click();
        await this.page.waitForFunction(id => {
          const x = window.dltOperator?.inspect();
          return x && !x.busy && x.storageReady && !x.pending && x.projectId === id;
        }, this.o.projectId, { timeout:45000 });
      }
      await Promise.all([...this.routes]); await this.open(this.o.operator);
      const after = await this.view(), events = after.history.filter(event =>
        event.data?.requestId === wire.pending.requestId);
      requireValue(wire.response && wire.acknowledgementSuppressed && events.length === 1 &&
        after.notes === this.data.note.payload.notes && events[0].revision === this.data.note.revision + 1,
        'BROWSER_REQUEST_REPLAY', 'The original review must commit exactly once across reload and replay.', 409);
      return { requestId:wire.pending.requestId, bodySha256:wire.bodySha256,
        committedRevision:events[0].revision, currentRevision:after.revision,
        eventId:events[0].id, attempts:wire.attempts.length, originalAcknowledgementSuppressed:true,
        sameRequestReconciled:true };
    });
  }
  candidatePath(key) { return join(this.root, 'candidates', key + '.body'); }
  artifactPath(key, extension) { return join(this.root, 'artifacts', key + extension); }
  commitArtifact(key) {
    const candidate = this.data.candidates[key];
    requireValue(candidate?.complete && candidate.path && candidate.staging,
      'BROWSER_CANDIDATE', 'The exact original artifact candidate is not complete.', 409);
    const target = this.local(candidate.path), stage = this.local(candidate.staging);
    if (existsSync(target)) verify(target, candidate);
    else {
      if (candidate.bodyBase64) {
        const body = Buffer.from(candidate.bodyBase64, 'base64');
        requireValue(body.length === candidate.bytes && sha(body) === candidate.sha256,
          'BROWSER_CANDIDATE_CHANGED', 'The saved original screenshot candidate changed.', 409);
        atomicBytes(stage, body, { immutable:true });
      }
      verify(stage, candidate);
      mkdirSync(dirname(target), { recursive:true, mode:0o700 });
      renameSync(stage, target); sync(dirname(target));
      verify(target, candidate);
    }
    const result = { path:candidate.path, bytes:candidate.bytes, sha256:candidate.sha256,
      kind:candidate.kind, ...candidate.metadata };
    this.data.files[key] = result; delete candidate.bodyBase64; this.save(); return result;
  }
  async screenshot(key) {
    if (this.data.files[key]) { verify(this.local(this.data.files[key].path), this.data.files[key]); return this.data.files[key]; }
    if (this.data.candidates[key]?.complete) return this.commitArtifact(key);
    const dimensions = await this.page.evaluate(() => ({
      viewportWidth:innerWidth, viewportHeight:innerHeight,
      scrollWidth:document.documentElement.scrollWidth,
      scrollHeight:document.documentElement.scrollHeight
    }));
    requireValue(dimensions.scrollWidth <= dimensions.viewportWidth + 2,
      'BROWSER_LAYOUT_OVERFLOW', 'The operator page overflows its selected desktop or mobile width.', 409,
      dimensions);
    const bytes = await this.page.screenshot({ fullPage:true, animations:'disabled' });
    const candidate = { kind:'screenshot', path:this.rel(this.artifactPath(key, '.png')),
      staging:this.rel(this.candidatePath(key)), complete:true, bytes:bytes.length,
      sha256:sha(bytes), metadata:{ ...dimensions }, bodyBase64:bytes.toString('base64') };
    // Persist the exact candidate bytes before publication; an existing candidate
    // is consumed before another screenshot can be captured.
    this.data.candidates[key] = candidate; this.save();
    return this.commitArtifact(key);
  }
  async download(key, expected, trigger) {
    requireValue(Number.isSafeInteger(expected.bytes) && expected.bytes > 0 &&
      /^[a-f0-9]{64}$/.test(expected.sha256) && typeof expected.requestPath === 'string' &&
      expected.requestPath.startsWith('/api/projects/' + this.o.projectId + '/'),
      'BROWSER_DOWNLOAD_SELECTION',
      'Select the original complete file, rendered API route, SHA and length before download.', 409);
    const extension = expected.filename?.endsWith('.ndjson.gz') ? '.ndjson.gz' :
      expected.filename?.endsWith('.ndjson') ? '.ndjson' :
      expected.filename?.endsWith('.json') ? '.json' : expected.filename?.endsWith('.csv') ? '.csv' : '.bin';
    const base = { kind:'download', path:this.rel(this.artifactPath(key, extension)),
      staging:this.rel(this.candidatePath(key)), bytes:expected.bytes, sha256:expected.sha256,
      complete:false, metadata:{ filename:expected.filename || key,
        originalId:expected.originalId || key, requestPath:expected.requestPath } };
    const existing = this.data.candidates[key];
    if (existing) {
      const { transferAttempts, ...bound } = existing;
      requireValue(same({ ...bound, complete:false }, base), 'BROWSER_DOWNLOAD_CHANGED',
        'The original file download selection changed.', 409);
    } else { this.data.candidates[key] = base; this.save(); }
    if (this.data.files[key]) {
      requireValue(this.data.files[key].requestPath === expected.requestPath,
        'BROWSER_DOWNLOAD_ROUTE', 'The retained file came from another selected API route.', 409);
      verify(this.local(this.data.files[key].path), this.data.files[key]); return this.data.files[key];
    }
    if (this.data.candidates[key].complete) return this.commitArtifact(key);
    const stage = this.local(base.staging);
    let complete = false;
    if (existsSync(stage)) {
      const observed = digestFile(stage);
      complete = observed.bytes === base.bytes && observed.sha256 === base.sha256;
      if (!complete) {
        // The prior owner ended before a browser-owned transfer finished. Keep
        // its partial identity and repeat only this immutable read, using the
        // original expected bytes; no business operation is dispatched.
        this.data.candidates[key].transferAttempts ??= [];
        this.data.candidates[key].transferAttempts.push({ at:now(), state:'partial', ...observed });
        this.save();
      }
    }
    if (!complete) {
      const waiting = this.page.waitForEvent('download', { timeout:180000 });
      const responseWaiting = this.page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && url.origin === this.o.origin &&
          url.pathname + url.search === expected.requestPath;
      }, { timeout:180000 });
      await trigger();
      const [download, response] = await Promise.all([waiting, responseWaiting]);
      const headers = await response.allHeaders();
      requireValue(response.ok() && headers['x-content-sha256'] === expected.sha256 &&
        Number(headers['content-length']) === expected.bytes,
        'BROWSER_DOWNLOAD_RESPONSE', 'The original response route, length or SHA differs.', 409);
      const error = await download.failure();
      requireValue(!error, 'BROWSER_DOWNLOAD_FAILED', error || 'The full UI download did not complete.', 409);
      if (expected.filename) requireValue(download.suggestedFilename() === expected.filename,
        'BROWSER_DOWNLOAD_NAME', 'The UI changed the original download filename.', 409);
      mkdirSync(dirname(stage), { recursive:true, mode:0o700 });
      await download.saveAs(stage); sync(stage); sync(dirname(stage)); verify(stage, base);
    }
    this.data.candidates[key].complete = true; this.save(); return this.commitArtifact(key);
  }
  async inspectEntities(view) {
    const result = { sources:[], plans:[], nativeJobs:[], comparisons:[], handoffs:[] };
    await this.pane('sources');
    for (const id of this.o.sourceIds) {
      const source = pick(view.sources, id);
      await this.page.locator('[data-action="source.inspect"][data-id=' + css(id) + ']').click();
      await this.page.locator('#detail-dialog').waitFor({ state:'visible' });
      requireValue((await this.page.locator('#detail-content').innerText()).includes(source.sha256),
        'BROWSER_SOURCE_DETAIL', 'The original source identity is not visible in its inspection.');
      await this.page.locator('#detail-close').click();
      result.sources.push({ id, bytes:source.bytes, sha256:source.sha256 });
    }
    await this.pane('plans');
    for (const id of this.o.planIds) {
      const plan = pick(view.plans, id);
      await this.page.locator('[data-action="plan.inspect"][data-id=' + css(id) + ']').click();
      await this.page.locator('#detail-dialog').waitFor({ state:'visible' });
      const full = JSON.parse(await this.page.locator('#detail-content pre').innerText());
      requireValue(JSON.stringify(full).includes(plan.semanticPlanId),
        'BROWSER_PLAN_DETAIL', 'The complete retained plan has a different semantic identity.');
      await this.page.locator('#detail-close').click();
      result.plans.push({ id, semanticPlanId:plan.semanticPlanId, status:plan.status,
        sourceSha256:plan.compiled.sha256 });
    }
    await this.pane('runs');
    for (const id of this.o.jobIds) {
      const job = pick(view.jobs, id);
      requireValue(job.status === 'complete' && job.files.length > 0 &&
        job.nativeState?.result && typeof job.nativeState.result === 'object',
        'BROWSER_NATIVE_RESULT', 'Inspect only the original completed native operations.', 409);
      await this.page.locator('[data-action="job.inspect"][data-id=' + css(id) + ']').click();
      await this.page.locator('#detail-dialog').waitFor({ state:'visible' });
      const shown = JSON.parse(await this.page.locator('#detail-content pre').innerText());
      requireValue(shown.id === id && same(shown.files, job.files),
        'BROWSER_NATIVE_DETAIL', 'The complete native operation differs from its selected view.');
      await this.page.locator('#detail-close').click();
      await this.page.locator('[data-action="job.files"][data-id=' + css(id) + ']').click();
      await this.page.locator('#detail-dialog').waitFor({ state:'visible' });
      const paths = await this.page.locator('#detail-content [data-native-path]')
        .evaluateAll(elements => elements.map(element => element.dataset.nativePath).sort());
      requireValue(same(paths, job.files.map(file => file.path).sort()),
        'BROWSER_NATIVE_FILE_LIST', 'The UI must expose every original native file exactly once.');
      await this.page.locator('#detail-close').click();
      result.nativeJobs.push({ id, stage:job.stage, fileCount:paths.length,
        result:job.nativeState.result });
    }
    await this.pane('comparisons');
    for (const id of this.o.comparisonIds) {
      const comparison = pick(view.comparisons, id);
      await this.page.locator('[data-action="comparison.inspect"][data-id=' + css(id) + ']').click();
      await this.page.locator('#detail-dialog').waitFor({ state:'visible' });
      const report = JSON.parse(await this.page.locator('#detail-content pre').innerText());
      requireValue(report.equal === true && report.readyForCutover === true && report.nativeReport.streams?.length > 0,
        'BROWSER_FULL_COMPARISON', 'The actual complete comparison is not ready.');
      if (id === this.o.comparisonIds.at(-1)) completeStreams(this.o,report.nativeReport.streams);
      if (id === this.o.comparisonIds.at(-1)) for (const stream of report.nativeReport.streams) {
        const count = side => side.observedRows;
        requireValue(count(stream.left) === expectedRows(this.o,stream.streamId) && count(stream.right) === expectedRows(this.o,stream.streamId),
          'BROWSER_NATIVE_POPULATION', 'The current full comparison has another actual row population.', 409);
      }
      await this.page.locator('#detail-close').click();
      result.comparisons.push({ id, sha256:comparison.report.sha256, bytes:comparison.report.bytes,
        readyForCutover:report.readyForCutover, streamCount:report.nativeReport.streams.length });
    }
    await this.pane('delivery');
    for (const id of this.o.handoffIds) {
      const intent = pick(view.handoffs, id), sealed = view.handoffCustody?.[id];
      requireValue(sealed && sealed.sha256 && sealed.bytes > 0,
        'BROWSER_NAMED_HANDOFF', 'The original named whole package must be sealed.', 409);
      requireValue(await this.page.locator('[data-action="handoff.download"][data-id=' + css(id) + ']').isEnabled(),
        'BROWSER_HANDOFF_CONTROL', 'The actual sealed original package has no usable download control.');
      result.handoffs.push({ id, revision:intent.revision, bytes:sealed.bytes, sha256:sealed.sha256 });
    }
    return result;
  }
  async retainedDownloads(view) {
    const source = this.o.sourceIds.map(id => pick(view.sources, id))
      .find(row => /\.csv$/i.test(row.filename)) || pick(view.sources, this.o.sourceIds[0]);
    await this.pane('sources');
    await this.download('source-original', { ...source, originalId:source.id,
      requestPath:'/api/projects/' + this.o.projectId + '/sources/' + source.id },
      () => this.page.locator('[data-action="source.download"][data-id=' + css(source.id) + ']').click());
    const comparison = pick(view.comparisons, this.o.comparisonIds.at(-1));
    await this.pane('comparisons');
    await this.download('complete-typed-observations', { ...comparison.observations,
      filename:comparison.id + '-observations.json', originalId:comparison.id,
      requestPath:'/api/projects/' + this.o.projectId + '/outputs/observations/' + comparison.id },
      () => this.page.locator('[data-action="observations.download"][data-id=' + css(comparison.id) + ']').click());
    const file = this.data.files['complete-typed-observations'];
    const observations = read(this.local(file.path));
    requireValue(observations.streams?.length > 0, 'BROWSER_TYPED_OUTPUT', 'Retain the complete typed data.');
    completeStreams(this.o,observations.streams);
    for (const stream of observations.streams) for (const side of ['left', 'right']) {
      requireValue(stream[side]?.source?.complete === true &&
        stream[side].source.rowCount === expectedRows(this.o,stream.streamId) &&
        stream[side].rows.length === expectedRows(this.o,stream.streamId),
        'BROWSER_TYPED_POPULATION', 'The downloaded data must contain every original source and target row.', 409);
    }
    await this.download('complete-comparison', { ...comparison.report,
      filename:comparison.id + '.json', originalId:comparison.id,
      requestPath:'/api/projects/' + this.o.projectId + '/outputs/comparison/' + comparison.id },
      () => this.page.locator('[data-action="comparison.download"][data-id=' + css(comparison.id) + ']').click());
    const job = pick(view.jobs, this.o.jobIds.at(-1));
    const nativeFile = job.files.find(row => /(^|\/)result\.json$/.test(row.path)) ||
      job.files.find(row => /\.json$/.test(row.path) && row.bytes > 0 && row.bytes <= 2097152);
    requireValue(nativeFile, 'BROWSER_NATIVE_FILE', 'The original completed job needs its actual result or receipt.');
    await this.pane('runs');
    await this.page.locator('[data-action="job.files"][data-id=' + css(job.id) + ']').click();
    await this.page.locator('#detail-dialog').waitFor({ state:'visible' });
    await this.download('native-original-result', { ...nativeFile,
      filename:basename(nativeFile.path), originalId:job.id,
      requestPath:'/api/projects/' + this.o.projectId + '/native/' + job.id + '?path=' + encodeURIComponent(nativeFile.path) },
      () => this.page.locator('[data-native-job=' + css(job.id) + '][data-native-path=' + css(nativeFile.path) + ']').click());
    await this.page.locator('#detail-close').click();
    if (this.o.phase === 'primary') {
      const id = this.o.handoffIds[0], sealed = view.handoffCustody[id];
      await this.pane('delivery');
      await this.download('H1-complete-original-package', { ...sealed, originalId:id,
        requestPath:'/api/projects/' + this.o.projectId + '/outputs/handoff/' + id },
        () => this.page.locator('[data-action="handoff.download"][data-id=' + css(id) + ']').click());
    }
    return { sourceId:source.id, comparisonId:comparison.id, nativeJobId:job.id,
      fullPackageDownloaded:this.o.phase === 'primary', rows:this.o.expectedRows };
  }

  async consumerTables(view){
    const selected=view.cutovers.find(x=>x.id===view.currentCutoverId);
    if(!selected)return{state:'unbound',tables:[]};
    const result={selectionId:selected.selection.id,tables:[]};
    await this.pane('cutover');
    await this.page.locator('[data-action="consumer.query"][data-id=""]').click();
    await this.page.locator('#detail-dialog [data-consumer-stream]').waitFor({state:'visible'});
    const source=(await this.page.locator('#detail-content pre').allTextContents()).at(-1);
    const initial=JSON.parse(source);
    requireValue(initial.selection.snapshot.sha256===selected.selection.snapshot.sha256,
      'BROWSER_CONSUMER_SELECTION','The full retained consumer binding must match its project selection.',409);
    const comparison=pick(view.comparisons,initial.binding.comparisonId);
    const complete=await this.download('consumer-selected-complete-observations',{...comparison.observations,
      filename:comparison.id+'-observations.json',originalId:comparison.id,
      requestPath:'/api/projects/'+this.o.projectId+'/outputs/observations/'+comparison.id},
      ()=>this.page.locator('#detail-content [data-action="observations.download"][data-id='+css(comparison.id)+']').click());
    const observations=read(this.local(complete.path));
    requireValue(same(observations.streams.map(s=>s.streamId).sort(),initial.binding.tables.map(t=>t.streamId).sort()),
      'BROWSER_CONSUMER_COVERAGE','The selected consumer must expose every business table in its exact retained native observation.',409);
    const format=v=>v.type==='null'?'NULL':typeof v.value==='object'?JSON.stringify(v.value,null,2):String(v.value);
    for(const table of initial.binding.tables){
      const stream=observations.streams.find(x=>x.streamId===table.streamId);
      requireValue(stream,'BROWSER_CONSUMER_STREAM','The selected consumer table must exist in the full native observations.',409);
      const rows=initial.binding.side==='expected'?stream.left.rows:stream.right.rows;
      const key=JSON.stringify({streamId:table.streamId,offset:0});
      if(await this.page.locator('#detail-content [data-consumer-stream]').getAttribute('data-consumer-stream')!==table.streamId){
        await this.page.locator('#detail-content [data-action="consumer.query"][data-id='+css(key)+']').click();
        await this.page.waitForFunction(id=>document.querySelector('#detail-content [data-consumer-stream]')?.dataset.consumerStream===id,table.streamId);
      }
      let retained=0;
      for(let offset=0;offset<Math.max(1,rows.length);offset+=100){
        await this.page.waitForFunction(n=>document.querySelector('#detail-content [data-consumer-offset]')?.dataset.consumerOffset===String(n),offset);
        const actual=await this.page.locator('#detail-content tbody tr').evaluateAll(nodes=>nodes.map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent)));
        const expected=rows.slice(offset,offset+100).map(row=>row.map(format));
        requireValue(same(actual,expected),'BROWSER_CONSUMER_ROWS','Every displayed consumer cell must match its complete retained native export.',409);
        retained+=actual.length;
        if(offset+100<rows.length)await this.page.locator('#detail-content [data-action="consumer.query"]').filter({hasText:'Next rows'}).click();
      }
      requireValue(retained===rows.length&&Number(await this.page.locator('#detail-content [data-consumer-total]').getAttribute('data-consumer-total'))===rows.length,
        'BROWSER_CONSUMER_POPULATION','Browse the full original population of every selected consumer table.',409);
      result.tables.push({streamId:table.streamId,rows:retained});
    }
    await this.page.locator('#detail-close').click();return result;
  }

  async historical(view) {
    const handoff = pick(view.handoffs, this.o.handoffIds[0]);
    requireValue(handoff.revision < view.revision, 'BROWSER_HISTORY',
      'The original programme must retain an earlier selected revision.', 409);
    await this.open(this.o.operator, handoff.revision);
    const older = await this.view(this.o.operator, handoff.revision);
    await this.pane('sources');
    const enabled = await this.page.locator('[data-write]').evaluateAll(nodes => nodes.filter(node => !node.disabled).length);
    requireValue(enabled === 0, 'BROWSER_HISTORICAL_WRITE', 'Historical project controls must remain read-only.');
    const source = older.sources.find(row => this.o.sourceIds.includes(row.id));
    requireValue(source, 'BROWSER_HISTORY_SOURCE', 'The historical original source must be retained.');
    await this.download('historical-original-source', { ...source, originalId:source.id,
      requestPath:'/api/projects/' + this.o.projectId + '/sources/' + source.id + '?revision=' + handoff.revision },
      () => this.page.locator('[data-action="source.download"][data-id=' + css(source.id) + ']').click());
    await this.open(this.o.operator);
    return { revision:handoff.revision, sourceId:source.id, sourceSha256:source.sha256,
      historicalMutationControlsDisabled:true };
  }
  async layouts() {
    const result = [];
    for (const width of [1440, 390]) {
      await this.page.setViewportSize({ width, height:1000 });
      for (const pane of Object.keys(PANES)) {
        await this.pane(pane);
        result.push(await this.screenshot('operator-' + width + '-' + pane));
      }
    }
    return result;
  }
  async operator() {
    if (!await this.begin('operator')) return;
    let complete = false;
    try {
      await this.noteReview();
      await this.acceptanceReview();
      const view = await this.view();
      await this.step('complete-business-acceptance',()=>this.acceptanceDetails(view));
      await this.step('all-selected-source-and-native-details', () => this.inspectEntities(view));
      await this.step('complete-original-downloads', () => this.retainedDownloads(view));
      await this.step('complete-consumer-tables',()=>this.consumerTables(view));
      await this.step('historical-review', () => this.historical(view));
      await this.step('desktop-and-mobile', () => this.layouts());
      requireValue(this.data.pageErrors.length === 0, 'BROWSER_PAGE_ERROR',
        'The actual operator emitted a browser script error.', 409, { errors:this.data.pageErrors });
      complete = true;
    } finally { await this.end('operator', complete); }
  }
  async viewer() {
    if (!await this.begin('viewer')) return;
    let complete = false;
    try {
      await this.step('viewer-read-only', async () => {
        const before = await this.view(this.o.viewer), panes = [];
        for (const name of Object.keys(PANES)) {
          await this.pane(name);
          const enabled = await this.page.locator('[data-write]').evaluateAll(nodes => nodes.filter(node => !node.disabled).length);
          requireValue(enabled === 0, 'BROWSER_VIEWER_WRITE', 'The viewer must have no enabled mutation control.', 409);
          panes.push(name);
        }
        await this.acceptanceDetails(before,true);
        if (!this.data.viewerProbe) {
          this.data.viewerProbe = { path:'/api/projects/' + this.o.projectId + '/actions',
            bodyText:JSON.stringify({ projectId:this.o.projectId, expectedRevision:before.revision,
              requestId:'viewer-denial-' + this.data.id, action:'project.update',
              payload:{ title:before.title, notes:before.notes } }) };
          this.save();
        }
        const probe = await this.page.evaluate(async ({ path, body, token }) => {
          const response = await fetch(path, { method:'POST',
            headers:{ Authorization:'Bearer ' + token, 'Content-Type':'application/json' }, body,
            credentials:'omit', redirect:'error' });
          return { status:response.status, value:await response.json() };
        }, { path:this.data.viewerProbe.path, body:this.data.viewerProbe.bodyText, token:this.o.viewer.token });
        requireValue(probe.status === 403 && probe.value.error?.code,
          'BROWSER_VIEWER_AUTHORITY', 'The actual server must reject the viewer mutation.', 409);
        const after = await this.view(this.o.viewer);
        requireValue(after.revision === before.revision && same(after.history, before.history),
          'BROWSER_VIEWER_HISTORY', 'A rejected viewer request must not alter original project history.', 409);
        return { actorId:this.o.viewer.id, panes, mutationStatus:403,
          code:probe.value.error.code, revision:after.revision, historyUnchanged:true };
      });
      requireValue(this.data.pageErrors.length === 0, 'BROWSER_PAGE_ERROR',
        'The actual viewer emitted a browser script error.', 409, { errors:this.data.pageErrors });
      complete = true;
    } finally { await this.end('viewer', complete); }
  }
  finish() {
    for (const file of Object.values(this.data.files)) verify(this.local(file.path), file);
    requireValue(['operator', 'viewer'].every(role => this.data.roles[role]?.state === 'complete' &&
      this.data.roles[role].closedAt), 'BROWSER_OWNER_OPEN',
      'Both original browser owners must close before publishing completion.', 409);
    if (!this.data.finalCandidate) {
      this.data.finalCandidate = { schema:SCHEMA, status:'complete', operationId:this.data.id,
        phase:this.o.phase, projectId:this.o.projectId, instanceId:this.info.instanceId,
        sourceManifestSha256:this.o.sourceManifestSha256, expectedRows:this.o.expectedRows,
        completedAt:now(), browserClosedAt:this.data.roles.viewer.closedAt,
        operatorId:this.o.operator.id, viewerId:this.o.viewer.id,
        selectedIds:{ sources:this.o.sourceIds, plans:this.o.planIds, jobs:this.o.jobIds,
          comparisons:this.o.comparisonIds, handoffs:this.o.handoffIds,
          acceptancePlans:this.o.acceptancePlanIds,acceptanceReports:this.o.acceptanceReportIds,acceptanceDecisions:this.o.acceptanceDecisionIds },
        expectedRowsByStream:this.o.expectedRowsByStream,
        acceptance:this.data.steps['complete-business-acceptance'].result,
        originalAcceptanceDecision:this.data.steps['original-acceptance-decision']?.result||null,
        originalReview:this.data.steps['original-review-request']?.result || null,
        details:this.data.steps['all-selected-source-and-native-details'].result,
        downloads:this.data.steps['complete-original-downloads'].result,
        historical:this.data.steps['historical-review'].result,
        consumerTables:this.data.steps['complete-consumer-tables'].result,
        viewer:this.data.steps['viewer-read-only'].result,
        pageErrors:[], files:Object.values(this.data.files),
        resultPath:this.rel(join(this.root, 'browser-result.json')) };
      this.save();
    }
    const result = this.data.finalCandidate;
    requireValue(result.operationId === this.data.id && result.sourceManifestSha256 === this.o.sourceManifestSha256 &&
      result.projectId === this.o.projectId && result.phase === this.o.phase,
      'BROWSER_RESULT_CHANGED', 'The original final browser candidate has another selection.', 409);
    for (const file of result.files) verify(this.local(file.path), file);
    atomicJson(join(this.root, 'browser-result.json'), result, { immutable:true });
    this.data.status = 'complete'; this.data.completedAt = result.completedAt; this.save();
    return result;
  }
}

export async function runBrowserJourney(options) {
  requireValue(options && ['primary', 'receiving'].includes(options.phase), 'BROWSER_ARGUMENT', 'Select the original browser phase.');
  for (const key of ['operator', 'viewer']) {
    requireValue(options[key] && typeof options[key].id === 'string' &&
      typeof options[key].name === 'string' && typeof options[key].token === 'string' &&
      options[key].token.length >= 24, 'BROWSER_AUTH', 'Supply the original private operator and viewer actors.');
  }
  requireValue(options.operator.id !== options.viewer.id, 'BROWSER_AUTH', 'Operator and viewer must be distinct original actors.');
  requireValue(/^[a-f0-9]{64}$/.test(options.sourceManifestSha256) &&
    Number.isSafeInteger(options.expectedRows) && options.expectedRows > 0 &&
    /^[A-Za-z0-9_.:-]{1,160}$/.test(options.projectId),
    'BROWSER_ARGUMENT', 'Bind the original complete source, project and observed native population.');
  for (const key of ['sourceIds', 'planIds', 'jobIds', 'comparisonIds', 'handoffIds'])
    options = { ...options, [key]:validateIds(options[key], key) };
  for(const key of ['acceptancePlanIds','acceptanceReportIds','acceptanceDecisionIds']){
    const values=options[key]??[];
    options={...options,[key]:values.length?validateIds(values,key):[]};
  }
  if(options.expectedRowsByStream!==undefined){
    const entries=Object.entries(options.expectedRowsByStream);
    requireValue(entries.length>0&&entries.every(([id,count])=>id.length>0&&id.length<=16384&&Number.isSafeInteger(count)&&count>=0)&&
      entries.reduce((n,[,count])=>n+count,0)===options.expectedRows,'BROWSER_ARGUMENT','Bind every exact stream population and their total.');
    options={...options,expectedRowsByStream:Object.fromEntries(entries.sort(([a],[b])=>a.localeCompare(b)))};
  }else options={...options,expectedRowsByStream:null};
  if(options.acceptanceReview){
    const r=options.acceptanceReview;
    requireValue(options.phase==='primary'&&typeof r.reportId==='string'&&typeof r.findingId==='string'&&
      r.disposition==='accepted_exception'&&typeof r.reason==='string'&&r.reason.trim().length>0&&
      options.acceptanceReportIds.includes(r.reportId),'BROWSER_ARGUMENT','Select one actual measured report finding for primary browser decision review.');
    options={...options,acceptanceReview:{reportId:r.reportId,findingId:r.findingId,disposition:r.disposition,reason:r.reason}};
  }else options={...options,acceptanceReview:null};
  const url = new URL(options.origin);
  requireValue(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
    !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'BROWSER_ORIGIN', 'Use the existing original private loopback installation.');
  options = { ...options, origin:url.origin };
  const directory = resolve(options.directory);
  requireValue(basename(directory) === options.phase && basename(dirname(directory)) === 'browser',
    'BROWSER_DIRECTORY', 'Use the original operation/browser/<phase> directory.');
  const playwright = resolve(options.playwright), chromium = resolve(options.chromium);
  accessSync(chromium, constants.X_OK);
  const info = await jsonGet(options.origin, options.operator.token, '/api/info');
  requireValue(info.actor?.id === options.operator.id && info.permissions?.operate === true &&
    typeof info.instanceId === 'string', 'BROWSER_INSTALLATION', 'The selected host must authenticate the actual operator.');
  const viewer = await jsonGet(options.origin, options.viewer.token, '/api/info');
  requireValue(viewer.instanceId === info.instanceId && viewer.actor?.id === options.viewer.id &&
    viewer.permissions?.read === true && viewer.permissions?.operate === false,
    'BROWSER_VIEWER', 'Select the read-only actor on this same original installation.');
  const selection = { phase:options.phase, origin:options.origin, instanceId:info.instanceId,
    projectId:options.projectId, sourceManifestSha256:options.sourceManifestSha256,
    receiver:{ ...digestFile(fileURLToPath(import.meta.url)) },
    expectedRows:options.expectedRows, operatorId:options.operator.id, viewerId:options.viewer.id,
    sourceIds:options.sourceIds, planIds:options.planIds, jobIds:options.jobIds,
    comparisonIds:options.comparisonIds, handoffIds:options.handoffIds,
    acceptancePlanIds:options.acceptancePlanIds,acceptanceReportIds:options.acceptanceReportIds,
    acceptanceDecisionIds:options.acceptanceDecisionIds,acceptanceReview:options.acceptanceReview,
    expectedRowsByStream:options.expectedRowsByStream,
    node:{ executable:process.execPath, version:process.version },
    playwright:{ path:playwright, ...digestFile(playwright) },
    chromium:{ path:chromium, ...digestFile(chromium) } };
  const selected = await privateDirectory(directory, { create:true });
  const lease = await acquireWorkspaceLease(join(selected, 'browser-receiving.lock'));
  let journey;
  try {
    journey = new Journey(options, selected, lease, selection, info);
    if (journey.data.finalCandidate) return journey.finish();
    await journey.operator(); await journey.viewer(); return journey.finish();
  } catch (error) {
    if (journey) { journey.data.status = 'interrupted'; journey.data.error = publicError(error); journey.save(); }
    throw error;
  } finally {
    try { if (journey?.context) await journey.end(journey.activeRole, false); }
    finally {
      // Failed closure retains the original handles and lease. end() continues
      // its original close requests; it never opens a replacement browser.
      if (!journey?.context) await lease.close();
    }
  }
}
