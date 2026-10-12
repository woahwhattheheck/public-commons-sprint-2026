// MIT. Complete Europe PMC tools on the original attached Research workspace.
export const RESEARCH_EUROPE_PMC_PREFIX='merchant_research_europe_pmc_';
export const RESEARCH_EUROPE_PMC_EXPORTS=Object.freeze({
  'europe-pmc-edition':{extension:'json'},
  'europe-pmc-ris':{extension:'ris'},
  'europe-pmc-csv':{extension:'csv'},
  'europe-pmc-review':{extension:'json'},
  'europe-pmc-source':{extension:'bin'},
  'europe-pmc-workspace':{extension:'json.gz'},
});
const text={type:'string',minLength:1,maxLength:160};
const native={type:'object',additionalProperties:true};
const workspace={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const bound={workspace,library:{...text,description:'Exact selection.library returned by this attachment’s Europe PMC list operation.'}};
const operation={...bound,operationId:text};
const parameters={...native,description:'Original API query parameters; preserved without projection.'};
const request={...native,description:'Complete original Europe PMC operation input, including its existing request/actor and expected-source fields.'};
export const RESEARCH_EUROPE_PMC_EXPORT_FIELDS={
  library:bound.library,requestId:text,index:{type:'integer',minimum:0},boundary:{type:'boolean'},
};

export function researchEuropePmcTools(tool) {
  const tools=[];
  const add=(name,description,properties,required,readOnly=false,idempotent=false)=>
    tools.push(tool(RESEARCH_EUROPE_PMC_PREFIX+name,description,properties,required,
      {readOnly,idempotent,...(name==='start'?{openWorld:true}:{})}));
  add('list','Discover the original Europe PMC library selection and saved queries on this Research attachment.',
    {workspace,library:bound.library,parameters},['workspace'],true,true);
  add('status','Read current Europe PMC library status with the exact selected library.',
    bound,['workspace','library'],true,true);
  add('history','Read the original saved Europe PMC library history.',
    bound,['workspace','library'],true,true);
  add('query','Read one original saved Europe PMC query.',
    {...bound,queryId:text},['workspace','library','queryId'],true,true);
  add('save_query','Save the complete original query request; retain its request ID for recovery.',
    {...bound,input:request},['workspace','library','input']);
  add('prepare','Prepare one original Europe PMC search operation from its native query and complete limits.',
    {...bound,input:request},['workspace','library','input']);
  add('inspect','Inspect the original Europe PMC operation, source pins and actual acquisition state.',
    operation,['workspace','library','operationId'],true,true);
  add('start','Start the already-prepared original Europe PMC provider operation with its expected plan selection.',
    {...operation,input:request},['workspace','library','operationId','input']);
  add('stop','Request the original operation to stop cooperatively; preserve its captured sources.',
    operation,['workspace','library','operationId']);
  add('seal','Seal the actual original operation with the supplied complete native selection.',
    {...operation,input:request},['workspace','library','operationId','input']);
  add('continue','Create the original source-bound continuation using the same parent operation and native request.',
    {...operation,input:request},['workspace','library','operationId','input']);
  add('chain','Read the original operation’s continuation/source chain.',
    operation,['workspace','library','operationId'],true,true);
  add('records','Read native records and coverage from one original operation, preserving pagination parameters.',
    {...operation,parameters},['workspace','library','operationId'],true,true);
  add('source','Read the exact original raw-source descriptor, including a selected boundary source when requested.',
    {...operation,index:{type:'integer',minimum:0},boundary:{type:'boolean'}},
    ['workspace','library','operationId','index'],true,true);
  add('import','Receive a declared, hash-pinned europe-pmc-packet source through the original document/HTTP intake.',
    {...operation,source:text,input:{type:'object',additionalProperties:false,properties:{
      expectedPlanSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},stopReason:{type:['string','null']},
    },required:['expectedPlanSha256']}},
    ['workspace','library','operationId','source','input']);
  add('review','Record the complete original Europe PMC review and source-bound decisions with its original request ID.',
    {...bound,input:request},['workspace','library','input']);
  add('receive','Receive the selected actual Europe PMC edition into the original Research workflow.',
    {...operation,input:request},['workspace','library','operationId','input']);
  add('comparison','Read the original comparison between explicitly selected Europe PMC editions.',
    {...bound,parameters},['workspace','library','parameters'],true,true);
  add('export_workspace','Prepare the original full Europe PMC workspace export; retain its request ID for download.',
    {...bound,input:request},['workspace','library','input']);
  add('restore','Restore a declared, hash-pinned europe-pmc-portable through the original workspace restore lifecycle.',
    {...bound,source:text,input:{type:'object',additionalProperties:false,
      properties:{requestId:text,actor:text},required:['requestId','actor']}},
    ['workspace','library','source','input']);
  return tools;
}
