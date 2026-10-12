# LIBNOVA research preservation: complete local receiving

Operation: LIBNOVA-RESEARCH-RECEIVING-6BA15-20261012.

This packet contains the complete current preservation application, the LIBNOVA producer/client and operator integration, the exact original 169-record CC0 source example, and one resumable native receiving program. It is public source and public research metadata only. It supplies no tenant credentials and does not contact a LIBNOVA tenant.

## Materialize the original packet

For every files[] member, decode utf-8 or strict base64 as declared. Require the exact byte length and SHA-256, a unique relative path without traversal, and no symlink. Preserve the source paths, Git object identities, source commit and the original input ZIP unchanged. Use one original operation directory; do not launch a second copy while its original producer is active.

## Runtime and command

Use Python 3.11 or newer, with the dependency from application/research/preservation/libnova-requirements.txt installed in the selected environment. The runner records the actual boto3 and botocore versions and the client checks its conditional PutObject capability. No browser, Java, tenant key or external provider request is required. Two local ports, 18083 and 18084, must be available. All S3 requests use the real boto3/botocore signer with synthetic local values.

From the materialized packet directory run:

```bash
python3 -B receiving/run-libnova-receiving.py --application "$PWD/application" --source "$PWD/input/OpenAlex_CIIM_Source_Example_20261012.zip" --out "$PWD/receiving-output" --api-port 18083 --s3-port 18084
```

The receiving program retains one original reviewed source and one managed Workbench destination. It exercises lost responses after a conditional S3 PUT, metadata ADD and Function invocation; adopts only the original effect/job; rejects wrong identities and changed returned bytes; verifies all original objects and mapped metadata; exports the provider workspace; runs its copied application in a fresh process; and receives/reopens the whole Workbench offline. Original operations and saved request/response evidence remain authoritative during continuation. The loopback fixture validates the uploaded BagIt through the original preservation verifier; it does not execute a deployed LIBNOVA Function.

## Completion and reuse

A successful process publishes receiving-output/receiving-result.json with outcome PASS only after both servers, request threads, copied-application children and Workbench locks drain. It publishes LIBNOVA_Receiving_Report.html and LIBNOVA_Original_169_Complete_Receiving.zip. The complete archive includes four portable provider/Workbench exports, all source and protocol receipts, the original input, the runner, and an exact per-member manifest. Save these completed artifacts before releasing a transient producing environment. A lost response must be reconciled from this same operation directory; it is not permission to repeat a provider write.

The native runtime result was pending when this source packet was assembled. Local protocol receiving and an accepted tenant deployment are separate results. Installation or customer acceptance requires the agreed sample, actual configured storage/container/schema/Function and original returned-file evidence.

Protocol sources: LIBNOVA public Python SDK commit 2e03d8ba3d10afe19f1bed450c68e77a188ad695 and published BagIt Function commit f61b3e09d670f4a8fd49c415e5b628a335294870. The implementation is independent; original per-file licensing and research rights remain in the supplied guides and source evidence. The original source example is 145,901 bytes, SHA-256 948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b.
