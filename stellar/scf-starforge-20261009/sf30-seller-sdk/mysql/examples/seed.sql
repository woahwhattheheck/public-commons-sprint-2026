-- Fictional data for an explicitly selected disposable sf30_demo database.
-- Database creation, credentials and grants remain the operator's choices.
CREATE TABLE products (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  region VARCHAR(64) NOT NULL,
  price DECIMAL(38,6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  internal_note VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO products VALUES
(1, 'Example sensor — 東京', 'north', 900719925474099312345.123456, '2026-10-11 12:00:00.123456', 'Private supplier margin'),
(9007199254740993, 'Example archive', 'north', 599.010000, '2026-10-11 12:01:00.654321', 'Private operator annotation'),
(9007199254740994, 'Example item', 'south', 12.340000, '2026-10-11 12:02:00.000000', 'Not selected for north');
