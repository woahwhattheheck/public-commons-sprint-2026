import type { Server } from 'node:http';
import type { Inbox } from '../../index.mjs';

export interface TaskDeskOptions {
  /** The existing original Inbox. */
  inbox: Inbox;
  /** Private saved-task directory, usually inside the existing buyer state. */
  tasksDirectory: string;
  /** Private result directory outside the Inbox and task roots. */
  outputsDirectory: string;
  /** Existing native task containing task.json; pair with existingOutputDirectory. */
  existingTaskDirectory?: string;
  /** Original receiving destination, or a complete delivered packet opened for reading. */
  existingOutputDirectory?: string;
  /** Optional original commerce session used by saved RPC read discovery and inspection. */
  commerceDirectory?: string;
  /** Original private store for reviewed complete customer deliveries; separate from task and packet roots. */
  customerDeliveryDirectory?: string;
  /** Original operator workspace passed only to explicitly selected execution. */
  workspaceDirectory?: string;
  /** 0 selects an available local port. */
  port?: number;
  hostname?: '127.0.0.1';
}
export interface RunningTaskDesk {
  readonly server: Server;
  readonly url: string;
  readonly instanceId: string;
  /** Stop accepting new commands and wait for already accepted native commands. */
  close(): Promise<void>;
}
export function startTaskDesk(options: TaskDeskOptions): Promise<RunningTaskDesk>;
