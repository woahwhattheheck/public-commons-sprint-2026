// MIT. Track native sockets from creation, including the handshake lifetime.
export function retireMysqlConnection(connection) {
  if (!connection) return;
  const native = connection.connection ?? connection;
  try { connection.destroy(); } catch {}
  // mysql2 destroy() ends its stream gracefully. A deadline must also release
  // a peer that stops responding during the handshake or a queued command.
  try { native.stream?.destroy(); } catch {}
}

export function mysqlDeadline(milliseconds, issue, onTimeout) {
  let expired = false, reject;
  const interruption = new Promise((_, fail) => { reject = fail; });
  interruption.catch(() => {});
  const timer = setTimeout(() => {
    expired = true; reject(issue);
    try { onTimeout(); } catch {}
  }, milliseconds);
  return Object.freeze({
    get expired() { return expired; },
    wait: promise => Promise.race([interruption, promise]),
    close: () => clearTimeout(timer),
  });
}

export const mysqlCall = (connection, method, sql, values = []) => new Promise((resolve, reject) => {
  let settled = false;
  const ended = () => finish(new Error('MYSQL_CONNECTION_CLOSED'));
  function finish(issue, rows, fields) {
    if (settled) return;
    settled = true; connection.removeListener('error', finish); connection.removeListener('end', ended);
    if (issue) reject(issue); else resolve({ rows, fields });
  }
  connection.once('error', finish); connection.once('end', ended);
  try { connection[method](sql, values, finish); } catch (issue) { finish(issue); }
});

export function createMysqlPool(mysql, options, { maxConnections, idleTimeoutMs }) {
  const entries = new Map();
  let closed = false;
  function retire(connection, issue = new Error('MYSQL_CONNECTION_CLOSED')) {
    const entry = entries.get(connection);
    if (entry) {
      entries.delete(connection); clearTimeout(entry.timer);
      entry.reject?.(issue); entry.reject = null;
    }
    retireMysqlConnection(connection);
  }
  function acquire() {
    if (closed) return Promise.reject(new Error('MYSQL_POOL_CLOSED'));
    for (const [connection, entry] of entries) if (entry.state === 'idle') {
      entry.state = 'busy'; clearTimeout(entry.timer); entry.timer = null;
      return Promise.resolve(connection);
    }
    if (entries.size >= maxConnections) return Promise.reject(new Error('MYSQL_POOL_CAPACITY'));
    return new Promise((resolve, reject) => {
      let connection;
      try { connection = mysql.createConnection(options); } catch (issue) { reject(issue); return; }
      const entry = { state: 'connecting', timer: null, reject };
      entries.set(connection, entry);
      connection.on('error', issue => retire(connection, issue));
      connection.once('end', () => retire(connection));
      connection.connect(issue => {
        if (issue) { retire(connection, issue); return; }
        if (closed || !entries.has(connection)) { retire(connection); return; }
        entry.state = 'busy'; entry.reject = null; resolve(connection);
      });
    });
  }
  function release(connection) {
    const entry = entries.get(connection);
    if (closed || !entry) { retire(connection); return; }
    entry.state = 'idle'; clearTimeout(entry.timer);
    entry.timer = setTimeout(() => retire(connection), idleTimeoutMs);
    entry.timer.unref?.();
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const connection of [...entries.keys()]) retire(connection);
  }
  return Object.freeze({ acquire, release, retire, close });
}
