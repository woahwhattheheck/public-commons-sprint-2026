// SPDX-License-Identifier: MIT
import type {ConnectionOptions,FileIdentity,Package} from './native-collection-delivery-client.mjs';
export interface CustomerDownloadOptions extends ConnectionOptions {deliveryWorkspace:string;id:string;directory:string;expectedManifestSha256:string;/** Integer 1..65536; validated before connecting. */ chunkSize?:number;onProgress?:(value:{exportId:string;file:string;bytes:number;total:number;state:'DOWNLOADING'})=>void|Promise<void>}
export interface DownloadResult {schema:string;state:'COMPLETE';manifestSha256:string;packageSha256:string;packageManifestSha256:string;bytes:number;packageFiles:number;contentBytes:number;outputsComplete:boolean;[key:string]:unknown}
export function inspectNativeCustomerPackage(options:ConnectionOptions&{deliveryWorkspace:string;id:string}):Promise<{manifest:{schema:string;id:string;previewSha256:string;package:Package;files:Array<FileIdentity&{name:string}>};manifestSha256:string}>;
export function downloadNativeCustomerPackage(options:CustomerDownloadOptions):Promise<DownloadResult>;
export function reopenNativeCustomerPackage(options:Pick<CustomerDownloadOptions,'deliveryWorkspace'|'id'|'directory'|'expectedManifestSha256'>):Promise<DownloadResult>;
export function receiveDownloadedCustomerPackage(options:{file:string;receivingDirectory:string;expectedSha256:string}):Promise<{schema:string;sha256:string;bytes:number;manifestSha256:string;outputsComplete:boolean;manifest:unknown;[key:string]:unknown}>;

/** Select a receipt from the registered recipient's original history. No sender or original listener is required. */
export interface ReceivedCustomerDownloadOptions extends Omit<CustomerDownloadOptions,'id'> {receivedSha256:string}
export function inspectReceivedCustomerPackage(options:ConnectionOptions&{deliveryWorkspace:string;receivedSha256:string}):Promise<{manifest:{schema:string;id:string;package:FileIdentity&{manifestSha256:string};origin:{collectionId:string|null;task?:import('./native-collection-delivery-client.mjs').TaskOrigin};files:Array<FileIdentity&{name:string}>};manifestSha256:string}>;
export function downloadReceivedCustomerPackage(options:ReceivedCustomerDownloadOptions):Promise<DownloadResult>;
export function reopenReceivedCustomerPackage(options:Pick<ReceivedCustomerDownloadOptions,'deliveryWorkspace'|'receivedSha256'|'directory'|'expectedManifestSha256'>):Promise<DownloadResult>;
