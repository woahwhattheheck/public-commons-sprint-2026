-- Run only in an operator-selected disposable SQL Server database.
-- Create the database and its SELECT-only login through your existing DBA process.
CREATE TABLE dbo.catalog (
  product_id bigint NOT NULL PRIMARY KEY,
  region nvarchar(80) NOT NULL,
  name nvarchar(200) NOT NULL,
  price decimal(38,6) NOT NULL,
  updated_at datetimeoffset(7) NOT NULL
);
INSERT INTO dbo.catalog(product_id,region,name,price,updated_at) VALUES
(9007199254740993,N'north',N'Native SQL Server record',
 12345678901234567890123456789012.123456,'2026-10-12T01:02:03.1234567+05:30'),
(9007199254740994,N'north',N'Second retained record',
 0.000001,'2026-10-12T01:02:04.0000000+05:30');
-- The merchant account needs SELECT on dbo.catalog, not db_owner/db_datawriter.
