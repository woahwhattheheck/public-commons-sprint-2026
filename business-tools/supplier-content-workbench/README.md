# Supplier content workbench

A local supplier-content operations application for a qualified grocery-platform partner. It receives original supplier files, validates identifiers and source completeness, records review and resubmission, retains approved product editions, maps those exact editions into versioned outbound files, records explicit file-bound acknowledgments, and transfers the complete private operation to another installation.

This is an integration workbench. Production platform licensing, GS1 data-pool connectivity, identity federation, authorized hosting, government interface agreements, and live enterprise synchronization belong to the qualified prime's deployment. No government endpoint or security authorization is asserted by this application.

## Open

Python 3.11 or later, using only its standard library:

    python3 server.py --state /private/supplier-workspace --port 0

Open the printed loopback URL. The first operator creates the initial administrator once. Supplier administrators can then manage accounts within their supplier; reviewers handle source decisions, approved editions, mappings and releases. Administrators manage suppliers and complete receiving. Passwords are salted and derived with scrypt. Users can enroll a six-digit TOTP authenticator. This local host deliberately binds to the printed loopback address; a qualified platform deployment must integrate its own identity and security boundary.

Keep the same state directory to continue an operation. Its exclusive process lock prevents two hosts from opening it at once. Each completed mutation and its exact response are committed in one SQLite transaction. Retain the Idempotency-Key and original body after an uncertain response; request recovery returns the original result. The browser saves ordinary pending actions locally. It keeps passwords and authenticator codes only in memory, and credential-bearing server requests use a slow salted fingerprint for retry matching.

## Original supplier intake

Supply UTF-8 CSV/TSV, XLSX, JSON item arrays, XML, or a ZIP containing original documents and images. Individual source files and complete portable ZIPs support up to 48 MiB; ZIP expansion supports up to 96 MiB. Producers check these same receiving limits before returning a release or complete package. Required top-level item fields are name and an explicit original identifier. GTIN is the default. For a nonstatic or random-weight catalogue item without a GTIN, use identifier_type=supplier, retain its actual text identifier and identifier_namespace, and include the source explanation in identifier_note. This does not assign a global GTIN. Retain provider_gln where available. Other normalized fields are brand, description, ingredients, allergens, net_content, dimensions, packaging, images and nutrition. All original fields also remain in the attribute inventory and the complete unchanged source file.

CSV identifiers and JSON identifiers must be strings. XLSX identifiers must be text cells. Numeric identifiers are explicitly rejected for approval because lost leading zeroes cannot be reconstructed reliably. XLSX formulas, cached values and actual worksheet row references are retained; the reader does not recalculate workbooks. Duplicate JSON keys, repeated worksheet cells, malformed CSV and damaged ZIP members remain correctable source cases with their original files.

The Syndigo/1WorldSync parser recognizes the original namespaced envelope with unqualified header, catalogueRequest, document and item children. It retains message/document identity, operation, original GTIN and information-provider GLN, target markets, all attribute qualifiers and source order. Repeated values keep their native paths. Catalogue responses retain originating message/document identity and every error description. They never turn an intake into an approved product.

A publisher ZIP may include both ItemADD and ItemMODIFY examples for the same identifier and unrelated publication response examples. That full ZIP remains a useful original-source inspection, with explicit duplicate-edition findings. Import the intended original item document separately for a product decision. Keep publisher examples labeled as documentation data throughout the case.

Local review checks include GS1 GTIN/GLN check digits, selected supplier identity, product name, mapped content completeness, workbook formulas, duplicate item operations and available PNG/JPEG image dimensions. The 600×600 image review baseline is a local starting assumption, not a DeCA acceptance requirement. Schema editions remain separate: the captured publisher sample set is IM8.73 and its currently linked XSD ZIP is named IM8.61. This reader does not claim a full XSD or GS1 data-pool certification.

## Review and revise

Open an intake to inspect its normalized item, source attributes, findings, messages and unchanged original file. A reviewer rejects with a concrete note, or approves after all errors are resolved and remaining warnings are explicitly acknowledged. Each decision is revision-bound. A corrected source is a new child submission; original bytes and decisions remain available.

Approval creates immutable product editions. History exposes the original submission and source identity for every edition. Preparing a release selects explicit approved editions, so a later product revision cannot silently alter an existing outbound file.

## Map and release

A mapping contains a name, target, format and explicit source/target fields. Saving the same name and target creates its next immutable version. Standard fields use dot paths, such as gtin or dimensions.width. Use attributes.NAME only for a unique native name; repeated native fields require native: followed by the exact inventory path. Nested objects and lists remain JSON values in JSON releases, and exact JSON text inside CSV cells.

Preview mappings before preparing a release. Required absent values prevent release; optional absent values remain visible findings. The target name describes the actual agreed or proposed adapter contract. It does not invent SAP ARTS, FreshOp, Oracle, POS or government schemas.

Download the retained release file for the agreed transfer route. Record the actual response reference and note against the exact released SHA-256. An acknowledgment is explicitly operator-recorded; downloading a file does not claim remote delivery or acceptance. Full release, mapping, product and response history remains available.

CSV output preserves original values, including identifiers and potentially spreadsheet-active strings. Import every column as text in spreadsheet software. Do not execute supplier values as formulas.

## Complete receiving

An administrator downloads a complete private backup. It includes this application's source, the original database, supplier files, all source/review/product/mapping/release history, user password hashes and authenticator enrollment. Active login sessions are removed only from the exported copy.

Use a separately trusted copy of this application to inspect an incoming package:

    python3 server.py receive original-complete.zip --directory /private/receiving --sha256 EXACT_ARCHIVE_SHA256

The trusted receiver checks the complete archive member set, each exact byte count/hash, SQLite schema and integrity, supplier source projections, product/source bindings, release/mapping history, acknowledgments and operation history. It writes a new directory named for the incoming archive. It never overwrites the original operation and never executes code from an incoming archive.

Then open the state directory in the receiving result:

    python3 server.py --state /private/receiving/received-HASH/state --port 0

Sign in again using the retained account credentials. A repeated receive of the same untouched original archive reopens its receiving receipt. Once that received workspace advances, preserve its current state and use the receipt to locate it.

## DeCA workshare context

The Oct9 amended notice for W9128Z-26-R-DeCA-EPC gives 13 October 2026, 10:00 EDT as the Phase I deadline. Official notice: https://sam.gov/opp/e42e7d3fd9b84604ad1eac94f47eec98/view

Call section3.4 and Q23/Q33 allow a standalone supplier-collaboration and integration AOI4 solution with a temporary staging/review repository and an agreed interface to the selected platform. Q18/Q54 require GS1 GDSN. Q48 covers delegated supplier accounts and MFA. Q53 includes bulk Excel/CSV and manual intake. Q36 retains FreshOp; Q37 describes baseline feeds.

The full source record and complete Q&A are retained separately in the original coordination source packet. Full platform delivery also requires the prime's production identity, hosting/security, availability, data rights, performance and integration commitments. The separate partner workshare prices engineering services; it is not the government's whole AOI4 price or a bid submission.

## API

All responses use {ok:true,data:...} or {ok:false,error:{code,message,details}}. Authentication uses an HttpOnly same-origin session cookie. Mutations use Idempotency-Key; review and account changes require their expected revision. The browser preserves the exact pending mutation body in IndexedDB before dispatch and offers recovery after transport loss.

Main routes: /api/session; /api/setup; /api/login; /api/suppliers; /api/users; /api/submissions; /api/products; /api/mappings; /api/releases; /api/audit; /api/notifications; /api/backup; /api/restore; /api/requests/REQUEST_ID. Original file downloads are attached to their submission; frozen export downloads are attached to their release.
