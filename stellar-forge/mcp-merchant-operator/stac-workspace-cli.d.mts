export declare const STAC_WORKSPACE_HELP: string;
export declare function runStacWorkspaceCLI(argv?: string[], options?: {
  stdout?: (value: string) => unknown; stderr?: (value: string) => unknown; environment?: NodeJS.ProcessEnv;
}): Promise<number>;
