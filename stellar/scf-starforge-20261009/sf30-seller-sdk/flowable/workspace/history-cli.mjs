#!/usr/bin/env node
// MIT. Complete original history analysis and independent receiving.
import {runFlowableHistoryCLI} from './history-delivery.mjs';
runFlowableHistoryCLI().then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write((error.code?error.code+': ':'')+error.message+'\n');process.exitCode=1;});
