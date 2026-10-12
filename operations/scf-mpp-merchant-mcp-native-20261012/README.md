# Native MPP merchant MCP integration journey

Run this operation from its original Git branch, `scf/native-mpp-merchant-mcp-run-eb45`, which retains the product source plus this driver. It uses the maintained `initializeMppMerchant` / `startMerchantMcp` factory, the original console Workspace, published native Stellar MPP runtime, original TLS-verified merchant through an explicit CONNECT transport, and the maintained retained-file downloader and native customer receiver.

Requirements: Node 24, npm, Python 3 and OpenSSL. The runner creates a new private directory, installs the exact original isolated MPP runtime with its retained lock, and generates a local TLS fixture certificate trusted only by the child Node process. It starts its own loopback listeners and closes them in the same process. No browser or GitHub Actions is used.

```bash
NODE_OPTIONS=--max-old-space-size=128 bash operations/scf-mpp-merchant-mcp-native-20261012/run.sh /ABS/CHECKOUT /PRIVATE/NEW_RUN
```

The operation carries a complete native package beyond the original 128 KiB MCP envelope, retains and reopens customer reviews, prepares actual native 402 challenges, restarts MCP while the original console job continues, observes revision conflicts, recovers the original purchase/preparation after console restart and a changed active contract, then downloads a retained customer package while the console is offline. A deliberately interrupted download resumes its original durable prefix through MCP restart and the native receiver recreates all 12 files including both nested examples. `result.json` contains measured outcomes. Native transaction execution remains the original buyer/governor operation exposed by the product; this operation’s payment phase is native challenge preparation.
