#!/usr/bin/env node
// MIT. Installed receiving entry over the original Central source and host workflows.
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runOriginalCentralPython,CENTRAL_RELEASED_RECEIVING_ENTRY} from './host.mjs';

const HELP=String.raw`ODK Central receiving

Receive the installed workspace, private tools and three browser views:
  starforge odk-central-receive managed --work-directory PRIVATE_RECEIVING_DIRECTORY \
    --playwright EXISTING_PLAYWRIGHT_MODULE --chromium EXISTING_CHROMIUM

Receive an existing authorized Central source:
  starforge odk-central-receive source --request INPUT.json \
    --directory ORIGINAL_WORKSPACE --output RECEIVING \
    --restore-directory REOPENED_WORKSPACE

Receive the released native forms on the already selected Central host:
  starforge odk-central-receive released --host-config PRIVATE_HOST.json \
    --work-directory PRIVATE_RECEIVING_DIRECTORY [--operation ORIGINAL_OPERATION]
  Add --warehouse-profiles PRIVATE_HOST_PROFILES.json --warehouse-profile PROFILE \
    --warehouse-reviewer NAME --warehouse-note TEXT for the complete customer ZIP.

Continue the two original commissioned periods from an accepted full capture:
  starforge odk-central-receive periods --request ORIGINAL_PERIOD_REQUEST.json \
    --directory ORIGINAL_WORKSPACE --output ORIGINAL_PERIOD_RECEIVING \
    --restore ORIGINAL_COMMISSIONED_REOPEN

Receive all original approved periods and reopen the same PostgreSQL warehouse:
  starforge odk-central-receive warehouse --request ORIGINAL_WAREHOUSE_SELECTION.json \
    --profiles PRIVATE_HOST_PROFILES.json --profile PROFILE --reviewer NAME --note TEXT \
    --output ORIGINAL_WAREHOUSE_RECEIVING --restore-directory REOPENED_CENTRAL

managed invokes the original private Python owner with this installed package,
Node executable and adjacent driver. Supply the existing browser/module paths
and reuse the same receiving directory to continue the original operation.
source invokes the original native/receive.mjs with the exact saved specification.
released invokes the original host-bound launcher. It reads that host's private
connection and authorization file, selects its CA before Node starts, creates or
reconciles the original released forms, and continues the same source receiver.
Its default Node executable is this installed runtime. All remaining options,
operation identities, journals, workspaces and exit statuses belong to the
original commands. Use the same paths and saved inputs after an interruption.

periods invokes the original receive-released-periods.mjs using its saved request,
complete source capture and original commissioning/warehouse IDs.
warehouse invokes the original approved-period receiver, retains every SQL action ID,
receives full period reports, and restores/reopens the same source and warehouse.
Use managed --help, source --help, released --help, periods --help or warehouse --help
for the original arguments.
See products/odk-central/OPERATING.md for installation and customer handover.
`;

export async function main(args=process.argv.slice(2)){
  const [mode,...rest]=args;
  if(mode===undefined||['help','--help','-h'].includes(mode)){
    process.stdout.write(HELP);
    return 0;
  }
  if(mode==='managed'){
    const native=new URL('../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/',import.meta.url);
    const driver=fileURLToPath(new URL('receive-managed.mjs',native));
    const driverSha256=createHash('sha256').update(await readFile(driver)).digest('hex');
    return runOriginalCentralPython(
      fileURLToPath(new URL('run-managed-receiving.py',native)),
      ['--node',process.execPath,
        '--package',fileURLToPath(new URL('../../../',import.meta.url)),
        '--driver',driver,'--driver-sha256',driverSha256,...rest]);
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
  throw Object.assign(new TypeError('Choose managed, source, released, periods or warehouse. Use --help for the original receiving workflow.'),{
    code:'CENTRAL_PRODUCT_RECEIVING_COMMAND',
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    process.stderr.write(JSON.stringify({code:error.code??error.name,message:error.message})+'\n');
    process.exitCode=1;
  });
