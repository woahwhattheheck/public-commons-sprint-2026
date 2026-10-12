export type PortalMode = 'prepare' | 'receive' | 'prepare-input' | 'restore';
export interface PortalOptions { python?: string; signal?: AbortSignal; }
export interface PortalOutcome {
  state: 'complete';
  mode: PortalMode;
  originalPythonCommand: string[];
  nativeModelRunsStarted: 0;
}
/** Uses the maintained Python lifecycle and waits for its owned child drain. */
export function runGroundwaterPortal(mode: PortalMode, args: string[], options?: PortalOptions): Promise<PortalOutcome>;
