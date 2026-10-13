// MIT. Strict UTF-8 CSV intake; values and original bytes are never coerced.
export function parseCSV(bytes) {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.startsWith('\uFEFF'))
        text = text.slice(1);
    const rows = [];
    let row = [], cell = '', state = 0, started = false;
    const field = () => { row.push(cell); cell = ''; state = 0; started = false; };
    const record = () => { field(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (state === 1) {
            if (c === '"')
                state = 2;
            else
                cell += c;
            continue;
        }
        if (state === 2 && c === '"') {
            cell += '"';
            state = 1;
            continue;
        }
        if (c === ',') {
            field();
            continue;
        }
        if (c === '\n' || c === '\r') {
            record();
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            continue;
        }
        if (state === 2)
            throw new TypeError('Text after a closing CSV quote.');
        if (c === '"') {
            if (started)
                throw new TypeError('A CSV quote must begin a field.');
            state = 1;
            started = true;
        }
        else {
            cell += c;
            started = true;
        }
    }
    if (state === 1)
        throw new TypeError('Unclosed CSV quote.');
    if (started || cell.length || row.length || state === 2)
        record();
    const headers = rows.shift();
    if (!headers?.length || headers.some(h => !h) || new Set(headers).size !== headers.length)
        throw new TypeError('CSV headers must be nonempty and unique.');
    if (headers.length > 256)
        throw new RangeError('Use at most 256 source columns.');
    for (let i = 0; i < rows.length; i++)
        if (rows[i].length !== headers.length)
            throw new TypeError(`Source record ${i + 1} has ${rows[i].length} cells; expected ${headers.length}.`);
    return { headers, rows };
}
export const csvCell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; };
export const writeCSV = (columns, rows) => Buffer.from([columns.map(csvCell).join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n') + '\r\n');
