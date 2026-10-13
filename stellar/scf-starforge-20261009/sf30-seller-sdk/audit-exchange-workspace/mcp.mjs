#!/usr/bin/env node
import {parseArgs} from "node:util";
import {PinnedAuditConnection} from "./connection.mjs";
import {serveStdio} from "./protocol.mjs";
const {values}=parseArgs({options:{url:{type:"string"},"workspace-id":{type:"string"},"instance-id":{type:"string"}},strict:true,allowPositionals:false});
const connection=new PinnedAuditConnection({url:values.url,workspaceId:values["workspace-id"],instanceId:values["instance-id"]});
await connection.attached();
await serveStdio(connection);
