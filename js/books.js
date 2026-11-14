/*
 * books.js — Canonical list of the 66 books with Spanish names and the
 * aliases used by the spoken/typed reference parser.
 *
 * Works in the browser (window.BibliaBooks), in the service worker
 * (self.BibliaBooks, via importScripts) and in Node (require) for tests.
 *
 * Fields:
 *   id      URL-safe slug, also the data file name: data/<translation>/<id>.json
 *   name    Display name (with accents)
 *   spoken  Name as it is said aloud (used for screen readers and read-aloud)
 *   t       Testament: "AT" (Antiguo) or "NT" (Nuevo)
 *   ord     For numbered books (1 Samuel, 2 Corintios…): 1, 2 or 3. Otherwise null.
 *   ch      Number of chapters (the translation's meta.json has exact verse counts)
 *   aliases Spoken/written names, lowercase. Accents and filler words such as
 *           "de", "los" are removed automatically before matching.
 *   abbr    Common written abbreviations (exact match only, never fuzzy)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BibliaBooks = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [id, name, spoken, testament, ord, chapters, aliases, abbreviations]
  var RAW = [
    ['genesis', 'Génesis', 'Génesis', 'AT', null, 50, ['genesis'], ['gn', 'gen']],
    ['exodo', 'Éxodo', 'Éxodo', 'AT', null, 40, ['exodo', 'exodos'], ['ex', 'exo']],
    ['levitico', 'Levítico', 'Levítico', 'AT', null, 27, ['levitico', 'leviticos'], ['lv', 'lev']],
    ['numeros', 'Números', 'Números', 'AT', null, 36, ['numeros'], ['nm', 'nu']],
    ['deuteronomio', 'Deuteronomio', 'Deuteronomio', 'AT', null, 34, ['deuteronomio'], ['dt', 'deut', 'deu']],
    ['josue', 'Josué', 'Josué', 'AT', null, 24, ['josue'], ['jos']],
    ['jueces', 'Jueces', 'Jueces', 'AT', null, 21, ['jueces', 'juez'], ['jue', 'jc']],
    ['rut', 'Rut', 'Rut', 'AT', null, 4, ['rut', 'ruth'], ['rt']],
    ['1-samuel', '1 Samuel', 'Primero de Samuel', 'AT', 1, 31, ['samuel'], ['s', 'sa', 'sam', 'sm']],
    ['2-samuel', '2 Samuel', 'Segundo de Samuel', 'AT', 2, 24, ['samuel'], ['s', 'sa', 'sam', 'sm']],
    ['1-reyes', '1 Reyes', 'Primero de Reyes', 'AT', 1, 22, ['reyes', 'rey'], ['r', 're', 'rey', 'rs']],
    ['2-reyes', '2 Reyes', 'Segundo de Reyes', 'AT', 2, 25, ['reyes', 'rey'], ['r', 're', 'rey', 'rs']],
    ['1-cronicas', '1 Crónicas', 'Primero de Crónicas', 'AT', 1, 29, ['cronicas', 'cronica'], ['cr', 'cro', 'cron']],
    ['2-cronicas', '2 Crónicas', 'Segundo de Crónicas', 'AT', 2, 36, ['cronicas', 'cronica'], ['cr', 'cro', 'cron']],
    ['esdras', 'Esdras', 'Esdras', 'AT', null, 10, ['esdras'], ['esd']],
    ['nehemias', 'Nehemías', 'Nehemías', 'AT', null, 13, ['nehemias'], ['neh', 'ne']],
    ['ester', 'Ester', 'Ester', 'AT', null, 10, ['ester', 'esther'], ['est']],
    ['job', 'Job', 'Job', 'AT', null, 42, ['job'], ['jb']],
    ['salmos', 'Salmos', 'Salmos', 'AT', null, 150, ['salmos', 'salmo'], ['sal', 'sl', 'slm']],
    ['proverbios', 'Proverbios', 'Proverbios', 'AT', null, 31, ['proverbios', 'proverbio'], ['pr', 'pro', 'prov']],
    ['eclesiastes', 'Eclesiastés', 'Eclesiastés', 'AT', null, 12, ['eclesiastes', 'el predicador'], ['ec', 'ecl', 'ecc']],
    ['cantares', 'Cantares', 'Cantares', 'AT', null, 8,
      ['cantares', 'cantar de los cantares', 'cantar de cantares', 'cantico de los canticos', 'canticos', 'cantar'], ['cnt', 'cant', 'ct']],
    ['isaias', 'Isaías', 'Isaías', 'AT', null, 66, ['isaias'], ['is', 'isa']],
    ['jeremias', 'Jeremías', 'Jeremías', 'AT', null, 52, ['jeremias'], ['jer', 'jr']],
    ['lamentaciones', 'Lamentaciones', 'Lamentaciones', 'AT', null, 5, ['lamentaciones', 'lamentacion'], ['lm', 'lam']],
    ['ezequiel', 'Ezequiel', 'Ezequiel', 'AT', null, 48, ['ezequiel'], ['ez', 'eze', 'ezq']],
    ['daniel', 'Daniel', 'Daniel', 'AT', null, 12, ['daniel'], ['dn', 'dan']],
    ['oseas', 'Oseas', 'Oseas', 'AT', null, 14, ['oseas'], ['os']],
    ['joel', 'Joel', 'Joel', 'AT', null, 3, ['joel'], ['jl']],
    ['amos', 'Amós', 'Amós', 'AT', null, 9, ['amos'], ['am']],
    ['abdias', 'Abdías', 'Abdías', 'AT', null, 1, ['abdias'], ['abd', 'ab']],
    ['jonas', 'Jonás', 'Jonás', 'AT', null, 4, ['jonas'], ['jon']],
    ['miqueas', 'Miqueas', 'Miqueas', 'AT', null, 7, ['miqueas'], ['mi', 'miq']],
    ['nahum', 'Nahúm', 'Nahúm', 'AT', null, 3, ['nahum'], ['nah', 'na']],
    ['habacuc', 'Habacuc', 'Habacuc', 'AT', null, 3, ['habacuc', 'habacuq'], ['hab', 'ha']],
    ['sofonias', 'Sofonías', 'Sofonías', 'AT', null, 3, ['sofonias'], ['sof', 'so']],
    ['hageo', 'Hageo', 'Hageo', 'AT', null, 2, ['hageo', 'ageo'], ['hag', 'hg']],
    ['zacarias', 'Zacarías', 'Zacarías', 'AT', null, 14, ['zacarias'], ['zac', 'za']],
    ['malaquias', 'Malaquías', 'Malaquías', 'AT', null, 4, ['malaquias'], ['mal', 'ml']],

    ['mateo', 'Mateo', 'Mateo', 'NT', null, 28, ['mateo'], ['mt', 'mat']],
    ['marcos', 'Marcos', 'Marcos', 'NT', null, 16, ['marcos', 'marco'], ['mc', 'mr', 'mar']],
    ['lucas', 'Lucas', 'Lucas', 'NT', null, 24, ['lucas'], ['lc', 'luc', 'lu']],
    ['juan', 'Juan', 'Juan', 'NT', null, 21, ['juan'], ['jn', 'jua']],
    ['hechos', 'Hechos', 'Hechos', 'NT', null, 28, ['hechos', 'hechos de los apostoles', 'hecho'], ['hch', 'hech', 'hec']],
    ['romanos', 'Romanos', 'Romanos', 'NT', null, 16, ['romanos'], ['ro', 'rom', 'rm']],
    ['1-corintios', '1 Corintios', 'Primera de Corintios', 'NT', 1, 16, ['corintios'], ['co', 'cor']],
    ['2-corintios', '2 Corintios', 'Segunda de Corintios', 'NT', 2, 13, ['corintios'], ['co', 'cor']],
    ['galatas', 'Gálatas', 'Gálatas', 'NT', null, 6, ['galatas'], ['ga', 'gal', 'gl']],
    ['efesios', 'Efesios', 'Efesios', 'NT', null, 6, ['efesios'], ['ef', 'efe']],
    ['filipenses', 'Filipenses', 'Filipenses', 'NT', null, 4, ['filipenses'], ['fil', 'flp', 'fp']],
    ['colosenses', 'Colosenses', 'Colosenses', 'NT', null, 4, ['colosenses'], ['col', 'cl']],
    ['1-tesalonicenses', '1 Tesalonicenses', 'Primera de Tesalonicenses', 'NT', 1, 5, ['tesalonicenses'], ['ts', 'tes']],
    ['2-tesalonicenses', '2 Tesalonicenses', 'Segunda de Tesalonicenses', 'NT', 2, 3, ['tesalonicenses'], ['ts', 'tes']],
    ['1-timoteo', '1 Timoteo', 'Primera de Timoteo', 'NT', 1, 6, ['timoteo'], ['ti', 'tim', 'tm']],
    ['2-timoteo', '2 Timoteo', 'Segunda de Timoteo', 'NT', 2, 4, ['timoteo'], ['ti', 'tim', 'tm']],
    ['tito', 'Tito', 'Tito', 'NT', null, 3, ['tito'], ['tit', 'tt']],
    ['filemon', 'Filemón', 'Filemón', 'NT', null, 1, ['filemon'], ['flm', 'film', 'fm']],
    ['hebreos', 'Hebreos', 'Hebreos', 'NT', null, 13, ['hebreos'], ['he', 'heb', 'hb']],
    ['santiago', 'Santiago', 'Santiago', 'NT', null, 5, ['santiago', 'jacobo'], ['stg', 'sant', 'stgo']],
    ['1-pedro', '1 Pedro', 'Primera de Pedro', 'NT', 1, 5, ['pedro'], ['p', 'pe', 'ped', 'pd']],
    ['2-pedro', '2 Pedro', 'Segunda de Pedro', 'NT', 2, 3, ['pedro'], ['p', 'pe', 'ped', 'pd']],
    ['1-juan', '1 Juan', 'Primera de Juan', 'NT', 1, 5, ['juan'], ['jn', 'jua']],
    ['2-juan', '2 Juan', 'Segunda de Juan', 'NT', 2, 1, ['juan'], ['jn', 'jua']],
    ['3-juan', '3 Juan', 'Tercera de Juan', 'NT', 3, 1, ['juan'], ['jn', 'jua']],
    ['judas', 'Judas', 'Judas', 'NT', null, 1, ['judas'], ['jud', 'jd']],
    ['apocalipsis', 'Apocalipsis', 'Apocalipsis', 'NT', null, 22, ['apocalipsis', 'revelacion', 'revelaciones'], ['ap', 'apo', 'apoc']]
  ];

  var list = RAW.map(function (r, i) {
    return {
      index: i, id: r[0], name: r[1], spoken: r[2], t: r[3], ord: r[4],
      ch: r[5], aliases: r[6], abbr: r[7]
    };
  });

  var byId = {};
  list.forEach(function (b) { byId[b.id] = b; });

  return {
    list: list,
    byId: byId,
    get: function (id) { return byId[id] || null; },
    /** Previous/next book in canonical order (or null at the ends). */
    prev: function (id) { var b = byId[id]; return b && b.index > 0 ? list[b.index - 1] : null; },
    next: function (id) { var b = byId[id]; return b && b.index < list.length - 1 ? list[b.index + 1] : null; }
  };
});
