# SF70 merchant intake

This operator CLI composes the existing SF52 catalog/seller inspector and SF68 browser header inspector. Both perform read-only original HTTP operations. It checks one merchant resource URL, one facilitator catalog, one exact Stellar network/recipient and one browser origin. It emits one JSON artifact with untouched original result objects and a small prioritized action queue.

## Usage

Run in the public sprint repository with Node 22+:

    node stellar/scf-starforge-20261009/sf70-merchant-intake/run.mjs --resource https://seller.example/paid --catalog https://facilitator.example/discovery/resources --origin https://buyer.example --network stellar:testnet --pay-to YOUR_PUBLIC_SELLER_ADDRESS --method POST --out /private/intake.json

The method parameter describes the intended browser retry; no paid retry is sent. The current original SF52 catalog scan first checks complete listing method evidence. When a listed route exclusively advertises POST or MCP tools, it makes no seller GET; SF70 does not run the unrelated SF68 GET/OPTIONS audit and returns INCONCLUSIVE with explicit browser-method-unassessed actions, rather than falsely accusing a working POST/MCP seller of a broken GET. For GET-supported listed routes, existing SF52 and SF68 use unpaid GET and OPTIONS; the original page, redirect, byte and timeout limits remain in force. A valid original-source live paid-method checkout is still a separate task. An explicit --allow-loopback flag enables literal 127.0.0.1 HTTP fixtures only. JSON output creates a new file with permissions 0600; it never overwrites an existing report.

Use `--credentialed` when the intended buyer uses browser credentials such as cookies. This applies the original stricter SF68 CORS rules; the diagnostic itself sends no cookies or authorization. New reports preserve this choice as `scope.browserCredentialed`, including when the browser check is unavailable or skipped. For POST-only routes, use the same credential mode when running SF72 on the unchanged intake. Keep this mode identical before and after a merchant repair.

Exit status 0 reports browser-header and discovery observations consistent with an unpaid checkout-ready listing; 2 reports a detected issue; 3 reports incomplete coverage without a known issue; 1 reports invalid arguments or an unrecoverable original probe error.

This is a merchant-support technical intake, not evidence of an approved sale, browser paid retry, settled transaction, customer adoption, or grant acceptance. The seller and commercial owners must approve the actual scope. A paid pilot or partner workshare requires separate authorization and an actual agreement.

See the original SF52, SF64, SF68 and SF49 manuals in adjacent repository directories.