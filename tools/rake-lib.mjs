/**
 * rake-lib.mjs — the Data Rake's pure parts: what a file is, and how it becomes a canonical CSV.
 *
 * Imported by tools/rake.mjs (which adds storage, the queue and the database) and by
 * nicks_code/diagnostics/verify-rake.mjs (which drives these on fixtures). Nothing here reaches a
 * network or a database; the CSV parser and SheetJS are handed in so this file resolves no modules.
 *
 * THE SOURCE CONTRACTS are the Ops app's SOURCES headers (Chatterbox_AgentOS_Analytics.html): a file
 * is a source when its header carries every `required` column and none of the `absent` ones. When a
 * header repeats ("Charge Amount" twice in Power BI), the FIRST occurrence wins — the same rule the
 * browser applies.
 */
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const SOURCES = {
  SF_OPEN_CASES:   { stage: 'rake_stage_sf_open', merge: 'rake_merge_sf_open', rejects: 'rake_rejects_sf_open', required: ['Case Number', 'Date/Time Opened', 'Case Owner'], absent: ['Date/Time Closed'],
    cols: { case_id: 'Case ID', case_number: 'Case Number', subject: 'Subject', opened_at: 'Date/Time Opened', age_hours: 'Age (Hours)', account_name: 'Account Name', account_number: 'Account Number', case_owner: 'Case Owner', status: 'Status', record_type: 'Case Record Type' }, extra: ['snapshot_date'] },
  SF_CLOSED_CASES: { stage: 'rake_stage_sf_closed', merge: 'rake_merge_sf_closed', rejects: 'rake_rejects_sf_closed', required: ['Case Number', 'Date/Time Closed'],
    cols: { case_id: 'Case ID', case_number: 'Case Number', subject: 'Subject', opened_at: 'Date/Time Opened', closed_at: 'Date/Time Closed', disposition: 'Disposition', age_hours: 'Age (Hours)', account_name: 'Account Name', account_number: 'Account Number', case_owner: 'Case Owner', status: 'Status', record_type: 'Case Record Type' } },
  BI_ACTIVE_CASES: { stage: 'rake_stage_bi', merge: 'rake_merge_bi', rejects: 'rake_rejects_bi', required: ['Account Number', 'Owner', 'Charge Amount', 'Contract Create Date'],
    cols: { account_no: 'Account Number', contract_status: 'Contract Status', account_name: 'Account Name', contract_number: 'Contract Number', owner: 'Owner', contract_create_date: 'Contract Create Date', charge_amount: 'Charge Amount', charge_code: 'Charge Code', product_bundle: 'Product Bundle', merged_bundle: 'Merged Product Bundle', consultant: 'Consultant', sales_vertical: 'Sales Vertical', case_number: 'Case Number' } },
  VICI_CALL_REPORT: { stage: 'rake_stage_vici', merge: 'rake_merge_vici', rejects: 'rake_rejects_vici', required: ['call_date', 'user', 'length_in_sec'],
    cols: { call_date: 'call_date', agent_login: 'user', lead_id: 'lead_id', status: 'status', full_name: 'full_name', user_group: 'user_group', campaign_id: 'campaign_id', length_in_sec: 'length_in_sec', status_name: 'status_name' } },
};

export const norm = (h) => String(h || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Which source a header row belongs to, or null. */
export function detect(headers) {
  const set = new Set(headers.map(norm));
  for (const [src, c] of Object.entries(SOURCES)) if (c.required.every((h) => set.has(norm(h))) && !(c.absent || []).some((h) => set.has(norm(h)))) return src;
  return null;
}

/** The day a Salesforce export was pulled: ddmmyy in the file name ("sf closed 070926.xls"), else the day it was received. */
export function snapshotFrom(name, receivedAt) {
  const m = /(\d{2})(\d{2})(\d{2})(?!\d)/.exec(name);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `20${m[3]}-${m[2]}-${m[1]}`;
  return new Date(receivedAt).toISOString().slice(0, 10);
}

/** Header names → column index per lake column (first occurrence wins; −1 when absent). */
export const pickIndexes = (headers, contract) => { const hn = headers.map(norm); const idx = {}; for (const [col, h] of Object.entries(contract.cols)) idx[col] = hn.indexOf(norm(h)); return idx; };

/** The file's first bytes decide the reader: 'xlsx' | 'html' | 'tsv' | 'csv'. */
export function sniff(buf) {
  const head = buf.slice(0, 4096).toString('latin1');
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';
  if (/^\s*(<\?xml|<!doctype|<html|<head|<table)/i.test(head)) return 'html';
  const first = head.split(/\r?\n/)[0]; return (first.split('\t').length > first.split(',').length) ? 'tsv' : 'csv';
}
export const htmlCharset = (buf) => (/charset=([\w-]+)/i.exec(buf.slice(0, 4096).toString('latin1')) || [])[1] || 'utf-8';
export const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));

/* ---- canonical CSV writer (RFC 4180, text values, _seq first) ---- */
export const csvQuote = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function canonWriter(dest, lakeCols) {
  const out = fs.createWriteStream(dest); let seq = 0; let pending = Promise.resolve();
  out.write(['_seq', ...lakeCols].join(',') + '\n');
  return {
    row(values) { seq++; const line = csvQuote(seq) + ',' + values.map(csvQuote).join(',') + '\n'; if (!out.write(line)) pending = new Promise((res) => out.once('drain', res)); return pending; },
    async end() { await pending; await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res()))); return seq; },
  };
}

/* ---- readers: each streams a file and calls onHeader(headers) → boolean, then onRow(cells) per row ---- */
export async function readDelimited(csvParse, localPath, delim, onHeader, onRow) {
  let headers = null;
  const parser = csvParse({ delimiter: delim, bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: false });
  const sink = new Transform({ objectMode: true, async transform(rec, enc, cb) { try { if (!headers) { headers = rec; const ok = await onHeader(headers); if (!ok) return cb(new Error('unrecognised header')); } else await onRow(rec); cb(); } catch (e) { cb(e); } } });
  await pipeline(fs.createReadStream(localPath), parser, sink);
  return headers;
}

/** Salesforce's ".xls" is an HTML table. Stream it: keep the tail of the previous chunk, emit each complete <tr>. */
export async function readHtmlTable(localPath, onHeader, onRow) {
  const fd = fs.openSync(localPath, 'r'); const buf0 = Buffer.alloc(4096); fs.readSync(fd, buf0, 0, 4096, 0); fs.closeSync(fd);
  const cs = htmlCharset(buf0).toLowerCase();
  const decoder = new TextDecoder(cs === 'iso-8859-1' || cs === 'latin1' ? 'latin1' : 'utf-8');
  let carry = ''; let headers = null;
  const cell = /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi; const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const sink = new Transform({ async transform(chunk, enc, cb) {
    try {
      carry += decoder.decode(chunk, { stream: true }); let m; let last = 0; rowRe.lastIndex = 0;
      while ((m = rowRe.exec(carry))) { last = rowRe.lastIndex; const cells = []; let c; cell.lastIndex = 0; while ((c = cell.exec(m[1]))) cells.push(decodeEntities(c[2].replace(/<[^>]+>/g, '')).trim());
        if (!headers) { headers = cells; const ok = await onHeader(headers); if (!ok) return cb(new Error('unrecognised header')); } else await onRow(cells); }
      carry = carry.slice(last); if (carry.length > 4 * 1024 * 1024) carry = carry.slice(-1024 * 1024);   // never let a row-less tail grow without bound
      cb();
    } catch (e) { cb(e); } } });
  await pipeline(fs.createReadStream(localPath), sink);
  return headers;
}

/** XLSX is whole-file by nature (SheetJS); Power BI should export CSV past ~200 MB. */
export async function readXlsx(XLSX, localPath, onHeader, onRow) {
  const wb = XLSX.read(fs.readFileSync(localPath), { type: 'buffer', dense: true, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const headers = (rows[0] || []).map((h) => String(h)); const ok = await onHeader(headers); if (!ok) throw new Error('unrecognised header');
  for (let i = 1; i < rows.length; i++) if (rows[i].some((v) => v !== '' && v != null)) await onRow(rows[i].map((v) => (v == null ? '' : String(v))));
  return headers;
}
