// MIT. Full saved requests, original return bytes and recipient-facing editable documents.
import { digest } from "./model.mjs";
import { RECIPIENT_RUNTIME, RECIPIENT_STYLE } from "./review-return-editor.mjs";
import { ReviewReturnError } from "./review-return.mjs";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = value => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
export function editableReviewDocument(request) {
  const seed = { request, itemHashes: Object.fromEntries(request.source.items.map(row => [row.id, digest(row)])), draft: null, exported: null };
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'\">" +
    "<title>" + escape(request.source.title) + " — Review response</title><style>" + RECIPIENT_STYLE + "</style></head><body><main>" +
    "<p class=\"muted\">OPENLINEAGE · CUSTOMER REVIEW RESPONSE</p><h1>" + escape(request.source.title) + "</h1>" +
    "<p class=\"notice\">Review the saved edition, enter your response and download the complete response JSON. Download the editable document to carry your entries to another device.</p>" +
    "<div class=\"toolbar\"><button id=\"return-json\" class=\"primary\">Download response JSON</button><button id=\"editable-html\">Download editable document</button>" +
    "<button id=\"working-json\">Download working JSON</button><label class=\"file-label\">Open working copy<input id=\"import\" type=\"file\" accept=\".json,application/json\"></label>" +
    "<button id=\"recover\">Restore browser copy</button><button id=\"print\">Print review</button></div><p id=\"status\" role=\"status\" aria-live=\"polite\"></p>" +
    "<div id=\"review-editor\"></div><noscript>Enable JavaScript in this local document to enter your response. The operator can also supply the complete original JSON review.</noscript>" +
    "</main><script id=\"review-data\" type=\"application/json\">" + json(seed) + "</script><script>" + RECIPIENT_RUNTIME + "</script></body></html>";
}
export function reviewReturnReport(request, responses, format = "json") {
  if (format === "editable") return { mediaType: "text/html;charset=utf-8", name: "review-" + request.id + "-editable.html", text: editableReviewDocument(request) };
  const body = { schema: "commons.openlineage.review-return-history.v1", request, responses };
  if (format === "json") return { mediaType: "application/json", name: "review-" + request.id + "-complete-history.json", text: JSON.stringify(body, null, 2) + "\n" };
  if (format !== "html") throw new ReviewReturnError("Choose editable, json or html");
  const sections = responses.map(row => "<article><h2>Response from " + escape(row.response.respondent.name) + "</h2><p>" +
    escape(row.response.overall) + " · " + escape(row.response.respondedAt) + "</p><p>" + escape(row.response.comment) +
    "</p><p>Received by " + escape(row.receivedBy) + " · " + escape(row.createdAt) + "</p><p>" + escape(row.operatorNote) + "</p>" +
    row.response.items.map(item => "<section><h3>" + escape(request.source.items.find(source => source.id === item.itemId).title) + "</h3><p>" +
      escape(item.response) + "</p><p>" + escape(item.comment) + "</p></section>").join("") +
    "<details><summary>Exact received JSON text</summary><pre>" + escape(row.originalText) + "</pre></details></article>").join("");
  return { mediaType: "text/html;charset=utf-8", name: "review-" + request.id + "-complete-history.html",
    text: "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>" + escape(request.source.title) +
      " — Returned review history</title><style>" + RECIPIENT_STYLE + "</style></head><body><main><h1>" + escape(request.source.title) +
      "</h1><p>Intended recipient: " + escape(request.recipient.name) + " · " + escape(request.recipient.organisation) + "</p><p>" +
      escape(request.instructions) + "</p><p>Saved review " + escape(request.source.reviewId) + " · Request " + escape(request.id) + "</p>" +
      (sections || "<p>No response has been received for this request.</p>") +
      "<details><summary>Complete original request and retained response history</summary><pre>" + escape(JSON.stringify(body, null, 2)) +
      "</pre></details></main></body></html>" };
}
