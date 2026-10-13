// MIT. The original streamed invoice computation, delivered as named result files.
import { reconcile as reconcileOriginal } from '../inputs/example-application.mjs';

const csv = rows => rows.map(row => row.map(value => '"' +
  String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';

/** Each member is a complete named output. Amount strings retain their original minor units. */
export async function reconcile(input, context) {
  const report = await reconcileOriginal(input, context);
  context.signal.throwIfAborted();
  const totals = [['Currency', 'Lines', 'PricedLines', 'UnpricedLines', 'AllChargedMinor',
    'PricedChargedMinor', 'ExpectedMinor', 'VarianceMinor'],
    ...report.totals.map(value => [value.currency, value.lines, value.pricedLines,
      value.unpricedLines, value.allChargedMinor, value.pricedChargedMinor,
      value.expectedMinor, value.varianceMinor])];
  const exceptions = [['LineNumber', 'InvoiceId', 'LineId', 'SKU', 'Currency', 'Quantity',
    'ChargedMinor', 'ExpectedMinor', 'VarianceMinor', 'State'],
    ...report.exceptions.map(value => [value.lineNumber, value.invoiceId, value.lineId,
      value.sku, value.currency, value.quantity, value.chargedMinor,
      value.expectedMinor, value.varianceMinor, value.state])];
  return {
    report: JSON.stringify(report, null, 2) + '\n',
    totals: csv(totals),
    exceptions: csv(exceptions),
  };
}
