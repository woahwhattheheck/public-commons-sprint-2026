import {clone, esc, validatePlan} from './implementation_core.mjs';

export function fieldPacketContext(packet) {
  if (!packet || packet.schema !== 'upstate.offline-field-packet/v1' ||
      typeof packet.workspace_id !== 'string' || !packet.workspace_id ||
      !/^[0-9a-f]{64}$/.test(packet.deployment_id || ''))
    throw Error('Open an original prepared field packet.');
  const issues = validatePlan(packet.plan);
  if (issues.length) throw Error(issues.map(row => row.path + ': ' + row.message).join('\n'));
  if (!Number.isSafeInteger(packet.plan.revision) || packet.plan.revision < 1)
    throw Error('The field packet needs its original saved native revision.');
  const ids = packet.visit_ids, available = new Set(packet.plan.visits.map(row => row.id));
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length ||
      ids.some(id => !available.has(id)))
    throw Error('The packet must select distinct original saved visits.');
  const files = packet.files || [];
  if (!Array.isArray(files)) throw Error('The original attachment inventory is invalid.');
  const local = packet.plan.source_links.filter(row => row.kind === 'local_file');
  const seen = new Set();
  for (const file of files) {
    if (!/^[0-9a-f]{64}$/.test(file.sha256 || '') ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        !/^field-original-[0-9]+$/.test(file.element_id || '') ||
        seen.has(file.sha256) ||
        !local.some(row => row.sha256 === file.sha256 && row.size_bytes === file.bytes))
      throw Error('An embedded original file differs from the saved plan.');
    seen.add(file.sha256);
  }
  return {packet, storage_key: 'field-packet/' + packet.workspace_id + '/' + packet.deployment_id,
    plan_id: packet.plan.id, revision: packet.plan.revision, visit_ids: [...ids], files};
}

function saveOriginal(plan) {
  const blob = new Blob([JSON.stringify(plan, null, 2) + '\n'], {type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = plan.id + '-original-revision-' + plan.revision + '.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function startFieldPacket(workbench, target, supplied) {
  const context = fieldPacketContext(supplied), original = clone(context.packet.plan);
  if (workbench.native || workbench.workspace !== context.storage_key)
    throw Error('The field packet needs its own portable draft space.');
  const local = workbench.offlineCopies[context.plan_id];
  if (local) {
    const issues = validatePlan(local.document);
    if (issues.length || local.document.id !== context.plan_id)
      throw Error('The retained local draft needs recovery before this packet is reopened.');
  }
  target.innerHTML = '<section class="field-start"><h1>' + esc(original.title) +
    '</h1><p role="status">Opening the saved fieldwork and original attachments…</p></section>';
  const failures = [];
  if (context.files.length) {
    try {
      const vault = await workbench.evidence.vault();
      for (const file of context.files) {
        const node = target.ownerDocument.getElementById(file.element_id);
        if (!node) throw Error('An embedded original attachment is absent.');
        const decoded = atob(node.textContent), bytes = Uint8Array.from(decoded, value => value.charCodeAt(0));
        if (bytes.byteLength !== file.bytes) throw Error('An embedded original attachment has another length.');
        // The maintained vault hashes every original byte before committing it.
        await vault.putMany([{sha256:file.sha256, size_bytes:file.bytes, bytes}]);
        for (const link of original.source_links.filter(row => row.kind === 'local_file' && row.sha256 === file.sha256))
          workbench.evidence.available.set(link.id, true);
      }
    } catch (error) {
      failures.push(error.message || String(error));
    }
  }
  if (!local) workbench.offlineCopies[context.plan_id] = {
    document:clone(original), dirty:false, pending:null, observationReceipts:[],
    updated_at:new Date().toISOString()
  };
  await workbench.openPlan(context.plan_id);
  workbench.tab = 'field';
  await workbench.start();
  const selected = new Set(context.visit_ids);
  const visits = context.visit_ids.map(id => original.visits.find(row => row.id === id));
  const sites = new Map(original.sites.map(row => [row.id, row]));
  const linkCount = original.source_links.filter(row => row.kind === 'local_file').length;
  const retainedHashes = new Set(context.files.map(row => row.sha256));
  const unavailable = original.source_links.filter(row => row.kind === 'local_file' && !retainedHashes.has(row.sha256));
  let chosen = context.visit_ids[0];
  target.innerHTML = '<section class="field-start" aria-label="Prepared field packet"><div><h1>' + esc(original.title) +
    '</h1><p>Saved revision ' + context.revision + ' · ' + visits.length + ' selected visits · ' +
    context.files.length + ' original file bodies for ' + linkCount + ' retained file references.</p>' +
    '<p>' + esc(local ? 'Your existing local fieldwork is open. The original packet remains available below.' :
      'The original plan is open. Record actual fieldwork, save locally and export the completed return.') + '</p></div>' +
    '<label>Selected visit<select data-field-visit>' + visits.map(visit =>
      '<option value="' + esc(visit.id) + '">' + esc((visit.planned_date || 'Date unassigned') + ' · ' +
        (sites.get(visit.site_id)?.label || visit.site_id) + ' · ' + (visit.observer || 'Observer unassigned')) +
      '</option>').join('') + '</select></label><p data-field-visit-detail></p>' +
    '<div class="field-start-actions"><button type="button" data-field-action="visit">Open visit</button>' +
    '<button type="button" data-field-action="record">Record fieldwork</button>' +
    '<button type="button" data-field-action="sheet">Print visit sheet</button>' +
    '<button type="button" data-field-action="return">Export completed plan + files</button>' +
    '<button type="button" data-field-action="json">Export plan JSON</button>' +
    '<button type="button" data-field-action="original">Download original plan</button>' +
    '<button type="button" data-field-action="resume">Open this packet’s working plan</button></div>' +
    '<p data-field-status role="status"></p>' +
    (unavailable.length ? '<p>Original source files not retained in this packet: ' +
      esc(unavailable.map(row => row.original_filename || row.id).join(', ')) + '.</p>' : '') +
    '<p>Return the complete ZIP through the original workspace’s plan-and-files import. The saved native revision stays with your fieldwork for reconciliation.</p></section>';
  const status = target.querySelector('[data-field-status]');
  status.textContent = failures.length
    ? 'The original plan is open. Attachment storage needs attention: ' + failures.join('; ') +
      '. Keep the complete crew ZIP and use Handover to open or add the original files before a full return.'
    : 'Original attachments are ready for the complete field return.';
  function describeVisit() {
    const visit = original.visits.find(row => row.id === chosen), site = sites.get(visit.site_id);
    target.querySelector('[data-field-visit-detail]').textContent =
      (site?.label || visit.site_id) + ' · ' + (visit.planned_date || 'Date unassigned') +
      ' · ' + (visit.observer || 'Observer unassigned') +
      (visit.monitoring_plan_id ? ' · Protocol ' + visit.monitoring_plan_id : '');
  }
  describeVisit();
  target.addEventListener('change', event => {
    if (event.target.matches('[data-field-visit]') && selected.has(event.target.value)) {
      chosen = event.target.value; describeVisit();
    }
  });
  let busy = false;
  target.addEventListener('click', event => {
    const button = event.target.closest('[data-field-action]');
    if (!button || !target.contains(button) || busy) return;
    event.preventDefault();
    const action = button.dataset.fieldAction;
    busy = true; button.disabled = true;
    Promise.resolve().then(async () => {
      if (workbench.gone) throw Error('Reopen the original field packet.');
      if (action === 'original') { saveOriginal(original); return; }
      if (workbench.root.querySelector('dialog[open]')) throw Error('Finish the open field record first.');
      if (action === 'resume') { await workbench.openPlan(context.plan_id); workbench.tab='field'; workbench.render(); return; }
      if (workbench.plan?.id !== context.plan_id) throw Error('Open this packet’s working plan before recording or returning its fieldwork.');
      if (action === 'return') { await workbench.evidence.run(() => workbench.evidence.exportBrowser()); return; }
      if (action === 'json') { await workbench.act({dataset:{impl:'export-json'}}); return; }
      const visit = workbench.plan.visits.find(row => row.id === chosen);
      if (!visit) throw Error('This selected visit was removed from the working draft; the original remains in this packet.');
      if (action === 'visit') { workbench.openDialog('visits', chosen); return; }
      if (action === 'sheet') { await workbench.act({dataset:{impl:'field-sheet', id:chosen}}); return; }
      if (action === 'record') {
        workbench.openDialog('field-form');
        const control = workbench.root.querySelector('dialog[open] [name="visit_id"]');
        if (!control) throw Error('The installed field form lacks its original visit selector.');
        control.value = chosen;
        await workbench.change({target:control});
      }
    }).catch(error => { status.textContent=error.message || String(error); workbench.fail(error); })
      .finally(() => {busy=false; button.disabled=false;});
  });
  return {plan_id:context.plan_id, revision:context.revision, selected_visits:visits.length,
    original_files:context.files.length, resumed:!!local, attachment_issues:failures};
}
