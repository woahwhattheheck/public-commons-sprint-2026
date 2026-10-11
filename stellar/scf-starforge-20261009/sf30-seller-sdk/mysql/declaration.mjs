// MIT. Reuse the maintained scalar/decimal contract; MySQL parses the actual SQL.
import { compilePostgresQueries, bindPostgresParameters, describePostgresQueries,
  QueryInputError } from '../postgres/declaration.mjs';
export { QueryInputError };

function placeholders(sql) {
  let count = 0, first = '';
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql[i] === '#' || sql.startsWith('--', i) && /\s/.test(sql[i + 2] ?? ' ')) {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue;
    }
    if (sql.startsWith('/*', i)) {
      // Version-executable comments can contain additional executable tokens.
      if (/^(?:[!+]|M!)/i.test(sql.slice(i + 2, i + 4))) throw new TypeError('MYSQL_EXECUTABLE_COMMENT');
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) throw new TypeError('MYSQL_UNCLOSED_COMMENT');
      i = end + 2; continue;
    }
    if (!first) first = /^[A-Za-z]+/.exec(sql.slice(i))?.[0]?.toUpperCase() ?? '?';
    const quote = sql[i];
    if (["'", '"', '`'].includes(quote)) {
      let ended = false; i++;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] !== quote) continue;
        if (sql[i] === quote) { i++; continue; }
        ended = true; break;
      }
      if (!ended) throw new TypeError('MYSQL_UNCLOSED_LITERAL');
      continue;
    }
    if (sql[i] === ';') throw new TypeError('MYSQL_SINGLE_STATEMENT_REQUIRED');
    if (sql[i] === '?') count++;
    i++;
  }
  if (!['SELECT', 'WITH'].includes(first)) throw new TypeError('MYSQL_SELECT_REQUIRED');
  return count;
}

export function compileMysqlQueries(queries) {
  const compiled = compilePostgresQueries(queries);
  for (const query of Object.values(compiled)) {
    if (placeholders(query.sql) !== query.parameterOrder.length)
      throw new TypeError('MYSQL_PARAMETER_ORDER_MUST_MATCH_PLACEHOLDERS');
  }
  return compiled;
}
export const bindMysqlParameters = bindPostgresParameters;
export const describeMysqlQueries = describePostgresQueries;
export const quoteIdentifier = name => '`' + name.replaceAll('`', '``') + '`';

export function projectedStatement(query, limit = query.maxRows + 1) {
  return 'SELECT ' + query.columns.map(quoteIdentifier).join(', ') +
    '\nFROM (\n' + query.sql + '\n) AS sf30_mysql_source\nLIMIT ' + limit;
}

export function boundedStatement(query) {
  const names = query.columns.map(quoteIdentifier);
  let flag = '__sf30_oversized';
  while (query.columns.includes(flag)) flag += '_';
  const size = names.map(name => 'COALESCE(OCTET_LENGTH(' + name + '),0)').join(' + ');
  // The limit prevents derived-table merge. Large selected values become NULL
  // in the database before crossing the driver boundary; the whole page fails.
  const selected = names.map(name => 'IF((' + size + ') > ' + query.maxBytes + ',NULL,' + name + ') AS ' + name);
  return 'SELECT ' + selected.join(', ') + ', ((' + size + ') > ' + query.maxBytes + ') AS ' + quoteIdentifier(flag) +
    '\nFROM (\n' + projectedStatement(query) + '\n) AS sf30_mysql_page';
}
