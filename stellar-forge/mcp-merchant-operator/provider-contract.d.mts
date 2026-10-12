export declare const MERCHANT_PROVIDER_SCHEMA: 'stellar-forge.merchant-provider.v1';
export declare const CORE_MERCHANT_CONFIG_KEYS: readonly string[];
export type MerchantConfiguration = Record<string, any>;
export interface MerchantTool {
  name: string;
  description: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}
export type MerchantToolFactory = (
  name: string, description: string, properties?: Record<string, unknown>, required?: string[],
  hints?: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }
) => MerchantTool;
export interface MerchantConfigurationContext {
  readonly base: string;
  readonly config: MerchantConfiguration;
  /** Resolve only the original host-selected configuration reference. */
  readonly hostPath: (value: unknown) => string;
}
export type MerchantInstruction = {
  order?: number; text: string;
} & ({ prefix: string | null; tool?: never } | { tool: string; prefix?: never });
export interface MerchantProviderDefinition<Module = any, Runtime = any> {
  schema: typeof MERCHANT_PROVIDER_SCHEMA;
  id: string;
  family: string;
  title: string;
  order?: number;
  catalogOrder?: number;
  configKey: string | null;
  configuration?: {
    input: string;
    read(value: unknown, context: MerchantConfigurationContext): unknown | Promise<unknown>;
    dependencies?: string[];
    privateExports?: boolean;
  } | null;
  summary?: boolean;
  dependencies?: string[];
  load(): Promise<Module>;
  create(module: Module, config: MerchantConfiguration, options: Record<string, any>,
    dependencies: Record<string, any>): Runtime | Promise<Runtime>;
  tools(tool: MerchantToolFactory): MerchantTool[];
  coreToolNames?: string[];
  maxRequestBytes?: number;
  concurrency?: 'host' | 'provider';
  concurrentTools?: string[];
  shutdown?: 'drain' | 'provider';
  requestClose?(runtime: Runtime): unknown | Promise<unknown>;
  instructions?: MerchantInstruction[];
  initialize?(options: Record<string, unknown>): unknown | Promise<unknown>;
}
export declare function defineMerchantProvider<Module, Runtime>(
  value: MerchantProviderDefinition<Module, Runtime>
): Readonly<MerchantProviderDefinition<Module, Runtime>>;
