// MIT. Retained facilitator changes inside the original merchant release console.
const $ = selector => document.querySelector(selector);
const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
const validId = value => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const payment = values => values.map(value => value.amount + ' atomic · ' + value.asset + '\n' +
  value.scheme + ' · ' + value.network + ' → ' + value.payTo + '\nTimeout ' + value.maxTimeoutSeconds + ' seconds' +
  (value.extra ? '\n' + JSON.stringify(value.extra, null, 2) : '')).join('\n\n');

function paymentTable(value, { before } = {}) {
  const scroll = node('div'); scroll.className = 'table-scroll';
  const table = node('table'), head = node('thead'), heading = node('tr'), body = node('tbody');
  for (const title of ['Resource', before ? 'Previously reviewed native terms' : 'Stored payment declarations', 'Reviewed native requirements'])
    heading.append(node('th', title));
  head.append(heading); table.append(head, body); scroll.append(table);
  const previous = new Map((before?.nativePayments ?? []).map(item => [item.routeId, item]));
  for (const item of value.nativePayments) {
    const row = node('tr'), route = node('td'), stored = node('td'), native = node('td');
    route.append(node('strong', item.method + ' · ' + item.routeId), node('div', item.url));
    const prior = before ? previous.get(item.routeId)?.nativePayment : item.storedPayment;
    stored.append(node('p', prior ? prior.length + ' payment alternatives' : 'No earlier native review'),
      node('pre', prior ? payment(prior) : 'The earlier release has no retained native requirements.'));
    native.append(node('p', item.nativePayment.length + ' payment alternatives'), node('pre', payment(item.nativePayment)));
    row.append(route, stored, native); body.append(row);
  }
  return scroll;
}

/** The original release diff also shows the review after console/MCP reopen. */
export function renderFacilitatorChange(before, after) {
  const section = node('section'); section.className = 'change facilitator-retained-review';
  section.append(node('h3', 'Reviewed native payment requirements'));
  if (!after) {
    section.append(node('p', 'The selected release has no retained facilitator review. Its native startup uses its original configured provider.'));
    if (before) section.append(paymentTable(before));
    return section;
  }
  section.append(node('p', after.proposed.provider.label + ' · ' + after.proposed.provider.url),
    node('p', 'Reviewed ' + new Date(after.observedAt).toLocaleString() + ' with native SDK ' + after.nativeSdk +
      '. Startup compares the actual generated payment alternatives with these retained values before serving requests.'),
    paymentTable(after, { before }));
  const details = node('details'); details.append(node('summary', 'Retained provider capabilities and review identity'),
    node('pre', JSON.stringify({ id: after.id, supportedSha256: after.supportedSha256, supported: after.supported }, null, 2)));
  section.append(details); return section;
}

export function bindFacilitatorControls({ request, notice, refresh, choose, isBusy, setBusy }) {
  let profiles = null, release = null, review = null;
  const clear = () => { review = null; $('#facilitator-review-panel').hidden = true; };
  const buttons = blocked => {
    const ready = profiles?.configured && release;
    for (const selector of ['#facilitator-provider', '#facilitator-id', '#facilitator-label']) $(selector).disabled = blocked || !ready;
    $('#facilitator-review').disabled = blocked || !ready || !$('#facilitator-provider').value ||
      !validId($('#facilitator-id').value.trim()) || $('#facilitator-id').value.trim() === release?.id;
    $('#facilitator-stage').disabled = blocked || !review?.compatible;
    $('#facilitator-download').disabled = blocked || !review;
  };
  const selectRelease = value => {
    if (release?.id !== value.id || release?.digest !== value.digest) {
      clear(); $('#facilitator-id').value = value.id.slice(0, 48) + '-provider'; $('#facilitator-label').value = '';
    }
    release = value;
    $('#facilitator-source').textContent = 'Retain release ' + value.id + '. Current facilitator: ' +
      (value.runtime.facilitator ?? 'Challenge only') + '. Its compiled resources and payment declarations stay with this source.';
    buttons(isBusy());
  };
  const refreshProfiles = async () => {
    profiles = await request('/api/facilitators');
    const select = $('#facilitator-provider'), previous = select.value;
    select.replaceChildren(...profiles.providers.map(value => {
      const option = node('option', value.label + ' · ' + value.url); option.value = value.alias; return option;
    }));
    if (profiles.providers.some(value => value.alias === previous)) select.value = previous;
    $('#facilitator-form').hidden = !profiles.configured;
    $('#facilitator-setup').hidden = profiles.configured;
    buttons(isBusy());
  };
  const renderReview = value => {
    review = value;
    $('#facilitator-review-state').textContent = value.compatible ? 'Native configuration accepted' : 'Provider unavailable or incompatible';
    $('#facilitator-review-description').textContent = value.compatible
      ? 'Stage ' + value.proposed.id + ' with ' + value.proposed.provider.url + '. Read at ' + new Date(value.observedAt).toLocaleString() +
        '. Review every alternative below, including fee sponsorship. Startup reads the provider again and requires the same generated terms before serving.'
      : value.error?.message ?? 'The native provider configuration could not be prepared.';
    const rows = $('#facilitator-payments'); rows.replaceChildren();
    for (const item of value.nativePayments) {
      const row = node('tr'), route = node('td');
      route.append(node('strong', item.method + ' · ' + item.routeId), node('div', item.url));
      const stored = node('td'), native = node('td');
      stored.append(node('p', item.storedPayment.length + ' payment alternatives'), node('pre', payment(item.storedPayment)));
      native.append(node('p', item.nativePayment.length + ' payment alternatives'), node('pre', payment(item.nativePayment)));
      if (item.changes.length) native.append(node('p', 'Native fields changed: ' + [...new Set(item.changes.map(change => change.field))].join(', ')));
      row.append(route, stored, native); rows.append(row);
    }
    $('#facilitator-supported').textContent = value.supported ? JSON.stringify(value.supported, null, 2) : 'No supported response was returned.';
    $('#facilitator-review-panel').hidden = false;
    buttons(isBusy());
  };
  for (const selector of ['#facilitator-provider', '#facilitator-id', '#facilitator-label'])
    $(selector).addEventListener('input', () => { clear(); buttons(isBusy()); });
  $('#facilitator-review').addEventListener('click', async () => {
    if (isBusy() || !release) return;
    setBusy(true); clear();
    notice('Reading the selected provider’s native capabilities…');
    try {
      const label = $('#facilitator-label').value.trim();
      renderReview(await request('/api/facilitator/review', { provider: $('#facilitator-provider').value,
        releaseId: release.id, id: $('#facilitator-id').value.trim(), ...(label ? { label } : {}) }));
      notice(review.compatible ? 'Provider review is ready. Stage the reviewed release, then use the existing comparison and selection controls.'
        : 'This provider could not support the complete retained native configuration.', !review.compatible);
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); }
  });
  $('#facilitator-stage').addEventListener('click', async () => {
    if (isBusy() || !review?.compatible) return;
    const accepted = review; setBusy(true);
    try {
      const result = await request('/api/facilitator/stage', { reviewId: accepted.id });
      clear(); await refresh(); await choose(result.release.id);
      notice((result.reused ? 'Reopened the retained release ' : 'Prepared release ') + result.release.id +
        '. Compare and select it above, then restart your seller when ready.');
    } catch (error) {
      await refresh();
      notice(error.message + ' Prepared release ID: ' + accepted.proposed.id + '. Inspect the release list after a lost reply.', true);
    } finally { setBusy(false); }
  });
  $('#facilitator-download').addEventListener('click', () => {
    if (isBusy() || !review) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(review, null, 2) + '\n'], { type: 'application/json' }));
    const link = node('a', 'Download facilitator review'); link.href = url;
    link.download = review.proposed.id + '.facilitator-review.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  return { buttons, selectRelease, refresh: refreshProfiles };
}
