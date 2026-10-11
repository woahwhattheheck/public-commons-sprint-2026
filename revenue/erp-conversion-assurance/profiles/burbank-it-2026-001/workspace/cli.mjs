#!/usr/bin/env node
// MIT. One original reconciliation service with an additive Burbank project workspace.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startConversionWorkspace} from '../../../scap-workspace/server.mjs';
import {openReconciliationService} from '../../../service/service.mjs';
import {acquireStateLease} from '../../../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {OPERATOR_PROFILE} from './profile.mjs';
import {createBurbankExtension} from './extension.mjs';
import {privateDirectory} from './store.mjs';
import {backupWorkspace,restoreWorkspace} from './backup.mjs';
const HELP=`Burbank ERP delivery workspace — Node.js 22+, Linux flock/tar, Python 3

node workspace/cli.mjs serve --directory PRIVATE_DIRECTORY [--reference SOURCE_DIRECTORY] [--port 8786]
node workspace/cli.mjs backup --directory PRIVATE_DIRECTORY --output BACKUP.burbank --passphrase-env BURBANK_BACKUP_PASSPHRASE
node workspace/cli.mjs restore --directory NEW_PRIVATE_DIRECTORY --input BACKUP.burbank --passphrase-env BURBANK_BACKUP_PASSPHRASE

Prepare the original source reference files before first launch as described in README.md.
--reference selects that source directory for a new workspace; reopening uses its retained copy.
Open the private URL printed by serve. Its access token is generated anew for each host.
Stop the operator and finish active workers before backup; stop other external writers too.
Backup contains the original identity key, pending inputs, reports, reviews, native sources,
attachments and project history. Restore authenticates the complete archive before extraction.
`;
export async function startBurbank({directory,referenceDirectory,port=8786,...limits}) {
  directory=resolve(directory);const service=await openReconciliationService({directory,...limits});
  await privateDirectory(directory+'/burbank');await privateDirectory(directory+'/burbank/host');
  const lease=await acquireStateLease(directory+'/burbank/host');let session;
  try {const extension=await createBurbankExtension({directory,referenceDirectory});session=await startConversionWorkspace({directory,port,profile:OPERATOR_PROFILE,service,extension});
    let closing;return {...session,extension,service,close:()=>closing??=(async()=>{try{await session.close();}finally{await lease.close();}})()};
  }catch(error){await lease.close();throw error;}
}
export async function main(args=process.argv.slice(2)) {
  if(args.includes('--help')){process.stdout.write(HELP);return;}
  const command=args[0]&&!args[0].startsWith('--')?args.shift():'serve',options={};
  const names={'--directory':'directory','--reference':'referenceDirectory','--port':'port','--input':'input','--output':'output','--passphrase-env':'passphraseEnv',
    '--max-input-bytes':'maxInputBytes','--max-report-bytes':'maxReportBytes','--timeout-ms':'timeoutMs','--max-heap-mib':'maxHeapMiB'};
  for(let i=0;i<args.length;i+=2){const key=names[args[i]],value=args[i+1];if(!key||!value||value.startsWith('--')||Object.hasOwn(options,key))throw new Error('Invalid or repeated option: '+args[i]);options[key]=['port','maxInputBytes','maxReportBytes','timeoutMs','maxHeapMiB'].includes(key)?Number(value):value;}
  if(!options.directory)throw new Error('Provide --directory PRIVATE_DIRECTORY.');
  if(command==='serve') {
    const session=await startBurbank(options);const stop=()=>session.close().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});process.once('SIGINT',stop);process.once('SIGTERM',stop);
    process.stdout.write(JSON.stringify({application:'burbank-erp-workspace',workspace:session.url,directory:resolve(options.directory),configuration:session.model.configuration})+'\n');return session;
  }
  if(!options.passphraseEnv||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.passphraseEnv))throw new Error('Name the passphrase environment variable with --passphrase-env.');
  const passphrase=process.env[options.passphraseEnv];
  if(command==='backup'&&options.output)process.stdout.write(JSON.stringify(await backupWorkspace({...options,passphrase}))+'\n');
  else if(command==='restore'&&options.input)process.stdout.write(JSON.stringify(await restoreWorkspace({...options,passphrase}))+'\n');
  else throw new Error('Use serve, backup or restore with the documented options.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
