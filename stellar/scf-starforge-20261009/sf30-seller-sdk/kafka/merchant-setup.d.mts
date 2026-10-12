export interface KafkaMerchantSetupOptions {
  directory: string;
  connection: string;
  name?: string;
}
export interface KafkaMerchantSetupResult {
  schema: 'stellar-forge.merchant-mcp.v1';
  configuration: string;
  state: 'INITIALIZED';
  reused: boolean;
  kafkaWorkspacesConfigured: true;
  ownership: 'ORIGINAL_KAFKA_HTTP_WORKSPACE';
  workspaces: Array<{workspace: string; label: string}>;
}
export declare function initializeKafkaWorkspaceMerchant(options: KafkaMerchantSetupOptions): Promise<KafkaMerchantSetupResult>;
