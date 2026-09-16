# Demo runbook

## Source-only demonstration

```bash
npm test
npm run verify:ab
npm run demo
npm run release:gate; test $? -eq 3
```

Show that:

1. the landed Lane B receipt schema composes with Lane C in repository CI;
2. fixture/untrusted provenance cannot become BUY;
3. serialized authority cannot be replayed;
4. old policy evidence expires under the host clock;
5. PAYMENT_REQUIRED is exact HTTP 402;
6. self-asserted settlement/report bytes fail retained-digest checks;
7. report bytes are recomputed and cross-bound to the settlement response;
8. the release reducer cannot mint READY.

## Provider-integrated demonstration

Only after real adapters exist:

1. read a Lane B receipt from the trusted run store;
2. independently retain source/execution evidence;
3. construct the branded capability in trusted host code;
4. show BUY advancing only to `PURCHASE_NEEDED`;
5. perform any payment only through the authorized external workflow;
6. read the Lane A/provider result back independently;
7. retain the exact report response bytes;
8. show `USE_REPORT` only when all cross-bindings match.

Never paste secrets, private keys, bearer tokens, or payment credentials into demo fixtures or logs.
