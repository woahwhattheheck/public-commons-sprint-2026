# Redis List and Set products

The existing Redis merchant publishes ordered list pages and set-member batches
through its original source compiler, saved editor, OpenAPI, generated client
and retained releases. They use the selected standalone, Cluster, Sentinel or
Upstash connection and the same declared payment terms.

## Start from the complete source

`example-collections-source.json` declares `list_feed` and
`member_catalog`; `example-collections-plan.json` contains their complete
public routes, parameter descriptions, examples and payment structure. Copy
that pair into a new private authoring directory or import it through the
[connection setup](SETUP.md). Keep the customer's actual connection, environment
references and CA files, then map its agreed keys and payment terms.

The pair is independent of the original four-product examples. To combine
them, retain the existing source profile and append these two named query
definitions and their two plan routes. Every query and route must retain its
own unique name, ID and HTTP path.

```sh
starforge redis describe --source /private/collections/source.json
starforge redis preflight --source /private/collections/source.json
starforge redis query --source /private/collections/source.json \
  --query list_feed --input /private/collections/input.json \
  --output /private/collections/list-first.json
```

The initial input file can contain `{}` because both examples declare a
default first position. For an explicit first request use
`{ "offset": "0" }` or `{ "cursor": "0" }`. Later input files contain the
preceding complete result's `nextInput`.

## Ordered lists

A `list` query declares one key and exactly two public columns. Their defaults
are `index` and `value`. `offset`, when present, names a nonnegative bounded
integer parameter whose maximum is at most 10,000,000. Exact decimal strings
remain valid integer inputs.

One native read-only script performs `LRANGE` for the requested slice and
`LLEN` for continuation. An empty or out-of-range slice returns no rows.
Indexes use exact decimal text. The reader preserves duplicate list entries,
empty strings, large decimal text, Unicode and binary values in their original
positions.

```json
{
  "kind": "list",
  "key": "merchant:collections:queue",
  "parameters": {
    "offset": {
      "type": "integer",
      "minimum": "0",
      "maximum": "10000000",
      "default": "0"
    }
  },
  "offset": "offset",
  "columns": ["index", "value"],
  "maxRows": 100,
  "maxBytes": 65536,
  "timeoutMs": 1500
}
```

Results include `order: "list-index"` and `pageOffset`. When more values
exist and the next index satisfies the declared input contract, `nextInput`
retains the current key selection and advances the offset by the returned row
count. Insertions or removals between requests can move list indexes. A saved
release retains the selected reader configuration; each page reads the current
list.

## Native set iteration

A `set` query declares one key, one public member column and a required
`cursor` parameter. Its parameter type is string, with a maximum length of
20. Valid cursors are canonical decimal strings from `"0"` to
`"18446744073709551615"`; numbers, negative values, leading zeroes and
overflow are rejected before Redis execution. Keep the cursor as text in
saved requests, HTTP input and client code.

```json
{
  "kind": "set",
  "key": "merchant:collections:members",
  "parameters": {
    "cursor": { "type": "string", "maxLength": 20, "default": "0" }
  },
  "cursor": "cursor",
  "scanCount": 100,
  "columns": ["member"],
  "maxRows": 1000,
  "maxBytes": 65536,
  "timeoutMs": 1500
}
```

Each request returns one complete `SSCAN` batch. `scanCount` is the native
COUNT work hint, from 1 to `maxRows`; Redis can return more or fewer members,
including an empty intermediate batch. Compact set encodings can return the
whole collection in one batch.

Every set result exposes the exact `scanCursor`, `scanComplete`,
`scanCount`, `iterationConsistency: "native-sscan"`,
`memberOrder: "unspecified"` and `duplicatesPossible: true`. A native
cursor of `"0"` completes the iteration. A nonzero cursor keeps
`truncated: true` and supplies `nextInput` when that input passes the same
declaration.

Native iteration can repeat members across requests. Members present throughout
a full iteration are returned; membership changes during the iteration follow
Redis's native guarantees. A product consumer can deduplicate by the exact
member value when its own workflow requires unique membership. Binary members
remain `{ "base64": "..." }` objects; do not decode them into lossy text.

## Row, byte and continuation limits

All paged products allow 1–1,000 rows. The complete response must fit
`maxBytes`, and the existing source deadline remains active. Set batches
retain their native boundary: when Redis returns more than `maxRows`, the
request returns HTTP 413 / `QUERY_SCAN_PAGE_TOO_LARGE` before exposing a
partial batch. A selected-value or encoded-response overflow returns HTTP 413 /
`QUERY_RESULT_TOO_LARGE`.

Keep the same cursor on those errors. Review the selected row/byte bounds and
work hint, save the revised declaration and retry that cursor. Reducing COUNT
can reduce scan effort, but compact encodings may still return all members.
The source has no server-side pagination session to consume or lose.

For List products, a next index beyond the declared maximum reports
`continuationUnavailable: "OFFSET_LIMIT"`. A Set cursor or List input
excluded by another contract rule reports `"INPUT_LIMIT"`. The result can
remain truncated in either case. Extend the reviewed input contract if the
customer needs the remaining collection.

## Save, preview and deliver

Open the [original product workspace](workspace/README.md). The List editor
exposes its offset and two output columns. The Set editor exposes its cursor,
scan work hint and member column. Changing a read type supplies the appropriate
paging parameter while preserving the selected key parameter. Review the whole
source and merchant plan, then save a revision.

Choose that saved version in Live preview. The actual rows, input, source
version and next cursor remain in its operation. **Read next page** uses
`nextInput`; an empty Set result can still have this action. A lost response
recovers the same saved request. Cold reopen retains both the previous cursor
and the corresponding original revision.

Prepare the revision in Customer packages, download the generated OpenAPI and
client, and stage it into the workspace's original release store. The examples
publish GET `/list` and GET `/members`. Each route uses its plan's accepted
payment terms. Each requested scan page is one product request, including
a native empty intermediate page. Include that behavior in the agreed offer.

The generated client keeps the existing buyer approval, response-file and
payment lifecycle. Continue from each delivered result's `nextInput`; keep
all rows already delivered before requesting another page. A consumer that
runs direct private source reads can use the same rule:

```js
const { source } = await openRedisSourceFile('/private/collections/source.json');
try {
  let input = { cursor: '0' };
  while (input) {
    const page = await source.query('member_catalog', input);
    await consumeMembers(page.rows);
    input = page.nextInput;
    if (!input && !page.scanComplete) {
      throw new Error(page.continuationUnavailable ?? 'Collection is incomplete');
    }
  }
} finally {
  await source.close();
}
```

Here `openRedisSourceFile` is the original export from `redis/config.mjs`;
`consumeMembers` is the application's own delivery operation. Preserve its
progress with the corresponding native input when the workflow needs a restart.

## Native access

For a merchant whose password is already configured, the collection examples
need this data-read permission fragment:

```text
ACL SETUSER merchant on resetkeys -@all ~merchant:collections:queue ~merchant:collections:members +ping +eval_ro +lrange +llen +sscan
```

Compose those keys and commands with the same merchant's existing permissions
when it also serves other product types. Cluster discovery additionally uses
`+cluster|slots` and `+asking`; a nonzero standalone/Sentinel database uses
`+select`. Sentinel's independent monitor identity and verified TLS profiles
are described in the [connection guide](README.md#configure-the-native-connection).

## Operate the complete native workflow

Add `SF30_REDIS_JOURNEY_COLLECTIONS=1` to the original
`redis/native-journey.mjs` invocation. It appends these two products to the
existing four-product source, plan, generated client and retained release flow.
It seeds only the operation's ephemeral database and extends its existing
merchant ACL.

The companion traverses native lists and sets, reads an actual empty
nonterminal scan batch followed by its returned cursor, exercises a compact
batch above its COUNT hint, checks whole-batch and byte limits, and preserves
large decimal, repeated, empty, Unicode and binary values. With
`SF30_REDIS_JOURNEY_WORKSPACE=1` and
`SF30_REDIS_WORKSPACE_BROWSER=1`, the same operation edits the products,
saves/reloads a revision, previews native continuation, prepares customer
files and reopens the exact saved request. Its generated buyer downloads every
collection page before the original upgrade and rollback.

It composes with `SF30_REDIS_JOURNEY_TOPOLOGY=cluster` or `sentinel`, the
Sentinel TLS mode, and `SF30_REDIS_JOURNEY_SETUP=1`. The default original
four-product native operation remains available under its existing invocation.
The [native runtime guide](README.md#native-integration-journey) lists the
installed Redis, browser and TLS executable selections.

## Command references

- [Redis LRANGE](https://redis.io/docs/latest/commands/lrange/)
- [Redis SSCAN](https://redis.io/docs/latest/commands/sscan/)
- [Redis SCAN iteration and COUNT guarantees](https://redis.io/docs/latest/commands/scan/)
