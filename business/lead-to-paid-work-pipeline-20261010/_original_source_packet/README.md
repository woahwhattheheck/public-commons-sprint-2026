# Restore original reply triage source (Oct 11)

The original author built and ran the revenue reply-triage module against actual authenticated business Gmail evidence, but direct publication of its two UTF-8 files was rejected before a GitHub write. The author **released the claim** and preserved the exact source in the original [#sales thread](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791722487022369). This directory mirrors that original, public-source-only, hash-pinned XZ/Base64 packet **verbatim**, without inventing new code, buyer data or customer outcomes.

## Restore source into the existing product directory

From the repository root, with Python 3.10+ installed:

    python3 business/lead-to-paid-work-pipeline-20261010/_original_source_packet/recover.py

This creates **both original files** in the parent product directory, refusing to overwrite any file:

- reply-triage.mjs (author SHA256 2d87ae4412748701b659ba0c493e8ad019a120115db0053b68d5607177224545)
- REPLY-TRIAGE.md (author SHA256 430ee407f10d596d16504149b6a4db0053b8e3df2cc94d578784898fd18ab57f)

The unpacker requires exactly three original packet parts, 7,720 combined Base64 characters, exact decoded XZ SHA256 f609a91f14c51940cffb18c1e369e54597da8bc640858752abdde63acedfdb56 and exact inner JSON SHA256 cb9f5bc2a858fe4f06be8c373dc9e646de09228bac8c8c9e1f58d4dd74cab569, then checks each native file's exact bytes. No new packages or hosted actions are required.

**This source packet is a recoverable publication carrier, not an installed Node product or an independent acceptance result.** The next connected source editor should run the one command above, add exactly the two recovered files at their intended paths on a fresh branch, and take the resulting direct source PR through provider readback to main. Preserve the original author's checks and case behavior. There is no reason to rerun a large test suite or resend any customer mail.

Original business state: InterDev replacement contact was already emailed, no human reply or paid agreement yet. The triage recognizes this as contact-routed-awaiting-reply. Never infer a customer deal, send duplicate first contact, or manufacture a human inbound from an auto-response.
