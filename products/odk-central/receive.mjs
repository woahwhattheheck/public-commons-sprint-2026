#!/usr/bin/env node
// MIT. Installed receiving entry over the original Central source and host workflows.
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runOriginalCentralPython,CENTRAL_RELEASED_RECEIVING_ENTRY} from './host.mjs';

const MANAGED_DRIVER=fileURLToPath(new URL(
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/receive-managed.mjs',import.meta.url));
const MANAGED_LAUNCHER=fileURLToPath(new URL(
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/run-managed-receiving.py',import.meta.url));
const MANAGED_DRIVER_SHA256='927857cc4f2d92a3fee07fcb620fc7dd5c64acebfd5b4610474209e351d38ff4';
const MANAGED_HELP=String.raw`Installed ODK application receiving

  starforge odk-central-receive managed \
    --work-directory /PRIVATE_ORIGINAL_RECEIVING \
    --playwright /EXISTING_PLAYWRIGHT_MODULE \
    --chromium /EXISTING_CHROMIUM \
    [--timeout-seconds 900]

This installed command selects its own package, current Node executable, original
Python launcher and exact reviewed managed driver. Use an existing Linux host
with Python 3.11+, Node 24+, Playwright and Chromium. The same private directory
retains the original CB57-ODK-MANAGED-RECEIVING operation, inputs, native actions,
browser downloads, archive restoration, editable receiving and final result.
The programme starts the original application and owns its exact process cleanup.

Use absolute paths. Keep the same package, runtime, browser and receiving directory
when resuming. Read native/MANAGED_RECEIVING.md for the full operation and direct
Python entry when supplying a separately installed package.
`;

const HELP=String.raw`ODK Central receiving

Receive an existing authorized Central source:
  starforge odk-central-receive source --request INPUT.json \
    --directory ORIGINAL_WORKSPACE --output RECEIVING \
    --restore-directory REOPENED_WORKSPACE

Receive released native forms and both reporting periods on the selected host:
  starforge odk-central-receive released --host-config PRIVATE_HOST.json \
    --work-directory PRIVATE_RECEIVING_DIRECTORY [--operation ORIGINAL_OPERATION]

Continue through approved PostgreSQL receiving and the complete customer ZIP:
  starforge odk-central-receive released --host-config PRIVATE_HOST.json \
    --work-directory PRIVATE_RECEIVING_DIRECTORY \
    --warehouse-profiles PRIVATE_HOST_PROFILES.json --warehouse-profile PROFILE \
    --warehouse-reviewer NAME --warehouse-note TEXT

Continue the two original commissioned periods from an accepted full capture:
  starforge odk-central-receive periods --request ORIGINAL_PERIOD_REQUEST.json \
    --directory ORIGINAL_WORKSPACE --output ORIGINAL_PERIOD_RECEIVING \
    --restore ORIGINAL_COMMISSIONED_REOPEN

Receive all approved periods and reopen the same PostgreSQL warehouse:
  starforge odk-central-receive warehouse --request ORIGINAL_WAREHOUSE_SELECTION.json \
    --profiles PRIVATE_HOST_PROFILES.json --profile PROFILE --reviewer NAME --note TEXT \
    --output ORIGINAL_WAREHOUSE_RECEIVING --restore-directory REOPENED_CENTRAL

Receive the installed application, SDK, typed tools, browser and complete archive:
  starforge odk-central-receive managed --work-directory PRIVATE_RECEIVING_DIRECTORY \
    --playwright EXISTING_PLAYWRIGHT_MODULE --chromium EXISTING_CHROMIUM

source invokes the original native/receive.mjs with the exact saved specification.
released invokes the original host-bound launcher. It reads that host's private
connection and authorization file, selects its CA before Node starts, creates or
reconciles the released forms, and continues the same source receiver.
Its Node executable is this installed runtime. Supplying the four warehouse
arguments completes the original approved-period receiver and customer handover.

periods invokes the original receive-released-periods.mjs using its saved request,
complete source capture and original commissioning/warehouse IDs.
warehouse invokes the original approved-period receiver, retains every SQL action ID,
receives full period reports, and restores/reopens the same source and warehouse.
managed binds this installed package and exact driver to the original Python-owned
operation; it runs all three application interfaces, native draft/archive actions,
browser downloads and the complete editable archive receiving.

All remaining options, operation identities, journals, workspaces and exit statuses
belong to the original commands. Use the same paths and saved inputs after an
interruption. Use each mode's --help for its complete arguments.
See products/odk-central/OPERATING.md for installation and customer handover.
`;

function managedArguments(args){
  const allowed=new Set(['--work-directory','--playwright','--chromium','--timeout-seconds']);
  const seen=new Set();
  for(let index=0;index<args.length;index+=2){
    const flag=args[index],value=args[index+1];
    if(!allowed.has(flag)||seen.has(flag)||typeof value!=='string'||!value||value.startsWith('--'))
      throw Object.assign(new TypeError('Use each exact managed receiving option once with its value. Use managed --help.'),{
        code:'CENTRAL_PRODUCT_MANAGED_ARGUMENT',
      });
    seen.add(flag);
  }
  for(const flag of ['--work-directory','--playwright','--chromium'])
    if(!seen.has(flag))throw Object.assign(new TypeError('Supply '+flag+'. Use managed --help.'),{
      code:'CENTRAL_PRODUCT_MANAGED_ARGUMENT',
    });
  return args;
}

async function runManaged(args){
  if(args.length===1&&['--help','-h','help'].includes(args[0])){
    process.stdout.write(MANAGED_HELP);
    return 0;
  }
  const forwarded=managedArguments(args);
  const packageFile=fileURLToPath(new URL('../../../package.json',import.meta.url));
  let packageDirectory;
  try{
    packageDirectory=await realpath(dirname(packageFile));
    const pkg=JSON.parse(await readFile(packageFile,'utf8'));
    const declared=pkg.exports?.['./seller/odk/managed-receiving'];
    const target=typeof declared==='string'?declared:declared?.import;
    if(typeof target!=='string'||!target.startsWith('./')||
       await realpath(resolve(packageDirectory,target))!==await realpath(MANAGED_DRIVER))
      throw new Error('The installed managed receiving export does not bind its original driver.');
    await readFile(resolve(packageDirectory,'manifest.json'));
  }catch(cause){
    throw Object.assign(new Error('Run managed receiving through the complete installed odk-central product. The direct Python launcher accepts an explicitly selected installed package.',{cause}),{
      code:'CENTRAL_PRODUCT_MANAGED_PACKAGE',
    });
  }
  const hash=createHash('sha256').update(await readFile(MANAGED_DRIVER)).digest('hex');
  if(hash!==MANAGED_DRIVER_SHA256)throw Object.assign(new Error('The installed managed driver differs from its reviewed complete source.'),{
    code:'CENTRAL_PRODUCT_MANAGED_SOURCE',
  });
  return runOriginalCentralPython(MANAGED_LAUNCHER,[
    '--node',process.execPath,'--package',packageDirectory,
    '--driver',MANAGED_DRIVER,'--driver-sha256',MANAGED_DRIVER_SHA256,...forwarded,
  ]);
}

export async function main(args=process.argv.slice(2)){
  const [mode,...rest]=args;
  if(mode===undefined||['help','--help','-h'].includes(mode)){
    process.stdout.write(HELP);
    return 0;
  }
  if(mode==='source'){
    const {main:receive}=await import(
      '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/receive.mjs');
    await receive(rest);
    return process.exitCode??0;
  }
  if(mode==='released')
    return runOriginalCentralPython(CENTRAL_RELEASED_RECEIVING_ENTRY,
      ['--node',process.execPath,...rest]);
  if(mode==='periods'){
    const {main:receive}=await import(
      '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/receive-released-periods.mjs');
    await receive(rest);
    return process.exitCode??0;
  }
  if(mode==='warehouse'){
    const {main:receive}=await import(
      '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/warehouse/receiving.mjs');
    await receive(rest);
    return process.exitCode??0;
  }
  if(mode==='managed')return runManaged(rest);
  throw Object.assign(new TypeError('Choose source, released, periods, warehouse or managed. Use --help for the original receiving workflow.'),{
    code:'CENTRAL_PRODUCT_RECEIVING_COMMAND',
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    process.stderr.write(JSON.stringify({code:error.code??error.name,message:error.message})+'\n');
    process.exitCode=1;
  });
