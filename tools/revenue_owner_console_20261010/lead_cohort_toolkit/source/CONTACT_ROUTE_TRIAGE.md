# Published business route and DNS triage

Use this helper inside the existing company case when a published contact needs review, or after an actual delivery failure. It prepares evidence for the existing sender. It does not send mail, probe SMTP, submit forms, change a buyer address, create a global hold or certify a mailbox.

| Question | Evidence | Meaning |
| --- | --- | --- |
| What address did the company publish? | Original public HTML/text, exact excerpt, mailto/Cloudflare encoding and explicit purpose review | A candidate business route, subject to identity and purpose |
| What does DNS say at the recorded time? | Complete retained DNS JSON with original question and answer chain | Domain routing evidence, never a mailbox test |
| What happened to the actual message? | Existing maintained feedback parser, original ledger and native sources | A matched outcome for a specific delivery and recipient |

An address can be published and have MX records while the mailbox returns a permanent failure. A DNS error can be transient. Absent MX can still allow SMTP address-record fallback. Keep these observations separate.

## Run the complete source

Node 18 or later; no added package dependency.

    node course/contact-route-triage.cjs
    node native/triage-contact-route.mjs course/contact-route-example.json /absolute/new-route-review

The example is authored and uses reserved domains. It performs no network request. Its timestamps are fixture values, not claimed retrievals.

The CLI produces the complete original input, each source body as an ordinary file, a byte/hash index, JSON and readable Markdown reports, and complete portable source. It uses the existing create-only publisher. Exact retry verifies existing bytes; changed input belongs in a different output directory. Input limit is 64 MiB; each source body is limited to 20 MiB. Symlink input is rejected. Output must be independent of original input and maintained source.

Original text means the exact retained UTF-8 string obtained from the provider. A rendered/readability capture is not described as original HTTP bytes. Retain the capture method and provider response in the case.

## Input contract

Top-level schema: commons.contact-route-triage.v1.input

Required fields:

- caseReference: existing company case identifier.
- checkedAt: explicit timestamp with offset.
- documents: complete public contact sources.
- dns: retained DNS JSON observations; an empty array is allowed.
- reviews: explicit candidate purpose reviews; an empty array is allowed.

Each document has id, url, retrievedAt, format and body. If only the observed retrieval date is retained, set retrievedAt to null and supply retrievedDate as YYYY-MM-DD; do not invent a timestamp. Format is html or text. A DNS source has the same fields, format dns-json, plus domain and type (MX/A/AAAA or 15/1/28). Body is the complete original JSON text. IDs must be unique across lists. Do not replace a failed provider response with invented successful DNS.

Run first without reviews, then select an extracted candidateId. A review contains reviewedBy, reviewedAt, companyIdentityEvidence, businessPurpose and disposition (appropriate/unsuitable/uncertain). Identity and purpose notes should cite actual company/legal/contact context. Privacy, abuse, applicant and support routes are not automatically suitable for supplier introductions. A visible-versus-target mismatch also requires resolvedMismatchEvidence.

Extraction preserves every occurrence and source context. It decodes common HTML entities, exact mailto targets and Cloudflare XOR hex. Mailto query parameters remain evidence but do not become recipients. The local part stays exact; only domain case is normalized. Quoted local parts, address literals and SMTPUTF8 local parts are deliberately unsupported. Unicode domains need the injected host IDNA converter; native CLI uses Node domainToASCII.

This is a conservative HTML scanner, not a rendered-browser visibility test. It excludes comments, scripts, styles, templates, noscript bodies and input placeholders. Other text still needs visibility and business-purpose review. It does not invent [at]/[dot] expansions, role aliases or addresses from names.

## DNS interpretation

Use a read-only public resolver or another authorized existing DNS tool, then retain complete JSON and request URL. For example:

    https://dns.google/resolve?name=DOMAIN&type=MX

The CLI does not fetch URLs. The parser binds exact Question name/type and accepts Answer records owned by that name or its explicit CNAME chain. Unrelated answers are ignored with a diagnostic. Conflicting aliases, cycles, malformed records, question mismatches and truncated responses cannot establish a route. AD/CD flags, TTLs, complete body and capture time remain visible; no freshness or DNSSEC guarantee is made.

| State | Interpretation |
| --- | --- |
| MX_PUBLISHED | Routing records published; exchanger address/reachability, SMTP service and mailbox unverified. |
| NULL_MX | Exactly one MX record 0 . advertises no email service. |
| INCONSISTENT | Mixed/null MX, nonzero null preference, CNAME collision or loop; inspect originals. |
| NXDOMAIN | Resolver reports requested name or its recorded CNAME target nonexistent at that observation. |
| SERVFAIL / REFUSED / DNS_ERROR | Resolver failure/refusal/other error; not proof of domain absence. |
| NO_MX | No MX in response. SMTP implicit A/AAAA fallback remains possible. |
| NO_MX_ADDRESS_FALLBACK | Retained A/AAAA supplies an address; SMTP/mailbox still unknown. |
| NO_MX_FALLBACK_UNKNOWN | Fallback not established; not a no-mail conclusion. |
| NO_MX_NO_ADDRESS | Both address families absent in supplied observations; review timestamps/resolvers. |
| DIFFERING_OBSERVATIONS | Retained observations disagree; do not silently overwrite one. |
| NOT_CHECKED | No DNS witness supplied. This is not a new permission requirement. |

DNS observations are point-in-time evidence. The helper does not replace provider retry or decide whether a separately authorized first contact may proceed.

## Join actual delivery evidence

Use native/receive-delivery-feedback.mjs for original source receipt and ledger history. This helper is read-only and does not reparse DSNs or accept an invented derived diagnosis.

Optional currentAddress selects the exact original recipient. Optional feedback contains:

- ledger: complete maintained ledger, normally obtained from recorder replay of this programme.
- input: unchanged feedback parser input (mailbox, pack_id, reports, sent_messages).
- selectedFeedbackIds: actual IDs from its validated preview for the selected delivery.

The helper recomputes and validates the maintained portable Gmail preview. Unmatched/review-required sources need resolution in the existing receiver. Hand-written feedback arrays or SMTP-looking strings are not delivery authority. An empty selection exposes recovery.availableFeedback without claiming failure; choose matching IDs in a new retained input.

A matched terminal failure permits review of a distinct published alternate; it does not authorize a send. A delayed event retains original-attempt reconciliation and provider retry-until time. Passing that time does not manufacture final failure. Delivered, relayed and expanded remain distinct actions, not evidence of human reading or a favorable reply. Multiple selected outcomes remain retained without last-write-wins rewriting.

Before separately authorized action, the original sender checks current company history and ownership, including later notices or human replies. The helper has no live inbox and cannot know about omitted evidence. Record that refresh in the original case; favorable relationships remain with their designated owner.

## Actual-failure recovery procedure

1. Preserve original accepted send and actual final/temporary notice in the existing delivery ledger.
2. Read the current official contact/legal/product page and retain the complete source. Use exact published email or independently inspect a general/business contact form.
3. Review identity, purpose and visible-versus-target disagreement. A form action is a technical endpoint, not submission permission; retain displayed purpose, fields and destination.
4. Compare routing evidence with actual recipient outcome. A different published mailbox on the same MX-bearing domain remains untested.
5. Give the existing sender original outcome, distinct candidate, source excerpt, purpose and refreshed history. Keep old recipient/receipt intact. An approved route correction uses existing pack-save and historical receipt workflow in ROUTE_RECOVERY.md.

No outbound API, alias generator, SMTP verification or automatic form submission is provided.

## Portable API and ordinary-source integration

createContactRouteTriage() exposes extractPublishedRoutes(source), interpretDNS(source), summarizeDNS(domain, observations), triage(input), render(report), plus conservative address/domain/decodeCloudflare helpers. Default implementation uses existing byte/hash/Gmail modules. Native hosts can inject encode, hash and domainToASCII; hash returns a SHA-256 hexadecimal string.

Full cohort preparation, actual-delivery and feedback successor creation carry this helper. It does not change customer exports, message composition, sender payload or ledger operations. Existing programmes can adopt current helper source while retaining predecessors.

## Primary protocol references

- RFC 5321 §5.1, target host lookup/implicit MX: https://www.rfc-editor.org/rfc/rfc5321.html#section-5.1
- RFC 7505 §3, exact null MX/no other MX: https://www.rfc-editor.org/rfc/rfc7505.html#section-3
- Google DNS JSON schema: https://developers.google.com/speed/public-dns/docs/doh/json
- Cloudflare public email-obfuscation behavior: https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/

Public fixtures are authored protocol examples. Real company names, mailboxes, provider outcomes, case identities and complete correspondence stay private.
