import type {GrantWorkspaceClient} from './agent-client.mjs';
import type {InstallationSourceCollectionAgent,InstallationSourceCollectionWorkingCopy,InstallationSourceCollectionContext,
 SourceCollectionStaffContext,InstallationSourceCollectionInspection,InstallationSourceCollectionReconciled,
 SourceCollectionOriginal,SourceCollectionEdit,SourceCollectionExistingSelection} from './installation-source-collection-agent.mjs';
import type {InstallationSourceCollectionStore} from './installation-source-collection-store.mjs';
export const SOURCE_COLLECTION_ACTIONS:Readonly<Record<'start'|'stage'|'edit'|'use_existing'|'clear_existing'|'review'|'receive'|'reconcile'|'retire_rejected'|'refresh',string>>;
export interface InstallationSourceCollectionSession {agent:InstallationSourceCollectionAgent;store:InstallationSourceCollectionStore}
export interface SourceCollectionSessionOptions {
 directory:string;workspaceDirectory:string;client:GrantWorkspaceClient;context:InstallationSourceCollectionContext;
}
export function openInstallationSourceCollection(options:SourceCollectionSessionOptions&{expectedSequence?:number}):Promise<InstallationSourceCollectionSession>;
export function initializeInstallationSourceCollection(options:SourceCollectionSessionOptions&{
 workingCopy?:InstallationSourceCollectionWorkingCopy;originalBytes?:Uint8Array;caseId?:string;draftId?:string;name?:string;
 staffContext?:SourceCollectionStaffContext|null;
}):Promise<InstallationSourceCollectionSession>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'stage',args:{files:SourceCollectionOriginal[]}):Promise<InstallationSourceCollectionInspection>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'edit',args:SourceCollectionEdit):Promise<InstallationSourceCollectionInspection>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'use_existing',args:{rowId:string;selection:SourceCollectionExistingSelection}):Promise<InstallationSourceCollectionInspection>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'clear_existing',args:{rowId:string}):Promise<InstallationSourceCollectionInspection>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'reconcile',args?:{retry?:boolean}):Promise<InstallationSourceCollectionReconciled>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'receive',args:{expectedSignature:string}):Promise<InstallationSourceCollectionInspection>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'start',args?:{title?:string;sourceUrl?:string;observedAt?:string}):Promise<InstallationSourceCollectionInspection>;
export function performInstallationSourceCollection(agent:InstallationSourceCollectionAgent,action:'review'|'retire_rejected'|'refresh',args?:Record<string,never>):Promise<InstallationSourceCollectionInspection>;
