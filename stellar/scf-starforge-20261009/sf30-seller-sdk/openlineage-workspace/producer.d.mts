import type { IncomingMessage } from "node:http";

export interface ProducerReceipt {
  workspaceId: string; revision: number; operationId: string; replayed: boolean;
  added: number; retained: number;
  source: { id: string; name: string; bytes: number; format: string;
    contentEncoding: "identity" | "gzip"; decodedBytes?: number; decodedSha256?: string };
}
export interface ProducerLimits {
  maxRequests: number; maxBufferedBytes: number; maxBodyBytes: number; maxDecodedBytes: number;
}
export interface ProducerStatus {
  schema: "commons.openlineage.producer-status.v1";
  endpoint: "/api/v1/lineage"; state: "receiving" | "draining"; startedAt: string;
  limits: ProducerLimits; pending: number; bufferedBytes: number;
  counters: { admitted: number; committed: number; replayed: number; rejected: number; failed: number; wireBytes: number };
  lastCommit: { at: string; operationId: string; sourceId: string; revision: number; replayed: boolean } | null;
  supportedContentEncodings: ["identity", "gzip"]; acknowledgement: string; retryIdentity: string;
  workspaceId?: string; instanceId?: string; url?: string; authentication?: "producer-token" | "workspace-token" | "local";
}
export interface ProducerConnection {
  schema: "commons.openlineage.startup.v1"; workspaceId: string; instanceId: string; url: string;
}
export interface ProducerConfiguration {
  transport: { type: "http"; url: string; endpoint: string; timeout?: number; timeoutInMillis?: number;
    custom_headers?: Record<string, string>; headers?: Record<string, string>;
    compression?: "gzip"; auth?: { type: "api_key"; apiKey: string } };
}
export function producerRevision(value?: string): number | null;
export function producerConfiguration(identity: ProducerConnection, options?: {
  token?: string | null; compression?: "identity" | "gzip"; timeoutSeconds?: number; client?: "python" | "java";
}): ProducerConfiguration;
export class ProducerIntake {
  constructor(workspace: { importSource(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<any> },
    limits?: Partial<ProducerLimits>);
  describe(): ProducerStatus;
  receive(request: IncomingMessage, options?: { name?: string; sourceUrl?: string; revision?: number | null }): Promise<ProducerReceipt>;
  stop(): void;
  drain(): Promise<void>;
}
