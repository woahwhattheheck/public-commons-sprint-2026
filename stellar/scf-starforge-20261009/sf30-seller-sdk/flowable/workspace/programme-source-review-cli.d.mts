// MIT. Local file invocation; this API never dispatches a native Flowable request.
import type {ProgrammeSourceIssue,ProgrammeSourceReturn,ProgrammeSourceAdoption,ProgrammeSourceDraft,ProgrammeSourceExchange} from './programme-source-review.mjs';
export type ProgrammeSourceReviewCommand='issue'|'return'|'draft'|'branch'|'inspect'|'compare'|'apply'|'compile';
export interface ProgrammeSourceReviewArguments {
 issue:{draft:string;metadata:string;output:string};
 return:{draft:string;exchange:string;metadata:string;output:string};
 draft:{exchange:string;returnId?:string;output:string};
 branch:{exchange:string;output:string;adoptionId?:string;returnId?:string;branch?:'baseline'|'current'|'returned'|'result'};
 inspect:{exchange:string;output:string};
 compare:{draft:string;exchange:string;returned:string;returnId?:string;output:string};
 apply:{draft:string;exchange:string;returned:string;metadata:string;returnId?:string;output:string};
 compile:{draft:string;output:string};
}
export interface ProgrammeSourceReviewFileIdentity {path:string;bytes:number;sha256:string}
export interface ProgrammeSourceReviewCommandReceipt {
 schema:'stellar-forge.flowable-programme-source-review-command.v1';command:ProgrammeSourceReviewCommand;
 inputs:Record<string,ProgrammeSourceReviewFileIdentity>;output:ProgrammeSourceReviewFileIdentity&{reused:boolean};nativeDispatch:false;
 issue?:ProgrammeSourceIssue;returnRecord?:ProgrammeSourceReturn;adoption?:ProgrammeSourceAdoption;
 programme?:{sha256:string;bytes:number;steps:number};
}
export interface ProgrammeSourceAdoptedFile {
 schema:'stellar-forge.flowable-programme-source-adoption.v1';
 draft:ProgrammeSourceDraft;exchange:ProgrammeSourceExchange;adoption:ProgrammeSourceAdoption;incomingText:string;
}
export const PROGRAMME_SOURCE_REVIEW_HELP:string;
export function runProgrammeSourceReviewCommand<C extends ProgrammeSourceReviewCommand>(command:C,args:ProgrammeSourceReviewArguments[C]):Promise<ProgrammeSourceReviewCommandReceipt>;
export function main(argv?:string[]):Promise<number>;
