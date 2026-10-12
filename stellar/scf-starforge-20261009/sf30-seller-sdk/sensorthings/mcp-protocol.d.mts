/** MIT. Pure native tool metadata; no listener, source fetch or writer is opened. */
import type {
  SensorThingsToolDefinition,
  SensorThingsToolFactory,
  SensorThingsToolName,
  ToolFieldSchema
} from './mcp.mjs';

export const ALIAS: RegExp;
export const SHA: RegExp;
export const UUID: RegExp;
/** Pass the existing merchant host's tool constructor. Exactly fourteen tools return. */
export function sensorThingsWorkspaceTools<T>(tool: SensorThingsToolFactory<T>): T[];
export const sensorThingsToolDefinitions: Map<SensorThingsToolName, SensorThingsToolDefinition>;
/** Runtime validation throws INVALID_PARAMS; it does not transform the source value. */
export function validateSensorThingsField(value: unknown, schema: ToolFieldSchema, path?: string): void;

export type {
  SensorThingsToolAnnotations,
  SensorThingsToolDefinition,
  SensorThingsToolFactory,
  SensorThingsToolName,
  ToolFieldSchema
} from './mcp.mjs';
