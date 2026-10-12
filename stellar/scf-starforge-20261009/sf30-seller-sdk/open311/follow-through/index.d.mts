import type { Buffer } from 'node:buffer';
export type JSONValue=null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue};
export type JsonObject=Record<string,JSONValue>;
export interface Control {requestId:string;expectedRevision:number}
export interface Identity {id:string;createdAt:string}
export interface Sealed {schema:string;sha256:string}
export interface PageInput {offset?:number;limit?:number;q?:string}
export interface Page<T> {items:T[];total:number;offset:number;limit:number}
export type SourceRole='requests'|'orders';
export type SourceFormat='arcgis'|'geojson'|'csv'|'json'|'auto'|'records'|'open311-collection'|'open311-report';
export interface SourceOptions {name?:string;kind?:SourceFormat;metadataText?:string;captureIds?:string[];sourceUrl?:string;role?:SourceRole;seriesId?:string;observedAt?:string}
export interface OriginalFile {id:string;name:string;kind:string;bytes:number;sha256:string;sourceUrl:string|null;observedAt:string|null}
export interface Field {name:string;type:string;alias:string;[key:string]:JSONValue}
export interface SourceInspection {name:string;kind:string;role:SourceRole|null;state:'ready'|'source_error'|'selection_required';rows:number;fields:Field[];spatialReference:JSONValue;coverage:JsonObject;originalFiles:OriginalFile[];error:JsonObject|null;errors?:JsonObject[];availableCaptures?:{id:string;state:'ready'|'source_error';rows:number;sourceUrl:string|null}[];metadata?:JsonObject|null}
export interface SourceSummary {id:string;name:string;seriesId:string;kind:string;role:SourceRole;observedAt:string;rows:number;sha256:string;coverage:JsonObject;createdAt:string;state:'ready'|'source_error'}
export interface Source extends SourceInspection,Sealed {id:string;seriesId:string;role:SourceRole;observedAt:string;createdAt:string;options:SourceOptions&{role:SourceRole;seriesId:string;observedAt:string};originalText:string}
export interface SourceRow {index:number;captureId:string;attributes:JsonObject;geometry:JSONValue;spatialReference:JSONValue;sourceSha256:string;original:JsonObject}
export interface Point {type:'Point';coordinates:[number,number]}
export interface CoordinateInterpretation {mode:'source'|'wgs84'|'web-mercator'|'manual';name?:string;sourceReferences?:string[];longitude?:number|null;latitude?:number|null}
export interface Location {geometry:Point|null;interpretation:CoordinateInterpretation;coordinateSha256:string;reason:string|null}
export interface DateMapping {field:string;format:'epoch-ms'|'iso-offset'|'literal'}
export interface MappedDate extends DateMapping {sourceValue:JSONValue;instant:string|null}
export interface RoleMapping {idFields:string[];titleField?:string|null;descriptionField?:string|null;statusField?:string|null;referenceFields?:string[];dates?:Partial<Record<'createdAt'|'updatedAt'|'closedAt',DateMapping>>;coordinates?:CoordinateInterpretation}
export interface RequestMapping extends RoleMapping {workNeeded?:{field?:string|null;neededValues?:JSONValue[];notNeededValues?:JSONValue[]}}
export interface OrderMapping extends RoleMapping {costs?:{field:string;label?:string;unit?:string|null}[]}
export interface JoinRule {id:string;name:string;requestField:string;orderField:string;normalization?:'exact'|'trim-text'|'fold-text'}
export interface ProfileInput {id:string;name:string;revision:number;request:RequestMapping;order?:OrderMapping;joins?:JoinRule[];statuses?:{requestClosed?:JSONValue[];requestActive?:JSONValue[];orderClosed?:JSONValue[];orderActive?:JSONValue[]};rules?:{requireOrderWhenNeeded?:boolean;flagMultipleCandidates?:boolean;flagRequestClosedOrderActive?:boolean;flagOrderClosedRequestActive?:boolean;staleAfterDays?:number|null};notes?:string}
export interface Profile extends ProfileInput,Sealed {key:string;order:OrderMapping;joins:JoinRule[];statuses:Required<NonNullable<ProfileInput['statuses']>>;rules:Required<NonNullable<ProfileInput['rules']>>;notes:string}
export interface EditionDefinition {name:string;seriesId:string;profileId:string;requestSourceId:string;orderSourceId?:string|null;asOf:string;commentary?:string}
export interface Discrepancy {code:string;label:string;detail:string}
export interface NormalizedRecord {key:string;sourceSha256:string;sourceId:string;sourceSeriesId:string;captureId:string;sourceIndex:number;identityValues:JSONValue[];identityValid:boolean;title:string;description:string;sourceStatus:JSONValue;referenceValues:JsonObject;dates:Partial<Record<'createdAt'|'updatedAt'|'closedAt',MappedDate>>;createdAt:string|null;updatedAt:string|null;closedAt:string|null;geometry:Point|null;location:Location;originalGeometry:JSONValue;spatialReference:JSONValue;source:JsonObject;original:JsonObject;issues:Discrepancy[];versions:{sourceSha256:string;source:JsonObject;original:JsonObject;occurrences:{index:number;captureId:string;sourceSha256:string}[]}[]}
export interface NormalizedRequest extends NormalizedRecord {serviceRequestId:string;workNeeded:'needed'|'not_needed'|'unknown'}
export interface NormalizedOrder extends NormalizedRecord {workOrderId:string;costs:{field:string;label:string;unit:string|null;value:JSONValue}[]}
export interface Edition extends Sealed {id:string;name:string;seriesId:string;definition:EditionDefinition;profileId:string;profileSha256:string;requestSourceId:string;orderSourceId:string|null;asOf:string;createdAt:string;requests:NormalizedRequest[];orders:NormalizedOrder[];candidateLinks:{key:string;candidates:{orderKey:string;matches:JoinMatch[]}[]}[];coverage:JsonObject;totals:Record<string,number>}
export interface EditionSummary {id:string;name:string;seriesId:string;profileId:string;requestSourceId:string;orderSourceId:string|null;asOf:string;rows:number;totals:Record<string,number>;createdAt:string;sha256:string}
export interface JoinMatch {joinId:string;name:string;requestField:string;orderField:string;requestValue:JSONValue;orderValue:JSONValue}
export interface LinkInput {editionId:string;key:string;sourceSha256:string;orderKey:string;orderSha256:string;decision:'confirm'|'reject';reviewer:string;note?:string}
export interface Link extends LinkInput,Sealed {id:string;seriesId:string;note:string;createdAt:string}
export interface LinkView extends Link {sourceChanged:boolean;order:NormalizedOrder|null}
export type WorkStatus='new'|'assigned'|'in_progress'|'done'|'dismissed';
export type Action='review'|'contact'|'inspect'|'create_work_order'|'update_work_order'|'reconcile'|'none';
export interface WorkInput {editionId:string;key:string;sourceSha256:string;status?:WorkStatus;assignee?:string;priority?:'low'|'normal'|'high'|'urgent';dueAt?:string|null;note?:string;action?:Action;actionNote?:string;targetOrderKeys?:string[];approval?:'draft'|'approved'|'rejected';reviewer?:string;location?:CoordinateInterpretation}
export interface Work extends Required<WorkInput>,Sealed {id:string;seriesId:string;previousWorkId:string|null;createdAt:string;serviceRequestId:string;title:string;profileId:string;locationApplied:CoordinateInterpretation;coordinateSha256:string;locatedGeometry:Point|null;locationReason:string|null;targetOrders:{key:string;sourceSha256:string;workOrderId:string}[];approvalSource:{editionId:string;sourceSha256:string;orderVersions:{key:string;sourceSha256:string}[]}}
export interface WorkView extends Work {sourceChanged:boolean;orderChanged:boolean;coordinateChanged:boolean;geometry:Point|null;approvalCurrent:boolean}
export type WorkSummary=Pick<Work,'id'|'seriesId'|'editionId'|'key'|'sourceSha256'|'serviceRequestId'|'title'|'status'|'assignee'|'priority'|'dueAt'|'action'|'actionNote'|'approval'|'reviewer'|'createdAt'|'previousWorkId'>;
export interface WorkQueueRow extends WorkSummary {selectedEditionId:string;sourceChanged:boolean;orderChanged:boolean;coordinateChanged:boolean;approvalCurrent:boolean;geometry:Point|null}
export interface RequestView extends NormalizedRequest {candidateCount:number;linkCount:number;discrepancies:Discrepancy[];work:WorkView|null}
export type RequestSummary=Pick<RequestView,'key'|'serviceRequestId'|'sourceSha256'|'sourceId'|'title'|'description'|'sourceStatus'|'workNeeded'|'createdAt'|'updatedAt'|'closedAt'|'referenceValues'|'geometry'|'originalGeometry'|'candidateCount'|'linkCount'|'discrepancies'>&{work:(WorkSummary&Pick<WorkView,'sourceChanged'|'orderChanged'|'coordinateChanged'|'approvalCurrent'>)|null};
export interface RequestDetail {edition:EditionSummary;request:RequestView;candidates:{order:NormalizedOrder;matches:JoinMatch[]}[];links:LinkView[];discrepancies:Discrepancy[];work:WorkView|null;history:Work[]}
export interface Context {links:Link[];work:Work[];decisions?:ReviewDecision[]}
export interface ReviewerTemplate {schema:string;name:string;baseEditionId:string;baseEditionSha256:string;reviewer:string;notes:string;work:JsonObject[];links:JsonObject[]}
export interface Proposal {id:string;kind:'work'|'link';key:string;sourceSha256:string;beforeWorkId?:string|null;orderKey?:string;orderSha256?:string;beforeLinkId?:string|null;before:JSONValue;after:JSONValue;conflicts:JsonObject[];status:'pending'|'accepted'|'rejected';decision?:ReviewDecision|null}
export interface ReviewerReturn extends Sealed {id:string;name:string;baseEditionId:string;baseEditionSha256:string;seriesId:string;reviewer:string;notes:string;createdAt:string;originalText:string;originalFile:{bytes:number;sha256:string};unchanged:number;proposals:Proposal[]}
export interface ReturnSummary {id:string;name:string;baseEditionId:string;seriesId:string;reviewer:string;createdAt:string;proposals:number;pending:number;unchanged:number;sha256:string}
export interface DecisionSelection {returnId:string;targetEditionId:string;accept?:string[];reject?:string[];reviewer:string;note?:string}
export interface ReviewDecision extends Required<DecisionSelection>,Sealed {id:string;createdAt:string;linkIds:string[];workIds:string[]}
export interface ReturnDetail extends Omit<ReturnSummary,'proposals'> {originalFile:{bytes:number;sha256:string};baseEditionSha256:string;notes:string;targetEditionId:string;proposals:Proposal[];decisions:ReviewDecision[]}
export interface DispatchColumn {name:string;source:'request'|'order'|'work';field:string}
export interface DispatchDefinition {name:string;editionId:string;workIds:string[];columns?:DispatchColumn[];note?:string}
export interface DispatchRow {key:string;serviceRequestId:string;sourceSha256:string;request:NormalizedRequest;orders:NormalizedOrder[];work:Work;geometry:Point|null;mapped:JsonObject}
export interface Dispatch extends Sealed {id:string;name:string;editionId:string;editionSha256:string;seriesId:string;createdAt:string;definition:Required<DispatchDefinition>;rows:DispatchRow[];coverage:JsonObject;totals:{actions:number;located:number;unlocated:number}}
export interface DispatchSummary {id:string;name:string;editionId:string;seriesId:string;createdAt:string;rows:number;totals:Dispatch['totals'];sha256:string}
export interface Change {entity:'requests'|'orders';key:string;serviceRequestId?:string;workOrderId?:string;kind:'added'|'changed'|'not_observed';before:NormalizedRequest|NormalizedOrder|null;after:NormalizedRequest|NormalizedOrder|null;fields:string[];sourceMetadataOnly:boolean}
export interface Changes {entity:'requests'|'orders';items:Change[];summary:{added:number;changed:number;notObserved:number;unchanged:number;sourceMetadataOnly:number};before:EditionSummary;after:EditionSummary;scope:JsonObject}
export interface WorkspaceOperation {requestId:string;kind:string;state:'SUCCEEDED';inputSha256:string;input:Record<string,unknown>;result:Record<string,unknown>;createdAt:string}
export interface WorkspaceState {schema:string;directory:string;workspaceId:string;revision:number;createdAt:string;updatedAt:string;receivedFrom:JsonObject[];sources:SourceSummary[];profiles:Profile[];editions:EditionSummary[];work:WorkSummary[];returns:ReturnSummary[];dispatches:DispatchSummary[];defaultDispatchColumns:DispatchColumn[];operations:Pick<WorkspaceOperation,'requestId'|'kind'|'state'|'createdAt'>[]}
export type MutationResult<T>={workspaceId:string;revision:number;requestId:string}&T;
export type ExportKind='workspace'|'source'|'edition'|'requests-csv'|'review'|'dispatch-json'|'dispatch-csv'|'dispatch-geojson'|'report'|'returned';
export interface ExportSelection {kind:ExportKind;sourceId?:string;fileId?:string;editionId?:string;dispatchId?:string;returnId?:string;expectedRevision?:number}
export interface ExportedFile {filename:string;contentType:string;body:string|Buffer;bytes:number;sha256:string}
export interface WorkspacePackage extends Sealed {workspaceId:string;revision:number;createdAt:string;updatedAt:string;exportedAt:string;records:{kind:string;id:string;value:Record<string,unknown>}[];operations:WorkspaceOperation[];receivedFrom:JsonObject[]}
export const SOURCE_SCHEMA:'commons.open311.follow-through-source.v1';
export const PROFILE_SCHEMA:'commons.open311.follow-through-profile.v1';
export const EDITION_SCHEMA:'commons.open311.follow-through-edition.v1';
export const LINK_SCHEMA:'commons.open311.follow-through-link.v1';
export const WORK_SCHEMA:'commons.open311.follow-through-work.v1';
export const REVIEW_SCHEMA:'commons.open311.follow-through-review.v1';
export const RETURN_SCHEMA:'commons.open311.follow-through-return.v1';
export const DECISION_SCHEMA:'commons.open311.follow-through-decision.v1';
export const DISPATCH_SCHEMA:'commons.open311.follow-through-dispatch.v1';
export const WORK_STATUSES:WorkStatus[];
export const ACTIONS:Action[];
export const DEFAULT_DISPATCH_COLUMNS:DispatchColumn[];
export function inspectSource(originalText:string,options?:SourceOptions):SourceInspection;
export function importSource(originalText:string,options:SourceOptions&{role:SourceRole;seriesId:string;observedAt:string},identity?:Partial<Identity>):Source;
export function sourceSummary(source:Source):SourceSummary;
export function sourceDetail(source:Source):Omit<Source,'originalText'|'options'>;
export function originalRows(source:Source):SourceRow[];
export function sourceOriginalFile(source:Source,fileId?:string|null):{filename:string;body:string;contentType:string};
export function normalizeProfile(input:ProfileInput):Profile;
export function normalizeDefinition(input:EditionDefinition):Required<EditionDefinition>;
export function validLonLat(longitude:unknown,latitude:unknown):boolean;
export function coordinateFingerprint(row:Pick<NormalizedRecord,'originalGeometry'|'spatialReference'>):string;
export function locate(row:Pick<NormalizedRecord,'originalGeometry'|'spatialReference'>,interpretation?:CoordinateInterpretation):Location;
export function buildEdition(input:EditionDefinition,requests:Source,orders:Source|null,profile:Profile,identity:Identity):Edition;
export function editionSummary(edition:Edition):EditionSummary;
export function requestRow(edition:Edition,key:string):NormalizedRequest;
export function orderRow(edition:Edition,key:string):NormalizedOrder;
export function createLink(edition:Edition,input:LinkInput,identity:Identity):Link;
export function effectiveLinks(edition:Edition,request:NormalizedRequest,links:Link[]):LinkView[];
export function currentWork(edition:Edition,key:string,work:Work[]):Work|null;
export function normalizeWorkInput(input:WorkInput):Required<WorkInput>;
export function createWork(edition:Edition,input:WorkInput,identity:Identity,context?:{previous?:Work|null;links?:Link[]}):Work;
export function workView(value:Work|null,request:NormalizedRequest,edition:Edition):WorkView|null;
export function projectRequest(edition:Edition,profile:Profile,request:NormalizedRequest,context?:Context):RequestView;
export function compareEditions(before:Edition,after:Edition,options?:{entity?:'requests'|'orders';sourceMetadataFields?:string[]}):Changes;
export function workEditable(work:Required<WorkInput>):Record<string,JSONValue>;
export function reviewTemplate(edition:Edition,profile:Profile,context?:Context):ReviewerTemplate;
export function createReturn(originalText:string,base:Edition,profile:Profile,context:Context,identity:Identity):ReviewerReturn;
export function proposalConflicts(proposal:Proposal,edition:Edition,context?:Context):JsonObject[];
export function applyReview(returned:ReviewerReturn,edition:Edition,input:DecisionSelection,identity:Identity,context:Context):{decision:ReviewDecision;links:Link[];work:Work[]};
export function returnSummary(value:ReviewerReturn,decisions?:ReviewDecision[]):ReturnSummary;
export function workSummary(value:Work):WorkSummary;
export function createDispatch(edition:Edition,input:DispatchDefinition,identity:Identity,context?:Context):Dispatch;
export function dispatchSummary(value:Dispatch):DispatchSummary;
export {openWorkspace,receiveWorkspace,validateWorkspacePackage,WORKSPACE_SCHEMA} from './workspace.mjs';
export type {FollowThroughWorkspace} from './workspace.mjs';
export {serveFollowThrough,startFollowThroughServer,workspaceBinding,STARTUP_SCHEMA,BINDING_SCHEMA} from './server.mjs';
