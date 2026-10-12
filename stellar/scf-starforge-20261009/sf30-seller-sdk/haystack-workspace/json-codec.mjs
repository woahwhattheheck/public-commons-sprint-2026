// JSON serialization for native typed values, including signed zero, in Node and browsers.
function fail(message) { throw Object.assign(new TypeError(message), { code: "HAYSTACK_JSON_VALUE", status: 400 }); }
function serialize(value, space, sorted) {
  if (!Number.isSafeInteger(space) || space < 0 || space > 8) fail("Choose JSON indentation from zero to eight spaces.");
  const active = new Set(), unit = " ".repeat(space);
  const encode = (item, depth) => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("Use native Haystack encodings for non-finite numbers.");
      return Object.is(item, -0) ? "-0" : JSON.stringify(item);
    }
    if (typeof item !== "object") fail("Use complete JSON values.");
    if (active.has(item)) fail("JSON values cannot contain cycles.");
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      fail("Use plain JSON objects for native values.");
    active.add(item);
    let entries;
    if (array) entries = Array.from(item, element => encode(element === undefined ? null : element, depth + 1));
    else {
      const keys = Object.keys(item).filter(key => item[key] !== undefined);
      if (sorted) keys.sort();
      entries = keys.map(key => JSON.stringify(key) + (space ? ": " : ":") + encode(item[key], depth + 1));
    }
    active.delete(item);
    const open = array ? "[" : "{", close = array ? "]" : "}";
    return entries.length ? open + (space ? "\n" + unit.repeat(depth + 1) : "") +
      entries.join(space ? ",\n" + unit.repeat(depth + 1) : ",") +
      (space ? "\n" + unit.repeat(depth) : "") + close : open + close;
  };
  return encode(value, 0);
}
export const stringifyJson = (value, space = 0) => serialize(value, space, false);
export const canonicalJson = value => serialize(value, 0, true);
