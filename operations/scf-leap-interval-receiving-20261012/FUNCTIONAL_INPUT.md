# Leap complete local receiving input

This is the reproducible input for the original `LEAP-DEVICE-INTERVAL-DELIVERY-20261012` application operation. It exercises the complete intake, reviewed mapping, invalid-edition review, complete correction, export, portable restore and desktop/mobile reopen workflow.

## Generate once on the accepted receiving host

Run the installed original Node executable against the source checkout:

```sh
/host/node /complete/source/operations/scf-leap-interval-receiving-20261012/generate-functional-input.mjs /private/leap-functional-input
```

The generator retains the original six complete files. Existing identical files are reused; a different file remains intact and produces an error. All CSVs use UTF-8 and LF endings. The manifest binds their complete sizes and SHA-256 values. The caller supplies this directory outside the source checkout.

Load `leap-functional-input.json` as the complete value of `leap.input` in the sequence configuration documented in [README.md](README.md). Keep the accepted Utility report and set `utility.reconstructOriginal` to true when reconstructing from its original published inputs. Use the joined exact source commit, original selected Starforge builder/installer and existing Python, Node, Playwright and Chromium paths.

## Complete portfolio

| Edition | Source rows | Prepared intervals | Devices | Expected result on October 12, 2026 |
| --- | ---: | ---: | ---: | --- |
| Published April 2024 example | 1 | 1 | 1 | Two timestamp-age issues |
| TJL original functional edition | 9,217 | 3,072 | 8 | One exact energy-balance issue and one duplicate |
| TJL complete corrected edition | 9,216 | 3,072 | 8 | PREPARED, zero issues |

The authored portfolio covers October 5–9, 2026 at 15-minute UTC boundaries, with separate consumed, generated and signed net channels. Twenty-four explicit mappings join those channels to eight local example UUIDs. The correction supplies the complete file and keeps the original rejected edition.

The historical CSV extracts the literal `data_string` fields from [Leap's original SFTP guide](https://developer.leap.energy/docs/upload-interval-data-sftp). Its 2024 timestamps and published UUID remain unchanged. The evidence file identifies the extraction and all authored functional identities, values and custody assumptions. Expectations use the application's actual clock; a future receiving date must review time eligibility.

All provider-action lists are empty. This configuration operates the real local application with clearly identified functional inputs. A partner deployment replaces these inputs with the complete authorized source files, actual creation-channel and account-custody evidence, mappings and reviewed provider actions.

The pure `functional-input.cjs` produces the same bytes in the connected JavaScript environment and native Node. The native wrapper only materializes those complete outputs and calculates their hashes with Node's standard SHA-256 implementation.
