export const TASK_DESK_INSTALLATION_SCHEMA: 'stellar-forge.task-desk-installation.v1';
export interface TaskDeskInstallationSettings {
 nativeRuntimeDirectory:string;
 stateDirectory:string;
 inboxDirectory:string;
 tasksDirectory:string;
 outputsDirectory:string;
 customerDeliveryDirectory:string;
 existingTaskDirectory?:string;
 existingOutputDirectory?:string;
 workspaceDirectory?:string;
 commerceDirectory?:string;
 port?:number;
}
export interface TaskDeskInstallationSelection {
 schema:typeof TASK_DESK_INSTALLATION_SCHEMA;
 id:string;
 label:string;
 /** Complete READY directory returned by the original runtime installer. */
 runtimeDirectory:string;
 /** Original 24-hex runtime record ID, required when submitting Applications review. */
 runtimeId?:string;
 settings:TaskDeskInstallationSettings;
 /** Required when the original task/output pair is selected. */
 expectedTaskSha256?:string;
 maxFileBytes?:number;
}
export interface TaskDeskInstallationRuntime {
 directory:string;installationId:string;profileId:string;profileSha256:string;lockSha256:string;
 sourceCommit:string;sourceManifestSha256:string;
}
export interface TaskDeskInstallationInput {
 path:string;kind:'file'|'directory';exists:boolean;parent?:string;
 dev?:number;ino?:number;bytes?:number;mtimeMs?:number;ctimeMs?:number;sha256?:string;
}
export interface TaskDeskInstallationInspection {
 schema:'stellar-forge.task-desk-installation-preparation.v1';
 selection:TaskDeskInstallationSelection;
 selectionSha256:string;
 runtime:TaskDeskInstallationRuntime;
 sourceRoot:string;
 roots:{inbox:string;tasks:string;outputs:string;customerDelivery:string;existingTask?:string;existingOutput?:string;commerce?:string};
 command:{name:'buyer-task-desk';entrypoint:string;args:string[]};
 inputs:TaskDeskInstallationInput[];
 createDirectories:string[];
 resourceKeys:string[];
 retainedTask:null|{taskSha256:string;taskDirectory:string;outputDirectory:string;
  mode:'original-receiving'|'delivered-packet';receiveAllowed:boolean};
 application:{kind:'buyer-task-desk';providerId:'buyer-task-desk';label:string;runtimeId?:string;settings:TaskDeskInstallationSettings};
 actionsStarted:0;
}
export interface TaskDeskInstallationOutput {path:string;bytes:number;sha256:string}
export interface PreparedTaskDeskInstallation {
 directory:string;selectionSha256:string;runtime:TaskDeskInstallationRuntime;
 retainedTask:TaskDeskInstallationInspection['retainedTask'];
 applicationRuntimeIdRequired:boolean;outputs:TaskDeskInstallationOutput[];actionsStarted:0;
}
export interface LaunchedTaskDeskInstallation {
 directory:string;connectionFile:string;
 announcement:{schema:'stellar-forge.inbox-task-desk-launch.v1';url:string;instanceId:string}&TaskDeskInstallationInspection['roots'];
 /** Waits for the original desk's accepted commands before releasing this foreground owner. */
 close():Promise<void>;
}
export function inspectTaskDeskInstallation(input:TaskDeskInstallationSelection):Promise<TaskDeskInstallationInspection>;
export function prepareTaskDeskInstallation(input:{selection:TaskDeskInstallationSelection;directory:string}):Promise<PreparedTaskDeskInstallation>;
export function readTaskDeskInstallation(directory:string):Promise<TaskDeskInstallationInspection&{preparedInputs:TaskDeskInstallationInput[]}>;
export function connectTaskDeskInstallation(input:{directory:string;connectionFile:string;output:string}):Promise<TaskDeskInstallationOutput&{
 instanceId:string;bindingSha256:string;roots:TaskDeskInstallationInspection['roots']}>;
export function launchTaskDeskInstallation(input:{directory:string}):Promise<LaunchedTaskDeskInstallation>;
export function main(argv?:string[]):Promise<PreparedTaskDeskInstallation|TaskDeskInstallationInspection|LaunchedTaskDeskInstallation|TaskDeskInstallationOutput|null>;
