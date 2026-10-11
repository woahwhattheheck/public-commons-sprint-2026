// MIT. Private fixed helper; no shell, loader settings, wallet keys or unrelated credentials.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkOperatorTerminal } from '../sf81-buyer-operator-bridge/bridge.mjs';
import { requireValue, hash } from './storage.mjs';
let terminalBusy=false;
export async function operatorAction(action,payload,environment=process.env) {
  requireValue(['approve','inspect','finalize'].includes(action),'MPP_OPERATOR_ACTION_INVALID');
  if(action==='approve') {
    requireValue(!terminalBusy,'MPP_OPERATOR_TERMINAL_BUSY',409);
    await checkOperatorTerminal(payload.intent.intentId);
  }
  const env={LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
  for(const name of ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64']) {
    requireValue(typeof environment[name]==='string' && environment[name].length<=4096,'MPP_EXISTING_GOVERNOR_KEYS_REQUIRED');
    env[name]=environment[name];
  }
  const raw=Buffer.from(JSON.stringify({...payload,action,node:process.execPath}));
  requireValue(raw.length<=300000,'MPP_OPERATOR_INPUT_TOO_LARGE');
  if(action==='approve') terminalBusy=true;
  try {
    return await new Promise((resolve,reject)=>{
      let output='',tooLarge=false;
      const child=spawn(payload.operator.python,['-I','-B','-u',fileURLToPath(new URL('./operator.py',import.meta.url))],
        {shell:false,env,stdio:['pipe','pipe','ignore']});
      const timer=setTimeout(()=>child.kill('SIGKILL'),action==='finalize'?450000:300000);
      child.stdout.on('data',chunk=>{
        output+=chunk.toString('utf8');
        if(Buffer.byteLength(output)>4*1024*1024) {tooLarge=true;child.kill('SIGKILL');}
      });
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',code=>{
        clearTimeout(timer);
        try {
          requireValue(!tooLarge,'MPP_OPERATOR_RESULT_TOO_LARGE');
          const result=JSON.parse(output);
          requireValue(code===0 && !result.error,result.error??'MPP_OPERATOR_EXECUTION_FAILED');
          requireValue(result.input_sha256===hash(raw),'MPP_OPERATOR_INPUT_IDENTITY_MISMATCH');
          resolve(result);
        } catch(error) {reject(error);}
      });
      child.stdin.on('error',()=>{});
      child.stdin.end(raw);
    });
  } finally {if(action==='approve') terminalBusy=false;}
}
