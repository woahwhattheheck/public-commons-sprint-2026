import type { NoticeDerivation, OriginalRow } from './domain.mjs';
export declare const DERIVED_SOURCE_KIND:'derived-notice-utf8-csv';
export declare const DERIVATION_SCHEMA:'starforge.canadabuys.notice-derivation.v1';
export declare const SOURCE_WORKSPACE_SCHEMA:'starforge.canadabuys.workspace.v3';
export declare const SOURCE_PACKAGE_SCHEMA:'starforge.canadabuys.package.v3';
export declare function sourceProvenance(meta:Record<string,unknown>,parsed:{columns:string[];rows:Array<{rowNumber:number;row:OriginalRow}>},stream:string,csvSha256:string):{
 id:string;metadata:{coverage:'federal'|'single-notice';bodyKind:'original-utf8-csv'|'derived-notice-utf8-csv';derivationSha256?:string;derivation?:NoticeDerivation};
};
