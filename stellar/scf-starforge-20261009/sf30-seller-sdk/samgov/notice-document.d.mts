import type {SamJson,SamNotice} from './workspace.mjs';
export const NOTICE_DOCUMENT_FORMAT:'samgov_notice_document.v1';
export const NOTICE_DOCUMENT_BASIS:'retained_notice_document';
export interface SamNoticeDocuments {
  notice:Record<string,SamJson>;
  resources?:Record<string,SamJson>|null;
  history?:Record<string,SamJson>|null;
}
export function noticeDocumentUrls(id:string):{notice:string;resources:string;history:string};
export function validateNoticeDocumentUrl(url:string,kind:'notice_record'|'notice_resources'|'notice_history',id:string):string;
export function parseNoticeDocument(value:unknown):{id:string;value:Record<string,SamJson>};
export function noticeDocumentRow(document:SamNoticeDocuments,source:SamNotice['source'],resources?:SamNotice['resources']):SamNotice;
export function rebuildNotice(row:SamNotice,resources?:SamNotice['resources']):SamNotice;
export function noticeSourceIds(row:SamNotice,options?:{successfulResourcesOnly?:boolean}):string[];
