export type EditorialFile={name:string;bytes:number;sha256:string;contentType:string};
export type EditorialDelivery={schema:'stellar-forge.report-editorial-delivery.v1';workspace:string;workspaceId:string;issueId:string;issueSha256:string;sourceSha256:string;returnId:string|null;applyId:string|null;exportId:string;files:EditorialFile[]};
export type MerchantClient={endpoint:string;call(name:string,args:Record<string,unknown>,options?:Record<string,unknown>):Promise<Record<string,unknown>>;close?():Promise<void>|void};
export type Connection={client?:MerchantClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal};
export declare function callReportEditorial(options:Connection&{action:string;args:Record<string,unknown>;directory:string}):Promise<{directory:string;tool:string;result:Record<string,unknown>}>;
export declare function receiveReportEditorialReturn(options:Connection&{workspace:string;uploadId:string;returnedFile?:string;directory:string}):Promise<Record<string,unknown>>;
export declare function downloadReportEditorial(options:Connection&{workspace:string;exportId:string;expectedManifestSha256:string;directory:string}):Promise<Record<string,unknown>>;
export declare function createReportEditorialDownload():{download(options:Record<string,unknown>):Promise<Record<string,unknown>>;inspect(options:Record<string,unknown>):Promise<{manifest:EditorialDelivery;manifestSha256:string}>};
