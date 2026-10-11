-- MIT. Explicit local demonstration data, not a Goldsky export or chain receipt.
CREATE DATABASE IF NOT EXISTS starforge_example;
CREATE TABLE starforge_example.transfers (
  record_id UInt64, ledger UInt64, account String, amount Decimal(38, 7),
  memo Nullable(String), successful Bool, observed_at DateTime64(6, 'UTC')
) ENGINE = Memory;
INSERT INTO starforge_example.transfers VALUES
  (18446744073709551615, 9007199254740993, 'merchant-demo', 123456789012345678901234567890.1234567, NULL, true, '2026-10-11 17:00:00.123456'),
  (18446744073709551614, 9007199254740994, 'merchant-demo', 0.0000001, '\\N', true, '2026-10-11 17:00:01.000001'),
  (18446744073709551615, 9007199254740994, 'merchant-demo', 12.3400000, 'Example — 東京', false, '2026-10-11 17:00:02.654321');
