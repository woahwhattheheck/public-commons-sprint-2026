// MIT. Existing workspace command dispatch for its original encrypted recovery.
import {resolve} from 'node:path';
import {accountingRecoveryStatus,inspectAccountingBackup,restoreAccountingWorkspace,snapshotAccountingWorkspace,verifyAccountingBackup} from './recovery.mjs';

export const RECOVERY_COMMANDS=new Set(['backup','inspect-backup','verify-backup','restore','recovery-status']);
export const RECOVERY_HELP=`Merchant accounting operating recovery

Use the existing merchant-accounting-workspace command, or node workspace/server.mjs:

  backup --workspace /private/merchant/accounting-workspace \\
    --state-root /private/merchant --out /private/backups/accounting-2026-10-11 \\
    --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE --quiesced

  inspect-backup --bundle /private/backups/accounting-2026-10-11
  verify-backup --bundle /private/backups/accounting-2026-10-11 \\
    --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE

  restore --workspace /private/merchant/accounting-workspace \\
    --state-root /private/merchant --bundle /private/backups/accounting-2026-10-11 \\
    --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE --quiesced

  recovery-status --workspace /private/merchant/accounting-workspace

Stop the workspace and original input writers before backup or restore.
Set the private passphrase in the named host environment variable; do not pass its value on the command line.
Backup preserves original workspace, outbox, proofs, terms, recovered settlements and saved recovery inputs.
Restore uses the original absolute paths, creates missing files, and reuses only identical existing bytes.
Changed existing files are preserved. Resume an interrupted restore with the SAME backup and paths.
Optional --expected-sha256 pins the encrypted manifest for inspect, verify and restore.
Requires Node22+, Linux flock and the original bundled SF101 recovery engine. No network or signing operation.
`;
export async function recoveryMain(argv,{signal}={}){
  const [command,...rest]=argv;
  if(rest.length===1&&rest[0]==='--help'){process.stdout.write(RECOVERY_HELP);return;}
  const allowed={backup:['--workspace','--state-root','--out','--pass-env','--quiesced'],
    'inspect-backup':['--bundle','--expected-sha256'],'verify-backup':['--bundle','--expected-sha256','--pass-env'],
    restore:['--workspace','--state-root','--bundle','--expected-sha256','--pass-env','--quiesced'],
    'recovery-status':['--workspace']}[command],options={};
  if(!allowed)throw new Error(RECOVERY_HELP);
  for(let i=0;i<rest.length;i++){
    const key=rest[i];if(!allowed.includes(key)||Object.hasOwn(options,key))throw new Error(RECOVERY_HELP);
    if(key==='--quiesced'){options[key]=true;continue;}
    if(!rest[i+1]||rest[i+1].startsWith('--'))throw new Error(RECOVERY_HELP);options[key]=rest[++i];
  }
  const required={backup:['--workspace','--state-root','--out','--quiesced'],restore:['--workspace','--state-root','--bundle','--quiesced'],
    'inspect-backup':['--bundle'],'verify-backup':['--bundle'],'recovery-status':['--workspace']}[command];
  if(required.some(key=>options[key]===undefined))throw new Error(RECOVERY_HELP);
  const args={signal};for(const [key,value] of Object.entries(options)){
    const name={'--workspace':'directory','--state-root':'stateRoot','--out':'output','--bundle':'bundle','--pass-env':'passEnv','--expected-sha256':'expectedSha256','--quiesced':'quiesced'}[key];
    args[name]=['directory','stateRoot','output','bundle'].includes(name)?resolve(value):value;
  }
  const operation={backup:snapshotAccountingWorkspace,'inspect-backup':inspectAccountingBackup,'verify-backup':verifyAccountingBackup,restore:restoreAccountingWorkspace,'recovery-status':accountingRecoveryStatus}[command];
  const result=await operation(args);process.stdout.write(JSON.stringify(result)+'\n');return result;
}
