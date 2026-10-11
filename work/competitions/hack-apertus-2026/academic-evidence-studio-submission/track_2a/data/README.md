# Development data handling

Do not commit benchmark labels, generated predictions, provider credentials, or copied federal PDFs to this directory.

Use the official public human-annotated benchmark:

https://huggingface.co/datasets/OSTswiss/MNLIoverSwissVotingBooklets

The recovered v1.1 JSONL used for source reconciliation contained 1,488 rows and had SHA-256:

`87ee4afd9c0ee8861106c50f05884481402ca668aecf927df68fc52d915b02fd`

Convert those exact bytes into separate Task B inputs and gold labels:

```sh
python ../prepare_dev.py --dataset /path/to/v1.1.jsonl \
  --cases dev_cases.jsonl --gold dev_gold.jsonl
```

Task A PDFs come from the Federal Chancellery collection:

https://www.bk.admin.ch/de/sammlung-der-abstimmungsbuechlein-seit-1978

Record the original URL, retrieval date, language, and SHA-256 for each PDF. Keep the runtime `/data` mount read-only and preserve the exact organizer-provided path. Do not synthesize gold labels or treat public-development metrics as held-out organizer outcomes.
