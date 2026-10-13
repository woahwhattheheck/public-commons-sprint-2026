#!/usr/bin/env node
// Product entry delegates to the same maintained runtime, source and lifetime owner.
import { main } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.mjs';
main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(JSON.stringify({error: error.code ?? error.name, message: error.message}) + '\n');
  process.exitCode = 1;
});
