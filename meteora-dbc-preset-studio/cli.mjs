import { compilePreset, catalog } from "./core.mjs";
const [command = "list", presetId = "community-launch"] = process.argv.slice(2);
try {
  if (command === "list") console.log(JSON.stringify(catalog(), null, 2));
  else if (command === "inspect") console.log(JSON.stringify(await compilePreset({ presetId }), null, 2));
  else if (command === "compare") {
    const rows = [];
    for (const p of catalog()) {
      const r = await compilePreset({ presetId: p.id });
      rows.push({
        preset: p.id, migrationQuoteThresholdAtomic: r.migrationQuoteThresholdAtomic,
        configSha256: r.configSha256, reviewFlags: r.notes
      });
    }
    console.log(JSON.stringify({ schema: "dbc-preset-comparison/v1", rows }, null, 2));
  } else throw new TypeError("Usage: node cli.mjs [list|inspect PRESET_ID|compare]");
} catch (e) { console.error(e.message); process.exitCode = 1; }
