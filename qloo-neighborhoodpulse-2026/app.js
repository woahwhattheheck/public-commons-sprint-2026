(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { plan: null, excluded: new Set() };
  const form = $('planner-form'), button = $('plan-button'), sourceBadge = $('source-badge');
  const create = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function setError(message) {
    const panel = $('error-panel');
    panel.textContent = message || '';
    panel.hidden = !message;
  }
  function modeText() {
    const synthetic = $('mode').value === 'fixture';
    $('mode-note').textContent = synthetic
      ? 'SYNTHETIC MODE — all suggestions are fictional test examples, not live Qloo insight results.'
      : 'LIVE MODE — Qloo searches and four Insights calls run server-side. No API key appears in your browser.';
  }
  function renderEntity(entity, kind) {
    const root = create('div', 'entity' + (entity ? '' : ' empty'));
    root.append(create('div', 'entity-kind', kind));
    if (!entity) {
      root.append(create('div', 'entity-name', 'No available suggestion'), create('div', 'entity-proof', 'The source returned too few unique matches.'));
      return root;
    }
    const dismiss = create('button', 'dismiss', '×');
    dismiss.type = 'button'; dismiss.title = `Dismiss ${entity.name} on regeneration`;
    dismiss.setAttribute('aria-label', `Exclude ${entity.name} on next regeneration`);
    dismiss.addEventListener('click', () => {
      state.excluded.add(entity.id);
      dismiss.textContent = '✓'; dismiss.disabled = true;
      root.style.opacity = '.62';
    });
    root.append(dismiss, create('div', 'entity-name', entity.name),
      create('div', 'entity-proof', entity.affinity === null
        ? `Qloo ID: ${entity.id} · results rank ${entity.rank}`
        : `Affinity: ${entity.affinity} · Qloo ID: ${entity.id}`));
    if (entity.address) root.append(create('div', 'entity-proof', entity.address));
    return root;
  }
  function renderPlan(plan) {
    state.plan = plan;
    $('outcome').hidden = false;
    sourceBadge.textContent = plan.mode === 'fixture' ? 'SYNTHETIC EXAMPLES • NOT QLOO DATA' : 'LIVE QLOO API RESULTS';
    sourceBadge.className = 'source-badge' + (plan.mode === 'fixture' ? ' fixture' : '');
    $('outcome-caption').textContent = `A concept calendar for ${plan.city} · ${plan.signals.length} resolved taste signals · ${plan.weeks.length} original program formats`;
    const signals = $('signal-list'); signals.replaceChildren();
    for (const signal of plan.signals) {
      const item = create('div', 'signal');
      item.append(create('strong', '', `${signal.query} → ${signal.name}`),
        create('small', '', `Entity ${signal.id}${signal.type ? ` · ${signal.type}` : ''}`));
      signals.append(item);
    }
    const grid = $('program-grid'); grid.replaceChildren();
    for (const week of plan.weeks) {
      const card = create('article', 'week-card');
      card.append(create('div', 'week-tag', `WEEK ${String(week.week).padStart(2, '0')} / PROGRAM CONCEPT`),
        create('h3', '', week.title), create('p', 'week-format', week.format));
      const ents = create('div', 'entities');
      for (const cat of ['artist', 'movie', 'book', 'place']) ents.append(renderEntity(week.program[cat], cat));
      card.append(ents, create('div', 'card-caution', week.notice));
      grid.append(card);
    }
    $('outcome').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function generate() {
    setError('');
    const city = $('city').value;
    const tastes = $('tastes').value.split('\n').map(s => s.trim()).filter(Boolean);
    const mode = $('mode').value;
    button.disabled = true;
    button.firstChild.textContent = mode === 'fixture' ? 'Building synthetic illustration… ' : 'Calling Qloo taste graph… ';
    try {
      const rsp = await fetch('/api/plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ city, tastes, mode, excludedIds: [...state.excluded] }),
      });
      const result = await rsp.json();
      if (!rsp.ok) throw new Error(result?.error || `Request failed (HTTP ${rsp.status}).`);
      renderPlan(result);
    } catch (err) {
      setError(err?.message || 'Could not generate the plan.');
      $('error-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
      button.disabled = false;
      button.firstChild.textContent = 'Build four-week program ';
    }
  }
  form.addEventListener('submit', e => { e.preventDefault(); state.excluded.clear(); void generate(); });
  $('reroll').addEventListener('click', () => { void generate(); });
  $('mode').addEventListener('change', modeText);
  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = filename; el.click();
    URL.revokeObjectURL(url);
  }
  $('export-json').addEventListener('click', () => {
    if (!state.plan) return;
    download('neighborhoodpulse-program.json', 'application/json', JSON.stringify(state.plan, null, 2));
  });
  function csvSafe(value) {
    let s = String(value ?? '');
    // Formula injection defense: a spreadsheet must never execute untrusted Qloo labels.
    if (/^[\s\t\r\n]*[=+@-]/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  }
  $('export-csv').addEventListener('click', () => {
    if (!state.plan) return;
    const head = ['week', 'format', 'category', 'entity_name', 'qloo_id', 'affinity', 'source_mode', 'disclaimer'];
    const rows = state.plan.weeks.flatMap(w => ['artist', 'movie', 'book', 'place'].map(cat => {
      const e = w.program[cat];
      return [w.week, w.title, cat, e?.name, e?.id, e?.affinity, state.plan.sourceLabel, w.notice];
    }));
    download('neighborhoodpulse-program.csv', 'text/csv;charset=utf-8', [head, ...rows].map(r => r.map(csvSafe).join(',')).join('\r\n') + '\r\n');
  });
  fetch('/api/health').then(r => r.json()).then(h => {
    if (!h.liveReady) $('mode').value = 'fixture';
    modeText();
  }).catch(() => { modeText(); });
})();
