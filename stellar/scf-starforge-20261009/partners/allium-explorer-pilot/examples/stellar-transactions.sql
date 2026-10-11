-- Operator-authored starting query for an Allium-approved saved Explorer query.
-- Fields and v2 table follow the current official Allium catalog and migration notice.
-- Confirm authorized table access and parameter syntax in the owning Allium workspace.
-- A >= start and < end window prevents duplicated midnight rows across adjacent exports.
SELECT
    hash AS "transaction_hash",
    source_account AS "source_account",
    ledger_sequence AS "ledger_sequence",
    TO_CHAR(ledger_close_time, 'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') AS "ledger_close_time",
    successful AS "successful",
    TO_VARCHAR(fee_charged) AS "fee_charged_stroops",
    operation_count AS "operation_count"
FROM stellar.raw.transactions_v2
WHERE ledger_close_time >= TO_TIMESTAMP_NTZ('{{window_start}}')
  AND ledger_close_time < TO_TIMESTAMP_NTZ('{{window_end}}')
ORDER BY ledger_sequence ASC, transaction_index ASC, hash ASC
LIMIT 10000;
