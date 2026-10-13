#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {prepareCalendar, composeInstallation, calendarCsv} from "./recurring-core.mjs";
import * as native from "./prepare-core.mjs";
import {readProfile} from "./profiles.mjs";
import {composeCustomerProgramme, applyProgrammeChange, programmeFiles} from "./customer-programme-core.mjs";
const json = value => JSON.stringify(value, null, 2) + "\n";
const digest = text => createHash("sha256").update(text, "utf8").digest("hex");
async function read(file, files, retainedName) {
  const raw = await fs.readFile(file, "utf8");
  const value = JSON.parse(raw);
  if (files && retainedName) files.set(retainedName, raw);
  return value;
}
async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (command === "--help" || command === "help" || !command) {
    process.stdout.write("recurring.mjs calendar --input calendar-input.json --out NEW_DIRECTORY\nrecurring.mjs compose --seed NATIVE_SEED.json --profile PROFILE --bindings NATIVE_BINDINGS.json --calendar CALENDAR_INPUT.json [--task-budget BUDGET.json] --out NEW_DIRECTORY\nrecurring.mjs bindings --seed NATIVE_SEED.json --profile PROFILE --out NEW_DIRECTORY\nrecurring.mjs programme --seed NATIVE_SEED.json --profile PROFILE --document COMPLETE_DRAFT.json --commissioning COMPLETE_COMMISSIONING.json --calendar CALENDAR_INPUT.json [--selection ORIGINAL_SELECTION.json] [--task-budget BUDGET.json] [--native-change NATIVE_CHANGE.json] [--accepted-save ORIGINAL_ACCEPTED_SAVE.json] --out NEW_DIRECTORY\nrecurring.mjs change --seed NATIVE_SEED.json [--base-document ORIGINAL_DRAFT.json] --document EDITED_NATIVE_DRAFT.json --out NEW_DIRECTORY\n");
    return;
  }
  const flags = {};
  while (argv.length) {
    const name = argv.shift();
    if (!/^--[a-z-]+$/.test(name ?? "") || !argv.length || Object.hasOwn(flags, name.slice(2))) throw new Error("Use each declared flag and value once.");
    flags[name.slice(2)] = argv.shift();
  }
  const allowed = {calendar: ["input", "out"], bindings: ["seed", "profile", "out"],
    compose: ["seed", "profile", "bindings", "calendar", "task-budget", "out"],
    programme: ["seed", "profile", "document", "commissioning", "calendar", "selection", "task-budget", "native-change", "accepted-save", "out"],
    change: ["seed", "base-document", "document", "out"]}[command];
  if (!allowed || Object.keys(flags).some(key => !allowed.includes(key))) throw new Error("Use a declared command and its flags; see --help.");
  if (!flags.out) throw new Error("Select a new private output directory.");
  const files = new Map();
  if (command === "calendar") {
    if (!flags.input) throw new Error("Select the complete calendar input.");
    const calendar = prepareCalendar(await read(flags.input, files, "original-calendar-input.json"));
    files.set("calendar.json", json(calendar));
    files.set("calendar.csv", calendarCsv(calendar));
  } else if (command === "change") {
    for (const key of ["seed", "document"]) if (!flags[key]) throw new Error("Select --" + key + ".");
    const seed = await read(flags.seed, files, "original-native-seed.json");
    const baseDocument = flags["base-document"] ?
      await read(flags["base-document"], files, "original-base-document.json") : seed.document;
    const document = await read(flags.document, files, "original-edited-document.json");
    const change = {schema: "stellar-forge.installation-programme-change.v1",
      source: seed.source, workshareCaseId: seed.workshare.caseId, planSha256: seed.workshare.planSha256,
      installationId: seed.installationId, expectedRevision: seed.expectedRevision,
      baseDocument, document};
    applyProgrammeChange({seed, document: baseDocument, change});
    files.set("native-programme-change.json", json(change));
  } else {
    for (const key of ["seed", "profile"]) if (!flags[key]) throw new Error("Select --" + key + ".");
    const seed = await read(flags.seed, files, "original-native-seed.json");
    const profile = readProfile(flags.profile).value;
    if (command === "programme") {
      for (const key of ["document", "commissioning", "calendar"])
        if (!flags[key]) throw new Error("Select --" + key + ".");
      const commissioning = await read(flags.commissioning, files, "original-commissioning.json");
      const sourceSha256 = seed.document?.workshare?.sourceSha256;
      if (typeof sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(sourceSha256) ||
          digest(files.get("original-commissioning.json")) !== sourceSha256)
        throw new Error("Select the complete original commissioning file whose bytes match the native seed workshare.sourceSha256.");
      const result = composeCustomerProgramme({
        seed, profile,
        document: await read(flags.document, files, "original-installation-document.json"),
        commissioning,
        calendarInput: await read(flags.calendar, files, "original-calendar-input.json"),
        selection: flags.selection ? await read(flags.selection, files, "original-commercial-selection.json") : undefined,
        taskBudget: flags["task-budget"] ? await read(flags["task-budget"], files, "original-task-budget.json") : undefined,
        nativeChange: flags["native-change"] ? await read(flags["native-change"], files, "original-native-change.json") : undefined,
        acceptedSave: flags["accepted-save"] ? await read(flags["accepted-save"], files, "original-accepted-save.json") : undefined
      });
      for (const [name, content] of programmeFiles(result)) files.set(name, content);
      files.set("installation-document.json", json(result.document));
      files.set("installation-preview.json", json({expectedVersion: seed.source.version,
        installationId: seed.installationId, expectedRevision: seed.expectedRevision, document: result.document}));
    } else if (command === "bindings") {
      files.set("bindings.json", json(native.bindingTemplate(seed, profile)));
      files.set("profile.json", json(profile));
    } else {
      for (const key of ["bindings", "calendar"]) if (!flags[key]) throw new Error("Select --" + key + ".");
      const result = composeInstallation({seed, profile, bindings: await read(flags.bindings, files, "original-bindings.json"), calendarInput: await read(flags.calendar, files, "original-calendar-input.json"), nativePrepare: native.prepareInstallation, nativeRender: native.renderWorkorder, taskBudget: flags["task-budget"] ? await read(flags["task-budget"], files, "original-task-budget.json") : undefined});
      files.set("installation-document.json", json(result.document));
      files.set("installation-preview.json", json(result.preview));
      files.set("composition.json", json(result));
      files.set("receiving.md", result.receivingMarkdown);
      files.set("calendar.json", json(result.calendar));
      files.set("calendar.csv", calendarCsv(result.calendar));
      if (result.taskBudget) files.set("task-budget.json", json(result.taskBudget));
    }
  }
  const manifest = {schema: "tjlabs.scf-commissioning-files.v1", command,
    files: [...files].map(([name, content]) => ({name, bytes: Buffer.byteLength(content), sha256: digest(content)}))};
  files.set("manifest.json", json(manifest));
  const out = path.resolve(flags.out);
  // Inputs are parsed and complete results prepared before this create-only write.
  await fs.mkdir(out, {mode: 0o700});
  for (const [name, content] of files) await fs.writeFile(path.join(out, name), content, {encoding: "utf8", flag: "wx", mode: 0o600});
  process.stdout.write(json({outputDirectory: out, files: [...files.keys()], status: "PREPARED"}));
}
main().catch(error => {process.stderr.write(error.message + "\n"); process.exitCode = 1;});
