export type ToolFactory=(name:string,description:string,properties:Record<string,unknown>,required:string[],annotations:Record<string,boolean>)=>unknown;
export const fieldDeskFileSelection:Record<string,unknown>;
export function fieldDeskWorkspaceTools(tool:ToolFactory):unknown[];
