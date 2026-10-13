export type SourceSelection={name:string;revision:number;document_id:string};
export type IntakeIntent={bytes:number;sha256:string;filename:string};
export type NativeIntake={id:string;workspace_id:string;intent:IntakeIntent;status:string;available_bytes:number;received_bytes:number;chunk_bytes:number;needs_original_file:boolean;result?:{source:SourceSelection;[key:string]:unknown};[key:string]:unknown};
export type OriginalMerchantClient={endpoint:string;call(name:string,args:Record<string,unknown>,options?:Record<string,unknown>):Promise<any>;close?():Promise<void>|void};
export type IntakeOptions={client?:OriginalMerchantClient;url?:string;tokenEnv?:string;environment?:Record<string,string|undefined>;signal?:AbortSignal;workspace:string;intakeId:string;handover?:string;directory:string;resume?:boolean;waitMs?:number;prepare?:{programme:string;operationId:string;expectedRevision:number}};
export declare function registerWorldBankSource(options:IntakeOptions):Promise<{state:string;directory:string;workspace:string;workspaceId:string;intakeId:string;source:SourceSelection|null;[key:string]:unknown}>;
export declare function createWorldBankIntakeDownload():unknown;
export declare function downloadWorldBankIntake(options:{client?:OriginalMerchantClient;url?:string;tokenEnv?:string;workspace:string;exportId:string;expectedManifestSha256:string;directory:string;signal?:AbortSignal;[key:string]:unknown}):Promise<unknown>;
