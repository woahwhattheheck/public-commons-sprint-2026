import type { Operation } from '../index.mjs';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentReadOptions } from './operation.mjs';

export interface BuyerToolOptions {
  operation: Operation;
  namePrefix?: string;
  maxContentCharacters?: number;
  readDefaults?: Omit<AgentReadOptions, 'binding' | 'signal'>;
}
/** Review, execute, recover, read: ordinary tools accepted by LangChain and ToolNode. */
export function createBuyerTools(options: BuyerToolOptions): StructuredToolInterface[];
