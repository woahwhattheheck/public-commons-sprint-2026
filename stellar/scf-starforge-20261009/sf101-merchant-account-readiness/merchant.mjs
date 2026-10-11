// MIT. Review every original SF30 receiving option with the native SAC reader.
import { isDeepStrictEqual } from 'node:util';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../sf30-seller-sdk/seller.mjs';
import { supportsSellerMethod, requiresJsonBody } from '../sf30-seller-sdk/http-methods.mjs';
import { compileServicePath } from '../sf30-seller-sdk/route-path.mjs';
import { createSacRecipientReviewer, SacReadinessError } from './sac.mjs';
import { sha256 } from './readiness.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, code) => { if (!condition) throw new SacReadinessError(code); };
const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

/** Extract only public route identity and original normalized accepted payments. */
export function compileSellerReadinessPlan(input) {
  check(object(input) && input.schema === 'stellar-forge.seller-service.v1' &&
    Array.isArray(input.routes) && input.routes.length > 0 && input.routes.length <= 64, 'SELLER_CONFIG_REQUIRED');
  const config = structuredClone(input), ids = new Set();
  let origin = null;
  if (config.publicOrigin !== undefined) {
    let url;
    try { url = new URL(config.publicOrigin); } catch { throw new SacReadinessError('INVALID_PUBLIC_ORIGIN'); }
    check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/' && url.origin === config.publicOrigin.replace(/\/$/,''), 'INVALID_PUBLIC_ORIGIN');
    origin = url.origin;
  }
  const routes = config.routes.map(route => {
    check(object(route) && typeof route.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(route.id) &&
      !ids.has(route.id) && typeof route.path === 'string' && /^\/[A-Za-z0-9_.~/:-]*$/.test(route.path) &&
      !route.path.includes('//') && !route.path.startsWith('/_seller/') &&
      new URL(route.path,'https://seller.example').pathname === route.path, 'INVALID_SELLER_ROUTE');
    ids.add(route.id);
    check(Object.hasOwn(route,'definition') !== Object.hasOwn(route,'offer'), 'ONE_SELLER_OFFER_REQUIRED');
    const imported = Object.hasOwn(route,'offer');
    const url = imported ? route.offer?.resource?.url : origin ? origin + route.path : route.path;
    check(typeof url === 'string', 'INVALID_SELLER_URL');
    let checked;
    if (imported) {
      let parsed;
      try { parsed = new URL(url); } catch { throw new SacReadinessError('INVALID_SELLER_URL'); }
      check(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash &&
        origin === parsed.origin, 'IMPORTED_SELLER_ORIGIN_MISMATCH');
      const input = route.offer?.extensions?.bazaar?.info?.input;
      check(route.offer?.x402Version === 2 && input?.type === 'http' && supportsSellerMethod(input.method) &&
        (!requiresJsonBody(input.method) || input.bodyType === 'json'), 'INVALID_IMPORTED_SELLER_OFFER');
      checked = compileHttpSellerOffer({url, method:input.method,
        description:route.offer.resource.description ?? 'Imported API resource',
        serviceName:route.offer.resource.serviceName, tags:route.offer.resource.tags,
        paymentOptions:route.offer.accepts,
        ...(requiresJsonBody(input.method) ? {bodyType:'json',body:input.body} : {}),
      });
      check(checked.resource.url === url && isDeepStrictEqual(checked.accepts,route.offer.accepts),
        'NONCANONICAL_IMPORTED_SELLER_OFFER');
      check(compileServicePath(route.offer).path === route.path, 'IMPORTED_SELLER_PATH_MISMATCH');
      paymentRequiredResponse(route.offer);
    } else {
      check(object(route.definition) && !Object.hasOwn(route.definition,'url') &&
        route.definition.routeTemplate === undefined && !route.path.includes(':'), 'INVALID_SELLER_DEFINITION');
      // A local service has no public URL yet; the placeholder only validates its definition.
      checked = compileHttpSellerOffer({...route.definition,url:origin ? url : 'https://seller.example'+route.path});
      check(!requiresJsonBody(checked.extensions.bazaar.info.input.method) ||
        checked.extensions.bazaar.info.input.bodyType === 'json', 'INVALID_SELLER_BODY_TYPE');
      paymentRequiredResponse(checked);
    }
    return {id:route.id,method:checked.extensions.bazaar.info.input.method,path:route.path,url,accepts:checked.accepts};
  });
  return {schema:'stellar-forge.seller-readiness-plan.v1', publicOrigin:origin, routes};
}

/** Sequential options reuse run-scoped native reads without multiplying calls. */
export async function reviewSellerSacReadiness(config, options = {}) {
  const plan = compileSellerReadinessPlan(config);
  const reviewer = options.reviewer ?? await createSacRecipientReviewer(options), rows = [];
  check(typeof reviewer?.review === 'function', 'SAC_REVIEWER_REQUIRED');
  for (const route of plan.routes) {
    for (const [optionIndex, terms] of route.accepts.entries()) {
      const row = {routeId:route.id,method:route.method,path:route.path,url:route.url,optionIndex,terms,
        optionId:sha256(JSON.stringify([route.id,route.method,optionIndex,terms]))};
      try {
        const readiness = await reviewer.review(terms);
        rows.push({...row,status:readiness.status,readiness});
      } catch (error) {
        const errorCode = typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)
          ? error.code : 'READINESS_READ_FAILED';
        const configuration = ['SAC_ASSET_MAPPING_REQUIRED','RPC_ENDPOINT_REQUIRED','INVALID_RPC_ENDPOINT',
          'CLASSIC_RECIPIENT_AMOUNT_OUT_OF_RANGE','INVALID_G_ADDRESS','UNSUPPORTED_PAYMENT_PROFILE'].includes(errorCode);
        rows.push({...row,status:configuration ? 'CONFIGURATION_REQUIRED' : 'READ_FAILED',errorCode});
      }
    }
  }
  const summary = {routes:plan.routes.length, options:rows.length, ready:0, actionRequired:0, configurationRequired:0, readFailed:0};
  for (const row of rows) summary[({SAC_RECIPIENT_READY:'ready',ACTION_REQUIRED:'actionRequired',
    CONFIGURATION_REQUIRED:'configurationRequired',READ_FAILED:'readFailed'})[row.status]]++;
  return {schema:'stellar-forge.seller-sac-readiness.v1',completedAt:new Date().toISOString(),
    status:summary.ready === summary.options ? 'ALL_RECIPIENTS_READY' : 'MERCHANT_REVIEW_REQUIRED',
    planDigest:sha256(JSON.stringify(plan)),summary,options:rows};
}

export function merchantReadinessCsv(report) {
  const csv = value => '"'+String(value ?? '').replace(/"/g,'""')+'"';
  const columns = ['route_id','method','url','option_index','status','network','asset','pay_to','amount_atomic',
    'contract_state','horizon_ledger','rpc_ledger','trustline_authorization','inbound_capacity','reasons','account_advisories'];
  const rows = report.options.map(row => { const r = row.readiness; return [row.routeId,row.method,row.url,row.optionIndex,
    row.status,row.terms.network,row.terms.asset,row.terms.payTo,row.terms.amount,r?.contract.state,
    r?.classic.ledger.sequence,r?.contract.latestLedger,r?.classic.recipient.authorization,r?.classic.recipient.inboundCapacity,
    r ? r.reasons.join(';') : row.errorCode,r?.accountAdvisories.join(';')]; });
  return [columns,...rows].map(row => row.map(csv).join(',')).join('\n')+'\n';
}

export function merchantReadinessHtml(report) {
  const rows = report.options.map(row => {
    const r = row.readiness, reasons = r ? r.reasons.join(', ') || 'Receiving checks passed' : row.errorCode;
    const fields = r ? `<dl><dt>Contract</dt><dd>${escape(r.contract.state)}</dd><dt>Classic asset</dt><dd>${escape(
      r.mapping.classicAsset === 'native' ? 'XLM' : r.mapping.classicAsset.code+' · '+r.mapping.classicAsset.issuer)}</dd>
      <dt>Trustline authorization</dt><dd>${escape(r.classic.recipient.authorization)}</dd>
      <dt>Requested amount</dt><dd>${escape(r.classic.recipient.amountRequested)}</dd>
      <dt>Remaining capacity</dt><dd>${escape(r.classic.recipient.inboundCapacity ?? 'Native XLM balance limit checked')}</dd>
      <dt>Reserve / spendable XLM</dt><dd>${escape(r.classic.account.minimumReserveXlm)} / ${escape(r.classic.account.availableXlm)}</dd>
      <dt>Horizon / RPC ledger</dt><dd>${r.classic.ledger.sequence} / ${r.contract.latestLedger}</dd>
      <dt>Read started</dt><dd>${escape(new Date(r.observedAtMs).toISOString())}</dd>
      <dt>Account operations</dt><dd>${escape(r.accountAdvisories.join(', ') || 'No additional account action observed')}</dd></dl>` : '';
    return `<section id="option-${row.optionId}"><h2>${escape(row.method)} ${escape(row.path)} · option ${row.optionIndex+1}</h2>
      <p class="state">${escape(row.status)}</p><p>${escape(reasons)}</p>
      <dl><dt>Resource</dt><dd>${escape(row.url)}</dd><dt>Network</dt><dd>${escape(row.terms.network)}</dd>
      <dt>Token contract</dt><dd>${escape(row.terms.asset)}</dd><dt>Recipient</dt><dd>${escape(row.terms.payTo)}</dd>
      <dt>Atomic amount</dt><dd>${escape(row.terms.amount)}</dd></dl>${fields}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Merchant receiving review</title><style>
    *{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#f5f5f5;max-width:1100px;margin:0 auto;padding:28px}
    h1{font-size:24px;margin-bottom:8px}h2{font-size:17px;margin:0}header,section{background:white;border:1px solid #bbb;padding:22px;margin-bottom:20px}
    .state{font:600 13px ui-monospace,monospace;letter-spacing:.02em}dl{display:grid;grid-template-columns:190px minmax(0,1fr);gap:7px 18px}
    dt{color:#555}dd{margin:0;overflow-wrap:anywhere}footer{color:#555;font-size:13px}
    @media(max-width:600px){body{padding:12px}header,section{padding:16px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:9px}}
    @media print{body{background:white;padding:0}section{break-inside:avoid}}
    </style><header><h1>Merchant receiving review</h1><p class="state">${escape(report.status)}</p>
    <p>${report.summary.routes} routes · ${report.summary.options} payment choices · ${report.summary.ready} ready ·
    ${report.summary.actionRequired} need account attention · ${report.summary.configurationRequired} need configuration ·
    ${report.summary.readFailed} reads failed</p><p>${escape(report.completedAt)}</p></header>${rows}
    <footer>Receiving state is observed for each exact configured amount, token, network and account. Re-run after account or seller changes.
    Contract execution, fee sponsorship and settlement remain with the running payment provider.</footer></html>\n`;
}
