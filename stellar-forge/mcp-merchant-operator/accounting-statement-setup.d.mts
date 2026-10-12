// MIT. Customer setup routes use the original native statement client and durable operations.
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {AccountingStatementClient} from './accounting-statement-client.mjs';
export interface CustomerSetupRouteOptions {
  directory:string;url:string;workspace:string;actor:string;tokenEnv:string;
  connection():Promise<AccountingStatementClient>;
  enqueue<T>(work:()=>Promise<T>):Promise<T>;
  signal?:AbortSignal;
  bodyJson(request:IncomingMessage):Promise<Record<string,unknown>>;
  sendJson(response:ServerResponse,status:number,value:unknown):void;
}
export interface CustomerSetupRoutes {
  handle(request:IncomingMessage,response:ServerResponse,address:URL):Promise<boolean>;
  close():Promise<void>;
}
export function createCustomerSetupRoutes(options:CustomerSetupRouteOptions):Promise<CustomerSetupRoutes>;
