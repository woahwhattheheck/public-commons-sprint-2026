// MIT. One original durable candidate, review, version writer and buyer handoff.
import { join } from 'node:path';
import { openSourceDatasetPublisher } from '../../postgres/publisher/model.mjs';
import { fault } from '../../postgres/publisher/files.mjs';
import { readOaiSourceFile } from '../source.mjs';
import { oaiPublisherDriver, inspectOaiPublicationSource } from './driver.mjs';

export async function openOaiPublisher(options = {}) {
  const publisher = await openSourceDatasetPublisher(options, oaiPublisherDriver);
  async function retainedSource(id) {
    const run = publisher.run(id), plan = publisher.plan(run.plan);
    const source = await readOaiSourceFile(join(publisher.directory, 'plans', plan.folder, 'source.json'), { loadDataset: false });
    if (source.sourceHash !== plan.data.sourceHash ||
        source.config.connection.sha256 !== plan.data.capture.manifestSha256)
      throw fault('OAI_RETAINED_PLAN_CHANGED', 'The retained source differs from this original extraction plan.', 409);
    return source;
  }
  // The generic candidate verifier owns CSV/config integrity. This adapter also
  // verifies its original capture closure before review, publication or handoff.
  const methods = {};
  for (const name of ['candidate', 'inspect', 'review', 'publish', 'recover', 'buyerOffer', 'prepareBuyer'])
    methods[name] = async (id, ...args) => { await retainedSource(id); return publisher[name](id, ...args); };
  const source = sourceFile => sourceFile === undefined ? publisher.source() : inspectOaiPublicationSource(sourceFile);
  return Object.freeze({ ...publisher, ...methods, source, retainedSource });
}
