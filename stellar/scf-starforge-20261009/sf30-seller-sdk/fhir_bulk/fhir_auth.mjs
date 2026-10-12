// MIT. SMART Backend Services assertion signing; credentials arrive through stdin only.
import { createPrivateKey, randomUUID, sign } from "node:crypto";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("Private assertion input exceeds one MiB");
}
try {
  const p = JSON.parse(input);
  if (!p || typeof p !== "object" || !["RS384", "ES384"].includes(p.algorithm) ||
      typeof p.clientId !== "string" || !p.clientId || typeof p.tokenEndpoint !== "string" ||
      !p.privateJwk || typeof p.privateJwk !== "object") throw new Error("Invalid configured assertion profile");
  const endpoint = new URL(p.tokenEndpoint);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))) throw new Error("Token endpoint requires TLS");
  const kid = p.kid ?? p.privateJwk.kid;
  if (typeof kid !== "string" || !kid || kid.length > 256) throw new Error("Registered signing key ID is required");
  if (p.algorithm === "RS384" && p.privateJwk.kty !== "RSA") throw new Error("RS384 requires the registered RSA key");
  if (p.algorithm === "ES384" && (p.privateJwk.kty !== "EC" || p.privateJwk.crv !== "P-384")) {
    throw new Error("ES384 requires the registered P-384 key");
  }
  const key = createPrivateKey({ key: p.privateJwk, format: "jwk" });
  if (p.algorithm === "RS384" && key.asymmetricKeyDetails?.modulusLength < 2048) {
    throw new Error("The registered RSA key must have at least 2048 bits");
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: p.algorithm, kid, typ: "JWT" };
  if (p.jwksUrl) {
    const url = new URL(p.jwksUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Registered JWKS URL requires HTTPS");
    header.jku = p.jwksUrl;
  }
  const payload = { iss: p.clientId, sub: p.clientId, aud: p.tokenEndpoint, exp: now + 240, jti: randomUUID() };
  const unsigned = encode(header) + "." + encode(payload);
  const signature = sign("sha384", Buffer.from(unsigned), p.algorithm === "ES384" ?
    { key, dsaEncoding: "ieee-p1363" } : key);
  process.stdout.write(JSON.stringify({ assertion: unsigned + "." + signature.toString("base64url"), expires: payload.exp }) + "\n");
} catch {
  // Never print a key, assertion input, client secret or provider access token in an error.
  process.stderr.write("The configured SMART assertion could not be signed; review its registered key and algorithm.\n");
  process.exitCode = 2;
}
