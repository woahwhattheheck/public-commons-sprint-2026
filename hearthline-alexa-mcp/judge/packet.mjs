import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyJudgePacket } from './verify.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

async function json(rootDir, relative) {
  return JSON.parse(await readFile(path.join(rootDir, ...relative.split('/')), 'utf8'));
}

export async function buildJudgePacket({ rootDir = PROJECT_ROOT } = {}) {
  const integrity = await verifyJudgePacket({ rootDir });
  const fields = await json(rootDir, 'judge/submission-fields.json');
  const provenance = await json(rootDir, 'PUBLIC_CARRIER_PROVENANCE.json');
  const matrix = await json(rootDir, 'judge/source-blobs.json');

  return {
    schema: 'hearthline-judge-packet/v1',
    project: fields.project,
    draft: {
      title: fields.title,
      tagline: fields.tagline,
      problem: fields.problem,
      solution: fields.solution,
    },
    integrity,
    provenance: {
      operation: provenance.operation,
      originalPublicationOwner: provenance.originalPublicationOwner,
      recoveryFinalizationOwner: provenance.recoveryFinalizationOwner,
      sourceRepository: provenance.sourceRepository,
      sourceCommit: provenance.sourceCommit,
      sourceSubtree: provenance.sourceSubtree,
      manifestBlob: provenance.manifestBlob,
      publishedSourceFiles: provenance.publishedSourceFiles,
      byteIdentity: provenance.byteIdentity,
      sourceModes: provenance.sourceModes,
    },
    judgeFlow: [
      { order: 1, purpose: 'product overview and run commands', path: 'README.md' },
      { order: 2, purpose: 'judge-first evidence map and truth boundary', path: 'JUDGE_PACKET.md' },
      { order: 3, purpose: 'three-minute product walkthrough', path: 'docs/DEMO.md' },
      { order: 4, purpose: 'stateful mission and authority architecture', path: 'docs/ARCHITECTURE.md' },
      { order: 5, purpose: 'interactive local no-provider simulator', path: 'simulator/index.html' },
      { order: 6, purpose: 'MCP 2025-11-25 protocol proof', path: 'runtime/conformance-probe.mjs' },
      { order: 7, purpose: 'public-source provenance receipt', path: 'PUBLIC_CARRIER_PROVENANCE.json' },
    ],
    reproducibility: {
      commands: fields.demoCommands,
      sourceBlobMatrix: 'judge/source-blobs.json',
      sourceBlobEntries: matrix.files.length,
      packetCommand: 'node judge/packet.mjs',
      verifierCommand: 'node judge/verify.mjs',
      deterministic: true,
      networkRequired: false,
      credentialsRequired: false,
    },
    truthBoundary: fields.truthBoundary,
    ownerActionsRequired: fields.ownerActionsRequired,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(canonicalJson(await buildJudgePacket()));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code ?? 'PACKET_FAILED', error: error?.message ?? String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
