/** MIT. Explicit original-position SensorThings component analysis. */
export type ComponentSourceIdentity =
 | {kind:'native-edition';id:string}
 | {kind:'received-originals';manifestSha256:string;[key:string]:unknown};
export interface ComponentSourceRef {sha256:string;url:string;jsonPointer:string;[key:string]:unknown}
export interface ComponentEntityId {type:'string'|'number';value:string;key?:string}
export interface ComponentSourceEntity {entity:Record<string,unknown>;sourceJson:string;sourceRef:ComponentSourceRef}
export interface ComponentUnit {name:string|null;symbol:string|null;definition:string|null;[key:string]:unknown}
export interface ComponentInterpretation {
 mode:'source-declared'|'numeric-json';
 acknowledgedIssues:string[];
 note:string;
}
export interface ComponentChoice {streamKey:string;index:number;bindingId:string;interpretation:ComponentInterpretation}
export interface ComponentSelectionInput {
 streamKeys:string[];
 componentSelections:ComponentChoice[];
 period:null|{start:string;end:string};
 view:'events'|'numeric'|'map';
 timeBasis?:'phenomenonTime';
 viewerId?:string|null;
}
export interface ComponentSelection extends Omit<ComponentSelectionInput,'period'|'timeBasis'|'viewerId'> {
 period:null|{start:string;end:string;startUtc:string;endUtc:string};
 timeBasis:'phenomenonTime';
 viewerId:string|null;
 intervalPolicy:'source-explicit-only';
 instantPolicy:'events-only';
 unresolvedTimePolicy:'retain-unplaced';
 componentPolicy:'explicit-original-position';
}
export interface ComponentDescriptor {
 index:number;bindingId:string;meaningId:string;seriesKey:string;name:string;
 property:ComponentSourceEntity|null;
 /** The original declaration can be malformed; unitJson preserves its exact JSON. */
 unit:unknown;unitState:string;unitJson:string|null;
 declaredType:unknown;declaredTypeState:string;declaredTypeRecognized:boolean;numericTypeDeclared:boolean;
 metadataAligned:boolean;declaredComponentCount:number;sourceRef:ComponentSourceRef;issues:string[];
 binding:Record<string,unknown>;
}
export interface ComponentStream {
 sourceIdentity:ComponentSourceIdentity;streamKey:string;streamId:ComponentEntityId;
 sourceRef:ComponentSourceRef;sourceJson:string;name:string;description:string;
 observationType:{state:string;type:string;value:string};
 metadataCounts:{properties:number;units:number;types:number};
 metadataAligned:boolean;duplicatePropertyIdsRetained:boolean;issues:string[];components:ComponentDescriptor[];
 kind?:'MultiDatastreams';things?:ComponentSourceEntity[];sensors?:ComponentSourceEntity[];locations?:ComponentSourceEntity[];
}
export interface ComponentCatalogue {
 schema:'stellar-forge.sensorthings-component-catalogue.v1';editionId:string;streams:ComponentStream[];
 sourceScope:unknown;sourceIssues:unknown;license:unknown;meaning:typeof COMPONENT_MEANING;
}
export interface RetainedComponentEdition {
 id:string;plan:{streams:Array<{key:string;kind:string;id:ComponentEntityId;[key:string]:unknown}>};
 pages:Array<{kind:string;[key:string]:unknown}>;scope:unknown;issues:unknown;source:{license:unknown;[key:string]:unknown};
 [key:string]:unknown;
}
export interface ComponentSourceStore {object(sha256:string,...args:unknown[]):Promise<Uint8Array>}
export interface ComponentDomainObservation {
 row:Record<string,string>;
 original:{key:string|null;occurrenceId:string;semanticHash:string;sourceRef:ComponentSourceRef;[key:string]:unknown};
 [key:string]:unknown;
}
export interface ComponentProjectedObservation extends ComponentDomainObservation {
 streamKey:string;sourceStreamKey:string;
 component:{choice:ComponentChoice;descriptor:ComponentDescriptor};
 sourceStream:ComponentStream;
 original:ComponentDomainObservation['original'] & {
  observationKey:string|null;parentSemanticHash:string;componentSourceRef:ComponentSourceRef;
  componentOccurrenceId:string;componentPointerState:'present'|'missing'|'parent_not_array'|'result_missing';
 };
}
export type ComponentEligibility =
 | {eligible:false;reason:string}
 | {eligible:true;reason:null;basis:string;sourceDeclarationRewritten:false;representation?:'bounded-exact-decimal';exponentBound?:4096};
export interface ComponentExtreme {
 lexeme:string;sourceRef:ComponentSourceRef;observationId:string;observationIdType:string;
 observationOccurrenceId:string;componentIndex:number;componentOccurrenceId:string;phenomenonTime:string;
}
export interface ComponentNumericSummary {
 count:number;sumExact:string|null;
 mean:null|{exactNumerator:string;exactDenominator:string;decimal:string;decimalPlaces:12;rounding:'half-even';meaning:string};
 minimum:ComponentExtreme|null;maximum:ComponentExtreme|null;rangeExact:string|null;
 continuousDuration:null;timeWeightedMean:null;unitConversion:null;
}
export interface ComponentDayStatistics {
 day:string;events:number;qualityStates:Record<string,number>;missingResults:number;numericSummary:ComponentNumericSummary;
}
export interface ComponentStatistics {
 rows:number;resultStates:Record<string,number>;resultTypes:Record<string,number>;
 timeKinds:Record<string,number>;qualityStates:Record<string,number>;
 numericEligibleRows:number;numericExcludedRows:number;numericExclusionReasons:Record<string,number>;
 browserNumericEligibleRows:number;browserNumericExcludedRows:number;browserNumericExclusionReasons:Record<string,number>;
 exactNumericEligibleRows:number;exactNumericExcludedRows:number;exactNumericExclusionReasons:Record<string,number>;
 numericEligibilityMeaning:{numericEligibleRows:string;exactNumericEligibleRows:string};
 declarationIssueCounts:Record<string,number>;rowIssueCounts:Record<string,number>;numericSummary:ComponentNumericSummary;
 firstUtc:string|null;lastUtc:string|null;instantEvents:number;explicitIntervals:number;unplacedOccurrences:number;
 distinctObservationKeys:number;duplicateObservationKeys:number;changedDuplicateKeys:number;distinctComponentOccurrences:number;
 timeline:{distinctInstantTimes:number;duplicateInstantTimes:number;
  duplicateInstants:Array<{utc:string;count:number}>;
  adjacentGaps:Array<{fromUtc:string;toUtc:string;seconds:string;leftOccurrences:number;rightOccurrences:number}>;
  detailLimit:10000;omittedDuplicateInstants:number;omittedAdjacentGaps:number;adjacentGapSeconds:Array<{seconds:string;count:number}>;
  largestAdjacentGap:null|{fromUtc:string;toUtc:string;seconds:string};continuousCoverage:null;expectedSampleCount:null;interpolation:null;meaning:string};
 days:ComponentDayStatistics[];[key:string]:unknown;
}
/** Opaque mutable exact-decimal accumulator. Pass only to the paired accumulation/finish functions. */
export interface ComponentStatisticsAccumulator {readonly __componentStatisticsAccumulator?:never}
export interface ComponentSummary {
 schema:'stellar-forge.sensorthings-analysis-summary.v1';analysisKind:'explicit-multidatastream-components';
 editionId:string;selection:ComponentSelection;catalogue:ComponentCatalogue;sourceScope:unknown;sourceIssues:unknown;license:unknown;
 totalOccurrences:number;distinctObservationKeys:number;duplicateObservationKeys:number;changedDuplicateKeys:number;
 instantEvents:number;explicitIntervals:number;unplacedOccurrences:number;
 streams:Array<ComponentStatistics & {key:string;sourceStreamKey:string;id:ComponentEntityId;name:string;kind:'MultiDatastreamComponent';
  componentIndex:number;componentName:string;componentBindingId:string;componentMeaningId:string;
  component:ComponentDescriptor;interpretation:ComponentInterpretation;[key:string]:unknown}>;
 meaning:typeof COMPONENT_MEANING;
}
export const COMPONENT_SCHEMA:'stellar-forge.sensorthings-component-selection.v1';
export const COMPONENT_LIMITS:Readonly<{selections:80;index:4095;rows:250000;pageRows:500;inventoryValues:200}>;
export const COMPONENT_OM_TYPES:readonly string[];
export const COMPONENT_MEANING:Readonly<Record<'positions'|'interpretation'|'numbers'|'time'|'quality'|'identity'|'comparison'|'standards',string>>;
export const COMPONENT_COLUMNS:readonly string[];
export function bindComponentMetadata(input:{sourceIdentity:ComponentSourceIdentity;streamKey:string;streamId:ComponentEntityId;
 streamRecord:Record<string,unknown>;streamSourceRef:ComponentSourceRef;
 observedProperties:Array<{record:Record<string,unknown>;sourceRef:ComponentSourceRef}>}):ComponentStream;
export function componentCatalog(store:ComponentSourceStore,edition:RetainedComponentEdition,
 options?:{streamKeys?:string[]|null;graph?:unknown|null}):Promise<ComponentCatalogue>;
export function normalizeComponentSelection(input:ComponentSelectionInput,edition:RetainedComponentEdition):ComponentSelection;
export function validateComponentChoice(choice:ComponentChoice,descriptor:ComponentDescriptor):ComponentDescriptor;
export function validateComponentBindings(store:ComponentSourceStore,edition:RetainedComponentEdition,selection:ComponentSelection,
 options?:{graph?:unknown|null}):Promise<{catalogue:ComponentCatalogue;bound:Array<{choice:ComponentChoice;descriptor:ComponentDescriptor;stream:ComponentStream}>}>;
export function projectComponentRow(value:ComponentDomainObservation,context:{choice:ComponentChoice;descriptor:ComponentDescriptor;stream:ComponentStream}):ComponentProjectedObservation;
/** Browser eligibility never controls exact decimal sample totals. */
export function componentNumericEligibility(row:Record<string,string>):ComponentEligibility;
export function componentExactEligibility(row:Record<string,string>):ComponentEligibility;
export function selectedComponentRows(store:ComponentSourceStore,edition:RetainedComponentEdition,selection:ComponentSelection):AsyncGenerator<ComponentProjectedObservation>;
export function createComponentStatistics():ComponentStatisticsAccumulator;
export function accumulateComponentStatistics(statistics:ComponentStatisticsAccumulator,value:ComponentProjectedObservation):void;
export function finishComponentStatistics(statistics:ComponentStatisticsAccumulator):ComponentStatistics;
export function describeComponentSelection(store:ComponentSourceStore,edition:RetainedComponentEdition,selection:ComponentSelection):Promise<ComponentSummary>;
export function componentRowsPage(store:ComponentSourceStore,edition:RetainedComponentEdition,selection:ComponentSelection,
 options?:{offset?:number;limit?:number}):Promise<{editionId:string;selection:ComponentSelection;columns:string[];
 rows:Array<Record<string,unknown> & {numeric:ComponentEligibility;exactNumeric:ComponentEligibility}>;total:number;offset:number;nextOffset:number|null}>;
export function componentCSVHeader():string;
export function componentCSVRow(value:ComponentProjectedObservation):string;
export function componentCSV(store:ComponentSourceStore,edition:RetainedComponentEdition,selection:ComponentSelection):AsyncGenerator<string>;
export function compareComponentSelection(store:ComponentSourceStore,left:RetainedComponentEdition,right:RetainedComponentEdition,selection:ComponentSelection):
 Promise<{schema:'stellar-forge.sensorthings-analysis-comparison.v1';analysisKind:'explicit-multidatastream-components';
 leftEditionId:string;rightEditionId:string;selection:ComponentSelection;rightSelection:ComponentSelection;
 rightSelectionStatus:'comparison_only_not_an_accepted_revision';counts:Record<string,number>;changes:unknown[];
 parentContextChanges:unknown[];unkeyed:unknown[];componentMetadata:unknown[];sourceContext:unknown;meaning:typeof COMPONENT_MEANING}>;
