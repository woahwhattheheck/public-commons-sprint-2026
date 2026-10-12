// MIT. Tab-scoped setup drafts for the original Applications Review/Save workflow.
const SCHEMA = 'stellar-forge.application-setup-drafts.v1';
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const action = (text, callback) => {
  const value = node('button', text); value.type = 'button';
  value.addEventListener('click', callback); return value;
};
const copy = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
const string = value => typeof value === 'string';
function validForm(value) {
  return value && string(value.label) && string(value.runtimeId) && string(value.kind) &&
    value.settings && !Array.isArray(value.settings) && typeof value.settings === 'object' &&
    Object.values(value.settings).every(field => field && string(field.value) && typeof field.checked === 'boolean');
}
function validEntry(value, workspaceId) {
  return value && value.workspaceId === workspaceId && string(value.id) && string(value.contextId) &&
    string(value.kind) && (value.applicationId === null || string(value.applicationId)) &&
    (value.baseRevision === null || string(value.baseRevision)) && string(value.updatedAt) &&
    value.id === value.contextId + '/' + value.kind && validForm(value.form) && validForm(value.baseline);
}
export function createApplicationDrafts({
  root, controls, getWorkspaceId, getCatalog, getApplications, getRuntimes, selectedRuntime,
  renderSettings, reviewButton, onContext, onChange, onNotice,
}) {
  const { label, runtime, kind, settings } = controls;
  const caches = new Map();
  let current = null, catalogSignature = '', changing = false;
  const status = node('p', '', 'note'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const picker = node('select'); picker.id = 'application-draft-select';
  const pickerLabel = node('label', 'Retained setup drafts in this tab'); pickerLabel.append(picker);
  const buttons = node('div', undefined, 'actions');
  const resume = action('Resume selected draft', () => {
    capture(); const value = cache()?.entries.get(picker.value);
    if (value) mount(copy(value), value.form, true);
  });
  const discard = action('Discard current draft', () => {
    if (!current) return;
    const app = getApplications().find(value => value.id === current.applicationId);
    const oldKind = current.kind, owner = cache(current.workspaceId);
    owner.entries.delete(current.id); owner.active = null; persist(owner);
    current = null;
    edit(app ?? null, { kind: app?.kind ?? oldKind, restore: false });
  });
  const download = action('Download current draft', () => {
    if (!current) return;
    const value = snapshot();
    downloadJSON({ schema: 'stellar-forge.application-setup-draft.v1', ...value }, 'application-setup-draft.json');
  });
  const keep = action('Keep my fields with current saved revision', () => {
    capture();
    const app = getApplications().find(value => value.id === current?.applicationId);
    if (!app || app.error) return;
    current.baseRevision = app.revision; current.baseline = baseline(app, current.kind);
    onChange(); capture(); renderStatus();
    onNotice('Your draft fields are retained against the current saved revision. Review the application to inspect their current inputs.');
  });
  const reload = action('Load current saved settings', () => {
    const app = getApplications().find(value => value.id === current?.applicationId);
    if (!app || app.error) return;
    const owner = cache(current.workspaceId); owner.entries.delete(current.id); persist(owner);
    current = null; edit(app, { kind: app.kind, restore: false });
  });
  const useFields = action('Use the current tool fields', () => {
    if (!current) return;
    capture();
    const names = new Set(type()?.fields.map(field => field.name) ?? []);
    current.form.settings = Object.fromEntries(Object.entries(current.form.settings).filter(([name]) => names.has(name)));
    onChange(); capture(); renderStatus();
  });
  const inspect = node('details'), inspectText = node('pre');
  inspect.append(node('summary', 'Inspect the complete retained setup'), inspectText);
  buttons.append(resume, discard, download, keep, reload, useFields);
  root.replaceChildren(status, pickerLabel, buttons, inspect);

  function cache(workspaceId = getWorkspaceId()) {
    if (!string(workspaceId) || !workspaceId) return null;
    if (caches.has(workspaceId)) return caches.get(workspaceId);
    const value = { workspaceId, entries: new Map(), active: null, error: null, invalid: false };
    try {
      const saved = sessionStorage.getItem(storageKey(workspaceId));
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.schema !== SCHEMA || parsed.workspaceId !== workspaceId || !Array.isArray(parsed.entries) ||
            !parsed.entries.every(entry => validEntry(entry, workspaceId)) ||
            new Set(parsed.entries.map(entry => entry.id)).size !== parsed.entries.length)
          throw new Error('The retained setup storage has an unexpected format.');
        value.entries = new Map(parsed.entries.map(entry => [entry.id, entry]));
        value.active = string(parsed.active) ? parsed.active : null;
      }
    } catch (error) {
      value.error = 'The previous setup storage could not be read. Current fields remain in this page; download the current draft to retain them.';
      value.invalid = true;
    }
    caches.set(workspaceId, value); return value;
  }
  function storageKey(workspaceId) { return 'starforge-applications-' + workspaceId + '-setup-drafts'; }
  function persist(value) {
    if (!value || value.invalid) return false;
    try {
      sessionStorage.setItem(storageKey(value.workspaceId), JSON.stringify({
        schema: SCHEMA, workspaceId: value.workspaceId, active: value.active, entries: [...value.entries.values()],
      }));
      value.error = null; return true;
    } catch {
      value.error = 'Browser draft storage is unavailable. Your current fields remain in this page; download the current draft before closing it.';
      return false;
    }
  }
  function type() { return getCatalog().find(value => value.id === current?.kind); }
  function availableApplication() { return getApplications().find(value => value.id === current?.applicationId); }
  function baseline(app, selectedKind) {
    const declaration = getCatalog().find(value => value.id === selectedKind);
    const values = app?.kind === selectedKind ? app.settings ?? {} : {};
    return { label: app?.label ?? '', runtimeId: app?.runtimeId ?? runtime.value ?? '',
      kind: app?.kind ?? selectedKind, settings: Object.fromEntries((declaration?.fields ?? []).map(field => [
        field.name, { value: field.type === 'boolean' ? 'on' : String(values[field.name] ?? (field.type === 'port' ? '0' : '')),
          checked: field.type === 'boolean' && values[field.name] === true },
      ])) };
  }
  function readForm() {
    const values = { ...(current?.form.settings ?? {}) };
    for (const input of settings.querySelectorAll('[name]'))
      values[input.name] = { value: input.value, checked: input.type === 'checkbox' && input.checked };
    return { label: label.value, runtimeId: runtime.value, kind: current?.kind ?? kind.value, settings: values };
  }
  function semantic(values) {
    const entries = [];
    for (const field of getCatalog().find(value => value.id === values.kind)?.fields ?? []) {
      const raw = values.settings[field.name];
      if (!raw) continue;
      entries.push([field.name, field.type === 'boolean' ? raw.checked : raw.value]);
    }
    return Object.fromEntries(entries);
  }
  function selectValue(control, value, missingLabel) {
    if (value && ![...control.options].some(option => option.value === value)) {
      const option = new Option(missingLabel ?? ('Retained selection: ' + value), value);
      option.dataset.retainedUnavailable = 'true'; control.append(option);
    }
    control.value = value;
  }
  function applyField(input, raw) {
    if (!raw) return;
    if (input.type === 'checkbox') input.checked = raw.checked;
    else {
      if (input.tagName === 'SELECT') selectValue(input, raw.value);
      else input.value = raw.value;
    }
  }
  function applyForm(value) {
    label.value = value.label;
    selectValue(runtime, value.runtimeId, 'Retained runtime: ' + value.runtimeId);
    selectValue(kind, value.kind, 'Retained tool: ' + value.kind);
    renderSettings(semantic(value));
    for (const input of settings.querySelectorAll('[name]')) applyField(input, value.settings[input.name]);
  }
  function capture() {
    if (!current || changing) return;
    current.form = readForm();
    const value = cache(current.workspaceId);
    if (!value) return;
    if (!same(current.form, current.baseline)) {
      current.updatedAt = new Date().toISOString(); value.entries.set(current.id, copy(current)); value.active = current.id;
    } else { value.entries.delete(current.id); if (value.active === current.id) value.active = null; }
    persist(value); renderStatus();
  }
  function mount(meta, values, retained = false) {
    changing = true;
    try {
      current = copy(meta); current.form = copy(values);
      onContext(current.applicationId);
      applyForm(values);
      if (!retained) current.form = readForm();
      catalogSignature = JSON.stringify(type() ?? null);
      onChange();
    } finally { changing = false; }
    capture(); renderStatus();
  }
  function newMeta(app, selectedKind, contextId, original) {
    const workspaceId = getWorkspaceId();
    return { workspaceId, contextId, id: contextId + '/' + selectedKind,
      applicationId: app?.id ?? null, kind: selectedKind, baseRevision: app?.revision ?? null,
      baseline: copy(original), form: copy(original), updatedAt: new Date().toISOString() };
  }
  function edit(app, { kind: selectedKind, runtimeId, label: displayName, values, restore = true, initial = false } = {}) {
    capture();
    const owner = cache(); if (!owner) return;
    const previous = restore && app ? [...owner.entries.values()].filter(entry => entry.applicationId === app.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : null;
    selectedKind ??= previous?.kind ?? app?.kind ?? kind.value ?? getCatalog()[0]?.id;
    if (!selectedKind) selectedKind = getCatalog()[0]?.id ?? '';
    const contextId = app ? 'application:' + app.id : 'new:' + crypto.randomUUID();
    const original = baseline(app, selectedKind);
    if (!app) original.runtimeId = runtimeId ?? selectedRuntime() ?? getRuntimes().find(value => value.phase === 'READY')?.id ?? '';
    const retained = restore && app ? [...owner.entries.values()]
      .filter(entry => entry.applicationId === app.id && entry.kind === selectedKind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : null;
    if (retained) return mount(copy(retained), retained.form, true);
    const meta = newMeta(app, selectedKind, contextId, original), form = copy(original);
    form.kind = selectedKind;
    if (displayName !== undefined) form.label = displayName;
    if (runtimeId !== undefined) form.runtimeId = runtimeId;
    if (values) {
      for (const field of getCatalog().find(value => value.id === selectedKind)?.fields ?? []) {
        if (!Object.hasOwn(values, field.name)) continue;
        form.settings[field.name] = { value: field.type === 'boolean' ? 'on' : String(values[field.name] ?? ''),
          checked: field.type === 'boolean' && values[field.name] === true };
      }
    }
    if (!app && !initial) meta.baseline.kind = '';
    mount(meta, form);
  }
  function changeKind(selectedKind) {
    if (!current) return edit(null, { kind: selectedKind });
    const inherited = readForm(), previous = copy(current); capture();
    const value = cache(), id = previous.contextId + '/' + selectedKind, retained = value?.entries.get(id);
    if (retained) return mount(copy(retained), retained.form, true);
    const app = availableApplication(), original = baseline(app, selectedKind);
    const meta = newMeta(app ?? null, selectedKind, previous.contextId, original);
    meta.applicationId = previous.applicationId; meta.baseRevision = previous.baseRevision;
    const form = { ...original, label: inherited.label, runtimeId: inherited.runtimeId, kind: selectedKind };
    if (!app) meta.baseline.kind = previous.kind;
    mount(meta, form);
  }
  function problems() {
    if (!current) return { missingType: true };
    const app = availableApplication(), declaration = type();
    const names = new Set((declaration?.fields ?? []).map(value => value.name));
    return {
      missingType: !declaration,
      missingApplication: !!current.applicationId && (!app || app.error),
      changed: !!app && !app.error && app.revision !== current.baseRevision,
      missingRuntime: !getRuntimes().some(value => value.id === runtime.value && value.phase === 'READY'),
      obsolete: Object.keys(current.form.settings).filter(name => !names.has(name)),
    };
  }
  function renderStatus() {
    const owner = cache();
    const entries = [...(owner?.entries.values() ?? [])].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    const selected = picker.value;
    const signature = JSON.stringify(entries.map(value => [value.id, value.form.label, value.kind, value.applicationId]));
    if (picker.dataset.signature !== signature) {
      picker.dataset.signature = signature;
      picker.replaceChildren(new Option(entries.length ? 'Choose a retained draft' : 'No retained setup drafts', ''),
        ...entries.map(value => new Option((value.form.label || getCatalog().find(item => item.id === value.kind)?.title || value.kind) +
          ' · ' + (value.applicationId ? 'saved application' : 'new application') + ' · ' + value.kind, value.id)));
      picker.value = entries.some(value => value.id === selected) ? selected : entries.some(value => value.id === current?.id) ? current.id : '';
    }
    resume.disabled = !picker.value; discard.disabled = !current; download.disabled = !current;
    const issue = problems(), parts = [];
    const dirty = current && !same(current.form, current.baseline);
    if (owner?.error) parts.push(owner.error);
    else if (dirty) parts.push('Setup draft kept in this tab. It will return after a refresh or a change of view.');
    else parts.push(current?.applicationId ? 'These fields match the saved application.' : 'Choose a tool and enter its setup.');
    if (issue.changed) parts.push('This application has a newer saved revision. Keep your fields against that revision or load its saved settings before review.');
    if (issue.missingApplication) parts.push('The saved application is currently unavailable. Its full draft is retained here.');
    if (issue.missingType) parts.push('The selected tool is absent from the current catalog. Its full draft is retained here.');
    if (issue.missingRuntime) parts.push('Choose a ready runtime for this setup.');
    if (issue.obsolete?.length) parts.push('Retained fields no longer in this tool: ' + issue.obsolete.join(', ') +
      '. Inspect or download the complete draft before choosing Use the current tool fields.');
    status.textContent = parts.join(' ');
    keep.hidden = reload.hidden = !issue.changed;
    useFields.hidden = !issue.obsolete?.length || issue.missingType;
    reviewButton.disabled = !!(issue.changed || issue.missingApplication || issue.missingType || issue.missingRuntime || issue.obsolete?.length);
    inspectText.textContent = current ? JSON.stringify(current, null, 2) : '';
  }
  function refresh() {
    const workspaceId = getWorkspaceId(), owner = cache(workspaceId);
    if (!owner) return;
    if (current && current.workspaceId !== workspaceId) current = null;
    if (current && !same(readForm(), current.form)) capture();
    const selectedKind = current?.kind ?? kind.value;
    const selectedId = current?.form.runtimeId ?? runtime.value;
    const ready = getRuntimes().filter(value => value.phase === 'READY');
    const runtimeSignature = JSON.stringify(ready.map(value => [value.id, value.label, value.packageVersion]));
    if (runtime.dataset.draftSignature !== runtimeSignature) {
      runtime.dataset.draftSignature = runtimeSignature;
      runtime.replaceChildren(new Option('Choose a ready runtime', ''), ...ready.map(value =>
        new Option(value.label + ' · ' + (value.packageVersion ?? value.sourceCommit), value.id)));
      selectValue(runtime, selectedId);
    }
    const kindsSignature = JSON.stringify(getCatalog().map(value => [value.id, value.title]));
    if (kind.dataset.draftSignature !== kindsSignature) {
      kind.dataset.draftSignature = kindsSignature;
      kind.replaceChildren(...getCatalog().map(value => new Option(value.title, value.id)));
      selectValue(kind, selectedKind);
    }
    if (!current) {
      const retained = owner.entries.get(owner.active);
      if (retained) mount(copy(retained), retained.form, true);
      else edit(null, { kind: getCatalog()[0]?.id ?? '', initial: true });
    } else if (catalogSignature !== JSON.stringify(type() ?? null)) {
      capture(); mount(copy(current), current.form, true);
    }
    renderStatus();
  }
  function snapshot() {
    capture(); return current ? copy(current) : null;
  }
  function matches(ticket) {
    return !!ticket && !!current && ticket.workspaceId === current.workspaceId && ticket.id === current.id &&
      ticket.baseRevision === current.baseRevision && same(ticket.form, readForm());
  }
  function saved(ticket, result) {
    if (!ticket) return false;
    if (current) capture();
    const selected = matches(ticket), value = cache(ticket.workspaceId);
    const accepted = result && string(result.applicationId) && string(result.revision) &&
      (!ticket.applicationId || result.applicationId === ticket.applicationId);
    const submitted = accepted ? { id: result.applicationId, revision: result.revision,
      label: ticket.form.label, runtimeId: ticket.form.runtimeId, kind: ticket.kind } : null;
    for (const [id, retained] of value?.entries ?? []) {
      if (retained.contextId !== ticket.contextId || retained.applicationId !== ticket.applicationId ||
          retained.baseRevision !== ticket.baseRevision) continue;
      if (id === ticket.id && same(retained.form, ticket.form)) {
        value.entries.delete(id); if (value.active === id) value.active = null;
      } else if (submitted) {
        // The returned native revision belongs to this save. Later typed fields
        // continue the same application, including its first successful save.
        const next = { ...copy(retained), applicationId: submitted.id, baseRevision: submitted.revision,
          baseline: retained.kind === ticket.kind ? copy(ticket.form) : { ...copy(retained.baseline),
            label: submitted.label, runtimeId: submitted.runtimeId, kind: submitted.kind } };
        value.entries.set(id, next);
        if (current?.workspaceId === ticket.workspaceId && current.id === id &&
            current.baseRevision === ticket.baseRevision) {
          current = copy(next); onContext(submitted.id, { select: false }); onChange();
        }
      }
    }
    persist(value);
    if (selected) {
      current = null; label.value = ''; onContext(null);
    }
    renderStatus(); return selected;
  }
  function downloadJSON(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  picker.addEventListener('change', renderStatus);
  return {
    edit, changeKind, refresh, capture, snapshot, matches, saved,
    hasDraft() { return !!current && !same(readForm(), current.baseline); },
    mergeSettings(values) {
      capture();
      if (!current) return;
      const form = copy(current.form);
      for (const field of type()?.fields ?? []) {
        if (!Object.hasOwn(values, field.name)) continue;
        form.settings[field.name] = {
          value: field.type === 'boolean' ? 'on' : String(values[field.name] ?? ''),
          checked: field.type === 'boolean' && values[field.name] === true,
        };
      }
      mount(copy(current), form, true);
    },
    baseRevision() { return current?.baseRevision ?? null; },
    expectedRevision() {
      capture(); const issue = problems();
      if (issue.changed || issue.missingApplication || issue.missingType || issue.missingRuntime || issue.obsolete?.length)
        throw new Error(status.textContent);
      return current?.baseRevision ?? null;
    },
    settingsReady(input) {
      if (!current || changing || input.name !== 'installationId') return;
      applyField(input, current.form.settings[input.name]);
      capture();
    },
    reset() {
      current = null; catalogSignature = '';
      delete runtime.dataset.draftSignature; delete kind.dataset.draftSignature;
      delete picker.dataset.signature; picker.replaceChildren(); status.textContent = ''; inspectText.textContent = '';
    },
  };
}
