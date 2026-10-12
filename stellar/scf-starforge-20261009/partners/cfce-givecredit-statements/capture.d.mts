import type {NativeRow,RegistryEdition} from './core.mjs';
export const REGISTRY_BASE:'https://registry.cfce.io/api';
export const CFCE_ORGANIZATION:'04340418-765d-48ab-af36-512a66c960b4';
export const REGISTRY_SOURCE_COMMIT:'3d20065447bd56c9c05a3e658ccd11e0b9cb985e';
export const REGISTRY_ROUTES:Readonly<Record<string,NativeRow>>;
export interface RegistryCaptureOptions {baseUrl?:string;organizationId?:string|null;apiKey:string;pageSize?:number;fetchImpl?:typeof fetch;signal?:AbortSignal;checkpoint?:RegistryEdition;onProgress?:(value:{phase:string;table?:string;rows?:string;checkpoint:RegistryEdition})=>void|Promise<void>}
export function captureRegistry(options:RegistryCaptureOptions):Promise<RegistryEdition>;
