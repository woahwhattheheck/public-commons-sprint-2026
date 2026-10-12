export type ToolFactory=(name:string,description:string,properties:Record<string,unknown>,required:string[],annotations:Record<string,boolean>)=>unknown;
export const serviceConfigurationFileSelection:Record<string,unknown>;
export function serviceConfigurationWorkspaceTools(tool:ToolFactory):unknown[];
