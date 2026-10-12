// MIT. Tenant/slot selection around the original retained customer SDK controls.
import { bindClientControls } from './original-client.mjs';
const $ = id => document.getElementById(id);
const scopeKey = value => value ? value.tenant + '/' + value.slot : '';
const messages = {
  FLEET_CLIENT_CLOSING: 'The fleet is closing. Reopen the same workspace to continue this retained handover.',
  FLEET_CLIENT_DIRECTORY: 'The host customer directory needs its original private permissions.',
  CLIENT_EXPORT_EXISTS: 'That client ID is already retained in this slot. Inspect it to recover the completed or interrupted handover.',
  INSTANCE_CONFLICT: 'The selected seller instance changed. Refresh the fleet and generate from its current owned instance.',
  CLIENT_REVIEW_CHANGED: 'The completion receipt changed. Inspect the retained client again before downloading.',
  CLIENT_EXPORT_FILE_CHANGED: 'A retained payload differs from its completion receipt. Restore the original file before delivery.',
  CLIENT_EXPORT_IDENTITY_CONFLICT: 'The retained files changed after review. Inspect this client again.',
  CLIENT_EXPORT_INCOMPLETE: 'The handover stopped before completion. Inspect this ID to recover its retained files.',
  WORKSPACE_OPERATION_OUTCOME_UNKNOWN: 'The response was lost. Inspect this exact client ID before choosing another export.',
};
function options(select, values, chosen) {
  const current = [...select.options].map(row => [row.value, row.textContent]);
  if (JSON.stringify(current) !== JSON.stringify(values))
    select.replaceChildren(...values.map(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
    }));
  if (chosen !== undefined) select.value = chosen;
}

export function bindFleetClientControls({ request, getReleases, isBusy, setBusy }) {
  let selected, controls, loaded, stopped = false;
  const drafts = new Map();
  const current = () => {
    const tenant = getReleases()?.tenants?.find(row => row.id === selected?.tenant);
    const slot = tenant?.slots.find(row => row.name === selected?.slot);
    return { tenant, slot };
  };
  const snapshot = () => {
    const { slot } = current();
    return { console: { managesRunningSeller: Boolean(slot?.owned && !getReleases()?.closing),
      instanceId: slot?.instanceId ?? null } };
  };
  async function scopedRequest(path, body, settings) {
    if (!selected) throw new Error('Select a merchant and release slot.');
    const scope = { ...selected }, target = new URL(path, location.origin);
    if (!/^\/api\/clients(?:\/[a-z]+)?$/.test(target.pathname)) throw new Error('Unknown original customer operation.');
    const route = 'releases' + target.pathname.slice('/api'.length);
    let result;
    try {
      if (body !== undefined) result = await request(route, { ...body, ...scope }, settings);
      else {
        target.searchParams.set('tenant', scope.tenant); target.searchParams.set('slot', scope.slot);
        result = await request(route + '?' + target.searchParams, undefined, settings);
      }
    } catch (error) { throw new Error(messages[error.message] ?? error.message); }
    if (!settings?.raw && (result.tenant !== scope.tenant || result.slot !== scope.slot))
      throw new Error('The returned handover belongs to another merchant or slot. Refresh this view.');
    return result;
  }
  function update() {
    const releases = getReleases(), tenants = releases?.tenants ?? [];
    $('fleet-clients').hidden = !tenants.length;
    if (!tenants.length || stopped) return;
    if (!selected || !tenants.some(row => row.id === selected.tenant)) {
      const first = tenants[0];
      selected = { tenant: first.id, slot: first.slots.find(row => row.serving)?.name ?? first.slots[0].name };
    }
    const { tenant, slot } = current();
    options($('client-tenant'), tenants.map(row => [row.id, row.id + ' · ' + row.host]), selected.tenant);
    options($('client-slot'), tenant.slots.map(row => [row.name, row.name +
      (row.serving ? ' · serving' : row.owned ? ' · running' : ' · retained exports')]), selected.slot);
    for (const id of ['client-tenant', 'client-slot']) $(id).disabled = isBusy();
    $('client-scope').textContent = tenant.id + ' / ' + selected.slot + ' · ' + tenant.host;
    $('client-owner').textContent = slot?.owned
      ? 'Current owned release ' + slot.runningReleaseId + ' · instance ' + slot.instanceId +
        '. New customer clients retain this exact release and its terms.'
      : 'This slot has no running seller. Its completed customer clients remain available for inspection and download.';
    controls?.buttons();
  }
  const busy = value => { setBusy(value); update(); };
  controls = bindClientControls({ request: scopedRequest, getSnapshot: snapshot, isBusy, setBusy: busy });
  async function select(tenant, slot, focus = false) {
    if (isBusy() || stopped) return;
    const merchant = getReleases()?.tenants.find(row => row.id === tenant);
    if (!merchant?.slots.some(row => row.name === slot)) return;
    if (selected) drafts.set(scopeKey(selected), $('client-export-id').value);
    busy(true);
    try {
      // The original controller cancels and observes its previous download
      // before clearing a review or displaying another tenant's retained files.
      await controls.reset({ exportId: drafts.get(tenant + '/' + slot) ?? '' });
      selected = { tenant, slot }; loaded = undefined; update();
      await controls.refresh(); loaded = scopeKey(selected);
      if (focus) { $('fleet-clients').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('client-export-id').focus(); }
    } catch (error) { $('client-notice').textContent = error.message; $('client-notice').classList.add('error'); }
    finally { busy(false); }
  }
  $('client-tenant').addEventListener('change', () => {
    const merchant = getReleases()?.tenants.find(row => row.id === $('client-tenant').value);
    if (merchant) void select(merchant.id, merchant.slots.find(row => row.serving)?.name ?? merchant.slots[0].name);
  });
  $('client-slot').addEventListener('change', () => void select(selected.tenant, $('client-slot').value));
  return { update,
    open(tenant, slot) { return select(tenant, slot, true); },
    async refresh() {
      update(); if (!selected || stopped || isBusy()) return;
      if (loaded !== scopeKey(selected)) return select(selected.tenant, selected.slot);
      busy(true); try { await controls.refresh(); } finally { busy(false); }
    },
    close() { stopped = true; return controls.close(); },
  };
}
