// MIT. Complete selected-output search; original page navigation remains authoritative.
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function createOutputSearch({ root, api, route, downloadRoute, onOpen, onRetain, storagePrefix }) {
  const stylesheetId = 'runtime-output-search-css';
  if (!document.getElementById(stylesheetId)) {
    const link = el('link'); link.id = stylesheetId; link.rel = 'stylesheet';
    link.href = new URL('./output-search.css', import.meta.url).href; document.head.append(link);
  }
  const desk = el('section', undefined, 'output-search-desk');
  desk.setAttribute('aria-label', 'Search complete selected output');
  const title = el('h4', 'Search complete selected output');
  const form = el('form', undefined, 'actions'), label = el('label', 'Exact text'), query = el('textarea');
  query.rows = 2; query.maxLength = 4096; query.spellcheck = false; query.autocomplete = 'off';
  query.setAttribute('data-output-search', 'query'); label.append(query);
  const start = el('button', 'Search selected output'); start.type = 'submit'; start.dataset.outputSearch = 'start';
  form.append(label, start);
  const actions = el('div', undefined, 'actions');
  const button = (name, key, action) => {
    const node = el('button', name); node.type = 'button'; node.dataset.outputSearch = key;
    node.addEventListener('click', action); actions.append(node); return node;
  };
  const earlier = button('Previous search page', 'previous', () => previousPage());
  const more = button('Continue search', 'continue', () => nextPage());
  const pause = button('Pause search', 'pause', () => {
    epoch++; busy = false; message = 'Search paused. Continue from the last retained byte position.'; render(); persist();
  });
  const exportButton = button('Download complete search', 'export', () => download());
  const retainButton = button('Use in operating procedure', 'procedure', async () => {
    if (!session || !input || !onRetain) return;
    const own=identity, selected=session;
    try {
      await onRetain({selection:selected.selection,query:selected.query,contextBytes:96});
      if(identity===own&&session===selected){message='The complete output selection is retained in Operating procedures. Save a named observation there to capture every original byte and match.';render();}
    } catch(error){if(identity===own&&session===selected){message=error.message;render();}}
  });
  retainButton.hidden=!onRetain;
  const status = el('p', '', 'note'), notice = el('p', '', 'message'), results = el('ol', undefined, 'output-search-results');
  status.dataset.outputSearch = 'status'; status.setAttribute('aria-live', 'polite');
  notice.dataset.outputSearch = 'notice'; results.dataset.outputSearch = 'results';
  desk.append(title, form, actions, status, notice, results); root.append(desk);
  let identity = '', input = null, page = null, session = null, epoch = 0, busy = false, exporting = false;
  let message = '', storageMessage = '', renderedResults = undefined;
  const key = () => storagePrefix + 'complete-search:' + identity;
  const current = (ticket, own) => ticket === epoch && own === identity;
  function persist() {
    if (!identity) return;
    try {
      sessionStorage.setItem(key(), JSON.stringify({ schema: 'stellar-forge.output-search-window.v1',
        draft: query.value, session }));
      storageMessage = '';
    } catch {
      storageMessage = 'Browser storage is unavailable. The current search remains open; download it before leaving.';
    }
  }
  function validSession(value) {
    return value && typeof value.query === 'string' && typeof value.selection === 'string' &&
      value.selection.length <= 2048 && integer(value.endOffset) && Array.isArray(value.history) &&
      integer(value.before) && (value.pageCursor === null || typeof value.pageCursor === 'string') &&
      (!value.result || value.result.selection === value.selection && value.result.query === value.query &&
        Array.isArray(value.result.matches) && value.result.matches.length <= 200);
  }
  function bind(nextIdentity, nextInput) {
    if (nextIdentity === identity) return;
    epoch++; busy = exporting = false; identity = nextIdentity; input = nextInput ? { ...nextInput } : null;
    page = session = null; message = storageMessage = ''; query.value = '';
    if (identity) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key()) ?? 'null');
        if (saved?.schema === 'stellar-forge.output-search-window.v1') {
          if (typeof saved.draft === 'string') query.value = saved.draft;
          if (validSession(saved.session)) session = saved.session;
        }
      } catch { message = 'The browser search could not reopen. Search the current original output again.'; }
    }
    render();
  }
  query.addEventListener('input', () => { persist(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input || !page) return;
    const bytes = new TextEncoder().encode(query.value);
    if (!bytes.length || bytes.length > 4096 || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== query.value) {
      message = 'Enter exact UTF-8 text between 1 and 4096 bytes.'; render(); return;
    }
    epoch++; busy = exporting = false;
    session = { query: query.value, selection: page.selection, endOffset: page.endOffset,
      pageCursor: null, resumeCursor: null, before: 0, progressOffset: 0, history: [], result: null };
    message = ''; persist(); render(); runPage(null);
  });
  function render() {
    start.disabled = !input || !page;
    query.disabled = !input;
    earlier.disabled = busy || !session?.history.length;
    more.disabled = busy || !session || session.result?.done === true;
    pause.disabled = !busy;
    exportButton.disabled = exporting || !session;
    retainButton.disabled = !session || !onRetain;
    desk.setAttribute('aria-busy', String(busy));
    const result = session?.result;
    status.textContent = !identity ? 'Choose an original output source.' : !session
      ? 'Search every original byte through the selected end. Matching is literal, case-sensitive and includes overlaps.'
      : 'Selected bytes 0–' + session.endOffset + ' · exact query ' + JSON.stringify(session.query) +
        (result ? ' · searched through byte ' + result.nextOffset + ' · ' +
          (session.before + result.matches.length) + ' matches through this page' +
          (result.done ? ' · complete' : '') : ' · ready from byte ' + (session.progressOffset ?? 0)) +
        (busy ? ' · searching…' : '') +
        (page && page.selection !== session.selection ? ' · search retains its earlier selection' : '');
    notice.textContent = [message, storageMessage].filter(Boolean).join(' '); notice.hidden = !notice.textContent;
    if (renderedResults === result) return;
    renderedResults = result; results.replaceChildren();
    for (const match of result?.matches ?? []) {
      const item = el('li'), jump = el('button', 'Open bytes ' + match.offset + '–' + match.endOffset);
      jump.type = 'button'; jump.dataset.outputSearchOffset = String(match.offset);
      const context = el('pre', match.context.text);
      context.setAttribute('aria-label', 'Original context at byte ' + match.context.offset);
      jump.addEventListener('click', async () => {
        const own = identity, ticket = epoch, retained = session;
        try {
          await onOpen({ selection: retained.selection, offset: match.offset, query: retained.query });
        } catch (error) {
          if (current(ticket, own)) { message = error.message; render(); }
        }
      });
      item.append(jump, context); results.append(item);
    }
  }
  function checkResult(result) {
    if (result?.schema !== 'stellar-forge.output-search-page.v1' || result.selection !== session.selection ||
        result.query !== session.query || result.contextBytes !== 96 || result.endOffset !== session.endOffset ||
        !integer(result.nextOffset) || !Array.isArray(result.matches) || result.matches.length > 100 ||
        (session.result?.searchId && result.searchId !== session.result.searchId))
      throw new Error('The original search response does not match the retained selection.');
  }
  async function runPage(cursor) {
    if (!session || !input || busy) return;
    const ticket = ++epoch, own = identity; busy = true; message = ''; render();
    try {
      // Empty spans continue automatically; each native request scans at most
      // 8 MiB. Pause and source changes invalidate only this browser continuation.
      let nextCursor = cursor;
      while (current(ticket, own)) {
        const value = await api(route, { ...input, selection: session.selection, query: session.query,
          contextBytes: 96, limit: 100, maxBytes: 8388608,
          ...(nextCursor === null ? {} : { cursor: nextCursor }) });
        if (!current(ticket, own)) return;
        checkResult(value); session.result = value; session.progressOffset = value.nextOffset;
        session.resumeCursor = value.nextCursor; persist(); render();
        if (value.done || value.matches.length) break;
        if (!value.nextCursor || value.nextOffset <= value.fromOffset) throw new Error('Search did not advance its original byte position.');
        // Only visible result-page origins belong in history. Empty scan spans
        // advance a separate physical continuation, including across a pause.
        nextCursor = value.nextCursor; persist();
      }
    } catch (error) {
      if (current(ticket, own)) {
        message = (error.code ?? 'OUTPUT_SEARCH_UNAVAILABLE') + ': ' + error.message +
          ' The previous original selection and cursor remain retained.';
      }
    } finally {
      if (current(ticket, own)) { busy = false; persist(); render(); }
    }
  }
  function nextPage() {
    if (!session || busy || session.result?.done) return;
    if (!session.result || session.result.matches.length === 0) {
      runPage(session.resumeCursor ?? session.pageCursor); return;
    }
    if (!session.result.nextCursor) return;
    session.history.push({ cursor: session.pageCursor, before: session.before });
    session.pageCursor = session.result.nextCursor; session.resumeCursor = session.pageCursor;
    session.before += session.result.matches.length;
    session.result = null; persist(); runPage(session.pageCursor);
  }
  function previousPage() {
    if (!session?.history.length || busy) return;
    const previous = session.history.pop(); session.pageCursor = previous.cursor; session.resumeCursor = previous.cursor;
    session.before = previous.before;
    session.result = null; persist(); runPage(session.pageCursor);
  }
  async function download() {
    if (!session || !input || exporting) return;
    const ticket = epoch, own = identity, selected = session;
    exporting = true; message = ''; render();
    try {
      const value = await api(downloadRoute, { ...input, selection: selected.selection,
        query: selected.query, contextBytes: 96 });
      if (identity !== own || selected !== session) return;
      const link = el('a', 'Download complete original search'); link.href = value.url; link.download = value.filename;
      root.append(link); link.click(); link.remove();
    } catch (error) {
      if (identity === own && selected === session) message = error.message;
    } finally {
      if (identity === own && selected === session) { exporting = false; render(); }
    }
  }
  render();
  return { bind, page(value) { page = value; render(); }, reset() { bind('', null); } };
}
