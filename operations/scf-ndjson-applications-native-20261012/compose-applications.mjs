// MIT. Apply the original NDJSON producer hooks to the current shared Applications files.
export function composeNdjsonApplications(path, source) {
  let out = source;
  const once = (before, after) => {
    if (out.split(before).length !== 2) throw new Error('Application composition anchor changed: ' + before.slice(0, 120));
    out = out.replace(before, after);
  };
  if (path.endsWith('/applications.mjs')) {
    if (out.includes("from './application-ndjson.mjs'")) throw new Error('NDJSON is already registered; inspect its current source.');
    once("import { mppApplication, prepareMppApplication } from './application-mpp.mjs';",
      "import { mppApplication, prepareMppApplication } from './application-mpp.mjs';\nimport { ndjsonApplication, prepareNdjsonApplication } from './application-ndjson.mjs';");
    once("  mppApplication(common),", "  mppApplication(common),\n  ndjsonApplication(common),");
    once("  } else if (type.id === 'xml') {",
      "  } else if (type.id === 'ndjson') {\n    const prepared = await prepareNdjsonApplication(settings, {\n      inputPath, selectedExecutable, runtimeDirectory, applicationEnvironment,\n    });\n    args.push(...prepared.args); inputs.push(...prepared.inputs);\n  } else if (type.id === 'xml') {");
  } else if (path.endsWith('/application-command.mjs')) {
    if (out.includes("from './application-ndjson.mjs'")) throw new Error('NDJSON observer is already registered; inspect its current source.');
    once("import { mppStartup, MPP_READY_SCHEMA } from './application-mpp.mjs';",
      "import { mppStartup, MPP_READY_SCHEMA } from './application-mpp.mjs';\nimport { ndjsonStartup } from './application-ndjson.mjs';");
    once("    if (request.command === 'grant-workspace') {",
      "    if (request.command === 'dataset-ndjson') {\n" +
      "      if (!text.startsWith('{\"schema\":\"stellar-forge.ndjson-workspace-launch.v1\",')) return;\n" +
      "      saving = saving.then(async () => {\n" +
      "        if (seen) return;\n" +
      "        const startup = await ndjsonStartup(request, text);\n" +
      "        const url = startup && privateUrl(startup.url);\n" +
      "        if (!url) return;\n" +
      "        seen = true;\n" +
      "        await saveJSON(join(directory, 'application-url.json'), {\n" +
      "          schema: 'stellar-forge.application-url.v1', applicationId: request.applicationId,\n" +
      "          operationId: directory.split('/').at(-1), command: request.command,\n" +
      "          source: 'original-command-stdout', observedAt: now(), url, original: startup.original,\n" +
      "        });\n" +
      "      }).catch(error => { if (error.code !== 'EEXIST') saveError = error; });\n" +
      "      return;\n" +
      "    }\n" +
      "    if (request.command === 'grant-workspace') {");
  } else if (path.endsWith('/APPLICATIONS.md')) {
    once("| XML dataset onboarding |",
      "| JSON Lines datasets | dataset-ndjson … serve | Original JSON Lines intake, exact mapping, native query and comparison, merchant/customer packages and retained console handoff |\n| XML dataset onboarding |");
    out += "\n## JSON Lines datasets\n\nThe complete [NDJSON managed application guide](../../sf30-seller-sdk/ndjson/MANAGED_APPLICATIONS.md) covers the original retained source workspace, explicit Python selection, review/save/start/open/stop/reopen, merchant MCP connection and complete customer handoff.\n";
  } else throw new Error('Unknown Applications source path: ' + path);
  return out;
}
