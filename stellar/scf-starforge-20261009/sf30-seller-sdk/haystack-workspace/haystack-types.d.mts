import type { Buffer } from 'node:buffer';

export type HaystackFormat = 'json-v4';
export type HaystackKind = 'null' | 'bool' | 'str' | 'number' | 'marker' | 'remove' |
  'na' | 'ref' | 'date' | 'time' | 'dateTime' | 'uri' | 'coord' |
  'xstr' | 'symbol' | 'list' | 'dict' | 'grid';
export type HaystackNumber = { _kind: 'number'; val: number | 'INF' | '-INF' | 'NaN'; unit?: string };
export type HaystackRef = { _kind: 'ref'; val: string; dis?: string };
export type HaystackValue = null | boolean | number | string |
  { _kind: 'marker' | 'remove' | 'na' } | HaystackNumber | HaystackRef |
  { _kind: 'symbol' | 'date' | 'time' | 'uri'; val: string } |
  { _kind: 'dateTime'; val: string; tz?: string } |
  { _kind: 'coord'; lat: number; lng: number } |
  { _kind: 'xstr'; type: string; val: string } |
  HaystackValue[] | HaystackDict | HaystackGrid;
export interface HaystackDict {
  _kind?: 'dict';
  [tag: string]: HaystackValue | undefined;
}
export interface HaystackColumn { name: string; meta?: HaystackDict; }
export interface HaystackGrid {
  _kind: 'grid';
  meta: HaystackDict & { ver: '3.0' };
  cols: HaystackColumn[];
  rows: HaystackDict[];
}
export interface HaystackDiagnostic {
  id: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  sourceId?: string;
  rowIndex?: number;
  recordKey?: string;
  tag?: string;
  details?: Record<string, unknown> & { path?: string };
}
export interface HaystackValidation {
  valid: true;
  diagnostics: HaystackDiagnostic[];
}
export interface HaystackParseResult {
  grid: HaystackGrid;
  diagnostics: HaystackDiagnostic[];
  source: {
    sha256: string;
    bytes: number;
    format: HaystackFormat;
    mediaType: 'application/json';
    bom: boolean;
  };
}
export const SUPPORTED_FORMATS: readonly ['json-v4'];
export const MAX_VALUE_DEPTH: 128;
export class HaystackError extends Error {
  readonly status: 400;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export function isTagName(value: unknown): value is string;
export function valueKind(value: unknown): HaystackKind | 'invalid';
export function diagnosticId(code: string, ...identity: unknown[]): string;
export function validateValue(value: unknown): HaystackValidation;
export function validateGrid(grid: unknown): HaystackValidation;
export function parseGrid(bytes: string | Buffer | Uint8Array, options?: { format?: HaystackFormat }): HaystackParseResult;
export function encodeGrid(grid: HaystackGrid, options?: { format?: HaystackFormat; indent?: number }): Buffer;
export function displayValue(value: HaystackValue): string;
