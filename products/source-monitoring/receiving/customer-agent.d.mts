import type {CustomerSetupRuntime,CustomerSetupPlan,VerifiedCustomerSetup} from '../customer-setup.mjs';
export interface OriginalReviewerSelection {
 schema:'stellar-forge.source-review-receiving.v1';
 operationId:string;workspace:string;
 issue:{cycleId:string;expectedVersion:number;caseIds:string[];reviewer:{id:string;name:string};label:string;
 actor:{id:string;name:string};evidenceIds:string[]};
 returnFile?:string;editionId?:string;adoptionFile?:string;followingCycleCommandsFile?:string;
 [originalField:string]:unknown;
}
export interface BorrowedReviewerOperation {
 issueId:string;issuedJsonPath:string;issuedHtmlPath:string;outputDirectory:string;selection:OriginalReviewerSelection;
}
export interface AgentReceivingResult {
 schema:string;state:string;operationId:string;
 setup?:VerifiedCustomerSetup;ownedClientsClosed?:true;
 original?:Record<string,unknown>;files?:Array<{path:string;bytes:number;sha256:string}>;
 [originalField:string]:unknown;
}
/** Same original operation, actual selected case/cycle inputs, borrowed service and optional already-owned browser. */
export function receiveSourceMonitoringCustomer(options:{
 model:CustomerSetupRuntime;plan:CustomerSetupPlan;pythonCommand:string;output:string;selection:OriginalReviewerSelection;
 operateCopy?:null|((input:BorrowedReviewerOperation)=>Promise<{returnFile:string;[key:string]:unknown}>);
}):Promise<AgentReceivingResult>;
export function main(argv?:string[]):Promise<number>;
