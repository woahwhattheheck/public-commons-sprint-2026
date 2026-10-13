#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {main as originalMain} from './workbench/cli.mjs';
export const main=originalMain;
await main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'MIGRATION_COMMAND_FAILED',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
