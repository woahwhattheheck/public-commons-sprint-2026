// MIT. The CLI consumes the original running Kafka workspace.
import type { Writable } from 'node:stream';
export function runKafkaClientCli(argv?: string[], io?: {stdout?: Writable; stderr?: Writable}): Promise<number>;
