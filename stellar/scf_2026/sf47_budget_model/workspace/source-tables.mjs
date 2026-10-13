// MIT. Source-table authoring on the original private planning listener.
import {
  ROLES, createPlanningBook, importPlanningBook, retainPlanningBook, serializePlanningBook,
  planningBookFromNative, addPlanningTable, addReviewedPlanningDocument, receivePlanningEdition,
  retainPlanningTableReview, sourceTableRows, sourceEditionComparison, rebasePlanningBook,
  requireWorkingBaseline, preparePlanningImport, completeNativePreview, acceptPlanningPreview,
  planningRoleCsv, tableImportGuide, retainPlanningWorkbookSource, receivePlanningWorkbook,
  selectPlanningWorkbook, selectPlanningSourceEdition,
} from './source-tables-core.mjs';
import {initialMapping, TYPES, EMPTY_POLICIES, importProject}
  from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';

import {createPlanningWorkbookIntake, planningWorkbookRows} from './source-workbooks.mjs';
import {createPlanningWorkbookExport} from './source-workbook-export.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const $ = (name, text, className) => {
  const element = document.createElement(name);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const money = value => {
  if (value === null || value === undefined || value === '') return 'Not entered';
  const [whole, fraction = ''] = String(value).split('.');
  return '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction.padEnd(2,'0') + ' USD';
};

const sourceDate = value => {
  if (value === null || value === undefined || value === '') return 'Date not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', {
    year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short',
  }) : 'Date unavailable';
};
const fileSize = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Size unavailable';
  if (value < 1024) return value.toLocaleString('en-US') + (value === 1 ? ' byte' : ' bytes');
  const units = ['KiB','MiB','GiB'], index = Math.min(2, Math.floor(Math.log(value) / Math.log(1024)) - 1);
  return (value / Math.pow(1024,index + 1)).toLocaleString('en-US',{maximumFractionDigits:2}) + ' ' + units[index];
};
const sourceValue = value => value === null || value === '' ? 'Empty' :
  value === undefined ? 'Not provided' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
const fieldNames = {
  id:'Identifier', costId:'Work package', contributorId:'Contributor', weeklyHours:'Weekly capacity (hours)',
  estimated_hours:'Estimated hours', assumed_hourly_rate_usd:'Hourly rate (USD)', amount_usd:'Amount (USD)',
  award_request_usd:'Requested award (USD)', scenario_name:'Scenario', project_end_day:'Project end day',
  start_day:'Start day', end_day:'End day', remaining_work:'Work to complete', measurable_proof:'Completion assessment',
  pricing_mode:'Pricing method', review_and_payment_lag_days:'Review and payment delay (days)',
  submit_day:'Submission day', capitalUsd:'Available capital (USD)', capitalNote:'Capital source',
  calendarStart:'Calendar start', payments:'Payment timing', lagComparisons:'Payment delay comparisons',
};
const fieldLabel = value => fieldNames[value] || String(value).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
function readableValue(value) {
  if (value === null || value === undefined) return $('span','Not present','pt-help');
  if (typeof value !== 'object') return $('span',sourceValue(value));
  if (Array.isArray(value)) {
    if (!value.length) return $('span','No entries','pt-help');
    const group=$('div'); let page=0;
    const renderPage=()=>{
      const start=page*40, pages=Math.ceil(value.length/40), previous=$('button','Previous entries'), next=$('button','Next entries');
      previous.type=next.type='button'; previous.disabled=page===0; next.disabled=page+1>=pages;
      previous.addEventListener('click',()=>{page--;renderPage();}); next.addEventListener('click',()=>{page++;renderPage();});
      const position=$('span','Entries ' + (start+1) + '–' + Math.min(start+40,value.length) + ' of ' + value.length);
      position.setAttribute('aria-live','polite');
      const controls=$('div',undefined,'pt-actions'); controls.append(previous,position,next);
      group.replaceChildren(table(['Entry','Value'],value.slice(start,start+40).map((item,index)=>[start+index+1,readableValue(item)])));
      if(pages>1)group.append(controls);
    };
    renderPage(); return group;
  }
  const entries=Object.entries(value);
  if (!entries.length) return $('span','No fields','pt-help');
  return table(['Field','Value'],entries.map(([key,item])=>{
    if(key==='calendarStart' && typeof item==='string' && /^\d{4}-\d{2}-\d{2}$/.test(item)) {
      const [year,month,day]=item.split('-').map(Number), date=new Date(year,month-1,day);
      return [fieldLabel(key),date.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})];
    }
    if(key.endsWith('Usd') || key.endsWith('_usd')) return [fieldLabel(key),money(item)];
    return [fieldLabel(key),readableValue(item)];
  }));
}
function changeLabel(change) {
  let values;
  try { const parsed=JSON.parse(change.key); values=Array.isArray(parsed)?parsed:[parsed]; }
  catch { values=[change.key]; }
  const kind={packages:'Work package',milestones:'Milestone',contributors:'Contributor',assignments:'Assignment',
    settings:'Setting','payment settings':'Payment setting'}[change.kind] || fieldLabel(change.kind);
  const action={add:'Add',remove:'Remove',change:'Update'}[change.action] || fieldLabel(change.action);
  return action + ' · ' + kind + ' · ' + values.map(value=>change.kind==='settings'?fieldLabel(value):sourceValue(value)).join(' / ');
}

const download = (value, filename, type = 'application/json') => {
  const blob = value instanceof Blob ? value : new Blob([value], {type});
  const url = URL.createObjectURL(blob), a = $('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function table(headers, rows) {
  const wrapper = $('div', undefined, 'pt-scroll'), element = $('table'), head = $('thead'), hr = $('tr'), body = $('tbody');
  for (const value of headers) hr.append($('th', value));
  head.append(hr);
  for (const values of rows) {
    const tr = $('tr');
    for (const value of values) { const td = $('td'); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? ''))); tr.append(td); }
    body.append(tr);
  }
  element.append(head, body); wrapper.append(element); return wrapper;
}
function details(label, ...children) { const result = $('details'); result.append($('summary', label), ...children); return result; }

export function mountPlanningSourceTables(context) {
  const root = $('section', undefined, 'planning-source-tables');
  context.container.replaceChildren(root);
  if (!document.querySelector('link[data-planning-source-tables]')) {
    const stylesheet = $('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/source-tables.css';
    stylesheet.dataset.planningSourceTables = 'true'; document.head.append(stylesheet);
  }
  let book, role = 'packages', disposed = false, hostBusy = false, preview = null;
  let rowPage = 0, changePage = 0, projectChoice = null;
  const PAGE = 40;
  const alive = () => !disposed && root.isConnected;
  const status = (message, error = false) => { if (alive()) context.inform(message, error); };
  const store = (next, {redraw = false, invalidate = true} = {}) => {
    book = next;
    context.storeBook(retainPlanningBook(book));
    const hadPreview = Boolean(preview);
    if (invalidate) preview = null;
    if (redraw || invalidate && hadPreview) render();
  };
  const work = action => context.run(async () => {
    if (!alive()) return;
    await action();
  });
  const button = (label, action, className) => {
    const element = $('button', label, className); element.type = 'button';
    element.addEventListener('click', () => work(action)); return element;
  };
  const field = (label, value, change, {area = false, type = 'text', maximum = 12000} = {}) => {
    const wrap = $('label', undefined, 'pt-field'), title = $('span', label), input = $(area ? 'textarea' : 'input');
    if (!area) input.type = type;
    input.value = value ?? ''; input.maxLength = maximum;
    input.addEventListener('change', () => {
      try { change(input.value); } catch (error) { status(error.message, true); }
    });
    wrap.append(title, input); return wrap;
  };
  const select = (label, value, choices, change) => {
    const wrap = $('label', undefined, 'pt-field'), input = $('select');
    wrap.append($('span', label), input);
    for (const [key, title] of choices) { const option = $('option', title); option.value = key; option.selected = String(value) === String(key); input.append(option); }
    input.addEventListener('change', () => { try { change(input.value); } catch (error) { status(error.message, true); } });
    return wrap;
  };
  const checkbox = (label, value, change) => {
    const wrap = $('label', undefined, 'pt-check'), input = $('input'); input.type = 'checkbox'; input.checked = !!value;
    input.addEventListener('change', () => { try { change(input.checked); } catch (error) { status(error.message, true); } });
    wrap.append(input, $('span', label)); return wrap;
  };
  function fileChooser(accept, callback) {
    const input = $('input'); input.type = 'file'; input.accept = accept; input.hidden = true; root.append(input);
    input.addEventListener('change', () => {
      const file = input.files[0]; input.remove(); if (file) work(() => callback(file));
    }, {once: true});
    input.click();
  }
  function currentBinding() { return book.bindings.find(x => x.role === role); }
  function currentDocument() { const binding = currentBinding(); return binding && book.project.documents.find(x => x.id === binding.documentId); }
  function selectedSource() { const doc = currentDocument(); return doc?.editions.find(x => x.id === doc.selectedEditionId); }
  function editBook(action, redraw = false) { const next = copy(book); action(next); store(next, {redraw}); }
  function editBinding(action, redraw = false) { editBook(next => action(next.bindings.find(x => x.role === role)), redraw); }
  function section(title, text) {
    const node = $('section', undefined, 'pt-panel'); node.append($('h3', title)); if (text) node.append($('p', text, 'pt-help')); return node;
  }
  const workbookIntake = createPlanningWorkbookIntake({
    getBook:()=>book, getRole:()=>role, roleLabel:()=>ROLES[role].label, getDocument:currentDocument,
    retainSource:retainPlanningWorkbookSource, receive:receivePlanningWorkbook, chooseSelection:selectPlanningWorkbook,
    api:context.api, alive, redraw:render, store, status, work, button, field, select, checkbox,
    section, table, details, download, fileChooser,
  });
  const workbookExport = createPlanningWorkbookExport({
    getPlan:context.getPlan, getBook:()=>book, api:context.api, alive, redraw:render,
    store, status, button, field, select, checkbox, section, table, details, download, fileChooser,
  });
  function rowsPanel(result) {
    const panel = section('Complete source rows', result.rows.length + ' data rows. Included rows become planning inputs. Every excluded row retains its original position and your reason.');
    const start = rowPage * PAGE, shown = result.rows.slice(start, start + PAGE);
    const sourceFields = result.fields.map(x => x.name);
    const workbookRows = planningWorkbookRows(book, result.doc.id, result.edition.id);
    const rows = shown.map((row, offset) => {
      const position = result.records[start + offset], excluded = result.binding.excludedRows.find(x => x.editionId === result.edition.id && x.record === position.record);
      const decision = $('div', undefined, 'pt-row-decision');
      decision.append(checkbox('Include', !excluded, value => editBinding(binding => {
        binding.excludedRows = binding.excludedRows.filter(x => !(x.editionId === result.edition.id && x.record === position.record));
        if (!value) binding.excludedRows.push({editionId: result.edition.id, record: position.record, note: ''});
      }, true)));
      if (excluded) decision.append(field('Reason', excluded.note, value => editBinding(binding => {
        binding.excludedRows.find(x => x.editionId === result.edition.id && x.record === position.record).note = value;
      }), {area: true, maximum: 2000}));
      const workbook = workbookRows?.get(position.record);
      return [decision, 'CSV record ' + position.record + ' · line ' + position.line +
        (workbook ? ' · ' + workbook.sheet + ' · worksheet row ' + workbook.row : ''),
        ...sourceFields.map(key => Object.hasOwn(row, key) ? sourceValue(row[key]) : 'Not provided')];
    });
    panel.append(table(['Use','Original source position', ...sourceFields], rows));
    const pages = Math.max(1, Math.ceil(result.rows.length / PAGE)), nav = $('div', undefined, 'pt-actions');
    const previous = button('Previous rows', () => { rowPage--; render(); }); previous.disabled = rowPage <= 0;
    const next = button('Next rows', () => { rowPage++; render(); }); next.disabled = rowPage + 1 >= pages;
    previous.dataset.fixedDisabled = String(previous.disabled); next.dataset.fixedDisabled = String(next.disabled);
    nav.append(previous, $('span', 'Rows ' + (result.rows.length ? start + 1 : 0) + '–' + Math.min(start + PAGE, result.rows.length) + ' of ' + result.rows.length), next);
    panel.append(nav); return panel;
  }
  function parserPanel(doc) {
    const panel = section('Source parsing and types', 'Keep the delimiter and header choice explicit. Text and decimal-text preserve their complete source spelling. Review the mapping before preparing the native plan.');
    const parse = $('div', undefined, 'pt-grid');
    let delimiter = doc.mapping.delimiter, header = doc.mapping.header, skip = doc.mapping.skipEmptyRecords;
    parse.append(select('Delimiter', delimiter, [[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']], value => { delimiter = value; }),
      checkbox('First record contains column headers', header, value => { header = value; }),
      checkbox('Skip completely empty source records', skip, value => { skip = value; }));
    parse.append(button('Apply parsing choices', () => {
      const source = selectedSource();
      editBook(next => { const d = next.project.documents.find(x => x.id === doc.id);
        d.mapping = initialMapping(source.sourceText, {delimiter, header, skipEmptyRecords: skip});
      }, true); status('Applied parsing choices. Review the source-column and planning-field mappings.');
    }));
    panel.append(parse);
    const rows = doc.mapping.columns.map((column, index) => {
      const change = (property, value, redraw = false) => editBook(next => {
        next.project.documents.find(x => x.id === doc.id).mapping.columns[index][property] = value;
      }, redraw);
      return [
        checkbox('Include', column.include, value => editBook(next => {
          const d = next.project.documents.find(x => x.id === doc.id); d.mapping.columns[index].include = value;
          if (!value) d.mapping.keyColumns = d.mapping.keyColumns.filter(x => x !== column.index);
        }, true)),
        column.sourceName,
        field('Output field', column.name, value => change('name', value), {maximum: 128}),
        select('Type', column.type, TYPES.map(x => [x,x]), value => change('type',value)),
        select('Empty cells', column.empty, EMPTY_POLICIES.map(x => [x,x]), value => change('empty',value)),
        checkbox('Trim whitespace', column.trim, value => change('trim',value)),
        checkbox('Record key', doc.mapping.keyColumns.includes(column.index), value => editBook(next => {
          const d = next.project.documents.find(x => x.id === doc.id);
          d.mapping.keyColumns = d.mapping.keyColumns.filter(x => x !== column.index);
          if (value) { d.mapping.columns[index].include = true; d.mapping.keyColumns.push(column.index); }
        })),
        field('Unit', column.unit, value => change('unit',value), {maximum: 256}),
      ];
    });
    panel.append(table(['Use','Source column','Output field','Type','Empty cell','Whitespace','Key','Unit'], rows));
    return details('Source parsing and column types', panel);
  }
  function mappingPanel(binding, doc) {
    const panel = section('Map the planning fields', 'Choose an exact source column, an explicit constant, or the matching existing native value. Member maps are complete JSON objects, such as {"source code":"native package ID"}. An empty member-map field uses the source value directly.');
    const columns = doc.mapping.columns.filter(x => x.include);
    panel.append(select('Collection update', binding.mode, [['merge','Merge by identity and retain other native rows'],['replace','Replace this native collection with the included source rows']], value => editBinding(b => { b.mode = value; })));
    const rows = ROLES[role].fields.map(([name, title]) => {
      const rule = binding.fields[name] || {source: 'existing'};
      const selected = rule.source === 'column' ? 'column:' + rule.column : rule.source;
      const choice = select(title, selected, [['existing','Matching existing value'],['constant','Explicit constant'],...columns.map(x => ['column:' + x.name,x.name])], value => {
        editBinding(b => {
          const previous = b.fields[name] || {};
          if (value.startsWith('column:')) b.fields[name] = {source: 'column', column: value.slice(7), ...(previous.members ? {members: previous.members} : {})};
          else if (value === 'constant') b.fields[name] = {source: 'constant', value: previous.value ?? ''};
          else b.fields[name] = {source: 'existing'};
        }, true);
      });
      const extra = $('div');
      if (rule.source === 'constant') extra.append(field('Constant', rule.value ?? '', value => editBinding(b => { b.fields[name].value = value; }), {area: name === 'remaining_work' || name === 'measurable_proof' || name === 'deliverable'}));
      if (rule.source === 'column') extra.append(field('Exact member map · optional JSON', rule.members ? JSON.stringify(rule.members, null, 2) : '', value => {
        let members;
        if (value.trim()) {
          members = JSON.parse(value);
          if (!members || Array.isArray(members) || typeof members !== 'object' || Object.values(members).some(x => typeof x !== 'string'))
            throw new Error('Use a JSON object mapping each source value to an exact target string.');
        }
        editBinding(b => { if (members) b.fields[name].members = members; else delete b.fields[name].members; });
      }, {area: true}));
      return [title, choice, extra];
    });
    panel.append(table(['Native field','Source choice','Constant or member mapping'], rows));
    return panel;
  }
  function comparisonPanel(value) {
    if (!value) return null;
    const panel = section('Source edition comparison', 'This comparison uses the retained table reviews and their explicit record keys.');
    panel.append($('p', value.summary.added + ' added · ' + value.summary.removed + ' removed · ' + value.summary.changed + ' changed · ' + value.summary.unchanged + ' unchanged'));
    panel.append(details('Read every source change', $('pre', JSON.stringify(value.changes, null, 2))),
      details('Read source-column changes', $('pre', JSON.stringify(value.columns, null, 2))));
    return panel;
  }
  function sourcePanel() {
    const binding = currentBinding(), doc = currentDocument();
    if (!binding) {
      const panel = section('Add ' + ROLES[role].label.toLowerCase(), 'Choose a complete UTF-8 CSV or TSV. You can also receive one already-reviewed document from the Source Tables project.');
      let delimiter = ',', header = true;
      panel.append(select('Delimiter', delimiter, [[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']], value => { delimiter = value; }),
        checkbox('First record contains headers', header, value => { header = value; }));
      const actions = $('div', undefined, 'pt-actions');
      actions.append(button('Open CSV or TSV', () => fileChooser('.csv,.tsv,.txt', async file => {
        const sourceText = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await file.arrayBuffer());
        const next = await addPlanningTable(book, {role, filename: file.name, sourceText, delimiter, header});
        if (!alive()) return; rowPage = 0; store(next, {redraw: true}); status('Retained the complete source table. Map its fields and review the rows.');
      })));
      actions.append(button('Open reviewed Source Tables project', () => fileChooser('.json', async file => {
        projectChoice = await importProject(await file.text()); if (alive()) render();
      })));
      panel.append(actions);
      if (projectChoice) {
        let documentId = projectChoice.documents[0]?.id;
        panel.append(select('Document from received project', documentId, projectChoice.documents.map(x => [x.id,x.label]), value => { documentId = value; }),
          button('Receive this complete source document', async () => {
            const next = await addReviewedPlanningDocument(book, {role, project: projectChoice, documentId});
            if (!alive()) return; projectChoice = null; rowPage = 0; store(next, {redraw: true});
          }));
      }
      root.append(panel); return;
    }
    const panel = section(ROLES[role].label + ' source editions', 'Every received edition and reviewed mapping stays with this plan. A new source file keeps the earlier rows and mapping available for comparison.');
    panel.append(select('Selected source edition', doc.selectedEditionId,
      doc.editions.map(x => [x.id, x.filename + ' · ' + sourceDate(x.receivedAt) + ' · ' + fileSize(x.bytes)]), value => {
        store(selectPlanningSourceEdition(book, role, value), {redraw:true});
      }));
    const actions = $('div', undefined, 'pt-actions');
    actions.append(button('Receive next source edition', () => fileChooser('.csv,.tsv,.txt', async file => {
      const sourceText = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(await file.arrayBuffer());
      const next = await receivePlanningEdition(book, role, {filename: file.name, sourceText});
      if (!alive()) return; rowPage = 0; store(next, {redraw: true}); status('Retained the new source edition. Review its rows and complete mapping.');
    })), button('Download original source', () => {
      const source = selectedSource(); download(source.sourceText, source.filename, 'text/plain;charset=utf-8');
    }), button('Review current table mapping', async () => {
      const next = await retainPlanningTableReview(book, role);
      if (!alive()) return; store(next, {redraw: true}); status('Retained the complete typed source review.');
    }));
    panel.append(actions, details('Source identity and saved reviews',
      $('pre', JSON.stringify({selectedEditionId: doc.selectedEditionId, selectedReviewId: doc.selectedReviewId,
        editions: doc.editions.map(({sourceText, ...metadata}) => metadata),
        reviews: doc.reviews.map(({dataText, mapping, ...metadata}) => metadata)}, null, 2))));
    root.append(panel, parserPanel(doc), mappingPanel(binding, doc));
    try { root.append(rowsPanel(sourceTableRows(book, role))); }
    catch (error) {
      const issue = section('Review the source mapping', error.message);
      if (error.issues) issue.append($('pre', JSON.stringify(error.issues, null, 2)));
      root.append(issue);
    }
    try { const comparison = comparisonPanel(sourceEditionComparison(book, role)); if (comparison) root.append(comparison); }
    catch (error) { status(error.message, true); }
  }
  function settingsPanel() {
    const panel = section('Plan settings', 'Set the scenario, requested award and completion day. These values are calculated together with the mapped work and staffing.');
    const grid = $('div', undefined, 'pt-grid');
    grid.append(field('Scenario description', book.settings.scenarioName, value => editBook(next => { next.settings.scenarioName = value; }), {maximum: 500}),
      field('Requested award · USD', book.settings.awardRequestUsd, value => editBook(next => { next.settings.awardRequestUsd = value; })),
      field('Project end day', book.settings.projectEndDay, value => editBook(next => { next.settings.projectEndDay = value; })));
    panel.append(grid, select('Assignments and payment settings of removed inputs', book.orphanPolicy,
      [['preserve','Preserve existing dependent records; resolve affected inputs before applying'],
       ['remove-unreferenced','Remove dependent records whose package or contributor is removed']],
      value => editBook(next => { next.orphanPolicy = value; })));
    root.append(panel);
  }
  function nativePreviewPanel() {
    const panel = section('Calculate and apply the complete plan', 'Calculate the mapped work, prices, work dates, staffing and payment schedule. Review the result and its changes before applying it to the working plan.');
    panel.append(button('Calculate native preview', async () => {
      requireWorkingBaseline(book, context.getPlan(), context.getDraft());
      const preparation = await preparePlanningImport(book);
      const native = await context.api('/api/plans/' + preparation.planId + '/estimate', {
        expectedRevision: preparation.expectedRevision, scenarioPatch: preparation.scenarioPatch, planning: preparation.planning,
      });
      const completed = await completeNativePreview(preparation, native);
      if (!alive()) return; preview = completed; changePage = 0; render(); status('Calculated the complete table import with the original planner. Review the full result below.');
    }), $('p', 'Current comparison: ' + book.baseline.name + ' · saved revision ' + book.baseline.revision, 'pt-help'));
    if (!preview) {
      if (book.appliedReviewId) panel.append($('p', 'The reviewed table changes are in the native working draft. Save a named revision with the existing Save revision control. The native planning ZIP then carries the complete editable source project.'));
      root.append(panel); return;
    }
    const {scenario, planning, report} = preview.native;
    panel.append($('h4', 'Complete native result'),
      $('p', money(scenario.award_request_usd) + ' requested · ' + report.capacity.totalHours + ' estimated hours · ' +
        scenario.future_costs.length + ' work packages · completion by modeled day ' + scenario.project_end_day),
      $('p', 'Peak modeled cash requirement: ' + money(report.cash.peakCashGapUsd) + ' on day ' + report.cash.peakCashGapDay + '.'));
    panel.append(table(['Package','Complete remaining work','Price','Hours / rate','Work days','Completion assessment'],
      scenario.future_costs.map(row => [row.id, row.remaining_work, money(row.amount_usd),
        sourceValue(row.estimated_hours) + (planning.pricing[row.id] === 'hours' ? ' hours × ' + money(row.assumed_hourly_rate_usd) : ' hours · fixed price'),
        row.start_day + '–' + row.end_day, row.measurable_proof])));
    panel.append(table(['Tranche','Submission day','Complete deliverable','Completion assessment'],
      scenario.milestones.map(row => [row.tranche, row.submit_day, row.deliverable, row.measurable_proof])));
    panel.append(table(['Conditional payment','USD','Modeled receipt day','Release condition'],
      report.originalModel.payouts.map(row => [row.tranche === 0 ? 'Initial allocation' : 'After tranche ' + row.tranche,
        money(row.usd), row.hypothetical_paid_day ?? 'Not scheduled', row.release_condition])));
    const contributorName = id => planning.contributors?.find(row=>row.id===id)?.name || id;
    panel.append(details('Contributor capacity and assignments',
      (planning.contributors || []).length ? table(['Contributor','Weekly capacity (hours)','Capacity source'],
        planning.contributors.map(row=>[row.name,sourceValue(row.weeklyHours),sourceValue(row.note)])) : $('p','No contributor capacity entered.'),
      (planning.assignments || []).length ? table(['Work package','Contributor','Assigned hours'],
        planning.assignments.map(row=>[row.costId,contributorName(row.contributorId),sourceValue(row.hours)])) : $('p','No work assignments entered.'),
      details('Complete capacity calculation',readableValue(report.capacity))),
      details('Payment timing and capital',
        readableValue({calendarStart:planning.calendarStart,capitalUsd:planning.capitalUsd,capitalNote:planning.capitalNote,
          payments:planning.payments,lagComparisons:report.lagComparisons})));
    const changes = preview.review.changes, start = changePage * PAGE;
    const review = section('Changes from the saved plan', changes.length + ' complete row or setting changes. The before and after values below use the native calculated result.');
    for (const change of changes.slice(start, start + PAGE)) {
      const entry = details(changeLabel(change),
        table(['Before','After'], [[readableValue(change.before),readableValue(change.after)]]));
      review.append(entry);
    }
    if (changes.length > PAGE) {
      const actions = $('div', undefined, 'pt-actions'), previous = button('Previous changes', () => { changePage--; render(); }),
        next = button('Next changes', () => { changePage++; render(); });
      previous.disabled = changePage === 0; next.disabled = start + PAGE >= changes.length;
      previous.dataset.fixedDisabled = String(previous.disabled); next.dataset.fixedDisabled = String(next.disabled);
      actions.append(previous, $('span', 'Changes ' + (start + 1) + '–' + Math.min(start + PAGE, changes.length) + ' of ' + changes.length), next);
      review.append(actions);
    }
    panel.append(review, details('Every included and excluded original source row', $('pre', JSON.stringify(preview.review.sourceRows, null, 2))));
    let reviewed = false, note = '';
    panel.append(field('Source-import review note', note, value => { note = value; }, {area: true, maximum: 4000}),
      checkbox('I have reviewed the complete native result and these exact changes.', reviewed, value => { reviewed = value; }));
    const actions = $('div', undefined, 'pt-actions');
    actions.append(button('Apply reviewed changes to working plan', async () => {
      if (!reviewed) throw new Error('Review the complete native result before applying it.');
      requireWorkingBaseline(book, context.getPlan(), context.getDraft());
      const draft = await acceptPlanningPreview(preview, book, {note});
      if (!alive()) return;
      book = await importPlanningBook(draft.planning.sourceTables);
      context.applyDraft(draft); preview = null; render();
      status('Applied the complete reviewed table import. Save a named native revision to retain its plan and source materials.');
    }, 'primary'), button('Download complete native preview', () => download(JSON.stringify(preview, null, 2) + '\n', 'planning-source-preview.json')));
    panel.append(actions); root.append(panel);
  }
  function render() {
    if (!alive() || !book) return;
    root.replaceChildren();
    const header = $('div', undefined, 'pt-heading');
    header.append($('h2', 'Source tables'), $('p', 'Author the plan from complete work-package, milestone and capacity tables. Retain their source editions, saved mappings and reviewed native changes.'));
    root.append(header);
    const actions = $('div', undefined, 'pt-actions');
    if (!book.bindings.length) actions.append(button('Create source tables from saved plan', async () => {
      const next = await planningBookFromNative(context.getPlan());
      if (!alive()) return; role = next.bindings[0]?.role || 'packages'; store(next, {redraw: true});
      status('Retained the saved plan as complete editable source tables. Receive a revised table or change its explicit mapping.');
    }));
    actions.append(button('Open source project', () => fileChooser('.json', async file => {
      const next = await importPlanningBook(await file.text());
      if (!alive()) return;
      if (book.bindings.length && JSON.stringify(next) !== JSON.stringify(book)) download(serializePlanningBook(book), 'previous-planning-source-tables.json');
      role = next.bindings[0]?.role || 'packages'; rowPage = 0; store(next, {redraw: true});
      status('Opened the complete source project. Review its baseline before preparing changes.');
    })), button('Download source project', () => download(serializePlanningBook(book), 'planning-source-tables.json')),
      button('Download operating guide', () => download(tableImportGuide(book), 'PLANNING_SOURCE_TABLES.md', 'text/markdown;charset=utf-8')),
      button('Rebase on saved plan', () => {
        // Baseline movement is explicit; all source documents and prior reviews remain.
        const next = rebasePlanningBook(book, context.getPlan()); store(next, {redraw: true});
        status('Selected the current saved native revision as the comparison baseline. Source editions, mappings and prior reviews remain.');
      }));
    root.append(actions);
    const choices = $('div', undefined, 'pt-actions');
    for (const [name, def] of Object.entries(ROLES)) {
      const choose = button(def.label + (book.bindings.some(x => x.role === name) ? ' · source retained' : ''), () => { role = name; rowPage = 0; projectChoice = null; render(); });
      if (name === role) choose.setAttribute('aria-current','page'); choices.append(choose);
    }
    root.append(choices);
    root.append(workbookExport.render(),workbookIntake.render());
    sourcePanel(); settingsPanel(); nativePreviewPanel();
    if (book.reviews.length) {
      const reviews=book.reviews.map(review=>details(sourceDate(review.reviewedAt || review.preparedAt) + ' · ' +
        review.changes.length + ' changes', $('p',review.note || 'Review note not entered.'),
        $('p','Compared with saved revision ' + review.base.revision + '.'),
        ...review.changes.map(change=>details(changeLabel(change),
          table(['Before','After'],[[readableValue(change.before),readableValue(change.after)]]))),
        details('Source and calculation details',$('pre',JSON.stringify(review,null,2)))));
      root.append(details('Saved source-import reviews',...reviews));
    }
    const link = $('a','Full operating guide'); link.href = '/source-tables-guide.md'; link.target = '_blank'; link.rel = 'noopener';
    root.append(link);
    setHostBusy(hostBusy);
  }
  function setHostBusy(value) {
    hostBusy = value;
    for (const control of root.querySelectorAll('button,input,select,textarea'))
      control.disabled = value || control.dataset.fixedDisabled === 'true';
    root.setAttribute('aria-busy', String(value));
  }
  const ready = (async () => {
    const retained = context.getDraft().planning.sourceTables;
    book = retained ? await importPlanningBook(retained) : createPlanningBook(context.getPlan());
    if (!alive()) return;
    role = book.bindings[0]?.role || 'packages'; render();
  })();
  return {root, ready, setHostBusy, dispose() { disposed = true; preview = null; projectChoice = null; workbookIntake.dispose(); workbookExport.dispose(); }};
}
