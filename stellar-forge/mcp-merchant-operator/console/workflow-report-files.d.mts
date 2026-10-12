import type {
  ReportExports, ReportSelection, WorkflowReportPacket
} from './workflow-report-client.mjs';
export type {
  Digest, ReportArchive, ReportDifference, ReportExports, ReportFile,
  ReportSelection, SavedReportSelection, WorkflowReport, WorkflowReportPacket
} from './workflow-report-client.mjs';

export declare const WORKFLOW_REPORT_FILES:
  readonly ['report.json', 'report.html', 'steps.csv', 'changes.csv'];
export declare function workflowReportDirectory(directory: string, options?: { create?: boolean }): Promise<string>;
export declare function readWorkflowReportFile(path: string): Promise<WorkflowReportPacket>;
export declare function writeWorkflowReportExports(input: {
  directory: string; packet: WorkflowReportPacket;
}): Promise<ReportExports>;
export declare function reopenWorkflowReportExports(input: { directory: string }): Promise<ReportExports>;
export declare function captureWorkflowReport(
  client: { build(selection: ReportSelection): Promise<WorkflowReportPacket> },
  input: ReportSelection & { directory: string }
): Promise<ReportExports>;
