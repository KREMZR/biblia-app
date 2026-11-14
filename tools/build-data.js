#!/usr/bin/env node
/*
 * build-data.js — Convert a whole-Bible JSON file into the per-book files
 * the app loads (data/<id>/<book>.json) plus data/<id>/meta.json.
 *
 * Usage:
 *   node tools/build-data.js <source.json> <translation-id> "<Full name>" "<Short name>" "<Source / credit>"
 *
 * Example (what was used for the bundled text):
 *   node tools/build-data.js SpaRV.json rv1909 "Reina-Valera 1909" "RV1909" \
 *     "Módulo SpaRV de CrossWire Bible Society, vía github.com/scrollmapper/bible_databases"
 *
 * Accepted input formats (books must be the 66 Protestant-canon books, in canonical order):
 *   1. scrollmapper/bible_databases JSON:
 *      { "translation": "...", "books": [ { "name": "...", "chapters": [ { "chapter": 1,
 *        "verses": [ { "verse": 1, "text": "..." } ] } ] } ] }
 *   2. Plain nested arrays: [ [ [ "verse 1", "verse 2" ], ...chapters ], ...66 books ]
 *
 * Cleaning applied:
 *   - whitespace collapsed and trimmed
 *   - the ALL-CAPS "drop cap" word at the start of each chapter (e.g. "EN el principio")
 *     is changed to normal case ("En el principio"), because screen readers may spell
 *     out all-caps words letter by letter. Pass --keep-caps to skip this.
 *   - empty verses are kept as "" so verse numbers stay aligned with the source.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Books = require('../js/books.js');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
if (args.length < 3) {
  console.error('Usage: node tools/build-data.js <source.json> <id> "<Full name>" ["<Short name>"] ["<Source>"]');
  process.exit(1);
}
const [srcPath, id, fullName, shortName = id.toUpperCase(), source = ''] = args;
if (!/^[a-z0-9-]+$/.test(id)) { console.error('Translation id must be lowercase letters, digits or "-"'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

/** Normalise any accepted input into: books[66][chapters][verses] = string */
function toNested(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.books)) {
    return input.books.map(b => b.chapters.map(c => {
      const out = [];
      c.verses.forEach(v => { out[v.verse - 1] = v.text; });
      for (let i = 0; i < out.length; i++) if (out[i] == null) out[i] = '';
      return out;
    }));
  }
  throw new Error('Unrecognised input format');
}

const CAPS_WORD = /[A-ZÁÉÍÓÚÑÜÂÊÎÔÛ]{2,}/;
const WORD = /[A-Za-zÁÉÍÓÚÑÜÂÊÎÔÛáéíóúñüâêîôû]+/g;

/**
 * Old printed Bibles start each chapter with a drop cap: "EN el principio",
 * "Y ACONTECIÓ", "A TI, oh Jehová". Turn that into normal sentence case.
 * If the caps word starts a sentence → "En"; otherwise it's lowercased,
 * unless the corpus shows it's a proper noun ("Y JEHOVÁ" → "Y Jehová").
 */
function fixDropCap(text, freq) {
  const m = CAPS_WORD.exec(text);
  if (!m) return text;
  const w = m[0];
  const lower = w.toLowerCase();
  const title = w.charAt(0) + lower.slice(1);
  const before = text.slice(0, m.index);
  const startsSentence = /^[\s¿¡"«(]*$/.test(before) || /[.:;!?]\s*[¿¡"«(]*$/.test(before);
  const isProperNoun = (freq.get(title) || 0) > (freq.get(lower) || 0);
  const fixed = startsSentence || isProperNoun ? title : lower;
  return text.slice(0, m.index) + fixed + text.slice(m.index + w.length);
}

const nested = toNested(raw);

// Word frequencies (exact case) across the whole text, used by fixDropCap.
const freq = new Map();
nested.forEach(chs => chs.forEach(vs => vs.forEach(t => {
  (String(t || '').match(WORD) || []).forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
})));
if (nested.length !== 66) { console.error(`Expected 66 books, got ${nested.length}`); process.exit(1); }

const outDir = path.join(__dirname, '..', 'data', id);
fs.mkdirSync(outDir, { recursive: true });

const verseCounts = {};
let total = 0;
nested.forEach((chapters, i) => {
  const book = Books.list[i];
  const clean = chapters.map((verses, ci) => verses.map((t, vi) => {
    let s = String(t || '').replace(/\s+/g, ' ').trim();
    if (vi === 0 && !flags.has('--keep-caps')) s = fixDropCap(s, freq);
    return s;
  }));
  if (clean.length !== book.ch) {
    console.warn(`Warning: ${book.name} has ${clean.length} chapters in source (expected ${book.ch}).`);
  }
  verseCounts[book.id] = clean.map(c => c.length);
  total += clean.reduce((n, c) => n + c.length, 0);
  fs.writeFileSync(path.join(outDir, book.id + '.json'),
    JSON.stringify({ id: book.id, name: book.name, chapters: clean }));
});

const meta = {
  id, name: fullName, shortName, language: 'es', source,
  license: 'Dominio público',
  generated: new Date().toISOString().slice(0, 10),
  verseCounts
};
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta));
console.log(`Wrote ${Object.keys(verseCounts).length} books, ${total} verses to ${path.relative(process.cwd(), outDir)}/`);
