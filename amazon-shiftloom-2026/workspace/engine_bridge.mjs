import fs from 'node:fs';
import {proposeCoverageIntent, applyProposal, rosterFindings} from '../planner.mjs';
try {
  const input=JSON.parse(fs.readFileSync(0,'utf8'));
  let result;
  if(input.operation==='plan') result=proposeCoverageIntent(input.state,input.intent);
  else if(input.operation==='apply') result=applyProposal(input.state,input.proposal);
  else if(input.operation==='inspect') result=rosterFindings(input.state);
  else throw Error('Unknown original planner operation.');
  process.stdout.write(JSON.stringify({ok:true,result}));
} catch(error) {
  process.stdout.write(JSON.stringify({ok:false,error:String(error.message)}));
  process.exitCode=1;
}

