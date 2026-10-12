/** MIT. Complete retained-original component reporting. */
import type {ComponentDescriptor,ComponentSourceRef,ComponentStatistics,ComponentInterpretation,ComponentEligibility} from './components.mjs';
export interface ComponentReportEvent {
 time:string|null;endTime:string|null;timeLiteral:string;timeKind:string;timeState:string;
 resultTime:string;resultTimeState:string;validTime:string;validTimeState:string;
 quality:string;qualityState:string;sourceResult:string;sourceResultState:string;sourceResultType:string;
 value:string;state:string;type:string;numericEligibility:ComponentEligibility;exactNumericEligibility:ComponentEligibility;
 aligned:string;sourceRef:ComponentSourceRef;observationId:string;observationIdType:string;componentIndex:number;occurrenceId:string;
}
export interface ComponentReportStream {
 sourceStreamKey:string;seriesKey:string;index:number;name:string;bindingId:string;meaningId:string;
 unit:unknown;property:unknown;declaredType:unknown;interpretation:ComponentInterpretation;statistics:ComponentStatistics;plot:ComponentReportEvent[];
}
export interface ComponentTimeEvent {
 observationId:string;observationIdType:string;sourceResult:string;sourceRef:ComponentSourceRef;[key:string]:unknown;
}
export interface ComponentReportGap {from:string;to:string;seconds:string;fromEvents:ComponentTimeEvent[];toEvents:ComponentTimeEvent[]}
export interface ComponentSourceReport {
 schema:'stellar-forge.sensorthings-component-source-report.v1';
 sourceManifest:{filename:string;bytes:number;sha256:string};
 sourcePlan:{window:{start:string;endExclusive:string};[key:string]:unknown};
 timeAudit:{distinctInstants:number;duplicateInstants:Array<{time:string;events:ComponentTimeEvent[]}>;
  adjacentGaps:ComponentReportGap[];maximumGapSeconds:string|null;maximumGaps:ComponentReportGap[];[key:string]:unknown};
 descriptor:{components:ComponentDescriptor[];[key:string]:unknown};
 streams:ComponentReportStream[];paging:{pages:Array<Record<string,unknown>>;[key:string]:unknown};[key:string]:unknown;
}
export interface ComponentFigure {filename:string;svg:string;points:number}
export function componentEventFigure(stream:ComponentReportStream,window:{start:string;endExclusive:string},
 options?:{width?:number;height?:number}):ComponentFigure;
export function componentEventsCSV(report:ComponentSourceReport):string;
export function componentDailyCSV(report:ComponentSourceReport):string;
export function componentDuplicateTimesCSV(report:ComponentSourceReport):string;
export function componentGapsCSV(report:ComponentSourceReport):string;
export function renderComponentSourceReport(report:ComponentSourceReport):{
 html:string;componentCSV:string;dailyCSV:string;duplicateTimesCSV:string;gapsCSV:string;figures:ComponentFigure[];
};
