import type {Readable, Writable} from 'node:stream';
import type {SamServer} from './server.mjs';
export interface SamCliOptions {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  /** False returns the started server to a native embedding caller. */
  waitForClose?: boolean;
}
export function runSamCli(argv?: string[], options?: SamCliOptions): Promise<SamServer|unknown>;
