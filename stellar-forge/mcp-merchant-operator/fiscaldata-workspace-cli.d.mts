export interface FiscalCliOptions {
  environment?:Record<string,string|undefined>; signal?:AbortSignal;
  stdout?:{write(value:string):unknown}; stderr?:{write(value:string):unknown};
}
export function main(argv?:string[],options?:FiscalCliOptions):Promise<unknown>;
