'use strict';
/**
 * Minimal RFC4180-ish CSV parser — handles quoted fields, embedded commas,
 * escaped quotes ("" inside a quoted field), and both \n and \r\n line
 * endings. Shared by the hotels importer and the sheet-backed sync jobs
 * (e.g. plansSync.js) so there's one parser to trust, not three copies.
 */
function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, ''); // strip BOM
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => !(r.length === 1 && !r[0].trim()))
    .map((r) => {
      const o = {};
      headers.forEach((h, c) => { o[h] = (r[c] || '').trim(); });
      return o;
    });
}

module.exports = { parseCSV };
