// Original archive bytes remain immutable. Browser selections do not change the collector.
export interface ArchiveEntry {
  sha256: string
  name: string
  bytes: number
  importedAt: string
}
interface OriginalArchive extends ArchiveEntry {
  blob: Blob
}
const DATABASE = "strata-servicing-originals-v1"
let opening: Promise<IDBDatabase> | null = null
const errorOf = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(fallback)

function database(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    let abandoned = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("originals"))
        db.createObjectStore("originals", { keyPath: "sha256" })
      if (!db.objectStoreNames.contains("entries"))
        db.createObjectStore("entries", { keyPath: "sha256" })
    }
    request.onblocked = () => {
      abandoned = true
      opening = null
      reject(new Error("Close another tab using the older history store, then reopen this archive."))
    }
    request.onerror = () => {
      opening = null
      reject(errorOf(request.error, "The browser archive store could not open."))
    }
    request.onsuccess = () => {
      const db = request.result
      if (abandoned) { db.close(); return }
      db.onversionchange = () => { db.close(); opening = null }
      db.onclose = () => { opening = null }
      resolve(db)
    }
  })
  return opening
}

export async function digestBlob(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer()
  const result = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("")
}

/** Called only after the complete selected archive passed the shared model's validation. */
export async function retainArchive(
  blob: Blob,
  original: ArchiveEntry,
): Promise<{ entry: ArchiveEntry; alreadySaved: boolean }> {
  if (blob.size !== original.bytes || !/^[0-9a-f]{64}$/.test(original.sha256))
    throw new Error("The selected original changed before saving.")
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["originals", "entries"], "readwrite")
    const entries = tx.objectStore("entries")
    const originals = tx.objectStore("originals")
    let result = { entry: original, alreadySaved: false }
    let failed: Error | null = null
    const existing = entries.get(original.sha256)
    existing.onsuccess = () => {
      try {
        const retained = existing.result as ArchiveEntry | undefined
        if (retained) {
          if (retained.bytes !== original.bytes)
            throw new Error("The browser has a conflicting original archive descriptor.")
          result = { entry: retained, alreadySaved: true }
        } else {
          originals.add({ ...original, blob } satisfies OriginalArchive)
          entries.add(original)
        }
      } catch (error) {
        failed = errorOf(error, "The original archive could not be saved.")
        tx.abort()
      }
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => { failed ??= errorOf(tx.error, "The browser could not retain this archive.") }
    tx.onabort = () => reject(failed ?? errorOf(tx.error, "The original archive was not saved."))
  })
}

export async function listArchives(): Promise<ArchiveEntry[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("entries", "readonly")
    const request = tx.objectStore("entries").getAll()
    let rows: ArchiveEntry[] = []
    request.onsuccess = () => { rows = request.result as ArchiveEntry[] }
    tx.oncomplete = () => resolve(rows.sort((a, b) => b.importedAt.localeCompare(a.importedAt)))
    tx.onabort = () => reject(errorOf(tx.error, "The saved archive list could not be read."))
    tx.onerror = () => reject(errorOf(tx.error, "The saved archive list could not be read."))
  })
}

export async function reopenArchive(sha256: string): Promise<OriginalArchive> {
  const db = await database()
  const original = await new Promise<OriginalArchive>((resolve, reject) => {
    const tx = db.transaction("originals", "readonly")
    const request = tx.objectStore("originals").get(sha256)
    let row: OriginalArchive | undefined
    request.onsuccess = () => { row = request.result as OriginalArchive | undefined }
    tx.oncomplete = () => row
      ? resolve(row)
      : reject(new Error("The selected original is missing from this browser. Import its complete file again."))
    tx.onabort = () => reject(errorOf(tx.error, "The selected original could not be read."))
    tx.onerror = () => reject(errorOf(tx.error, "The selected original could not be read."))
  })
  if (original.sha256 !== sha256 || !(original.blob instanceof Blob)
    || original.blob.size !== original.bytes || await digestBlob(original.blob) !== sha256)
    throw new Error("The saved original failed its complete byte check. Import the original file again.")
  return original
}

export function downloadOriginal(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name.replace(/[\\/\x00-\x1f\x7f]/g, "_") || "strata-history.json"
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadJSON(value: unknown, name: string): void {
  downloadOriginal(new Blob([(JSON.stringify(value, null, 2) ?? "null") + "\n"], {
    type: "application/json;charset=utf-8",
  }), name)
}
