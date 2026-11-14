/*
 * parser.js — Understands Bible references said aloud or typed in Spanish.
 *
 *   parseReference("Juan tres dieciséis", { verseCounts })
 *     → { ok: true, bookId: "juan", chapter: 3, verseStart: 16, verseEnd: null,
 *         label: "Juan 3:16", spoken: "Juan, capítulo 3, versículo 16", ... }
 *
 * Handles:
 *   - digits and Spanish number words ("tres", "dieciséis", "treinta y uno",
 *     "ciento diecinueve", old-style "diez y seis")
 *   - "capítulo"/"versículo" keywords, "3:16", "3.16", Spain-style "3,16"
 *   - ranges: "del uno al doce", "versículos 28 a 30", "16-18", "hasta"
 *   - numbered books: "Primera de Corintios", "1 Corintios", "1ra", "II Reyes"
 *   - singular/plural, missing accents and small recognition errors on book
 *     names (accent-insensitive + Spanish phonetic folding + edit distance)
 *   - speech glitches such as "Juan 316" (recogniser dropped the space)
 *
 * verseCounts (optional but recommended) is the translation's
 * meta.json "verseCounts" map: { bookId: [versesInChapter1, ...] }.
 * It lets the parser reject chapters/verses that don't exist.
 *
 * UMD: window.BibliaParser in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./books.js'));
  } else {
    root.BibliaParser = factory(root.BibliaBooks);
  }
})(typeof self !== 'undefined' ? self : this, function (Books) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Text normalisation                                                  */
  /* ------------------------------------------------------------------ */

  function stripAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /**
   * Lowercase, remove accents and punctuation, and rewrite numeric
   * notations into tokens the parser understands.
   */
  function normalize(text) {
    var s = String(text == null ? '' : text).toLowerCase();
    // Ordinal indicators: "1ª", "2.º", "1°" → "1"
    s = s.replace(/([123])\s*\.?\s*[ªº°]/g, '$1');
    s = stripAccents(s);
    // "1ra", "2da", "3er", "1a", "1o", "1.a" → digit (no space allowed, so "1 a 12" is untouched)
    s = s.replace(/\b([123])\.?(?:era|ero|ra|ro|da|do|er|ta|to|a|o)\b/g, '$1');
    // Chapter:verse separators: "3:16", "3.16", "3,16" (no spaces around the comma)
    s = s.replace(/(\d)\s*[:.]\s*(\d)/g, '$1 : $2');
    s = s.replace(/(\d),(\d)/g, '$1 : $2');
    // Ranges written with dashes: "1-12", "16–18"
    s = s.replace(/(\d)\s*[-‐-―]\s*(\d)/g, '$1 al $2');
    // Everything else that isn't a letter, digit or colon becomes a space
    s = s.replace(/[^a-z0-9:]+/g, ' ');
    s = s.replace(/:/g, ' : ');
    return s.replace(/\s+/g, ' ').trim();
  }

  /**
   * Spanish phonetic folding so that spelling/recognition variants compare
   * equal: "Jenesis"="Génesis", "Ebreos"="Hebreos", "Sacarías"="Zacarías".
   */
  function phon(s) {
    return s.replace(/\s+/g, '')
      .replace(/ch/g, '§')          // protect "ch"
      .replace(/h/g, '')                 // silent h
      .replace(/qu/g, 'k')
      .replace(/c([ei])/g, 's$1')
      .replace(/[cq]/g, 'k')
      .replace(/z/g, 's')
      .replace(/v/g, 'b')
      .replace(/w/g, 'u')
      .replace(/g([ei])/g, 'j$1')
      .replace(/ll/g, 'y')
      .replace(/y$/g, 'i')
      .replace(/(.)\1+/g, '$1')          // collapse doubled letters
      .replace(/§/g, 'ch');
  }

  /** Classic Levenshtein edit distance. */
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1), cur = new Array(b.length + 1), i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }

  /* ------------------------------------------------------------------ */
  /* Vocabulary                                                          */
  /* ------------------------------------------------------------------ */

  // Number words, keyed by their phonetic form so misspellings still work.
  var NUMBER_WORDS = {};
  function addNums(kind, map) {
    Object.keys(map).forEach(function (w) { NUMBER_WORDS[phon(w)] = { v: map[w], kind: kind }; });
  }
  addNums('unit', { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 });
  addNums('teen', {
    once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
  });
  // "tens" may be followed by "y" + unit: "treinta y uno", "diez y seis"
  addNums('tens', { diez: 10, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 });
  // Recognisers sometimes split compounds: "dieci seis", "veinti tres"
  addNums('prefix', { dieci: 10, veinti: 20 });
  addNums('hundred', { cien: 100, ciento: 100 });

  function numWord(tok) { return tok ? NUMBER_WORDS[phon(tok)] || null : null; }
  function isDigits(tok) { return /^\d+$/.test(tok); }
  function isNumberToken(tok) { return isDigits(tok) || !!numWord(tok); }

  // Words that carry no meaning for the book name.
  var FILLER = toSet('el la los las lo de del a al en san santo segun evangelio libro carta epistola apostol ' +
    'profeta numero num no por favor quiero leer lee abre abrir busca buscar buscame ir ve vamos llevame ' +
    'muestrame muestra pon ponme dame biblia cita pasaje version porfa ok oye hola');
  var CHAPTER_MARK = toSet('capitulo capitulos cap caps cp');
  var VERSE_MARK = toSet('versiculo versiculos verso versos vers vs vv v');
  var RANGE_MARK = toSet('al a hasta y');
  var START_MARK = toSet('del de desde');
  // Ordinal words that can start a numbered book name.
  var ORD_WORDS = { primera: 1, primero: 1, primer: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, tercer: 3, i: 1, ii: 2, iii: 3 };
  // Number tokens that act as an ordinal when they come right before a book name.
  var ORD_NUMBERS = { '1': 1, '2': 2, '3': 3, uno: 1, una: 1, un: 1, dos: 2, tres: 3 };

  function toSet(str) { var o = {}; str.split(' ').forEach(function (w) { o[w] = true; }); return { has: function (w) { return o[w] === true; } }; }

  /** Turn an alias like "Cantar de los Cantares" into comparable keys. */
  function aliasKey(alias) {
    var words = normalize(alias).split(' ').filter(function (w) { return w && !FILLER.has(w); });
    var plain = words.join('');
    return { plain: plain, phon: phon(plain) };
  }

  // Pre-compute alias keys for every book.
  var ENTRIES = [];
  Books.list.forEach(function (b) {
    b.aliases.forEach(function (a) { var k = aliasKey(a); ENTRIES.push({ book: b, plain: k.plain, phon: k.phon, abbr: false }); });
    b.abbr.forEach(function (a) { ENTRIES.push({ book: b, plain: a, phon: a, abbr: true }); });
  });

  function fuzzyThreshold(len) {
    if (len <= 3) return 0;   // "job", "rut": exact only
    if (len <= 6) return 1;
    if (len <= 9) return 2;
    return 3;
  }

  /* ------------------------------------------------------------------ */
  /* Numbers                                                             */
  /* ------------------------------------------------------------------ */

  /** Parse a number below 100 starting at tokens[i]. */
  function parseBelowHundred(t, i) {
    var tok = t[i];
    if (tok == null) return null;
    if (isDigits(tok)) { var d = parseInt(tok, 10); return d < 100 ? { value: d, next: i + 1 } : null; }
    var w = numWord(tok);
    if (!w || w.kind === 'hundred') return null;
    var u;
    if (w.kind === 'prefix') {
      u = numWord(t[i + 1]);
      if (u && u.kind === 'unit' && u.v > 0) return { value: w.v + u.v, next: i + 2 };
      return { value: w.v, next: i + 1 };
    }
    if (w.kind === 'tens' && t[i + 1] === 'y') {
      u = numWord(t[i + 2]);
      if (u && u.kind === 'unit' && u.v > 0) return { value: w.v + u.v, next: i + 3 };
    }
    return { value: w.v, next: i + 1 };
  }

  /** Parse one number (digits or words) at tokens[i]. Returns {value, next, raw} or null. */
  function parseNumberAt(t, i) {
    var tok = t[i];
    if (tok == null) return null;
    if (isDigits(tok)) return { value: parseInt(tok, 10), next: i + 1, raw: tok };
    var w = numWord(tok);
    if (!w) return null;
    if (w.kind === 'hundred') {
      var sub = parseBelowHundred(t, i + 1);
      return sub ? { value: 100 + sub.value, next: sub.next } : { value: 100, next: i + 1 };
    }
    return parseBelowHundred(t, i);
  }

  /* ------------------------------------------------------------------ */
  /* Book matching                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Find the best book for a list of words (already without fillers/ordinal).
   * Tries every contiguous span, so extra words ("mi salmo favorito") are tolerated.
   */
  function matchBook(words, ord) {
    var best = null;
    var n = words.length;
    for (var len = n; len >= 1; len--) {
      for (var start = 0; start + len <= n; start++) {
        var plain = words.slice(start, start + len).join('');
        var ph = phon(plain);
        for (var e = 0; e < ENTRIES.length; e++) {
          var en = ENTRIES[e];
          // Ordinal compatibility
          var b = en.book, ordPenalty;
          if (ord != null) {
            if (b.ord === ord) ordPenalty = 0;
            else if (b.ord == null) ordPenalty = 2;   // ordinal ignored
            else continue;
          } else {
            if (b.ord == null) ordPenalty = 0;
            else if (b.ord === 1) ordPenalty = 1;     // "Corintios" → 1 Corintios
            else continue;
          }
          var dist;
          if (plain === en.plain) dist = 0;
          else if (en.abbr) continue;                 // abbreviations: exact only
          else if (ph === en.phon) dist = 0.1;
          else {
            var th = fuzzyThreshold(en.plain.length);
            if (!th) continue;
            if (Math.abs(ph.length - en.phon.length) > th) continue;
            dist = levenshtein(ph, en.phon);
            if (dist > th) continue;
          }
          var score = [dist, ordPenalty, en.abbr ? 1 : 0, -len];
          if (!best || lexLess(score, best.score)) best = { book: b, score: score };
        }
      }
    }
    return best ? best.book : null;
  }

  function lexLess(a, b) {
    for (var i = 0; i < a.length; i++) { if (a[i] < b[i]) return true; if (a[i] > b[i]) return false; }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Main entry point                                                    */
  /* ------------------------------------------------------------------ */

  function parseReference(input, opts) {
    opts = opts || {};
    var verseCounts = opts.verseCounts || null;
    var norm = normalize(input);
    var heard = String(input == null ? '' : input).trim();
    if (!norm) return { ok: false, reason: 'empty', heard: heard };

    var t = norm.split(' ');

    // 1. Split the tokens into "word runs" (anything that isn't a number/marker).
    var runs = [], cur = null;
    for (var i = 0; i < t.length; i++) {
      var tok = t[i];
      var breaks = isNumberToken(tok) || tok === ':' || CHAPTER_MARK.has(tok) || VERSE_MARK.has(tok);
      if (breaks) { if (cur) { runs.push(cur); cur = null; } continue; }
      if (!cur) cur = { start: i, end: i };
      cur.end = i;
    }
    if (cur) runs.push(cur);

    var firstMeaningful = 0;
    while (firstMeaningful < t.length && FILLER.has(t[firstMeaningful])) firstMeaningful++;

    // 2. Find the first run that names a book.
    var book = null, skip = {};
    for (var r = 0; r < runs.length && !book; r++) {
      var run = runs[r];
      var words = [], ord = null, ordIndex = -1;
      for (var k = run.start; k <= run.end; k++) {
        var w = t[k];
        if (FILLER.has(w)) continue;
        if (!words.length && ord == null && ORD_WORDS[w]) { ord = ORD_WORDS[w]; continue; }
        words.push(w);
      }
      // A number right before the book name at the very start: "1 Corintios", "dos de Samuel"
      if (ord == null && run.start > 0 && run.start - 1 === firstMeaningful && ORD_NUMBERS[t[run.start - 1]] != null) {
        ord = ORD_NUMBERS[t[run.start - 1]];
        ordIndex = run.start - 1;
      }
      if (!words.length) continue;
      book = matchBook(words, ord);
      if (book) {
        for (var s = run.start; s <= run.end; s++) skip[s] = true;
        if (ordIndex >= 0) skip[ordIndex] = true;
      }
    }
    if (!book) return { ok: false, reason: 'book', heard: heard, normalized: norm };

    // 3. Read chapter / verse numbers from the remaining tokens.
    var chapter = null, chapterRaw = null, vs = null, ve = null;
    var expect = 'chapter', explicitChapter = false, explicitVerse = false, pending = null;
    var j = 0;
    while (j < t.length) {
      if (skip[j]) { j++; continue; }
      var tk = t[j];
      if (CHAPTER_MARK.has(tk)) { expect = 'chapter'; explicitChapter = true; j++; continue; }
      if (VERSE_MARK.has(tk)) { expect = vs == null ? 'vs' : 've'; explicitVerse = true; j++; continue; }
      if (tk === ':') { expect = 'vs'; j++; continue; }
      if (RANGE_MARK.has(tk)) { if (vs != null) expect = 've'; j++; continue; }
      if (START_MARK.has(tk)) { if (chapter != null && vs == null) expect = 'vs'; j++; continue; }
      var num = parseNumberAt(t, j);
      if (num) {
        j = num.next;
        if (chapter == null && expect === 'vs' && explicitVerse) { pending = num.value; expect = 've'; continue; }
        if (chapter == null) { chapter = num.value; chapterRaw = num.raw || null; expect = 'vs'; }
        else if (vs == null) { vs = num.value; expect = 've'; }
        else if (ve == null) { ve = num.value; expect = 'done'; }
        continue;
      }
      j++; // unknown word: ignore
    }

    var counts = verseCounts && verseCounts[book.id] ? verseCounts[book.id] : null;
    var nChapters = counts ? counts.length : book.ch;

    // "versículo N" said without a chapter
    if (chapter == null && pending != null) {
      if (nChapters === 1) { chapter = 1; vs = pending; }
      else { chapter = pending; }
    }
    // Book only ("Segunda de Timoteo") → first chapter
    if (chapter == null) chapter = 1;

    // Single-chapter books: "Judas 3" means verse 3
    if (nChapters === 1 && vs == null && !explicitChapter && chapter > 1) { vs = chapter; chapter = 1; }

    // "Juan 316" → the recogniser dropped the space: try 3:16, then 31:6.
    // (Only for 3+ digits, so "Juan 22" is still reported as a missing chapter.)
    if (chapter > nChapters && vs == null && chapterRaw && chapterRaw.length >= 3) {
      for (var cut = 1; cut < chapterRaw.length; cut++) {
        var c = parseInt(chapterRaw.slice(0, cut), 10), v = parseInt(chapterRaw.slice(cut), 10);
        if (c >= 1 && c <= nChapters && v >= 1 && (!counts || v <= counts[c - 1])) { chapter = c; vs = v; break; }
      }
    }

    var base = { heard: heard, normalized: norm, bookId: book.id, bookName: book.name, book: book };
    if (chapter < 1 || chapter > nChapters) {
      return assign(base, { ok: false, reason: 'chapter', chapter: chapter, maxChapter: nChapters });
    }
    var nVerses = counts ? counts[chapter - 1] : null;
    if (vs != null && (vs < 1 || (nVerses && vs > nVerses))) {
      return assign(base, { ok: false, reason: 'verse', chapter: chapter, verse: vs, maxVerse: nVerses });
    }
    if (vs == null) ve = null;
    if (ve != null) {
      if (ve <= vs) ve = null;
      else if (nVerses && ve > nVerses) ve = nVerses;
    }
    var ref = assign(base, { ok: true, chapter: chapter, verseStart: vs, verseEnd: ve });
    ref.label = formatReference(ref);
    ref.spoken = spokenReference(ref);
    return ref;
  }

  /** Try several recogniser alternatives; return the first that parses. */
  function parseBest(alternatives, opts) {
    var firstFail = null, informative = null;
    for (var i = 0; i < alternatives.length; i++) {
      var res = parseReference(alternatives[i], opts);
      if (res.ok) return res;
      if (!firstFail) firstFail = res;
      if (!informative && (res.reason === 'chapter' || res.reason === 'verse')) informative = res;
    }
    return informative || firstFail || { ok: false, reason: 'empty', heard: '' };
  }

  function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

  /** "Juan 3:16", "Mateo 5:1-12", "Salmos 23" */
  function formatReference(ref) {
    var name = ref.bookName || (Books.get(ref.bookId) || {}).name;
    var s = name + ' ' + ref.chapter;
    if (ref.verseStart != null) s += ':' + ref.verseStart + (ref.verseEnd != null ? '-' + ref.verseEnd : '');
    return s;
  }

  /** "Mateo, capítulo 5, versículos del 1 al 12" — for screen readers and read-aloud. */
  function spokenReference(ref) {
    var b = Books.get(ref.bookId);
    var s = (b ? b.spoken : ref.bookName) + ', capítulo ' + ref.chapter;
    if (ref.verseStart != null) {
      s += ref.verseEnd != null
        ? ', versículos del ' + ref.verseStart + ' al ' + ref.verseEnd
        : ', versículo ' + ref.verseStart;
    }
    return s;
  }

  return {
    parseReference: parseReference,
    parseBest: parseBest,
    formatReference: formatReference,
    spokenReference: spokenReference,
    normalize: normalize,
    phon: phon,
    levenshtein: levenshtein
  };
});
