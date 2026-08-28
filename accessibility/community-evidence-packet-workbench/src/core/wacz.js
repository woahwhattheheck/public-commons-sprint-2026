/**
 * WACZ is recognized only as an opaque attachment.
 * This module does not unpack, replay, or validate WARC/WACZ internals.
 */

const WACZ_EXT = /\.wacz$/i;
const WACZ_TYPE = "application/x-wacz";

export function isWaczFilename(name) {
  return WACZ_EXT.test(String(name || ""));
}

export function isWaczMediaType(type) {
  const t = String(type || "").toLowerCase();
  return t === WACZ_TYPE || t === "application/wacz" || t === "application/x-wacz+zip";
}

export function recognizeAttachment(filename, mediaType) {
  const wacz = isWaczFilename(filename) || isWaczMediaType(mediaType);
  if (!wacz) {
    return {
      kind: "file",
      recognizedAs: "file",
      note: "",
    };
  }
  return {
    kind: "wacz-attachment",
    recognizedAs: "wacz-opaque",
    note: "Recognized as a WACZ filename or media type. Stored as an opaque attachment. This workbench does not open, validate, replay, or certify the archive.",
  };
}

export const WACZ_POLICY =
  "WACZ files are accepted only as opaque attachments. Presence of a .wacz suffix is not validation of Web Archive Collection Zipped contents.";
