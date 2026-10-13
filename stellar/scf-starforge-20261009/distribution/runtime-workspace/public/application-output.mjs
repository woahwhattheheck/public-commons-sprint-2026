// MIT. One original-output reader for Applications, Launch Groups and Runtime operations.
const node = (tag, text, className) => {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
};
const readable = text => String(text ?? '').replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const query = (path, input) => path + '?' + new URLSearchParams(
  Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
const PAGE = 65536;
export function createApplicationOutputReader({ root, api, getWorkspaceId, error, output = null,
  pageRoute = '/api/applications/output-page', downloadRoute = '/api/applications/output-download',
  sourceFields = ['applicationId', 'operationId'], storagePrefix = 'starforge-application-output-',
  describe = value => 'operation ' + value.operationId }) {
  const sourceInput = value => Object.fromEntries(sourceFields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  const sourceIdentity = value => [value.workspaceId, ...sourceFields.map(key => value[key] ?? '')].join(':');
  let context = null, page = null, live = true, selection = null, offset = null;
  let generation = 0, loading = false, requested = false, failed = false;
  let selectedMatch = 0, matches = [], visibleText = '', renderedPage = null;
  const toolbar = node('div', undefined, 'actions'), info = node('p', '', 'note'), failure = node('p', '', 'message');
  info.setAttribute('aria-live', 'polite'); failure.hidden = true;
  const body = output ?? node('pre'); body.setAttribute('tabindex', '0');
  body.setAttribute('aria-label', 'Selected original operation output');
  const button = (label, action) => {
    const value = node('button', label); value.type = 'button';
    value.addEventListener('click', () => Promise.resolve().then(action).catch(error));
    toolbar.append(value); return value;
  };
  const first = button('Beginning', () => browse(0));
  const previous = button('Previous output', () => browse(Math.max(0, (page?.offset ?? 0) - PAGE)));
  const next = button('Next output', () => browse(page?.nextOffset ?? 0));
  const last = button('Selected end', () => browse(Math.max(0, (page?.endOffset ?? 0) - PAGE)));
  const freeze = button('Keep this output selection', () => {
    if (!page) return; live = false; selection = page.selection; offset = page.offset; persist(); render();
  });
  const follow = button('Follow live output', async () => {
    live = true; selection = null; offset = null; failed = false; persist(); await load();
  });
  const refresh = button('Refresh output', () => load());
  const download = button('Download complete selected output', async () => {
    if (!context || !page || loading || failed) return;
    const own = identity(), value = await api(downloadRoute, { ...sourceInput(context), selection: page.selection });
    if (identity() !== own) return;
    const link = node('a', 'Download original output'); link.href = value.url; link.download = value.filename;
    root.append(link); link.click(); link.remove();
  });
  const location = node('form', undefined, 'actions'), jumpLabel = node('label', 'Byte offset'), jump = node('input');
  jump.type = 'text'; jump.inputMode = 'numeric'; jump.pattern = '[0-9]+'; jump.autocomplete = 'off';
  jump.placeholder = '0'; jumpLabel.append(jump);
  const go = node('button', 'Go to byte'); go.type = 'submit'; location.append(jumpLabel, go);
  location.addEventListener('submit', event => {
    event.preventDefault();
    if (!/^(?:0|[1-9][0-9]*)$/.test(jump.value) || !Number.isSafeInteger(Number(jump.value)) ||
        !page || Number(jump.value) > page.endOffset) {
      error(new Error('Enter a whole byte offset within the selected output.')); return;
    }
    browse(Number(jump.value)).catch(error);
  });
  const findRow = node('div', undefined, 'actions'), searchLabel = node('label', 'Find in this output page'), search = node('input');
  search.type = 'search'; search.maxLength = 256; search.autocomplete = 'off'; searchLabel.append(search);
  const findStatus = node('span', '', 'note'), findNext = node('button', 'Next match'); findNext.type = 'button';
  const rawLabel = node('label', undefined, 'check'), raw = node('input'); raw.type = 'checkbox';
  rawLabel.append(raw, document.createTextNode('Show decoded text without terminal cleanup'));
  findRow.append(searchLabel, findNext, findStatus, rawLabel);
  search.addEventListener('input', () => { selectedMatch = 0; renderText(); });
  raw.addEventListener('change', () => { selectedMatch = 0; renderText(); });
  findNext.addEventListener('click', () => {
    if (!matches.length) return;
    const selected = matches[selectedMatch++ % matches.length];
    selected.scrollIntoView({ block: 'nearest' });
    findStatus.textContent = ((selectedMatch - 1) % matches.length + 1) + ' of ' + matches.length + ' shown matches';
  });
  root.append(toolbar, info, failure, location, findRow, body);
  const identity = () => context ? sourceIdentity(context) : '';
  const key = () => storagePrefix + identity();
  function persist() {
    if (!context) return;
    try { sessionStorage.setItem(key(), JSON.stringify({ live, selection, offset })); } catch { /* Reading and downloads remain available. */ }
  }
  function select(value) {
    generation++; loading = false; requested = false; failed = false;
    context = { ...value, workspaceId: getWorkspaceId() }; page = null; body.textContent = '';
    live = true; selection = null; offset = null; renderedPage = null; failure.hidden = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key()) ?? 'null');
      if (saved?.live === false && typeof saved.selection === 'string' && saved.selection.length <= 2048 &&
          Number.isSafeInteger(saved.offset) && saved.offset >= 0) {
        live = false; selection = saved.selection; offset = saved.offset;
      }
    } catch { /* A new selection uses the original current tail. */ }
    render();
  }
  async function browse(value) {
    if (!context || !page || loading || failed) return;
    live = false; selection = page.selection; offset = value; persist(); await load();
  }
  function renderText() {
    const oldScroll = body.scrollTop, oldBottom = oldScroll + body.clientHeight >= body.scrollHeight - 40;
    const nextPage = page ? [page.selection, page.offset, page.nextOffset].join(':') : null;
    const samePage = nextPage === renderedPage; renderedPage = nextPage;
    visibleText = raw.checked ? page?.text ?? '' : readable(page?.text);
    const needle = search.value, match = needle;
    matches = []; body.replaceChildren();
    if (!match) body.textContent = visibleText;
    else {
      let start = 0, found, count = 0;
      // Unicode lowercase can change string length. Search the original decoded
      // text literally so every highlight remains at its actual character offset.
      while ((found = visibleText.indexOf(needle, start)) >= 0 && count < 500) {
        body.append(document.createTextNode(visibleText.slice(start, found)));
        const mark = node('mark', visibleText.slice(found, found + needle.length));
        body.append(mark); matches.push(mark); count++; start = found + needle.length;
      }
      body.append(document.createTextNode(visibleText.slice(start)));
      findStatus.textContent = count + (count === 500 ? ' shown matches (first 500)' : ' exact matches in this page');
    }
    if (!match) findStatus.textContent = '';
    findNext.disabled = !matches.length;
    body.scrollTop = live && oldBottom && !needle ? body.scrollHeight : samePage || live ? oldScroll : 0;
  }
  function render() {
    const unavailable = !page || loading || failed;
    first.disabled = previous.disabled = unavailable || page.offset === 0;
    next.disabled = last.disabled = unavailable || !page.hasNext;
    freeze.disabled = unavailable || !live; follow.disabled = loading || (live && !failed);
    refresh.disabled = loading || !context; download.disabled = unavailable; go.disabled = unavailable;
    root.setAttribute('aria-busy', String(loading));
    info.textContent = !context ? 'Choose an original operation.' : !page ? loading ? 'Reading original output…' : 'Original output has not been read.' :
      (live ? 'Live tail' : 'Retained selection') + ' · bytes ' + page.offset + '–' + page.nextOffset +
      ' of selected 0–' + page.endOffset + ' · ' + page.totalBytes + ' currently retained' +
      (page.appendedBytes ? ' · ' + page.appendedBytes + ' newer bytes beyond this selection' : '') +
      ' · ' + describe(context);
    root.title = page ? 'Original output source ' + page.sourceId : '';
  }
  async function load() {
    if (!context) return;
    if (loading) { requested = true; return; }
    loading = true; const own = identity(), ticket = ++generation; render();
    try {
      const value = await api(query(pageRoute, { ...sourceInput(context), ...(live ? {} : { selection, offset }), limit: PAGE }));
      if (identity() !== own || generation !== ticket) return;
      page = value; failed = false; failure.hidden = true;
      if (!live) { selection = value.selection; offset = value.offset; persist(); }
      renderText();
    } catch (problem) {
      if (identity() !== own || generation !== ticket) return;
      failed = true;
      failure.textContent = (problem.code ?? 'OUTPUT_UNAVAILABLE') + ': ' + problem.message +
        ' Select Follow live output to open the current original file.';
      failure.hidden = false;
    } finally {
      if (identity() === own && generation === ticket) {
        loading = false; render();
        if (requested) { requested = false; await load(); }
      }
    }
  }
  return {
    async update(value, { force = false } = {}) {
      const nextIdentity = sourceIdentity({ ...value, workspaceId: getWorkspaceId() });
      if (identity() !== nextIdentity) select(value);
      // A frozen page keeps its original bytes and scroll position between
      // automatic status refreshes. Refresh output explicitly checks its file.
      if (live || !page || force) await load();
    },
    async refresh() { await load(); },
    reset() {
      generation++; context = page = null; loading = requested = failed = false;
      live = true; selection = offset = null; body.textContent = ''; failure.hidden = true; render();
    },
  };
}
