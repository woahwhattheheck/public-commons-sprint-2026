// MIT. Columbus's original procurement context for the shared ERP operator.
export const PROFILE_ID = 'columbus-rfp27-0008';
export const METADATA_SCHEMA = 'erp-columbus.acceptance-plan.v1';

export const sources = Object.freeze([
  {id:'rfp',title:'Original RFP 27-0008',filename:'RFP27-0008.pdf',
    url:'https://columbusga.gov/Portals/finance/adam/Content/LDQoKeGkfk6iEZfk7wkYyw/SolicitationDocument/RFP27-0008.pdf',
    sha256:'283afce21ae55fb1bd2c74781c7447b210038a140699d9d67474342ba884d250'},
  {id:'addendum-1',title:'Addendum 1 — August 24, 2026',filename:'RFP27-0008Add1.pdf',
    url:'https://columbusga.gov/Portals/finance/Resources/bid-opportunities/2027/Heather%20FY27/RFP27-0008Add1.pdf?ver=cv2WcenM8Clm9ZrVslwP2w%3D%3D',
    sha256:'071497b2e50be2fc63020ba9f46299dac2f352cb1105f1e71f273d0f2225d5a0'},
  {id:'addendum-2',title:'Addendum 2 — October 7, 2026',filename:'RFP27-0008Add2.pdf',
    url:'https://columbusga.gov/Portals/finance/Resources/bid-opportunities/2027/Heather%20FY27/RFP27-0008Add2.pdf?ver=wbOYnkUWs-BsSJZBX9578g%3D%3D',
    sha256:'005e745e7e8ba07089cfcdaada114b9d8437ab2fb24f5a3458ccfd260a09f5d9'},
]);

export const procurement = Object.freeze({
  id:'27-0008',title:'Columbus ERP conversion and phase acceptance',
  buyer:'Columbus Consolidated Government, Georgia',
  listing:'https://columbusga.gov/finance/bid-opportunities',
  observedOn:'2026-10-11',deadline:'2026-10-28T17:00:00-04:00',timeZone:'America/New_York',
  deadlineSource:'Addendum 2, page 1; current City listing',
  incumbent:'CGI Advantage 4.0, vendor-hosted SaaS',
});

export const domains = Object.freeze([
  {id:'financial',title:'Financial and general ledger'},
  {id:'procurement',title:'Procurement, vendors and commitments'},
  {id:'human_resources',title:'Human resources and positions'},
  {id:'payroll',title:'Parallel payroll and payroll history'},
  {id:'assets',title:'Fixed assets'},
]);

export const phases = Object.freeze([
  {id:'trial_conversion',title:'Trial conversion'},
  {id:'parallel_payroll',title:'Parallel payroll'},
  {id:'phase_acceptance',title:'Phase acceptance'},
  {id:'cutover',title:'Cutover'},
  {id:'fiscal_year_end',title:'First fiscal year-end'},
  {id:'payroll_year_end',title:'First payroll and tax year-end'},
]);

export const criteria = Object.freeze([
  {id:'scope',title:'Historical and active data scope',source:'rfp',page:13,section:'IV. Transition Period',
    detail:'Retain the agreed active and historical scope across financial, procurement, human resource and payroll data.'},
  {id:'conversion',title:'Conversion plan and responsibilities',source:'addendum-2',page:4,section:'11(G)',
    detail:'Record extraction, cleansing, mapping, loading and validation; proposed historical years and number of trial conversions; vendor and City responsibilities.'},
  {id:'interfaces',title:'Interfaces and independent checks',source:'addendum-2',page:4,section:'11(H)',
    detail:'Identify application, financial institution, benefit-provider and State/Federal reporting interfaces and their retained results.'},
  {id:'acceptance',title:'City phase criteria and parallel payroll',source:'addendum-2',page:4,section:'11(I)',
    detail:'Record the phase criteria and review results, including parallel payroll before go-live. The original comparison result stays separate from the reviewer decision.'},
  {id:'cutover',title:'Freeze, readiness and rollback',source:'addendum-2',page:4,section:'11(K)',
    detail:'Retain the cutover window, source freeze, readiness review, support coverage and rollback contingency.'},
  {id:'continuation',title:'Hypercare and both first year-ends',source:'addendum-2',page:4,section:'11(L)',
    detail:'Record elevated support and the handoff through the first fiscal close and first calendar payroll/tax reporting cycle.'},
  {id:'portability',title:'Reusable source and handoff',source:'addendum-2',page:5,section:'11(Q)',
    detail:'Preserve machine-readable data and source/report identities in the original private replay export.'},
]);

export const profile = Object.freeze({id:PROFILE_ID,title:procurement.title,procurement,sources,domains,phases,criteria});

// Logical cohort templates for the existing operator. Its observed-header mapper
// supplies physical source/target columns; these are editable business grains.
const money = names => names.map(name=>({name,scale:2,tolerance:'0.00'}));
export const OPERATOR_PROFILE = Object.freeze({
  id:PROFILE_ID,title:procurement.title,
  source:{url:sources[2].url,label:'Columbus RFP 27-0008, Addendum 2',sections:['11(G)','11(H)','11(I)','11(K)','11(L)','11(Q)']},
  cohorts:[
    {id:'gl',title:'General ledger by fund and period',
      purpose:'Compare each declared journal line, signed debit/credit and fund/period aggregate; retain the independent trial-balance reference in the phase plan.',
      keys:['fiscal_year','fund','posting_period','document_id','line_id','account_class','account_code'],
      attributes:[],amounts:money(['debits','credits']),groupBy:['fiscal_year','fund','posting_period']},
    {id:'parallel_payroll',title:'Parallel payroll',
      purpose:'Compare the complete selected pay-run population and exact gross, net, tax, deductions and employer fringe under the reviewed mapping.',
      keys:['pay_period_end','pay_cycle','employee_token','check_sequence'],attributes:[],
      amounts:money(['gross_pay','net_pay','employee_tax','deductions','employer_fringe']),groupBy:['pay_period_end','pay_cycle']},
    {id:'vendor_master',title:'Vendor master',purpose:'Key coverage and exact declared vendor attributes.',
      keys:['vendor_id'],attributes:['vendor_name','payment_status'],amounts:[],groupBy:[]},
    {id:'procurement',title:'Procurement commitments',purpose:'Open and historical purchase-order lines and their declared commitment amounts.',
      keys:['fund','purchase_order','line_id'],attributes:['status'],
      amounts:money(['committed_amount','liquidated_amount']),groupBy:['fund']},
    {id:'employee_master',title:'Employee and position master',purpose:'Pseudonymous employee key coverage and declared employment/position attributes.',
      keys:['employee_token'],attributes:['position_code','employment_status'],amounts:[],groupBy:[]},
    {id:'assets',title:'Fixed asset register',purpose:'Asset coverage, declared classifications and exact cost/depreciation balances.',
      keys:['fund','asset_id'],attributes:['asset_class','status'],
      amounts:money(['cost','accumulated_depreciation']),groupBy:['fund']},
  ],
  scenarios:[
    {id:'financial_controls',title:'Independent fund/period balances and source-to-target financial continuity',cohorts:['gl','procurement','assets']},
    {id:'payroll_controls',title:'Parallel gross-to-net, void/off-cycle and payroll-to-finance control review',cohorts:['parallel_payroll']},
    {id:'history_coverage',title:'Agreed active and historical population, periods and original identifiers',cohorts:['gl','parallel_payroll','vendor_master','procurement','employee_master','assets']},
    {id:'interfaces',title:'Recorded application, banking, benefit-provider and reporting interface results',cohorts:['gl','parallel_payroll','vendor_master','procurement','employee_master','assets']},
    {id:'cutover_rollback',title:'Source freeze, cutover support and usable rollback contingency',cohorts:['gl','parallel_payroll','vendor_master','procurement','employee_master','assets']},
    {id:'year_end',title:'First fiscal close and first payroll/tax year-end continuation',cohorts:['gl','parallel_payroll']},
  ],
});

export const cohortDomain = Object.freeze({gl:'financial',parallel_payroll:'payroll',vendor_master:'procurement',
  procurement:'procurement',employee_master:'human_resources',assets:'assets'});
