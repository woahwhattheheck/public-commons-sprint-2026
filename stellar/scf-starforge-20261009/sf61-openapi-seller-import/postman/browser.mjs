// MIT. A collection intake panel in the original authenticated merchant console.
const SCHEMA = 'stellar-forge.postman-source.v1';
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
function field(title, value = '', type = 'text') {
  const label = make('label', title), input = make(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = value; label.append(input); return {label, input};
}
function select(title, choices, value) {
  const label = make('label', title), input = make('select');
  for (const [key, text] of choices) {const option = make('option', text); option.value = key; input.append(option);}
  input.value = value; label.append(input); return {label, input};
}
const stringify = value => value === undefined ? '' : JSON.stringify(value, null, 2);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(canonicalValue(value));
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}
function retainedPacket(text) {
  try {
    const value = JSON.parse(text);
    return value?.schema === SCHEMA && plain(value.hashes) && plain(value.decisions) &&
      Array.isArray(value.decisions.requests) ? value : null;
  } catch { return null; }
}
function sourceDecision(value) {
  if (!value) return null;
  const result = {pointer:value.pointer, urlSource:value.urlSource ?? 'structured',
    useResolvedValues:value.useResolvedValues === true, pathVariables:value.pathVariables ?? {}};
  for (const name of ['body','bodySchema']) if (Object.hasOwn(value,name)) result[name] = value[name];
  return result;
}
/**
 * Reuse merchant terms only for the same retained request source. Both source
 * packets and the new operations have already passed the original workspace
 * parser/prepare endpoints; this function adds no source or payment compiler.
 */
export function mergePostmanMerchantPlan({currentSource, source, currentPlan, operations}) {
  const previous = retainedPacket(currentSource), next = retainedPacket(source);
  const sameSource = previous && next && typeof previous.hashes.collection === 'string' &&
    previous.hashes.collection === next.hashes.collection &&
    previous.hashes.environment === next.hashes.environment &&
    canonical(previous.decisions.publicVariables ?? {}) === canonical(next.decisions.publicVariables ?? {});
  const priorDecisions = new Map((previous?.decisions.requests ?? []).map(row => [row.pointer,row]));
  const priorRows = new Map((currentPlan.operations ?? []).map(row => [row.method + ' ' + row.path,row]));
  return {...currentPlan, operations:operations.map((row,index) => {
    const decision = next?.decisions.requests[index], saved = priorRows.get(row.method + ' ' + row.path);
    const reusable = sameSource && decision && saved?.id === row.id &&
      canonical(sourceDecision(priorDecisions.get(decision.pointer))) === canonical(sourceDecision(decision));
    if (!reusable) return {...row, amountAtomic:''};
    // Reviewed importer-owned fields always win, including a changed response format.
    const result = {...saved, ...row, amountAtomic:saved.amountAtomic ?? ''};
    const headers = new Map(Object.entries(row.headerEnv ?? {}).map(([name,value]) => [name.toLowerCase(),value]));
    for (const [name,value] of Object.entries(saved.headerEnv ?? {})) headers.set(name.toLowerCase(),value);
    result.headerEnv = Object.fromEntries(headers);
    if (row.oauth2) result.oauth2 = {...row.oauth2, ...saved.oauth2,
      ...(row.oauth2.scope === undefined ? {} : {scope:row.oauth2.scope})};
    else delete result.oauth2;
    // OAuth scopes are source-owned even when the reviewed flow has no scope.
    if (result.oauth2 && row.oauth2.scope === undefined) delete result.oauth2.scope;
    result.securityAlternative = 0;
    return result;
  })};
}

export function createPostmanPanel({container, api, act, notice, onSource}) {
  let collectionText = '', environmentText = null, inventory = null, prepared = null, offset = 0, revision = 0;
  let collectionName = '', environmentName = '', inspectedRevision = -1, busy = false;
  const choices = new Map();
  const details = make('details'), title = make('summary', 'Import an existing Postman collection');
  const explanation = make('p', 'Choose a Collection v2.1 and optional environment export. Review the concrete URL, public request sample, backend headers and script dependencies before using these requests.', 'hint');
  const files = make('div', undefined, 'fields');
  const collection = field('Collection v2.1 JSON', '', 'file'), environment = field('Environment JSON (optional)', '', 'file');
  for (const control of [collection, environment]) {control.input.accept = '.json,application/json'; files.append(control.label);}
  const variables = field('Public variable overrides (JSON)', '{}', 'textarea'); variables.label.className = 'wide';
  variables.label.append(make('span', 'Environment values take precedence over collection values. These explicit sample overrides take precedence over both. A variable used in credentials requires a separate public sample before it can appear in an offer.', 'hint'));
  files.append(variables.label);
  const buttons = make('div', undefined, 'inline'), inspect = make('button', 'Inspect collection'), clearEnvironment = make('button', 'Clear environment');
  inspect.type = clearEnvironment.type = 'button'; buttons.append(inspect, clearEnvironment);
  const sourceLabel = make('p', '', 'small wrap'), navigation = make('div', undefined, 'inline');
  const filter = field('Find a request'), previous = make('button', 'Previous'), next = make('button', 'Next'), page = make('p', '', 'small');
  previous.type = next.type = 'button'; navigation.append(filter.label, previous, next, page); navigation.hidden = true;
  const selectedOnly = field('Show selected requests only', '', 'checkbox');
  selectedOnly.label.className = 'check';
  selectedOnly.label.replaceChildren(selectedOnly.input, make('span','Show selected requests only'));
  const selectVisible = make('button','Select visible requests'), clearSelected = make('button','Clear selected requests');
  selectVisible.type = clearSelected.type = 'button';
  const selectionStatus = make('p','No requests selected.','small');
  selectionStatus.setAttribute('aria-live','polite');
  const selectionTools = make('div',undefined,'inline');
  selectionTools.append(selectedOnly.label,selectVisible,clearSelected); selectionTools.hidden = true;
  const requestList = make('div'), reviewButton = make('button', 'Review selected requests'); reviewButton.type = 'button'; reviewButton.disabled = true;
  const review = make('div'), approved = field('I reviewed these public sample values', '', 'checkbox');
  approved.label.className = 'check'; approved.label.replaceChildren(approved.input, make('span', 'I reviewed these public sample values and source decisions.'));
  const use = make('button', 'Use reviewed requests'); use.type = 'button'; use.className = 'primary'; use.disabled = true;
  const adoption = make('div', undefined, 'inline'); adoption.append(approved.label, use); adoption.hidden = true;
  details.append(title, explanation, files, buttons, sourceLabel, navigation, selectionTools, selectionStatus, requestList, reviewButton, review, adoption,
    make('p', 'The original collection and environment remain in the private source packet. Backend credential values and saved response bodies are excluded from the generated public description. Collection scripts are retained as source; the merchant does not execute them.', 'hint'));
  container.append(details);

  function forgetReview() {
    prepared = null; approved.input.checked = false; use.disabled = true; adoption.hidden = true; review.replaceChildren();
  }
  function selectedCount() {return [...choices.values()].filter(state => state.selected).length;}
  function filteredRows() {
    const term = filter.input.value.trim().toLowerCase();
    return (inventory?.requests ?? []).filter(row =>
      (!selectedOnly.input.checked || choices.get(row.pointer)?.selected) &&
      (row.name + ' ' + row.method + ' ' + row.pointer).toLowerCase().includes(term));
  }
  function describeSource() {
    if (!collectionText) {
      sourceLabel.textContent = 'Choose the original collection to begin.';
      return;
    }
    const collectionLabel = collectionName || 'Retained collection';
    const environmentLabel = environmentText ? (environmentName || 'Retained environment') : 'No environment selected';
    if (!inventory) {
      sourceLabel.textContent = collectionLabel + ' · ' + environmentLabel + ' · Inspect to list the requests.';
      return;
    }
    sourceLabel.textContent = inventory.title + ' · ' + inventory.requests.length + ' requests · ' +
      collectionLabel + ' · ' + environmentLabel + ' · Last inspected collection: ' + inventory.collectionSha256 +
      (inventory.environmentSha256 ? ' · Environment: ' + inventory.environmentSha256 : '') +
      (inspectedRevision === revision ? '' : ' · Selection or source decisions changed. Review resolves the current values.');
  }
  function refreshControls() {
    // The workspace may render new request controls while act() is awaiting IO.
    // Include those controls in its busy state before another edit can be made.
    for (const control of details.querySelectorAll('input,select,textarea')) control.disabled = busy;
    approved.input.disabled = busy || !prepared;
    const count = selectedCount(), visibleCount = filteredRows().length;
    selectionStatus.textContent = count + ' of 64 requests selected' +
      (inventory ? ' from ' + inventory.requests.length + '. Selections are retained across pages and filters.' : '.');
    inspect.disabled = busy || !collectionText;
    clearEnvironment.disabled = busy || !environmentText;
    reviewButton.disabled = busy || !inventory || count === 0;
    use.disabled = busy || !prepared || !approved.input.checked;
    previous.disabled = busy || offset === 0; next.disabled = busy || offset + 20 >= visibleCount;
    selectVisible.disabled = busy || visibleCount === 0;
    clearSelected.disabled = busy || count === 0;
  }
  function changed() {revision++; forgetReview(); describeSource(); refreshControls();}
  function resetSource() {
    collectionText = ''; environmentText = null; inventory = null; inspectedRevision = -1;
    collectionName = ''; environmentName = ''; choices.clear(); offset = 0;
    collection.input.value = ''; environment.input.value = ''; variables.input.value = '{}';
    filter.input.value = ''; selectedOnly.input.checked = false;
    changed(); draw(); details.open = false;
  }
  function decision(row) {
    const state = choices.get(row.pointer);
    const result = {pointer:row.pointer, urlSource:state?.urlSource ?? row.urlSource ?? 'structured',
      responseMode:state?.responseMode ?? 'json', useResolvedValues:state?.useResolvedValues === true};
    for (const [field, key] of [['pathText','pathVariables'], ['bodyText','body'], ['schemaText','bodySchema']]) {
      const text = state?.[field]?.trim();
      if (text) {try {result[key] = JSON.parse(text);} catch {throw new Error(row.name + ': ' + key + ' must be JSON');}}
    }
    return result;
  }
  function input({selectionRequired = false} = {}) {
    if (!collectionText) throw new Error('Choose a collection JSON file');
    let publicVariables;
    try {publicVariables = JSON.parse(variables.input.value);} catch {throw new Error('Public variable overrides must be JSON');}
    const byPointer = new Map((inventory?.requests ?? []).map(row => [row.pointer,row]));
    // Deselected edits remain in the panel; only selected requests enter a source decision.
    const rows = [...choices].filter(([_pointer, state]) => state.selected)
      .map(([pointer]) => byPointer.get(pointer) ?? {pointer,name:pointer});
    if (rows.length > 64) throw new Error('Keep this import to at most 64 selected requests');
    if (selectionRequired && !rows.length) throw new Error('Select at least one request to review');
    return {collectionText, environmentText, decisions:{publicVariables, requests:rows.map(decision)}};
  }
  function draw() {
    requestList.replaceChildren();
    const all = inventory?.requests ?? [], rows = filteredRows();
    if (offset >= rows.length) offset = Math.max(0, Math.floor((rows.length - 1) / 20) * 20);
    const visible = rows.slice(offset, offset + 20);
    page.textContent = (rows.length ? offset + 1 : 0) + '–' + Math.min(offset + 20, rows.length) + ' of ' + rows.length;
    previous.disabled = offset === 0; next.disabled = offset + 20 >= rows.length; navigation.hidden = !all.length;
    selectionTools.hidden = !all.length;
    for (const row of visible) {
      const state = choices.get(row.pointer) ?? {selected:false, urlSource:row.urlSource ?? 'structured', responseMode:'json'};
      choices.set(row.pointer,state);
      const card = make('article', undefined, 'route'), heading = make('label', undefined, 'check');
      const chosen = make('input'); chosen.type = 'checkbox'; chosen.checked = state.selected === true;
      chosen.setAttribute('aria-label', 'Import ' + row.name);
      heading.append(chosen, make('strong', row.method + ' · ' + row.name, 'wrap'));
      card.append(heading, make('p', row.pointer + (row.supported ? ' · Available for source review' : ' · ' + row.error), 'hint wrap'));
      if (row.resolvedUrl) card.append(make('p', row.resolvedUrl, 'small wrap'));
      const advanced = make('details'), fields = make('div', undefined, 'fields');
      advanced.append(make('summary', 'Request source decisions'));
      const url = select('URL representation', [['structured','Structured URL fields'], ['raw','Raw URL string']], state.urlSource);
      const response = select('Backend response format', [['json','JSON'], ['bytes','Bytes']], state.responseMode);
      const path = field('Colon path samples (JSON)', state.pathText ?? '', 'textarea');
      const body = field('Explicit public JSON body (optional)', state.bodyText ?? '', 'textarea');
      const schema = field('Explicit request body schema (optional)', state.schemaText ?? '', 'textarea');
      schema.label.className = body.label.className = 'wide';
      const script = field('Use the resolved request values without executing pre-request scripts', '', 'checkbox');
      script.label.className = 'check wide'; script.input.checked = state.useResolvedValues === true;
      script.label.replaceChildren(script.input, make('span', 'Use these resolved request values without executing pre-request scripts.'));
      fields.append(url.label, response.label, path.label, body.label, schema.label);
      fields.append(make('p', 'An explicit JSON body is a reviewed adaptation. Without an explicit schema, fields are inferred from the sample and remain optional. Response examples do not enable declared response validation.', 'hint wide'));
      if (row.preRequestScripts?.length) {
        fields.append(make('p', row.preRequestScripts.length + ' pre-request script(s) are retained. Their output is not available from this export; confirm the concrete request values you intend to sell.', 'hint wide'), script.label);
      }
      const save = () => {
        if (chosen.checked && !choices.get(row.pointer)?.selected && selectedCount() >= 64) {
          chosen.checked = false; notice('64 requests are already selected. Clear a selection before adding another.',true);
        }
        choices.set(row.pointer, {selected:chosen.checked, urlSource:url.input.value, responseMode:response.input.value,
          pathText:path.input.value, bodyText:body.input.value, schemaText:schema.input.value, useResolvedValues:script.input.checked});
        changed();
        if (selectedOnly.input.checked && !chosen.checked) draw();
      };
      for (const control of [chosen,url.input,response.input,path.input,body.input,schema.input,script.input]) control.addEventListener('input',save);
      advanced.append(fields); card.append(advanced); requestList.append(card);
    }
    if (!visible.length) requestList.append(make('p', inventory ? 'No requests match this selection.' : 'Inspect a collection to list its requests.', 'empty'));
    refreshControls();
  }
  async function inspectCurrent() {
    const expectedRevision = revision, selection = input();
    const result = await api('postman/inspect', selection);
    if (revision !== expectedRevision) return;
    inventory = result; inspectedRevision = revision; offset = 0; forgetReview(); draw(); describeSource();
  }
  async function fileText(file) {
    if (!file || file.size > 4 * 1024 * 1024) throw new Error('Choose a JSON file of at most 4 MiB');
    return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(await file.arrayBuffer());
  }
  collection.input.addEventListener('change', () => {
    const selected = collection.input.files[0]; if (!selected) return;
    // The newly selected file owns the intake immediately, including failed reads.
    collectionText = ''; collectionName = ''; inventory = null; inspectedRevision = -1;
    choices.clear(); offset = 0; filter.input.value = ''; selectedOnly.input.checked = false;
    changed(); draw();
    const expectedRevision = revision;
    act(async () => {
      try {
        const text = await fileText(selected);
        if (revision !== expectedRevision) return;
        collectionText = text; collectionName = selected.name; changed(); draw();
      } catch (error) {
        if (revision === expectedRevision) {collection.input.value = ''; describeSource();}
        throw error;
      }
    });
  });
  environment.input.addEventListener('change', () => {
    const selected = environment.input.files[0]; if (!selected) return;
    // A rejected replacement cannot leave the previous environment active.
    environmentText = null; environmentName = ''; changed();
    const expectedRevision = revision;
    act(async () => {
      try {
        const text = await fileText(selected);
        if (revision !== expectedRevision) return;
        environmentText = text; environmentName = selected.name; changed();
      } catch (error) {
        if (revision === expectedRevision) {environment.input.value = ''; describeSource();}
        throw error;
      }
    });
  });
  clearEnvironment.addEventListener('click', () => {
    environmentText = null; environmentName = ''; environment.input.value = ''; changed();
  });
  variables.input.addEventListener('input', changed);
  inspect.addEventListener('click', () => act(inspectCurrent));
  filter.input.addEventListener('input', () => {offset = 0; draw();});
  selectedOnly.input.addEventListener('change', () => {offset = 0; draw();});
  previous.addEventListener('click', () => {offset = Math.max(0, offset - 20); draw();});
  next.addEventListener('click', () => {offset += 20; draw();});
  selectVisible.addEventListener('click', () => {
    const visible = filteredRows().slice(offset,offset + 20);
    const added = visible.filter(row => !choices.get(row.pointer)?.selected).length;
    if (selectedCount() + added > 64) {
      notice('This page would exceed 64 selected requests. Select individual requests or clear existing selections.',true);
      return;
    }
    for (const row of visible) choices.set(row.pointer,{
      urlSource:row.urlSource ?? 'structured',responseMode:'json',...choices.get(row.pointer),selected:true});
    changed(); draw();
  });
  clearSelected.addEventListener('click', () => {
    for (const [pointer,state] of choices) choices.set(pointer,{...state,selected:false});
    changed(); draw();
  });
  reviewButton.addEventListener('click', () => act(async () => {
    forgetReview(); const expectedRevision = revision, selection = input({selectionRequired:true});
    const result = await api('postman/prepare', selection);
    if (revision !== expectedRevision) return;
    prepared = result;
    review.append(make('h3', result.review.title + ' — review before import'),
      make('p', 'Only the selected requests enter the generated merchant source. Pricing and backend environment references remain editable in the original workspace.', 'hint'));
    for (const row of result.review.requests) {
      const section = make('details'); section.open = true;
      section.append(make('summary', row.method + ' ' + row.resolvedUrl), make('pre', JSON.stringify({
        sourcePointer:row.pointer, urlSource:row.urlSource, backendAuthentication:row.auth, backendHeaders:row.backendHeaders,
        publicRequest:row.requestExample, bodyMediaType:row.bodyMediaType, requestSchema:row.requestSchema,
        schemaOrigin:row.requestSchemaOrigin, bodyAdaptation:row.bodyAdaptation, responseMode:row.responseMode,
        responseValidation:row.responseValidation, savedResponseExamples:row.responseExamples,
        preRequestScripts:row.preRequestScripts, scriptsAccepted:row.scriptsAccepted},null,2), 'wrap'));
      review.append(section);
    }
    review.append(make('p', 'Collection: ' + result.review.collection +
      (result.review.environment ? ' · Environment: ' + result.review.environment : '') +
      ' · Decisions: ' + result.review.decisions + ' · Generated source: ' + result.review.document, 'small wrap'));
    adoption.hidden = false;
    notice('Review the resolved request values below, then use them in the merchant workspace.');
  }));
  approved.input.addEventListener('change', refreshControls);
  use.addEventListener('click', () => act(async () => {
    if (!prepared || !approved.input.checked) throw new Error('Review the current collection selection first');
    const current = prepared;
    await onSource(current.specText, current.operations);
    notice('Reviewed Postman requests loaded. Set the merchant terms, validate and save the original package.');
  }));
  describeSource(); refreshControls();
  return {
    refresh(value = false) {busy = value; refreshControls();},
    async reopen(text) {
      const packet = retainedPacket(text);
      // Every active workspace source replaces the prior intake, including YAML,
      // ordinary OpenAPI, provider source bundles and a different saved package.
      resetSource();
      if (!packet) return;
      collectionText = packet.collectionText; environmentText = packet.environmentText;
      collectionName = 'Retained collection'; environmentName = environmentText ? 'Retained environment' : '';
      variables.input.value = stringify(packet.decisions.publicVariables ?? {});
      for (const row of packet.decisions.requests) choices.set(row.pointer, {selected:true, urlSource:row.urlSource ?? 'structured',
        responseMode:row.responseMode ?? 'json', useResolvedValues:row.useResolvedValues === true,
        pathText:stringify(row.pathVariables), bodyText:stringify(row.body), schemaText:stringify(row.bodySchema)});
      changed(); details.open = true; await inspectCurrent();
      if (collectionText === packet.collectionText) sourceLabel.textContent += ' · Retained selection reopened';
    }
  };
}
