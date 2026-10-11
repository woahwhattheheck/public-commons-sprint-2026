import {validateKit, renderLibrary} from '../template-library.mjs';
let source='';for await (const chunk of process.stdin) source+=chunk;
try {
 const request=JSON.parse(source);
 const result=request.operation==='validate' ? validateKit(request.kit) :
  request.operation==='render' ? await renderLibrary(request.options) : (()=>{throw new Error('Unknown compiler operation')})();
 process.stdout.write(JSON.stringify(result));
} catch(error) {process.stderr.write(error.message);process.exitCode=1;}
