// MIT. Service agreements borrow the original configured accounting owner.
import {defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {serviceAgreementTools, SERVICE_AGREEMENT_REQUEST_BYTES} from '../catalog/service-agreements.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'service-agreements', family: 'serviceAgreements',
  title: 'Service agreements and recurring invoices', order: 535, catalogOrder: 535,
  configKey: null, summary: true, dependencies: ['accounting'], maxRequestBytes: SERVICE_AGREEMENT_REQUEST_BYTES,
  tools: serviceAgreementTools,
  instructions: [{prefix: 'merchant_service_agreements_', order: 535,
    text: 'List the existing accounting aliases and open service agreements for one original workspace. Reuse its accounting customers and lease. Create agreements only from the complete original quotation and its accepted response. Review the dated monthly calendar; amend with a newly accepted quotation at an original monthly boundary, renew by explicit months, or cancel future billing with a date and reason. Every mutation retains the original revision, actor, requestId and existing agreement version. Preview a due period, then bill with that exact previewSha256 to create its editable receivables invoice draft. When preview includes recoveryRequest for PREPARING billing, reuse those original fields with the current revision. After an uncertain response, inspect and retry that same request. Read accepted quotation sources through source_file. Export returns all exact file hashes and a fixed asOf date; download complete files or agreement.tar with export_file, preserving expectedSha256, offset and readId across chunks. file_release closes an interrupted read. Close the original accounting workspace before opening its same directory in the browser or Applications.'}],
  load: () => import('../service-agreements.mjs'),
  create: (module, config, options, dependencies) => new module.MerchantServiceAgreements(dependencies.accounting),
});
