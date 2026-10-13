// MIT. The original runtime workspace CLI delegates catalogue receiving to its maintained writers.
import { prepareDcatApplicationReceiving, saveDcatApplicationReceiving, dcatApplicationReceivingStatus }
  from './application-dcat-receiving.mjs';
import { need } from './storage.mjs';

export const dcatReceivingCommands = {
  'dcat-receiving-prepare':['--workspace','--operation','--request'],
  'dcat-receiving-status':['--workspace','--operation'],
  'dcat-receiving-save':['--workspace','--operation'],
};
export const dcatReceivingHelp = `
  runtime-workspace dcat-receiving-prepare --workspace DIRECTORY --operation PRIVATE_DIRECTORY [--request COMPLETE_JSON]
  runtime-workspace dcat-receiving-status --workspace DIRECTORY --operation PRIVATE_DIRECTORY
  runtime-workspace dcat-receiving-save --workspace DIRECTORY --operation PRIVATE_DIRECTORY
  The complete request selects a READY semantic runtime (v1) or original transferred source/wheels and recipient Python (v2).
  Resume uses the same retained request, input and final environment directories; preparation performs no new wheel resolution.
`;
export async function runDcatReceivingCommand(model, command, options) {
  need(options['--operation'],'DCAT_RECEIVING_OPERATION_REQUIRED');
  const input={operation:options['--operation']};
  if(command==='dcat-receiving-status') return dcatApplicationReceivingStatus(input);
  if(command==='dcat-receiving-save') return saveDcatApplicationReceiving(model,input);
  need(command==='dcat-receiving-prepare','DCAT_RECEIVING_COMMAND_INVALID');
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try {
    return await prepareDcatApplicationReceiving(model,{...input,
      ...(options['--request']?{request:options['--request']}:{}),signal:controller.signal});
  } finally {process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
