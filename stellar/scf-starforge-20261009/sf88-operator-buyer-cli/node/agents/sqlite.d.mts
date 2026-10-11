import type { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { BuyerGraph, BuyerGraphOptions } from './langgraph.mjs';

export interface SqliteBuyerGraphOptions extends Omit<BuyerGraphOptions, 'checkpointer'> {
  databasePath: string;
}
export interface SqliteBuyerGraph {
  graph: BuyerGraph;
  checkpointer: SqliteSaver;
  databasePath: string;
  close(): void;
}
export function createSqliteBuyerGraph(options: SqliteBuyerGraphOptions): Promise<SqliteBuyerGraph>;
