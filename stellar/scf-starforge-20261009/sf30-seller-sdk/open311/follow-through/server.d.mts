import type {Server} from 'node:http';
import type {FollowThroughWorkspace} from './workspace.mjs';
export const STARTUP_SCHEMA:'stellar-forge.open311-follow-through-startup.v1';
export const BINDING_SCHEMA:'stellar-forge.open311-follow-through-binding.v1';
export interface WorkspaceBinding {schema:typeof BINDING_SCHEMA;directory:string;workspaceId:string;sha256:string}
export interface Startup {schema:typeof STARTUP_SCHEMA;state:'LISTENING';directory:string;workspaceId:string;bindingSha256:string;binding:WorkspaceBinding;instanceId:string;startedAt:string;url:string}
export interface ServerOptions {directory:string;host?:'127.0.0.1'|'::1';port?:number;expectedWorkspaceId?:string;expectedBindingSha256?:string}
export interface FollowThroughServer {server:Server;workspace:FollowThroughWorkspace;url:string;startup:Startup;readonly launch:Startup;close():Promise<void>}
export function workspaceBinding(directory:string,workspaceId:string):string;
export function serveFollowThrough(options:ServerOptions):Promise<FollowThroughServer>;
export function startFollowThroughServer(options:Omit<ServerOptions,'directory'>&{workspace:string}):Promise<FollowThroughServer>;
