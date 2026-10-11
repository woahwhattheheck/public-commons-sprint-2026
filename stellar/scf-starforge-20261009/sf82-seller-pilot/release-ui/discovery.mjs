// MIT. Discovery enrollment and ownership inside the original merchant console.
const $ = selector => document.querySelector(selector);
const node = (tag, text) => { const value = document.createElement(tag); value.textContent = text; return value; };
const labels = { allowedOrigins: 'Resource origins', allowedRecipients: 'Payment recipients',
  allowedNetworks: 'Payment networks', allowedSchemes: 'Payment schemes' };

export function bindDiscoveryControls({ request, notice, refresh, isBusy, setBusy }) {
  let state = null, release = null, review = null;
  const clearReview = () => { review = null; $('#discovery-review-panel').hidden = true; };
  const buttons = blocked => {
    const fresh = state?.state === 'NEW';
    $('#discovery-seller').disabled = blocked || !fresh;
    $('#discovery-source').disabled = blocked || !fresh;
    $('#discovery-review').disabled = blocked || !fresh || !release ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test($('#discovery-seller').value.trim());
    $('#discovery-create').disabled = blocked || !fresh || !review;
    $('#discovery-start').disabled = blocked || state?.state !== 'CONFIGURED';
    $('#discovery-stop').disabled = blocked || !state?.managesCatalog;
    $('#discovery-enrollment').disabled = blocked || !['CONFIGURED', 'RUNNING'].includes(state?.state);
  };
  const details = (target, value) => {
    const list = $(target); list.replaceChildren();
    for (const [name, values] of Object.entries(value.permissions)) {
      list.append(node('dt', labels[name]), node('dd', values.join('\n')));
    }
  };
  const resources = (target, source) => {
    const rows = $(target); rows.replaceChildren();
    for (const resource of source.resources) {
      const row = node('tr', ''), route = node('td', ''), terms = node('td', '');
      route.append(node('strong', resource.method + ' · ' + resource.routeId), node('div', resource.url));
      terms.append(node('pre', resource.payment.map(payment => payment.amount + ' atomic · ' + payment.asset +
        '\n' + payment.scheme + ' · ' + payment.network + ' → ' + payment.payTo).join('\n\n')));
      row.append(route, terms); rows.append(row);
    }
  };
  const render = value => {
    state = value;
    if (value.state !== 'NEW') clearReview();
    $('#discovery-state').textContent = value.state.replaceAll('_', ' ');
    $('#discovery-create-form').hidden = value.state !== 'NEW';
    $('#discovery-existing').hidden = !['CONFIGURED', 'RUNNING'].includes(value.state);
    $('#discovery-controls').hidden = !['CONFIGURED', 'RUNNING'].includes(value.state) && !value.managesCatalog;
    $('#discovery-destination').textContent = value.directory ?? 'Existing catalog connection supplied by the host.';
    $('#discovery-ownership').hidden = !value.enabled;
    $('#discovery-description').textContent = value.state === 'NEW'
      ? 'Choose a retained release, review its exact payment recipients and resources, then create your discovery identity. Setup is saved in the destination below.'
      : value.state === 'EXTERNAL' ? 'This console uses the existing catalog connection supplied when it opened. Manage that writer from its original process.'
      : value.state === 'UNAVAILABLE' ? value.error.message
      : value.state === 'RUNNING' ? 'This console owns discovery at ' + value.discoveryOrigin + '. Use Catalog publication below to publish, update or withdraw listings.'
      : 'Your retained discovery identity is ready. Start discovery to reopen the same catalog history and publication controls.';
    if (value.source) {
      $('#discovery-identity').replaceChildren(node('dt', 'Seller identity'), node('dd', value.sellerId),
        node('dt', 'Public key fingerprint'), node('dd', value.publicKeySha256),
        node('dt', 'Original enrollment release'), node('dd', value.source.releaseId),
        node('dt', 'Public offer export'), node('dd', value.source.sourceURL));
      details('#discovery-permissions', value); resources('#discovery-resources', value.source);
    }
    buttons(isBusy());
  };
  const refreshState = async () => render(await request('/api/discovery'));
  const selectRelease = value => {
    if (release?.id !== value.id) clearReview();
    release = value;
    $('#discovery-source').placeholder = value.publicOrigin + '/_seller/offers';
    buttons(isBusy());
  };
  const action = async (name, payload, message) => {
    if (isBusy()) return;
    setBusy(true);
    try {
      await request('/api/discovery/' + name, payload);
      clearReview(); await refresh(); notice(message);
    } catch (error) {
      clearReview(); await refresh(); notice(error.message, true);
    } finally { setBusy(false); }
  };
  $('#discovery-review').addEventListener('click', async () => {
    if (isBusy() || !release) return;
    setBusy(true); clearReview();
    try {
      const sourceURL = $('#discovery-source').value.trim();
      review = await request('/api/discovery/review', { id: release.id, sellerId: $('#discovery-seller').value.trim(),
        ...(sourceURL ? { sourceURL } : {}) });
      $('#discovery-review-description').textContent = 'Create seller ' + review.sellerId + ' from release ' + review.source.releaseId +
        '. Public export: ' + review.source.sourceURL + '. A new private signing identity will be saved in ' + review.directory + '.';
      details('#discovery-review-permissions', review); resources('#discovery-review-resources', review.source);
      $('#discovery-review-panel').hidden = false;
      notice('Review the exact enrollment below. Create reviewed identity saves it once.');
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); }
  });
  for (const id of ['#discovery-seller', '#discovery-source']) $(id).addEventListener('input', () => {
    clearReview(); buttons(isBusy());
  });
  $('#discovery-create').addEventListener('click', () => {
    if (review) action('create', { reviewId: review.id }, 'Discovery identity and enrollment saved. Start discovery to publish this merchant.');
  });
  $('#discovery-start').addEventListener('click', () => action('start', {}, 'Discovery is running with the retained identity and catalog history.'));
  $('#discovery-stop').addEventListener('click', () => action('stop', { instanceId: state?.instanceId }, 'Discovery stopped. Its identity and catalog history are retained.'));
  $('#discovery-enrollment').addEventListener('click', async () => {
    if (isBusy()) return;
    setBusy(true);
    try {
      const enrollment = await request('/api/discovery/enrollment');
      const url = URL.createObjectURL(new Blob([JSON.stringify(enrollment, null, 2) + '\n'], { type: 'application/json' }));
      const link = node('a', 'Download seller enrollment'); link.href = url;
      link.download = enrollment.seller.sellerId.replace(/[^A-Za-z0-9_.-]/g, '-') + '.seller-enrollment.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
      notice('Public seller enrollment downloaded. It contains the public key, exact permissions and original resource offers.');
    } catch (error) { notice(error.message, true); }
    finally { setBusy(false); }
  });
  return { refresh: refreshState, selectRelease, buttons,
    catalogHint: () => state?.state === 'NEW' ? 'Create and start discovery above to publish this merchant’s offers.'
      : state?.enabled ? 'Start discovery above to inspect and publish this merchant’s offers.' : 'Choose a release to inspect its catalog listings.' };
}
