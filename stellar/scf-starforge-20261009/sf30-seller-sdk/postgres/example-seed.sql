-- MIT. Fictional sample only. Explicitly run in a NEW disposable PostgreSQL database.
-- This file is never executed by the merchant source or the starter generator.
CREATE SCHEMA sf30_demo;
CREATE TABLE sf30_demo.products (
  id bigint PRIMARY KEY, title text NOT NULL, region text NOT NULL,
  price_cents numeric(30,0) NOT NULL, updated_at timestamptz NOT NULL,
  internal_note text NOT NULL
);
CREATE INDEX sf30_demo_products_region_id ON sf30_demo.products(region,id);
INSERT INTO sf30_demo.products VALUES
  (1,'Example sensor','north',499,'2026-10-11T00:00:00Z','Excluded from paid projection'),
  (2,'Example actuator','south',725,'2026-10-11T00:00:00Z','Excluded from paid projection'),
  (3,'東京 demo','north',900719925474099312345,'2026-10-11T00:00:00Z','Excluded from paid projection'),
  (4,'Example gateway','north',2499,'2026-10-11T00:00:00Z','Excluded from paid projection');
