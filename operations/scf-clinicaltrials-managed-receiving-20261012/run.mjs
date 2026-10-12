// MIT. One complete original managed receiving with its browser attachment.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { receiveClinicalTrialsApplications } from './receive.mjs';
import { clinicalTrialsManagedBrowser } from './browser.mjs';
const selection = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
const outcome = await receiveClinicalTrialsApplications(selection, {
  onProgress: value => process.stdout.write(JSON.stringify(value) + '\n'),
  onOpen: clinicalTrialsManagedBrowser(selection.browser ?? {}),
});
process.stdout.write(JSON.stringify({
  status: 'COMPLETE', applicationId: outcome.applicationId,
  sourceCommit: outcome.selection.sourceCommit, sourcePacketSha256: outcome.selection.sourcePacketSha256,
  bindingSha256: outcome.selection.bindingSha256, completedAt: outcome.completedAt, passes: outcome.passes,
}) + '\n');
