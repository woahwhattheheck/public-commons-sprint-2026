/// <reference types="node" />
/** MIT. Exact local OECD analyst/customer interface. */
export type Identity = string;
export interface Flow { agency_id: string; id: string; version: string; names?: Array<{lang: string; text: string}> }
export interface SourceMember { name: string; kind: 'data'|'structure'|'catalog'; origin: string; sha256: Identity; bytes?: number; content_base64: string; receipt?: Record<string, unknown> }
export interface SourceBundle { schema: 'stellar-forge.oecd-source-bundle.v1'; operation_id: string; label: string; files: SourceMember[] }
export interface Capture {
  schema: 'stellar-forge.oecd-capture.v1'; id: Identity; operation_id: string; label: string;
  data_source_id: Identity; metadata_source_ids: Identity[]; flow: Flow; metadata_sha256: Identity;
  series: Array<{country: string; series_key: string; dimensions: Record<string,string>; observations: number}>;
  sources: Array<{id: Identity; sha256: Identity; name: string; bytes: number; origin: string; kind: string}>;
  created_at: string;
}
export interface Selection {
  operation_id: string; capture_id: Identity; countries?: string[]; start_period?: string; end_period?: string|null;
  title?: string; notes?: string; project_id?: Identity|null; expected_revision?: number|null;
}
export interface Observation {
  country: string; time_period: string; value: string|null; value_present: boolean;
  value_kind: 'absent'|'nil'|'empty'|'literal'; numeric_value: string|null;
  attributes: Record<string,string>; dimensions: Record<string,string>; action: string;
}
export interface SummaryPoint {
  period: string; value: string; numeric_value: string; distance_from_100: string;
  changes: Record<'1'|'3'|'12',{from_period: string; from_value: string|null; index_point_change: string|null}>;
  status?: string|null; attributes: Record<string,string>;
}
export interface SeriesReport {
  country: string; country_name: string; series_id: string; series_key: string;
  observations: Observation[]; dimensions: Record<string,string>; dimension_labels: Record<string,string>;
  unit: string; unit_multiplier: string; declared_decimals: string[];
  native_observation_count: number; missing_periods: string[]; missing_value_periods: string[];
  first_period: string; last_period: string; latest: SummaryPoint|null; common: SummaryPoint|null;
}
export interface BriefingDocument {
  schema: 'stellar-forge.oecd-briefing-document.v1'; id: Identity; title: string; notes: string;
  request: Selection; catalog_edition_id: Identity; source_capture_id: Identity;
  native_snapshot: string; source_project_id: Identity; source_project_revision: number;
  observation_count: number; native_observation_count: number; common_period: string|null;
  report_window: {start: string; end: string|null}; series: SeriesReport[];
  sources: Array<{sha256: Identity; bytes: number; name: string; origin: string; kind: string; coverage: Record<string,unknown>}>;
  methodology: {title: string; interpretation: string; comparison: string; sources: Array<{title: string; url: string}>};
  scope: string;
}
export interface Briefing {
  schema: 'stellar-forge.oecd-briefing.v1'; id: Identity; operation_id: string; title: string;
  capture_id: Identity; project_id: Identity; project_revision: number; native_snapshot: string;
  catalog_edition_id: Identity; selection: Selection; observation_count: number; series_count: number;
  common_period: string|null; created_at: string;
  report: {directory: string; files: Record<string,{sha256: Identity; bytes: number}>};
}
export interface ProviderConnection {provider_url: string; authentication: 'Basic'; enabled: boolean; username?: string|null}
export interface CatalogState {
  schema: string; revision: number; current: Identity|null;
  editions: unknown[]; publications: unknown[]; source_state: unknown;
}
export interface OecdState {
  schema: 'stellar-forge.oecd-workspace.v1'; project: {id: Identity; created_at: string; directory: string};
  captures: Capture[]; briefings: Briefing[]; catalog: CatalogState; connection?: ProviderConnection;
  profile: {flow: Flow; basis: Record<string,string>; default_countries: string[]};
}
export interface Connection {
  schema: 'stellar-forge.oecd-connection.v1'; project_id: Identity; project_directory: string;
  base_url: string; url: string; token: string; provider: ProviderConnection;
}
export interface Download { body: Buffer; contentType: string|null; contentDisposition: string|null }
export interface Client {
  readonly baseUrl: string;
  state(): Promise<OecdState>;
  seed(body?: {operation_id?: string}): Promise<Capture>;
  capture(body: SourceBundle): Promise<Capture>;
  refresh(body: {operation_id: string; capture_id: Identity; start_period?: string; end_period?: string|null; label?: string}): Promise<Capture>;
  preview(body: Selection): Promise<{request: Selection; capture: Capture; selection: {series_keys: string[]}; source_observations: number}>;
  save(body: Selection): Promise<Briefing>;
  briefing(id: Identity): Promise<Briefing & {document: BriefingDocument}>;
  sourceRows(id: Identity): Promise<{briefing_id: Identity; catalog_edition_id: Identity; snapshot: string; rows: Array<{flow: string; series_key: string; time_period: string; value: string|null; value_present: boolean; value_kind: string; attributes: Record<string,string>; dimensions: Record<string,string>; action: string; date: string}>; row_count: number}>;
  compare(before: Identity, after: Identity): Promise<{before: Identity; after: Identity; report_changes: Array<{country: string; time_period: string; kind: 'added'|'removed'|'revised'; before: Observation|null; after: Observation|null}>; native_catalog_comparison: unknown; comparison_scope: string}>;
  activate(body: {briefing_id: Identity; expected_revision: number; expected_current: Identity|null}): Promise<CatalogState>;
  exportDataset(briefingId: Identity): Promise<{briefing_id: Identity; directory: string; native: unknown; project_id: Identity; revision: number}>;
  exportCustomer(briefingId: Identity): Promise<Download>;
  exportProject(briefingId: Identity): Promise<Download>;
  importProject(body: Uint8Array): Promise<Briefing>;
  reportFile(briefingId: Identity, name: 'briefing.html'|'briefing.json'|'observations.csv'): Promise<Download>;
  provider(command: 'getcapabilities'|'loadseries'|'loadmeta'|'searchseries'|'loadtree'|'listseries', parameters?: Record<string,string|number|string[]>): Promise<unknown>;
}
export const OECD_CONNECTION_SCHEMA: 'stellar-forge.oecd-connection.v1';
export function readOecdConnection(path: string): Promise<Connection>;
export function createOecdClient(config: {baseUrl: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number}): Client;
export function launchOecd(options: {
  projectDirectory: string; create?: boolean; port?: number; pythonCommand?: string; pythonArguments?: string[];
  providerUsernameEnv?: string; providerPasswordEnv?: string; startupTimeoutMs?: number;
  stderr?: NodeJS.WritableStream|null; env?: NodeJS.ProcessEnv;
}): Promise<{connection: Connection; client: Client; child: import('node:child_process').ChildProcess;
  closed: Promise<{code: number|null; signal: NodeJS.Signals|null}>;
  close(): Promise<{code: number|null; signal: NodeJS.Signals|null}>}>;
