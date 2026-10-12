// MIT. Client runbooks use the existing accounting Applications owner.
export function runbooksApplication(common){
  return {id:'runbooks',command:'merchant-accounting-workspace',title:'Client runbooks',terminal:false,
    requiredSource:'stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/runbooks-workspace.mjs',
    description:'Prepare and review client closes with immutable procedures, actual close files, correction rounds, portable handovers and the next client period.',
    fields:[{name:'workspaceDirectory',label:'Original accounting workspace',type:'path',required:true,
      description:'Select the initialized private workspace containing the original client files or accountant handoffs.'},...common]};
}
