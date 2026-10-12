// MIT. One fixed Redis/Valkey EVAL_RO script. Buyers supply typed values, never code.
// Projection and byte accounting happen before any database value crosses the wire.
export const READ_SCRIPT = `
local kind, count, budget, position = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
local rows, used, truncated = {}, 0, 0
local function keep(value)
  if type(value) == 'string' then
    used = used + string.len(value)
    if used > budget then error('SF30_RESULT_TOO_LARGE') end
  end
  return value
end
if kind == 'get' then
  if redis.call('STRLEN', KEYS[1]) > budget then error('SF30_RESULT_TOO_LARGE') end
  rows[1] = {keep(redis.call('GET', KEYS[1]))}
elseif kind == 'hash' then
  local size, fields = 0, {}
  for i = 5, #ARGV do
    size = size + redis.call('HSTRLEN', KEYS[1], ARGV[i])
    if size > budget then error('SF30_RESULT_TOO_LARGE') end
    fields[#fields + 1] = ARGV[i]
  end
  local values = redis.call('HMGET', KEYS[1], unpack(fields))
  for i = 1, #values do keep(values[i]) end
  rows[1] = values
elseif kind == 'list' then
  local start = tonumber(position)
  local values = redis.call('LRANGE', KEYS[1], position, tostring(start + count - 1))
  for i = 1, #values do rows[#rows + 1] = {tostring(start + i - 1), keep(values[i])} end
  if redis.call('LLEN', KEYS[1]) > start + #values then truncated = 1 end
elseif kind == 'set' then
  -- COUNT is a work hint, not a row limit. Return a whole native batch or fail:
  -- slicing it while advancing the native cursor would silently skip members.
  local page = redis.call('SSCAN', KEYS[1], position, 'COUNT', ARGV[5])
  if #page[2] > count then error('SF30_SCAN_PAGE_TOO_MANY_ROWS') end
  for i = 1, #page[2] do rows[#rows + 1] = {keep(page[2][i])} end
  if page[1] ~= '0' then truncated = 1 end
  return {truncated, rows, page[1]}
elseif kind == 'sorted-set' then
  local start = tonumber(position)
  for offset = start, start + count do
    local pair = redis.call('ZRANGE', KEYS[1], tostring(offset), tostring(offset), 'WITHSCORES')
    if #pair == 0 then break end
    if offset == start + count then truncated = 1; break end
    rows[#rows + 1] = {keep(pair[1]), keep(pair[2])}
  end
elseif kind == 'stream' then
  local cursor = position == '-' and '-' or '(' .. position
  for i = 1, count + 1 do
    local entries = redis.call('XRANGE', KEYS[1], cursor, '+', 'COUNT', 1)
    if #entries == 0 then break end
    if i > count then truncated = 1; break end
    local entry, selected = entries[1], {}
    for j = 1, #entry[2], 2 do selected[entry[2][j]] = entry[2][j + 1] end
    local row = {keep(entry[1])}
    for j = 5, #ARGV do row[#row + 1] = keep(selected[ARGV[j]] or false) end
    rows[#rows + 1] = row
    cursor = '(' .. entry[1]
  end
else error('SF30_QUERY_KIND_INVALID') end
return {truncated, rows}
`;
