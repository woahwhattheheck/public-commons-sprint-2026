#!/usr/bin/env node
// MIT. Installed receiving entry over the original Central source and host workflows.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runOriginalCentralPython,CENTRAL_RELEASED_RECEIVING_ENTRY} from './host.mjs';

const HELP=String.raw`ODK Central receiving

Receive an existing authorized Central source:
  starforge odk-central-receive source --request INPUT.json \
    --directory ORIGINAL_WORKSPACE --output RECEIVING \
    --restore-directory REOPENED_WORKSPACE

Receive the released native forms on the already selected Central host:
  starforge odk-central-receive released --host-config PRIVATE_HOST.json \
    --work-directory PRIVATE_RECEIVING_DIRECTORY [--operation ORIGINAL_OPERATION]

source invokes the original native/receive.mjs with the exact saved specification.
released invokes the original host-bound launcher. It reads that host's private
connection and authorization file, selects its CA before Node starts, creates or
reconciles the original released forms, and continues the same source receiver.
Its default Node executable is this installed runtime. All remaining options,
operation identities, journals, workspaces and exit statuses belong to the
original commands. Use the same paths and saved inputs after an interruption.

Use source --help or released --help for the complete original arguments.
See products/odk-central/OPERATING.md for installation and customer handover.
`;

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
  throw Object.assign(new TypeError('Choose source or released. Use --help for the original receiving workflow.'),{
    code:'CENTRAL_PRODUCT_RECEIVING_COMMAND',
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    process.stderr.write(JSON.stringify({code:error.code??error.name,message:error.message})+'\n');
    process.exitCode=1;
  });
