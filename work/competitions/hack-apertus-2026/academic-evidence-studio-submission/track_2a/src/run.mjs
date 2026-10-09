#!/usr/bin/env node
/** Hack Apertus Track 2A runtime: translates the official LLM_* interface without changing original Studio source. */
import {pathToFileURL} from 'node:url';

export function toCompletionsURL(input) {
  if (typeof input !== 'string' || !input.trim()) return undefined;
  const url = new URL(input);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw Error('LLM_BASE_URL must be HTTPS or local loopback HTTP');
  if (url.username || url.password || url.hash) throw Error('LLM_BASE_URL cannot contain credentials or fragment');
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) url.pathname = path + '/chat/completions';
  return url.toString();
}

export function modelSettings(env = process.env) {
  // Official challenge interface is BASE_URL; retained app interface is full completions URL.
  const endpoint = env.LLM_BASE_URL ? toCompletionsURL(env.LLM_BASE_URL) :
    (env.APERTUS_ENDPOINT ? toCompletionsURL(env.APERTUS_ENDPOINT) : undefined);
  const key = env.LLM_API_KEY || env.APERTUS_API_KEY || undefined;
  const model = env.LLM_NAME || env.APERTUS_MODEL || 'Apertus-v1.5-8B';
  return {endpoint, key, model, mode: endpoint && key ? 'live-available' : 'offline'};
}

export async function start({env = process.env, port=8787, workspacePort=8788}={}) {
  const model = modelSettings(env);
  if (model.endpoint) process.env.APERTUS_ENDPOINT = model.endpoint;
  if (model.key) process.env.APERTUS_API_KEY = model.key;
  process.env.APERTUS_MODEL = model.model;
  const [{createServer}, {createWorkspaceServer}] = await Promise.all([
    import('./app.mjs'), import('./workspace-server.mjs')
  ]);
  const listen = (server, value) => new Promise((resolve,reject)=> {
    server.once('error',reject);
    server.listen(value,'0.0.0.0',()=>{server.removeListener('error',reject);resolve(server)});
  });
  const primary = await listen(createServer(),port);
  let workspace;
  try {workspace = await listen(createWorkspaceServer(),workspacePort)}
  catch (err) {await new Promise(resolve=>primary.close(resolve));throw err;}
  return {primary, workspace, mode:model.mode, model:model.model};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT||8787);
  const workspacePort=Number(process.env.WORKSPACE_PORT||8788);
  if (![port,workspacePort].every(p=>Number.isInteger(p)&&p>=1&&p<=65535) || port===workspacePort) {
    console.error('PORT and WORKSPACE_PORT must be distinct 1–65535 integers');process.exit(2);
  }
  start({port,workspacePort}).then(({mode,model})=>{
    console.log(`Academic Evidence Studio on 0.0.0.0:${port}; review workspace on 0.0.0.0:${workspacePort}; ${mode}; model=${model}`);
  }).catch(err=>{console.error(err.message);process.exitCode=1});
}
