import type { DocumentTableSource } from './source-document-tables.mjs';
export declare const DOCUMENT_INTAKE_SCHEMA: 'stellar-forge.document-table-intake.v1';
export declare const DOCUMENT_INTAKE_PACKET_SCHEMA: 'stellar-forge.document-table-intake-packet.v1';
export interface DocumentPreparationFields {
  headerRows: string; dataRows: string; columns: string; exclusions: string;
  mergedCells: 'anchor'|'repeat'|'reject'; whitespace: 'preserve'|'trim'|'collapse';
  filename: string; target: string;
}
export interface DocumentPreparationSnapshot { fields: DocumentPreparationFields; rowPage: number; columnPage: number }
export interface DocumentPreparation extends DocumentPreparationSnapshot {
  tableIndex: number; history: (DocumentPreparationSnapshot & { retainedAt: string })[];
}
export interface DocumentIntake {
  schema: typeof DOCUMENT_INTAKE_SCHEMA; selectedSourceId: string|null;
  sourceDetails: {url:string;filename:string;provider:string};
  sources: {sourceId:string;selectedTable:number;tables:DocumentPreparation[]}[];
}
export interface DocumentIntakePacket { schema: typeof DOCUMENT_INTAKE_PACKET_SCHEMA; sources: DocumentTableSource[]; intake: DocumentIntake }
export declare const DOCUMENT_INTAKE_FIELDS: readonly (keyof DocumentPreparationFields)[];
export declare function createDocumentIntake(): DocumentIntake;
export declare function captureDocumentPreparation(intake:DocumentIntake,sourceId:string,tableIndex:number,value:DocumentPreparationSnapshot,options?:{replace?:boolean}):DocumentIntake;
export declare function documentPreparation(intake:DocumentIntake,sourceId:string,tableIndex:number):DocumentPreparation|null;
export declare function restoreDocumentPreparation(intake:DocumentIntake,sourceId:string,tableIndex:number,historyIndex:number):DocumentIntake;
export declare function validateDocumentIntake(input:unknown,sources:DocumentTableSource[]):Promise<DocumentIntake>;
export declare function createDocumentIntakePacket(intake:DocumentIntake,sources:DocumentTableSource[]):Promise<DocumentIntakePacket>;
export declare function receiveDocumentIntakePacket(current:DocumentIntake,sources:DocumentTableSource[],packet:unknown):Promise<{intake:DocumentIntake;sources:DocumentTableSource[]}>;
