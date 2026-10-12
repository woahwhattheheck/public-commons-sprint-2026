import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OAuthResourceAuthorization, OAuthResourceDescription, OAuthResourceOptions } from './oauth-resource.mjs';
type Handler=(req:IncomingMessage,res:ServerResponse)=>unknown;
export interface OAuthResourceHost {
  transportOptions: Readonly<{bearerToken?:string;authorization?:OAuthResourceAuthorization}>;
  wrap(handler:Handler):Handler;
  describe():{mode:'fixed-bearer'}|({mode:'oauth'}&OAuthResourceDescription);
  close():Promise<void>;
}
export function loadOAuthResourceHost(options?:{
  configPath?:string;bearerToken?:string;fetchImpl?:OAuthResourceOptions['fetchImpl'];
}):Promise<OAuthResourceHost>;
