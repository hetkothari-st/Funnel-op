import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPORT_ROOT = path.join(__dirname, 'exports');

const workbookCache = new Map();
const dedupSets = new Map();
const writeLocks = new Map();

const COLUMNS = [
    { header: 'Time',         key: 'time',         width: 14 },
    { header: 'Date',         key: 'date',         width: 12 },
    { header: 'Index',        key: 'index',        width: 12 },
    { header: 'Strike',       key: 'strike',       width: 10 },
    { header: 'Type',         key: 'type',         width: 8  },
    { header: 'Symbol',       key: 'symbol',       width: 26 },
    { header: 'Side',         key: 'side',         width: 8  },
    { header: 'Price',        key: 'price',        width: 12 },
    { header: 'ObservedQty',  key: 'observedQty',  width: 14 },
    { header: 'ThresholdQty', key: 'thresholdQty', width: 14 },
    { header: 'MonitorId',    key: 'monitorId',    width: 10 },
    { header: '_tokenId',     key: '_tokenId',     width: 16 },
    { header: '_tsMs',        key: '_tsMs',        width: 16 },
];

const TOKEN_COL = 12;
const TS_COL = 13;

function istParts(ts = Date.now()) {
    const ist = new Date(ts + 5.5 * 3600 * 1000);
    return {
        y: ist.getUTCFullYear(),
        mo: ist.getUTCMonth() + 1,
        d: ist.getUTCDate(),
        h: ist.getUTCHours(),
        m: ist.getUTCMinutes(),
        s: ist.getUTCSeconds(),
        day: ist.getUTCDay(),
    };
}

function pad2(n) { return String(n).padStart(2, '0'); }

export function getISTDateString(ts = Date.now()) {
    const p = istParts(ts);
    return `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
}

function getISTTimeString(ts) {
    const p = istParts(ts);
    let h = p.h;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${pad2(h)}:${pad2(p.m)}:${pad2(p.s)} ${ampm}`;
}

export function isMarketHours(ts = Date.now()) {
    const p = istParts(ts);
    if (p.day === 0 || p.day === 6) return false;
    const mins = p.h * 60 + p.m;
    return mins >= 555 && mins <= 930;
}

function safeName(username) {
    return String(username).replace(/[^a-zA-Z0-9._@-]/g, '_');
}

export function getWorkbookPath(username, date) {
    return path.join(EXPORT_ROOT, safeName(username), `alerts_${date}.xlsx`);
}

function withLock(key, fn) {
    const prev = writeLocks.get(key) || Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    const cleanup = () => {
        if (writeLocks.get(key) === tail) writeLocks.delete(key);
    };
    const tail = next.then(cleanup, cleanup);
    writeLocks.set(key, tail);
    return next;
}

function applyHeaderStyle(ws) {
    const header = ws.getRow(1);
    header.height = 22;
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    header.alignment = { horizontal: 'center', vertical: 'middle' };
    header.border = {
        top:    { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        left:   { style: 'thin', color: { argb: 'FFBFBFBF' } },
        right:  { style: 'thin', color: { argb: 'FFBFBFBF' } },
    };
}

function applyRowStyle(row, side) {
    const fillBuy  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    const fillSell = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
    const fontBuy  = { color: { argb: 'FF1B5E20' }, name: 'Calibri', size: 10 };
    const fontSell = { color: { argb: 'FF7F1D1D' }, name: 'Calibri', size: 10 };
    const fill = side === 'buy' ? fillBuy : fillSell;
    const font = side === 'buy' ? fontBuy : fontSell;
    row.fill = fill;
    row.font = font;
    row.alignment = { vertical: 'middle' };
    row.border = {
        bottom: { style: 'hair', color: { argb: 'FFD0D0D0' } },
    };
    row.getCell(7).font = { ...font, bold: true };
    row.getCell(8).numFmt = '#,##0.00';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).numFmt = '#,##0';
    row.getCell(8).alignment = { horizontal: 'right' };
    row.getCell(9).alignment = { horizontal: 'right' };
    row.getCell(10).alignment = { horizontal: 'right' };
    row.getCell(13).numFmt = '0';
}

function getOrCreateSheet(wb, monitorId) {
    const name = `Monitor ${monitorId}`;
    let ws = wb.getWorksheet(name);
    if (ws) return ws;

    ws = wb.addWorksheet(name, {
        views: [{ state: 'frozen', ySplit: 1 }],
        properties: { defaultRowHeight: 18 },
    });
    ws.columns = COLUMNS;

    applyHeaderStyle(ws);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
    ws.getColumn(TOKEN_COL).hidden = true;
    ws.getColumn(TS_COL).hidden = true;

    return ws;
}

async function loadOrCreateWorkbook(username, date) {
    const cacheKey = `${username}::${date}`;
    if (workbookCache.has(cacheKey)) return workbookCache.get(cacheKey);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Funnel-OP';
    wb.created = new Date();

    const filepath = getWorkbookPath(username, date);
    await fs.mkdir(path.dirname(filepath), { recursive: true });

    let exists = false;
    try {
        await fs.access(filepath);
        exists = true;
    } catch {}

    if (exists) {
        await wb.xlsx.readFile(filepath);
        wb.worksheets.forEach(ws => {
            const monitorId = ws.name.replace(/^Monitor\s+/, '');
            const dedupKey = `${username}::${date}::${monitorId}`;
            const set = new Set();
            ws.eachRow((row, rowNum) => {
                if (rowNum === 1) return;
                const tokenId = row.getCell(TOKEN_COL).value;
                const tsMs = row.getCell(TS_COL).value;
                const side = String(row.getCell(7).value || '').toLowerCase();
                const priceCell = row.getCell(8).value;
                const priceNum = typeof priceCell === 'number' ? priceCell : parseFloat(priceCell);
                const qty = row.getCell(9).value;
                if (tokenId != null && tsMs != null && Number.isFinite(priceNum)) {
                    set.add(`${tokenId}|${side}|${priceNum.toFixed(4)}|${qty}|${tsMs}`);
                }
            });
            dedupSets.set(dedupKey, set);
        });
    }

    workbookCache.set(cacheKey, wb);
    return wb;
}

export async function recordAlerts(username, monitorId, alerts) {
    if (!Array.isArray(alerts) || alerts.length === 0) return { appended: 0 };

    const inHours = alerts.filter(a => Number.isFinite(a?.timestamp) && isMarketHours(a.timestamp));
    if (inHours.length === 0) return { appended: 0 };

    const date = getISTDateString(inHours[0].timestamp);

    return withLock(`${username}::${date}`, async () => {
        const wb = await loadOrCreateWorkbook(username, date);
        const monIdStr = String(monitorId);
        const ws = getOrCreateSheet(wb, monIdStr);

        const dedupKey = `${username}::${date}::${monIdStr}`;
        if (!dedupSets.has(dedupKey)) dedupSets.set(dedupKey, new Set());
        const seen = dedupSets.get(dedupKey);

        let appended = 0;
        for (const a of inHours) {
            const priceNum = parseFloat(a.price);
            if (!Number.isFinite(priceNum)) continue;
            const sideKey = String(a.side || '').toLowerCase();
            const dk = `${a.tokenId}|${sideKey}|${priceNum.toFixed(4)}|${a.observedQty}|${a.timestamp}`;
            if (seen.has(dk)) continue;
            seen.add(dk);

            const row = ws.addRow({
                time: getISTTimeString(a.timestamp),
                date: getISTDateString(a.timestamp),
                index: a.index || '',
                strike: a.strike || '',
                type: a.type || '',
                symbol: a.symbol || `${a.index || ''} ${a.strike || ''} ${a.type || ''}`.trim(),
                side: String(a.side || '').toUpperCase(),
                price: priceNum,
                observedQty: Number(a.observedQty) || 0,
                thresholdQty: Number(a.thresholdQty) || 0,
                monitorId: monIdStr,
                _tokenId: a.tokenId,
                _tsMs: a.timestamp,
            });
            applyRowStyle(row, a.side);
            appended++;
        }

        if (appended > 0) {
            const filepath = getWorkbookPath(username, date);
            await wb.xlsx.writeFile(filepath);
        }
        return { appended };
    });
}

export async function finalizeExport(username, date) {
    const targetDate = date || getISTDateString();
    return withLock(`${username}::${targetDate}`, async () => {
        const wb = await loadOrCreateWorkbook(username, targetDate);
        wb.worksheets.forEach(ws => {
            ws.eachRow({ includeEmpty: false }, (row) => {
                row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                    if (colNumber === TOKEN_COL || colNumber === TS_COL) return;
                    const v = cell.value;
                    if (v == null) return;
                    const len = String(v).length + 2;
                    const col = ws.getColumn(colNumber);
                    if (!col.width || col.width < len) col.width = Math.min(40, len);
                });
            });
        });
        const filepath = getWorkbookPath(username, targetDate);
        await wb.xlsx.writeFile(filepath);
        return filepath;
    });
}
