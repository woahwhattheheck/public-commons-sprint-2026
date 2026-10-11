// MIT. Review every original SF30 receiving option with the native SAC reader.
import { compileHttpSellerOffer } from '../sf30-seller-sdk/seller.mjs';
import { compileSellerRoutes } from '../sf30-seller-sdk/resource-server.mjs';
import { compileAssetRouteOffer } from '../sf30-seller-sdk/response-asset.mjs';
import { createSacRecipientReviewer, SacReadinessError } from './sac.mjs';
import { sha256 } from './readiness.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, code) => { if (!condition) throw new SacReadinessError(code); };
const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const receivingActions = {
  ASSET_TRUSTLINE_MISSING:'Create the exact code-and-issuer trustline on this receiving account through the existing wallet.',
  ASSET_TRUSTLINE_NOT_AUTHORIZED:'Ask the asset issuer to authorize this exact merchant trustline.',
  INSUFFICIENT_INBOUND_TRUSTLINE_CAPACITY:'Increase the exact trustline limit or reduce this configured incoming amount.',
  NATIVE_RECIPIENT_NOT_AUTHORIZED:'Have the asset administrator authorize this exact receiving address.',
  NATIVE_INBOUND_CAPACITY_EXCEEDED:'Reduce the incoming amount or receiving balance to fit the native account limit.',
  TOKEN_BALANCE_LIMIT_EXCEEDED:'Reduce the incoming amount or receiving balance to fit this token’s atomic balance range.',
  CLASSIC_RECIPIENT_AMOUNT_OUT_OF_RANGE:'Set this G-account quote within the signed 64-bit atomic amount range.',
  ISSUER_RECEIVE_POLICY_REVIEW_REQUIRED:'Review the issuer-recipient choice with the merchant; a SAC transfer to its issuer burns the asset.',
  SAC_INSTANCE_MISSING:'Locate or deploy this exact SAC on the selected network through the existing operator process.',
  SAC_INSTANCE_ARCHIVED:'Restore this exact archived SAC instance through the existing operator process.',
  CONTRACT_INSTANCE_MISSING_OR_ARCHIVED:'Inspect and restore or deploy this exact token on the selected network.',
  TOKEN_STATE_RESTORATION_REQUIRED:'Restore this token’s archived state through the existing operator process.',
  RPC_ENDPOINT_REQUIRED:'Provide the existing RPC endpoint for this network using --rpc-map.',
  HORIZON_HTTP_404:'Create or correct this merchant account on the selected network.',
  INVALID_G_ADDRESS:'Correct this option’s merchant receiving address.',
  CUSTOM_CONTRACT_RECEIVING_POLICY:'Apply this custom token’s own receiving policy alongside its observed metadata and balance.',
  NATIVE_CLASSIC_BALANCE_CHANGED:'Repeat after account activity settles; the native and classic balance observations differ.',
  NATIVE_CLASSIC_AUTHORIZATION_CHANGED:'Reconcile the native authorization and classic trustline, then repeat the read.',
  RETAINED_SOURCE_REVIEW:'Use a new live receiving review for current merchant state.',
  OBSERVATION_STALE:'Run the command again to refresh the contributing account and contract observations.',
  SELLER_CONFIG_CHANGED_DURING_CHECK:'Review the current seller configuration in a new receiving run.',
};

/** Extract only public route identity and original normalized accepted payments. */
export function compileSellerReadinessPlan(input, {origin: suppliedOrigin} = {}) {
  check(object(input) && input.schema === 'stellar-forge.seller-service.v1' &&
    Array.isArray(input.routes) && input.routes.length > 0 && input.routes.length <= 64, 'SELLER_CONFIG_REQUIRED');
  const config = structuredClone(input);
  const selected = config.publicOrigin ?? suppliedOrigin;
  let origin = null, local = false;
  if (selected !== undefined) {
    let url;
    try { url = new URL(selected); } catch { throw new SacReadinessError('INVALID_PUBLIC_ORIGIN'); }
    local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && config.publicOrigin === undefined;
    check((local || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/' && url.origin === selected.replace(/\/$/,''), 'INVALID_PUBLIC_ORIGIN');
    if (suppliedOrigin && config.publicOrigin) check(new URL(suppliedOrigin).origin === url.origin, 'SELLER_ORIGIN_MISMATCH');
    origin = url.origin;
  }
  for (const route of config.routes) {
    check(object(route) && /^[A-Za-z0-9_-]{1,64}$/.test(route.id ?? '') && typeof route.path === 'string' &&
      /^\/[A-Za-z0-9_.~/:-]*$/.test(route.path) && !route.path.includes('//') && !route.path.startsWith('/_seller/') &&
      new URL(route.path,'https://seller.example').pathname === route.path &&
      Object.hasOwn(route,'definition') !== Object.hasOwn(route,'offer'), 'INVALID_SELLER_ROUTE');
    check(!route.definition || !Object.hasOwn(route.definition,'url') && !route.path.includes(':'), 'INVALID_SELLER_DEFINITION');
  }
  // The running seller owns normalization, imported offers, file offers, paths and header limits.
  // A definition without a public URL retains its relative path in the compatibility API.
  const compileOrigin = origin ?? 'https://seller.example';
  const compiled = compileSellerRoutes(config.routes.map(route => ({id:route.id,
    handler:() => { throw new SacReadinessError('READINESS_NEVER_INVOKES_APPLICATION'); },
    ...(route.responseAsset ? {offer:compileAssetRouteOffer(route,compileOrigin,compileHttpSellerOffer,local)} :
      route.offer ? {offer:route.offer} : {definition:{...route.definition,url:compileOrigin+route.path}}),
  })),{allowLocalhost:local});
  const routes = compiled.routes.map(route => {
    const source = config.routes.find(row => row.id === route.id);
    check(route.path === source.path && new URL(route.offer.resource.url).origin === compileOrigin, 'IMPORTED_SELLER_PATH_MISMATCH');
    return {id:route.id,method:route.method,path:route.path,url:origin ? route.offer.resource.url : route.path,
      resource:structuredClone(route.offer.resource),accepts:structuredClone(route.offer.accepts)};
  });
  return {schema:'stellar-forge.seller-readiness-plan.v1', publicOrigin:origin, routes};
}

/** Sequential options reuse run-scoped native reads without multiplying calls. */
export async function reviewSellerSacReadiness(config, options = {}) {
  const plan = compileSellerReadinessPlan(config,options);
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
  return summarizeMerchantReadiness({schema:'stellar-forge.seller-sac-readiness.v1',completedAt:new Date().toISOString(),
    planDigest:sha256(JSON.stringify(plan)),options:rows});
}

export function summarizeMerchantReadiness(report) {
  const summary = {routes:new Set(report.options.map(row=>row.routeId)).size, options:report.options.length,
    ready:0,actionRequired:0,configurationRequired:0,readFailed:0,reviewRequired:0};
  for (const row of report.options) summary[({SAC_RECIPIENT_READY:'ready',ACTION_REQUIRED:'actionRequired',
    CONFIGURATION_REQUIRED:'configurationRequired',READ_FAILED:'readFailed',REVIEW_REQUIRED:'reviewRequired'})[row.status] ?? 'reviewRequired']++;
  return {...report,summary,status:summary.ready === summary.options ? 'ALL_RECIPIENTS_READY' : 'MERCHANT_REVIEW_REQUIRED'};
}

export function merchantReadinessCsv(report) {
  const csv = value => { const raw = String(value ?? ''); return '"'+(/^[\s]*[=+@-]/.test(raw) ? "'"+raw : raw).replace(/"/g,'""')+'"'; };
  const columns = ['route_id','method','url','option_index','status','network','asset','pay_to','amount_atomic',
    'contract_state','horizon_ledger','rpc_ledger','trustline_authorization','inbound_capacity','reasons','account_advisories',
    'token_symbol','token_decimals','amount_decimal','balance_atomic'];
  const rows = report.options.map(row => { const r = row.readiness; return [row.routeId,row.method,row.url,row.optionIndex,
    row.status,row.terms.network,row.terms.asset,row.terms.payTo,row.terms.amount,r?.contract?.state,
    r?.classic?.ledger.sequence,r?.contract?.latestLedger,r?.classic?.recipient.authorization,r?.classic?.recipient.inboundCapacity,
    r ? r.reasons.join(';') : row.errorCode,r?.accountAdvisories?.join(';'),r?.native?.token?.symbol,r?.native?.token?.decimals,
    r?.native?.amountDecimal,r?.native?.recipient?.balanceAtomic]; });
  return [columns,...rows].map(row => row.map(csv).join(',')).join('\n')+'\n';
}

export function merchantReadinessHtml(report) {
  const rows = report.options.map(row => {
    const r = row.readiness, reasons = r ? r.reasons.join(', ') || 'Receiving checks passed' : row.errorCode;
    const actions = (r?.reasons ?? [row.errorCode]).filter(code=>receivingActions[code]);
    const fields = r?.classic ? `<dl><dt>Contract</dt><dd>${escape(r.contract.state)}</dd><dt>Classic asset</dt><dd>${escape(
      r.mapping.classicAsset === 'native' ? 'XLM' : r.mapping.classicAsset.code+' · '+r.mapping.classicAsset.issuer)}</dd>
      <dt>Trustline authorization</dt><dd>${escape(r.classic.recipient.authorization)}</dd>
      <dt>Requested amount</dt><dd>${escape(r.classic.recipient.amountRequested)}</dd>
      <dt>Remaining capacity</dt><dd>${escape(r.classic.recipient.inboundCapacity ?? 'Native XLM balance limit checked')}</dd>
      <dt>Reserve / spendable XLM</dt><dd>${escape(r.classic.account.minimumReserveXlm)} / ${escape(r.classic.account.availableXlm)}</dd>
      <dt>Horizon / RPC ledger</dt><dd>${r.classic.ledger.sequence} / ${r.contract.latestLedger}</dd>
      <dt>Read started</dt><dd>${escape(new Date(r.observedAtMs).toISOString())}</dd>
      <dt>Account operations</dt><dd>${escape(r.accountAdvisories.join(', ') || 'No additional account action observed')}</dd></dl>` : '';
    const native = r?.native;
    const tokenFields = native ? `<dl><dt>Native token kind</dt><dd>${escape(native.token?.kind)}</dd>
      <dt>Token amount</dt><dd>${escape(native.amountDecimal)} ${escape(native.token?.symbol)}</dd>
      <dt>Balance in atomic units</dt><dd>${escape(native.recipient?.balanceAtomic)}</dd>
      <dt>Native receiving authorization</dt><dd>${escape(native.recipient?.authorized)}</dd></dl>` : '';
    return `<section id="option-${row.optionId}"><h2>${escape(row.method)} ${escape(row.path)} · option ${row.optionIndex+1}</h2>
      <p class="state">${escape(row.status)}</p><p>${escape(reasons)}</p>
      <dl><dt>Resource</dt><dd>${escape(row.url)}</dd><dt>Network</dt><dd>${escape(row.terms.network)}</dd>
      <dt>Token contract</dt><dd>${escape(row.terms.asset)}</dd><dt>Recipient</dt><dd>${escape(row.terms.payTo)}</dd>
      <dt>Atomic amount</dt><dd>${escape(row.terms.amount)}</dd></dl>${fields}${tokenFields}
      ${actions.length?'<h3>Operator actions</h3><ul>'+actions.map(code=>'<li>'+escape(receivingActions[code])+'</li>').join('')+'</ul>':''}</section>`;
  }).join('');
  const comparison = report.comparison ? `<section><h2>Changes since ${escape(report.comparison.previousCompletedAt)}</h2><ul>${report.comparison.options
    .filter(row=>row.change!=='UNCHANGED').map(row=>`<li>${escape(row.routeId)} option ${row.optionIndex+1}: ${escape(row.change)} · ${escape(row.before)} → ${escape(row.after)}${row.resolved.length?'; resolved '+escape(row.resolved.join(', ')):''}</li>`).join('') || '<li>Same option states and receiving actions.</li>'}</ul></section>` : '';
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
    ${report.summary.readFailed} reads failed · ${report.summary.reviewRequired ?? 0} require source/policy review</p>
    <p>${escape(report.completedAt)} · ${escape(report.mode ?? 'LIVE_NETWORK_READS')}</p></header>${comparison}${rows}
    <footer>Receiving state is observed for each exact configured amount, token, network and account. Re-run after account or seller changes.
    Contract execution, fee sponsorship and settlement remain with the running payment provider.</footer></html>\n`;
}
