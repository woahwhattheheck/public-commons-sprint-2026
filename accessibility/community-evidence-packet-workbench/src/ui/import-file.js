import { importPacket } from "../core/packet.js";

function importFailureCode(error) {
  if (error instanceof SyntaxError) return "INVALID_JSON";
  if (error?.message === "packet-must-be-object") return "PACKET_MUST_BE_OBJECT";
  return "PACKET_IMPORT_FAILED";
}

export async function importPacketFile(file, currentPacket) {
  try {
    if (!file || typeof file.text !== "function") {
      throw new TypeError("packet-import-file-required");
    }
    const packet = importPacket(await file.text());
    return {
      ok: true,
      packet,
      message: "Packet JSON imported locally.",
    };
  } catch (error) {
    return {
      ok: false,
      packet: currentPacket,
      message: `Import failed locally: ${importFailureCode(error)}. Existing packet kept.`,
    };
  }
}
