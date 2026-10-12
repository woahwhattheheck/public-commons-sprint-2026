# Original-source receiving observations

These observations come from the complete original public examples retained in this directory. The exact source/report identities in [model-result.json](model-result.json) match the full Node model execution. Every original field, version and affected row remains in the [complete receiving packet](McCampbell_Complete_EDD_Model_20261012.zip).

## Three-file example

| Original file / physical row | Source record | Exact observation | Receiving action |
| --- | --- | --- | --- |
| 2508877.TestResultsQC_v1.csv / 178 | LCS-323733-2508877; E625.1; 3-Nitroaniline | Supplied spike recovery 65, lower bound 70, upper bound 140 | Present the original recovery and bounds together for laboratory disposition |
| 2508877.TestResultsQC_v1.csv / 309 | LCSD-323733-2508877; E625.1; 3-Nitroaniline | Supplied duplicate recovery 64, lower bound 70, upper bound 140 | Preserve the original QC metric, qualifier fields and reviewer reason |

All 571 sample/result/batch source rows retain their original identities. The 137 nondetect result values remain blank. Each original unit and all 589 nonempty reported limit cells are preserved.

## Four-file example

| Original file / physical row | Exact observation | Receiving action |
| --- | --- | --- |
| 2508877EFW2LabSMP.csv / 2–3 | Identical AAA-01 sample rows | Retain both physical rows and their source positions |
| 2508877EFW2LabSMP.csv / 6–8 | EEE-05 has two identical field-sample rows and a distinct laboratory LR/WQ row; the laboratory row also reports parent EEE-05 | Keep every version visible and let the receiver select the intended identity treatment |
| 2508877EFW2LabTST.csv / 15 and 2508877EFW2LabRES.csv / 371 | Both report EEE-05DUP; the sample file has no exact EEE-05DUP row | Review the original laboratory sample relationship with the selected receiving format |
| 2508877EFW2LabBCH.csv / 23 | EEE-05 / SM2540 E / 09/16/2025 / 17:10 / N / NA / initial has no exact test parent | Review this exact original test/batch tuple before choosing a source-bound correction |
| 2508877EFW2LabRES.csv / 157 and 236 | 3-Nitroaniline recoveries 65 and 64 versus supplied 70–140 bounds | Keep the supplied metrics, percent units and limits with laboratory review |

The complete four-file input retains all 614 physical sample/test/result/batch rows, including every repeated identity. Its 137 blank nondetect results and 589 reported limit cells remain unchanged. Source comparison retains ambiguous groups instead of assigning a false one-to-one change.

The sample files are published format examples. A production receiving decision uses the laboratory's actual approved delivery and the client's selected [EFWEDD](https://help.earthsoft.com/lib_efwedd-format.htm) or [EQEDD](https://help.earthsoft.com/lib_eqedd_format.htm) format, reference values and original [EDP](https://help.earthsoft.com/edp.htm) result. The generic observations above make the original relationships and supplied QC bounds inspectable; they do not change scientific values or infer missing records.
