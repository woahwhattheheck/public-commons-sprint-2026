// MIT. Native directory input types follow its installed source-owned JSON catalogues.
import type * as Returned from '../directory_operating_return.mjs';
import type * as Operating from '../directory_operating_plan.mjs';
import type {CommandCatalog} from '../../../distribution/discovery/catalog.mjs';
import type * as Gravity from '../../fhir_referral/connected/client.mjs';
export type Json=Gravity.Json;export type JsonObject=Gravity.JsonObject;
export type UUID=Gravity.UUID;export type SHA256=Gravity.SHA256;
export type WorkspaceAlias=Gravity.WorkspaceAlias;export type OperationId=string;
export type ClientOptions=Gravity.ClientOptions;export type LocalClientOptions=Gravity.LocalClientOptions;
export type RequestOptions=Gravity.RequestOptions;export type FileIdentity=Gravity.FileIdentity;
export type DirectoryRecordRef={sourceId:SHA256;recordId:SHA256};
export interface HumanServicesDirectoryConfiguration{
 schema:'stellar-forge.human-services-directory-merchant-connection.v1';
 workspaces:Record<WorkspaceAlias,{directory:string;label?:string;allowStart?:boolean;credentialsFile?:string;
 inputs?:Record<string,{file:string;sha256?:SHA256;label?:string}>}>;
}
export type ExportKind=Gravity.ExportKind|'directory-source-file'|'directory-guidance-file'|
 'directory-export-file'|'directory-handoff-packet'|'directory-conformance-file';
export interface ExportManifest extends Omit<Gravity.ExportManifest,'schema'|'kind'>{
 schema:'stellar-forge.human-services-directory-merchant-export.v1';kind:ExportKind;
}
export interface RetainedResult<T=Json> extends Omit<Gravity.RetainedResult<T>,'schema'|'kind'|'manifestFile'>{
 schema:'stellar-forge.human-services-directory-merchant-result.v1';kind:ExportKind;
 manifestFile:{name:'human-services-directory-manifest.json';bytes:number;sha256:SHA256};
}
export interface FileManifest extends Omit<Gravity.FileManifest,'manifest'|'manifestFile'>{
 manifest:ExportManifest;manifestFile:{name:'human-services-directory-manifest.json';bytes:number;sha256:SHA256};
}
export type DirectorySourceConnectionInput={"label":string;"protocol":"hsds"|"fhir-hsd";"baseUrl":string;"authProfile"?:string|null;"publisher"?:string;"sourceUrl"?:string;"note"?:string};
export type DirectorySourceImportInput={"label":string;"format":"hsds-json"|"hsds-csv"|"hsds-csv-zip"|"fhir-json"|"fhir-json-zip"|"directory-capture";"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"layout"?:"entity"|"array"|"page"|"tables";"members"?:Array<{"name":string;"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"layout"?:"entity"|"array"|"page"|"tables";"encoding"?:"utf-8"|"utf-8-sig"|"cp1252";"delimiter"?:string}>;"encoding"?:"utf-8"|"utf-8-sig"|"cp1252";"delimiter"?:string;"referenceBase"?:string|null;"sourceUrl"?:string;"publisher"?:string;"origin":"published_reference"|"operator_source"|"authored_example";"scope"?:"snapshot"|"subset"|"incremental"|"unknown";"note"?:string;"filename"?:string};
export type DirectorySourceRequestInput={"label":string;"connectionId":string;"discoveryId"?:string|null;"route":"discovery"|"hsds-list"|"hsds-read"|"fhir-search"|"fhir-read"|"document";"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"resourceType"?:"Organization"|"Location"|"HealthcareService"|"Endpoint";"nativeIds"?:Array<string>;"parameters"?:Array<{"name":string;"value":string}>;"url"?:string|null;"document"?:{"format":"hsds-json"|"hsds-csv"|"fhir-json";"table"?:"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"layout"?:"entity"|"array"|"page"|"tables";"encoding"?:"utf-8"|"utf-8-sig"|"cp1252";"delimiter"?:string};"pagination"?:{"startPage":number;"perPage":number;"termination":"declared"|"empty-page"};"scope"?:"snapshot"|"subset"|"incremental"|"unknown";"origin":"published_reference"|"operator_source"|"authored_example";"note"?:string;"limits"?:{"maxBytes"?:number;"maxRecords"?:number;"maxPages"?:number}};
export type DirectorySourceEditionInput={"label":string;"sourceIds":Array<string>;"predecessorId"?:string|null;"tables"?:Array<string>;"scope"?:"snapshot"|"subset"|"incremental"|"unknown";"actor":string;"note"?:string};
export type DirectorySourceComparisonInput={"label":string;"beforeEditionId":string;"afterEditionId":string;"reviewedLinks"?:Array<{"before":{"sourceId":string;"recordId":string};"after":{"sourceId":string;"recordId":string};"reason":string}>;"actor":string;"note"?:string};
export type DirectorySourceAcquireInput={"requestId":string;"operationId":string};
export type DirectorySourceDiscoverInput={"connectionId":string;"operationId":string};
export type DirectorySourceOperationInput={"operationId":string};
export type DirectorySourcePageInput={"offset"?:number;"limit"?:number;"table"?:string;"query"?:string};
export type DirectorySourceChangesInput={"offset"?:number;"limit"?:number;"state"?:"unchanged"|"changed"|"only-before"|"only-after"|"ambiguous"|"unidentified"};
export type DirectoryMappingInput={"label":string;"actor":string;"note"?:string;"editionId":string;"predecessorId"?:string|null;"mode":"hsds-to-fhir"|"fhir-pass-through";"identitySystem":string;"referenceBase":string;"selectedRefs"?:Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"identityOverrides"?:Array<{"ref":{"sourceId":string;"recordId":string;"rowSha256"?:string};"logicalId":string;"reason":string}>;"rules":Array<{"id":string;"table":"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"targetType":"Organization"|"Location"|"HealthcareService"|"Endpoint";"sourcePath"?:string;"targetPath":string;"operation":"copy"|"constant"|"map"|"reference";"value"?:Json;"valueMap"?:Record<string,Json>;"join"?:{"table":"organization"|"program"|"service"|"attribute"|"service_at_location"|"location"|"phone"|"contact"|"address"|"schedule"|"funding"|"service_area"|"required_document"|"language"|"accessibility"|"taxonomy_term"|"metadata"|"meta_table_description"|"cost_option"|"organization_identifier"|"taxonomy"|"service_capacity"|"unit"|"url";"foreignPath":string;"localPath":string};"includeRefs"?:Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"template"?:Json;"cardinality"?:"one"|"many";"referenceType"?:"Organization"|"Location"|"HealthcareService"|"Endpoint";"missing"?:"omit"|"finding"|"error";"reason":string;"reviewIds"?:Array<string>;"valueType"?:"original"|"string"|"number"|"integer"|"boolean"}>;"reviews"?:Array<{"id":string;"disposition":"accepted"|"adapted"|"excluded"|"unresolved";"reason":string}>};
export type DirectoryMappingPreviewInput={"mappingId":string};
export type DirectoryMappingApplyInput={"label":string;"actor":string;"note"?:string;"previewId":string};
export type DirectorySelectionInput={"label":string;"actor":string;"note"?:string;"editionId":string;"conversionId"?:string|null;"predecessorId"?:string|null;"serviceRefs":Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"chosenRefs":Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"criteria":{"at"?:string;"timezone"?:string;"allowedStatuses"?:Array<string>;"locationRefs"?:Array<{"sourceId":string;"recordId":string;"rowSha256"?:string}>;"languages"?:Array<string>;"taxonomyTerms"?:Array<string>;"capacity"?:{"unit":string;"minimum":number;"asOf":string;"maximumAgeHours":number};"requireContact"?:boolean;"scope"?:string;"scheduleDecisions"?:Array<{"ref":{"sourceId":string;"recordId":string;"rowSha256"?:string};"use":"operating-hours"|"event"|"exclude";"reason":string}>};"dispositions":Array<{"ref":{"sourceId":string;"recordId":string;"rowSha256"?:string};"decision":"selected"|"reserve"|"excluded"|"needs-contact";"reason":string;"owner"?:string}>};
export type DirectoryReferralJoinInput={"label":string;"actor":string;"note"?:string;"selectionId":string;"conversionId":string;"referralEditionId":string;"configurationId"?:string|null;"taskBindings":Array<{"taskId":string;"serviceRef":{"sourceId":string;"recordId":string;"rowSha256"?:string};"destinationField":"Task.owner"|"ServiceRequest.performer"|"link-only";"serviceRequestId"?:string;"recipientType":"HealthcareService"|"Organization";"reason":string}>};
export type DirectoryHandoffInput={"label":string;"actor":string;"note"?:string;"selectionId":string;"conversionId":string;"referralJoinId"?:string|null;"owner":string;"recipient":string;"scope":string;"sourceRefs"?:Array<{"url"?:string;"sourceId"?:string;"recordId"?:string;"note"?:string}>};
export type DirectoryReceivingInput={"label":string;"actor":string;"note"?:string;"handoffId"?:string|null;"archiveSha256":string;"disposition":"received"|"adopted"|"needs-follow-up";"findings"?:string;"owner":string};
export type DirectoryExportInput={"label":string;"actor":string;"note"?:string;"kind":"workspace"|"handoff"|"source"|"mapping-preview"|"selection"|"referral-join"|"guidance";"recordId"?:string|null};
export type DirectoryPageInput={"offset"?:number;"limit"?:number;"query"?:string};
export type DirectoryConformancePlanInput={"label":string;"actor":string;"subjectKind":"sources"|"editions";"subjectId":SHA256;"family":"hsds-3.3.1"|"fhir-hsd-1.0.0";"tables"?:Array<string>;"profileDisposition":"selected-standard"|"migration-assessment";"publisherProfile"?:string;"scope":string;"formatPolicy"?:"annotation"|"assert";"definitionRefs"?:Array<{"sourceId":SHA256;"recordId":SHA256}>;"note"?:string};
export type DirectoryConformanceAssessInput={"label":string;"actor":string;"planId":SHA256;"note"?:string};
export type DirectoryConformanceReviewInput={"label":string;"actor":string;"assessmentId":SHA256;"disposition":"accept-for-receiving"|"needs-correction"|"defer";"declaration":string;"decisions"?:Array<{"findingId":SHA256;"disposition":"accepted-deviation"|"requires-correction"|"not-applicable";"reason":string}>;"predecessorId"?:null|SHA256;"note"?:string;"groups"?:Array<{"code":string;"severity"?:"error"|"warning"|"not-evaluated";"table"?:string;"disposition":"accepted-deviation"|"requires-correction"|"not-applicable";"reason":string}>};
export type DirectoryConformanceCompareInput={"label":string;"actor":string;"beforeAssessmentId":SHA256;"afterAssessmentId":SHA256;"scopeNote":string;"note"?:string};
export type DirectoryConformanceCollection='conformancePlans'|'conformanceAssessments'|'conformanceReviews'|'conformanceComparisons';
export type DirectoryConformanceFileCollection='assessments'|'reviews'|'comparisons';
export type DirectoryConformanceOriginalFileKind='report'|'findings'|'rows'|'index'|'rules'|'summary'|'package';
export type DirectoryForeignKeyFileKind='foreignKeys'|'foreignKeyCandidates'|'foreignKeyMatches'|'foreignKeyCoverage';
export type DirectoryConformanceFileKind=DirectoryConformanceOriginalFileKind|DirectoryForeignKeyFileKind;
export type DirectoryConformanceSeverity='error'|'warning'|'not-evaluated';
export type DirectoryConformanceOutcome='pass'|'annotation'|'error'|'warning'|'not-evaluated';
export type DirectoryConformanceCounts=Record<DirectoryConformanceOutcome,number>;
export interface DirectoryConformanceFinding{
 id:SHA256;schema:'stellar-forge.directory-conformance-finding.v1';code:string;severity:DirectoryConformanceSeverity;
 table:string|null;ref:DirectoryRecordRef|null;pointer:string;originalPointer:string;message:string;
 requirementSource:Json;actual:Json;related?:Json;
}
export interface DirectoryConformanceRow{
 sourceId:SHA256;recordId:SHA256;ref:DirectoryRecordRef;table:string;checks:DirectoryConformanceCounts;findings:number;
 nativeId?:string|null;rowOrdinal?:number;rowSha256?:SHA256;resourceSha256?:SHA256;
 memberName?:string;memberSha256?:SHA256;pointer?:string;parentRecordId?:SHA256|null;
 rawRange?:Json;representation?:string;fullUrl?:string|null;
}
export interface DirectoryConformancePage<T>{
 assessmentId:SHA256;rows:T[];total:number;offset:number;limit:number;nextOffset:number|null;bytes:number;byteBudget:number;
}
export type DirectoryForeignKeyState='resolved'|'ambiguous'|'missing-target'|'null-reference'|'invalid-key'|
 'target-table-unavailable'|'representation-not-tabular'|'unsupported-declaration'|'nonmatching-value';
export type DirectoryForeignKeyCandidateState='value'|'null'|'invalid'|'nonmatching'|'representation-not-tabular';
export interface DirectoryForeignKeyRef extends DirectoryRecordRef{
 nativeRef:Json;table?:string;rowOrdinal?:number;rowSha256?:SHA256;resourceSha256?:SHA256;
 memberName?:string;memberSha256?:SHA256;pointer?:string;rawRange?:Json;representation?:string;
 parentRecordId?:SHA256|null;nativeId?:string|null;
}
export interface DirectoryForeignKeyComponent{
 field:string;pointer:string;originalPointer:string;fieldDeclaration:Json;physical:Json;state:string;
 headerPositions?:number[];logicalNull?:boolean;matchedMarker?:Json;logical?:Json;reason?:string;
}
export interface DirectoryForeignKeyTargetCoverage{
 targetTable:string;groupId:SHA256;presentSelectedDocuments:number;establishedTabularCoverage:boolean;
 candidateStates:Partial<Record<DirectoryForeignKeyCandidateState,number>>;scope:string;
}
export interface DirectoryForeignKeyOutcome{
 id:SHA256;schema:'stellar-forge.directory-conformance-foreign-keys.v1';kind:'outcome';
 declarationId:SHA256;table:string;ref:DirectoryForeignKeyRef;source:Json;requirement:Json;
 representation:string;state:DirectoryForeignKeyState;constraintOutcome:'pass'|'error'|'not-evaluated';
 resolutionOutcome:DirectoryForeignKeyState;components:DirectoryForeignKeyComponent[];
 keyJson:string|null;keySha256:SHA256|null;candidateCount:number;candidateGroupId:SHA256|null;
 targetCoverage:DirectoryForeignKeyTargetCoverage|null;targetMatches:string;nullPolicy:string|null;
}
export interface DirectoryForeignKeyCandidate{
 id:SHA256;schema:'stellar-forge.directory-conformance-foreign-keys.v1';kind:'candidate';
 groupId:SHA256;table:string;ref:DirectoryForeignKeyRef;representation:string;
 state:DirectoryForeignKeyCandidateState;components:DirectoryForeignKeyComponent[];
 keyJson:string|null;keySha256:SHA256|null;reason?:string;
}
export interface DirectoryForeignKeyMatch{
 id:SHA256;schema:'stellar-forge.directory-conformance-foreign-keys.v1';kind:'match';
 outcomeId:SHA256;candidateId:SHA256;declarationId:SHA256;sourceRef:DirectoryForeignKeyRef;
 targetRef:DirectoryForeignKeyRef;keySha256:SHA256;groupId:SHA256;
}
export interface DirectoryForeignKeySummary{
 implementationEdition:string;declaredForeignKeys:number;selectedDeclarations:number;
 declaredCompositeKeys:number;selectedCompositeKeys:number;
 outcomeRows:number;candidateRows:number;matchRows:number;states:Record<DirectoryForeignKeyState,number>;
}
export interface DirectoryForeignKeyCoverage extends DirectoryForeignKeySummary{
 schema:'stellar-forge.directory-conformance-foreign-keys.v1';policy:JsonObject;originalStandard:Json;
 originalDatapackageVersion:Json;subjectKind:'sources'|'editions';subjectId:SHA256;
 selectedChildTables:string[];selectedSources:Json[];contextOriginalRows:number;
 declarations:Json[];targetGroups:Json[];tableDomains:Json[];limits:JsonObject;meaning:string;
}
export type DirectoryForeignKeyFilters={table?:string;state?:string;ruleId?:SHA256;sourceId?:SHA256;recordId?:SHA256};
export type DirectoryForeignKeyCandidateFilters={table?:string;state?:string;groupId?:SHA256;sourceId?:SHA256;recordId?:SHA256};
export type DirectoryForeignKeyMatchFilters={outcomeId?:SHA256;candidateId?:SHA256};
export type DirectoryForeignKeyPage<T>=DirectoryConformancePage<T>&{byteBudget:4194304};
export interface DirectoryConformanceSummary{
 schema:'stellar-forge.directory-conformance.v1';planId:SHA256;requestSha256:SHA256;
 selectedRows:number;originalRows:number;populations:Record<string,number>;findings:number;
 severityCounts:Record<DirectoryConformanceSeverity,number>;
 checks:Array<{code:string}&DirectoryConformanceCounts>;
 tableChecks:Array<{table:string;code:string}&DirectoryConformanceCounts>;
 ruleCoverage:Record<string,number>;rules:number;formatPolicy:'annotation'|'assert';meaning:string;
 foreignKeys?:DirectoryForeignKeySummary;
}
export type DirectoryConformancePlan=DirectoryConformancePlanInput&{
 id:SHA256;schema:'stellar-forge.directory-conformance.v1';population:Record<string,number>;
 sourceRefs:Json[];subjectIndex:FileIdentity;definitions:Json[];engine:JsonObject;createdAt?:string;
};
export type DirectoryConformanceAssessment=DirectoryConformanceAssessInput&{
 id:SHA256;schema:'stellar-forge.directory-conformance.v1';requestSha256:SHA256;subjectKind:'sources'|'editions';
 subjectId:SHA256;family:'hsds-3.3.1'|'fhir-hsd-1.0.0';engine:JsonObject;summary:DirectoryConformanceSummary;
 files:Record<DirectoryConformanceOriginalFileKind,FileIdentity>&Partial<Record<DirectoryForeignKeyFileKind,FileIdentity>>;createdAt?:string;
};
export type DirectoryConformanceReview=DirectoryConformanceReviewInput&{
 id:SHA256;schema:'stellar-forge.directory-conformance.v1';requestSha256:SHA256;planId:SHA256;
 subjectKind:'sources'|'editions';subjectId:SHA256;summary:JsonObject;
 files:Record<'findings'|'summary'|'report'|'package',FileIdentity>;createdAt?:string;
};
export type DirectoryConformanceComparison=DirectoryConformanceCompareInput&{
 id:SHA256;schema:'stellar-forge.directory-conformance.v1';requestSha256:SHA256;summary:JsonObject;
 files:Record<'rows'|'summary'|'report'|'package',FileIdentity>;createdAt?:string;
};
export type DirectoryConformanceFindingFilters={
 severity?:DirectoryConformanceSeverity;table?:string;code?:string;sourceId?:SHA256;recordId?:SHA256;
};
export interface DirectoryConformanceArguments{
 directory_conformance_plan:{workspace:WorkspaceAlias;conformance_plan:DirectoryConformancePlanInput};
 directory_conformance_assess:{workspace:WorkspaceAlias;conformance_assess:DirectoryConformanceAssessInput};
 directory_conformance_review:{workspace:WorkspaceAlias;conformance_review:DirectoryConformanceReviewInput};
 directory_conformance_compare:{workspace:WorkspaceAlias;conformance_compare:DirectoryConformanceCompareInput};
 directory_conformance_findings:{workspace:WorkspaceAlias;assessmentId:SHA256}&DirectoryConformanceFindingFilters&Pick<DirectoryPageInput,'offset'|'limit'>;
 directory_conformance_finding:{workspace:WorkspaceAlias;assessmentId:SHA256;findingId:SHA256};
 directory_conformance_rows:{workspace:WorkspaceAlias;assessmentId:SHA256;table?:string}&Pick<DirectoryPageInput,'offset'|'limit'>;
 directory_conformance_foreign_keys:{workspace:WorkspaceAlias;assessmentId:SHA256}&DirectoryForeignKeyFilters&Pick<DirectoryPageInput,'offset'|'limit'>;
 directory_conformance_foreign_key_candidates:{workspace:WorkspaceAlias;assessmentId:SHA256}&DirectoryForeignKeyCandidateFilters&Pick<DirectoryPageInput,'offset'|'limit'>;
 directory_conformance_foreign_key_matches:{workspace:WorkspaceAlias;assessmentId:SHA256}&DirectoryForeignKeyMatchFilters&Pick<DirectoryPageInput,'offset'|'limit'>;
 directory_conformance_file:{workspace:WorkspaceAlias;collection:DirectoryConformanceFileCollection;recordId:SHA256;fileKind:DirectoryConformanceFileKind};
}
export interface DirectoryConformanceResultValues{
 directory_conformance_plan:DirectoryConformancePlan;directory_conformance_assess:DirectoryConformanceAssessment;
 directory_conformance_review:DirectoryConformanceReview;directory_conformance_compare:DirectoryConformanceComparison;
 directory_conformance_findings:DirectoryConformancePage<DirectoryConformanceFinding>;
 directory_conformance_finding:DirectoryConformanceFinding;
 directory_conformance_rows:DirectoryConformancePage<DirectoryConformanceRow>;
 directory_conformance_foreign_keys:DirectoryForeignKeyPage<DirectoryForeignKeyOutcome>;
 directory_conformance_foreign_key_candidates:DirectoryForeignKeyPage<DirectoryForeignKeyCandidate>;
 directory_conformance_foreign_key_matches:DirectoryForeignKeyPage<DirectoryForeignKeyMatch>;
 directory_conformance_file:Json;
}

export type DirectoryOperatingPlanCreateInput=Operating.DirectoryOperatingPlanCreateInput;
export type DirectoryOperatingPlanSaveInput=Operating.DirectoryOperatingPlanSaveInput;
export type DirectoryOperatingPlanReceiveInput=Operating.DirectoryOperatingPlanReceiveInput;
export type DirectoryOperatingPlanCopyInput=Operating.DirectoryOperatingPlanCopyInput;
export type DirectoryOperatingPlanCompareInput=Operating.DirectoryOperatingPlanCompareInput;
export type DirectoryOperatingPlanExportInput=Operating.DirectoryOperatingPlanExportInput;
export type DirectoryOperatingPlanStepInput=Operating.DirectoryOperatingPlanStepInput;

/** Complete source-native correction input. JSON values remain lexical strings; CSV positions are physical. */
export type DirectoryCorrectionCollection='correctionPlans'|'correctionPreviews'|'corrections';
export interface DirectoryCorrectionEditBasis extends DirectoryRecordRef{
 rowSha256:SHA256;resourceSha256:SHA256;memberSha256:SHA256;reason:string;
}
export type DirectoryCorrectionEdit=DirectoryCorrectionEditBasis&(
 {action:'json-set';pointer:string;valueJson:string}|
 {action:'json-remove';pointer:string}|
 {action:'csv-cell';column:number;value:string}|
 {action:'csv-row';cells:string[]}
);
export interface DirectoryCorrectionPrepareInput{
 label:string;editionId:SHA256;actor:string;note?:string;predecessorId?:SHA256|null;edits:DirectoryCorrectionEdit[];
}
export interface DirectoryCorrectionPreviewInput{planId:SHA256}
export interface DirectoryCorrectionApplyInput{previewId:SHA256;expectedEditionId:SHA256;actor:string;note?:string}
export interface DirectoryCorrectionExportInput{correctionId:SHA256;actor:string;label?:string;note?:string}
export interface DirectoryCorrectionFile{sha256:SHA256;bytes:number;role:string}
export interface DirectoryCorrectedSource{
 sourceId:SHA256;derivedSourceId:SHA256;originalFile:DirectoryCorrectionFile;
 derivedFile:DirectoryCorrectionFile;indexFile:DirectoryCorrectionFile;
 changedMembers:Array<{name:string;originalFile:DirectoryCorrectionFile;derivedFile:DirectoryCorrectionFile;
 ranges:Array<{start:number;end:number;originalSha256:SHA256}>}>;
}
export interface DirectoryCorrectionPlan extends DirectoryCorrectionPrepareInput{
 schema:'stellar-forge.directory-correction-plan.v1';id:SHA256;createdAt:string;
 predecessorId:SHA256|null;note:string;targets:Json;
 files:{input:DirectoryCorrectionFile};summary:{edits:number;rows:number;sources:number};
}
export interface DirectoryCorrectionPreview{
 schema:'stellar-forge.directory-correction-preview.v1';id:SHA256;createdAt:string;
 planId:SHA256;editionId:SHA256;candidateEditionId:SHA256;comparisonId:SHA256;
 sources:DirectoryCorrectedSource[];files:{changes:DirectoryCorrectionFile;review:DirectoryCorrectionFile};summary:JsonObject;
}
export interface DirectoryCorrectionAccepted{
 schema:'stellar-forge.directory-correction.v1';id:SHA256;createdAt:string;stage:'accepted';
 planId:SHA256;previewId:SHA256;editionId:SHA256;beforeEditionId:SHA256;
 expectedEditionId:SHA256;comparisonId:SHA256;sources:DirectoryCorrectedSource[];
 actor:string;note:string;files:{changes:DirectoryCorrectionFile;review:DirectoryCorrectionFile};summary:JsonObject;
}
export type DirectoryCorrectionRecord=DirectoryCorrectionPlan|DirectoryCorrectionPreview|DirectoryCorrectionAccepted;
export interface DirectoryCorrectionChange{
 ordinal:number;edit:DirectoryCorrectionEdit;originalRow:JsonObject;memberName:string;rootRecordId:SHA256;
 before:{present:boolean;valueJson?:string};after:{present:boolean;valueJson?:string};
 [key:string]:unknown;
}
export interface DirectoryCorrectionPage{
 kind:DirectoryCorrectionCollection;recordId:SHA256;rows:Array<DirectoryCorrectionChange|{ordinal:number;edit:DirectoryCorrectionEdit}>;
 total:number;offset:number;limit:number;nextOffset:number|null;bytes:number;byteBudget:4194304;
}
export interface DirectoryCorrectionExport{
 id:SHA256;kind:'correction';recordId:SHA256;name:string;contentType:string;
 file:DirectoryCorrectionFile;actor:string;label:string;createdAt:string;[key:string]:unknown;
}
export interface DirectoryCorrectionArguments{
 directory_correction_prepare:{workspace:WorkspaceAlias;correction_prepare:DirectoryCorrectionPrepareInput};
 directory_correction_preview:{workspace:WorkspaceAlias;correction_preview:DirectoryCorrectionPreviewInput};
 directory_correction_apply:{workspace:WorkspaceAlias;correction_apply:DirectoryCorrectionApplyInput};
 directory_correction_export:{workspace:WorkspaceAlias;correction_export:DirectoryCorrectionExportInput};
 directory_correction_rows:{workspace:WorkspaceAlias;collection:DirectoryCorrectionCollection;recordId:SHA256;offset?:number;limit?:number};
 directory_correction_file:{workspace:WorkspaceAlias;collection:DirectoryCorrectionCollection;recordId:SHA256;fileKind:'input'|'changes'|'review'};
}
export interface DirectoryCorrectionResultValues{
 directory_correction_prepare:DirectoryCorrectionPlan;directory_correction_preview:DirectoryCorrectionPreview;
 directory_correction_apply:DirectoryCorrectionAccepted;directory_correction_export:DirectoryCorrectionExport;
 directory_correction_rows:DirectoryCorrectionPage;
}

export interface DirectoryOperatingReturnArguments {
 directory_operating_return_prepare:{workspace:WorkspaceAlias;operating_return_prepare:Returned.DirectoryOperatingReturnPrepareInput};
 directory_operating_return_revise:{workspace:WorkspaceAlias;operating_return_revise:Returned.DirectoryOperatingReturnReviseInput};
 directory_operating_return_complete:{workspace:WorkspaceAlias;operating_return_complete:Returned.DirectoryOperatingReturnCompleteInput};
 directory_operating_return_apply:{workspace:WorkspaceAlias;operating_return_apply:Returned.DirectoryOperatingReturnApplyInput};
 directory_operating_return_receive:{workspace:WorkspaceAlias;operating_return_receive:Returned.DirectoryOperatingReturnReceiveInput};
 directory_operating_return_export:{workspace:WorkspaceAlias;operating_return_export:Returned.DirectoryOperatingReturnExportInput};
 directory_operating_return_review:{workspace:WorkspaceAlias;recordId:SHA256};
 directory_operating_return_comparison:{workspace:WorkspaceAlias;recordId:SHA256};
 directory_operating_return_input:{workspace:WorkspaceAlias;recordId:SHA256};
 directory_operating_return_rows:{workspace:WorkspaceAlias;recordId:SHA256;offset?:number;limit?:number}&Returned.DirectoryOperatingReturnFilters;
 directory_operating_return_file:{workspace:WorkspaceAlias;recordId:SHA256;fileKind:'review'|'comparison'|'input'};
}
export interface DirectoryOperatingReturnResultValues {
 directory_operating_return_prepare:Returned.DirectoryOperatingReturnSaved;
 directory_operating_return_revise:Returned.DirectoryOperatingReturnSaved;
 directory_operating_return_complete:Returned.DirectoryOperatingReturnSaved;
 directory_operating_return_apply:Returned.DirectoryOperatingReturnApplied;
 directory_operating_return_receive:Returned.DirectoryOperatingReturnSaved;
 directory_operating_return_export:Returned.DirectoryOperatingReturnExport;
 directory_operating_return_review:Returned.OperatingPlanReturn;
 directory_operating_return_comparison:Returned.OperatingReturnComparison;
 directory_operating_return_input:Returned.DirectoryOperatingReturnAcceptedInput;
 directory_operating_return_rows:Returned.DirectoryOperatingReturnPage;
}
export interface DirectoryOperatingArguments {
 directory_operating_plan_step:{workspace:WorkspaceAlias;operating_plan_step:Operating.DirectoryOperatingPlanStepInput};
 directory_operating_plan_preview:{workspace:WorkspaceAlias;operating_plan_create:Operating.DirectoryOperatingPlanCreateInput};
 directory_operating_plan_create:{workspace:WorkspaceAlias;operating_plan_create:Operating.DirectoryOperatingPlanCreateInput};
 directory_operating_plan_save:{workspace:WorkspaceAlias;operating_plan_save:Operating.DirectoryOperatingPlanSaveInput};
 directory_operating_plan_receive:{workspace:WorkspaceAlias;operating_plan_receive:Operating.DirectoryOperatingPlanReceiveInput};
 directory_operating_plan_copy:{workspace:WorkspaceAlias;operating_plan_copy:Operating.DirectoryOperatingPlanCopyInput};
 directory_operating_plan_compare:{workspace:WorkspaceAlias;operating_plan_compare:Operating.DirectoryOperatingPlanCompareInput};
 directory_operating_plan_export:{workspace:WorkspaceAlias;operating_plan_export:Operating.DirectoryOperatingPlanExportInput};
 directory_operating_catalog:{workspace:WorkspaceAlias};
 directory_operating_document:{workspace:WorkspaceAlias;recordId:SHA256};
 directory_operating_draft:{workspace:WorkspaceAlias;recordId:SHA256;revision?:number};
 directory_operating_input:{workspace:WorkspaceAlias;recordId:SHA256};
 directory_operating_basis:{workspace:WorkspaceAlias;recordId:SHA256};
}
export interface DirectoryOperatingResultValues {
 directory_operating_plan_step:Operating.OperatingStep;
 directory_operating_plan_preview:Operating.DirectoryOperatingPreview;
 directory_operating_plan_create:Operating.DirectoryOperatingSaved;
 directory_operating_plan_save:Operating.DirectoryOperatingSaved;
 directory_operating_plan_receive:Operating.DirectoryOperatingSaved;
 directory_operating_plan_copy:Operating.DirectoryOperatingSaved;
 directory_operating_plan_compare:Operating.DirectoryOperatingComparison;
 directory_operating_plan_export:Operating.DirectoryOperatingExport;
 directory_operating_catalog:CommandCatalog;
 directory_operating_document:Operating.OperatingPlan;
 directory_operating_draft:Operating.OperatingPlanDraft;
 directory_operating_input:Operating.DirectoryOperatingPlanCreateInput|Operating.DirectoryOperatingPlanSaveInput|Operating.DirectoryOperatingPlanReceiveInput|Operating.DirectoryOperatingPlanCopyInput;
 directory_operating_basis:Operating.DirectoryOperatingBasis;
}


export type DirectoryWorksheetCollection='correctionWorksheets'|'correctionWorksheetImports'|'correctionWorksheetReturns'|'correctionWorksheetReviews';
export interface DirectoryWorksheetRef extends DirectoryRecordRef{rowSha256:SHA256;resourceSha256:SHA256;memberSha256:SHA256}
export interface DirectoryWorksheetPrepareInput{label:string;editionId:SHA256;actor:string;note?:string;predecessorId?:SHA256|null;rows:DirectoryWorksheetRef[]}
export interface DirectoryWorksheetExportInput{worksheetId:SHA256;actor:string;label?:string;note?:string}
export interface DirectoryWorksheetImportInput{worksheetId:SHA256;actor:string;filename:string;expectedSha256?:SHA256;expectedBytes?:number;note?:string}
export interface DirectoryWorksheetChoice{changeId:SHA256;decision:'accept'|'keep-original';reason:string}
export interface DirectoryWorksheetReviewInput{returnId:SHA256;label:string;actor:string;note?:string;choices:DirectoryWorksheetChoice[]}
export type DirectoryWorksheetCandidate={rowKey:SHA256;reason:string}&(
 {representation:'json';valueJson:string}|{representation:'csv';cells:string[]});
export interface DirectoryWorksheetReturnDocument{
 schema:'stellar-forge.directory-correction-worksheet-return.v1';workspaceId:UUID;worksheetId:SHA256;editionId:SHA256;
 returnedBy:string;returnedAt:string;note?:string;candidates:DirectoryWorksheetCandidate[];
}
export type DirectoryWorksheetRow={rowKey:SHA256;ref:DirectoryWorksheetRef;table:string;memberName:string;pointer:string;rowOrdinal:number;nativeId?:string|null}&(
 {representation:'json';valueJson:string}|{representation:'csv';cells:string[];headers:string[]});
export interface DirectoryWorksheetDocument{
 schema:'stellar-forge.directory-correction-worksheet.v1';workspaceId:UUID;worksheetId:SHA256;editionId:SHA256;
 label:string;actor:string;note:string;rows:DirectoryWorksheetRow[];
}
export interface DirectoryWorksheetPrepared extends DirectoryWorksheetPrepareInput{
 schema:'stellar-forge.directory-correction-worksheet.v1';id:SHA256;createdAt:string;workspaceId:UUID;
 predecessorId:SHA256|null;note:string;targets:Json;
 files:{input:DirectoryCorrectionFile;rows:DirectoryCorrectionFile};
 summary:{rows:number;jsonRows:number;csvRows:number;sources:number};
}
export interface DirectoryWorksheetImport extends DirectoryWorksheetImportInput{
 schema:'stellar-forge.directory-correction-worksheet-import.v1';id:SHA256;createdAt:string;workspaceId:UUID;editionId:SHA256;
 files:{input:DirectoryCorrectionFile};
}
export interface DirectoryWorksheetPresence{present:boolean;type?:string;valueJson?:string}
export interface DirectoryWorksheetChange{
 changeId:SHA256;ordinal:number;rowKey:SHA256;ref:DirectoryWorksheetRef;table:string;memberName:string;
 rowPointer:string;representation:'json'|'csv';action:DirectoryCorrectionEdit['action'];pointer?:string;column?:number;
 before:DirectoryWorksheetPresence;after:DirectoryWorksheetPresence;reason:string;
 edit:DirectoryCorrectionEdit;state:'proposed';
}
export interface DirectoryWorksheetReturn{
 schema:'stellar-forge.directory-correction-worksheet-return-record.v1';id:SHA256;createdAt:string;workspaceId:UUID;
 importId:SHA256;worksheetId:SHA256;editionId:SHA256;actor:string;returnedBy:string;returnedAt:string;note:string;
 files:{original:DirectoryCorrectionFile;changes:DirectoryCorrectionFile};
 summary:{rows:number;proposedRows:number;omittedRows:number;unchangedRows:number;changedRows:number;changes:number;jsonChanges:number;csvChanges:number};
}
export type DirectoryWorksheetDecision=Omit<DirectoryWorksheetChange,'state'>&DirectoryWorksheetChoice&{state:'accept'|'keep-original';customerReason:string};
export interface DirectoryWorksheetReview{
 schema:'stellar-forge.directory-correction-worksheet-review.v1';id:SHA256;createdAt:string;workspaceId:UUID;
 label:string;actor:string;note:string;returnId:SHA256;worksheetId:SHA256;editionId:SHA256;planId:SHA256|null;
 outcome:'plan-prepared'|'no-edits-selected';summary:{changes:number;accepted:number;keptOriginal:number};
 files:{input:DirectoryCorrectionFile;decisions:DirectoryCorrectionFile};
}
export type DirectoryWorksheetRecord=DirectoryWorksheetPrepared|DirectoryWorksheetImport|DirectoryWorksheetReturn|DirectoryWorksheetReview;
export interface DirectoryWorksheetPage{
 kind:DirectoryWorksheetCollection;recordId:SHA256;rows:Array<DirectoryWorksheetRow|DirectoryWorksheetChange|DirectoryWorksheetDecision>;
 total:number;offset:number;limit:number;nextOffset:number|null;bytes:number;byteBudget:4194304;
}
export interface DirectoryWorksheetExport extends Omit<DirectoryCorrectionExport,'kind'>{kind:'correction-worksheet'}
export interface DirectoryWorksheetArguments{
 directory_correction_worksheet_prepare:{workspace:WorkspaceAlias;correction_worksheet_prepare:DirectoryWorksheetPrepareInput};
 directory_correction_worksheet_export:{workspace:WorkspaceAlias;correction_worksheet_export:DirectoryWorksheetExportInput};
 directory_correction_worksheet_import:{workspace:WorkspaceAlias;correction_worksheet_import:DirectoryWorksheetImportInput};
 directory_correction_worksheet_review:{workspace:WorkspaceAlias;correction_worksheet_review:DirectoryWorksheetReviewInput};
 directory_correction_worksheet_receive:{workspace:WorkspaceAlias;importId:SHA256;input:string;expectedSha256?:SHA256};
 directory_correction_worksheet_document:{workspace:WorkspaceAlias;worksheetId:SHA256};
 directory_correction_worksheet_rows:{workspace:WorkspaceAlias;collection:DirectoryWorksheetCollection;recordId:SHA256;offset?:number;limit?:number;rowKey?:SHA256;state?:string};
 directory_correction_worksheet_file:{workspace:WorkspaceAlias;collection:DirectoryWorksheetCollection;recordId:SHA256;fileKind:'input'|'rows'|'worksheet'|'original'|'changes'|'decisions'};
}
export interface DirectoryWorksheetResultValues{
 directory_correction_worksheet_prepare:DirectoryWorksheetPrepared;
 directory_correction_worksheet_export:DirectoryWorksheetExport;
 directory_correction_worksheet_import:DirectoryWorksheetImport;
 directory_correction_worksheet_review:DirectoryWorksheetReview;
 directory_correction_worksheet_receive:DirectoryWorksheetReturn;
 directory_correction_worksheet_document:DirectoryWorksheetDocument;
 directory_correction_worksheet_rows:DirectoryWorksheetPage;
}

export type DirectoryCollection=DirectoryWorksheetReconciliationCollection|DirectoryWorksheetCollection|DirectoryCorrectionCollection|'operatingPlanReturns'|'operatingPlans'|DirectoryConformanceCollection|"connections"|"discoveries"|"requests"|"importProfiles"|"sources"|"editions"|"comparisons"|"operations"|"mappings"|"mappingPreviews"|"sourceConversions"|"selections"|"referralJoins"|"handoffs"|"exports"|"receivingReviews"|"receives";
export type DirectoryState={schema:'stellar-forge.human-services-directory.v1';workspaceId:UUID}&
 Partial<Record<DirectoryCollection,Json[]>>;
export type NativeState=Gravity.NativeState&{directory:DirectoryState};
export interface DirectoryAddedArguments extends DirectoryConformanceArguments,DirectoryOperatingArguments,DirectoryOperatingReturnArguments,DirectoryCorrectionArguments,DirectoryWorksheetArguments,DirectoryWorksheetReconciliationArguments{
 directory_link_targets:{workspace:WorkspaceAlias;editionId:SHA256;sourceId:SHA256;linkId:SHA256}&Pick<DirectorySourcePageInput,'offset'|'limit'>;
 directory_index_file:{workspace:WorkspaceAlias;collection:'sources'|'editions'|'comparisons';recordId:SHA256};
 directory_source_record_file:{workspace:WorkspaceAlias}&DirectoryRecordRef;
 directory_comparison_changes_file:{workspace:WorkspaceAlias;comparisonId:SHA256};
 directory_capture_file:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_capture_source:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_mapping_preview_details:{workspace:WorkspaceAlias;mappingPreviewId:SHA256;group:'resources'|'fields'|'findings'}&Pick<DirectoryPageInput,'offset'|'limit'>;
 directory_selection_candidates:{workspace:WorkspaceAlias;selectionId:SHA256}&DirectoryPageInput;
 directory_state:{workspace:WorkspaceAlias};directory_catalogue:{workspace:WorkspaceAlias};
 directory_guidance:{workspace:WorkspaceAlias};directory_guidance_file:{workspace:WorkspaceAlias;member:string};
 directory_records:{workspace:WorkspaceAlias;collection:DirectoryCollection}&DirectoryPageInput;
 directory_record:{workspace:WorkspaceAlias;collection:DirectoryCollection;recordId:string};
 directory_connection_save:{workspace:WorkspaceAlias;"connection":DirectorySourceConnectionInput};
 directory_discover:{workspace:WorkspaceAlias;"discovery":DirectorySourceDiscoverInput};
 directory_import_profile_save:{workspace:WorkspaceAlias;"profile":DirectorySourceImportInput};
 directory_request_save:{workspace:WorkspaceAlias;"request":DirectorySourceRequestInput};
 directory_acquire:{workspace:WorkspaceAlias;"acquisition":DirectorySourceAcquireInput};
 directory_edition_save:{workspace:WorkspaceAlias;"edition":DirectorySourceEditionInput};
 directory_compare:{workspace:WorkspaceAlias;"comparison":DirectorySourceComparisonInput};
 directory_mapping_save:{workspace:WorkspaceAlias;"mapping":DirectoryMappingInput};
 directory_mapping_preview:{workspace:WorkspaceAlias;"mapping_preview":DirectoryMappingPreviewInput};
 directory_mapping_apply:{workspace:WorkspaceAlias;"mapping_apply":DirectoryMappingApplyInput};
 directory_selection_save:{workspace:WorkspaceAlias;"selection":DirectorySelectionInput};
 directory_referral_join:{workspace:WorkspaceAlias;"referral_join":DirectoryReferralJoinInput};
 directory_handoff_prepare:{workspace:WorkspaceAlias;"handoff":DirectoryHandoffInput};
 directory_receiving_save:{workspace:WorkspaceAlias;"receiving":DirectoryReceivingInput};
 directory_export_prepare:{workspace:WorkspaceAlias;"export":DirectoryExportInput};
 directory_advance:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_pause:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_resume:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_operation:{workspace:WorkspaceAlias}&DirectorySourceOperationInput;
 directory_source_rows:{workspace:WorkspaceAlias;sourceId:SHA256}&DirectorySourcePageInput;
 directory_source_row:{workspace:WorkspaceAlias}&DirectoryRecordRef;
 directory_source_members:{workspace:WorkspaceAlias;sourceId:SHA256};
 directory_source_file:{workspace:WorkspaceAlias;sourceId:SHA256;member?:string};
 directory_source_import:{workspace:WorkspaceAlias;input:string;importProfileId:SHA256;expectedSha256?:SHA256};
 directory_edition_rows:{workspace:WorkspaceAlias;editionId:SHA256}&DirectorySourcePageInput;
 directory_edition_row:{workspace:WorkspaceAlias;editionId:SHA256}&DirectoryRecordRef;
 directory_edition_links:{workspace:WorkspaceAlias;editionId:SHA256;recordId?:SHA256}&Pick<DirectorySourcePageInput,'offset'|'limit'>;
 directory_comparison_changes:{workspace:WorkspaceAlias;comparisonId:SHA256}&DirectorySourceChangesInput;
 directory_handoff_file:{workspace:WorkspaceAlias;handoffId:SHA256};
 directory_workspace_packet:{workspace:WorkspaceAlias};
 directory_export_file:{workspace:WorkspaceAlias;exportId:SHA256};
 directory_workspace_import:{workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256};
 directory_handoff_import:{workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256};
}
export type DirectoryNativeBodyAction="directory_correction_worksheet_reconciliation_prepare"|"directory_correction_worksheet_reconciliation_review"|"directory_correction_worksheet_reconciliation_export"|"directory_correction_worksheet_prepare"|"directory_correction_worksheet_export"|"directory_correction_worksheet_import"|"directory_correction_worksheet_review"|"directory_operating_return_prepare"|"directory_operating_return_revise"|"directory_operating_return_complete"|"directory_operating_return_apply"|"directory_operating_return_receive"|"directory_operating_return_export"|"directory_operating_plan_step"|"directory_operating_plan_preview"|"directory_operating_plan_create"|"directory_operating_plan_save"|"directory_operating_plan_receive"|"directory_operating_plan_copy"|"directory_operating_plan_compare"|"directory_operating_plan_export"|"directory_conformance_plan"|"directory_conformance_assess"|"directory_conformance_review"|"directory_conformance_compare"|"directory_connection_save"|"directory_discover"|"directory_import_profile_save"|"directory_request_save"|"directory_acquire"|"directory_edition_save"|"directory_compare"|"directory_mapping_save"|"directory_mapping_preview"|"directory_mapping_apply"|"directory_selection_save"|"directory_referral_join"|"directory_handoff_prepare"|"directory_receiving_save"|"directory_export_prepare"|"directory_correction_prepare"|"directory_correction_preview"|"directory_correction_apply"|"directory_correction_export";
type OriginalReceive=Gravity.GravityReferralActionArguments['receive_export'];
export type HumanServicesDirectoryActionArguments=
 Omit<Gravity.GravityReferralActionArguments,'input_apply'|'receive_export'>&DirectoryAddedArguments&{
 input_apply:Omit<Gravity.GravityReferralActionArguments['input_apply'],'action'>&{
 action:Gravity.GravityReferralActionArguments['input_apply']['action']|DirectoryNativeBodyAction};
 receive_export:(Omit<OriginalReceive,'kind'>&{kind:OriginalReceive['kind']|'directory-handoff'})|
 (Omit<OriginalReceive,'kind'>&{kind:'directory-source';importProfileId:SHA256})|
 (Omit<OriginalReceive,'kind'>&{kind:'directory-correction-worksheet-return';importId:SHA256});
};
type InheritedResult<T>=T extends Gravity.RetainedResult<infer V>?RetainedResult<V>:
 T extends Gravity.FileManifest?FileManifest:T;
export type HumanServicesDirectoryActionResults=Omit<{
 [A in keyof Gravity.GravityReferralActionResults]:InheritedResult<Gravity.GravityReferralActionResults[A]>
},'state'>&{state:RetainedResult<NativeState>}&{
 [A in keyof DirectoryAddedArguments]:RetainedResult<A extends keyof DirectoryWorksheetReconciliationResultValues?DirectoryWorksheetReconciliationResultValues[A]:A extends keyof DirectoryWorksheetResultValues?DirectoryWorksheetResultValues[A]:A extends keyof DirectoryCorrectionResultValues?DirectoryCorrectionResultValues[A]:A extends keyof DirectoryOperatingReturnResultValues?DirectoryOperatingReturnResultValues[A]:A extends keyof DirectoryOperatingResultValues?DirectoryOperatingResultValues[A]:A extends keyof DirectoryConformanceResultValues?DirectoryConformanceResultValues[A]:A extends 'directory_state'?NativeState:Json>
};
export type HumanServicesDirectoryAction=keyof HumanServicesDirectoryActionArguments;
type Camel<S extends string>=S extends `${infer A}_${infer B}`?`${A}${Capitalize<Camel<B>>}`:S;
export type HumanServicesDirectoryClient={
 readonly endpoint:string;
 call<A extends HumanServicesDirectoryAction>(action:A|`merchant_human_services_directory_${A}`,args:HumanServicesDirectoryActionArguments[A],options?:RequestOptions):Promise<HumanServicesDirectoryActionResults[A]>;
 close():Promise<void>;readValue<T=Json>(options:ReadValueOptions):Promise<T>;
}&{[A in HumanServicesDirectoryAction as Camel<A>]:(args:HumanServicesDirectoryActionArguments[A],options?:RequestOptions)=>Promise<HumanServicesDirectoryActionResults[A]>};
export interface DownloadSelection{
 workspace:WorkspaceAlias;exportId:SHA256;client?:HumanServicesDirectoryClient;
 url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export interface DownloadOptions extends DownloadSelection{
 directory:string;expectedManifestSha256?:SHA256;chunkSize?:number;
 onProgress?:(progress:JsonObject)=>void|Promise<void>;
}
export interface DownloadReceipt{
 schema:'stellar-forge.human-services-directory-file-receipt.v1';state:'COMPLETE'|'REOPENED';
 workspace:WorkspaceAlias;workspaceId:UUID;exportId:SHA256;manifestSha256:SHA256;directory:string;
 files:number;bytes:number;kind:ExportKind;source:JsonObject;resumed?:boolean;resumedBytes?:number;
}
export interface ReadValueOptions{
 workspace?:WorkspaceAlias;result?:RetainedResult<unknown>;exportId?:SHA256;file?:string;expectedManifestSha256?:SHA256;
 client?:HumanServicesDirectoryClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;
}
export function openHumanServicesDirectoryMerchantClient(options:ClientOptions):Promise<HumanServicesDirectoryClient>;
export function openHumanServicesDirectoryLocalClient(options:LocalClientOptions):Promise<HumanServicesDirectoryClient>;
export function downloadHumanServicesDirectoryExport(options:DownloadOptions):Promise<DownloadReceipt>;
export function inspectHumanServicesDirectoryExport(options:DownloadSelection):Promise<{manifest:ExportManifest;manifestSha256:SHA256}>;
export function reopenHumanServicesDirectoryExport(options:{directory:string;workspace:WorkspaceAlias;exportId:SHA256;expectedManifestSha256?:SHA256}):Promise<DownloadReceipt>;
export function readHumanServicesDirectoryValue<T=Json>(options:ReadValueOptions):Promise<T>;
export function importHumanServicesDirectorySource(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256;
}&({profile:DirectorySourceImportInput;importProfileId?:never}|{profile?:never;importProfileId:SHA256})):
 Promise<{importProfileId:SHA256;profileResult?:RetainedResult;sourceResult:RetainedResult;source:Json}>;
export const humanServicesDirectoryActions:Readonly<Record<HumanServicesDirectoryAction,{
 name:string;description:string;inputSchema:JsonObject;annotations:JsonObject;
}>>;

export function assessHumanServicesDirectoryConformance(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessment:Omit<DirectoryConformanceAssessInput,'planId'>;requestOptions?:RequestOptions;
}&({plan:DirectoryConformancePlanInput;planId?:never}|{plan?:never;planId:SHA256})):
 Promise<{planId:SHA256;planResult?:RetainedResult<DirectoryConformancePlan>;result:RetainedResult<DirectoryConformanceAssessment>;assessment:DirectoryConformanceAssessment}>;
export function iterateHumanServicesDirectoryConformance(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind?:'findings';filters?:DirectoryConformanceFindingFilters;
}):AsyncGenerator<{page:DirectoryConformancePage<DirectoryConformanceFinding>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryConformance(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind:'rows';filters?:{table?:string};
}):AsyncGenerator<{page:DirectoryConformancePage<DirectoryConformanceRow>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryConformance(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind:'foreign_keys';filters?:DirectoryForeignKeyFilters;
}):AsyncGenerator<{page:DirectoryConformancePage<DirectoryForeignKeyOutcome>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryConformance(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind:'foreign_key_candidates';filters?:DirectoryForeignKeyCandidateFilters;
}):AsyncGenerator<{page:DirectoryConformancePage<DirectoryForeignKeyCandidate>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryConformance(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind:'foreign_key_matches';filters?:DirectoryForeignKeyMatchFilters;
}):AsyncGenerator<{page:DirectoryConformancePage<DirectoryForeignKeyMatch>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryConformance(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;
 limit?:number;requestOptions?:RequestOptions;
}&({kind?:'findings';filters?:DirectoryConformanceFindingFilters}|{kind:'rows';filters?:{table?:string}}|
 {kind:'foreign_keys';filters?:DirectoryForeignKeyFilters}|
 {kind:'foreign_key_candidates';filters?:DirectoryForeignKeyCandidateFilters}|
 {kind:'foreign_key_matches';filters?:DirectoryForeignKeyMatchFilters})):
 AsyncGenerator<{page:DirectoryConformancePage<DirectoryConformanceFinding|DirectoryConformanceRow|DirectoryForeignKeyOutcome|DirectoryForeignKeyCandidate|DirectoryForeignKeyMatch>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryForeignKeys(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind?:'outcomes';filters?:DirectoryForeignKeyFilters;
}):AsyncGenerator<{page:DirectoryForeignKeyPage<DirectoryForeignKeyOutcome>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryForeignKeys(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind:'candidates';filters?:DirectoryForeignKeyCandidateFilters;
}):AsyncGenerator<{page:DirectoryForeignKeyPage<DirectoryForeignKeyCandidate>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryForeignKeys(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
 kind:'matches';filters?:DirectoryForeignKeyMatchFilters;
}):AsyncGenerator<{page:DirectoryForeignKeyPage<DirectoryForeignKeyMatch>;result:RetainedResult},void,unknown>;
export function iterateHumanServicesDirectoryForeignKeys(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;assessmentId:SHA256;limit?:number;requestOptions?:RequestOptions;
}&({kind?:'outcomes';filters?:DirectoryForeignKeyFilters}|{kind:'candidates';filters?:DirectoryForeignKeyCandidateFilters}|
 {kind:'matches';filters?:DirectoryForeignKeyMatchFilters})):
 AsyncGenerator<{page:DirectoryForeignKeyPage<DirectoryForeignKeyOutcome|DirectoryForeignKeyCandidate|DirectoryForeignKeyMatch>;result:RetainedResult},void,unknown>;
export function downloadHumanServicesDirectoryConformance(options:
 Omit<DownloadOptions,'exportId'|'expectedManifestSha256'|'client'>&{
 client:HumanServicesDirectoryClient;collection:DirectoryConformanceFileCollection;recordId:SHA256;
 fileKind?:DirectoryConformanceFileKind;requestOptions?:RequestOptions;
 }):Promise<{result:RetainedResult;receipt:DownloadReceipt}>;

export function prepareHumanServicesDirectoryOperatingPlan(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;input:DirectoryOperatingPlanCreateInput;requestOptions?:RequestOptions;
}):Promise<{result:RetainedResult<Operating.DirectoryOperatingPreview>;preview:Operating.DirectoryOperatingPreview}>;
export function saveHumanServicesDirectoryOperatingPlan(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;input:DirectoryOperatingPlanCreateInput;previewRecordId:SHA256;requestOptions?:RequestOptions;
}):Promise<{result:RetainedResult<Operating.DirectoryOperatingSaved>;saved:Operating.DirectoryOperatingSaved}>;
export function readHumanServicesDirectoryOperatingPlan(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;recordId:SHA256;revision?:number;requestOptions?:RequestOptions;
}):Promise<{document:Operating.OperatingPlan;draft:Operating.OperatingPlanDraft;basis:Operating.DirectoryOperatingBasis;
 input:DirectoryOperatingResultValues['directory_operating_input'];results:Record<'document'|'draft'|'basis'|'input',RetainedResult>}>;
export function downloadHumanServicesDirectoryOperatingPlan(options:
 Omit<DownloadOptions,'exportId'|'expectedManifestSha256'|'client'>&{
 client:HumanServicesDirectoryClient;input:DirectoryOperatingPlanExportInput;requestOptions?:RequestOptions;
 }):Promise<{prepared:Operating.DirectoryOperatingExport;prepareResult:RetainedResult;result:RetainedResult;receipt:DownloadReceipt}>;

export function changeHumanServicesDirectoryOperatingReturn<A extends keyof Returned.DirectoryOperatingReturnInputs>(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;action:A;input:Returned.DirectoryOperatingReturnInputs[A];requestOptions?:RequestOptions;
}):Promise<{result:RetainedResult;saved:A extends 'apply'?Returned.DirectoryOperatingReturnApplied:Returned.DirectoryOperatingReturnSaved}>;
export function readHumanServicesDirectoryOperatingReturn(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;recordId:SHA256;requestOptions?:RequestOptions;
}):Promise<{record:Returned.DirectoryOperatingReturnRecord;review:Returned.OperatingPlanReturn;
 comparison:Returned.OperatingReturnComparison;input:Returned.DirectoryOperatingReturnAcceptedInput;
 results:Record<'record'|'review'|'comparison'|'input',RetainedResult>}>;
export function iterateHumanServicesDirectoryOperatingReturn(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;recordId:SHA256;
 filters?:Returned.DirectoryOperatingReturnFilters;limit?:number;requestOptions?:RequestOptions;
}):AsyncGenerator<{page:Returned.DirectoryOperatingReturnPage;result:RetainedResult},void,unknown>;
export function downloadHumanServicesDirectoryOperatingReturnFile(options:
 Omit<DownloadOptions,'exportId'|'expectedManifestSha256'|'client'>&{
 client:HumanServicesDirectoryClient;recordId:SHA256;fileKind?:'review'|'comparison'|'input';requestOptions?:RequestOptions;
 }):Promise<{record:Returned.DirectoryOperatingReturnRecord;recordResult:RetainedResult;result:RetainedResult;receipt:DownloadReceipt;payload:string}>;
export function downloadHumanServicesDirectoryOperatingReturn(options:
 Omit<DownloadOptions,'exportId'|'expectedManifestSha256'|'client'>&{
 client:HumanServicesDirectoryClient;input:Returned.DirectoryOperatingReturnExportInput;requestOptions?:RequestOptions;
 }):Promise<{prepared:Returned.DirectoryOperatingReturnExport;prepareResult:RetainedResult;result:RetainedResult;receipt:DownloadReceipt;payload:string}>;

export type * from '../directory_operating_return.mjs';

export function changeHumanServicesDirectoryCorrection(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;requestOptions?:RequestOptions;
}&(
 {action:'prepare';input:DirectoryCorrectionPrepareInput}|
 {action:'preview';input:DirectoryCorrectionPreviewInput}|
 {action:'apply';input:DirectoryCorrectionApplyInput}
)):Promise<{result:RetainedResult<DirectoryCorrectionRecord>;record:DirectoryCorrectionRecord}>;
export function readHumanServicesDirectoryCorrection(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;collection:DirectoryCorrectionCollection;
 recordId:SHA256;requestOptions?:RequestOptions
}):Promise<{result:RetainedResult<DirectoryCorrectionRecord>;record:DirectoryCorrectionRecord}>;
export function iterateHumanServicesDirectoryCorrection(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;collection:DirectoryCorrectionCollection;
 recordId:SHA256;limit?:number;requestOptions?:RequestOptions
}):AsyncGenerator<{result:RetainedResult<DirectoryCorrectionPage>;page:DirectoryCorrectionPage}>;
export function downloadHumanServicesDirectoryCorrectionFile(options:Omit<DownloadOptions,'exportId'>&{
 client:HumanServicesDirectoryClient;collection:DirectoryCorrectionCollection;recordId:SHA256;
 fileKind:'input'|'changes'|'review';requestOptions?:RequestOptions
}):Promise<{record:DirectoryCorrectionRecord;recordResult:RetainedResult<DirectoryCorrectionRecord>;
 result:RetainedResult;receipt:DownloadReceipt;payload:string}>;
export function downloadHumanServicesDirectoryCorrection(options:Omit<DownloadOptions,'exportId'>&{
 client:HumanServicesDirectoryClient;input:DirectoryCorrectionExportInput;requestOptions?:RequestOptions
}):Promise<{prepared:DirectoryCorrectionExport;prepareResult:RetainedResult<DirectoryCorrectionExport>;
 result:RetainedResult;receipt:DownloadReceipt;payload:string}>;

export function readHumanServicesDirectoryWorksheet(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;collection:DirectoryWorksheetCollection;recordId:SHA256;requestOptions?:RequestOptions
}):Promise<{record:DirectoryWorksheetRecord;result:RetainedResult<DirectoryWorksheetRecord>}>;
export function receiveHumanServicesDirectoryWorksheet(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;input:string;expectedSha256?:SHA256;requestOptions?:RequestOptions
}&({profile:DirectoryWorksheetImportInput;importId?:never}|{profile?:never;importId:SHA256})):Promise<{
 importId:SHA256;importResult?:RetainedResult<DirectoryWorksheetImport>;result:RetainedResult<DirectoryWorksheetReturn>;record:DirectoryWorksheetReturn
}>;
export function iterateHumanServicesDirectoryWorksheet(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;collection:DirectoryWorksheetCollection;recordId:SHA256;
 limit?:number;rowKey?:SHA256;state?:string;requestOptions?:RequestOptions
}):AsyncGenerator<{result:RetainedResult<DirectoryWorksheetPage>;page:DirectoryWorksheetPage}>;
export function downloadHumanServicesDirectoryWorksheetFile(options:Omit<DownloadOptions,'exportId'>&{
 client:HumanServicesDirectoryClient;collection:DirectoryWorksheetCollection;recordId:SHA256;
 fileKind:'input'|'rows'|'worksheet'|'original'|'changes'|'decisions';requestOptions?:RequestOptions
}):Promise<{record:DirectoryWorksheetRecord;recordResult:RetainedResult<DirectoryWorksheetRecord>;
 result:RetainedResult;receipt:DownloadReceipt;payload:string;descriptor:FileIdentity}>;
export function downloadHumanServicesDirectoryWorksheet(options:Omit<DownloadOptions,'exportId'>&{
 client:HumanServicesDirectoryClient;input:DirectoryWorksheetExportInput;requestOptions?:RequestOptions
}):Promise<{prepared:DirectoryWorksheetExport;prepareResult:RetainedResult<DirectoryWorksheetExport>;
 result:RetainedResult;receipt:DownloadReceipt;payload:string}>;


export type DirectoryWorksheetReconciliationCollection='correctionWorksheetReconciliations'|'correctionWorksheetReconciliationReviews';
export type DirectoryWorksheetReconciliationState='proposable'|'already-applied'|'conflict'|'unbound'|'structure-conflict';
export type DirectoryWorksheetReconciliationDecision='accept-proposed'|'keep-current'|'resolve-row';
export interface DirectoryWorksheetCurrentBinding{
 rowKey:SHA256;original:DirectoryWorksheetRef;current:DirectoryWorksheetRef|null;reason:string;
}
export interface DirectoryWorksheetReconciliationPrepareInput{
 label:string;actor:string;returnId:SHA256;currentEditionId:SHA256;predecessorId?:SHA256|null;
 bindings:DirectoryWorksheetCurrentBinding[];note?:string;
}
export interface DirectoryWorksheetReconciliationChoice{
 changeId:SHA256;decision:DirectoryWorksheetReconciliationDecision;reason:string;
}
export type DirectoryWorksheetRowResolution={rowKey:SHA256;reason:string}&(
 {representation:'json';valueJson:string}|{representation:'csv';cells:string[]});
export interface DirectoryWorksheetReconciliationReviewInput{
 label:string;actor:string;reconciliationId:SHA256;choices:DirectoryWorksheetReconciliationChoice[];
 rowResolutions?:DirectoryWorksheetRowResolution[];note?:string;
}
export interface DirectoryWorksheetReconciliationExportInput{
 reconciliationId:SHA256;reviewId?:SHA256|null;actor:string;label?:string;note?:string;
}
export type DirectoryWorksheetCurrentProjection={ref:DirectoryWorksheetRef;table:string;memberName:string;pointer:string;rowOrdinal:number;nativeId:string|null}&(
 {representation:'json';valueJson:string}|{representation:'csv';cells:string[];headers:string[]});
export interface DirectoryWorksheetReconciliationRow{
 rowKey:SHA256;binding:DirectoryWorksheetCurrentBinding;original:DirectoryWorksheetRow;
 proposed:DirectoryWorksheetCandidate|null;current:DirectoryWorksheetCurrentProjection|null;
 changeIds:SHA256[];state:'bound'|'unbound';
}
export interface DirectoryWorksheetThreeWayChange{
 changeId:SHA256;ordinal:number;rowKey:SHA256;originalChange:DirectoryWorksheetChange;
 originalRef:DirectoryWorksheetRef;currentRef:DirectoryWorksheetRef|null;
 representation:'json'|'csv';action:DirectoryCorrectionEdit['action'];pointer?:string;column?:number;
 base:DirectoryWorksheetPresence;proposed:DirectoryWorksheetPresence;current:DirectoryWorksheetPresence|null;
 state:DirectoryWorksheetReconciliationState;blocker:string|null;bindingReason:string;customerReason:string;
 currentHeaders?:string[];originalHeaders?:string[];currentCellCount?:number;originalCellCount?:number;
}
export interface DirectoryWorksheetThreeWayDecision extends DirectoryWorksheetThreeWayChange{
 decision:DirectoryWorksheetReconciliationDecision;reviewerReason:string;emitsEdit:boolean;
 resolutionRowKey?:SHA256;resolution?:DirectoryWorksheetRowResolution;
}
export interface DirectoryWorksheetReconciliationPrepared{
 schema:'stellar-forge.directory-worksheet-reconciliation.v1';id:SHA256;createdAt:string;workspaceId:UUID;
 label:string;actor:string;note:string;returnId:SHA256;worksheetId:SHA256;baseEditionId:SHA256;
 currentEditionId:SHA256;predecessorId:SHA256|null;bindings:DirectoryWorksheetCurrentBinding[];targets:Json;
 summary:{rows:number;boundRows:number;unboundRows:number;changes:number;proposable:number;
  alreadyApplied:number;conflicts:number;structureConflicts:number;unboundChanges:number};
 files:{input:DirectoryCorrectionFile;rows:DirectoryCorrectionFile;comparison:DirectoryCorrectionFile};
}
export interface DirectoryWorksheetReconciliationReview{
 schema:'stellar-forge.directory-worksheet-reconciliation-review.v1';id:SHA256;createdAt:string;workspaceId:UUID;
 label:string;actor:string;note:string;reconciliationId:SHA256;returnId:SHA256;worksheetId:SHA256;
 baseEditionId:SHA256;currentEditionId:SHA256;predecessorId:SHA256|null;planId:SHA256|null;
 outcome:'plan-prepared'|'no-edits-selected';
 summary:{changes:number;acceptedProposals:number;keptCurrent:number;resolvedChanges:number;rowResolutions:number;edits:number};
 files:{input:DirectoryCorrectionFile;decisions:DirectoryCorrectionFile};
}
export type DirectoryWorksheetReconciliationRecord=DirectoryWorksheetReconciliationPrepared|DirectoryWorksheetReconciliationReview;
export interface DirectoryWorksheetReconciliationPage{
 kind:DirectoryWorksheetReconciliationCollection;recordId:SHA256;
 rows:Array<DirectoryWorksheetThreeWayChange|DirectoryWorksheetThreeWayDecision>;
 total:number;offset:number;limit:number;nextOffset:number|null;bytes:number;byteBudget:4194304;
}
export interface DirectoryWorksheetReconciliationExport extends Omit<DirectoryCorrectionExport,'kind'>{
 kind:'correction-worksheet-reconciliation';reviewId:SHA256|null;exportInput:DirectoryWorksheetReconciliationExportInput;
}
export interface DirectoryWorksheetReconciliationArguments{
 directory_correction_worksheet_reconciliation_prepare:{workspace:WorkspaceAlias;correction_worksheet_reconciliation_prepare:DirectoryWorksheetReconciliationPrepareInput};
 directory_correction_worksheet_reconciliation_review:{workspace:WorkspaceAlias;correction_worksheet_reconciliation_review:DirectoryWorksheetReconciliationReviewInput};
 directory_correction_worksheet_reconciliation_export:{workspace:WorkspaceAlias;correction_worksheet_reconciliation_export:DirectoryWorksheetReconciliationExportInput};
 directory_correction_worksheet_reconciliation_catalogue:{workspace:WorkspaceAlias};
 directory_correction_worksheet_reconciliation_rows:{workspace:WorkspaceAlias;collection:DirectoryWorksheetReconciliationCollection;recordId:SHA256;offset?:number;limit?:number;rowKey?:SHA256;state?:DirectoryWorksheetReconciliationState|DirectoryWorksheetReconciliationDecision};
 directory_correction_worksheet_reconciliation_file:{workspace:WorkspaceAlias;collection:DirectoryWorksheetReconciliationCollection;recordId:SHA256;fileKind:'input'|'rows'|'comparison'|'decisions'};
}
export interface DirectoryWorksheetReconciliationResultValues{
 directory_correction_worksheet_reconciliation_prepare:DirectoryWorksheetReconciliationPrepared;
 directory_correction_worksheet_reconciliation_review:DirectoryWorksheetReconciliationReview;
 directory_correction_worksheet_reconciliation_export:DirectoryWorksheetReconciliationExport;
 directory_correction_worksheet_reconciliation_rows:DirectoryWorksheetReconciliationPage;
}
export function prepareDirectoryWorksheetReconciliation(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;input:DirectoryWorksheetReconciliationPrepareInput;requestOptions?:RequestOptions
}):Promise<{record:DirectoryWorksheetReconciliationPrepared;result:RetainedResult<DirectoryWorksheetReconciliationPrepared>}>;
export function reviewDirectoryWorksheetReconciliation(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;input:DirectoryWorksheetReconciliationReviewInput;requestOptions?:RequestOptions
}):Promise<{record:DirectoryWorksheetReconciliationReview;result:RetainedResult<DirectoryWorksheetReconciliationReview>}>;
export function getDirectoryWorksheetReconciliationRecord(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;collection:DirectoryWorksheetReconciliationCollection;recordId:SHA256;requestOptions?:RequestOptions
}):Promise<{record:DirectoryWorksheetReconciliationRecord;result:RetainedResult<DirectoryWorksheetReconciliationRecord>}>;
export function directoryWorksheetReconciliationRows(options:{
 client:HumanServicesDirectoryClient;workspace:WorkspaceAlias;collection:DirectoryWorksheetReconciliationCollection;recordId:SHA256;
 limit?:number;rowKey?:SHA256;state?:DirectoryWorksheetReconciliationState|DirectoryWorksheetReconciliationDecision;requestOptions?:RequestOptions
}):AsyncGenerator<{result:RetainedResult<DirectoryWorksheetReconciliationPage>;page:DirectoryWorksheetReconciliationPage}>;
export function directoryWorksheetReconciliationFile(options:Omit<DownloadOptions,'exportId'>&{
 client:HumanServicesDirectoryClient;collection:DirectoryWorksheetReconciliationCollection;recordId:SHA256;
 fileKind:'input'|'rows'|'comparison'|'decisions';requestOptions?:RequestOptions
}):Promise<{record:DirectoryWorksheetReconciliationRecord;recordResult:RetainedResult<DirectoryWorksheetReconciliationRecord>;
 result:RetainedResult;receipt:DownloadReceipt;payload:string;descriptor:FileIdentity}>;
export function exportDirectoryWorksheetReconciliation(options:Omit<DownloadOptions,'exportId'>&{
 client:HumanServicesDirectoryClient;input:DirectoryWorksheetReconciliationExportInput;requestOptions?:RequestOptions
}):Promise<{prepared:DirectoryWorksheetReconciliationExport;prepareResult:RetainedResult<DirectoryWorksheetReconciliationExport>;
 result:RetainedResult;receipt:DownloadReceipt;payload:string}>;
