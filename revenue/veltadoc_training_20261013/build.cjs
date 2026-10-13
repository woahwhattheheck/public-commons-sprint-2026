#!/usr/bin/env node
'use strict';
if(process.argv.length!==3){console.error('Usage: node build.cjs NEW_OUTPUT_DIRECTORY');process.exitCode=1;}
else import('./build-package-viewer.mjs').then(m=>console.log(JSON.stringify(m.buildPackageView(process.argv[2])))).catch(error=>{console.error(error.stack);process.exitCode=1;});
