/*
 * Unit tests for the Spanish reference parser.
 * Run with:  node --test tests/
 * (Node 18+; no dependencies.)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require('../js/parser.js');
const meta = require(path.join(__dirname, '..', 'data', 'rv1909', 'meta.json'));
const opts = { verseCounts: meta.verseCounts };

/** Assert that `input` parses to book/chapter/verseStart/verseEnd. */
function expectRef(input, bookId, chapter, vs = null, ve = null) {
  const r = P.parseReference(input, opts);
  assert.equal(r.ok, true, `"${input}" should parse (got reason: ${r.reason})`);
  assert.deepEqual(
    { bookId: r.bookId, chapter: r.chapter, verseStart: r.verseStart, verseEnd: r.verseEnd },
    { bookId, chapter, verseStart: vs, verseEnd: ve },
    `"${input}"`
  );
  return r;
}

test('number words and digits (spec examples)', () => {
  expectRef('Juan tres dieciséis', 'juan', 3, 16);
  expectRef('Juan 3 16', 'juan', 3, 16);
  expectRef('Juan capítulo tres versículo dieciséis', 'juan', 3, 16);
  expectRef('Juan 3:16', 'juan', 3, 16);
  expectRef('juan tres dieciseis', 'juan', 3, 16);           // no accents
  expectRef('Juan tres diez y seis', 'juan', 3, 16);         // old-style compound
  expectRef('Juan tres dieci seis', 'juan', 3, 16);          // split by recogniser
  expectRef('Juan 3,16', 'juan', 3, 16);                     // Spain-style comma
  expectRef('Juan 3.16', 'juan', 3, 16);
});

test('whole chapters (spec examples)', () => {
  const r = expectRef('Salmo veintitrés', 'salmos', 23);
  assert.equal(r.label, 'Salmos 23');
  expectRef('Salmos 23', 'salmos', 23);
  expectRef('Salmo treinta y uno', 'salmos', 31);
  expectRef('Salmo ciento cincuenta', 'salmos', 150);
  expectRef('Salmo ciento diecinueve versículo ciento cinco', 'salmos', 119, 105);
});

test('ranges (spec examples)', () => {
  const r = expectRef('Mateo cinco del uno al doce', 'mateo', 5, 1, 12);
  assert.equal(r.label, 'Mateo 5:1-12');
  assert.equal(r.spoken, 'Mateo, capítulo 5, versículos del 1 al 12');
  expectRef('Romanos ocho, versículos veintiocho a treinta', 'romanos', 8, 28, 30);
  expectRef('Mateo 5:1-12', 'mateo', 5, 1, 12);
  expectRef('Mateo 5 1 al 12', 'mateo', 5, 1, 12);
  expectRef('Lucas 15 del 11 hasta el 32', 'lucas', 15, 11, 32);
  expectRef('Romanos 8 versículos 28 y 29', 'romanos', 8, 28, 29);
  // End beyond the chapter is clamped to the last verse (Mateo 5 has 48)
  expectRef('Mateo 5 del 1 al 60', 'mateo', 5, 1, 48);
});

test('numbered books (spec examples)', () => {
  expectRef('Primera de Corintios trece', '1-corintios', 13);
  expectRef('1 Corintios 13', '1-corintios', 13);
  const r = expectRef('Segunda de Timoteo', '2-timoteo', 1);
  assert.equal(r.label, '2 Timoteo 1');
  expectRef('1ra de Corintios 13', '1-corintios', 13);
  expectRef('1a Corintios 13 4', '1-corintios', 13, 4);
  expectRef('2da Timoteo 3 16', '2-timoteo', 3, 16);
  expectRef('II Reyes 2', '2-reyes', 2);
  expectRef('Primero de Samuel 17', '1-samuel', 17);
  expectRef('uno Corintios trece', '1-corintios', 13);
  expectRef('Corintios 13', '1-corintios', 13);              // no ordinal → first
});

test('Juan vs. 1/2/3 Juan', () => {
  expectRef('Juan 4 8', 'juan', 4, 8);
  expectRef('1 Juan 4 8', '1-juan', 4, 8);
  expectRef('Primera de Juan cuatro ocho', '1-juan', 4, 8);
  expectRef('tercera de Juan', '3-juan', 1);
});

test('singular/plural and missing accents (spec examples)', () => {
  expectRef('Salmo 1', 'salmos', 1);
  expectRef('Salmos 1', 'salmos', 1);
  expectRef('Genesis 1 1', 'genesis', 1, 1);
  expectRef('Génesis 1:1', 'genesis', 1, 1);
  expectRef('Exodo 20', 'exodo', 20);
  expectRef('Proverbio 3 5', 'proverbios', 3, 5);
  expectRef('NUMEROS 6 24', 'numeros', 6, 24);
});

test('fuzzy matching of small recognition errors', () => {
  expectRef('Jenesis 1', 'genesis', 1);
  expectRef('Apocalisis 21', 'apocalipsis', 21);
  expectRef('Filipences 4 13', 'filipenses', 4, 13);
  expectRef('Deuteronomo 6 4', 'deuteronomio', 6, 4);
  expectRef('Ebreos 11 1', 'hebreos', 11, 1);
  expectRef('Sacarías 9 9', 'zacarias', 9, 9);
  expectRef('Habacuq 2 4', 'habacuc', 2, 4);
  expectRef('Efesio 2 8', 'efesios', 2, 8);
});

test('natural phrasing and extra words', () => {
  expectRef('San Juan tres dieciséis', 'juan', 3, 16);
  expectRef('El evangelio según San Mateo capítulo 5', 'mateo', 5);
  expectRef('Cantar de los cantares 2', 'cantares', 2);
  expectRef('Hechos de los apóstoles 2 38', 'hechos', 2, 38);
  expectRef('Quiero leer el Salmo 23', 'salmos', 23);
  expectRef('Lee un salmo 23', 'salmos', 23);
  expectRef('capítulo 3 de Juan versículo 16', 'juan', 3, 16);
  expectRef('Mt 5 3', 'mateo', 5, 3);
  expectRef('Jn 3:16', 'juan', 3, 16);
});

test('single-chapter books', () => {
  expectRef('Judas 3', 'judas', 1, 3);
  expectRef('Judas 1', 'judas', 1);
  expectRef('Filemón 1:4', 'filemon', 1, 4);
  expectRef('Abdías versículo 4', 'abdias', 1, 4);
});

test('recogniser dropped the space: "Juan 316"', () => {
  expectRef('Juan 316', 'juan', 3, 16);
});

test('friendly failures instead of errors', () => {
  let r = P.parseReference('Juan 22', opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'chapter');
  assert.equal(r.maxChapter, 21);

  r = P.parseReference('Juan 3 50', opts);
  assert.equal(r.reason, 'verse');
  assert.equal(r.maxVerse, 36);

  assert.equal(P.parseReference('Hola, ¿cómo estás?', opts).reason, 'book');
  assert.equal(P.parseReference('tres dieciséis', opts).reason, 'book');
  assert.equal(P.parseReference('', opts).reason, 'empty');
  assert.equal(P.parseReference('   ', opts).reason, 'empty');
});

test('parseBest picks the first alternative that works', () => {
  const r = P.parseBest(['hola que tal', 'Juan 3 16'], opts);
  assert.equal(r.ok, true);
  assert.equal(r.label, 'Juan 3:16');
  const f = P.parseBest(['hola', 'Juan 40'], opts);
  assert.equal(f.reason, 'chapter');   // the more useful failure is reported
});

test('labels', () => {
  assert.equal(P.parseReference('Juan 3 16 al 18', opts).label, 'Juan 3:16-18');
  assert.equal(P.parseReference('Juan 3 16', opts).spoken, 'Juan, capítulo 3, versículo 16');
  assert.equal(P.parseReference('1 Corintios 13', opts).spoken, 'Primera de Corintios, capítulo 13');
});

test('every book name parses from its own display name', () => {
  const Books = require('../js/books.js');
  for (const b of Books.list) {
    const r = P.parseReference(b.name + ' 1', opts);
    assert.equal(r.ok, true, b.name);
    assert.equal(r.bookId, b.id, b.name);
    const s = P.parseReference(b.spoken + ' 1', opts);
    assert.equal(s.bookId, b.id, b.spoken);
  }
});
