import {auditDetailedSnapshots} from '../audit.mjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const {source, target} = JSON.parse(input);
  process.stdout.write(JSON.stringify({ok:true, result:auditDetailedSnapshots(source,target)}));
} catch(error) {
  process.stdout.write(JSON.stringify({ok:false, error:error.name, message:error.message}));
  process.exitCode = 2;
}
