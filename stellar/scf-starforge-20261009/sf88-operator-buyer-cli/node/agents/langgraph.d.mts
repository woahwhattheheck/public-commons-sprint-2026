import type { Operation, Review } from '../index.mjs';
import type { CompiledStateGraph, Annotation, BaseCheckpointSaver } from '@langchain/langgraph';
import type { OperationBinding, OutcomeSummary, ResponseArtifact, AgentReadOptions } from './operation.mjs';

export type BuyerGraphNode = 'bind' | 'inspect' | 'review' | 'execute' | 'read';
export interface AgentGraphState {
  binding: OperationBinding | null;
  action: 'recover' | 'review' | 'execute';
  nativeReview: Review | null;
  readOptions: Omit<AgentReadOptions, 'binding' | 'signal'> | false | null;
  phase: string;
  outcome: OutcomeSummary | null;
  artifact: ResponseArtifact | null;
}
export interface BuyerGraphOptions {
  operation: Operation;
  checkpointer: BaseCheckpointSaver;
  read?: Omit<AgentReadOptions, 'binding' | 'signal'> | false;
  /** Optional application pause after a persisted node; resume with invoke(null). */
  interruptAfter?: BuyerGraphNode[];
  name?: string;
}
export type BuyerGraphChannels = {
  [Key in keyof AgentGraphState]: ReturnType<typeof Annotation<AgentGraphState[Key]>>;
};
export type BuyerGraphInputChannels = Pick<BuyerGraphChannels, 'action'>;
export type BuyerGraph = CompiledStateGraph<AgentGraphState, Partial<AgentGraphState>, BuyerGraphNode,
  BuyerGraphInputChannels, BuyerGraphChannels>;
export function createBuyerGraph(options: BuyerGraphOptions): BuyerGraph;
