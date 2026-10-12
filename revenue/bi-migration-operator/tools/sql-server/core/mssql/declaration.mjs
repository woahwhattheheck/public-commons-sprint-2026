// MIT. Typed SQL Server reads using the maintained SF30 scalar contract.
import { compilePostgresQueries, bindPostgresParameters, describePostgresQueries,
  QueryInputError } from '../postgres/declaration.mjs';
export { QueryInputError };
export const quoteIdentifier = name => '[' + String(name).replaceAll(']', ']]') + ']';

const forbidden = new Set(('INTO INSERT UPDATE DELETE MERGE EXEC EXECUTE CREATE ALTER DROP TRUNCATE ' +
  'GRANT REVOKE DENY BACKUP RESTORE DBCC BULK OPENROWSET OPENQUERY OPENDATASOURCE WAITFOR ' +
  'SET USE DECLARE BEGIN COMMIT ROLLBACK SAVE TRANSACTION THROW RAISERROR KILL GO').split(' '));

// The configured query is a single derived SELECT. SQL Server remains the
// parser and the database reader's permissions remain the authorization boundary.
export function scanStatement(sql) {
  const parameters = [], words = [];
  let depth = 0;
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue;
    }
    if (sql.startsWith('/*', i)) {
      let nested = 1; i += 2;
      while (i < sql.length && nested) {
        if (sql.startsWith('/*', i)) { nested++; i += 2; }
        else if (sql.startsWith('*/', i)) { nested--; i += 2; } else i++;
      }
      if (nested) throw new TypeError('MSSQL_UNCLOSED_COMMENT');
      continue;
    }
    const start = sql[i], end = start === '[' ? ']' : start;
    if (["'", '"', '['].includes(start)) {
      let closed = false; i++;
      while (i < sql.length) {
        if (sql[i++] !== end) continue;
        if (sql[i] === end) { i++; continue; }
        closed = true; break;
      }
      if (!closed) throw new TypeError('MSSQL_UNCLOSED_LITERAL');
      continue;
    }
    if (sql[i] === ';' || sql[i] === '\0') throw new TypeError('MSSQL_SINGLE_SELECT_REQUIRED');
    if (sql[i] === '(') depth++;
    if (sql[i] === ')' && --depth < 0) throw new TypeError('MSSQL_UNBALANCED_QUERY');
    if (sql[i] === '@') {
      const match = /^@([A-Za-z_][A-Za-z0-9_]{0,63})/.exec(sql.slice(i));
      if (!match || sql[i + 1] === '@' || match[1].startsWith('__sf30_'))
        throw new TypeError('MSSQL_NAMED_PARAMETER_REQUIRED');
      parameters.push({ name: match[1], start: i, end: i + match[0].length });
      i += match[0].length; continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i));
    if (word) {
      const upper = word[0].toUpperCase();
      if (forbidden.has(upper)) throw new TypeError('MSSQL_READ_QUERY_REQUIRED:' + upper);
      words.push(upper); i += word[0].length;
    } else i++;
  }
  if (words[0] !== 'SELECT' || depth !== 0) throw new TypeError('MSSQL_DERIVED_SELECT_REQUIRED');
  return parameters;
}

export function parameterSqlType(spec) {
  if (spec.type === 'integer') return 'bigint';
  if (spec.type === 'boolean') return 'bit';
  if (spec.type === 'number') return 'float';
  if (spec.type === 'string') {
    const length = spec.maxLength ?? 4096;
    return 'nvarchar(' + (length > 4000 ? 'max' : Math.max(1, length)) + ')';
  }
  if (spec.type === 'decimal') {
    const scale = spec.maxScale ?? 18, whole = spec.maxIntegerDigits ?? 38 - scale;
    const precision = Math.max(1, whole + scale);
    if (!Number.isInteger(scale) || !Number.isInteger(whole) || scale < 0 || whole < 0 ||
        precision > 38 || scale > precision) throw new TypeError('MSSQL_DECIMAL_PRECISION_INVALID');
    return 'decimal(' + precision + ',' + scale + ')';
  }
  throw new TypeError('MSSQL_PARAMETER_TYPE_UNSUPPORTED');
}

export function compileMssqlQueries(queries) {
  const compiled = compilePostgresQueries(Object.fromEntries(Object.entries(queries).map(([name,raw]) => {
    const {orderBy,...query}=raw;return [name,query];
  })));
  for (const [name,query] of Object.entries(compiled)) {
    const order=queries[name].orderBy;
    if(!Array.isArray(order)||!order.length||order.length>4||
        new Set(order.map(item=>item.column)).size!==order.length||
        order.some(item=>!item||!query.columns.includes(item.column)||!['ASC','DESC'].includes(item.direction)||
          Object.keys(item).some(key=>!['column','direction'].includes(key))))
      throw new TypeError('MSSQL_EXPLICIT_RESULT_ORDER_REQUIRED');
    query.orderBy=structuredClone(order);
    const references = scanStatement(query.sql), used = new Set(references.map(value => value.name));
    const names = query.parameterOrder;
    if (used.size !== names.length || names.some(name => !used.has(name)) ||
        references.some(value => !Object.hasOwn(query.parameters, value.name)))
      throw new TypeError('MSSQL_PARAMETERS_MUST_MATCH_DECLARATION');
    for (const spec of Object.values(query.parameters)) parameterSqlType(spec);
    query.mssqlReferences = references;
  }
  return compiled;
}

export function bindMssqlParameters(query, input) {
  const values = bindPostgresParameters(query, input);
  for (let i = 0; i < values.length; i++) {
    const spec = query.parameters[query.parameterOrder[i]];
    parameterSqlType(spec);
    if (spec.type === 'decimal' && values[i] !== null) {
      const text = String(values[i]), normalized = text.replace(/0+$/, '');
      const scale = spec.maxScale ?? 18;
      // The shared decimal binder enforces declared bounds; this also rejects
      // fractional precision the chosen native DECIMAL would otherwise round.
      const fraction = (normalized.split('.')[1] ?? '').length;
      const whole = text.split('.')[0].replace(/^-?0*/, '').length;
      if (fraction > scale || whole > (spec.maxIntegerDigits ?? 38 - scale))
        throw new QueryInputError(query.parameterOrder[i], 'MSSQL_DECIMAL_OUT_OF_RANGE');
    }
  }
  return values;
}
export function describeMssqlQueries(queries) {
  const description=describePostgresQueries(queries);
  for(const [name,query]of Object.entries(queries))description[name].orderBy=structuredClone(query.orderBy);
  return description;
}

export function boundStatement(query) {
  const references = query.mssqlReferences ?? scanStatement(query.sql);
  let output = '', offset = 0;
  for (const item of references) {
    const index = query.parameterOrder.indexOf(item.name);
    if (index < 0) throw new TypeError('MSSQL_PARAMETER_NOT_DECLARED');
    output += query.sql.slice(offset, item.start) + 'CONVERT(' +
      parameterSqlType(query.parameters[item.name]) + ',@__sf30_bind' + index + ')';
    offset = item.end;
  }
  return output + query.sql.slice(offset);
}

export function requestParameters(query) {
  return query.parameterOrder.map((name, index) => {
    const spec = query.parameters[name], scalar = spec.type;
    return { name: '__sf30_bind' + index, logicalName: name,
      type: scalar === 'boolean' ? 'bit' : scalar === 'number' ? 'float' : 'nvarchar',
      length: scalar === 'integer' ? 20 : scalar === 'decimal' ? 128 : Math.max(1, spec.maxLength ?? 4096) };
  });
}
export function parameterDeclaration(query) {
  return requestParameters(query).map(item => '@' + item.name + ' ' +
    (item.type === 'nvarchar' ? 'nvarchar(' + (item.length > 4000 ? 'max' : item.length) + ')' : item.type)).join(',');
}

export function projectedStatement(query) {
  return 'SELECT TOP (' + (query.maxRows + 1) + ') ' + query.columns.map(quoteIdentifier).join(',') +
    '\nFROM (\n' + boundStatement(query) + '\n) AS sf30_mssql_source\nORDER BY ' +
    query.orderBy.map(item=>quoteIdentifier(item.column)+' '+item.direction).join(',');
}

export function outputEncoding(column) {
  const type = String(column.system_type_name ?? '').toLowerCase().split('(')[0];
  if (['binary', 'varbinary', 'image', 'timestamp', 'rowversion'].includes(type)) return 'binary';
  if (['tinyint', 'smallint', 'int', 'bigint', 'decimal', 'numeric', 'bit'].includes(type)) return 'numeric';
  if (['money', 'smallmoney'].includes(type)) return 'money';
  if (['float', 'real'].includes(type)) return 'float';
  if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'].includes(type)) return 'temporal';
  if (['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext', 'uniqueidentifier', 'xml'].includes(type)) return 'text';
  throw new TypeError('MSSQL_RESULT_TYPE_UNSUPPORTED:' + type);
}

export function encodedStatement(query, metadata) {
  let flag = '__sf30_oversized';
  while (query.columns.includes(flag)) flag += '_';
  const names = query.columns.map(name => 'sf30_mssql_page.' + quoteIdentifier(name));
  const oversized = names.map(name => 'COALESCE(CONVERT(bigint,DATALENGTH(' + name + ')),0)').join('+') +
    '>' + query.maxBytes;
  const converted = metadata.map((column, index) => {
    const kind = outputEncoding(column), name = names[index];
    const expression = kind === 'binary' ? 'CONVERT(varchar(max),' + name + ',2)'
      : kind === 'money' ? 'CONVERT(varchar(128),' + name + ',2)'
      : kind === 'float' ? 'CONVERT(varchar(128),' + name + ',3)'
      : kind === 'numeric' ? 'CONVERT(varchar(128),' + name + ')'
      : kind === 'temporal' ? 'CONVERT(nvarchar(80),' + name + ',127)'
      : 'CONVERT(nvarchar(max),' + name + ')';
    return 'CASE WHEN ' + oversized + ' THEN NULL ELSE ' + expression + ' END AS ' + quoteIdentifier(query.columns[index]);
  });
  return 'SELECT ' + converted.join(',') + ',CASE WHEN ' + oversized + ' THEN 1 ELSE 0 END AS ' +
    quoteIdentifier(flag) + '\nFROM (\n' + projectedStatement(query) + '\n) AS sf30_mssql_page\nORDER BY ' +
    query.orderBy.map(item=>'sf30_mssql_page.'+quoteIdentifier(item.column)+' '+item.direction).join(',');
}
