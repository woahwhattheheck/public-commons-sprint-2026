// MIT. Complete original customer archive and retained receiving.
import type {CustomerHandover,CustomerHandoverFile,CustomerHandoverManifest,
  CustomerHandoverSelection} from '../customer-updates/operator.mjs';

export const RESEARCH_PAID_ARCHIVE_LIMIT:number;
export const RESEARCH_PAID_ARCHIVE_NAME:'research-customer.handover.gz';
export interface ResearchPaidArchiveFile {
  name:'research-customer.handover.gz';path:string;bytes:number;sha256:string;contentType:'application/gzip';
}
export interface ResearchPaidArchive {
  schema:'sf88-research-paid-archive/v1';directory:string;manifestSha256:string;manifestBytes:number;
  selection:CustomerHandoverSelection;archive:ResearchPaidArchiveFile;reused:boolean;
}
export interface ResearchPaidArchiveInspection {
  schema:'sf88-research-paid-archive-inspected/v1';archive:ResearchPaidArchiveFile;
  manifestSha256:string;manifestBytes:number;manifest:CustomerHandoverManifest;
  selection:CustomerHandoverSelection;files:CustomerHandoverFile[];
}
export interface ResearchPaidArchiveReceiving {
  schema:'sf88-research-paid-archive-received/v1';directory:string;archive:ResearchPaidArchiveFile;
  manifestSha256:string;handover:CustomerHandover;reused:boolean;
}
/** First creation requires sourceDirectory. A completed retained output reopens
 * before donor-path access. The original native source compiler owns selection. */
export function createResearchPaidArchive(input:{
  directory:string;sourceDirectory?:string;manifestSha256:string;signal?:AbortSignal;
}):Promise<ResearchPaidArchive>;
/** Read-only, bounded streaming check of the complete expected compressed input,
 * original manifest/frame and every original member hash, in retained order. */
export function inspectResearchPaidArchive(input:{
  path:string;expectedSha256:string;expectedBytes:number;signal?:AbortSignal;
}):Promise<ResearchPaidArchiveInspection>;
/** First receiving requires path. Once the same input is retained, path may be
 * omitted. Returns the original full handover inspector for native adoption. */
export function receiveResearchPaidArchive(input:{
  directory:string;path?:string;expectedSha256:string;expectedBytes:number;manifestSha256:string;signal?:AbortSignal;
}):Promise<ResearchPaidArchiveReceiving>;
