import type {JobWorkspace,startJobCustomerWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.mjs';
import type {DocumentProviderId} from './index.mjs';
import type {DocumentCompositionWorkspace} from './composition-workspace.mjs';

export const DOCUMENT_COMPOSITION_SERVICE_SELECTION_SCHEMA:'stellar-forge.document-composition-service-selection.v1';
export const DOCUMENT_COMPOSITION_SERVICE_LAUNCH_SCHEMA:'stellar-forge.document-composition-service-launch.v1';
export const DOCUMENT_COMPOSITION_SERVICE_SOURCE:'products/document-merchant';
export const DOCUMENT_COMPOSITION_SERVICE_SOURCE_FILES:readonly string[];
export interface DocumentCompositionServiceOptions {
  /** Complete private original customer JSON, including its nested checkout selection. */
  workspaceOptionsFile:string;
  sourceRoot?:string|null;
  provider?:DocumentProviderId;
  merchantOrigin?:string|null;
  /** Environment name only; its private value is resolved when the service opens. */
  intakeKeyEnvironment?:string|null;
  deadlineMs?:number;pollMs?:number;port?:number;
}
export interface NormalizedDocumentCompositionServiceOptions {
  workspaceOptionsFile:string;sourceRoot:string|null;provider:DocumentProviderId;
  merchantOrigin:string|null;intakeKeyEnvironment:string|null;
  deadlineMs:number;pollMs:number;port:number;
}
export interface DocumentCompositionServiceFile {path:string;bytes:number;sha256:string}
export type DocumentCompositionServiceOperator=
  |{kind:'workspace';directory:string;runtimeDirectory:string}
  |{kind:'profile';path:string;runtimeDirectory:string};
export interface DocumentCompositionServiceCustomer {
  directory:string;runtimeDirectory:string;operatorSelection:DocumentCompositionServiceOperator;
}
export interface DocumentCompositionServiceSelection {
  schema:typeof DOCUMENT_COMPOSITION_SERVICE_SELECTION_SCHEMA;sourceDirectory:string;
  options:NormalizedDocumentCompositionServiceOptions;
  customer:DocumentCompositionServiceCustomer;sourceRoot:string;
  sourceFiles:DocumentCompositionServiceFile[];nativeFiles:DocumentCompositionServiceFile[];
  configurationFiles:DocumentCompositionServiceFile[];selectionSha256:string;
}
export interface DocumentCompositionServiceAnnouncement {
  schema:typeof DOCUMENT_COMPOSITION_SERVICE_LAUNCH_SCHEMA;state:'LISTENING';
  selectionSha256:string;directory:string;runtimeDirectory:string;
  operatorSelection:DocumentCompositionServiceOperator;pid:number;instanceId:string;
  privateLaunch:string;sourceRoot:string;documentUrl:string;agentUrl:string;customerUrl:string;
  checkoutUrl:string;jobsUrl:string;collectionsUrl:string;libraryUrl:string;resolutionUrl:string;
}
export type DocumentCompositionCustomerHost=Awaited<ReturnType<typeof startJobCustomerWorkspace>>;
export interface DocumentCompositionService {
  readonly workspace:JobWorkspace;readonly controller:DocumentCompositionWorkspace;
  readonly host:DocumentCompositionCustomerHost;readonly selection:DocumentCompositionServiceSelection;
  readonly announcement:DocumentCompositionServiceAnnouncement;
  readonly documentUrl:string;readonly privateLaunch:string;
  readonly launch:DocumentCompositionCustomerHost['launch'];
  /** Settles after host admission, extension work and the original customer have drained. */
  readonly closed:Promise<void>;
  close():Promise<void>;
}
export function normalizeDocumentCompositionServiceOptions(value:DocumentCompositionServiceOptions):NormalizedDocumentCompositionServiceOptions;
export function readDocumentCompositionServiceSelection(options:DocumentCompositionServiceOptions):Promise<DocumentCompositionServiceSelection>;
export function assertDocumentCompositionServiceSelection(value:unknown,expectedSha256?:string):DocumentCompositionServiceSelection;
export function assertDocumentCompositionServiceSource(launchSourceDirectory?:string):Promise<{
  sourceDirectory:string;launchSourceDirectory:string;files:DocumentCompositionServiceFile[];
}>;
export function openDocumentCompositionService(options:DocumentCompositionServiceOptions,context?:{
  environment?:Record<string,string|undefined>;signal?:AbortSignal;
  expectedSelection?:string;launchSourceDirectory?:string;
}):Promise<DocumentCompositionService>;
export function readDocumentCompositionServiceLaunch(input:{
  options:DocumentCompositionServiceOptions;expectedSelection?:string;
  expected?:{pid?:number;instanceId?:string;documentUrl?:string};
}):Promise<{
  selection:DocumentCompositionServiceSelection;launch:DocumentCompositionCustomerHost['launch'];
  announcement:DocumentCompositionServiceAnnouncement;documentUrl:string;
}>;
