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

export function createPostmanPanel({container, api, act, notice, onSource}) {
  let collectionText = '', environmentText = null, inventory = null, prepared = null, offset = 0;
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
  const requestList = make('div'), reviewButton = make('button', 'Review selected requests'); reviewButton.type = 'button'; reviewButton.disabled = true;
  const review = make('div'), approved = field('I reviewed these public sample values', '', 'checkbox');
  approved.label.className = 'check'; approved.label.replaceChildren(approved.input, make('span', 'I reviewed these public sample values and source decisions.'));
  const use = make('button', 'Use reviewed requests'); use.type = 'button'; use.className = 'primary'; use.disabled = true;
  const adoption = make('div', undefined, 'inline'); adoption.append(approved.label, use); adoption.hidden = true;
  details.append(title, explanation, files, buttons, sourceLabel, navigation, requestList, reviewButton, review, adoption,
    make('p', 'The original collection and environment remain in the private source packet. Backend credential values and saved response bodies are excluded from the generated public description. Collection scripts are retained as source; the merchant does not execute them.', 'hint'));
  container.append(details);

  function changed() {prepared = null; approved.input.checked = false; use.disabled = true; adoption.hidden = true; review.replaceChildren();}
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
  function input({selectedOnly = false} = {}) {
    if (!collectionText) throw new Error('Choose a collection JSON file');
    let publicVariables;
    try {publicVariables = JSON.parse(variables.input.value);} catch {throw new Error('Public variable overrides must be JSON');}
    const byPointer = new Map((inventory?.requests ?? []).map(row => [row.pointer,row]));
    const rows = [...choices].filter(([_pointer, state]) => !selectedOnly || state.selected)
      .map(([pointer]) => byPointer.get(pointer) ?? {pointer,name:pointer});
    if (rows.length > 64) throw new Error('Keep this import to at most 64 selected or adapted requests');
    return {collectionText, environmentText, decisions:{publicVariables, requests:rows.map(decision)}};
  }
  function draw() {
    requestList.replaceChildren();
    const all = inventory?.requests ?? [], term = filter.input.value.trim().toLowerCase();
    const rows = all.filter(row => (row.name + ' ' + row.method + ' ' + row.pointer).toLowerCase().includes(term));
    if (offset >= rows.length) offset = Math.max(0, Math.floor((rows.length - 1) / 20) * 20);
    const visible = rows.slice(offset, offset + 20);
    page.textContent = (rows.length ? offset + 1 : 0) + '–' + Math.min(offset + 20, rows.length) + ' of ' + rows.length;
    previous.disabled = offset === 0; next.disabled = offset + 20 >= rows.length; navigation.hidden = !all.length;
    reviewButton.disabled = !all.length;
    for (const row of visible) {
      const state = choices.get(row.pointer) ?? {selected:false, urlSource:row.urlSource ?? 'structured', responseMode:'json'};
      const card = make('article', undefined, 'route'), heading = make('label', undefined, 'check');
      const chosen = make('input'); chosen.type = 'checkbox'; chosen.checked = state.selected === true;
      chosen.setAttribute('aria-label', 'Import ' + row.name);
      heading.append(chosen, make('strong', row.method + ' · ' + row.name, 'wrap'));
      card.append(heading, make('p', row.pointer + (row.supported ? ' · Ready for review' : ' · ' + row.error), 'hint wrap'));
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
        choices.set(row.pointer, {selected:chosen.checked, urlSource:url.input.value, responseMode:response.input.value,
          pathText:path.input.value, bodyText:body.input.value, schemaText:schema.input.value, useResolvedValues:script.input.checked});
        changed();
      };
      for (const control of [chosen,url.input,response.input,path.input,body.input,schema.input,script.input]) control.addEventListener('input',save);
      advanced.append(fields); card.append(advanced); requestList.append(card);
    }
    if (!visible.length) requestList.append(make('p', 'No requests match this selection.', 'empty'));
  }
  async function inspectCurrent() {
    const result = await api('postman/inspect', input());
    inventory = result; offset = 0; changed(); draw();
    sourceLabel.textContent = result.title + ' · ' + result.requests.length + ' requests · Collection ' + result.collectionSha256 +
      (result.environment ? ' · Environment: ' + result.environment : ' · No environment selected');
  }
  async function fileText(file) {
    if (!file || file.size > 4 * 1024 * 1024) throw new Error('Choose a JSON file of at most 4 MiB');
    return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(await file.arrayBuffer());
  }
  collection.input.addEventListener('change', () => act(async () => {
    const text = await fileText(collection.input.files[0]);
    collectionText = text; inventory = null; choices.clear(); changed(); requestList.replaceChildren();
    reviewButton.disabled = true; sourceLabel.textContent = 'Collection selected. Inspect it with the chosen environment and public overrides.';
  }));
  environment.input.addEventListener('change', () => act(async () => {
    environmentText = await fileText(environment.input.files[0]); changed();
    sourceLabel.textContent = 'Environment selected. Inspect the resolved requests again.';
  }));
  clearEnvironment.addEventListener('click', () => {environmentText = null; environment.input.value = ''; changed(); sourceLabel.textContent = 'Environment cleared. Inspect the resolved requests again.';});
  variables.input.addEventListener('input', changed);
  inspect.addEventListener('click', () => act(inspectCurrent));
  filter.input.addEventListener('input', () => {offset = 0; draw();});
  previous.addEventListener('click', () => {offset = Math.max(0, offset - 20); draw();});
  next.addEventListener('click', () => {offset += 20; draw();});
  reviewButton.addEventListener('click', () => act(async () => {
    changed(); const result = await api('postman/prepare', input({selectedOnly:true}));
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
    review.append(make('p', 'Source: ' + result.review.collection + ' · Decisions: ' + result.review.decisions, 'small wrap'));
    adoption.hidden = false;
    notice('Review the resolved request values below, then use them in the merchant workspace.');
  }));
  approved.input.addEventListener('change', () => {use.disabled = !prepared || !approved.input.checked;});
  use.addEventListener('click', () => act(async () => {
    if (!prepared || !approved.input.checked) throw new Error('Review the current collection selection first');
    const current = prepared;
    await onSource(current.specText, current.operations);
    notice('Reviewed Postman requests loaded. Set the merchant terms, validate and save the original package.');
  }));
  return {
    refresh(busy = false) {
      inspect.disabled = busy || !collectionText;
      clearEnvironment.disabled = busy || !environmentText;
      reviewButton.disabled = busy || !inventory?.requests.length;
      use.disabled = busy || !prepared || !approved.input.checked;
      const term = filter.input.value.trim().toLowerCase();
      const count = (inventory?.requests ?? []).filter(row => (row.name + ' ' + row.method + ' ' + row.pointer).toLowerCase().includes(term)).length;
      previous.disabled = busy || offset === 0; next.disabled = busy || offset + 20 >= count;
    },
    async reopen(text) {
      let packet; try {packet = JSON.parse(text);} catch {return;}
      if (packet?.schema !== SCHEMA) return;
      collectionText = packet.collectionText; environmentText = packet.environmentText; choices.clear();
      variables.input.value = stringify(packet.decisions.publicVariables ?? {});
      for (const row of packet.decisions.requests) choices.set(row.pointer, {selected:true, urlSource:row.urlSource ?? 'structured',
        responseMode:row.responseMode ?? 'json', useResolvedValues:row.useResolvedValues === true,
        pathText:stringify(row.pathVariables), bodyText:stringify(row.body), schemaText:stringify(row.bodySchema)});
      details.open = true; await inspectCurrent();
      sourceLabel.textContent += ' · Retained selection reopened';
    }
  };
}
