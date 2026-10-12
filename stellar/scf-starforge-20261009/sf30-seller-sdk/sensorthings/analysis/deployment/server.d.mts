/** MIT. Native deployment over the original retained SensorThings workspace. */
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AnalysisVersion,AnalysisSummary,AnalysisSelection} from '../types.mjs';
import type {Sha256,WorkspaceId,NativeObject,SourceIssue,SourceLicense,EditionScope} from '../../mcp.mjs';

export type NativeView = 'map' | 'numeric';
export interface ObjectDescriptor { bytes:number; sha256:Sha256; }
export interface OriginalViewerFile extends ObjectDescriptor { path:string; }
export interface InstalledViewer extends NativeObject {
  id:Sha256;
  schema:'stellar-forge.sensorthings-analysis-viewer.v1';
  upstream:NativeObject & {filename:string};
  archive:ObjectDescriptor;
  files:OriginalViewerFile[];
  upstreamSources:(OriginalViewerFile & NativeObject)[];
  prefix:string;
  indexPath:string;
  settingsPath:string;
  expandedBytes:number;
  derivation:string;
}
export interface ViewerIssue { code:string; message:string; }
export interface NativeMetadataAssessment {
  /** Older saved summaries may not contain the additive native metadata check. */
  checked:boolean;
  compatible:boolean | null;
  issues:(NativeObject & {streamKey:Sha256})[];
  meaning:string;
}
export interface NativeViewAvailability {
  /** Configuration eligibility; this read is not evidence of native rendering. */
  available:boolean;
  metadata:NativeMetadataAssessment;
  issue:ViewerIssue | null;
  numericEligibleRows?:number;
  streams?:number;
  meaning?:string;
}
export interface NativeViewNavigation {
  schema:'stellar-forge.sensorthings-native-view-navigation.v1';
  applied:boolean;
  datasets:{streamKey:Sha256;id:NativeObject;clientId:string;internalId:string}[];
  period:null|{basis:'saved_selection_period'|'saved_source_summary_extent';fromUtc:string;toUtc:string;
    fromEpochMs:number;toEpochMs:number;precision:'millisecond';singleInstantDisplayWidthMs:0|1;meaning:string};
  query:null|{ids:string;time:string};
  issue:ViewerIssue|null;
  source:{permalink:string;internalId:string};
  meaning:string;
}
export interface AnalysisDeployment {
  /** Canonical identity of this exact runtime-derived descriptor without id. */
  id:Sha256;
  schema:'stellar-forge.sensorthings-analysis-deployment.v1';
  workspaceId:WorkspaceId;
  origin:string;
  viewerId:Sha256;
  versionId:Sha256;
  projectId:string;
  editionId:Sha256;
  mode:NativeView;
  selection:AnalysisSelection;
  paths:{
    base:string;entry:string;settings:string;metadata:string;sta:string;bridge:string;
  };
  availability:{
    map:NativeViewAvailability;numeric:NativeViewAvailability;selected:NativeViewAvailability;
  };
  nativeNavigation:NativeViewNavigation;
  original:{
    viewerId:Sha256;
    archive:ObjectDescriptor;
    index:OriginalViewerFile;
    settings:OriginalViewerFile;
    upstream:NativeObject;
    upstreamSources:(OriginalViewerFile & NativeObject)[];
  };
  derived:{
    index:ObjectDescriptor;
    settings:ObjectDescriptor;
    bridge:ObjectDescriptor & {path:string};
  };
  sourceScope:EditionScope;
  sourceIssues:SourceIssue[];
  license:SourceLicense;
  connection:string;
  derivation:string;
}
/** A structural read interface satisfied by the existing owned Workbench. */
export interface AnalysisDeploymentWorkspace {
  schema():{workspaceId:WorkspaceId};
  store:{object(sha256:Sha256):Promise<Buffer>};
  analysis:{
    viewer(id:Sha256):Promise<InstalledViewer>;
    version(id:Sha256):Promise<AnalysisVersion>;
    summary(id:Sha256):Promise<AnalysisSummary>;
  };
}
export interface DeploymentRequestContext {
  url:URL;
  workspaceId:WorkspaceId;
}
export interface AnalysisDeploymentHandler {
  /** Mounted before the maintained Desk static fallback. */
  staticHandler(request:IncomingMessage,response:ServerResponse,context:DeploymentRequestContext):Promise<boolean>;
  /** Invoked only after the original Bearer and workspace-header validation. */
  handleApi(request:IncomingMessage,response:ServerResponse,context:DeploymentRequestContext):Promise<boolean>;
  /** Drains only these reads, without closing the existing store or listener. */
  close():Promise<void>;
}
export function createAnalysisDeployment(options:{
  workspace:AnalysisDeploymentWorkspace;origin:string;
}):AnalysisDeploymentHandler;
