import type {SamWorkspace, SamPacket} from './workspace.mjs';
export type SamExportFormat = 'portable'|'html'|'markdown'|'md'|'notices'|'reviews'|'changes'|'sources';
export interface SamExportOptions {
  format?: SamExportFormat;
  revision?: number;
  selectionId?: string;
  handoffId?: string;
}
export function renderSamCsv(packet: SamPacket, kind?: 'notices'|'reviews'|'changes'|'sources'): string;
export function renderSamHtml(packet: SamPacket): string;
export function renderSamMarkdown(packet: SamPacket): string;
export function exportSamWorkspace(store: SamWorkspace, options?: SamExportOptions): Promise<{
  bytes: Buffer; mediaType: string; filename: string; revision: number; packetSha256: string; sha256: string;
}>;
