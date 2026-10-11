// MIT. Public customer handoff; deterministic native clients and create-only receiving.
import { constants } from 'node:fs';
import { readFile, mkdir, open, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { privateDirectory, regular, saveJSON, operationLease } from '../../distribution/runtime-workspace/storage.mjs';
import { absolute } from '../config.mjs';
import { hash, stable, plain, requireValue, json, now } from '../storage.mjs';
import { CUSTOMER_API_VERSION, merchantContract, parseContract, contractOpenAPI, customerConfigurationTemplate } from './contract.mjs';

export const CUSTOMER_BUNDLE_SCHEMA='stellar-forge.mpp-customer-bundle.v1';
export const CUSTOMER_EXPORT_SCHEMA='stellar-forge.mpp-customer-export.v1';
export const MAX_CUSTOMER_BUNDLE_BYTES=2*1024*1024;
export const CUSTOMER_FILES=Object.freeze(['merchant-contract.json','merchant-openapi.json',
  'merchant-client.mjs','merchant-client.d.mts','merchant-client-bridge.mjs','merchant_client.py',
  'merchant_client.pyi','customer.example.json','package.json','examples/node.mjs','examples/python.py','README.md']);
const MANIFEST='customer-export.json';
const fields=['schema','generatorVersion','contractSha256','origin','files','sha256'];
const meta=file=>({name:file.name,bytes:file.bytes,sha256:file.sha256});
const core=bundle=>({schema:bundle.schema,generatorVersion:bundle.generatorVersion,
  contractSha256:bundle.contractSha256,origin:bundle.origin,files:bundle.files.map(meta)});
const quoted=value=>JSON.stringify(value);
const body=lines=>lines.join('\n')+'\n';
async function optional(path,maximum=MAX_CUSTOMER_BUNDLE_BYTES) {
  try{return await regular(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function generatedClient(contract) {
  return body([
    '// MIT. Generated native MPP client for contract SHA-256 '+contract.sha256+'.',
    "import { readFile } from 'node:fs/promises';",
    "import { CUSTOMER_API_VERSION, parseContract, connectCustomer, initializeCustomer } from '@tokenjunkielabs/starforge-merchant/mpp/customer';",
    'if(CUSTOMER_API_VERSION!=='+quoted(CUSTOMER_API_VERSION)+")throw new Error('MPP_CUSTOMER_API_VERSION');",
    "const original=parseContract(await readFile(new URL('./merchant-contract.json',import.meta.url)),",
    '  {expectedSha256:'+quoted(contract.sha256)+'});',
    'export const contract=structuredClone(original);',
    'export const source=Object.freeze('+JSON.stringify({apiVersion:CUSTOMER_API_VERSION,
      contractSha256:contract.sha256,origin:contract.origin,offerIds:contract.offers.map(o=>o.id)})+');',
    'export const connect=configuration=>connectCustomer({contract:original,configuration});',
    'export const initialize=configuration=>initializeCustomer({contract:original,configuration});'
  ]);
}
function generatedTypes(contract) {
  return body([
    '// MIT. Public operation names from the original native merchant contract.',
    "import type { MppContract, CustomerConfiguration, MppCustomer } from '@tokenjunkielabs/starforge-merchant/mpp/customer';",
    'export type OfferId = '+contract.offers.map(o=>quoted(o.id)).join(' | ')+';',
    'export const contract: MppContract;',
    'export const source: Readonly<{apiVersion:string;contractSha256:string;origin:string;offerIds:readonly OfferId[]}>;',
    'export function connect(configuration:CustomerConfiguration):Promise<MppCustomer<OfferId>>;',
    'export function initialize(configuration:CustomerConfiguration):Promise<Record<string,unknown>>;'
  ]);
}
function pythonTypes(contract) {
  return body([
    '# MIT. Native MPP customer type surface.',
    'from typing import Any, Literal, Mapping',
    'from os import PathLike',
    'OfferId = Literal['+contract.offers.map(o=>quoted(o.id)).join(', ')+']',
    'class CustomerError(RuntimeError):',
    '    code: str',
    '    purchase_id: str | None',
    'class Result:',
    '    status: int',
    '    headers: dict[str, str]',
    '    receipt: dict[str, Any]',
    '    accounting: dict[str, Any]',
    '    transaction: str',
    '    contract_sha256: str',
    '    offer_id: str',
    '    sha256: str',
    '    def bytes(self) -> bytes: ...',
    '    def text(self, encoding: str = "utf-8") -> str: ...',
    '    def json(self) -> Any: ...',
    'class Purchase:',
    '    id: str',
    '    def inspect(self) -> dict[str, Any]: ...',
    '    def execute(self) -> dict[str, Any]: ...',
    '    def resume(self) -> dict[str, Any]: ...',
    '    def finalize(self) -> dict[str, Any]: ...',
    '    def result(self) -> Result: ...',
    '    def save(self, destination: str | PathLike[str]) -> dict[str, Any]: ...',
    'class Customer:',
    '    contract: dict[str, Any]',
    '    contract_sha256: str',
    '    def __init__(self, configuration: Mapping[str, Any] | str | PathLike[str], *, node: str | PathLike[str] | None = None, timeout_seconds: int = 900): ...',
    '    def initialize(self) -> dict[str, Any]: ...',
    '    def prepare(self, offer_id: OfferId, *, purchase_id: str, query: Mapping[str, str | list[str]] | None = None, json_body: Any = ..., challenge_id: str | None = None) -> Purchase: ...',
    '    def purchase(self, purchase_id: str) -> Purchase: ...',
    '    def list(self, *, offset: int = 0, limit: int = 50) -> dict[str, Any]: ...',
    '    def refresh(self) -> dict[str, Any]: ...'
  ]);
}
function examples(contract) {
  const offer=contract.offers[0],jsonInput=offer.method==='POST'?",json:{}":'';
  return {
    'examples/node.mjs':body([
      '// MIT. Run from a terminal with the configured original governor and signer.',
      "import { readFile } from 'node:fs/promises';",
      "import { connect } from '../merchant-client.mjs';",
      "const configuration=JSON.parse(await readFile(new URL('../customer.json',import.meta.url),'utf8'));",
      "const purchaseId=process.argv[2];if(!purchaseId)throw new Error('Supply a unique purchase ID');",
      'const customer=await connect(configuration);',
      'try {',
      '  const purchase=await customer.prepare('+quoted(offer.id)+',{purchaseId'+jsonInput+'});',
      '  console.log(await purchase.inspect());',
      "  if(process.argv.includes('--execute')) {",
      '    await purchase.execute();',
      '    const result=await purchase.result();',
      '    console.log({receipt:result.receipt,accounting:result.accounting});',
      '    process.stdout.write(Buffer.from(await result.response.arrayBuffer()));',
      '  }',
      '} finally {await customer.close();}'
    ]),
    'examples/python.py':body([
      '"""MIT. The same native customer workflow through its fixed Node bridge."""',
      'import argparse',
      'from pathlib import Path',
      'import sys',
      'sys.path.insert(0, str(Path(__file__).resolve().parent.parent))',
      'from merchant_client import Customer',
      'parser = argparse.ArgumentParser()',
      'parser.add_argument("purchase_id")',
      'parser.add_argument("--execute", action="store_true")',
      'args = parser.parse_args()',
      'customer = Customer(Path(__file__).resolve().parent.parent / "customer.json")',
      'purchase = customer.prepare('+quoted(offer.id)+', purchase_id=args.purchase_id'+(offer.method==='POST'?', json_body={}':'')+')',
      'print(purchase.inspect())',
      'if args.execute:',
      '    purchase.execute()',
      '    result = purchase.result()',
      '    print({"receipt": result.receipt, "accounting": result.accounting})',
      '    sys.stdout.buffer.write(result.bytes())'
    ])
  };
}
function guide(contract) {
  return body([
    '# Native MPP customer package','',
    contract.title.replace(/[\r\n]/g,' '),'',
    'Merchant origin: '+contract.origin,
    'Contract SHA-256: '+contract.sha256,'',
    '## Install and configure','',
    'Use the maintained Starforge package containing the native MPP customer API, Node 22.16 or later, Python 3.11 or later and Linux flock. Install the supplied maintained archive into this customer directory:','',
    '~~~sh',
    'npm install /absolute/path/to/starforge-merchant.tgz --ignore-scripts --no-audit --no-fund',
    './node_modules/.bin/starforge mpp runtime-template /private/mpp-dependencies',
    'npm --prefix /private/mpp-dependencies ci --ignore-scripts --omit=dev --no-audit --no-fund',
    './node_modules/.bin/starforge mpp init /private/mpp-customer-workspace',
    '~~~','',
    'Copy customer.example.json to customer.json. Fill in the actual payer account, private workspace and dependency directory, existing governor ledger/policy, Python executable, actor/service and signer environment-variable name. Review the per-asset atomic limits and network-fee limits. The isolated published runtime is @stellar/mpp 0.7.1, mppx 0.6.29 and Stellar SDK 15.1.0.','',
    'The existing SF36 governor and its operator keys are configured on this host. Each fresh purchase uses its original terminal review and reservation. The generated package calls that original flow through the installed native MPP API.','',
    '## Node and Python','',
    'The examples prepare the first declared offer. Supply the application query or JSON fields required by that merchant. Each distinct purchase needs a unique ID.','',
    '~~~sh',
    'node examples/node.mjs report-001',
    'node examples/node.mjs report-001 --execute',
    'python3 examples/python.py report-002',
    'python3 examples/python.py report-002 --execute',
    '~~~','',
    'Prepare captures the actual HTTP 402 challenge for the exact request. Its price ceiling is the exported offer price, additionally limited by customer.json. Execute presents the original governor review in the launching terminal. Enter the displayed approval phrase to make that purchase.','',
    'Node: connect(configuration) returns a customer with prepare(offerId, {purchaseId, query, json}), purchase(purchaseId), list({offset, limit}), refresh() and close(). A purchase provides inspect(), execute(), resume(), finalize(), result() and save(absoluteDestination).','',
    'Python: Customer(configuration) exposes prepare(offer_id, purchase_id=..., query=..., json_body=...), purchase(id), list() and refresh(). Purchase methods use the same names. Result exposes bytes(), text(), json(), receipt, transaction, accounting and sha256.','',
    'The query map accepts strings or arrays of strings; repeated values preserve their order. JSON is passed through the maintained Node request builder in both languages. GET requests have no body.','',
    '## Reopen and recover','',
    'After an interrupted send, open purchase(original_id) and call resume(). That operation retains the original challenge, approved request, budget reservation and signed credential. A retry never creates a new purchase ID. Repeated prepare with the same complete request reopens its original saved preparation.','',
    'When delivery is pending, inspect() returns the current native record; resume() retries the original request. finalize() observes the original transaction and reconciles its original SF36 accounting record through SF86. result() returns saved successful resource bytes with the original native receipt and accounting result. save() writes those exact bytes to a new file in an existing private directory.','',
    'A live operator console owns its workspace process lease. Use that console for its active workspace, or finish the client session before opening the console on the same directory.','',
    '## Offer changes','',
    'refresh() returns the current public contract and its concrete per-offer differences. Existing purchases keep their saved original contract and request. Accept a new customer package to use new offers or a higher price for a new purchase. Merchant profile revisions remain explicit in the contract.','',
    'merchant-openapi.json documents the application endpoints and dynamic MPP authentication. The package contains public offer terms; each invocation obtains its own original payment challenge.','',
    '## Receiving and source','',
    'starforge mpp customer-inspect DIRECTORY reports the original package state and file identities. Interrupted receiving resumes with customer-resume DIRECTORY. The receiver regenerates the companion clients from the maintained templates and public contract before publishing files. Files already present must match the same generated bytes.','',
    'Add your application and customer.json beside the generated files. The generated contract and companion source retain their original bytes for reopening and receiving.'
  ]);
}
export async function createCustomerBundle({profile,contract:input}={}) {
  const contract=input?parseContract(input):merchantContract(profile);
  const [bridge,python]=await Promise.all([
    readFile(new URL('./templates/bridge.mjs',import.meta.url),'utf8'),
    readFile(new URL('./templates/merchant_client.py',import.meta.url),'utf8')]);
  const files={
    'merchant-contract.json':json(contract),'merchant-openapi.json':json(contractOpenAPI(contract)),
    'merchant-client.mjs':generatedClient(contract),'merchant-client.d.mts':generatedTypes(contract),
    'merchant-client-bridge.mjs':bridge,'merchant_client.py':python,'merchant_client.pyi':pythonTypes(contract),
    'customer.example.json':json(customerConfigurationTemplate(contract)),
    'package.json':json({name:'starforge-native-mpp-customer',version:'0.1.0',private:true,type:'module',
      exports:{'.':{types:'./merchant-client.d.mts',import:'./merchant-client.mjs'}},engines:{node:'>=22.16.0'},
      peerDependencies:{'@tokenjunkielabs/starforge-merchant':'>=0.1.0-0'},
      peerDependenciesMeta:{'@tokenjunkielabs/starforge-merchant':{optional:true}}}),
    ...examples(contract),'README.md':guide(contract)};
  const entries=CUSTOMER_FILES.map(name=>{
    requireValue(typeof files[name]==='string','MPP_CUSTOMER_GENERATOR_FILE_MISSING');
    return {name,content:files[name],bytes:Buffer.byteLength(files[name]),sha256:hash(files[name])};
  });
  const bundle={schema:CUSTOMER_BUNDLE_SCHEMA,generatorVersion:1,contractSha256:contract.sha256,
    origin:contract.origin,files:entries};
  bundle.sha256=hash(stable(core(bundle)));
  requireValue(Buffer.byteLength(JSON.stringify(bundle))<=MAX_CUSTOMER_BUNDLE_BYTES,'MPP_CUSTOMER_BUNDLE_TOO_LARGE');
  return bundle;
}
export function parseCustomerBundle(input) {
  if(typeof input==='string'||input instanceof Uint8Array) {
    requireValue(Buffer.byteLength(input)<=MAX_CUSTOMER_BUNDLE_BYTES,'MPP_CUSTOMER_BUNDLE_TOO_LARGE');
    input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(input)));
  }
  requireValue(plain(input) && Object.keys(input).every(k=>fields.includes(k)) &&
    Buffer.byteLength(JSON.stringify(input))<=MAX_CUSTOMER_BUNDLE_BYTES &&
    input.schema===CUSTOMER_BUNDLE_SCHEMA && input.generatorVersion===1 &&
    Array.isArray(input.files) && input.files.length===CUSTOMER_FILES.length,'MPP_CUSTOMER_BUNDLE_INVALID');
  for(let index=0;index<CUSTOMER_FILES.length;index++) {
    const file=input.files[index];
    requireValue(plain(file) && Object.keys(file).every(k=>['name','content','bytes','sha256'].includes(k)) &&
      file.name===CUSTOMER_FILES[index] && typeof file.content==='string' &&
      file.bytes===Buffer.byteLength(file.content) && file.sha256===hash(file.content),'MPP_CUSTOMER_BUNDLE_FILE_CHANGED');
  }
  const contract=parseContract(input.files[0].content,{expectedSha256:input.contractSha256});
  requireValue(input.origin===contract.origin && input.sha256===hash(stable(core(input))),'MPP_CUSTOMER_BUNDLE_CHANGED');
  return structuredClone(input);
}
async function trustedBundle(input) {
  const bundle=parseCustomerBundle(input);
  const expected=await createCustomerBundle({contract:parseContract(bundle.files[0].content)});
  requireValue(expected.sha256===bundle.sha256 && expected.files.every((file,index)=>
    file.content===bundle.files[index].content),'MPP_CUSTOMER_COMPANION_SOURCE_CHANGED');
  return bundle;
}
async function planAt(directory) {
  const bytes=await regular(join(directory,MANIFEST),MAX_CUSTOMER_BUNDLE_BYTES),plan=JSON.parse(bytes.toString('utf8'));
  requireValue(plan?.schema===CUSTOMER_EXPORT_SCHEMA && ['WRITING','COMPLETE'].includes(plan.state),
    'MPP_CUSTOMER_EXPORT_MANIFEST_INVALID');
  const expected=await createCustomerBundle({contract:parseContract(plan.contract)});
  requireValue(plan.bundleSha256===expected.sha256 && stable(plan.files)===stable(expected.files.map(meta)),
    'MPP_CUSTOMER_EXPORT_IDENTITY_CHANGED');
  return {plan,bundle:expected};
}
export async function inspectCustomerExport(directory) {
  directory=await privateDirectory(absolute(directory));
  const {plan,bundle}=await planAt(directory),files=[];
  for(const file of bundle.files) {
    const actual=await optional(join(directory,file.name));
    files.push({...meta(file),state:actual===null?'MISSING':
      actual.length===file.bytes && hash(actual)===file.sha256?'MATCH':'CHANGED'});
  }
  return {directory,bundleSha256:bundle.sha256,contractSha256:bundle.contractSha256,origin:bundle.origin,
    state:files.some(f=>f.state==='CHANGED')?'CHANGED':files.some(f=>f.state==='MISSING')?'INCOMPLETE':plan.state,
    files,createdAt:plan.createdAt,completedAt:plan.completedAt??null};
}
export async function receiveCustomerBundle({bundle:input,directory,resume=false}={}) {
  const bundle=await trustedBundle(input);
  directory=absolute(directory);await privateDirectory(dirname(directory));
  if(!resume)await mkdir(directory,{mode:0o700});
  directory=await privateDirectory(directory);
  const lease=await operationLease(join(directory,'.mpp-customer-export.lock'));
  try {
    let plan;
    if(await optional(join(directory,MANIFEST))) {
      const retained=await planAt(directory);plan=retained.plan;
      requireValue(retained.bundle.sha256===bundle.sha256,'MPP_CUSTOMER_EXPORT_IDENTITY_CHANGED');
    } else {
      plan={schema:CUSTOMER_EXPORT_SCHEMA,state:'WRITING',bundleSha256:bundle.sha256,
        contract:parseContract(bundle.files[0].content),files:bundle.files.map(meta),createdAt:now()};
      await saveJSON(join(directory,MANIFEST),plan);
    }
    await mkdir(join(directory,'examples'),{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    await privateDirectory(join(directory,'examples'));
    for(const file of bundle.files) {
      const path=join(directory,file.name),previous=await optional(path);
      if(previous!==null) {
        requireValue(previous.length===file.bytes && hash(previous)===file.sha256,'MPP_CUSTOMER_FILE_CONFLICT');
        continue;
      }
      const temporary=join(dirname(path),'.mpp-customer-'+randomUUID());
      const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
      try {
        await handle.writeFile(file.content,'utf8');await handle.sync();await handle.close();
        await link(temporary,path);
      } finally {await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
    }
    const examplesHandle=await open(join(directory,'examples'),'r');
    try{await examplesHandle.sync();}finally{await examplesHandle.close();}
    const directoryHandle=await open(directory,'r');
    try{await directoryHandle.sync();}finally{await directoryHandle.close();}
    await saveJSON(join(directory,MANIFEST),{...plan,state:'COMPLETE',completedAt:plan.completedAt??now()},true);
    return inspectCustomerExport(directory);
  } finally {await lease.close();}
}
export async function exportCustomerPackage({profile,contract,directory}={}) {
  return receiveCustomerBundle({bundle:await createCustomerBundle({profile,contract}),directory});
}
export async function resumeCustomerExport(directory) {
  directory=await privateDirectory(absolute(directory));
  const {bundle}=await planAt(directory);
  return receiveCustomerBundle({bundle,directory,resume:true});
}
export async function readCustomerBundleFile(path) {
  const file=await open(absolute(path),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const before=await file.stat();
    requireValue(before.isFile() && before.size<=MAX_CUSTOMER_BUNDLE_BYTES,'MPP_CUSTOMER_BUNDLE_FILE_INVALID');
    const bytes=await file.readFile(),after=await file.stat();
    requireValue(bytes.length===before.size && after.size===before.size && after.mtimeMs===before.mtimeMs,
      'MPP_CUSTOMER_BUNDLE_FILE_CHANGED');
    return parseCustomerBundle(bytes);
  } finally {await file.close();}
}
