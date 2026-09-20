/**
 * KNITCAT V2 — stash import (spec §3.3).
 *
 * Getting a real stash *into* the app without typing forty rows is half the value of having a
 * stash at all. This module parses the two formats knitters actually have — a Ravelry CSV
 * export of a stash/project list, and JSON — plus a "from a photo" path that takes an
 * image-data buffer (the caller has already decoded the pixels; this stays DOM-free) and
 * extracts the dominant colours, matching each to real yarns in the database.
 *
 * Every parser is defensive: ragged rows, quoted commas, mixed metre/yard labels, missing
 * columns, blank lines and a stray BOM should never throw — they just skip the row and record a
 * warning so the importer can report "imported 37, skipped 2" honestly.
 *
 * @module yarn/stash-import
 */

import { getDefaultDatabase } from './database.js';
import { extractPalette, matchToYarns, hexToLab } from './color.js';

/**
 * Parse a delimited text blob (Ravelry CSV is comma, some exports are tab) into a matrix of
 * trimmed string cells, honouring double-quoted fields that contain the delimiter or newlines.
 * @param {string} text @param {{delimiter?:string}} [opts]
 * @returns {{rows:string[][], delimiter:string, warnings:string[]}}
 */
export function parseDelimited(text, opts = {}) {
  const warnings = [];
  if (typeof text !== 'string' || !text.trim()) return { rows: [], delimiter: opts.delimiter || ',', warnings: ['Empty input.'] };
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = opts.delimiter || detectDelimiter(clean);
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field.trim()); field = ''; }
    else if (ch === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* swallow; \n handles the row */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(c => c !== ''));
  if (rows.length !== nonEmpty.length) warnings.push(`Skipped ${rows.length - nonEmpty.length} blank line(s).`);
  return { rows: nonEmpty, delimiter, warnings };
}

function detectDelimiter(text) {
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const counts = { ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length, ';': (firstLine.match(/;/g) || []).length };
  return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',');
}

/**
 * Import a Ravelry-style CSV stash export into stash-ready entries. Column names are matched
 * loosely (Ravelry exports vary) via a synonym table.
 * @param {string} csv @param {import('./database.js').YarnDatabase} [db]
 * @returns {{entries:Array<object>, matched:number, unmatched:number, warnings:string[]}}
 */
export function importRavelryCSV(csv, db = getDefaultDatabase()) {
  const { rows, warnings } = parseDelimited(csv);
  const out = { entries: [], matched: 0, unmatched: 0, warnings: warnings.slice() };
  if (!rows.length) { out.warnings.push('No rows found.'); return out; }
  const header = rows[0].map(h => norm(h));
  const idx = {
    brand: findCol(header, ['brand', 'yarn brand', 'designer', 'manufacturer']),
    name: findCol(header, ['name', 'yarn name', 'yarn', 'yarnname']),
    color: findCol(header, ['color', 'colour', 'colorname', 'colourname', 'color name', 'shade']),
    colorcode: findCol(header, ['colorcode', 'colourcode', 'dye', 'dyelot', 'color code', 'lot']),
    weight: findCol(header, ['weight', 'yarn weight', 'gauge group']),
    fiber: findCol(header, ['fiber', 'fibre', 'fibercontent', 'fibre content', 'content']),
    meters: findCol(header, ['meterage', 'meters', 'yards', 'yardage', 'length', 'metrage']),
    qty: findCol(header, ['qty', 'quantity', 'count', 'amount', 'balls', 'skeins']),
    price: findCol(header, ['price', 'cost', 'purchase price']),
    location: findCol(header, ['location', 'where', 'storage', 'bin', 'shelf'])
  };
  if (idx.brand < 0 && idx.name < 0) { out.warnings.push('Could not find brand/name columns — importing nothing.'); return out; }

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const brand = idx.brand >= 0 ? cells[idx.brand] : '';
    const name = idx.name >= 0 ? cells[idx.name] : '';
    if (!brand && !name) { out.unmatched++; continue; }
    const colorName = idx.color >= 0 ? cells[idx.color] : '';
    const qty = idx.qty >= 0 ? parseNumber(cells[idx.qty]) : 1;
    const price = idx.price >= 0 ? parseNumber(cells[idx.price]) : 0;
    // Try to resolve against the global database first.
    let yarn = db.find(brand, name) || fuzzyMatch(db, brand, name);
    const color = resolveColor(yarn, colorName, cells[idx.colorcode] || '');
    out.entries.push({
      raw: { brand, name, colorName, weight: idx.weight >= 0 ? cells[idx.weight] : '', fiber: idx.fiber >= 0 ? cells[idx.fiber] : '', meters: idx.meters >= 0 ? cells[idx.meters] : '' },
      yarnId: yarn ? yarn.id : null,
      yarn: yarn || null,
      color,
      quantity: qty || 1,
      price,
      dyeLot: idx.colorcode >= 0 ? cells[idx.colorcode] : '',
      location: idx.location >= 0 ? cells[idx.location] : '',
      matched: Boolean(yarn)
    });
    if (yarn) out.matched++; else out.unmatched++;
  }
  return out;
}

/**
 * Import a JSON stash array (Ravelry API shape or our own export). Tolerant of several key
 * spellings.
 * @param {string|Array|object} json @param {import('./database.js').YarnDatabase} [db]
 */
export function importStashJSON(json, db = getDefaultDatabase()) {
  const out = { entries: [], matched: 0, unmatched: 0, warnings: [] };
  let list;
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    list = Array.isArray(parsed) ? parsed : (parsed.stash || parsed.entries || parsed.items || parsed.yarns || []);
  } catch (e) { out.warnings.push(`Invalid JSON: ${e.message}`); return out; }
  for (const item of list) {
    const brand = pick(item, ['brand', 'yarnBrand', 'designer']);
    const name = pick(item, ['name', 'yarnName', 'yarn', 'title']);
    const yarn = db.find(brand, name) || fuzzyMatch(db, brand, name);
    const colorHex = pick(item, ['hex', 'color', 'colour', 'swatchColor']) || guessHex(pick(item, ['colorName', 'color']));
    out.entries.push({
      raw: item,
      yarnId: yarn ? yarn.id : null,
      yarn: yarn || null,
      color: resolveColor(yarn, pick(item, ['colorName', 'color', 'colour']), pick(item, ['dyeLot', 'lot'])),
      quantity: parseNumber(pick(item, ['quantity', 'qty', 'count', 'amount'])) || 1,
      price: parseNumber(pick(item, ['price', 'cost'])) || 0,
      dyeLot: pick(item, ['dyeLot', 'lot', 'dye']),
      location: pick(item, ['location', 'where', 'bin']),
      matched: Boolean(yarn)
    });
    if (yarn) out.matched++; else out.unmatched++;
  }
  return out;
}

/**
 * Import from a decoded photo: extract the dominant colours and match each to real yarns in the
 * database. `imageData` is `{data:Uint8ClampedArray, width:number, height:number}` — the caller
 * obtains it from a canvas offscreen; this module never touches the DOM.
 * @param {{data:ArrayLike<number>, width:number, height:number}} imageData
 * @param {{count?:number, tolerance?:number, db?:import('./database.js').YarnDatabase}} [opts]
 * @returns {Array<{hex:string, weight:number, lab:object, matches:Array}>}
 */
export function importFromPhoto(imageData, opts = {}) {
  const db = opts.db || getDefaultDatabase();
  const palette = extractPalette(imageData, opts.count || 6);
  return palette.map(c => ({
    hex: c.hex,
    weight: c.weight,
    lab: safeLab(c.hex),
    matches: matchToYarns(c.hex, db.all(), opts.tolerance || 40).slice(0, 5)
  }));
}

/**
 * Turn one import result entry into a {@link module:yarn/stash.Stash} `addCustom` argument for
 * yarns the database could not resolve — so nothing the knitter typed is lost.
 */
export function entryToCustomYarn(entry) {
  const raw = entry.raw || {};
  return {
    brand: raw.brand || entry.brand || 'Imported',
    name: raw.name || entry.name || 'Unknown yarn',
    weight: raw.weight || entry.weight || 'unknown',
    fiber: parseFiberString(raw.fiber || entry.fiber || ''),
    meterage: parseMeterageString(raw.meters || entry.meters || ''),
    colors: entry.color && entry.color.hex ? [{ name: entry.color.name || 'Color', hex: entry.color.hex, code: entry.color.code }] : []
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function norm(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function findCol(header, synonyms) {
  for (let i = 0; i < header.length; i++) if (synonyms.includes(header[i])) return i;
  return -1;
}
function pick(obj, keys) {
  for (const k of keys) { if (obj && obj[k] != null && obj[k] !== '') return obj[k]; }
  return '';
}
function fuzzyMatch(db, brand, name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  const byName = db.search(n).filter(y => y.name.toLowerCase() === n);
  if (byName.length) return brand ? (byName.find(y => y.brand.toLowerCase() === String(brand).toLowerCase()) || byName[0]) : byName[0];
  return null;
}
function resolveColor(yarn, colorName, code) {
  const name = String(colorName || '');
  if (yarn && yarn.colors && yarn.colors.length) {
    const exact = yarn.colors.find(c => (c.name || '').toLowerCase() === name.toLowerCase() || (c.code || '') === String(code || ''));
    if (exact) return { name: exact.name, hex: exact.hex, code: exact.code, lab: safeLab(exact.hex) };
  }
  const hex = guessHex(name) || (code ? guessHex(code) : null) || '#cccccc';
  return { name: name || 'Imported', hex, code: code || undefined, lab: safeLab(hex) };
}
function guessHex(str) {
  const m = String(str || '').match(/#?([0-9a-f]{6})\b/i);
  return m ? `#${m[1].toLowerCase()}` : null;
}
function parseFiberString(s) {
  const str = String(s || '');
  if (!str) return [{ name: 'unknown', percentage: 100 }];
  const parts = str.split(/[+,/]/).map(p => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const mm = p.match(/([a-z ]+?)\s*(\d{1,3})\s*%/i);
    if (mm) out.push({ name: mm[1].trim().toLowerCase(), percentage: Number(mm[2]) });
    else if (p) out.push({ name: p.toLowerCase().replace(/\s*\(.*\)/, ''), percentage: Math.floor(100 / parts.length) });
  }
  return out.length ? out : [{ name: 'unknown', percentage: 100 }];
}
function parseMeterageString(s) {
  const str = String(s || '');
  const m = str.match(/([\d.]+)\s*(m|yd|yds|yards|meters|metres)?\s*[\/ ]\s*([\d.]+)\s*(g|kg|oz)?/i);
  if (m) return { value: Number(m[1]), unit: norm(m[2]) || 'm', per: Number(m[3]), unitWeight: norm(m[4]) || 'g' };
  const single = parseNumber(str);
  if (single) return { value: single, unit: 'm', per: 100, unitWeight: 'g' };
  return { value: 0, unit: 'm', per: 100, unitWeight: 'g' };
}
function parseNumber(s) {
  const m = String(s == null ? '' : s).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : 0;
}
function safeLab(hex) { try { return hexToLab(hex); } catch { return { L: 0, a: 0, b: 0 }; } }
