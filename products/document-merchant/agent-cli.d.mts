export function runDocumentAgentCommand(argv?:string[],context?:{
  print?:(value:string)=>void;progress?:(value:string)=>void;setExitCode?:(code:number)=>void;
}):Promise<unknown>;
