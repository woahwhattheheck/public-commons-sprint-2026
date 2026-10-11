// MIT. Burbank's procurement profile for the maintained conversion operator.
export const PROFILE_ID = 'burbank-it-2026-001';
export const PORTAL = 'https://pbsystem.planetbids.com/portal/14210/portal-home';
export const PROCUREMENT = Object.freeze({
  buyer: 'City of Burbank, California', title: 'ERP software and services',
  identifier: 'IT-2026-001', printedHeader: 'IT-2026-01',
  source: PORTAL, observedOn: '2026-10-11',
  proposalDeadline: 'November 12, 2026, 4:00 p.m. PST', deadlinePage: 44,
  incumbent: 'Oracle E-Business Suite 12.2.10',
  note: 'This workspace supports the delivery team. The City receives proposals through PlanetBids and its original response attachments.',
});
const money = (...names) => names.map(name => ({name, scale: 2, tolerance: '0.00'}));
const cohort = (id, title, keys, attributes, amounts, groupBy, purpose) => ({id,title,keys,attributes,amounts,groupBy,purpose});
export const OPERATOR_PROFILE = {
  id: PROFILE_ID, title: 'Burbank ERP delivery workspace',
  source: {url: PORTAL, label: 'Burbank IT-2026-001 — original RFP and response attachments',
    sections: ['Attachments 5, 6, 11, 18', 'RFP pages 7, 30–31, 44, 60, 69–70']},
  cohorts: [
    cohort('gl','General ledger',['ledger','fiscal_year','period','fund','journal','line'],['account','currency'],money('debit','credit'),['ledger','fiscal_year','period','fund'],
      'Compare journal-line coverage, account dimensions and exact debit/credit balances. Define the agreed extraction grain before mapping.'),
    cohort('payroll','Parallel payroll',['period_end','pay_cycle','employee_id','payment_id'],['currency'],money('gross','net','tax','deductions','employer_cost'),['period_end','pay_cycle'],
      'Compare complete regular, adjustment and off-cycle populations under the agreed payment grain and employee crosswalk.'),
    cohort('vendors','Vendors',['vendor_id'],['vendor_name','status'],[],[], 'Compare each declared vendor and its selected attributes.'),
    cohort('payables','Payables',['vendor_id','invoice_id','line'],['currency','status'],money('invoice_amount','paid_amount'),['vendor_id'], 'Reconcile invoice lines, open balances and payments without collapsing their original identities.'),
    cohort('employees','Employee and position records',['employee_id'],['position','department','status'],[],[], 'Compare employee key coverage and selected position, department and status fields.'),
    cohort('assets','Assets and maintenance',['asset_id'],['asset_type','location','status'],money('cost','depreciation'),[], 'Keep retained FASTER assets distinct from the WAM replacement and compare declared asset balances.'),
    cohort('budget','Budget and EPM',['fiscal_year','fund','department','account','version'],['scenario'],money('budget'),['fiscal_year','fund','version'], 'Compare agreed budget versions and dimensions for the retained or reimplemented EPM connection.'),
    cohort('receipts','Receipts and refunds',['source_system','batch','transaction_id'],['fund','account','currency'],money('amount'),['source_system','batch'], 'Compare transaction-level extraction and separately declared batch totals for utilities, CCS and ePLAS.'),
    cohort('gis_assets','GIS asset attributes',['object_id'],['section_id','street','fund_source','inspection_date','pci'],[],[], 'Compare declared fields from an actual City ArcGIS capture and its target import; preserve the original GIS pages.'),
  ],
  scenarios: [
    {id:'conversion',title:'Repeatable conversion with original inputs and correction history',cohorts:['gl','vendors','payables','employees','assets','budget','receipts','gis_assets']},
    {id:'parallel_payroll',title:'Parallel payroll, adjustments and financial reconciliation',cohorts:['payroll','gl']},
    {id:'interfaces',title:'Interface design, actual results and recovery decisions',cohorts:['gl','payroll','vendors','payables','employees','assets','budget','receipts','gis_assets']},
    {id:'acceptance',title:'Requirement-linked UAT and explicit reviewer decisions',cohorts:['gl','payroll','vendors','payables','employees','assets','budget','receipts','gis_assets']},
    {id:'support',title:'Go-live, at least 12 months of hypercare and quarterly update regression',cohorts:['gl','payroll','vendors','payables','employees','assets','budget','receipts','gis_assets']},
  ],
};

export const RESPONSE_CODES = ['', 'Y', 'Y-WC', 'N', 'I'];
export const REQUIREMENT_PHASES = ['', '1', '2', 'X'];
export const DELIVERY_STATES = ['Unassigned','Planned','In progress','Ready for review','Accepted','Needs correction'];
export const INTERFACE_OPTIONS = {
  plan: ['', 'Keep','Replace','Temporary','Go-Away','Not Accommodated'],
  direction: ['', 'Inbound','Outbound','Bi-directional'],
  method: ['', 'API','File','N/A'], experience: ['', 'Yes','No'],
  solution: ['', 'Configurable','Customized'], support: ['', 'S','TPS','NS'],
};
export const RESOURCE_TYPES = ['Project Manager','Change Manager','Accounting / GL','Budget','Grants / Projects',
  'AP','AR','Purchasing','Fixed Assets','Core HCM','Recruitment','Benefits',
  'Timekeeping','Payroll','Learning Management','Integrations','Data Conversions','Reporting','System Administration','Other'];
export const TRIAL_KINDS = ['Trial conversion','Parallel payroll','Interface execution','User acceptance','Cutover rehearsal','Quarterly update','Hypercare'];
export function newPlan(project, cohortId='gl') {
  return {schema:'erp-burbank.trial-plan.v1',projectId:project.id,projectRevision:project.revision,
    trialId:cohortId+'-conversion',trialNumber:1,kind:'Trial conversion',requirementIds:[],interfaceIds:[],notes:''};
}
