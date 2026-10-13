export type Stream = 'open-tenders'|'new-tenders'|'complete-tenders'|'awards'|'supply-arrangements';
export type OriginalRow = Record<string,string>;
export interface Bilingual { en:string; fr:string }
export interface ClosingTime { raw:string; utc:string|null; offset:string; valid:boolean; past:boolean|null; daysRemaining:number|null; error?:string }
export interface OriginalLink { title:string; url:string; field:string; original:string }
export interface SourceMoney { raw:string; cents:number|null; currency:string; rawCurrency:string; currencyBasis:'source'|'official-default-CAD'|'unspecified'; includesTaxes:boolean }
export interface NoticeSummary {
 referenceNumber:string; solicitationNumber:string; title:Bilingual; description:Bilingual; buyer:Bilingual;
 noticeType:Bilingual; status:Bilingual; closing:ClosingTime; publicationDate:string; updatedDate:string; amendmentNumber:string;
 regions:{delivery:Bilingual;opportunity:Bilingual}; categories:string[]; commodityCodes:string[]; unspsc:string[];
 documents:OriginalLink[]; noticeURL:string; noticeURLs:Bilingual; supplier:string; supplierNames:Bilingual;
 instrumentType:Bilingual; amendmentType:Bilingual; contractNumber:string; contractValue:SourceMoney;
 totalContractValue:{raw:string;cents:number|null;cumulative:true};
 contractDates:{awarded:string;start:string;end:string}; stream:Stream;
 arrangement?:{agreementNumber:string;agreementType:Bilingual;startDate:string;expiryDate:string;sourcePublicationDate:string;
 supplier:{legal:string;operating:string;standardized:string};commodity:{raw:string;codes:string[];scheme:'unspecified';description:Bilingual;definitionURL:string};
 delivery:{code:string;description:Bilingual};endUser:Bilingual;dictionaryURL:string};
}
export interface SourceObservation {
 id:string; sourceId:string; stream:Stream; sha256:string; bytes:number; rowCount:number;
 retrievedAt:string; observedAt:string; label:string; url:string; response:Record<string,unknown>|null;
}
export interface SourceFragment { startByte:number;endByte:number;sha256:string }
export interface DerivedSourceField {
 column:string;value:string;status:'observed'|'normalized'|'unknown';fragments:SourceFragment[];note:string;
}
export interface NoticeDerivation {
 schema:'starforge.canadabuys.notice-derivation.v1';method:'manual-field-map';createdAt:string;
 author:string;jurisdiction:string;note:string;
 original:{url:string;retrievedAt:string;mediaType:'text/html';encoding:'base64';bytes:number;sha256:string;bodyBase64:string;response:Record<string,unknown>|null};
 fields:DerivedSourceField[];
}
export interface SourceMetadata {
 id:string; stream:Stream; sha256:string; bytes:number; columns:string[]; rowCount:number; label:string; url:string;
 retrievedAt:string; coverage:'federal'|'single-notice'; bodyKind:'original-utf8-csv'|'derived-notice-utf8-csv'; response:Record<string,unknown>|null;
 derivationSha256?:string;derivation?:NoticeDerivation;
}
export interface OriginalSource extends SourceMetadata { rawText:string; entryIds:string[]; observations:SourceObservation[] }
export interface SourceEdition {
 id:string; sourceId:string; rowNumber:number; row:OriginalRow; summary:NoticeSummary; kind:'tender'|'award'|'arrangement';
 noticeId:string|null; solicitationKey:string; referenceKey:string; importedAt:string; rowSha256:string;
}
export type EditionMetadata=Omit<SourceEdition,'row'>;
export interface Requirement { id:string; requirement:string; status:'unreviewed'|'met'|'gap'|'not-applicable'; source:string; note:string }
export interface Qualification { requirements:Requirement[]; capability:string; eligibility:string; commercial:string; timing:string }
export interface Review {
 revision:number; disposition:'unreviewed'|'reviewing'|'pursue'|'passed'; owner:string; nextAction:string; note:string; shortlisted:boolean;
 qualification:Qualification; updatedAt:string|null; operator:string|null;
}
export type ReviewPatch=Partial<Pick<Review,'disposition'|'owner'|'nextAction'|'note'|'shortlisted'|'qualification'>>&{expectedRevision:number};
export interface WorkshareCost { id:string; title:string; amountCents:number }
export interface WorkshareMilestone extends WorkshareCost { due:string; acceptance:string }
export interface WorkshareFields {
 title:string; status:'draft'|'ready'|'partner-review'|'agreed'|'delivering'|'completed'|'passed'; partner:string; owner:string;
 currency:string; feeCents:number; estimatedHours:number; partnerHours:number; availableFrom:string; deliveryDays:number;
 scope:string; deliverables:string; partnerResponsibilities:string; inputs:string; acceptance:string; note:string;
 milestones:WorkshareMilestone[]; costs:WorkshareCost[];
}
export interface Workshare extends WorkshareFields {
 id:string; noticeId:string; revision:number; createdAt:string; updatedAt:string; operator:string;
 sourceContext:{entryId:string;sourceId:string;rowSha256:string;summary:NoticeSummary};
 totals:{feeCents:number;milestoneCents:number;costCents:number;marginBeforeLaborCents:number;currency:string};
}
export interface WorkshareHistory extends Workshare { history:Workshare[] }
export type WorkshareInput=Partial<WorkshareFields>&{noticeId:string};
export type WorksharePatch=Partial<WorkshareFields>&{expectedRevision:number;noticeId?:string};
export interface NoticeIndex {
 id:string; summary:NoticeSummary; entries:EditionMetadata[]; review:Review; presentInLatestOpenFeed:boolean|null;
}
export interface AwardCandidate extends SourceEdition {
 match:{basis:'exact-solicitation-number';value:string;matchedNoticeEntryIds:string[];buyerMatches:boolean;status:'candidate';sourceEntryId:string};
}
export interface ArrangementCandidate extends SourceEdition {
 match:{status:'candidate';evidence:Array<{basis:string;value?:string;values?:string[];scheme?:'GSIN'|'UNSPSC';sourceScheme?:'unspecified';noticeScheme?:'GSIN'|'UNSPSC';requiresSchemeConfirmation?:boolean;description?:string;matchedNoticeEntryIds?:string[]}>};
}
export interface Notice extends NoticeIndex {
 currentEntry:SourceEdition; history:SourceEdition[]; awards:AwardCandidate[];
 awardGroups:Array<{contractNumber:string;current:AwardCandidate;editions:AwardCandidate[];cumulativeValuesAreNotSummed:true}>;
 supplyArrangements:ArrangementCandidate[]; workshares:Workshare[];
}
export interface Profile { keywords?:string[];excludeKeywords?:string[];categories?:string[];gsin?:string[];unspsc?:string[];openOnly?:boolean;minimumDays?:number }
export interface ProfileMatch { noticeId:string;matches:boolean;evidence:Array<{type:string;value:string;source:string;scheme?:string}>;reasons:string[];evaluatedAt:string }
export declare const GUIDANCE_URL:string;
export declare const DICTIONARY_URL:string;
export declare function value(row:OriginalRow,...names:string[]):string;
export declare function splitCodes(input:string):string[];
export declare function joinKey(input:unknown):string;
export declare function closingTime(raw:string,at?:number|string):ClosingTime;
export declare function summarize(row:OriginalRow,stream:Stream,at?:number):NoticeSummary;
export declare function noticeIdentity(row:OriginalRow):string;
export declare function prepareEntries(parsed:{rows:Array<{rowNumber:number;row:OriginalRow}>},source:SourceMetadata,at?:number):SourceEdition[];
export declare function entryOrder(a:SourceEdition,b:SourceEdition):number;
export declare function matchProfile(notice:NoticeIndex,profile?:Profile,at?:number):ProfileMatch;

export declare const SOSA_COLUMNS:string[];
export declare const SOSA_DICTIONARY_URL:string;
export declare function sourceSupplierNames(summary:NoticeSummary):string[];
export declare function sourceCommodityCodes(summary:NoticeSummary):Array<{scheme:string;code:string}>;
