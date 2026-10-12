import { promises as fs, constants as FS } from "node:fs";
import { dirname } from "node:path";
import { need, sha256, newId } from "./util.mjs";

export async function exists(path) {
  try { await fs.lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
export async function plainRead(path, maximum = 192 * 1024 * 1024) {
  const file = await fs.open(path, FS.O_RDONLY | (FS.O_NOFOLLOW || 0));
  try {
    const stat = await file.stat();
    need(stat.isFile() && stat.size <= maximum, "Read a complete regular file within its declared byte limit.", "HAYSTACK_FILE", 413);
    const bytes = await file.readFile();
    need(bytes.length <= maximum, "The complete file exceeds its byte limit.", "HAYSTACK_SIZE", 413);
    return bytes;
  } finally { await file.close(); }
}
export async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const directory = await fs.open(path, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
export async function atomicWrite(path, bytes) {
  const temporary = path + ".pending-" + newId(); let file;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    await fs.rename(temporary, path); await syncDirectory(dirname(path));
  } finally {
    if (file) await file.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
export async function createOnlyFile(path, bytes) {
  const expected = Buffer.from(bytes), temporary = path + ".pending-" + newId(); let file;
  try {
    file = await fs.open(temporary, "wx", 0o600); await file.writeFile(expected); await file.sync(); await file.close(); file = null;
    try { await fs.link(temporary, path); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const original = await plainRead(path, expected.length);
      need(original.length === expected.length && sha256(original) === sha256(expected), "An existing complete file belongs to different bytes.", "HAYSTACK_FILE_CONFLICT", 409);
    }
    await syncDirectory(dirname(path));
  } finally {
    if (file) await file.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
