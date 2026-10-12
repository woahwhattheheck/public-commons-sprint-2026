// MIT. Local browser workbench for original customer closing cycles.
import type {Server} from 'node:http';
import type {StatementCycleClient} from './accounting-statement-cycle.mjs';

export interface AccountingStatementCycleWorkbenchOptions {
  /** Owner-controlled absolute directory containing the prepared cycle directories. */
  directory: string;
  /** Existing merchant MCP endpoint. Credentials remain in its server environment. */
  url: string;
  workspace: string;
  actor: string;
  tokenEnv?: string;
  environment?: Record<string, string | undefined>;
  host?: '127.0.0.1' | '::1' | 'localhost';
  /** Use 0 to have the local operating system choose an available port. */
  port?: number;
  client?: StatementCycleClient;
}
export interface AccountingStatementCycleWorkbench {
  readonly url: string;
  readonly directory: string;
  readonly server: Server;
  /** Stop new requests and drain owned work; original cycle files remain resumable. */
  close(): Promise<void>;
}
export function startAccountingStatementCycleWorkbench(
  options: AccountingStatementCycleWorkbenchOptions
): Promise<Readonly<AccountingStatementCycleWorkbench>>;
export function runAccountingStatementCycleWorkbenchCli(
  argv?: string[]
): Promise<Readonly<AccountingStatementCycleWorkbench> | null>;
