// MIT. Operator workflow over the original accounting and SF101 recovery engines.
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shown = value => value === null || value === undefined ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const date = value => value ? new Date(value).toLocaleString(undefined, {dateStyle:'medium',timeStyle:'short'}) : 'Not recorded';
const friendly = value => String(value ?? '').toLowerCase().replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());
const encode = value => encodeURIComponent(value);
const definitions = pairs => '<dl class="record-values">' + pairs.map(([name,value]) => '<dt>' + esc(name) + '</dt><dd>' + esc(shown(value)) + '</dd>').join('') + '</dl>';
const definitionRows = pairs => pairs.map(([name,value]) => '<dt>' + esc(name) + '</dt><dd>' + esc(shown(value)) + '</dd>').join('');
const operationName = value => ({pause:'Pause workspace',review:'Review sources',backup:'Create backup',verify:'Verify backup',restore:'Restore operation',resume:'Reopen workspace'}[String(value).toLowerCase()] || friendly(value));
const errorText = value => typeof value === 'string' ? value : value?.message || value?.code || shown(value);
const active = job => job && ['QUEUED','RUNNING'].includes(job.status);

export async function mountRecovery({api, operator, onModeChange}) {
  const fragment = await fetch('/recovery.html', {cache:'no-store'});
  if (!fragment.ok) throw new Error('The backup and recovery interface could not be loaded.');
  $('area-maintenance').innerHTML = await fragment.text();
  let state = null, submitting = false, ordinaryBusy = false, selectedBackup = '', selectedJob = '', selectedJobDetail = null;
  let visible = false, limit = 12, poll = null, refreshPromise = null, previousMode = null, reviewId = '', backupIdentity = '';
  let pending = null, storageKey = '', loadedPending = false, disposed = false;
  const currentBackup = () => state?.backups?.find(item => item.id === selectedBackup);
  const activeJob = () => state?.jobs?.find(item => item.id === state.activeJobId) || state?.jobs?.find(active);
  function message(text, error = false) {
    $('maintenance-message').textContent = text;
    $('maintenance-message').hidden = !text;
    $('maintenance-message').classList.toggle('error', error);
  }
  function retainPending() {
    try { if (pending) sessionStorage.setItem(storageKey, JSON.stringify(pending)); else sessionStorage.removeItem(storageKey); } catch {}
  }
  function pendingControls() {
    $('maintenance-pending').hidden = !pending;
    $('maintenance-pending-description').textContent = pending ? operationName(pending.kind) + ' · ' + pending.body.requestId + '. Read its saved state or retry with the same request and inputs.' : '';
    $('maintenance-reconcile').disabled = $('maintenance-retry').disabled = submitting || !pending;
  }
  function controls() {
    const usable = Boolean(state?.configured) && !submitting && !ordinaryBusy && !pending;
    const idle = usable && !activeJob();
    const paused = ['PAUSED','RECOVERY_REQUIRED'].includes(state?.mode);
    const key = Boolean(state?.config?.passphraseConfigured);
    $('maintenance-pause').disabled = !idle || state.mode !== 'RUNNING';
    $('maintenance-resume').disabled = !idle || state.mode !== 'PAUSED';
    $('maintenance-refresh').disabled = submitting;
    $('maintenance-review').disabled = !idle || state.mode !== 'PAUSED';
    $('maintenance-backup-create').disabled = !idle || state.mode !== 'PAUSED' || !key || !state.review?.reviewId || !$('maintenance-backup-writers').checked;
    $('maintenance-verify').disabled = !idle || !key || !currentBackup();
    $('maintenance-restore').disabled = !idle || !paused || !key || !currentBackup() || !$('maintenance-restore-writers').checked || !$('maintenance-restore-confirm').checked;
    $('maintenance-restore').textContent = state?.mode === 'RECOVERY_REQUIRED' ? 'Continue recovery from this backup' : 'Restore selected backup';
    for (const button of $('area-maintenance').querySelectorAll('[data-maintenance-cancel]')) {
      const job = state?.jobs?.find(item => item.id === button.dataset.maintenanceCancel) || selectedJobDetail;
      button.disabled = submitting || Boolean(pending) || !active(job) || !job.cancellable || Boolean(job.cancelRequested);
    }
    pendingControls();
  }
  function renderConfiguration() {
    const mode = state.mode || 'RUNNING';
    const descriptions = {
      RUNNING:'Accounting is open. Pause the workspace before reviewing sources or capturing a backup.',
      PAUSING:'Finishing accepted accounting operations and closing their source owners. This page remains available.',
      PAUSED:'Accounting is paused. Review the current sources, create or verify a backup, or recover the retained operation.',
      RESUMING:'Reopening the original accounting sources and controllers.',
      RECOVERY_REQUIRED:'An original recovery is unfinished. Continue with its retained backup before reopening accounting.',
      CLOSING:'The server is finishing its accepted operation and closing.'
    };
    $('maintenance-mode').textContent = state.configured ? friendly(mode) : 'Not configured';
    $('maintenance-mode-description').textContent = state.configured ? descriptions[mode] || friendly(mode) : 'Accounting is available. Enable operating recovery in this host’s existing workspace configuration.';
    const config = state.config || {};
    const rows = [['Workspace',config.directory]];
    if (state.configured) rows.push(['Operating state root',config.stateRoot],['Backup folder',config.backupRoot],['Recovery key',config.passphraseConfigured ? 'Available on this host' : 'Set the configured host environment variable before backup or verification']);
    $('maintenance-config').innerHTML = definitionRows(rows);
    $('maintenance-setup').hidden = Boolean(state.configured);
    $('maintenance-workflow').hidden = !state.configured;
    $('maintenance-recovery-required').hidden = mode !== 'RECOVERY_REQUIRED';
    $('maintenance-recovery-values').innerHTML = definitionRows(Object.entries(state.recovery || {}).filter(([,value]) => value !== null && value !== undefined).map(([name,value]) => [friendly(name.replace(/([a-z])([A-Z])/g,'$1 $2')), value]));
  }
  function renderReview() {
    const review = state.review;
    if (reviewId !== (review?.reviewId || '')) {
      reviewId = review?.reviewId || '';
      $('maintenance-backup-writers').checked = false;
    }
    $('maintenance-review-detail').hidden = !review;
    $('maintenance-review-empty').hidden = Boolean(review);
    $('maintenance-review-empty').textContent = state.mode === 'PAUSED' ? 'Review the operating sources to prepare the next backup.' : 'Pause the workspace to review its operating sources.';
    if (!review) return;
    $('maintenance-review-values').innerHTML = definitionRows([
      ['Workspace revision',review.revision],['Operating files',review.operatingFiles],['Operating bytes',review.operatingBytes],
      ['Workspace SHA-256',review.workspaceSha256],['Review identity',review.reviewId]
    ]);
    const roots = Array.isArray(review.roots) ? review.roots.map((item,index) => [String(index + 1),item]) : Object.entries(review.roots || {});
    $('maintenance-roots').innerHTML = roots.map(([name,item]) => {
      const value = typeof item === 'string' ? {path:item} : item;
      return '<tr><td>' + esc(value.label || value.role || value.name || value.kind || name) + '</td><td>' + esc(value.path || value.directory || shown(item)) + '</td></tr>';
    }).join('');
    const auxiliary = review.additionalSources?.length ? review.additionalSources : review.auxiliaryInputs;
    $('maintenance-auxiliary').hidden = !auxiliary || (typeof auxiliary === 'number' ? auxiliary < 1 : Array.isArray(auxiliary) ? auxiliary.length === 0 : Object.keys(auxiliary).length === 0);
    $('maintenance-auxiliary-values').textContent = shown(auxiliary);
  }
  function renderBackups() {
    const backups = state.backups || [];
    if (!backups.some(item => item.id === selectedBackup)) selectedBackup = backups[0]?.id || '';
    const options = backups.length ? backups.map(item => '<option value="' + esc(item.id) + '">' + esc((item.label || item.id) + ' · ' + date(item.createdAt)) + '</option>').join('') : '<option value="">No retained backups</option>';
    const element = $('maintenance-backup-select');
    if (element.innerHTML !== options) element.innerHTML = options;
    element.value = selectedBackup;
    const backup = currentBackup();
    const identity = backup ? backup.id + ':' + backup.manifestSha256 : '';
    if (identity !== backupIdentity) {
      backupIdentity = identity;
      $('maintenance-restore-confirm').checked = $('maintenance-restore-writers').checked = false;
    }
    $('maintenance-backup-empty').hidden = Boolean(backup);
    $('maintenance-backup-detail').hidden = !backup;
    if (!backup) return;
    const folder = state.config?.backupRoot ? state.config.backupRoot.replace(/\/$/,'') + '/' + backup.id : backup.id;
    $('maintenance-backup-values').innerHTML = definitionRows([
      ['Name',backup.label || backup.id],['Created',date(backup.createdAt)],['Retained entries',backup.files],['Plaintext bytes',backup.bytes],
      ['Last verification',backup.verifiedAt ? date(backup.verifiedAt) : 'Not yet verified by this workspace'],
      ['Manifest SHA-256',backup.manifestSha256],['Host location',folder]
    ]);
    $('maintenance-restore-target').textContent = 'Workspace: ' + shown(state.config?.directory) + '. Operating root: ' + shown(state.config?.stateRoot) + '.';
  }
  function renderJobs() {
    const jobs = state.jobs || [];
    $('maintenance-job-count').textContent = String(state.jobsTotal ?? jobs.length) + ' retained';
    $('maintenance-jobs').innerHTML = jobs.slice(0,limit).map(job => '<tr' + (job.id === selectedJob ? ' class="selected"' : '') + '><td><button type="button" class="inspect" data-maintenance-job="' + esc(job.id) + '">' + esc(operationName(job.kind)) + '</button><span class="subtle mono">' + esc(job.id) + '</span></td><td>' + esc(date(job.startedAt || job.createdAt)) + '<span class="subtle">' + esc(job.actor || 'Not recorded') + '</span></td><td>' + esc(friendly(job.status)) + '<span class="subtle">' + esc(friendly(job.phase)) + '</span></td><td>' + (active(job) && job.cancellable ? '<button type="button" data-maintenance-cancel="' + esc(job.id) + '">' + (job.cancelRequested ? 'Stop requested' : 'Stop operation') + '</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="4">No maintenance operations have been accepted.</td></tr>';
    $('maintenance-more').hidden = jobs.length <= limit;
    $('maintenance-history-description').textContent = 'Showing ' + Math.min(limit,jobs.length) + ' of ' + jobs.length + ' recent operations' + ((state.jobsTotal || 0) > jobs.length ? ' · ' + state.jobsTotal + ' retained on the host' : '') + '.';
    const job = activeJob();
    $('maintenance-progress').hidden = !job;
    $('maintenance-progress-title').textContent = job ? operationName(job.kind) : '';
    $('maintenance-progress-phase').textContent = job ? friendly(job.phase || job.status) : '';
    const current = jobs.find(item => item.id === selectedJob);
    if (current) selectedJobDetail = current;
    renderJobDetail();
  }
  function renderJobDetail() {
    const job = selectedJobDetail;
    const target = $('maintenance-job-detail');
    target.hidden = !job;
    if (!job) return;
    target.innerHTML = '<h3>' + esc(operationName(job.kind)) + '</h3>' + definitions([
      ['Operation',job.id],['Operator',job.actor],['State',friendly(job.status)],['Current phase',friendly(job.phase)],
      ['Accepted',date(job.createdAt)],['Started',date(job.startedAt)],['Finished',date(job.finishedAt)]
    ]) + (job.error ? '<div class="message error" role="alert">' + esc(errorText(job.error)) + '</div>' : '') +
      (job.result ? '<details open><summary>Retained result</summary><pre>' + esc(shown(job.result)) + '</pre></details>' : '') +
      (active(job) && job.cancellable ? '<div class="actions"><button type="button" data-maintenance-cancel="' + esc(job.id) + '">' + (job.cancelRequested ? 'Stop requested' : 'Stop operation') + '</button></div>' : '');
  }
  function schedule() {
    clearTimeout(poll);
    if (disposed || document.hidden || (!visible && !activeJob() && (!state?.configured || state.mode === 'RUNNING'))) return;
    poll = setTimeout(() => refresh().catch(error => { message(error.message, true); schedule(); }), activeJob() ? 1000 : 5000);
  }
  async function adopt(next) {
    state = next;
    if (!loadedPending) {
      storageKey = 'merchant-accounting.maintenance.' + String(next.config?.directory || location.origin);
      loadedPending = true;
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (saved?.body?.requestId && saved.path?.startsWith('/api/maintenance/')) pending = saved;
      } catch {}
    }
    const existing = pending && state.jobs?.find(item => item.id === pending.body.requestId);
    if (existing) { selectedJob = existing.id; selectedJobDetail = existing; pending = null; retainPending(); }
    renderConfiguration(); renderReview(); renderBackups(); renderJobs(); controls();
    const changed = previousMode !== state.mode;
    const prior = previousMode;
    previousMode = state.mode;
    if (changed) await onModeChange?.(state, prior);
    schedule();
  }
  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => { await adopt(await api('/api/maintenance')); return state; })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }
  async function send(command) {
    if (submitting) return;
    submitting = true; controls();
    try {
      const result = await api(command.path, command.body);
      if (!result.job || !result.state) throw new Error('The operation response was incomplete. Read its retained command before continuing.');
      selectedJob = result.job.id; selectedJobDetail = result.job;
      pending = null; retainPending();
      await adopt(result.state);
      message(operationName(command.kind) + ' accepted. The original operation and its result remain in the history.');
    } catch (error) {
      if (error.status && error.status < 500) { pending = null; retainPending(); }
      message(error.message || String(error), true);
      try { await refresh(); } catch {}
    } finally { submitting = false; controls(); schedule(); }
  }
  async function action(kind, body = {}, suffix = kind) {
    if (pending) throw new Error('Read or retry the retained command before starting another operation.');
    const actor = operator();
    if (actor.length > 160) throw new Error('Use an operator reference of at most 160 characters for recovery.');
    pending = {kind,path:'/api/maintenance/' + suffix,body:{...body,actor,requestId:crypto.randomUUID()}};
    retainPending(); await send(pending);
  }
  function attempt(work) {
    return Promise.resolve().then(work).catch(error => message(error.message || String(error), true));
  }
  async function reconcilePending() {
    if (!pending) return;
    const result = await api('/api/maintenance/jobs/' + encode(pending.body.requestId));
    const job = result.job || result;
    if (!job?.id) throw new Error('The retained operation could not be read.');
    selectedJob = job.id; selectedJobDetail = job;
    pending = null; retainPending();
    await refresh();
    message('Loaded the original saved operation.');
  }
  $('maintenance-pause').addEventListener('click',() => attempt(() => action('pause')));
  $('maintenance-resume').addEventListener('click',() => attempt(() => action('resume')));
  $('maintenance-refresh').addEventListener('click',() => attempt(refresh));
  $('maintenance-review').addEventListener('click',() => attempt(() => action('review')));
  $('maintenance-backup-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => {
    if (!$('maintenance-backup-writers').checked || !state?.review?.reviewId) throw new Error('Review the sources and stop their external writers before capture.');
    await action('backup',{expectedReviewId:state.review.reviewId,externalWritersStopped:true,label:$('maintenance-backup-label').value.trim()});
  }); });
  $('maintenance-backup-select').addEventListener('change',() => { selectedBackup = $('maintenance-backup-select').value; renderBackups(); controls(); });
  $('maintenance-verify').addEventListener('click',() => attempt(async () => {
    const backup = currentBackup(); if (!backup) throw new Error('Choose a retained backup.');
    await action('verify',{backupId:backup.id,expectedSha256:backup.manifestSha256});
  }));
  $('maintenance-restore-form').addEventListener('submit',event => { event.preventDefault(); attempt(async () => {
    const backup = currentBackup();
    if (!backup || !$('maintenance-restore-writers').checked || !$('maintenance-restore-confirm').checked) throw new Error('Review the selected backup, original target and stopped source writers before recovery.');
    await action('restore',{backupId:backup.id,expectedSha256:backup.manifestSha256,externalWritersStopped:true});
  }); });
  for (const id of ['maintenance-backup-writers','maintenance-restore-writers','maintenance-restore-confirm']) $(id).addEventListener('change',controls);
  $('maintenance-more').addEventListener('click',() => { limit += 12; renderJobs(); controls(); });
  $('area-maintenance').addEventListener('click',event => {
    const inspect = event.target.closest('[data-maintenance-job]');
    if (inspect) {
      selectedJob = inspect.dataset.maintenanceJob;
      selectedJobDetail = state.jobs.find(item => item.id === selectedJob) || null;
      renderJobs(); controls(); $('maintenance-job-detail').focus({preventScroll:true});
    }
    const cancel = event.target.closest('[data-maintenance-cancel]');
    if (cancel) attempt(() => action('cancel',{},'jobs/' + encode(cancel.dataset.maintenanceCancel) + '/cancel'));
  });
  $('maintenance-reconcile').addEventListener('click',() => attempt(reconcilePending));
  $('maintenance-retry').addEventListener('click',() => attempt(() => pending && send(pending)));
  document.addEventListener('visibilitychange',() => { if (document.hidden) clearTimeout(poll); else attempt(refresh); });
  await refresh();
  return {
    refresh,
    setVisible(value) { visible = value; if (value) attempt(refresh); else schedule(); },
    setBusy(value) { ordinaryBusy = value; controls(); },
    getState() { return state; },
    close() { disposed = true; clearTimeout(poll); }
  };
}

