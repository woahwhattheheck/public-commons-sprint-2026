/** Small retained metadata shared by the delivery list and open inspector. */
export function reportRoles(row) {
  return new Set(row?._delivery_view?.report_roles || Object.keys(row?.files || {}));
}
export function deliveryRevision(row) {
  const value = row?._delivery_view?.revision;
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
export function deliveryChanged(row, context) {
  if (row.state !== context.state) return true;
  const next = deliveryRevision(row);
  return next !== null && context.deliveryRevision != null && next !== context.deliveryRevision;
}

/** Client report and registered downloads on the original delivery screen. */
export function createDeliveryReview(ctx) {
  const {esc, button, bytes, number, when, runTitle, mapFamilies, mapTitles,
         section, pageHeader, table} = ctx;
  const labels = {
    report: 'Scientific report · PDF',
    client_report: 'Client companion · PDF',
    client_report_html: 'Client companion · HTML',
    client_report_markdown: 'Editable client companion · Markdown',
    client_report_model: 'Client companion quantities and provenance · JSON',
    report_html: 'Scientific report · HTML',
    report_markdown: 'Editable report · Markdown',
    report_model: 'Report quantities and provenance · JSON',
    report_data: 'Report quantities and provenance · JSON',
    delivery_archive: 'Complete delivery · ZIP',
    working_archive: 'Working scientific project · ZIP',
    scenario_summary: 'Scenario quantities · JSON',
    scenario_summary_csv: 'Scenario quantities · CSV',
    scenario_summary_html: 'Scenario comparison · HTML',
    parcel_inventory: 'Parcel priorities · JSON',
    parcel_csv: 'Parcel priorities · CSV',
    parcel_geopackage: 'Parcel priorities · GeoPackage',
    manifest: 'Delivery manifest',
    package_index: 'Package inventory',
    display_scales: 'Map display scales',
    map_atlas: 'Map atlas · PDF',
    map_atlas_index: 'Map atlas index · JSON',
    map_atlas_csv: 'Map atlas index · CSV',
    combined_priority: 'Combined pollutant priority raster',
  };
  const textRole = value => String(value || '').replaceAll('_', ' ');
  const status = value => ({
    complete: 'Complete', received_snapshot: 'Received copy',
    running: 'Building', failed: 'Needs attention', queued: 'Queued',
    prepared: 'Prepared', interrupted: 'Interrupted',
  })[value] || textRole(value);
  const base = value => String(value || '').split('/').pop();
  const attrs = id => 'data-id="' + esc(id) + '"';
  const downloads = row => row._downloads || [];

  function ticket(row, descriptor) {
    if (!descriptor) return null;
    const matches = downloads(row).filter(file =>
      file.sha256 === descriptor.sha256 && file.bytes === descriptor.bytes);
    const filename = descriptor.filename || base(descriptor.path);
    return matches.find(file => file.filename === filename) || matches[0] || null;
  }

  function fileEntries(row, declared = []) {
    if (declared.length) return declared.flatMap(file =>
      (file.keys || []).filter(key => /^files\.(?:client_)?report(?:_|$)/.test(key)).map(key =>
        ({...file, role: key.slice(6), filename: base(file.path), relative_path: file.path})));
    return Object.entries(row.files || {}).flatMap(([role, descriptor]) => {
      const file = ticket(row, descriptor);
      return file ? [{...file, role, relative_path: descriptor.path}] : [];
    });
  }

  function download(file, title = 'Download') {
    if (!file) return '';
    const href = file.url + (file.url.includes('?') ? '&' : '?') + 'download=1';
    return '<a href="' + esc(href) + '" download>' + esc(title) + '</a>';
  }

  function openPDF(file, title = 'Open PDF') {
    return file && /\.pdf$/i.test(file.filename)
      ? '<a href="' + esc(file.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(title) + '</a>' : '';
  }

  function group(title, description, entries, used) {
    const files = entries.filter(file => !used.has(file.id));
    if (!files.length) return '';
    files.forEach(file => used.add(file.id));
    return section(title, description,
      '<div class="file-list">' + files.map(file =>
        '<div class="file-row"><div><strong>' +
        esc(labels[file.role] || textRole(file.role) || file.label || file.filename) +
        '</strong><small>' + esc(file.relative_path || file.filename) +
        ' · ' + bytes(file.bytes) + '</small></div><div class="inline-actions">' +
        openPDF(file) + download(file) + '</div></div>').join('') + '</div>');
  }

  function selectedRuns(row) {
    const selection = row.selection || {};
    const baseline = selection.baseline_run_id;
    const alternatives = selection.scenario_run_ids || selection.alternative_run_ids || [];
    const rows = baseline ? [['Baseline', baseline]] : [];
    alternatives.forEach((id, index) => rows.push(['Alternative ' + (index + 1), id]));
    return table(['Study case', 'Selected native run', ''], rows.map(([role, id]) =>
      '<tr><td>' + esc(role) + '</td><td>' + esc(runTitle(id)) +
      '</td><td>' + button('item', 'Open run',
      'data-kind="runs" ' + attrs(id), 'small') + '</td></tr>'));
  }

  function overview(data) {
    let html = pageHeader(
      'Maps and delivery',
      'Review the selected baseline and alternatives, read the client report, and download the complete study.',
      button('delivery-new', 'Build complete delivery', '', 'primary'));
    const rows = data.deliveries || [];
    html += rows.length ? section(
      'Saved deliveries',
      'Each delivery retains its selected study, map families, report and working files.',
      table(['Delivery', 'State', 'Study cases', 'Report / maps', ''], rows.map(row => {
        const selection = row.selection || {};
        const count = (selection.scenario_run_ids || selection.alternative_run_ids || []).length;
        const roles = reportRoles(row);
        const reports = roles.has('report_html') && (roles.has('report_data') || roles.has('report_model'))
          ? 'Scientific report included' : 'Report preparation available';
        return '<tr><td class="name-cell"><strong>' +
          esc(selection.title || 'Scientific delivery') + '</strong><small>' +
          esc(when(row.completed_at || row.created_at || row.updated_at)) +
          '</small></td><td>' + esc(status(row.state)) +
          '</td><td>' + esc(runTitle(selection.baseline_run_id)) +
          '<small>' + count + ' alternative' + (count === 1 ? '' : 's') +
          '</small></td><td>' + esc(reports) + '<small>' +
          number(Object.keys(row.maps || {}).length) +
          ' map PDFs</small></td><td class="actions-cell">' +
          button('item', 'Open delivery', 'data-kind="deliveries" ' + attrs(row.id), 'small') +
          (row.state === 'failed' ? button('delivery-resume', 'Continue', attrs(row.id), 'small') : '') +
          '</td></tr>';
      }))) : '<div class="empty"><h2>Prepare the complete study</h2><p>Choose the completed baseline and alternatives, supporting source editions, map settings and contact details.</p>' +
        button('delivery-new', 'Prepare delivery', '', 'primary') + '</div>';
    if (data.spatial_exports?.length) {
      html += section('Saved map packs',
        'Figures retain their selected review, source editions, extent, legend and annotations.',
        table(['Map pack', 'State', 'Paper / resolution', ''],
          data.spatial_exports.map(row =>
            '<tr><td class="name-cell"><strong>' + esc(row.title || 'Saved map pack') +
            '</strong><small>' + esc(when(row.created_at)) + '</small></td><td>' +
            esc(status(row.state)) + '</td><td>' +
            esc([row.selection?.paper?.toUpperCase() || '',
                 row.selection?.dpi ? row.selection.dpi + ' dpi' : ''].filter(Boolean).join(' · ')) +
            '</td><td>' + button('item', 'Open files',
              'data-kind="spatial_exports" ' + attrs(row.id), 'small') + '</td></tr>')));
    }
    return html;
  }

  function detail(row) {
    const entries = fileEntries(row), byRole = Object.fromEntries(entries.map(file => [file.role, file]));
    const used = new Set(), selection = row.selection || {};
    const hasReport = Boolean(byRole.report_html && (byRole.report_data || byRole.report_model));
    const savedEdition = row._delivery_view?.report_edition ??
      ((selection.client_report_edition || row.report_edition || '') + '|' +
       (selection.report_renderer_version || row.report_renderer_version || '') + '|' +
       (selection.client_companion_edition || row.client_companion_edition || ''));
    const olderEdition = row._current_report_edition && savedEdition !== row._current_report_edition;
    let html = '<div class="delivery-review"><div class="meta"><span>' +
      esc(status(row.state)) + '</span><span>' +
      Object.keys(row.maps || {}).length + ' map PDFs</span><span>' +
      (selection.scenario_run_ids || selection.alternative_run_ids || []).length + ' alternatives</span></div>';
    if (row.error) html += '<div class="notice error">' + esc(row.error.message) + '</div>';
    html += '<div class="delivery-actions">' +
      (hasReport ? button('delivery-report', 'Read scientific report', attrs(row.id), 'primary') : '') +
      (byRole.client_report_html && byRole.client_report_model ? button('delivery-client-report', 'Read client companion', attrs(row.id)) : '') +
      openPDF(byRole.report) + download(byRole.delivery_archive, 'Download complete delivery') + '</div>';
    if (row.state === 'received_snapshot') {
      html += '<p class="report-note">This received copy includes the saved report, maps, study choices and original working archive. Prepare the complete delivery ZIP from those retained choices.</p>' +
        button('delivery-report-refresh', 'Prepare complete copy', attrs(row.id), 'primary');
    } else if ((!hasReport || olderEdition) && row.state === 'complete') {
      html += '<p class="report-note">This saved delivery predates the current client-report format. Create the current report edition from the retained study choices.</p>' +
        button('delivery-report-refresh', 'Create current report edition', attrs(row.id), 'primary');
    }
    html += '<h3 class="scenario-heading">Selected study cases</h3>' + selectedRuns(row) +
      '<div class="delivery-actions">' +
      button('delivery-revise', 'Revise delivery choices', attrs(row.id)) + '</div>';
    html += group('Scientific report',
      'The PDF and HTML share the same saved quantities. Markdown supports editing; JSON carries the report values and provenance.',
      entries.filter(file => ['report', 'report_html', 'report_markdown', 'report_data', 'report_model'].includes(file.role)), used);
    html += group('Client companion',
      'The decision guide retains the same original quantities, scenario support and selected map context.',
      entries.filter(file => /^client_report(?:_|$)/.test(file.role)), used);
    html += group('Complete delivery and working project',
      'Use the complete delivery for the report, maps and GIS outputs. The working scientific project restores the source files, model choices and retained native runs.',
      entries.filter(file => ['delivery_archive', 'working_archive'].includes(file.role)), used);
    html += group('Scenario and parcel tables',
      'Quantities, paired changes and parcel priorities retain their original study and scenario identities.',
      entries.filter(file => /^(scenario_|parcel_)/.test(file.role)), used);

    const maps = Object.entries(row.maps || {});
    if (maps.length) {
      html += '<h3 class="scenario-heading">Map families</h3><div class="map-cards">';
      for (const [name, descriptor] of maps) {
        const family = mapFamilies.find(value => name === value || name.startsWith(value + '-'));
        const runId = family ? name.slice(family.length).replace(/^-/, '') : '';
        const file = ticket(row, descriptor);
        if (file) used.add(file.id);
        html += '<article class="map-card"><p class="map-index">' +
          (family ? 'MAP FAMILY ' + (mapFamilies.indexOf(family) + 1) : 'MAP') +
          '</p><h3>' + esc(mapTitles[family] || textRole(name)) + '</h3><p>' +
          esc(runId ? runTitle(runId) : 'Selected baseline and source context') +
          '</p><div class="inline-actions">' + openPDF(file) + download(file) +
          '</div></article>';
      }
      html += '</div>';
    }
    html += group('Map atlas and index',
      'The atlas connects the selected report and its mapped study cases.',
      entries.filter(file => /^map_atlas/.test(file.role)), used);
    html += group('GIS data and supporting files',
      'The native data, receiving-area files, map scales and metadata remain available with the study.',
      entries.filter(file => !used.has(file.id)), used);
    html += group('Additional retained files', '', downloads(row).filter(file => !used.has(file.id)), used);
    if (row.state === 'failed' || row.state === 'interrupted') {
      html += '<div class="delivery-actions">' +
        button('delivery-resume', 'Continue delivery', attrs(row.id), 'primary') + '</div>';
    }
    html += '<details class="technical"><summary>Original record, selection and provenance</summary><pre class="json-view">' +
      esc(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_downloads')), null, 2)) +
      '</pre></details></div>';
    return html;
  }

  function continuation(row, declared = []) {
    const entries = fileEntries(row, declared), byRole = Object.fromEntries(entries.map(file => [file.role, file]));
    const selection = row.selection || {};
    const hasReport = Boolean(byRole.report_html && (byRole.report_data || byRole.report_model));
    const savedEdition = row._delivery_view?.report_edition ??
      ((selection.client_report_edition || row.report_edition || '') + '|' +
       (selection.report_renderer_version || row.report_renderer_version || '') + '|' +
       (selection.client_companion_edition || row.client_companion_edition || ''));
    const olderEdition = row._current_report_edition && savedEdition !== row._current_report_edition;
    let html = '<section class="delivery-review"><h3 class="subheading">Client companion and delivery choices</h3><div class="delivery-actions">';
    if (byRole.client_report_html && byRole.client_report_model)
      html += button('delivery-client-report', 'Read client companion', attrs(row.id), 'primary');
    html += openPDF(byRole.client_report, 'Open companion PDF') +
      download(byRole.client_report_markdown, 'Download editable companion') +
      button('delivery-revise', 'Revise delivery choices', attrs(row.id)) + '</div>';
    if (row.state === 'received_snapshot') {
      html += '<p class="report-note">The received reports, selected study and original working archive are available here. Build the complete delivery ZIP from these retained choices.</p>' +
        button('delivery-report-refresh', 'Prepare complete copy', attrs(row.id), 'primary');
    } else if ((!hasReport || olderEdition) && row.state === 'complete') {
      html += '<p class="report-note">Create the current report edition from this saved study while retaining its original release.</p>' +
        button('delivery-report-refresh', 'Create current report edition', attrs(row.id), 'primary');
    }
    if (row.state === 'interrupted')
      html += button('delivery-resume', 'Continue delivery', attrs(row.id), 'primary');
    return html + '</section>';
  }

  async function preview(id, report = 'scientific') {
    const workspace = ctx.getWorkspace(), request = ctx.beginDetailRequest();
    const info = await ctx.api(ctx.endpoint('/api/deliveries/report', {id, report}));
    if (workspace !== ctx.getWorkspace() || !ctx.isDetailRequest(request)) return;
    if (!info.preview_url) throw Error('Create the current report edition before opening the report.');
    const files = Object.values(info.files || {});
    const selected = info.selected_files || info.files || {};
    const pdf = selected.report;
    const body = '<div class="delivery-review"><div class="delivery-actions">' +
      button('item', 'Back to delivery', 'data-kind="deliveries" ' + attrs(id)) +
      openPDF(pdf) + download(pdf, 'Download PDF') +
      download(selected.report_markdown, 'Download editable report') +
      '</div><iframe class="delivery-report-frame" title="Retained report" ' +
      'sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" ' +
      'referrerpolicy="no-referrer" src="' + esc(info.preview_url) + '"></iframe></div>';
    ctx.detail(info.title || 'Client report', body, {kind: 'delivery-report', id, state: info.state});
    ctx.setDetailFiles(files);
  }

  async function rebuild(id) {
    const workspace = ctx.getWorkspace();
    const row = await ctx.api(ctx.endpoint('/api/item', {kind: 'deliveries', id}));
    if (workspace !== ctx.getWorkspace()) return;
    const info = await ctx.api(ctx.endpoint('/api/deliveries/report', {id}));
    if (workspace !== ctx.getWorkspace()) return;
    const key = 'upstate-delivery-report:' + workspace + ':' + id + ':' + info.current_report_edition;
    let request;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) request = JSON.parse(saved);
    } catch {
      request = null;
    }
    if (!request || request.workspace !== workspace || request.action !== 'delivery.build' ||
        JSON.stringify(request.payload) !== JSON.stringify(row.selection)) {
      request = {workspace, action: 'delivery.build', payload: row.selection, operation_id: crypto.randomUUID()};
      sessionStorage.setItem(key, JSON.stringify(request));
    }
    const task = await ctx.api('/api/actions', {method: 'POST', body: request});
    if (workspace !== ctx.getWorkspace()) return;
    await ctx.refresh({force: true});
    await ctx.showTask(task.id);
  }

  async function handle(action, id) {
    if (action === 'delivery-report') return preview(id);
    if (action === 'delivery-client-report') return preview(id, 'client');
    if (action === 'delivery-report-refresh') return rebuild(id);
    if (action === 'delivery-revise') return ctx.revise(id);
    throw Error('Unknown delivery report action.');
  }

  return {overview, detail, continuation, handle};
}
