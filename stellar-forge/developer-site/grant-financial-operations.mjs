// MIT. Receive merchant finance into the existing SCF manuscript and reader.
export const FINANCIAL_OPERATION = 'SCF-MERCHANT-FINANCE-APPLICATION-3FC8-20261012';
export const FINANCIAL_HEADING = '## Merchant settlement, customer billing and accountant receiving';
const REPOSITORY = 'https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/';
const COMPONENTS = [
  {
    id: 'merchant-settlement-accounting',
    label: 'Original Stellar settlement accounting and operating recovery',
    path: 'stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/README.md',
    operator_workflow: 'Original outbox and terms, independent native verification, complete reconciliation, customer attribution and complete encrypted operating recovery.',
    financial_record: 'Original network, asset, transaction and exact atomic amount, with separately supplied commercial valuation and cost basis.',
  },
  {
    id: 'merchant-customer-receivables',
    label: 'Issued customer invoices, receipts and dated allocations',
    path: 'products/merchant-receivables/README.md',
    operator_workflow: 'Original quotation and customer response, exact invoice review and issue, receipt allocation, credit, dated release and complete customer account receiving.',
    financial_record: 'Original issued obligation and customer receipt with effective allocation and credit history.',
  },
  {
    id: 'merchant-invoice-stellar-collection',
    label: 'Invoice-bound Stellar wallet requests and native receiving',
    path: 'stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/PAYMENT_REQUESTS.md',
    operator_workflow: 'Reviewed invoice value and exact Stellar terms, issued SEP-7 wallet request, original returned transaction verification, customer receipt and dated allocation.',
    financial_record: 'Original invoice currency and explicit native/issued-asset valuation, with network, memo, ledger transaction and original receipt identity.',
  },
  {
    id: 'merchant-payment-plans',
    label: 'Customer installment editions and dated collections',
    path: 'products/merchant-payment-plans/README.md',
    operator_workflow: 'Invoice balance selection, exact draft schedule, reviewed activation, immutable customer files, effective replacements and dated collections.',
    financial_record: 'Schedule and unscheduled portions of the original invoice balance, separated by currency and precision.',
  },
  {
    id: 'merchant-xero-customer-handover',
    label: 'Xero customer document receiving and correction',
    path: 'stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/xero/README.md',
    operator_workflow: 'Actual organisation templates and mappings, reviewed issued documents, immutable imports, original returned document identity and exact amounts, linked correction and complete handover.',
    financial_record: 'Original invoice/credit correspondence and external document status; native receipts and allocations retain their ledger identities.',
  },
];
const clean = value => String(value).replaceAll('\r\n', '\n').trim() + '\n';
function need(value, message) { if (!value) throw new Error(message); }

/** Select the complete financial subsection from the original manuscript. */
export function extractFinancialApplication(manuscript) {
  need(typeof manuscript === 'string', 'Read the complete original application manuscript.');
  const source = clean(manuscript);
  const positions = [...source.matchAll(/^## Merchant settlement, customer billing and accountant receiving\s*$/gm)];
  need(positions.length === 1, 'Keep exactly one complete merchant financial subsection in the original manuscript.');
  const start = positions[0].index;
  const nextLine = source.indexOf('\n', start) + 1;
  const nextHeading = source.slice(nextLine).search(/^#{1,2}\s/m);
  return clean(source.slice(start, nextHeading < 0 ? source.length : nextLine + nextHeading));
}

/** Preserve the companion and replace only the selected financial subsection. */
export function receiveFinancialApplication(productAndFinanceMarkdown, manuscript) {
  need(typeof productAndFinanceMarkdown === 'string', 'Read the original product and finance companion.');
  const selected = extractFinancialApplication(manuscript);
  const companion = clean(productAndFinanceMarkdown);
  const positions = [...companion.matchAll(/^## Merchant settlement, customer billing and accountant receiving\s*$/gm)];
  need(positions.length <= 1, 'Keep one financial subsection in the original companion.');
  if (positions.length) {
    const start = positions[0].index;
    const nextLine = companion.indexOf('\n', start) + 1;
    const nextHeading = companion.slice(nextLine).search(/^#{1,2}\s/m);
    const end = nextHeading < 0 ? companion.length : nextLine + nextHeading;
    return clean(companion.slice(0, start) + selected + '\n' + companion.slice(end));
  }
  const before = companion.indexOf('## 7. Threat response and useful-outcome measurement\n');
  need(before >= 0, 'Retain the existing companion and its threat-response section.');
  return clean(companion.slice(0, before) + selected + '\n' + companion.slice(before));
}

/** Pin original product source while preserving the existing award and cohorts. */
export function attachFinancialSources(sourceIndex, {financeCommit, productAndFinanceMarkdown}) {
  need(sourceIndex?.schema === 'stellar-forge.grant-reviewer-source-index.v1' && Array.isArray(sourceIndex.sources),
    'Use the existing application source index.');
  need(typeof financeCommit === 'string' && /^[a-f0-9]{40}$/.test(financeCommit),
    'Select the full merged merchant financial product commit.');
  extractFinancialApplication(productAndFinanceMarkdown);
  const index = JSON.parse(JSON.stringify(sourceIndex));
  const selected = COMPONENTS.map(component => ({
    ...component, kind: 'maintained-product', repository: REPOSITORY,
    source_commit: financeCommit,
    url: REPOSITORY + 'blob/' + financeCommit + '/' + component.path,
    application_operation: FINANCIAL_OPERATION,
  }));
  for (const item of selected) {
    const matches = index.sources.map((value, position) => value.id === item.id ? position : -1).filter(position => position >= 0);
    need(matches.length <= 1, 'Keep one original source entry for ' + item.id + '.');
    if (matches.length) index.sources[matches[0]] = item;
    else index.sources.push(item);
  }
  index.narrative_source = {
    ...index.narrative_source,
    financial_product_commit: financeCommit,
    financial_application_operation: FINANCIAL_OPERATION,
  };
  index.financial_operations = {
    schema: 'stellar-forge.grant-financial-operations.v1',
    heading: FINANCIAL_HEADING.slice(3),
    companion_route: '/grant-data/product-and-finance.md',
    reader_section: '#defined-architecture-and-operating-behavior',
    source_commit: financeCommit,
    source_ids: selected.map(item => item.id),
    installed_selection: 'merchant-receivables-xero',
    installed_command: 'receivables-xero',
    operating_guide: REPOSITORY + 'blob/main/products/merchant-workspace/FINANCIAL_OPERATIONS.md',
    manuscript_operation: FINANCIAL_OPERATION,
    funded_work: 'Selected future customer Stellar integration and technical receiving within the original six priced packages.',
    measurement: 'Retain distinct original purchases and exact network/asset amounts; account, collection and receiving records continue their original economic identities.',
  };
  const basis = ' The merchant financial chapter applies the shipped settlement, invoice, collection and accountant foundation to the same prospective customer integration packages.';
  index.product_and_finance = {
    ...index.product_and_finance,
    basis: String(index.product_and_finance?.basis || '').replaceAll(basis, '') + basis,
  };
  return {sourceIndex: index, financialSources: selected, financialOperation: index.financial_operations};
}
