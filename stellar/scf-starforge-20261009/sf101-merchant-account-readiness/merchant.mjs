// MIT. One receiving review for the original seller's exact compiled payment choices.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readSellerConfig} from '../sf30-seller-sdk/serve.mjs';
import {compileSellerRoutes} from '../sf30-seller-sdk/resource-server.mjs';
import {compileHttpSellerOffer} from '../sf30-seller-sdk/seller.mjs';
import {compileAssetRouteOffer} from '../sf30-seller-sdk/response-asset.mjs';
import {formatAtomic} from '../sf16-asset-engine/assets.mjs';
import {evaluateSnapshots,fetchOfficialAccount,fetchOfficialLedger,amountText} from './readiness.mjs';
import {createNativeReader,createReadTransport,loadStellarSdk,NETWORKS,fault} from './native-reader.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serial = value => JSON.stringify(value);
const note = error => ({code:typeof error.code === 'string' ? error.code : typeof error.cause?.code === 'string' ? error.cause.code : 'READ_UNAVAILABLE',
  detail:String(error.message ?? error).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,300)});
const actions = {
  ASSET_CONTRACT_ADDRESS_INVALID:'Replace this option with its actual deployed token contract address.',
  RECIPIENT_ADDRESS_INVALID:'Correct the selected merchant receiving address.',
  PUBLIC_RPC_ENDPOINT_REQUIRED:'Provide the merchant’s existing public-network RPC endpoint with --rpc-public.',
  RPC_NETWORK_PASSPHRASE_MISMATCH:'Correct the RPC network; this endpoint reports a different Stellar network.',
  CONTRACT_INSTANCE_MISSING_OR_ARCHIVED:'Inspect this exact contract on the selected network and restore or deploy it through the merchant’s existing process.',
  TOKEN_STATE_RESTORATION_REQUIRED:'Restore this token’s archived state using the existing authorized operator process, then repeat the read.',
  TOKEN_GETTER_REQUIRES_AUTHORIZATION_OR_WRITE:'Review this contract’s token interface and receiving policy with its owner.',
  SAC_ASSET_IDENTITY_INVALID:'Review the deployed SAC metadata and its original asset identity.',
  SAC_CONTRACT_ID_MISMATCH:'Correct the contract or original asset identity for this selected network.',
  ASSET_TRUSTLINE_MISSING:'Create the exact code-and-issuer trustline on this merchant account through the existing wallet.',
  ASSET_TRUSTLINE_NOT_AUTHORIZED:'Have this asset’s issuer authorize the merchant’s exact trustline.',
  INSUFFICIENT_INBOUND_TRUSTLINE_CAPACITY:'Increase this exact trustline’s limit or reduce the configured incoming amount.',
  CLASSIC_AMOUNT_EXCEEDS_INT64:'Reduce this classic-account quote to the supported signed 64-bit atomic range.',
  ISSUER_RECEIVE_POLICY_REVIEW_REQUIRED:'Review the issuer-recipient configuration; a SAC transfer to its issuer burns the asset.',
  NATIVE_RECIPIENT_NOT_AUTHORIZED:'Have the asset administrator authorize this exact receiving address.',
  NATIVE_CLASSIC_BALANCE_CHANGED:'Repeat the read after the account activity settles; the RPC and Horizon balance observations differ.',
  NATIVE_CLASSIC_AUTHORIZATION_CHANGED:'Repeat the read and reconcile the RPC authorization with the classic trustline.',
  CUSTOM_CONTRACT_RECEIVING_POLICY:'Use this custom token’s own receiving policy alongside the observed metadata and balance.',
  TOKEN_BALANCE_LIMIT_EXCEEDED:'Reduce the quote or receiving balance to remain within the token’s atomic balance range.',
  HORIZON_HTTP_404:'Create or correct this merchant account on the selected network through the existing account setup.',
  HORIZON_LEDGER_UNAVAILABLE:'Restore access to the selected network’s official Horizon ledger endpoint and repeat the account read.',
};
const hard = new Set(['ASSET_CONTRACT_ADDRESS_INVALID','RECIPIENT_ADDRESS_INVALID','RPC_NETWORK_PASSPHRASE_MISMATCH',
  'CONTRACT_INSTANCE_MISSING_OR_ARCHIVED','TOKEN_STATE_RESTORATION_REQUIRED','SAC_ASSET_IDENTITY_INVALID',
  'SAC_CONTRACT_ID_MISMATCH','SAC_DECIMALS_MISMATCH','ASSET_TRUSTLINE_MISSING','ASSET_TRUSTLINE_NOT_AUTHORIZED',
  'INSUFFICIENT_INBOUND_TRUSTLINE_CAPACITY','CLASSIC_AMOUNT_EXCEEDS_INT64','ISSUER_RECEIVE_POLICY_REVIEW_REQUIRED',
  'NATIVE_RECIPIENT_NOT_AUTHORIZED','TOKEN_BALANCE_LIMIT_EXCEEDED','HORIZON_HTTP_404']);

export async function readMerchantReceivingPlan(configPath,{origin} = {}) {
  const path = resolve(configPath), before = await readFile(path);
  if (before.length > 1024 * 1024) throw fault('SELLER_CONFIG_TOO_LARGE');
  const config = await readSellerConfig(path);
  const after = await readFile(path);
  if (!before.equals(after)) throw fault('SELLER_CONFIG_CHANGED_DURING_READ');
  if (origin && config.publicOrigin && new URL(origin).origin !== new URL(config.publicOrigin).origin)
    throw fault('SELLER_ORIGIN_MISMATCH');
  const selected = config.publicOrigin ?? origin;
  if (!selected) throw fault('SELLER_ORIGIN_REQUIRED','Use the seller publicOrigin, or supply its actual loopback origin with --origin.');
  const url = new URL(selected), local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw fault('SELLER_ORIGIN_INVALID');
  const handler = () => { throw fault('READINESS_NEVER_INVOKES_APPLICATION'); };
  const compiled = compileSellerRoutes(config.routes.map(route => ({id:route.id,handler,
    ...(route.responseAsset ? {offer:compileAssetRouteOffer(route,url.origin,compileHttpSellerOffer,local)} :
      route.offer ? {offer:route.offer} : {definition:{...route.definition,url:url.origin + route.path}})})),{allowLocalhost:local});
  const routes = compiled.routes.map(route => ({id:route.id,method:route.method,path:route.path,
    resource:structuredClone(route.offer.resource),paymentChoices:structuredClone(route.offer.accepts)}));
  const configuration = {sha256:hash(before),bytes:before.length,publicOrigin:url.origin};
  const options = routes.flatMap(route => route.paymentChoices.map((payment,index) => ({
    optionId:hash(serial([route.id,route.method,payment])),routeId:route.id,method:route.method,path:route.path,
    resource:route.resource.url,optionIndex:index,payment:structuredClone(payment),
  })));
  const plan = {schema:'stellar-forge.sf101.merchant-receiving-plan.v1',configuration,routes,options};
  return {...plan,planSha256:hash(serial(plan))};
}

async function observed(task) { try { return {value:await task()}; } catch (error) { return {error:note(error)}; } }

export async function inspectMerchantReceiving({configPath,origin,endpoints = {},timeoutMs = 12000,
  feeOperations = 10,capture,sdk,fetchImpl,now = new Date()} = {}) {
  const plan = await readMerchantReceivingPlan(configPath,{origin});
  if (capture && capture.planSha256 !== plan.planSha256) throw fault('CAPTURE_SELLER_PLAN_MISMATCH');
  sdk ??= await loadStellarSdk();
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw fault('INVALID_OBSERVATION_TIME');
  if (!Number.isInteger(feeOperations) || feeOperations < 0 || feeOperations > 100000) throw fault('INVALID_FEE_OPERATIONS');
  const transport = createReadTransport({capture,fetchImpl});
  // Captured endpoint selection belongs to that original request sequence.
  if (capture && serial(endpoints) !== serial(capture.endpoints ?? {})) throw fault('CAPTURE_ENDPOINTS_MISMATCH');
  const native = createNativeReader({sdk,transport,endpoints,timeoutMs});
  const accounts = new Map(), ledgers = new Map();
  const groups = [...new Set(plan.options.map(option => option.payment.network))];
  for (const network of groups) {
    if (!NETWORKS[network]) continue;
    const payees = [...new Set(plan.options.filter(option => option.payment.network === network)
      .map(option => option.payment.payTo).filter(payTo => sdk.StrKey.isValidEd25519PublicKey(payTo)))];
    // Fetch each account once, then the ledger, so its ledger cannot predate the account snapshot.
    for (const payTo of payees) accounts.set(serial([network,payTo]),await observed(() => fetchOfficialAccount({
      network:NETWORKS[network].horizon,accountId:payTo,timeoutMs,fetchImpl:transport.fetch})));
    if (payees.length) ledgers.set(network,await observed(() => fetchOfficialLedger({
      network:NETWORKS[network].horizon,timeoutMs,fetchImpl:transport.fetch})));
  }
  const rows = [];
  for (const option of plan.options) {
    const {payment} = option;
    const row = {...option,status:'REVIEW',amountDecimal:null,token:null,recipient:null,classic:null,issues:[],notes:[]};
    const add = issue => { if (!row.issues.some(old => old.code === issue.code)) row.issues.push(issue); };
    if (!sdk.StrKey.isValidEd25519PublicKey(payment.payTo) && !sdk.StrKey.isValidContract(payment.payTo))
      add({code:'RECIPIENT_ADDRESS_INVALID'});
    const token = await observed(() => native.token(payment.network,payment.asset));
    if (token.error) add(token.error);
    else {
      row.token = token.value;
      row.amountDecimal = formatAtomic(payment.amount,row.token.decimals);
      const isAccount = sdk.StrKey.isValidEd25519PublicKey(payment.payTo);
      if (isAccount) {
        const account = accounts.get(serial([payment.network,payment.payTo]));
        const ledger = ledgers.get(payment.network);
        if (account?.error) add(account.error);
        if (ledger?.error) add({code:'HORIZON_LEDGER_UNAVAILABLE',detail:ledger.error.detail});
        if (row.token.kind === 'STELLAR_ASSET_CONTRACT' && account?.value && ledger?.value) {
          if (BigInt(payment.amount) > (1n << 63n) - 1n) add({code:'CLASSIC_AMOUNT_EXCEEDS_INT64'});
          else {
            const reviewed = await observed(() => Promise.resolve(evaluateSnapshots({account:account.value.account,
              ledgerEnvelope:ledger.value.ledgerEnvelope,accountId:payment.payTo,network:NETWORKS[payment.network].horizon,
              asset:row.token.classic,inboundAmount:amountText(payment.amount),feeOperations,
              mode:transport.mode === 'LIVE_NETWORK_READS' ? 'live' : 'offline',now})));
            if (reviewed.error) add(reviewed.error);
            else {
              row.classic = reviewed.value;
              for (const code of row.classic.reasons) {
                // The sender pays the transfer fee. Retain merchant operating reserve/fee facts separately.
                if (code.startsWith('XLM_')) row.notes.push(code);
                else add({code});
              }
              if (row.classic.cautions.includes('LEDGER_HEAD_AGE_OUT_OF_RANGE')) add({code:'LEDGER_HEAD_AGE_OUT_OF_RANGE'});
            }
          }
        }
      }
      if (!row.issues.some(issue => ['RECIPIENT_ADDRESS_INVALID','HORIZON_HTTP_404'].includes(issue.code))) {
        const recipient = await observed(() => native.recipient(payment.network,payment.asset,payment.payTo));
        if (recipient.error) add(recipient.error);
        else {
          row.recipient = recipient.value;
          if (recipient.value.authorized === false) add({code:'NATIVE_RECIPIENT_NOT_AUTHORIZED'});
          if (BigInt(recipient.value.balanceAtomic) + BigInt(payment.amount) >
            (isAccount && row.token.kind === 'STELLAR_ASSET_CONTRACT' ? (1n << 63n) - 1n : (1n << 127n) - 1n))
            add({code:'TOKEN_BALANCE_LIMIT_EXCEEDED'});
          if (row.classic?.recipient.existingBalance !== null && row.classic?.recipient.existingBalance !== undefined &&
            amountText(recipient.value.balanceAtomic) !== row.classic.recipient.existingBalance)
            add({code:'NATIVE_CLASSIC_BALANCE_CHANGED'});
          if (row.classic && row.token.classic !== 'native' && recipient.value.authorized !== null &&
            (row.classic.recipient.authorization === 'AUTHORIZED') !== recipient.value.authorized)
            add({code:'NATIVE_CLASSIC_AUTHORIZATION_CHANGED'});
        }
      }
      if (row.token.kind === 'CUSTOM_CONTRACT') add({code:'CUSTOM_CONTRACT_RECEIVING_POLICY'});
    }
    if (transport.mode !== 'LIVE_NETWORK_READS') row.notes.push('RETAINED_SOURCE_REVIEW');
    row.issues = row.issues.map(issue => ({...issue,action:actions[issue.code] ?? 'Resolve the reported read or source condition and repeat this merchant review.'}));
    row.status = row.issues.some(issue => hard.has(issue.code)) ? 'ACTION_REQUIRED' :
      row.issues.length || transport.mode !== 'LIVE_NETWORK_READS' ? 'REVIEW' : 'RECEIVING_PREREQUISITES_OK';
    rows.push(row);
  }
  const readCapture = {schema:'stellar-forge.sf101.merchant-capture.v1',planSha256:plan.planSha256,
    endpoints:structuredClone(endpoints),mode:transport.mode,reads:transport.reads()};
  const currentConfig = await observed(() => readFile(resolve(configPath)));
  const configurationUnchanged = !currentConfig.error && hash(currentConfig.value) === plan.configuration.sha256;
  if (!configurationUnchanged) for (const row of rows) {
    row.issues.push({code:'SELLER_CONFIG_CHANGED_DURING_CHECK',action:'Review the current seller configuration in a new receiving review.'});
    if (row.status === 'RECEIVING_PREREQUISITES_OK') row.status = 'REVIEW';
  }
  const statusCounts = rows.reduce((counts,row) => ({...counts,[row.status]:(counts[row.status] ?? 0)+1}),{});
  const report = {schema:'stellar-forge.sf101.merchant-readiness.v1',observedAt:now.toISOString(),
    mode:transport.mode,configuration:{...plan.configuration,unchangedAtCompletion:configurationUnchanged},planSha256:plan.planSha256,
    summary:{routes:plan.routes.length,options:rows.length,accounts:accounts.size,networks:groups.length,
      reads:readCapture.reads.length,statusCounts},options:rows};
  return {plan,report,capture:readCapture};
}

export function compareMerchantReadiness(previous,current) {
  if (previous?.schema !== 'stellar-forge.sf101.merchant-readiness.v1' || !Array.isArray(previous.options))
    throw fault('PREVIOUS_REPORT_INVALID');
  const older = new Map(previous.options.map(option => [option.optionId,option]));
  const seen = new Set();
  const changed = current.options.map(row => {
    const prior = older.get(row.optionId); seen.add(row.optionId);
    return {optionId:row.optionId,routeId:row.routeId,optionIndex:row.optionIndex,
      change:!prior?'ADDED':serial([prior.status,prior.issues.map(x=>x.code)]) === serial([row.status,row.issues.map(x=>x.code)])?'UNCHANGED':'CHANGED',
      before:prior?.status ?? null,after:row.status,
      resolved:prior?.issues.filter(issue=>!row.issues.some(next=>next.code===issue.code)).map(issue=>issue.code) ?? [],
      introduced:row.issues.filter(issue=>!prior?.issues.some(old=>old.code===issue.code)).map(issue=>issue.code)};
  });
  for (const row of previous.options) if (!seen.has(row.optionId)) changed.push({optionId:row.optionId,routeId:row.routeId,
    optionIndex:row.optionIndex,change:'REMOVED',before:row.status,after:null,resolved:[],introduced:[]});
  return {previousObservedAt:previous.observedAt,previousConfigurationSha256:previous.configuration.sha256,
    currentConfigurationSha256:current.configuration.sha256,options:changed};
}

const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function merchantReadinessHtml(report) {
  const cells = (name,value) => `<dt>${esc(name)}</dt><dd>${esc(value ?? 'Unavailable')}</dd>`;
  const sections = report.options.map(row => `<section id="${row.optionId}"><h2>${esc(row.method)} ${esc(row.path)} · choice ${row.optionIndex+1}</h2>
    <p class="status">${esc(row.status.replaceAll('_',' '))}</p><dl>${[
      ['Network',row.payment.network],['Contract',row.payment.asset],['Recipient',row.payment.payTo],
      ['Atomic amount',row.payment.amount],['Token amount',row.amountDecimal === null ? null : row.amountDecimal+' '+row.token.symbol],
      ['Contract type',row.token?.kind],['RPC balance',row.recipient?.balanceAtomic],['Receiving authorized',row.recipient?.authorized],
      ['Classic inbound capacity',row.classic?.recipient.inboundCapacity],['Merchant XLM reserve',row.classic?.account.minimumReserveXlm],
      ['Merchant spendable XLM',row.classic?.account.availableXlm],['Nominal operating fee floor',row.classic?.account.nominalFeeFloorXlm],
      ['Original timeout',row.payment.maxTimeoutSeconds+' seconds'],['Observed contract ledger',row.token?.instanceLedger],
    ].map(([key,value])=>cells(key,value)).join('')}</dl>
    ${row.issues.length?'<h3>Actions</h3><ol>'+row.issues.map(issue=>`<li><strong>${esc(issue.code)}</strong><p>${esc(issue.action)}</p>${issue.detail?'<p class="detail">'+esc(issue.detail)+'</p>':''}</li>`).join('')+'</ol>':'<p>The observed receiving prerequisites pass for this exact payment option.</p>'}
    ${row.notes.length?'<p class="detail">'+row.notes.map(esc).join(' · ')+'</p>':''}</section>`).join('');
  const changes = report.comparison ? `<section><h2>Changes since ${esc(report.comparison.previousObservedAt)}</h2><ul>${report.comparison.options
    .filter(row=>row.change!=='UNCHANGED').map(row=>`<li>${esc(row.routeId)} choice ${row.optionIndex+1}: ${esc(row.change)} · ${esc(row.before)} → ${esc(row.after)}${row.resolved.length?'; resolved '+esc(row.resolved.join(', ')):''}</li>`).join('') || '<li>Same option states and receiving actions.</li>'}</ul></section>` : '';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Merchant receiving review</title>
    <style>body{font:15px/1.55 system-ui,sans-serif;background:#f3f3f3;color:#202020;max-width:1080px;margin:36px auto;padding:0 18px}h1{font-size:27px}h2{font-size:19px}h3{font-size:16px}section{background:white;border:1px solid #bbb;padding:22px;margin:20px 0;break-inside:avoid}dl{display:grid;grid-template-columns:220px 1fr;margin:0}dt,dd{margin:0;padding:8px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}dt{font-weight:600}dd{font-family:ui-monospace,monospace}.status{font-weight:700}.detail,footer{color:#555;font-size:13px;overflow-wrap:anywhere}li p{margin:5px 0 14px}a{color:inherit}nav{display:flex;gap:15px;flex-wrap:wrap}@media(max-width:650px){dl{grid-template-columns:1fr}dt{border:0;padding-bottom:0}dd{padding-top:3px}section{padding:15px}}@media print{body{margin:0;background:white}section{border-color:#888}}</style>
    <h1>Merchant receiving review</h1><p>${report.summary.routes} routes · ${report.summary.options} payment choices · ${esc(report.mode.replaceAll('_',' '))}</p>
    <p>${esc(report.observedAt)}</p><nav><a href="report.json">Complete report</a><a href="options.csv">Payment choices CSV</a><a href="capture.json">Original reads</a></nav>${changes}${sections}
    <footer>Seller configuration SHA-256 ${esc(report.configuration.sha256)}. The review follows the original configured options and observed receiving state. Account and contract state may change after these reads. The original seller and native payment runtime remain responsible for executing each purchase.</footer></html>`;
}

export function merchantReadinessCsv(report) {
  const fields = ['route_id','method','option_index','status','network','asset','recipient','amount_atomic','amount_decimal',
    'symbol','contract_kind','native_balance_atomic','authorized','classic_inbound_capacity','issues','option_id'];
  const cell = value => { const raw = String(value ?? '');
    return '"'+(/^[\s]*[=+@-]/.test(raw) ? "'"+raw : raw).replace(/"/g,'""')+'"'; };
  return fields.join(',')+'\n'+report.options.map(row=>[row.routeId,row.method,row.optionIndex,row.status,
    row.payment.network,row.payment.asset,row.payment.payTo,row.payment.amount,row.amountDecimal,row.token?.symbol,
    row.token?.kind,row.recipient?.balanceAtomic,row.recipient?.authorized,row.classic?.recipient.inboundCapacity,
    row.issues.map(issue=>issue.code).join(';'),row.optionId].map(cell).join(',')).join('\n')+'\n';
}
