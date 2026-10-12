// MIT. Exact private host inputs for the original managed commissioner.
import { normalizeConnection } from './commissioning/agreement.mjs';
import { odkNeed, odkReadPrivateJson } from './connection.mjs';

/** Keep the selected original Authorization alias alive until its owner closes. */
export async function readCentralCommissioningInputs({connection,connectionFile,environmentFile}={}){
  odkNeed(!(connection&&connectionFile),'ODK_COMMISSIONING_CONNECTION',
    'Choose the original connection object or its private host file.');
  odkNeed(!environmentFile||connection||connectionFile,'ODK_COMMISSIONING_CONNECTION',
    'Choose the original connection for this private authorization file.');
  let source=null,selected=connection,assigned=null;
  if(connectionFile){
    source=await odkReadPrivateJson(connectionFile,256*1024);
    selected=source.value.connection??source.value;
  }
  selected=selected?normalizeConnection(selected):null;
  if(environmentFile){
    const environment=await odkReadPrivateJson(environmentFile,64*1024),
      authorization=environment.value[selected.authEnv],previous=process.env[selected.authEnv];
    odkNeed(typeof authorization==='string'&&authorization.length>0&&!/[\r\n]/.test(authorization),
      'ODK_COMMISSIONING_AUTH','The private environment file must contain the complete selected Authorization header.');
    odkNeed(previous===undefined||previous===authorization,'ODK_COMMISSIONING_AUTH_CHANGED',
      'The original authorization alias already identifies another account in this host.');
    if(previous===undefined){process.env[selected.authEnv]=authorization;assigned={name:selected.authEnv,value:authorization};}
  }
  return {connection:selected,source:source?{path:source.path,sha256:source.sha256}:null,
    close(){
      if(assigned&&process.env[assigned.name]===assigned.value)delete process.env[assigned.name];
      assigned=null;
    }};
}
