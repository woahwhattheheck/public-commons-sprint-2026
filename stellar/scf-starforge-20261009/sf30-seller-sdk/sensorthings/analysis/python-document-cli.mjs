// MIT. Select the original prepared Python source action from the existing workspace.
import {isAbsolute} from 'node:path';
import {readOwned,privateDirectory} from '../../stellar-expert/store.mjs';
import {openSensorThingsWorkspace} from '../core.mjs';

async function main(){
  const args=process.argv.slice(2),options={};
  if(args.length===1&&args[0]==='--help'){
    console.log('node analysis/python-document-cli.mjs --workspace ABSOLUTE_DIRECTORY --request ABSOLUTE_JSON');
    return;
  }
  for(let i=0;i<args.length;i+=2){
    if(!['--workspace','--request'].includes(args[i])||!args[i+1]||options[args[i]])
      throw new Error('Supply --workspace and --request exactly once.');
    options[args[i]]=args[i+1];
  }
  if(Object.keys(options).length!==2||!Object.values(options).every(isAbsolute))
    throw new Error('Use the absolute existing workspace and retained request file.');
  await privateDirectory(options['--workspace'],{create:false});
  const request=JSON.parse((await readOwned(options['--request'],1024*1024)).toString('utf8'));
  if(request.action!=='analysis.python.prepare')
    throw new Error('This command selects the original analysis.python.prepare action.');
  const workspace=await openSensorThingsWorkspace({directory:options['--workspace']});
  try{
    const response=await workspace.action(request);
    console.log(JSON.stringify({operationId:response.operationId,reused:response.reused,result:response.result},null,2));
  }finally{await workspace.close();}
}
main().catch(error=>{
  console.error(JSON.stringify({error:error.code??error.name,message:error.message}));
  process.exitCode=1;
});
