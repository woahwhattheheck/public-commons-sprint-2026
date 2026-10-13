#!/usr/bin/env node
/** Native command entry for comparing and incorporating complete returned work. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planReturnedReviews,openReturnedReviewPlan,reviewDecisionTemplate,incorporateReturnedReviews} from './returned_reviews.mjs';
import {InputError} from './parse.mjs';
const HELP=`Measurements returned reviews

  node returned_review_cli.mjs plan --baseline SENT/project.zip --returned RETURN/project.zip --current CURRENT/project.zip --output COMPARISON [--title TITLE]
  node returned_review_cli.mjs inspect --plan COMPARISON
  node returned_review_cli.mjs template --plan COMPARISON --output decisions.json
  node returned_review_cli.mjs apply --plan COMPARISON --decisions decisions.json --output NEW_PROJECT

Open COMPARISON/review.html to inspect original sources and save explicit decisions.
All three inputs are complete native large-file project.zip archives. Application
and native MeasurementWorkspace writers remain the original source. Apply creates
an independently editable, current-derived project and complete native exports.
No live sender, reviewer or current workspace is replaced.
`;
export async function runReturnedReviewCLI(argv=process.argv.slice(2)){
 const [command,...rest]=argv;if(!command||command==='help'||command==='--help'){process.stdout.write(HELP);return;}
 const allowed={plan:['baseline','returned','current','output','title'],inspect:['plan'],template:['plan','output'],apply:['plan','decisions','output']}[command];
 if(!allowed)throw new InputError('Unknown command. Use --help.');
 const options={};for(let i=0;i<rest.length;i+=2){const name=rest[i]?.slice(2);if(!rest[i]?.startsWith('--')||!allowed.includes(name)||options[name]!==undefined||!rest[i+1]||rest[i+1].startsWith('--'))throw new InputError('Unknown, repeated or missing option '+rest[i]);options[name]=rest[i+1];}
 const required=allowed.filter(k=>k!=='title');for(const name of required)if(!options[name])throw new InputError('--'+name+' is required');
 let result;
 if(command==='plan')result=planReturnedReviews(options,options.output,{title:options.title});
 if(command==='inspect')result=openReturnedReviewPlan(options.plan,{verifyInputs:true}).plan;
 if(command==='template'){result=reviewDecisionTemplate(options.plan);fs.writeFileSync(path.resolve(options.output),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return {file:path.resolve(options.output),decisions:result.decisions.length};}
 if(command==='apply')result=await incorporateReturnedReviews(options.plan,JSON.parse(fs.readFileSync(options.decisions,'utf8')),options.output);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await runReturnedReviewCLI();}catch(error){process.stderr.write(JSON.stringify({error:error.message,status:error.status||500})+'\n');process.exitCode=1;}
}
