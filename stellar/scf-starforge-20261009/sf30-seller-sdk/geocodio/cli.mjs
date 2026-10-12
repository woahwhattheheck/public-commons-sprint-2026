// MIT. Address intake, original provider review, and native dataset delivery.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openGeocodioOperator,startGeocodioWorkspace,GEOCODIO_ACTIONS} from './server.mjs';
const usage='Address quality workspace\n\n'+
 'node cli.mjs serve --dir /private/address-workspace [--port 0] [--key-env GEOCODIO_API_KEY]\n'+
 'node cli.mjs status --dir /private/address-workspace\n'+
 'node cli.mjs act ACTION --dir /private/address-workspace --payload /private/action.json\n\n'+
 'Actions: '+[...GEOCODIO_ACTIONS].join(', ')+'\n\n'+
 'Keep the original source in intake.import. Provider responses retain their original keyed request. '+
 'provider.prepare records the explicit lookup limit; provider.run uses its original request ID and SHA-256. '+
 'Mutations require expectedRevision from status. The optional API key is read from the selected environment variable and stays outside saved state.\n';
function parse(args){
 const [command,...rest]=args;if(!['serve','status','act'].includes(command))throw new TypeError(usage);
 const action=command==='act'?rest.shift():null,options={};
 if(rest.length%2)throw new TypeError(usage);
 for(let i=0;i<rest.length;i+=2){
  if(!['--dir','--port','--key-env','--payload'].includes(rest[i])||Object.hasOwn(options,rest[i])||rest[i+1]===undefined)
    throw new TypeError(usage);options[rest[i]]=rest[i+1];
 }
 if(!options['--dir'])throw new TypeError(usage);
 if(options['--key-env']&&!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(options['--key-env']))throw new TypeError('Choose an environment variable name.');
 if(command==='act'&&(!GEOCODIO_ACTIONS.has(action)||!options['--payload']))throw new TypeError(usage);
 return {command,action,options};
}
export async function main(args=process.argv.slice(2)){
 if(args.includes('--help')||!args.length){process.stdout.write(usage);return;}
 const {command,action,options}=parse(args),directory=resolve(options['--dir']);
 const apiKey=process.env[options['--key-env']??'GEOCODIO_API_KEY'];
 if(command==='serve'){
  const server=await startGeocodioWorkspace({directory,port:Number(options['--port']??0),apiKey});
  process.stdout.write(JSON.stringify({directory,url:server.url})+'\n');
  const done=async()=>{try{await server.close();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}};
  process.once('SIGINT',done);process.once('SIGTERM',done);return server;
 }
 const workspace=await openGeocodioOperator({directory,apiKey});let retained=false;
 try{
  const value=command==='status'?await workspace.state():
    await workspace.act(action,JSON.parse(await readFile(resolve(options['--payload']),'utf8')));
  process.stdout.write(JSON.stringify(value,null,2)+'\n');
  if(action==='publisher.release.start'){
   retained=true;const done=async()=>{try{await workspace.close();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}};
   process.once('SIGINT',done);process.once('SIGTERM',done);
  }
  return value;
 }finally{if(!retained)await workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(error=>{process.stderr.write((error.code?error.code+': ':'')+error.message+'\n');process.exitCode=1;});
