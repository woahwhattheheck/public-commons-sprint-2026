/// <reference types="node" />
import type {SamJson,SamQueryDefinition,SamNotice,SamSource,SamDeadline,SamComparison} from './workspace.mjs';
export const SAM_SCHEMA:'stellar-forge.samgov-workspace.v1';
export const SAM_PACKET_SCHEMA:'stellar-forge.samgov-packet.v1';
export const SAM_ENDPOINT:'https://api.sam.gov/opportunities/v2/search';
export const SAM_ALPHA_ENDPOINT:'https://api-alpha.sam.gov/opportunities/v2/search';
export const MAX_SOURCE_BYTES:number;export const MAX_PACKET_BYTES:number;export const MAX_RECORDS:number;
export const SOURCE_BASIS:'latest_api_observation';export const COLUMNS:readonly string[];
export function plain(value:unknown):value is Record<string,unknown>;
export function copy<T>(value:T):T;
export function canonical(value:unknown):string;
export function sourceJSON(bytes:Buffer|string):SamJson;
export function sha(value:unknown):string;
export function now():string;
export class SamError extends Error {
  code:string;status:number;details:Record<string,unknown>;
  constructor(code:string,message?:string,status?:number,details?:Record<string,unknown>);
  toJSON():{error:string;message:string;details:Record<string,unknown>};
}
export function requireThat(value:unknown,code:string,message?:string,status?:number,details?:Record<string,unknown>):asserts value;
export function text(value:unknown,name:string,max?:number,empty?:boolean):string;
export function integer(value:unknown,name:string,minimum:number,maximum:number):number;
export function identifier(value:unknown,name?:string):string;
export function date(value:unknown,name:string):string;
export function instant(value:unknown,name?:string):string;
export function zone(value:unknown):string;
export function endpoint(value?:string):string;
export function queryDefinition(value:Partial<SamQueryDefinition> & Pick<SamQueryDefinition,'filters'>):SamQueryDefinition;
export function queryIdentity(definition:SamQueryDefinition,selectedEndpoint?:string):string;
export function searchRequest(definition:SamQueryDefinition,offset?:number,selectedEndpoint?:string):{
  method:'GET';url:string;offset:number;limit:number};
export function cleanSourceUrl(value:string,name?:string):string;
export function validateDescriptionUrl(value:string,noticeId:string,selectedEndpoint?:string):string;
export function safeHeaders(headers?:Headers|Record<string,string>):Record<string,string>;
export function sourceBuffer(value:{contentBase64?:string;contentText?:string},options?:{limit?:number}):Buffer;
export function parseSearchPage(bytes:Buffer,expected:{offset:number;limit:number}):{
  raw:Record<string,SamJson>;totalRecords:number;offset:number;limit:number;rows:Array<Record<string,SamJson>>};
export function noticeRow(raw:Record<string,SamJson>,source:SamNotice['source'],resources?:SamNotice['resources']):SamNotice;
export function reviewDeadline(value?:SamDeadline|null):SamDeadline|null;
export function noticeDatasetRow(row:SamNotice,editionId:string):Record<string,string|null>;
export function csv(rows:Array<Record<string,unknown>>,columns?:readonly string[],options?:{spreadsheet?:boolean}):string;
export function compareNotices(before:SamNotice[],after:SamNotice[]):Pick<SamComparison,'counts'|'items'>;
