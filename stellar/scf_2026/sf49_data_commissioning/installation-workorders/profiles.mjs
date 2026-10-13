/** Discover complete installation profiles from the selected installed source. */
import {lstatSync, readFileSync, readdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const schema = "stellar-forge.installation-workorder-profile.v1";
const maximum = 2 * 1024 * 1024;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const isProfileId = value => typeof value === "string" && /^[a-z][a-z0-9-]+$/.test(value);

function inspect(id, required) {
  if (!isProfileId(id)) throw new Error("Use a maintained installation profile ID.");
  const path = join(here, id + ".json");
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error("Unknown installation profile: " + id + ". Run prepare.mjs profiles to see the installed choices.");
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
    throw new Error("Use a complete regular installed profile up to 2 MiB: " + path);
  const raw = readFileSync(path);
  if (raw.length > maximum) throw new Error("Installed profile exceeds 2 MiB: " + path);
  let value;
  try { value = JSON.parse(raw.toString("utf8")); }
  catch { throw new Error("Installed profile is not complete JSON: " + path); }
  if (!record(value) || value.schema !== schema) {
    if (!required) return null;
    throw new Error("Select an installed workorder profile with schema " + schema + ".");
  }
  if (value.id !== id || typeof value.title !== "string" || !value.title.trim() ||
      !["task", "source", "receiving"].every(key => record(value[key])) ||
      !Array.isArray(value.steps) || !value.steps.length ||
      !value.steps.every(step => record(step) && typeof step.title === "string" &&
        step.title.trim() && typeof step.result === "string" && step.result.trim()) ||
      !Array.isArray(value.inputs) || !Array.isArray(value.sourceFiles))
    throw new Error("Installed profile must retain its matching ID and complete task, source, receiving and implementation: " + path);
  return {value, source: {path, bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex")}};
}

export function readProfile(id) { return inspect(id, true); }

export function profileCatalog() {
  const entries = readdirSync(here, {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => entry.name.slice(0, -5)).filter(isProfileId).sort();
  const profiles = [];
  for (const id of entries) {
    const profile = inspect(id, false);
    if (profile) profiles.push({id: profile.value.id, title: profile.value.title,
      source: profile.source});
  }
  return profiles;
}
