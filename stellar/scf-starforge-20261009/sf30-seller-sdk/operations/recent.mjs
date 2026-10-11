// MIT. Recent metadata view composed into the original seller operations UI.
let snapshot = null, listening = false;
const $ = id => document.getElementById(id);
const names = { success: 'HTTP 2xx', challenge: 'HTTP 402', clientError: 'Client error',
  serverError: 'Server error', other: 'Other response', disconnected: 'Disconnected' };
function draw() {
  if (!snapshot || !$('outcomes')) return;
  const query = $('outcome-route').value.trim().toLowerCase(), filter = $('outcome-kind').value;
  const routes = new Map(snapshot.routes.map(row => [row.id, row]));
  const records = (snapshot.recent ?? []).filter(row => {
    const route = routes.get(row.routeId);
    return `${row.routeId} ${route?.path ?? ''}`.toLowerCase().includes(query) &&
      (!filter || (filter === 'errors' ? ['clientError', 'serverError'].includes(row.outcome) : row.outcome === filter));
  });
  const fragment = document.createDocumentFragment();
  for (const record of records) {
    const tr = document.createElement('tr'), th = document.createElement('th');
    th.scope = 'row';
    const title = document.createElement('strong'), path = document.createElement('span');
    title.textContent = record.routeId; path.textContent = routes.get(record.routeId)?.path ?? record.routeId;
    th.append(title, path); tr.append(th);
    for (const value of [new Date(record.at).toLocaleTimeString(), record.method,
      names[record.outcome] ?? record.outcome, record.status === null ? 'Not sent' : record.status,
      record.durationMs]) {
      const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
    }
    if (record.outcome === 'serverError' || record.outcome === 'disconnected') tr.className = 'attention';
    fragment.append(tr);
  }
  $('outcomes').replaceChildren(fragment);
  $('outcomes-empty').hidden = records.length > 0;
  $('outcomes-empty').textContent = snapshot.recentLimit === 0 ? 'Individual outcomes are disabled for this operator.' :
    (snapshot.recent?.length ? 'No retained outcomes match these filters.' : 'No outcomes retained yet.');
  $('outcome-retention').textContent = `Latest ${snapshot.recent?.length ?? 0} of up to ${snapshot.recentLimit ?? 0} outcomes · metadata only · memory only`;
}
export function renderRecentOutcomes(value) {
  snapshot = value;
  if (!listening && $('outcomes')) {
    $('outcome-route').addEventListener('input', draw);
    $('outcome-kind').addEventListener('change', draw); listening = true;
  }
  draw();
}
