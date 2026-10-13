// MIT. Provider-specific document inputs and dated supplier units.
export const DOCUMENT_SETUP_SCHEMA = 'stellar-forge.document-merchant-setup.v1';
export const DOCUMENT_PROVIDER_SCHEMA = 'stellar-forge.document-provider.v1';
export const DOCUMENT_RENDER_SCHEMA = 'stellar-forge.document-render.v1';
export const SOURCE_CHECKED_ON = '2026-10-12';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => JSON.parse(JSON.stringify(value));
export function documentError(code, message = code, details = {}) {
  return Object.assign(new Error(message), {code, ...details});
}
export function requireDocument(condition, code, message) {
  if (!condition) throw documentError(code, message);
}
function fields(value, allowed, label) {
  requireDocument(plain(value) && Object.keys(value).every(key => allowed.includes(key)),
    'DOCUMENT_INPUT_INVALID', 'Use the declared ' + label + ' fields.');
}
function integer(value, minimum, maximum, label) {
  requireDocument(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'DOCUMENT_INPUT_INVALID', label + ' must be a whole number from ' + minimum + ' to ' + maximum + '.');
  return value;
}
function text(value, minimum, maximum, label) {
  requireDocument(typeof value === 'string' && value.length >= minimum && value.length <= maximum &&
    !/\u0000/.test(value), 'DOCUMENT_INPUT_INVALID', 'Supply ' + label + ' within its stated text limit.');
  return value;
}
export function utf8Bytes(value) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {bytes += 4; i++;}
    else bytes += 3;
  }
  return bytes;
}
const plans = (rows, period = 'month') => rows.map(([id, label, priceMinor, units, concurrency, rate]) =>
  ({id, label, currency: 'USD', priceMinor, units, period, concurrency, requestsPerMinute: rate}));
const PROVIDERS = {
  mintpdf: {
    id: 'mintpdf', name: 'MintPDF', origin: 'https://mintpdf.dev', path: '/v1/pdf', usagePath: '/v1/me',
    formats: ['html', 'markdown'], defaultKeyEnvironment: 'MINTPDF_API_KEY', anonymous: true,
    unit: 'render', maxSourceBytes: 512000, maxRequestBytes: 900000,
    limitBasis: 'This integration selects a 512,000-byte source and 900,000-byte JSON request ceiling; the public OpenAPI does not declare a body-size ceiling.',
    plans: [
      {id: 'anonymous', label: 'Anonymous', currency: 'USD', priceMinor: 0, units: 3,
       period: 'day_per_IP', concurrency: null, requestsPerMinute: null},
      ...plans([['free', 'Free key', 0, 100, null, null], ['solo', 'Solo', 1900, 3000, null, null],
        ['team', 'Team', 4900, 12000, null, null], ['scale', 'Scale', 12900, 50000, null, null]])
    ],
    sources: ['https://mintpdf.dev/openapi.json', 'https://mintpdf.dev/',
      'https://github.com/TrendTweekers/mintpdf'],
    responseHeaders: ['x-request-id', 'retry-after'],
    billing: 'Published plans count renders. A lost response can leave provider consumption unobserved.'
  },
  snaplab: {
    id: 'snaplab', name: 'snaplab', origin: 'https://snaplab.dev', path: '/api/render', usagePath: '/api/me',
    formats: ['html'], defaultKeyEnvironment: 'SNAPLAB_API_KEY', anonymous: false,
    unit: 'non_cached_render', maxSourceBytes: 1500000, maxRequestBytes: 2000000,
    limitBasis: 'The API documents HTML up to 2 MB. This integration leaves JSON-envelope room with a 1,500,000-byte source and 2,000,000-byte request ceiling.',
    plans: plans([['free', 'Free', 0, 100, 1, 30], ['starter', 'Starter', 900, 2000, 3, 120],
      ['pro', 'Pro', 2900, 10000, 5, 300], ['business', 'Business', 7900, 40000, 10, 600]], 'calendar_month'),
    sources: ['https://snaplab.dev/docs', 'https://snaplab.dev/'],
    responseHeaders: ['x-snaplab-cache', 'x-snaplab-fingerprint', 'x-snaplab-duration-ms',
      'x-snaplab-quota-remaining', 'x-request-id', 'retry-after'],
    billing: 'A successful non-cached render consumes one render. Cache hits and failures are free.'
  },
  pdfmint: {
    id: 'pdfmint', name: 'PDFMint', origin: 'https://pdf.mintapis.com', path: '/v1/pdf', usagePath: '/v1/me',
    formats: ['html', 'markdown'], defaultKeyEnvironment: 'PDFMINT_API_KEY', anonymous: false,
    unit: 'document_credit', maxSourceBytes: 10000000, maxRequestBytes: 12000000,
    limitBasis: 'The API documents 10 MB HTML and a 12 MB request body. The complete encoded request is checked before dispatch.',
    plans: plans([['free', 'Free', 0, 10, 2, 120], ['starter', 'Starter', 900, 5000, 2, 120],
      ['pro', 'Pro', 2900, 50000, 2, 120], ['scale', 'Scale', 9900, 250000, 2, 120]]),
    sources: ['https://pdf.mintapis.com/docs', 'https://pdf.mintapis.com/',
      'https://github.com/fstandhartinger/pdfmint'],
    responseHeaders: ['x-pdfmint-pages', 'x-pdfmint-duration-ms', 'x-pdfmint-credits-remaining',
      'x-pdfmint-credits-limit', 'x-pdfmint-warning', 'x-pdfmint-page-errors', 'x-request-id', 'retry-after'],
    billing: 'One successful document call consumes one credit regardless of page count.'
  }
};
export function documentProviders() {
  return Object.values(PROVIDERS).map(provider => ({...copy(provider), checkedOn: SOURCE_CHECKED_ON}));
}
export function documentProvider(id) {
  requireDocument(typeof id === 'string' && Object.hasOwn(PROVIDERS, id),
    'DOCUMENT_PROVIDER_REQUIRED', 'Select mintpdf, snaplab or pdfmint.');
  return {...copy(PROVIDERS[id]), checkedOn: SOURCE_CHECKED_ON};
}
export function normalizeDocumentProvider(value) {
  fields(value, ['schema', 'provider', 'plan', 'authentication', 'keyEnvironment',
    'maxSourceBytes', 'maxPdfBytes', 'timeoutMs'], 'document provider');
  requireDocument(value.schema === DOCUMENT_PROVIDER_SCHEMA, 'DOCUMENT_PROVIDER_CONFIG_REQUIRED');
  const provider = documentProvider(value.provider);
  const authentication = value.authentication ?? 'bearer';
  requireDocument(authentication === 'bearer' || authentication === 'anonymous' && provider.anonymous,
    'DOCUMENT_AUTHENTICATION_INVALID', 'This provider requires its original bearer key.');
  const planId = value.plan ?? (authentication === 'anonymous' ? 'anonymous' : 'free');
  const plan = provider.plans.find(item => item.id === planId);
  requireDocument(plan && (plan.id === 'anonymous') === (authentication === 'anonymous'),
    'DOCUMENT_PLAN_INVALID', 'Select the supplier plan that matches this authentication mode.');
  const keyEnvironment = authentication === 'anonymous' ? null : value.keyEnvironment ?? provider.defaultKeyEnvironment;
  requireDocument(authentication !== 'anonymous' || value.keyEnvironment === undefined || value.keyEnvironment === null,
    'DOCUMENT_AUTHENTICATION_INVALID', 'Anonymous rendering has no key environment.');
  requireDocument(keyEnvironment === null || typeof keyEnvironment === 'string' &&
    /^[A-Z][A-Z0-9_]{2,63}$/.test(keyEnvironment), 'DOCUMENT_KEY_ENVIRONMENT_INVALID');
  const maxSourceBytes = integer(value.maxSourceBytes ?? provider.maxSourceBytes, 1,
    provider.maxSourceBytes, 'Source byte limit');
  const maxPdfBytes = integer(value.maxPdfBytes ?? 33554432, 1024,
    67108864 - maxSourceBytes - 1310720, 'PDF byte limit');
  return {
    schema: DOCUMENT_PROVIDER_SCHEMA, provider: provider.id, plan: plan.id, authentication,
    keyEnvironment, maxSourceBytes, maxPdfBytes,
    timeoutMs: integer(value.timeoutMs ?? 120000, 1000, 180000, 'Request timeout')
  };
}
const boolean = {type: 'boolean'};
const string = maxLength => ({type: 'string', maxLength});
const length = {type: 'string', minLength: 1, maxLength: 32, pattern: '^(?:0|(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:px|mm|cm|in|pt|pc))$'};
const margins = {type: 'object', properties: {top: length, right: length, bottom: length, left: length},
  required: ['top', 'right', 'bottom', 'left'], additionalProperties: false};
const paper = {type: 'string', enum: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid', 'Ledger']};
const mintPaper = {type: 'string', enum: ['A4', 'Letter', 'Legal', 'A3', 'A5']};
const scale = {type: 'number', minimum: 0.1, maximum: 2};
function objectSchema(properties) {
  return {type: 'object', properties, additionalProperties: false};
}
export function documentSettingsSchema(id) {
  documentProvider(id);
  if (id === 'mintpdf') return objectSchema({
    format: mintPaper, landscape: boolean, margin: length,
    headerText: string(2000), footerText: string(2000), pageNumbers: boolean
  });
  if (id === 'snaplab') return objectSchema({
    pdf: objectSchema({
      format: paper, landscape: boolean, printBackground: boolean, margin: margins, scale,
      preferCSSPageSize: boolean, headerTemplate: string(20000), footerTemplate: string(20000),
      displayHeaderFooter: boolean, pageRanges: string(200), media: {type: 'string', enum: ['print', 'screen']},
      tagged: boolean, outline: boolean, width: length, height: length, omitBackground: boolean
    }),
    cache: boolean, waitUntil: {type: 'string', enum: ['auto', 'networkidle', 'load', 'domcontentloaded']},
    waitForSelector: string(2000), delayMs: {type: 'integer', minimum: 0, maximum: 30000}
  });
  return objectSchema({
    options: objectSchema({
      format: paper, width: length, height: length, landscape: boolean, margin: margins, scale,
      printBackground: boolean, headerHtml: string(20000), footerHtml: string(20000),
      pageNumbers: boolean, preferCSSPageSize: boolean,
      mediaType: {type: 'string', enum: ['print', 'screen']}
    }),
    strict: boolean, javascript: boolean, waitFor: string(2000),
    css: string(20000), googleFonts: string(1000),
    timeout: {type: 'integer', minimum: 1000, maximum: 120000}
  });
}
export function defaultDocumentSettings(id) {
  documentProvider(id);
  if (id === 'mintpdf') return {format: 'A4', margin: '18mm', pageNumbers: true};
  if (id === 'snaplab') return {
    pdf: {format: 'A4', printBackground: true, media: 'print',
      margin: {top: '18mm', right: '14mm', bottom: '18mm', left: '14mm'}, footerTemplate: '@pageNumbers'},
    cache: true, waitUntil: 'auto'
  };
  return {
    options: {format: 'A4', printBackground: true, mediaType: 'print',
      margin: {top: '18mm', right: '14mm', bottom: '18mm', left: '14mm'}, pageNumbers: true},
    strict: true, javascript: true
  };
}
function validateShape(value, schema, path) {
  if (schema.type === 'object') {
    fields(value, Object.keys(schema.properties), path);
    for (const key of schema.required ?? []) requireDocument(Object.hasOwn(value, key),
      'DOCUMENT_SETTINGS_INVALID', 'Supply ' + path + '.' + key + '.');
    for (const [key, child] of Object.entries(value)) validateShape(child, schema.properties[key], path + '.' + key);
  } else if (schema.type === 'string') {
    text(value, schema.minLength ?? 0, schema.maxLength ?? 20000, path);
    if (schema.enum) requireDocument(schema.enum.includes(value), 'DOCUMENT_SETTINGS_INVALID', 'Select a supported ' + path + '.');
    if (schema.pattern) requireDocument(new RegExp(schema.pattern).test(value), 'DOCUMENT_SETTINGS_INVALID',
      path + ' requires a nonnegative CSS length with its unit, or 0.');
  } else if (schema.type === 'boolean') {
    requireDocument(typeof value === 'boolean', 'DOCUMENT_SETTINGS_INVALID', path + ' requires true or false.');
  } else {
    requireDocument(typeof value === 'number' && Number.isFinite(value) &&
      (schema.type !== 'integer' || Number.isSafeInteger(value)) &&
      value >= schema.minimum && value <= schema.maximum, 'DOCUMENT_SETTINGS_INVALID',
      path + ' is outside its supported range.');
  }
}
export function documentInputSchema(providerId, format) {
  if(format==='pdf-set')return documentAssemblyInputSchema(providerId);
  const provider = documentProvider(providerId);
  requireDocument(provider.formats.includes(format), 'DOCUMENT_SOURCE_FORMAT_UNSUPPORTED');
  return {
    type: 'object',
    properties: {
      title: {type: 'string', minLength: 1, maxLength: 200},
      taskReference: {type: 'string', minLength: 1, maxLength: 200},
      settings: documentSettingsSchema(providerId)
    },
    required: ['title', 'taskReference'], additionalProperties: false
  };
}
export function normalizeDocumentInput(providerId, format, input) {
  if(format==='pdf-set')return normalizeDocumentAssemblyInput(providerId,input);
  const provider = documentProvider(providerId);
  requireDocument(provider.formats.includes(format), 'DOCUMENT_SOURCE_FORMAT_UNSUPPORTED',
    provider.name + ' accepts ' + provider.formats.join(' or ') + ' in this document workflow.');
  fields(input, ['title', 'taskReference', 'settings', '$files'], 'document request');
  const settings = copy(input.settings ?? defaultDocumentSettings(providerId));
  validateShape(settings, documentSettingsSchema(providerId), 'settings');
  const page = providerId === 'snaplab' ? settings.pdf : providerId === 'pdfmint' ? settings.options : settings;
  if (page) requireDocument(Object.hasOwn(page, 'width') === Object.hasOwn(page, 'height'),
    'DOCUMENT_PAGE_DIMENSIONS_REQUIRED', 'Provide both custom page width and height.');
  if (providerId === 'pdfmint' && format !== 'markdown')
    requireDocument(settings.css === undefined && settings.googleFonts === undefined,
      'DOCUMENT_SETTINGS_INVALID', 'PDFMint css and googleFonts apply to Markdown; include HTML styling in its source file.');
  return {title: text(input.title, 1, 200, 'document title'),
    taskReference: text(input.taskReference, 1, 200, 'original customer task reference'), settings};
}
export function buildDocumentRequest(configuration, format, input, sourceText) {
  if(format==='pdf-set')return buildDocumentAssemblyRequest(configuration,input,sourceText);
  const config = normalizeDocumentProvider(configuration), provider = documentProvider(config.provider);
  const selected = normalizeDocumentInput(provider.id, format, input);
  requireDocument(typeof sourceText === 'string' && sourceText.trim().length > 0 &&
    utf8Bytes(sourceText) <= config.maxSourceBytes, 'DOCUMENT_SOURCE_SIZE_INVALID',
    'Use a complete nonempty UTF-8 document within the selected source byte limit.');
  const source = {[format]: sourceText};
  let body;
  if (provider.id === 'mintpdf') body = {...source, ...selected.settings, output: 'pdf'};
  else if (provider.id === 'snaplab') body = {...source, ...selected.settings,
    format: 'pdf', responseType: 'binary', filename: 'document.pdf'};
  else {
    requireDocument(selected.settings.timeout === undefined || selected.settings.timeout <= config.timeoutMs,
      'DOCUMENT_SETTINGS_INVALID', 'Provider timeout must fit the selected request timeout.');
    body = {...source, ...selected.settings, output: 'binary', filename: 'document.pdf',
      metadata: {title: selected.title}};
  }
  const bodyText = JSON.stringify(body);
  requireDocument(utf8Bytes(bodyText) <= provider.maxRequestBytes, 'DOCUMENT_PROVIDER_BODY_TOO_LARGE',
    'The complete JSON request exceeds this provider integration limit; reduce embedded source size.');
  return {provider: provider.id, url: provider.origin + provider.path, method: 'POST',
    contentType: 'application/json', bodyText, input: selected, config};
}
export function documentPriceReview(configuration, {documents = 1, supplierUnits = documents} = {}) {
  const config = normalizeDocumentProvider(configuration), provider = documentProvider(config.provider);
  const plan = provider.plans.find(item => item.id === config.plan);
  integer(documents, 0, 1000000000, 'Customer document count');
  integer(supplierUnits, 0, 1000000000, 'Expected supplier units');
  return {
    schema: 'stellar-forge.document-price-review.v1', sourceCheckedOn: SOURCE_CHECKED_ON,
    provider: provider.id, selectedPlan: copy(plan), expectedDocuments: documents, expectedSupplierUnits: supplierUnits,
    supplierUnit: provider.unit, withinIncludedUnits: supplierUnits <= plan.units,
    unitsAboveIncluded: Math.max(0, supplierUnits - plan.units),
    subscriptionAllocation: {currency: plan.currency, period: plan.period,
      numeratorMinor: String(plan.priceMinor), denominatorUnits: String(plan.units),
      atRequestedUtilization: supplierUnits === 0 ? null :
        {numeratorMinor: String(plan.priceMinor), denominatorUnits: String(supplierUnits)}},
    sourceLimit: config.maxSourceBytes, pdfLimit: config.maxPdfBytes,
    billingBasis: provider.billing, sources: [...provider.sources],
    interpretation: 'The selected published plan is a planning input. Actual account usage, supplier charges and the merchant native-asset price remain their original records.'
  };
}


/** Complete ordered PDF input for the provider's original /v1/merge contract. */
export const DOCUMENT_PDF_SOURCE_SCHEMA = 'stellar-forge.document-pdf-source.v1';
export const DOCUMENT_ASSEMBLY_SOURCE_CHECKED_ON = '2026-10-13';
export const DOCUMENT_ASSEMBLY_FORMAT = 'pdf-set';
export const DOCUMENT_ASSEMBLY_MAX_FILES = 50;
export function documentAssemblySettingsSchema() {
  return objectSchema({strict:boolean,author:string(200),subject:string(500),keywords:string(1000)});
}
export function normalizeDocumentAssemblyInput(providerId,input) {
  requireDocument(providerId==='pdfmint','DOCUMENT_ASSEMBLY_PROVIDER_REQUIRED',
    'The installed ordered PDF assembly uses the original PDFMint account.');
  fields(input,['title','taskReference','settings','$files'],'PDF assembly request');
  const settings=copy(input.settings??{strict:true});
  validateShape(settings,documentAssemblySettingsSchema(),'settings');
  return {title:text(input.title,1,200,'document title'),
    taskReference:text(input.taskReference,1,200,'original customer task reference'),settings};
}
export function documentAssemblyInputSchema(providerId) {
  requireDocument(providerId==='pdfmint','DOCUMENT_ASSEMBLY_PROVIDER_REQUIRED');
  return {type:'object',properties:{
    title:{type:'string',minLength:1,maxLength:200},
    taskReference:{type:'string',minLength:1,maxLength:200},
    settings:documentAssemblySettingsSchema()
  },required:['title','taskReference'],additionalProperties:false};
}
export function normalizeDocumentPdfSource(value,{minimumFiles=2}={}) {
  fields(value,['schema','files'],'ordered PDF source');
  requireDocument(value.schema===DOCUMENT_PDF_SOURCE_SCHEMA&&Array.isArray(value.files)&&
    value.files.length>=minimumFiles&&value.files.length<=DOCUMENT_ASSEMBLY_MAX_FILES,
    'DOCUMENT_ASSEMBLY_FILES_REQUIRED','Supply two to fifty complete PDFs in the required order.');
  const seen=new Set();
  const files=value.files.map((file,index)=>{
    fields(file,['id','filename','bytes','sha256','base64','reference'],'PDF source file');
    requireDocument(typeof file.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(file.id)&&
      !seen.has(file.id),'DOCUMENT_ASSEMBLY_FILE_ID_REQUIRED');seen.add(file.id);
    const filename=text(file.filename,1,200,'original PDF filename');
    requireDocument(!/[\x00-\x1f\x7f/\\]/.test(filename)&&/\.pdf$/i.test(filename),
      'DOCUMENT_ASSEMBLY_FILENAME_REQUIRED');
    const bytes=integer(file.bytes,8,33554432,'PDF source bytes');
    requireDocument(typeof file.sha256==='string'&&/^[a-f0-9]{64}$/.test(file.sha256)&&
      typeof file.base64==='string'&&file.base64.length===4*Math.ceil(bytes/3)&&
      !/[^A-Za-z0-9+/=]/.test(file.base64)&&
      (file.base64.indexOf('=')===-1||file.base64.indexOf('=')>=file.base64.length-2)&&
      (bytes%3===0?!file.base64.endsWith('='):bytes%3===1?file.base64.endsWith('=='):
        file.base64.endsWith('=')&&!file.base64.endsWith('==')),
      'DOCUMENT_ASSEMBLY_FILE_BYTES_REQUIRED','Retain every complete original PDF byte.');
    return {id:file.id,filename,bytes,sha256:file.sha256,base64:file.base64,
      ...(file.reference===undefined?{}:{reference:text(file.reference,1,500,'original PDF reference')})};
  });
  return {schema:DOCUMENT_PDF_SOURCE_SCHEMA,files};
}
export function buildDocumentAssemblyRequest(configuration,input,sourceText) {
  const config=normalizeDocumentProvider(configuration);
  const selected=normalizeDocumentAssemblyInput(config.provider,input);
  requireDocument(typeof sourceText==='string'&&utf8Bytes(sourceText)>0&&
    utf8Bytes(sourceText)<=config.maxSourceBytes,'DOCUMENT_SOURCE_SIZE_INVALID');
  let value;try{value=JSON.parse(sourceText);}catch{
    throw documentError('DOCUMENT_ASSEMBLY_SOURCE_JSON_REQUIRED','Select the complete ordered PDF source JSON.');
  }
  const source=normalizeDocumentPdfSource(value);
  const {strict,...metadata}=selected.settings;
  const body={files:source.files.map(file=>({base64:file.base64})),filename:'document.pdf',
    output:'binary',strict:strict??true,metadata:{title:selected.title,...metadata}};
  const bodyText=JSON.stringify(body),provider=documentProvider(config.provider);
  requireDocument(utf8Bytes(bodyText)<=provider.maxRequestBytes,'DOCUMENT_PROVIDER_BODY_TOO_LARGE',
    'The complete PDF assembly exceeds the original provider request limit.');
  return {provider:provider.id,format:DOCUMENT_ASSEMBLY_FORMAT,input:selected,
    url:provider.origin+'/v1/merge',method:'POST',contentType:'application/json',body,bodyText,
    source,sourceCheckedOn:DOCUMENT_ASSEMBLY_SOURCE_CHECKED_ON};
}
