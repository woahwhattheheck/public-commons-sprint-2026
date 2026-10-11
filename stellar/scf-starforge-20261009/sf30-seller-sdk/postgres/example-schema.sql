-- Local example only. Run explicitly in a disposable operator-owned database.
-- Production: bind approved existing read-only views; do not install demo data.
CREATE SCHEMA sf30_example;
CREATE TABLE sf30_example.catalog (
  id bigint PRIMARY KEY,
  region text NOT NULL,
  label text NOT NULL,
  price numeric(28,8) NOT NULL,
  internal_notes text NOT NULL DEFAULT 'not exposed'
);
CREATE INDEX ON sf30_example.catalog (region, id);
INSERT INTO sf30_example.catalog (id, region, label, price) VALUES
  (9007199254740993, 'north', 'Northern observation — café', 12345678901234567890.12345678),
  (9007199254740994, 'north', 'Northern observation 2', 0.01000001),
  (9007199254740995, 'south', 'Southern observation', 0.00000001);
-- Grant an existing least-privilege application role USAGE on the schema and
-- SELECT only on the intended table or approved views. Do not run as table owner.
