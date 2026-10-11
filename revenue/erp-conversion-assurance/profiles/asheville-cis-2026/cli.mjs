#!/usr/bin/env node
// MIT. Native private operator and complete encrypted continuation commands.
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startConversionWorkspace} from '../../scap-workspace/server.mjs';
import {openReconciliationService} from '../../service/service.mjs';
import {acquireStateLease} from '../../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {PROFILE} from './profile.mjs';
import {createUtilityExtension} from './extension.mjs';
import {backupWorkspace,restoreWorkspace} from './backup.mjs';
import {privateDirectory,need} from './util.mjs';
export async function startAsheville({directory,port=8794,...limits}){need(typeof directory==='string'&&directory,'Select a private workspace directory.');const root=resolve(directory),service=await openReconciliationService({directory:root,...limits});await privateDirectory(join(root,'utility'));await privateDirectory(join(root,'utility','host'));let lease,extension,session;
  try{lease=await acquireStateLease(join(root,'utility','host'));extension=await createUtilityExtension({directory:root});session=await startConversionWorkspace({directory:root,port,profile:PROFILE,service,extension});let closed=false;return {...session,extension,engine:extension.engine,service,close:async()=>{if(!closed){closed=true;try{await session.close();}finally{extension.close();await lease.close();}}}};}catch(error){await session?.close().catch(()=>{});extension?.close();await lease?.close().catch(()=>{});throw error;}}
function options(argv){const out={};for(let i=0;i<argv.length;i++){need(argv[i].startsWith('--')&&i+1<argv.length,'Use named options with values.');out[argv[i].slice(2)]=argv[++i];}return out;}
export async function main(argv=process.argv.slice(2)){const command=argv.shift()??'help',args=options(argv);if(command==='help'){console.log('Asheville utility operator\n  serve --directory /private/workspace [--port 8794]\n  backup --directory /private/workspace --output /private/workspace.utility.enc --passphrase-env UTILITY_BACKUP_PASSPHRASE\n  restore --input /private/workspace.utility.enc --directory /private/restored --passphrase-env UTILITY_BACKUP_PASSPHRASE\nStop the operator before backup. The restore destination must be new. Node 22.16+ with node:sqlite, Python 3, tar and flock are required.');return;}
  if(command==='serve'){const app=await startAsheville({directory:args.directory,port:args.port===undefined?8794:Number(args.port)});console.log(JSON.stringify({application:'asheville-utility-operator',directory:resolve(args.directory),url:app.url}));const stop=async()=>{await app.close();process.exit(0);};process.once('SIGTERM',stop);process.once('SIGINT',stop);return app;}
  need(['backup','restore'].includes(command),'Choose serve, backup or restore.');need(typeof args['passphrase-env']==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(args['passphrase-env']),'Name the environment variable containing the backup passphrase.');const passphrase=process.env[args['passphrase-env']];const result=command==='backup'?await backupWorkspace({directory:args.directory,output:args.output,passphrase}):await restoreWorkspace({input:args.input,directory:args.directory,passphrase});console.log(JSON.stringify(result));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
