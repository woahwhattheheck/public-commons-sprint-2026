// MIT. Read the original exact tariff results; this module performs no pricing arithmetic.
const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const text = value => value === null || value === undefined ? 'Unknown' : String(value);
const money = value => value === null || value === undefined ? 'Unknown' : '$' + value;
const percent = value => value === null || value === undefined ? 'Not defined / unknown' : value + '%';
const modeName = value => value === 'volume' ? 'Volume' : 'Graduated';
const cell = value => '<td>' + escape(value) + '</td>';
const json = value => JSON.stringify(value, null, 2);
function table(headers, rows, caption = '') {
  return '<div class="review-table"><table>' + (caption ? '<caption>' + escape(caption) + '</caption>' : '') +
    '<thead><tr>' + headers.map(value => '<th scope="col">' + escape(value) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell).join('') + '</tr>').join('') + '</tbody></table></div>';
}
function facts(items) {
  return '<dl class="review-facts">' + items.map(([label,value]) =>
    '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>').join('') + '</dl>';
}
function checkedReview(review) {
  if (review?.schema !== 'stellar-forge.merchant-tariff-review.v1' ||
      !/^[a-f0-9]{64}$/.test(review.tariffReviewSha256 ?? '') ||
      !Array.isArray(review.tariffs) || !Array.isArray(review.comparisons) ||
      !Array.isArray(review.tariffDetails) || !review.source || !review.baseline)
    throw new TypeError('Use the original complete tariff review.');
  return review;
}
function checkedPlan(plan) {
  if (plan?.schema !== 'stellar-forge.merchant-tariff-plan.v1' ||
      !/^[a-f0-9-]{36}$/.test(plan.planId ?? '') || !/^[a-f0-9-]{36}$/.test(plan.version ?? '') ||
      typeof plan.savedAt !== 'string' || typeof plan.label !== 'string')
    throw new TypeError('Open the original saved tariff plan before exporting its report.');
  checkedReview(plan.review);
  return plan;
}
export const TARIFF_REPORT_FILES = Object.freeze([
  'report.html', 'band-charges.csv', 'thresholds.csv', 'plan.json', 'tariffs.json', 'comparison.csv'
]);
export const TARIFF_REVIEW_CSS = ".tariff-review{color:#202124;background:#fff;color-scheme:only light;font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.tariff-review *{box-sizing:border-box}.tariff-review h1,.tariff-review h2,.tariff-review h3{line-height:1.25;color:inherit}.tariff-review h1{font-size:2rem;margin:0 0 .5rem}.tariff-review h2{font-size:1.3rem;margin:1.6rem 0 .7rem}.tariff-review h3{font-size:1.05rem;margin:1.2rem 0 .6rem}.tariff-review p{margin:.65rem 0}.tariff-review a{color:inherit;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}.tariff-review .review-muted{color:#54585d}.tariff-review .review-basis,.tariff-review .review-notice{border:1px solid #b7bbbf;padding:1rem;background:#f6f6f6;color:#202124;margin:1rem 0}.tariff-review .review-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:1rem;margin:1rem 0}.tariff-review .review-facts div{min-width:0}.tariff-review dt{font-size:.85rem;color:#54585d}.tariff-review dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.tariff-review code,.tariff-review pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.83rem;overflow-wrap:anywhere;white-space:pre-wrap}.tariff-review pre{border:1px solid #d6d8da;padding:.8rem;background:#fafafa;color:#202124;max-height:28rem;overflow:auto}.tariff-review .review-table{overflow-x:auto;max-width:100%;margin:.7rem 0 1rem}.tariff-review table{width:100%;border-collapse:collapse;font-size:.88rem;font-variant-numeric:tabular-nums}.tariff-review caption{text-align:left;font-weight:600;margin-bottom:.5rem}.tariff-review th,.tariff-review td{padding:.6rem .7rem;vertical-align:top;text-align:left;border-bottom:1px solid #d6d8da;overflow-wrap:anywhere}.tariff-review th{background:#f1f2f3;color:#202124;font-weight:600}.tariff-review tr{break-inside:avoid}.tariff-review .review-comparison{border-top:2px solid #555;padding-top:.3rem;margin-top:2rem;scroll-margin-top:1rem}.tariff-review .review-identity{font-size:.82rem}.tariff-review summary{cursor:pointer;font-weight:600}.tariff-review .review-jump{columns:2;column-gap:2rem;padding-left:1.3rem}.tariff-review .review-jump li{break-inside:avoid;margin:.35rem 0}@media(max-width:640px){.tariff-review .review-jump{columns:1}.tariff-review h1{font-size:1.5rem}.tariff-review th,.tariff-review td{padding:.5rem}}@media print{.tariff-review{font-size:10pt}.tariff-review .review-table{overflow:visible}.tariff-review table{font-size:8pt}.tariff-review pre{max-height:none;overflow:visible}.tariff-review h2,.tariff-review h3{break-after:avoid}.tariff-review a{color:#000;text-decoration:none}.tariff-review .review-jump{columns:2}.tariff-review .review-basis{background:white}}";

export function tariffReviewBasisHtml(review, context = {}) {
  checkedReview(review);
  return '<div class="review-basis"><strong>' + (context.planId ? 'Saved plan · proposed monthly outcomes' : 'Calculated preview · proposed monthly outcomes') +
    '</strong><p>Every baseline and tariff total uses the explicitly chosen monthly quantity. The baseline is the saved commercial quote; collected payments and observed request counts remain in the original operations review.</p>' +
    '<p>Contributions cover fulfilled-request variable costs before shared fixed costs. Challenge costs and whole-merchant fixed costs remain separate. The uniform quote is a separately rounded per-request proposal.</p></div>' +
    facts([['Merchant',text(review.baseline.merchantName)],['Pricing source',context.sourceLabel ?? 'Original saved review'],
      ['Source review ID',context.version ?? 'See original pricing source'],['Plan ID',context.planId ?? 'Preview — save to retain'],
      ['Saved at',context.savedAt ?? 'Preview'],['Review generated at',review.generatedAt],
      ['Source scope',review.baseline.scope === 'SELECTED_CURRENT_ROUTE' ? 'Selected route' : 'Whole seller'],
      ['Whole-merchant fixed cost / month',money(review.baseline.sharedMonthlyFixedUsd)]]) +
    '<p class="review-identity">Tariff review SHA-256: <code>' + escape(review.tariffReviewSha256) + '</code></p>';
}
export function tariffScheduleHtml(review) {
  checkedReview(review);
  const rows = [];
  for (const tariff of review.tariffs) {
    let previous = '0';
    tariff.tiers.forEach((tier,index) => {
      rows.push([tariff.label,tariff.id,tariff.routeId,modeName(tariff.mode),String(index+1),
        'Over '+previous+' through '+(tier.upTo ?? 'unlimited'),tier.unitPriceUsd]);
      previous = tier.upTo ?? previous;
    });
  }
  return '<h2>Complete tariff schedules</h2><p>Each finite upper quantity is inclusive. Graduated pricing charges the used quantity in each band; volume pricing applies the selected band’s rate to every request.</p>' +
    table(['Tariff','Tariff ID','Route','Mode','Band','Quantity range','USD / request'],rows);
}
export function tariffThresholdsHtml(review) {
  checkedReview(review);
  const byId = new Map(review.tariffs.map(tariff => [tariff.id,tariff])), rows = [];
  for (const detail of review.tariffDetails) {
    const tariff = byId.get(detail.tariffId);
    for (const boundary of detail.boundaries) rows.push([
      tariff?.label ?? detail.tariffId,tariff?.routeId ?? '',String(boundary.afterTierIndex+1),
      boundary.beforeQuantity,boundary.beforeTotalUsd,boundary.afterQuantity,
      boundary.afterTotalUsd,boundary.grossChangeUsd,boundary.decreasesGross ? 'Total decreases' : 'Total does not decrease']);
  }
  return '<h2>All band boundaries</h2><p>These are the retained results immediately before and after every finite, representable boundary, including quantities outside the comparison list.</p>' +
    (rows.length ? table(['Tariff','Route','After band','Before requests','Before USD','After requests','After USD','Change USD','Behavior'],rows) :
      '<p>No finite, representable band boundary occurs in these schedules.</p>');
}
export function tariffComparisonHtml(review, row) {
  checkedReview(review);
  if (!review.comparisons.includes(row)) throw new TypeError('Choose a comparison from this exact review.');
  const tariff = review.tariffs.find(item => item.id === row.tariffId), quote = row.quote, fraction = quote.effectiveUnitUsd;
  const economics = [
    ['Gross USD',row.baseline.totalUsd,quote.totalUsd,text(row.uniformProjection.grossUsd)],
    ['Fulfilled-request variable costs USD',text(row.costs.variableCostsUsd),text(row.costs.variableCostsUsd),text(row.uniformProjection.variableCostsUsd)],
    ['Contribution before shared fixed costs USD',text(row.baseline.contributionBeforeFixedUsd),text(row.contributionBeforeFixedUsd),text(row.uniformProjection.contributionBeforeFixedUsd)],
    ['Margin before shared fixed costs',percent(row.baseline.marginBeforeFixedPct),percent(row.marginBeforeFixedPct),percent(row.uniformProjection.marginBeforeFixedPct)]];
  return '<section class="review-comparison" id="comparison-'+escape(row.id)+'"><h2>'+escape(tariff?.label ?? row.tariffId)+' · '+escape(row.quantity)+' monthly requests</h2>' +
    '<p>'+escape(row.method)+' <code>'+escape(row.path)+'</code> · Route <code>'+escape(row.routeId)+'</code> · '+escape(modeName(quote.mode))+'</p>' +
    facts([['Saved baseline quote / request',money(row.baseline.quoteUsd)],['Exact tariff total',money(quote.totalUsd)],
      ['Change from baseline gross',money(row.grossDeltaUsd)],['Change from baseline contribution',money(row.contributionDeltaUsd)],
      ['Saved source monthly target',text(review.baseline.monthlyTargets?.[row.routeId])],['Proposed quantity in this comparison',row.quantity]]) +
    table(['At the same planned quantity','Saved baseline','Proposed tariff','Proposed uniform quote'],economics) +
    '<h3>Charged bands</h3><p>'+(quote.mode==='volume' ? 'The selected band’s unit price applies to all '+escape(row.quantity)+' requests. Its range selects the rate; it does not limit the billed quantity.' :
      'Each line charges only the requests used within that graduated band.')+'</p>' +
    (quote.lines.length ? table(['Band','Band range','Charged requests','USD / request','Subtotal USD'],
      quote.lines.map(line => [String(line.tierIndex+1),'Over '+line.lowerExclusiveQuantity+' through '+(line.upTo ?? 'unlimited'),
        line.quantity,line.unitPriceUsd,line.subtotalUsd])) : '<p>No charged bands at zero requests.</p>') +
    '<h3>Exact average and uniform quote</h3>' +
    (fraction ? facts([['Authoritative average USD / request',fraction.numerator+' / '+fraction.denominator],
      ['Twelve-place lower display bound',fraction.floorUsd],['Twelve-place upper display bound',fraction.ceilingUsd],
      ['Uniform quote USD / request',quote.chosenUniformQuoteUsd],['Uniform quote gross USD',quote.uniformGrossUsd],
      ['Upward rounding difference USD',quote.roundingDeltaUsd]]) : '<p>A per-request average and uniform quote are undefined at zero requests.</p>') +
    '<p class="review-muted">The native uniform quote rounds upward to one micro-USD per request. Its gross and contribution are shown separately from the exact tariff. The saved rational average above remains authoritative.</p>' +
    '<h3>Next request</h3>' + (quote.nextQuantity === null ? '<p>The comparison already uses the maximum supported request quantity.</p>' :
      facts([['Next quantity',quote.nextQuantity],['Next tariff total USD',quote.nextTotalUsd],
        ['Change in tariff gross USD',quote.nextGrossChangeUsd],['Rate applying to next request USD',quote.nextUnitPriceUsd]])) +
    '<h3>Cost and source basis</h3>' +
    facts([['Per fulfilled request',money(row.costs.perFulfilledUsd)],['Per challenge',money(row.costs.perChallengeUsd)],
      ['Cost scope','Fulfilled requests only'],['Baseline price basis',text(row.baseline.priceBasis)]]) +
    '<p>Per-challenge cost is retained for context. Challenge volume and shared monthly fixed cost are evaluated by the original whole-merchant planning flow when a quote is selected.</p>' +
    (row.costs.unknownInputs.length ? '<p class="review-notice">Unresolved cost inputs: '+escape(row.costs.unknownInputs.join(', '))+'. Contribution and margin retain their original unknown values.</p>' : '') +
    (row.quantity === '0' ? '<p class="review-muted">This zero-quantity comparison can be reviewed and exported. Uniform-quote selection requires a positive quantity.</p>' : '') +
    '<p class="review-identity">Comparison ID: <code>'+escape(row.id)+'</code><br>Tariff SHA-256: <code>'+escape(quote.tariffSha256)+'</code></p></section>';
}
export function tariffSourceHtml(plan) {
  checkedPlan(plan);
  return '<section><h2>Original source identities</h2>' +
    facts([['Plan ID',plan.planId],['Source pricing review',plan.version],['Save request SHA-256',plan.requestSha256],
      ['Seller canonical SHA-256',plan.review.source.sellerCanonicalSha256],['Observation canonical SHA-256',plan.review.source.observationCanonicalSha256],
      ['Commercial terms canonical SHA-256',plan.review.source.termsCanonicalSha256]]) +
    '<h3>Saved provenance</h3><pre>'+escape(json({plan:plan.provenance,review:plan.review.source.provenance}))+'</pre>' +
    '<h3>Whole-merchant baseline</h3><pre>'+escape(json(plan.review.baseline))+'</pre></section>';
}
export function renderTariffReport(plan) {
  checkedPlan(plan);
  const review=plan.review,names=new Map(review.tariffs.map(tariff=>[tariff.id,tariff.label]));
  const navigation='<nav aria-label="Report contents"><h2>Review contents</h2><p>'+review.tariffs.length+
    ' tariffs · '+review.comparisons.length+' quantity outcomes. This complete saved report includes every outcome.</p><ol class="review-jump">'+
    review.comparisons.map(row=>'<li><a href="#comparison-'+escape(row.id)+'">'+escape(names.get(row.tariffId)??row.tariffId)+
      ' · '+escape(row.routeId)+' · '+escape(row.quantity)+' requests</a></li>').join('')+'</ol></nav>';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+escape(plan.label)+' — tariff review</title><style>'+TARIFF_REVIEW_CSS+
    '\nbody{margin:0;background:#fff}.report-shell{max-width:1180px;margin:auto;padding:32px 24px}@media(max-width:640px){.report-shell{padding:20px 14px}}@media print{.report-shell{padding:0;max-width:none}}</style></head>'+
    '<body><main class="tariff-review report-shell"><header><p class="review-muted">Merchant pricing · saved tariff plan</p><h1>'+escape(plan.label)+
    '</h1><p>Saved '+escape(plan.savedAt)+'. Open this file offline or use the browser’s Print command.</p></header>'+
    tariffReviewBasisHtml(review,plan)+navigation+tariffScheduleHtml(review)+tariffThresholdsHtml(review)+
    review.comparisons.map(row=>tariffComparisonHtml(review,row)).join('')+tariffSourceHtml(plan)+
    '<footer><p>Complete original inputs and machine-readable results travel as plan.json, tariffs.json and comparison.csv. The detailed band and boundary exports are band-charges.csv and thresholds.csv.</p></footer></main></body></html>\n';
}
function csv(rows) {
  const quote=value=>{let output=String(value??'');if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(output)&&/^[=+\-@\t\r]/.test(output))output="'"+output;
    return '"'+output.replaceAll('"','""')+'"';};
  return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export function tariffBandCsv(plan) {
  checkedPlan(plan);
  const rows=[['Plan ID','Source review','Tariff review SHA-256','Comparison ID','Tariff ID','Tariff SHA-256','Route',
    'Mode','Planned requests','Line kind','Band','Lower exclusive quantity','Upper inclusive quantity',
    'Charged requests','Unit price USD','Subtotal USD','Tariff total USD','Average numerator USD','Average denominator',
    'Average lower USD','Average upper USD','Uniform quote USD','Uniform gross USD','Rounding difference USD']];
  for(const row of plan.review.comparisons) {
    const q=row.quote;
    for(const line of q.lines.length?q.lines:[null])rows.push([
      plan.planId,plan.version,plan.review.tariffReviewSha256,row.id,row.tariffId,q.tariffSha256,row.routeId,
      q.mode,row.quantity,line?'CHARGED_BAND':'NO_CHARGED_BANDS',line?String(line.tierIndex+1):null,
      line?.lowerExclusiveQuantity,line?.upTo,line?.quantity,line?.unitPriceUsd,line?.subtotalUsd,q.totalUsd,
      q.effectiveUnitUsd?.numerator,q.effectiveUnitUsd?.denominator,q.effectiveUnitUsd?.floorUsd,
      q.effectiveUnitUsd?.ceilingUsd,q.chosenUniformQuoteUsd,q.uniformGrossUsd,q.roundingDeltaUsd]);
  }
  return csv(rows);
}
export function tariffThresholdCsv(plan) {
  checkedPlan(plan);
  const rows=[['Plan ID','Source review','Tariff review SHA-256','Tariff ID','Tariff SHA-256','Route','Mode',
    'After band','Before requests','Before total USD','After requests','After total USD','Gross change USD','Decreases gross']];
  const tariffs=new Map(plan.review.tariffs.map(tariff=>[tariff.id,tariff]));
  for(const detail of plan.review.tariffDetails)for(const row of detail.boundaries)rows.push([
    plan.planId,plan.version,plan.review.tariffReviewSha256,detail.tariffId,detail.tariffSha256,
    tariffs.get(detail.tariffId)?.routeId,tariffs.get(detail.tariffId)?.mode,String(row.afterTierIndex+1),
    row.beforeQuantity,row.beforeTotalUsd,row.afterQuantity,row.afterTotalUsd,row.grossChangeUsd,String(row.decreasesGross)]);
  return csv(rows);
}
