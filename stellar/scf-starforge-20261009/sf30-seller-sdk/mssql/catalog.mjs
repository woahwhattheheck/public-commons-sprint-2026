// MIT. Schema-qualified catalog and type metadata from the selected SQL Server.
import { readMssqlSourceFile, resolveMssqlConnection } from './config.mjs';
import { createMssqlPool, MssqlSourceError } from './source.mjs';
export async function inspectMssqlCatalog(sourceFile,{environment=process.env,table}={}) {
  if(table!==undefined&&(typeof table!=='string'||!table||table.length>520||table.includes('\0')))
    throw new TypeError('MSSQL_CATALOG_TABLE_INVALID');
  const declaration=await readMssqlSourceFile(sourceFile);
  const connection=await resolveMssqlConnection(declaration,environment);
  const {pool,sql}=await createMssqlPool(connection,{maxConnections:1,
    connectTimeoutMs:declaration.config.connectTimeoutMs??5000,idleTimeoutMs:1000});
  try {
    const query=async(text,bind)=>{
      const request=pool.request({requestTimeout:declaration.config.startupTimeoutMs??10000});
      bind?.(request);return(await request.query(text)).recordset;
    };
    const [server]=await query("SELECT CONVERT(varchar(128),SERVERPROPERTY('ProductVersion')) AS version");
    if(table===undefined) {
      const tables=await query("SELECT TOP (1001) QUOTENAME(s.name)+'.'+QUOTENAME(o.name) AS name,"+
        "s.name AS schemaName,o.name AS tableName,CASE o.type WHEN 'V' THEN 'VIEW' ELSE 'BASE TABLE' END AS type "+
        "FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id "+
        "WHERE o.type IN ('U','V') AND o.is_ms_shipped=0 "+
        "AND HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'.'+QUOTENAME(o.name),'OBJECT','SELECT')=1 "+
        "ORDER BY s.name,o.name");
      return{schema:'stellar-forge.mssql-catalog.v1',serverVersion:server.version,
        tables:tables.slice(0,1000),truncated:tables.length>1000};
    }
    const columns=await query("SELECT TOP (1001) c.name,c.column_id AS position,t.name AS dataType,"+
      "TYPE_NAME(c.system_type_id) AS baseType,"+
      "CASE WHEN t.name IN ('decimal','numeric') THEN t.name+'('+CONVERT(varchar(4),c.precision)+','+CONVERT(varchar(4),c.scale)+')' "+
      "WHEN t.name IN ('varchar','nvarchar','varbinary','char','nchar','binary') THEN t.name+'('+"+
      "CASE WHEN c.max_length=-1 THEN 'max' ELSE CONVERT(varchar(8),CASE WHEN t.name IN ('nvarchar','nchar') THEN c.max_length/2 ELSE c.max_length END) END+')' "+
      "ELSE t.name END AS columnType,CASE c.is_nullable WHEN 1 THEN 'YES' ELSE 'NO' END AS nullable,"+
      "CASE WHEN EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id "+
      "WHERE i.object_id=c.object_id AND i.is_primary_key=1 AND ic.column_id=c.column_id) THEN 'PRI' ELSE '' END AS keyKind,"+
      "c.collation_name AS collation,c.precision AS numericPrecision,c.scale AS numericScale,"+
      "c.max_length AS maxLength,s.name AS schemaName,o.name AS tableName "+
      "FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id "+
      "JOIN sys.types t ON t.user_type_id=c.user_type_id "+
      "WHERE c.object_id=OBJECT_ID(@selected) AND o.type IN ('U','V') ORDER BY c.column_id",
      request=>request.input('selected',sql.NVarChar(520),table));
    if(!columns.length)throw new MssqlSourceError('MSSQL_TABLE_NOT_AVAILABLE');
    const schemaName=columns[0].schemaName,tableName=columns[0].tableName;
    return{schema:'stellar-forge.mssql-catalog.v1',serverVersion:server.version,table,schemaName,tableName,
      columns:columns.slice(0,1000),truncated:columns.length>1000};
  }catch(error){
    if(error instanceof MssqlSourceError)throw error;
    throw new MssqlSourceError(error?.code==='ETIMEOUT'?'MSSQL_CATALOG_TIMEOUT':'MSSQL_CATALOG_UNAVAILABLE');
  }finally{await pool.close();}
}
