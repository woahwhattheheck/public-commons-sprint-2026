/** Complete agency service configuration, original-source routing and editable receiving. */
import type { Buffer } from 'node:buffer';
import type { Server } from 'node:http';
export type JsonScalar=string|number|boolean|null;
export type JsonValue=JsonScalar|JsonValue[]|{[key:string]:JsonValue};
export type Stage='received'|'assigned'|'in_progress'|'resolved'|'closed_other';
export type SemanticField='requestId'|'serviceCode'|'category'|'serviceName'|'title'|'description'|'createdAt'|'updatedAt'|'closedAt'|'status'|'statusNotes'|'address'|'latitude'|'longitude'|'residentEmail'|'trackingUrl'|'publicMapOverride'|'issueNumber'|'caseNumber'|'workOrderIds'|'completionNote'|'progressSummary'|'magicLink';
export interface Calendar {kind:'calendar_days'|'business_days';weekdays:number[];holidays:string[]}
export interface Agency {id:string;name:string;timeZone:string;calendar:Calendar;[key:string]:unknown}
export interface Department {id:string;name:string;active:boolean;[key:string]:unknown}
export interface Permissions {crmEnabled:boolean;crmProductAdmin:boolean;crmAccess:'none'|'read_only'|'basic'|'overwrite'}
export interface PermissionDeclaration {id:string;name:string;description:string;active:boolean;permissions:Permissions;sourceLabel?:string;sourceReference?:string;[key:string]:unknown}
export interface Staff {id:string;name:string;departmentIds:string[];roleId:string;groupIds:string[];contact:string;active:boolean;[key:string]:unknown}
export interface CategorySelector {sourceProfileId:string;field:'serviceCode'|'category'|'serviceName';value:JsonScalar}
export interface CustomField {id:string;label:string;kind:'text'|'number'|'boolean'|'date'|'single_select'|'multi_select';scope:'submission'|'location';required:boolean;options:Array<{value:string;label:string}>;helpText:string;sourcePointer?:string;defaultValue?:JsonValue;[key:string]:unknown}
export interface Category {id:string;name:string;description:string;sourceSelectors:CategorySelector[];active:boolean;isOther:boolean;displayOrder:number;includeLocation:boolean;locationRequired:boolean;departmentId:string|null;ownerStaffId:string|null;keywords:string[];resolutionDays:number|null;publicMapDefault:'show'|'hide';customFields:CustomField[];templateIds:string[];[key:string]:unknown}
export interface ResidentWording {assignee_name?:string;completion_note?:string;progress_summary?:string}
export interface Template {id:string;name:string;audience:'staff'|'resident';stage:Stage;subject:string;body:string;locale:string;active:boolean;residentWording?:ResidentWording;[key:string]:unknown}
export type RouteField=SemanticField|`custom:${string}`;
export type RouteSelector={field:RouteField;operator:'equals';value:JsonScalar}|{field:RouteField;operator:'in';values:JsonScalar[]};
export interface Route {id:string;name:string;active:boolean;categoryIds:string[];sourceProfileIds:string[];selectors:RouteSelector[];departmentId:string|null;ownerStaffId:string|null;collaboratorStaffIds:string[];templateIds:string[];note:string;[key:string]:unknown}
export type MappingValue={pointer:string}|{literal:JsonValue};
export interface StatusMapping {sourceValue:JsonScalar;stage:Stage;completionMeaning:string}
export interface PublicMapMapping {values:Array<{sourceValue:JsonScalar;publicMap:'show'|'hide'|'default'}>}
export interface SourceProfile {id:string;name:string;kind:'open311_georeport_v2'|'follow_through_dispatch_v1'|'field_destination_update_v1'|'mapped_records';rowsPointer:string;mapping:Partial<Record<SemanticField,MappingValue>>;statusMappings:StatusMapping[];publicMapOverrideMapping?:PublicMapMapping|null;note:string;[key:string]:unknown}
export interface RolloutPhase {id:string;name:string;audience:'staff'|'commissioners'|'resident';categoryIds:string[];departmentIds:string[];ownerStaffId:string|null;trainingItems:string[];entryCriteria:string[];exitCriteria:string[];note:string;[key:string]:unknown}
export interface ProfileDefinition {name:string;agency:Agency;departments:Department[];roles:PermissionDeclaration[];groups:PermissionDeclaration[];staff:Staff[];categories:Category[];templates:Template[];routes:Route[];sourceProfiles:SourceProfile[];rollout:RolloutPhase[];note:string;[key:string]:unknown}
export interface ProfileRecord {schema:'commons.open311.service-profile.v1';id:string;versionId:string;previousVersionId:string|null;createdAt:string;definition:ProfileDefinition;sha256:string}
export interface ProfileSummary {id:string;versionId:string;previousVersionId:string|null;name:string;createdAt:string;sha256:string}
export interface SourceFile {filename:string;contentType:string;bytes:number;sha256:string}
export interface SourceSelection {rowsPointer:string}
export interface SourceRecord {schema:'commons.open311.service-source.v1';id:string;name:string;createdAt:string;selection:SourceSelection;rowCount:number;originalFile:SourceFile;originalText:string;sha256:string}
export type SourceSummary=Omit<SourceRecord,'originalText'>;
export interface OriginalRow {key:string;index:number;pointer:string;value:JsonValue}
export interface SourceInspection {schema:'commons.open311.service-source-inspection.v1';originalFile:{bytes:number;sha256:string};rootType:'null'|'array'|'object'|'string'|'number'|'boolean';arrays:Array<{pointer:string;rows:number;fields:string[]}>}
export interface PageSelection {q?:string;offset?:number;limit?:number}
export interface Page<T> {items:T[];total:number;offset:number;limit:number;nextOffset:number|null}
export interface SourceRowsSelection extends PageSelection {sourceId:string}
export interface DueDate {date:string|null;timeZone:string;calendar:Calendar;sourceCreatedAt:string|null;createdLocalDate:string|null}
export interface Issue {code:string;message:string;field:string|null;severity:'error'|'warning'|'info';details?:JsonValue}
export interface Override {sourceKey:string;reason:string;categoryId?:string|null;departmentId?:string|null;ownerStaffId?:string|null;publicMap?:'show'|'hide';stage?:Stage}
export interface BaselineSelection {profileId:string;profileVersionId:string;declaredBy:string;note:string}
export interface SavedBaseline extends BaselineSelection {profileSha256:string}
export interface ResolvedBaseline {profile:ProfileRecord;declaredBy:string;note:string}
export interface RenderedTemplate {id:string;name:string;audience:'staff'|'resident';stage:Stage;subject:string;body:string;locale:string;recipient:JsonValue;state:'unresolved'|'rendered';unresolved:Array<{token:string;message:string}>;bindings:Record<string,{basis:string;value:JsonValue}>;documentedNativeTokens:string[];deliveryState:'PREVIEW'}
export interface ConditionEvaluation {field:RouteField;operator:'equals'|'in';value?:JsonScalar;values?:JsonScalar[];found:boolean;actual:JsonValue;basis:string;matched:boolean}
export interface RouteEvaluation {routeId:string;matched:boolean;conditions:ConditionEvaluation[]}
export interface ResolvedPermission {kind:'role'|'group';id:string;name:string;active:boolean;permissions:Permissions}
export interface RoutingResult {departmentId:string|null;ownerStaffId:string|null;collaboratorStaffIds:string[];routeIds:string[];basis:string;evaluations:RouteEvaluation[];unresolvedConflict:boolean;permissionDeclarations:ResolvedPermission[];templateIds:string[]}
export interface PreviewRow {id:string;sourceKey:string;sourceIndex:number;sourcePointer:string;serviceRequestId:string|null;source:Partial<Record<SemanticField,JsonValue>>;mappingObservations:Record<SemanticField,{found:boolean;basis:string;mapping?:MappingValue}>;category:{id:string;name:string;active:boolean}|null;categoryBasis:string;matchedCategoryIds:string[];customFields:Record<string,{field:CustomField;found:boolean;basis:string;value:JsonValue}>;routing:RoutingResult;due:DueDate;publicMap:{value:'show'|'hide'|null;basis:string;originalValue:JsonValue;originalMapping:PublicMapMapping|null;inputBasis:string};stage:Stage|null;stageBasis:string;completionMeaning:string|null;templates:RenderedTemplate[];templateSelection:Array<{id:string;active:boolean;stage:Stage;applicable:boolean}>;override:Override|null;issues:Issue[];state:'ready'|'unmatched'|'conflict'|'invalid'}
export interface PreviewCounts {ready:number;unmatched:number;conflict:number;invalid:number}
export interface PreviewDiagnostics {unassigned:number;unresolvedDates:number;unresolvedMessageTokens:number;visibilityIssues:number}
export interface Implication {code:string;state:string;message:string;[key:string]:unknown}
export interface PreviewRecord {schema:'commons.open311.service-preview.v1';id:string;name:string;profileId:string;profileVersionId:string;profileSha256:string;sourceId:string;sourceSha256:string;originalFile:SourceFile;sourceProfileId:string;createdAt:string;rowCount:number;counts:PreviewCounts;diagnostics:PreviewDiagnostics;mapping:{sourceProfileId:string};overrides:Override[];baseline:SavedBaseline|null;implications:Implication[];items:PreviewRow[];sha256:string}
export interface PreviewSummary {schema:'commons.open311.service-preview.v1';id:string;name:string;profileId:string;profileVersionId:string;sourceId:string;sourceSha256:string;sourceProfileId:string;createdAt:string;rowCount:number;counts:PreviewCounts;diagnostics:PreviewDiagnostics;sha256:string}
export interface PreviewSelection extends PageSelection {id:string}
export interface PreviewPage extends Page<PreviewRow> {preview:Omit<PreviewRecord,'items'>}
export interface ApplyStage {stage:number;name:string;definitions:unknown;implications?:Implication[]}
export interface ReleaseRecord {schema:'commons.open311.service-release.v1';id:string;name:string;createdAt:string;reviewer:string;note:string;state:'PREPARED_FOR_APPLICATION';profileId:string;profileVersionId:string;profileSha256:string;previewId:string;previewSha256:string;sourceId:string;sourceSha256:string;counts:PreviewCounts;implications:Implication[];applyOrder:ApplyStage[];profile:ProfileRecord;preview:PreviewRecord;source:SourceRecord;baseline:ResolvedBaseline|null;remaining:Array<{sourceKey:string;serviceRequestId:string|null;state:PreviewRow['state'];issues:Issue[]}>;sha256:string}
export interface ReleaseSummary {schema:'commons.open311.service-release.v1';id:string;name:string;createdAt:string;reviewer:string;note:string;state:'PREPARED_FOR_APPLICATION';profileId:string;profileVersionId:string;previewId:string;sourceId:string;counts:PreviewCounts;sha256:string}
export interface MutationControl {requestId:string;expectedRevision:number}
export interface HostInput {alias:string;kind:'profile'|'source'|'workspace';format:'json';sha256:string}
export interface PutProfileInput extends MutationControl {profile:{id?:string;definition:ProfileDefinition};expectedProfileVersionId?:string|null;originalText?:string;hostInput?:HostInput}
export interface ImportSourceInput extends MutationControl {name:string;originalText:string;selection:SourceSelection;hostInput?:HostInput}
export interface CreatePreviewInput extends MutationControl {name:string;profileId:string;expectedProfileVersionId:string;sourceId:string;mapping:{sourceProfileId:string};overrides?:Override[];baseline?:BaselineSelection|null}
export interface CreateReleaseInput extends MutationControl {name:string;profileId:string;expectedProfileVersionId:string;previewId:string;reviewer:string;note?:string}
export interface ReceiveInput extends MutationControl {originalText:string;hostInput?:HostInput}
export type MutationResult<T>={workspaceId:string;revision:number;requestId:string}&T;
export interface ReceivingReceipt {requestId:string;receivedAt:string;destinationWorkspaceId:string;originWorkspaceId:string;originRevision:number;originalFile:{bytes:number;sha256:string};packageSha256:string}
export interface Operation {requestId:string;kind:'profile-save'|'source-import'|'preview-create'|'release-create'|'workspace-receive';state:'SUCCEEDED';inputSha256:string;input:MutationControl&Record<string,unknown>;result:MutationResult<Record<string,unknown>>;createdAt:string}
export interface OperationSummary {requestId:string;kind:Operation['kind'];state:'SUCCEEDED';createdAt:string}
export interface WorkspaceState {schema:'commons.open311.service-configuration-database.v1';workspaceId:string;revision:number;createdAt:string;updatedAt:string;receivedFrom:ReceivingReceipt[];directory:string;profiles:ProfileSummary[];sources:SourceSummary[];previews:PreviewSummary[];releases:ReleaseSummary[];counts:{profiles:number;profileVersions:number;sources:number;sourceRows:number;previews:number;releases:number};operations:OperationSummary[]}
export interface WorkspaceRecord {kind:'profile'|'source'|'preview'|'release';id:string;value:ProfileRecord|SourceRecord|PreviewRecord|ReleaseRecord}
export interface WorkspacePackage {schema:'commons.open311.service-configuration-workspace.v1';workspaceId:string;revision:number;createdAt:string;updatedAt:string;exportedAt:string;records:WorkspaceRecord[];operations:Operation[];receivedFrom:ReceivingReceipt[];sha256:string}
export type ExportKind='workspace'|'profile'|'source'|'preview-json'|'preview-csv'|'release-json'|'release-report';
export interface ExportSelection {kind?:ExportKind;profileId?:string;profileVersionId?:string;sourceId?:string;previewId?:string;releaseId?:string;expectedRevision?:number}
export interface FileResult {filename:string;contentType:string;bytes:number;sha256:string;body:Buffer}
export interface ServiceConfigurationWorkspace {
  readonly directory:string;readonly filename:string;
  state():WorkspaceState;
  operation(requestId:string):Operation|null;
  profile(id:string):{profile:ProfileRecord;history:ProfileRecord[]};
  source(id:string):{source:SourceSummary;originalText:string};
  sourceRows(selection:SourceRowsSelection):Page<OriginalRow>;
  preview(selection:PreviewSelection|string):PreviewPage;
  release(id:string):{release:ReleaseRecord};
  putProfile(input:PutProfileInput):MutationResult<{profile:ProfileSummary}>;
  importSource(input:ImportSourceInput):MutationResult<{source:SourceSummary}>;
  createPreview(input:CreatePreviewInput):MutationResult<{preview:PreviewSummary}>;
  createRelease(input:CreateReleaseInput):MutationResult<{release:ReleaseSummary}>;
  inspectSource(originalText:string):SourceInspection;
  workspaceExport():WorkspacePackage;
  receive(input:ReceiveInput):MutationResult<{packageSha256:string;receivedFrom:ReceivingReceipt}>;
  exportFile(selection?:ExportSelection):FileResult;
  close():void;
}
export interface WorkspaceBinding {schema:'stellar-forge.open311-service-configuration-binding.v1';directory:string;workspaceId:string;sha256:string}
export interface Startup {schema:'stellar-forge.open311-service-configuration-startup.v1';state:'LISTENING';directory:string;workspaceId:string;bindingSha256:string;binding:WorkspaceBinding;instanceId:string;startedAt:string;url:string}
export interface ServeOptions {directory:string;host?:'127.0.0.1'|'::1';port?:number;expectedWorkspaceId?:string;expectedBindingSha256?:string}
export interface RunningServer {server:Server;workspace:ServiceConfigurationWorkspace;url:string;startup:Startup;readonly launch:Startup;close():Promise<void>}
export declare function openWorkspace(directory:string,options?:{create?:boolean}):ServiceConfigurationWorkspace;
export declare function validateWorkspacePackage(originalText:string):WorkspacePackage;
export declare function inspectSource(originalText:string):SourceInspection;
export declare function sourceRows(source:SourceRecord):OriginalRow[];
export declare function pointerValue(root:JsonValue,pointer:string):{found:boolean;value:JsonValue};
export declare function validateProfileDefinition(definition:unknown):ProfileDefinition;
export declare function permissionDeclarations(definition:ProfileDefinition,staffId:string):ResolvedPermission[];
export declare function profileImplications(profile:ProfileRecord,baseline?:ResolvedBaseline|null):Implication[];
export declare function calculateDueDate(createdAt:string|null|undefined,resolutionDays:number|null,agency:Pick<Agency,'timeZone'|'calendar'>):DueDate;
export declare function validateCalendar(agency:Pick<Agency,'timeZone'|'calendar'>):{timeZone:string;calendar:Calendar};
export declare class ServiceCalendarError extends Error {code:string;constructor(code:string,message:string)}
export declare function createPreview(input:CreatePreviewInput,identity:{id:string;createdAt:string},context:{profile:ProfileRecord;source:SourceRecord;baseline?:ResolvedBaseline|null}):PreviewRecord;
export declare function createRelease(input:CreateReleaseInput,identity:{id:string;createdAt:string},context:{profile:ProfileRecord;source:SourceRecord;preview:PreviewRecord;baseline?:ResolvedBaseline|null}):ReleaseRecord;
export declare function serveServiceConfiguration(options:ServeOptions):Promise<RunningServer>;
export declare function startServiceConfigurationServer(options:Omit<ServeOptions,'directory'>&{workspace:string}):Promise<RunningServer>;
export declare function workspaceBinding(directory:string,workspaceId:string):string;
export declare const WORKSPACE_SCHEMA:'commons.open311.service-configuration-workspace.v1';
export declare const DATABASE_SCHEMA:'commons.open311.service-configuration-database.v1';
export declare const SOURCE_SCHEMA:'commons.open311.service-source.v1';
export declare const INSPECTION_SCHEMA:'commons.open311.service-source-inspection.v1';
export declare const PROFILE_SCHEMA:'commons.open311.service-profile.v1';
export declare const PREVIEW_SCHEMA:'commons.open311.service-preview.v1';
export declare const RELEASE_SCHEMA:'commons.open311.service-release.v1';
export declare const STARTUP_SCHEMA:'stellar-forge.open311-service-configuration-startup.v1';
export declare const BINDING_SCHEMA:'stellar-forge.open311-service-configuration-binding.v1';
export declare const SEMANTIC_FIELDS:SemanticField[];
export declare const STAGES:Stage[];
export declare const TEMPLATE_TOKENS:string[];
