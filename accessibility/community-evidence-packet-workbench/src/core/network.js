/**
 * Static checks that the built page does not perform runtime network I/O.
 * Recording an IRI string (RO-Crate context) is not a fetch.
 */

const SECURITY_HTML_ENTITIES = new Map([
  ["bsol", "\\"],
  ["colon", ":"],
  ["newline", "\n"],
  ["sol", "/"],
  ["tab", "\t"],
]);

const SRCDOC_HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

const MAX_NESTED_DOCUMENT_DEPTH = 8;

function isSecurityUrlCodePoint(codePoint) {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    codePoint === 0x2f ||
    codePoint === 0x3a ||
    codePoint === 0x5c
  );
}

function decodeSecurityHtmlEntities(text) {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));?/gi,
    (match, hex, decimal, named) => {
      if (hex || decimal) {
        const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return match;
        }
        // The URL parser trims leading/trailing C0 controls and space. Preserve
        // TAB/LF/CR for the dedicated URL-whitespace pass; represent the other
        // leading C0 controls as space so a remote prefix cannot hide behind a
        // numeric character reference such as &#11;.
        if (codePoint > 0 && codePoint <= 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) {
          return " ";
        }
        if (!isSecurityUrlCodePoint(codePoint)) return match;
        return String.fromCodePoint(codePoint);
      }
      return SECURITY_HTML_ENTITIES.get(named.toLowerCase()) ?? match;
    },
  );
}

function decodeCssUrlEscapes(text) {
  const withoutLineContinuations = text.replace(/\\(?:\r\n|[\n\r\f])/g, "");
  return withoutLineContinuations.replace(
    /\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^0-9a-f\r\n\f])/gi,
    (match, hex, escaped) => {
      const codePoint = hex ? Number.parseInt(hex, 16) : escaped.codePointAt(0);
      if (!Number.isInteger(codePoint) || !isSecurityUrlCodePoint(codePoint)) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function normalizeUrlSchemeControls(text) {
  const withoutSchemeControls = text.replace(
    /h[\t\n\r]*t[\t\n\r]*t[\t\n\r]*p(?:[\t\n\r]*s)?[\t\n\r]*:/gi,
    (match) => match.replace(/[\t\n\r]/g, ""),
  );
  // The basic URL parser removes ASCII TAB/LF/CR before parsing, including in
  // a protocol-relative prefix. Mirror just that prefix-relevant transform.
  return withoutSchemeControls.replace(/\/[\t\n\r]*\//g, (match) =>
    match.replace(/[\t\n\r]/g, ""),
  );
}

function securityScanText(source) {
  const text = String(source ?? "");
  // Browser URL-bearing values resolve character references before URL parsing,
  // while CSS resolves identifier/string escapes before url()/@import. Decode
  // only URL-significant characters in a scan-only copy: structural entities
  // such as &lt; and &quot; must NOT become markup delimiters here because HTML
  // does not re-tokenize decoded character references as source syntax.
  return normalizeUrlSchemeControls(
    decodeCssUrlEscapes(decodeSecurityHtmlEntities(text)),
  );
}

function javascriptCodeText(source) {
  const text = String(source ?? "");
  let output = "";
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] ?? "";

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        blockComment = false;
      } else {
        output += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }

    if (quote !== null) {
      output += char === "\n" || char === "\r" ? char : " ";
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      blockComment = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += " ";
      continue;
    }

    output += char;
  }

  return output;
}

function decodeSrcdocHtml(value) {
  // srcdoc is different from ordinary attribute text: the browser decodes the
  // outer attribute once, then parses the resulting value as a new HTML
  // document. Mirror exactly one character-reference pass so `&amp;lt;` remains
  // literal `&lt;` text in the nested document rather than becoming a tag.
  return String(value ?? "")
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (match, hex, decimal) => {
      const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&(amp|apos|gt|lt|quot);/gi, (match, named) =>
      SRCDOC_HTML_ENTITIES.get(named.toLowerCase()) ?? match,
    );
}

function parseHtmlAttributes(source) {
  const attributes = new Map();
  // HTML reports characters such as '=' in an unquoted value as parse errors,
  // but still appends them to the value. Retain '=' so meta-refresh recovery is
  // scanned the same way browsers recover it.
  const pattern = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
}

function scanHtmlStartTags(source) {
  const tags = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open === -1) break;
    let index = open + 1;
    if (!/[A-Za-z]/.test(source[index] ?? "")) {
      cursor = index;
      continue;
    }
    const nameStart = index;
    while (/[A-Za-z0-9:-]/.test(source[index] ?? "")) index += 1;
    const name = source.slice(nameStart, index).toLowerCase();
    const attributesStart = index;
    let quote = null;
    while (index < source.length) {
      const char = source[index];
      if (quote !== null) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        tags.push({
          name,
          attributes: parseHtmlAttributes(source.slice(attributesStart, index)),
        });
        index += 1;
        break;
      }
      index += 1;
    }
    cursor = Math.max(index, open + 1);
  }
  return tags;
}

function isRemoteSingleUrl(value) {
  return /^\s*(?:https?:|\/\/)/i.test(value);
}

function listContainsRemoteUrl(value, separator) {
  return value
    .split(separator)
    .some((part) => isRemoteSingleUrl(part.trim().split(/\s+/)[0] ?? ""));
}

function passiveHtmlRisks(source, depth) {
  const risks = [];
  const singleUrlAttributes = new Map([
    ["script", ["src"]],
    ["link", ["href"]],
    ["img", ["src"]],
    ["iframe", ["src"]],
    ["frame", ["src"]],
    ["audio", ["src"]],
    ["video", ["src", "poster"]],
    ["source", ["src"]],
    ["track", ["src"]],
    ["embed", ["src"]],
    ["input", ["src", "formaction"]],
    ["button", ["formaction"]],
    ["object", ["data"]],
    ["form", ["action"]],
    ["base", ["href"]],
    ["image", ["href", "xlink:href"]],
    ["use", ["href", "xlink:href"]],
    ["body", ["background"]],
    ["table", ["background"]],
    ["td", ["background"]],
    ["th", ["background"]],
  ]);

  for (const { name, attributes } of scanHtmlStartTags(source)) {
    for (const attribute of singleUrlAttributes.get(name) ?? []) {
      if (attributes.has(attribute) && isRemoteSingleUrl(attributes.get(attribute))) {
        risks.push(`passive:${name}:${attribute}`);
      }
    }
    if (name === "iframe" && attributes.has("srcdoc")) {
      if (depth >= MAX_NESTED_DOCUMENT_DEPTH) {
        risks.push("passive:iframe:srcdoc-depth");
      } else {
        const nestedDocument = decodeSrcdocHtml(attributes.get("srcdoc"));
        if (networkRisksAtDepth(nestedDocument, depth + 1).length) {
          risks.push("passive:iframe:srcdoc");
        }
      }
    }
    if (
      (name === "img" || name === "source") &&
      attributes.has("srcset") &&
      listContainsRemoteUrl(attributes.get("srcset"), ",")
    ) {
      risks.push(`passive:${name}:srcset`);
    }
    if (
      name === "a" &&
      attributes.has("ping") &&
      listContainsRemoteUrl(attributes.get("ping"), /\s+/)
    ) {
      risks.push("passive:a:ping");
    }
    if (
      name === "meta" &&
      (attributes.get("http-equiv") ?? "").trim().toLowerCase() === "refresh"
    ) {
      const content = attributes.get("content") ?? "";
      if (/(?:^|[;\s])url\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(content)) {
        risks.push("passive:meta:refresh");
      }
    }
  }
  return risks;
}

const FORBIDDEN = [
  /\bfetch\s*(?:\?\.)?\s*\(/,
  /\b(?:globalThis|window|self)\s*\[\s*["']fetch["']\s*\]/,
  /\bXMLHttpRequest\b/,
  /\bnavigator\.sendBeacon\s*\(/,
  /\bWebSocket\s*\(/,
  /\bEventSource\s*\(/,
  /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:img|iframe|audio|video|source|track|embed|input)\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:img|source)\b[^>]*\bsrcset\s*=\s*(?:["'][^"']*|[^\s>]*)?(?:https?:|\/\/)/i,
  /<video\b[^>]*\bposter\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<object\b[^>]*\bdata\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<form\b[^>]*\baction\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:input|button)\b[^>]*\bformaction\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<base\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:image|use)\b[^>]*\b(?:href|xlink:href)\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<(?:body|table|td|th)\b[^>]*\bbackground\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<a\b(?=[^>]*\bping\s*=\s*(?:"[^"]*(?:https?:|\/\/)|'[^']*(?:https?:|\/\/)|[^\s>]*(?:https?:|\/\/)))[^>]*>/i,
  /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:["']?\s*refresh\s*["']?))(?=[^>]*\bcontent\s*=\s*(?:"[^"]*\burl\s*=\s*[^"]*(?:https?:|\/\/)|'[^']*\burl\s*=\s*[^']*(?:https?:|\/\/)|[^\s>]*\burl\s*=\s*[^\s>]*(?:https?:|\/\/)))[^>]*>/i,
  /!\[[^\]\r\n]*\]\(\s*(?:<\s*)?(?:https?:|\/\/)/i,
  /@import\s+(?:url\(\s*)?["']?\s*(?:https?:|\/\/)/i,
  /url\(\s*["']?\s*(?:https?:|\/\/)/i,
  /fonts\.googleapis/i,
  /cdn\.jsdelivr/i,
  /unpkg\.com/i,
];

function networkRisksAtDepth(source, depth) {
  const text = securityScanText(source);
  const hits = new Set();
  for (const re of FORBIDDEN) {
    if (re.test(text)) hits.add(re.toString());
  }
  if (/\bfetch\b/.test(javascriptCodeText(text))) {
    hits.add("javascript:fetch-reference");
  }
  for (const risk of passiveHtmlRisks(text, depth)) hits.add(risk);
  return [...hits];
}

export function networkRisks(source) {
  return networkRisksAtDepth(source, 0);
}

export function assertNoRuntimeNetwork(source) {
  const hits = networkRisks(source);
  if (hits.length) {
    const err = new Error("runtime-network-pattern:" + hits.join(","));
    err.hits = hits;
    throw err;
  }
  return true;
}
