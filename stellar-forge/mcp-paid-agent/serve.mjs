/** Standalone local MCP server: read-only search/preview without an operator signer. */
import { createServer } from 'node:http';
import { McpPaidToolBroker, createMcpHttpHandler } from './agent-server.mjs';

const discoveryUrl=process.env.BAZAAR_DISCOVERY_URL;
const bearerToken=process.env.MCP_ACCESS_TOKEN;
if(!discoveryUrl||!bearerToken){
  process.stderr.write('Configure BAZAAR_DISCOVERY_URL and MCP_ACCESS_TOKEN. No external signer is wired in standalone mode.\n');
  process.exitCode=2;
}else{
  const allowedResourceOrigins=(process.env.PAID_RESOURCE_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
  const allowedClientOrigins=(process.env.MCP_CLIENT_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
  const port=Number(process.env.MCP_PORT??3210);
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new RangeError('Invalid MCP_PORT');
  const broker=new McpPaidToolBroker({discoveryUrl,allowedResourceOrigins});
  const handler=createMcpHttpHandler(broker,{bearerToken,allowedClientOrigins});
  const server=createServer(handler);
  server.listen(port,'127.0.0.1',()=>process.stderr.write(`SF32 MCP localhost server on 127.0.0.1:${port}; paid execution disabled pending operator hooks.\n`));
}
