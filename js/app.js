/*
 * app.js — Biblia Reina-Valera 1909 for seniors and people with low vision.
 *
 * Single-page app with hash routes (so the phone's Back button works):
 *   #/libros                     Books home: "Continuar leyendo" + the two Testaments
 *   #/libros/at | #/libros/nt    Book list for one Testament
 *   #/libro/<id>                 Chapter picker
 *   #/leer/<id>/<ch>[/<v>[-<v2>]] Reading screen (optional verses to highlight)
 *   #/marcadores                 Bookmarks
 *   #/ajustes                    Settings (live preview)
 *   #/acerca                     About / source of the text
 *   #/buscar                     Typed search (fallback for voice search)
 *
 * Everything the user sees is in Spanish; code comments are in English.
 */
(function () {
  'use strict';

  var CONFIG = window.BIBLIA_CONFIG;
  var Books = window.BibliaBooks;
  var Parser = window.BibliaParser;

  var main = document.getElementById('main');
  var backBtn = document.getElementById('back-btn');
  var bar = document.getElementById('bottom-bar');
  var hablarBtn = document.getElementById('btn-hablar');
  var voicePanel = document.getElementById('voice-panel');
  var voiceInner = document.getElementById('voice-inner');
  var announcer = document.getElementById('announcer');

  /* ================================================================== */
  /* Small helpers                                                       */
  /* ================================================================== */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem('biblia.' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('biblia.' + key, JSON.stringify(value)); } catch (e) { /* full or blocked */ }
    }
  };

  /** Polite screen-reader announcement (nothing visual, nothing that disappears on screen). */
  function announce(msg) {
    announcer.textContent = '';
    setTimeout(function () { announcer.textContent = msg; }, 60);
  }

  function go(hash) {
    if (location.hash === hash) router();
    else location.hash = hash;
  }

  // Inline SVG icons. Always paired with a visible text label.
  var ICON = {
    play: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path class="icon-fill" d="M8 5.2v13.6L19 12z"/></svg>',
    pause: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><rect class="icon-fill" x="6" y="5" width="4.2" height="14" rx="1"/><rect class="icon-fill" x="13.8" y="5" width="4.2" height="14" rx="1"/></svg>',
    bookmark: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3.5h10c.6 0 1 .4 1 1V21l-6-4-6 4V4.5c0-.6.4-1 1-1z"/></svg>',
    bookmarkOn: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path class="icon-fill" d="M7 3.5h10c.6 0 1 .4 1 1V21l-6-4-6 4V4.5c0-.6.4-1 1-1z"/></svg>',
    prev: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    mic: '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>'
  };

  /* ================================================================== */
  /* Settings                                                            */
  /* ================================================================== */

  var SIZE_MIN = 18, SIZE_MAX = 40, SIZE_STEP = 2;
  var RATES = [
    { v: 0.6, label: 'Muy lenta' },
    { v: 0.75, label: 'Lenta' },
    { v: 0.9, label: 'Un poco lenta' },
    { v: 1.0, label: 'Normal' },
    { v: 1.15, label: 'Un poco rápida' },
    { v: 1.3, label: 'Rápida' },
    { v: 1.5, label: 'Muy rápida' }
  ];
  var THEME_COLORS = { claro: '#FAF7F0', oscuro: '#121212', contraste: '#000000' };

  var settings = Object.assign({ size: 24, theme: 'claro', font: 'sans', rate: 2 }, store.get('ajustes', {}));

  function applySettings() {
    var root = document.documentElement;
    root.style.setProperty('--text-scale', String(settings.size / 16));
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('data-font', settings.font);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[settings.theme] || THEME_COLORS.claro);
  }
  function saveSettings() { store.set('ajustes', settings); applySettings(); }

  /* ================================================================== */
  /* Bible data (local JSON, cached by the service worker)               */
  /* ================================================================== */

  var meta = null;            // data/<translation>/meta.json
  var bookCache = {};         // id → Promise<book>

  function loadMeta() {
    return fetch('data/' + CONFIG.translation + '/meta.json').then(function (r) {
      if (!r.ok) throw new Error('meta ' + r.status);
      return r.json();
    }).then(function (m) { meta = m; return m; });
  }

  function loadBook(id) {
    if (!bookCache[id]) {
      bookCache[id] = fetch('data/' + CONFIG.translation + '/' + id + '.json').then(function (r) {
        if (!r.ok) throw new Error('book ' + r.status);
        return r.json();
      });
      bookCache[id].catch(function () { delete bookCache[id]; });
    }
    return bookCache[id];
  }

  function chapterCount(id) {
    return meta && meta.verseCounts[id] ? meta.verseCounts[id].length : Books.get(id).ch;
  }
  function prevChapter(id, ch) {
    if (ch > 1) return { id: id, ch: ch - 1 };
    var b = Books.prev(id);
    return b ? { id: b.id, ch: chapterCount(b.id) } : null;
  }
  function nextChapter(id, ch) {
    if (ch < chapterCount(id)) return { id: id, ch: ch + 1 };
    var b = Books.next(id);
    return b ? { id: b.id, ch: 1 } : null;
  }
  function readHash(id, ch) { return '#/leer/' + id + '/' + ch; }

  /* ================================================================== */
  /* Screen scaffolding                                                  */
  /* ================================================================== */

  var renderToken = 0;
  var currentRoute = '';

  /**
   * Draw a screen.
   *  title: document title; back: {href, label} or null; nav: active bar item.
   */
  function show(opts) {
    document.title = opts.title ? opts.title + ' — Biblia' : 'Biblia — Reina-Valera 1909';
    if (opts.back) {
      backBtn.hidden = false;
      backBtn.setAttribute('href', opts.back.href);
      backBtn.setAttribute('aria-label', opts.back.label || 'Volver');
    } else {
      backBtn.hidden = true;
    }
    bar.querySelectorAll('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === opts.nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    main.innerHTML = opts.html;
  }

  /** Move keyboard / screen-reader focus to the new screen's heading. */
  function focusHeading() {
    var h = main.querySelector('h1');
    if (h) {
      h.setAttribute('tabindex', '-1');
      try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
    }
  }

  function bookLink(b) {
    var href = chapterCount(b.id) === 1 ? readHash(b.id, 1) : '#/libro/' + b.id;
    return '<li><a class="btn" href="' + href + '">' + esc(b.name) + '</a></li>';
  }

  /* ================================================================== */
  /* Screens                                                             */
  /* ================================================================== */

  var pendingResume = false;   // restore scroll position of the last chapter read
  var buscarNotice = null;     // 'unsupported' | 'denied' | null

  function renderLibros() {
    var last = store.get('ultimo', null);
    var lastBook = last && Books.get(last.book);
    var html = '<h1>Libros</h1>';
    if (lastBook) {
      html += '<div class="stack">' +
        '<a class="btn btn-primary btn-block btn-tall" data-action="continue" href="' + readHash(lastBook.id, last.chapter) + '">' +
        '<span class="btn-title">Continuar leyendo</span>' +
        '<span class="btn-sub">' + esc(lastBook.name + ' ' + last.chapter) + '</span></a>';
    } else {
      html += '<p class="lead">Bienvenido. Elija una parte de la Biblia para empezar a leer.</p>' +
        '<p class="lead">También puede tocar «Hablar» y decir, por ejemplo, «Juan 3:16».</p>' +
        '<div class="stack">';
    }
    html += '<a class="btn btn-block btn-tall" href="#/libros/at">' +
      '<span class="btn-title">Antiguo Testamento</span><span class="btn-sub">De Génesis a Malaquías</span></a>' +
      '<a class="btn btn-block btn-tall" href="#/libros/nt">' +
      '<span class="btn-title">Nuevo Testamento</span><span class="btn-sub">De Mateo a Apocalipsis</span></a>' +
      '</div>';
    show({ title: 'Libros', back: null, nav: 'libros', html: html });
  }

  function renderTestament(t) {
    var isAT = t === 'at';
    var title = isAT ? 'Antiguo Testamento' : 'Nuevo Testamento';
    var books = Books.list.filter(function (b) { return b.t === (isAT ? 'AT' : 'NT'); });
    var html = '<h1>' + title + '</h1>' +
      '<p>Elija un libro.</p>' +
      '<ul class="grid grid-books">' + books.map(bookLink).join('') + '</ul>';
    show({ title: title, back: { href: '#/libros', label: 'Volver a Libros' }, nav: 'libros', html: html });
  }

  function renderChapters(id) {
    var b = Books.get(id);
    if (!b) return go('#/libros');
    var n = chapterCount(id);
    if (n === 1) { location.replace(readHash(id, 1)); return; }
    var last = store.get('ultimo', null);
    var items = '';
    for (var c = 1; c <= n; c++) {
      var isLast = last && last.book === id && last.chapter === c;
      items += '<li><a class="btn' + (isLast ? ' btn-current' : '') + '" href="' + readHash(id, c) + '"' +
        ' aria-label="Capítulo ' + c + (isLast ? ', aquí se quedó' : '') + '">' + c + '</a></li>';
    }
    var html = '<h1>' + esc(b.name) + '</h1>' +
      '<p>Elija un capítulo.' + (last && last.book === id ? ' El capítulo marcado es donde se quedó.' : '') + '</p>' +
      '<ul class="grid grid-chapters">' + items + '</ul>';
    var t = b.t === 'AT' ? 'at' : 'nt';
    show({
      title: b.name, nav: 'libros', html: html,
      back: { href: '#/libros/' + t, label: 'Volver a ' + (t === 'at' ? 'Antiguo' : 'Nuevo') + ' Testamento' }
    });
  }

  function renderReader(id, ch, v1, v2) {
    var b = Books.get(id);
    if (!b) return go('#/libros');
    var n = chapterCount(id);
    if (ch < 1 || ch > n) return go('#/libro/' + id);
    var token = ++renderToken;
    var back = n === 1
      ? { href: '#/libros/' + (b.t === 'AT' ? 'at' : 'nt'), label: 'Volver a la lista de libros' }
      : { href: '#/libro/' + id, label: 'Volver a los capítulos de ' + b.name };
    var title = b.name + ' ' + ch;

    show({ title: title, back: back, nav: 'libros', html: '<h1>' + esc(title) + '</h1><p class="loading">Cargando…</p>' });

    loadBook(id).then(function (data) {
      if (token !== renderToken) return;   // user already moved on
      var verses = data.chapters[ch - 1] || [];
      var saved = isBookmarked(id, ch);
      var hasRange = v1 != null;
      var vEnd = v2 != null ? v2 : v1;

      var body = '';
      var lastFound = null;
      verses.forEach(function (text, i) {
        var num = i + 1;
        if (hasRange && num >= v1 && num <= vEnd && text) lastFound = num;
      });
      verses.forEach(function (text, i) {
        if (!text) return;   // a few verses are empty in this versification
        var num = i + 1;
        var found = hasRange && num >= v1 && num <= vEnd;
        body += '<p class="verse' + (found ? ' is-found' : '') + '" id="v' + num + '" data-v="' + num + '">' +
          (found && num === v1 ? '<span class="visually-hidden">Versículo buscado: </span>' : '') +
          '<span class="vnum">' + num + '</span>' + esc(text) + '</p>';
        if (found && num === lastFound) {
          var plural = v2 != null && v2 > v1;
          body += '<div class="found-callout"><p>' + esc(b.name + ' ' + ch + ':' + v1 + (plural ? '-' + v2 : '')) + '</p>' +
            '<button class="btn" type="button" data-action="listen" data-mode="verses">' + ICON.play +
            '<span>' + (plural ? 'Escuchar los versículos' : 'Escuchar el versículo') + '</span></button></div>';
        }
      });

      var prev = prevChapter(id, ch), next = nextChapter(id, ch);
      var navHtml = '<nav class="chapter-nav" aria-label="Cambiar de capítulo">';
      if (prev) {
        var pb = Books.get(prev.id);
        navHtml += '<a class="btn btn-tall btn-prev" href="' + readHash(prev.id, prev.ch) + '" rel="prev">' +
          '<span class="btn-title">' + ICON.prev + ' Anterior</span><span class="btn-sub">' + esc(pb.name + ' ' + prev.ch) + '</span></a>';
      }
      if (next) {
        var nb = Books.get(next.id);
        navHtml += '<a class="btn btn-tall btn-next" href="' + readHash(next.id, next.ch) + '" rel="next">' +
          '<span class="btn-title">Siguiente ' + ICON.next + '</span><span class="btn-sub">' + esc(nb.name + ' ' + next.ch) + '</span></a>';
      }
      navHtml += '</nav>';

      main.innerHTML =
        '<h1 aria-label="' + esc(b.spoken + ', capítulo ' + ch) + '">' + esc(title) + '</h1>' +
        '<div class="reader-actions">' +
        '<button class="btn" type="button" data-action="listen" data-mode="chapter">' + ICON.play + '<span>Escuchar</span></button>' +
        bookmarkButtonHtml(saved) +
        '</div>' +
        '<div class="chapter-text" id="chapter-text">' + body + '</div>' +
        navHtml;

      store.set('ultimo', { book: id, chapter: ch, scroll: pendingResume ? (store.get('ultimo', {}) || {}).scroll || 0 : 0 });
      currentReader = { id: id, ch: ch, v1: v1, v2: v2, book: b, verses: verses };

      var restore = pendingResume && !hasRange;
      pendingResume = false;
      afterLayout(function () {
        if (token !== renderToken) return;
        var firstFound = hasRange ? main.querySelector('.verse.is-found') : null;
        if (firstFound) {
          firstFound.setAttribute('tabindex', '-1');
          firstFound.scrollIntoView({ block: 'start' });
          try { firstFound.focus({ preventScroll: true }); } catch (e) { firstFound.focus(); }
        } else if (restore) {
          var last = store.get('ultimo', {});
          var max = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, Math.round((last.scroll || 0) * Math.max(0, max)));
          focusHeading();
        } else {
          focusHeading();
        }
      });
    }).catch(function () {
      if (token !== renderToken) return;
      main.innerHTML = '<h1>' + esc(title) + '</h1>' +
        '<p>No se pudo abrir este libro.</p>' +
        '<p>Revise su conexión a internet e intente de nuevo.</p>' +
        '<button class="btn btn-primary" type="button" data-action="retry">Intentar de nuevo</button>';
      focusHeading();
    });
  }

  var currentReader = null;

  /** Wait for fonts and layout before measuring/scrolling. */
  function afterLayout(fn) {
    var run = function () { requestAnimationFrame(function () { requestAnimationFrame(fn); }); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run, run);
    else run();
  }

  function bookmarkButtonHtml(saved) {
    return '<button class="btn' + (saved ? ' is-on' : '') + '" type="button" data-action="bookmark" id="btn-bookmark">' +
      (saved ? ICON.bookmarkOn : ICON.bookmark) +
      '<span>' + (saved ? 'Guardado' : 'Guardar') + '<span class="visually-hidden"> como marcador</span></span></button>';
  }

  function renderMarcadores() {
    var list = getBookmarks();
    var html = '<h1>Marcadores</h1>';
    if (!list.length) {
      html += '<p>Todavía no tiene marcadores.</p>' +
        '<p>Para guardar un capítulo, ábralo y toque «Guardar».</p>' +
        '<a class="btn btn-primary btn-block" href="#/libros">Elegir un libro</a>';
    } else {
      var fmt = dateFormatter();
      html += '<ul class="bookmark-list">' + list.map(function (m) {
        var b = Books.get(m.book);
        if (!b) return '';
        var name = b.name + ' ' + m.chapter;
        return '<li class="bookmark">' +
          '<a class="btn btn-tall" href="' + readHash(m.book, m.chapter) + '">' +
          '<span class="btn-title">' + esc(name) + '</span>' +
          (fmt ? '<span class="btn-sub">Guardado el ' + esc(fmt.format(new Date(m.savedAt))) + '</span>' : '') + '</a>' +
          '<button class="btn btn-delete" type="button" data-action="bookmark-delete" data-book="' + esc(m.book) + '" data-ch="' + m.chapter + '">' +
          'Borrar<span class="visually-hidden"> el marcador de ' + esc(name) + '</span></button>' +
          '</li>';
      }).join('') + '</ul>';
    }
    show({ title: 'Marcadores', back: null, nav: 'marcadores', html: html });
  }

  function dateFormatter() {
    try { return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return null; }
  }

  var deferredInstall = null;

  function renderAjustes() {
    var rate = RATES[settings.rate] || RATES[2];
    var html = '<h1>Ajustes</h1>' +

      '<section class="setting" aria-labelledby="h-size"><h2 id="h-size">Tamaño de la letra</h2>' +
      '<div class="stepper">' +
      '<button class="btn" type="button" data-action="size-down"' + (settings.size <= SIZE_MIN ? ' aria-disabled="true"' : '') + '>' +
      '<span class="step-sym" aria-hidden="true">A−</span><span class="step-label"><span class="visually-hidden">Letra </span>Más pequeña</span></button>' +
      '<output id="size-out" aria-live="polite"><span class="hint" style="font-weight:400">Tamaño actual: </span>' + sizeText() + '</output>' +
      '<button class="btn" type="button" data-action="size-up"' + (settings.size >= SIZE_MAX ? ' aria-disabled="true"' : '') + '>' +
      '<span class="step-sym" aria-hidden="true">A+</span><span class="step-label"><span class="visually-hidden">Letra </span>Más grande</span></button>' +
      '</div>' +
      '<div class="preview"><p class="preview-label">Vista previa</p><p class="preview-text" id="preview-text">' + esc(previewSample()) + '</p></div>' +
      '</section>' +

      '<section class="setting" aria-labelledby="h-theme"><h2 id="h-theme">Colores</h2>' +
      '<fieldset class="choices"><legend class="visually-hidden">Colores</legend>' +
      choice('theme', 'claro', 'Claro', '<span class="swatch swatch-claro" aria-hidden="true">Aa</span>') +
      choice('theme', 'oscuro', 'Modo oscuro', '<span class="swatch swatch-oscuro" aria-hidden="true">Aa</span>') +
      choice('theme', 'contraste', 'Alto contraste', '<span class="swatch swatch-contraste" aria-hidden="true">Aa</span>') +
      '</fieldset></section>' +

      '<section class="setting" aria-labelledby="h-font"><h2 id="h-font">Tipo de letra</h2>' +
      '<fieldset class="choices"><legend class="visually-hidden">Tipo de letra</legend>' +
      choice('font', 'sans', '<span class="font-sans-sample">Letra simple (recomendada)</span>', '') +
      choice('font', 'serif', '<span class="font-serif-sample">Letra clásica, con serifa</span>', '') +
      '</fieldset></section>' +

      '<section class="setting" aria-labelledby="h-rate"><h2 id="h-rate">Velocidad de la voz</h2>' +
      (ttsSupported ? '' : '<p class="notice">Su navegador no puede leer en voz alta.</p>') +
      '<div class="stepper">' +
      '<button class="btn" type="button" data-action="rate-down" aria-label="Voz más lenta"' + (settings.rate <= 0 ? ' aria-disabled="true"' : '') + '>' +
      '<span class="step-label">Más lenta</span></button>' +
      '<output id="rate-out" aria-live="polite"><span class="hint" style="font-weight:400">Velocidad actual: </span>' + esc(rate.label) + '</output>' +
      '<button class="btn" type="button" data-action="rate-up" aria-label="Voz más rápida"' + (settings.rate >= RATES.length - 1 ? ' aria-disabled="true"' : '') + '>' +
      '<span class="step-label">Más rápida</span></button>' +
      '</div>' +
      '<p style="margin-top:1rem"><button class="btn btn-block" type="button" data-action="test-voice">' + ICON.play + '<span>Probar la voz</span></button></p>' +
      '</section>' +

      (deferredInstall ? '<section class="setting" aria-labelledby="h-install"><h2 id="h-install">Instalar</h2>' +
        '<p>Puede poner esta aplicación en la pantalla de inicio de su teléfono.</p>' +
        '<button class="btn btn-block" type="button" data-action="install">Instalar la aplicación</button></section>' : '') +

      '<a class="btn btn-block" href="#/acerca">Acerca de esta aplicación</a>';

    show({ title: 'Ajustes', back: null, nav: 'ajustes', html: html });
    if (!previewText) loadPreview();
  }

  function choice(name, value, labelHtml, extra) {
    var checked = settings[name] === value;
    return '<label class="choice"><input type="radio" name="' + name + '" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
      extra + '<span>' + labelHtml + '</span></label>';
  }

  function sizeText() {
    var names = { 18: 'Pequeña', 24: 'Normal', 40: 'La más grande' };
    return settings.size + (names[settings.size] ? ' · ' + names[settings.size] : '');
  }

  // Preview sample = Psalm 23:1-2 from the bundled translation.
  var previewText = null;
  function previewSample() {
    return previewText || 'Jehová es mi pastor; nada me faltará.';
  }
  function loadPreview() {
    loadBook('salmos').then(function (d) {
      var t = (d.chapters[22][0] || '').replace(/^Salmo de David\.\s*/, '') + ' ' + (d.chapters[22][1] || '');
      previewText = t.trim();
      var el = document.getElementById('preview-text');
      if (el) el.textContent = previewText;
    }).catch(function () { /* keep the built-in sample */ });
  }

  function renderAcerca() {
    var html = '<h1>Acerca de</h1>' +
      '<p>Esta aplicación le permite leer y escuchar la Biblia con letra grande y colores claros.</p>' +
      '<h2>El texto bíblico</h2>' +
      '<p>Usa la <strong>Biblia Reina-Valera 1909</strong>, que es de dominio público: no tiene derechos de autor.</p>' +
      '<p>Se conserva la ortografía original de 1909. Por ejemplo, «á» lleva tilde y algunos nombres llevan acento circunflejo, como «Châm».</p>' +
      '<p class="hint">Texto digital: ' + esc(meta && meta.source ? meta.source : 'Reina-Valera 1909') + '.</p>' +
      '<h2>Sin internet</h2>' +
      '<p id="offline-status">Revisando…</p>' +
      '<p>La búsqueda por voz necesita internet en la mayoría de los teléfonos. Sin internet, puede escribir la cita.</p>' +
      '<h2>Privacidad</h2>' +
      '<p>No necesita cuenta. No hay anuncios. Sus marcadores y ajustes se guardan solo en este teléfono.</p>' +
      '<p>Cuando usa «Hablar», su navegador puede enviar su voz al servicio de reconocimiento de Google o de Apple para convertirla en texto. Esta aplicación no guarda grabaciones.</p>' +
      '<h2>Instalar en su teléfono</h2>' +
      '<p><strong>Android (Chrome):</strong> toque el menú de tres puntos y luego «Instalar aplicación» o «Agregar a la pantalla principal».</p>' +
      '<p><strong>iPhone (Safari):</strong> toque el botón Compartir y luego «Agregar a inicio».</p>' +
      '<h2>Letras</h2>' +
      '<p>Atkinson Hyperlegible (Braille Institute) y Literata. Ambas tienen licencia libre SIL Open Font License.</p>' +
      '<p class="hint">Versión ' + esc(CONFIG.version) + '</p>';
    show({ title: 'Acerca de', back: { href: '#/ajustes', label: 'Volver a Ajustes' }, nav: 'ajustes', html: html });
    offlineStatus().then(function (n) {
      var el = document.getElementById('offline-status');
      if (!el) return;
      if (n === Books.list.length) el.textContent = 'La Biblia completa está guardada en este teléfono. Puede leer sin internet.';
      else if (n > 0) el.textContent = 'Guardando la Biblia en este teléfono para leer sin internet (' + n + ' de ' + Books.list.length + ' libros). Deje la aplicación abierta unos minutos con internet.';
      else el.textContent = 'Para leer sin internet, abra la aplicación una vez con conexión a internet.';
    });
  }

  function offlineStatus() {
    if (!('caches' in window)) return Promise.resolve(0);
    return Promise.all(Books.list.map(function (b) {
      return caches.match('data/' + CONFIG.translation + '/' + b.id + '.json').then(function (r) { return r ? 1 : 0; }, function () { return 0; });
    })).then(function (a) { return a.reduce(function (s, x) { return s + x; }, 0); });
  }

  function renderBuscar() {
    var notice = '';
    if (buscarNotice === 'unsupported' || !voice.supported) {
      notice = '<div class="notice"><p>Su navegador no permite buscar con la voz. Puede escribir la cita aquí.</p></div>';
    } else if (buscarNotice === 'denied') {
      notice = '<div class="notice"><p>La aplicación no tiene permiso para usar el micrófono. Puede escribir la cita aquí.</p>' +
        '<p>Si quiere usar su voz, permita el micrófono en los ajustes de su navegador.</p></div>';
    }
    var html = '<h1>Buscar un pasaje</h1>' + notice +
      '<form class="search-form" id="search-form" role="search" autocomplete="off">' +
      '<label for="q">Escriba el libro, capítulo y versículo</label>' +
      '<input id="q" name="q" type="text" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="search" placeholder="Por ejemplo: Juan 3:16">' +
      '<button class="btn btn-primary" type="submit">Buscar</button>' +
      '</form>' +
      '<p class="hint" style="margin-top:1rem">Ejemplos: Juan 3:16 · Salmo 23 · Mateo 5:1-12 · 1 Corintios 13</p>' +
      '<div class="result" id="search-result" aria-live="polite"></div>' +
      (voice.supported ? '<button class="btn btn-block" type="button" data-action="voice-force">' + ICON.mic + '<span>' +
        (buscarNotice === 'denied' ? 'Probar el micrófono otra vez' : 'Hablar en su lugar') + '</span></button>' : '');
    show({ title: 'Buscar', back: null, nav: null, html: html });
    buscarNotice = null;
  }

  /** Friendly text for a failed parse. how: 'decir' (voice) or 'escribir' (typed). */
  function failureText(res, how) {
    if (res.reason === 'chapter') {
      return { title: 'No encontré ese capítulo.', body: res.bookName + ' tiene ' + res.maxChapter + ' capítulos. Intente de nuevo.' };
    }
    if (res.reason === 'verse') {
      return { title: 'No encontré ese versículo.', body: res.bookName + ' ' + res.chapter + ' tiene ' + res.maxVerse + ' versículos.', chapterOnly: true };
    }
    return { title: 'No entendí.', body: 'Intente ' + how + ' el libro, capítulo y versículo.' };
  }
  var EXAMPLES_HTML = '<ul class="examples"><li>Juan 3:16</li><li>Salmo 23</li><li>Mateo 5 del 1 al 12</li><li>Primera de Corintios 13</li></ul>';

  function refHash(res) {
    return readHash(res.bookId, res.chapter) +
      (res.verseStart != null ? '/' + res.verseStart + (res.verseEnd != null ? '-' + res.verseEnd : '') : '');
  }

  function onSearchSubmit(e) {
    e.preventDefault();
    var input = document.getElementById('q');
    var out = document.getElementById('search-result');
    var res = Parser.parseReference(input.value, { verseCounts: meta.verseCounts });
    if (res.ok) {
      out.innerHTML = '<p class="result-title"><span aria-hidden="true">Buscando: ' + esc(res.label) + '</span>' +
        '<span class="visually-hidden">Buscando: ' + esc(res.spoken) + '</span></p>' +
        '<div class="row"><a class="btn btn-primary" href="' + refHash(res) + '" aria-label="Ir a ' + esc(res.spoken) + '">Ir</a>' +
        '<button class="btn" type="button" data-action="search-retry">Intentar de nuevo</button></div>';
    } else {
      var f = failureText(res, 'escribir');
      out.innerHTML = '<p class="result-title">' + esc(f.title) + '</p><p>' + esc(f.body) + '</p>' +
        (f.chapterOnly ? '<p><a class="btn btn-primary" href="' + readHash(res.bookId, res.chapter) + '">Ir a ' + esc(res.bookName + ' ' + res.chapter) + '</a></p>'
          : '<p>Por ejemplo:</p>' + EXAMPLES_HTML);
    }
  }

  /* ================================================================== */
  /* Bookmarks                                                           */
  /* ================================================================== */

  function getBookmarks() { return store.get('marcadores', []); }
  function isBookmarked(id, ch) {
    return getBookmarks().some(function (m) { return m.book === id && m.chapter === ch; });
  }
  function addBookmark(id, ch) {
    var list = getBookmarks().filter(function (m) { return !(m.book === id && m.chapter === ch); });
    list.unshift({ book: id, chapter: ch, savedAt: Date.now() });
    store.set('marcadores', list);
  }
  function removeBookmark(id, ch) {
    store.set('marcadores', getBookmarks().filter(function (m) { return !(m.book === id && m.chapter === ch); }));
  }

  function confirmRemoveBookmark(id, ch) {
    var name = Books.get(id).name + ' ' + ch;
    return dialog({
      title: '¿Desea borrar este marcador?',
      body: name,
      buttons: [
        { label: 'No, conservar', value: 'no' },
        { label: 'Sí, borrar', value: 'yes', cls: 'btn-danger' }
      ]
    }).then(function (v) {
      if (v === 'yes') { removeBookmark(id, ch); announce('Marcador borrado: ' + name); return true; }
      return false;
    });
  }

  /* ================================================================== */
  /* Dialog (confirmation / information). Never closes by itself.        */
  /* ================================================================== */

  var dlg = document.getElementById('dialog');

  function dialog(opts) {
    if (!dlg.showModal) {   // very old browsers
      if (opts.buttons.length === 1) { window.alert(opts.title + '\n' + opts.body); return Promise.resolve(opts.buttons[0].value); }
      return Promise.resolve(window.confirm(opts.title + '\n' + opts.body) ? opts.buttons[opts.buttons.length - 1].value : opts.buttons[0].value);
    }
    var opener = document.activeElement;
    document.getElementById('dialog-title').textContent = opts.title;
    document.getElementById('dialog-body').textContent = opts.body;
    var actions = document.getElementById('dialog-actions');
    actions.innerHTML = opts.buttons.map(function (b, i) {
      return '<button class="btn ' + (b.cls || '') + '" value="' + esc(b.value) + '"' + (i === 0 ? ' autofocus' : '') + '>' + esc(b.label) + '</button>';
    }).join('');
    dlg.returnValue = '';
    dlg.showModal();
    var first = actions.querySelector('button');
    if (first) first.focus();
    return new Promise(function (resolve) {
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        if (opener && document.contains(opener)) opener.focus();
        resolve(dlg.returnValue || opts.buttons[0].value);
      });
    });
  }

  function info(title, body) {
    return dialog({ title: title, body: body, buttons: [{ label: 'Entendido', value: 'ok', cls: 'btn-primary' }] });
  }

  /* ================================================================== */
  /* Read aloud (Web Speech API: speechSynthesis)                        */
  /* ================================================================== */

  var ttsSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  var tts = { state: 'idle', mode: null, items: [], index: 0, token: 0 };

  /** Prefer Latin American Spanish voices, then Spain, then any Spanish voice. */
  function pickVoice() {
    var voices = ttsSupported ? window.speechSynthesis.getVoices() : [];
    var norm = function (v) { return (v.lang || '').toLowerCase().replace('_', '-'); };
    var prefs = ['es-mx', 'es-us', 'es-419', 'es-es'];
    for (var i = 0; i < prefs.length; i++) {
      var matches = voices.filter(function (v) { return norm(v) === prefs[i]; });
      if (matches.length) {
        // offline: prefer voices installed on the device
        if (!navigator.onLine) { var local = matches.filter(function (v) { return v.localService; }); if (local.length) return local[0]; }
        return matches[0];
      }
    }
    for (var j = 0; j < voices.length; j++) if (norm(voices[j]).indexOf('es') === 0) return voices[j];
    return null;
  }

  /** 1909 spelling uses circumflexes in names (Châm); drop them so voices pronounce normally. */
  function speechText(s) {
    return s.normalize('NFD').replace(/̂/g, '').normalize('NFC');
  }

  function ttsStart(items, from, mode) {
    var synth = window.speechSynthesis;
    var my = ++tts.token;
    tts.items = items; tts.index = from; tts.mode = mode; tts.state = 'playing';
    var voice = pickVoice();
    var rate = (RATES[settings.rate] || RATES[2]).v;
    var queue = function () {
      if (my !== tts.token) return;
      try { synth.resume(); } catch (e) { /* ignore */ }
      for (var i = from; i < items.length; i++) {
        (function (i) {
          var u = new SpeechSynthesisUtterance(speechText(items[i].text));
          u.lang = voice ? voice.lang : 'es-MX';
          if (voice) u.voice = voice;
          u.rate = rate;
          u.onstart = function () { if (my !== tts.token) return; tts.index = i; markSpeaking(items[i].el); };
          u.onend = function () { if (my === tts.token && i === items.length - 1) ttsFinished(); };
          u.onerror = function (e) {
            if (my !== tts.token || e.error === 'interrupted' || e.error === 'canceled') return;
            ttsFinished();
          };
          synth.speak(u);
        })(i);
      }
    };
    // Chrome sometimes drops speak() called right after cancel(); give it a moment.
    if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(queue, 80); }
    else queue();
    updateListenButtons();
  }

  function ttsPause() {
    // speechSynthesis.pause() is unreliable on Android, so we stop and remember the verse.
    tts.token++;
    window.speechSynthesis.cancel();
    tts.state = 'paused';
    updateListenButtons();
  }

  function ttsFinished() {
    tts.state = 'idle'; tts.mode = null;
    markSpeaking(null);
    updateListenButtons();
  }

  function stopSpeaking() {
    tts.token++;
    if (ttsSupported) window.speechSynthesis.cancel();
    tts.state = 'idle'; tts.mode = null;
    markSpeaking(null);
  }

  var speakingEl = null;
  function markSpeaking(el) {
    if (speakingEl) speakingEl.classList.remove('is-speaking');
    speakingEl = el && el.classList && el.classList.contains('verse') ? el : null;
    if (speakingEl) {
      speakingEl.classList.add('is-speaking');
      var r = speakingEl.getBoundingClientRect();
      var barH = bar.offsetHeight;
      if (r.top < 0 || r.bottom > window.innerHeight - barH) speakingEl.scrollIntoView({ block: 'center' });
    }
  }

  function updateListenButtons() {
    main.querySelectorAll('[data-action="listen"]').forEach(function (btn) {
      var mode = btn.getAttribute('data-mode');
      var active = tts.mode === mode;
      var label, icon;
      if (active && tts.state === 'playing') { label = 'Pausar'; icon = ICON.pause; }
      else if (active && tts.state === 'paused') { label = 'Continuar'; icon = ICON.play; }
      else {
        icon = ICON.play;
        label = mode === 'chapter' ? 'Escuchar'
          : (currentReader && currentReader.v2 != null && currentReader.v2 > currentReader.v1 ? 'Escuchar los versículos' : 'Escuchar el versículo');
      }
      btn.innerHTML = icon + '<span>' + label + '</span>';
      btn.classList.toggle('is-on', active && tts.state !== 'idle');
    });
  }

  function onListen(mode) {
    if (!ttsSupported) {
      info('No se puede leer en voz alta', 'Su navegador no puede leer en voz alta. Pruebe con Chrome en Android o Safari en iPhone.');
      return;
    }
    if (tts.mode === mode && tts.state === 'playing') return ttsPause();
    if (tts.mode === mode && tts.state === 'paused') return ttsStart(tts.items, tts.index, mode);
    if (!currentReader) return;
    var r = currentReader;
    var items = [];
    var els = main.querySelectorAll(mode === 'verses' ? '.verse.is-found' : '.verse');
    if (mode === 'verses') {
      items.push({ text: Parser.spokenReference({ bookId: r.id, chapter: r.ch, verseStart: r.v1, verseEnd: r.v2 }) + '.', el: null });
    } else {
      items.push({ text: r.book.spoken + ', capítulo ' + r.ch + '.', el: null });
    }
    els.forEach(function (el) {
      var n = +el.getAttribute('data-v');
      items.push({ text: r.verses[n - 1], el: el });
    });
    ttsStart(items, 0, mode);
  }

  function testVoice() {
    if (!ttsSupported) { info('No se puede leer en voz alta', 'Su navegador no puede leer en voz alta.'); return; }
    stopSpeaking();
    ttsStart([{ text: previewSample(), el: null }], 0, 'test');
  }

  /* ================================================================== */
  /* Voice search (Web Speech API: SpeechRecognition)                    */
  /* ================================================================== */

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var voice = {
    supported: !!SR,
    langs: ['es-MX', 'es-US', 'es-ES'],
    langIndex: 0,
    rec: null,
    permission: 'prompt',      // from the Permissions API when available
    deniedThisSession: false,
    handled: true,
    alts: [], interim: '', gotSpeech: false,
    timers: {}
  };

  // Know the microphone permission in advance (where supported) so tapping
  // "Hablar" can start listening immediately, inside the tap (needed on iOS).
  if (navigator.permissions && navigator.permissions.query) {
    try {
      navigator.permissions.query({ name: 'microphone' }).then(function (st) {
        voice.permission = st.state;
        st.onchange = function () {
          voice.permission = st.state;
          if (st.state === 'granted') voice.deniedThisSession = false;
        };
      }).catch(function () { /* not supported (e.g. some Safari versions) */ });
    } catch (e) { /* ignore */ }
  }

  function onHablar() {
    stopSpeaking();
    if (!voice.supported) { buscarNotice = 'unsupported'; go('#/buscar'); return; }
    if (voice.permission === 'denied' || voice.deniedThisSession) { buscarNotice = 'denied'; go('#/buscar'); return; }
    if (!store.get('micExplicado', false)) { openVoice('intro'); return; }
    openVoice('listening');
    startListening();
  }

  function openVoice(state, data) {
    if (!voicePanel.open) {
      if (voicePanel.showModal) voicePanel.showModal();
      else voicePanel.setAttribute('open', '');
    }
    renderVoice(state, data || {});
  }

  function closeVoice(returnFocus) {
    abortListening();
    if (voicePanel.open) { if (voicePanel.close) voicePanel.close(); else voicePanel.removeAttribute('open'); }
    if (returnFocus !== false) hablarBtn.focus();
  }

  var micBig = '<div class="mic-big" aria-hidden="true">' + ICON.mic + '</div>';

  function renderVoice(state, data) {
    voicePanel.classList.toggle('is-listening', state === 'listening');
    var heard = data.heard ? '<p class="heard">Usted dijo: «' + esc(data.heard) + '»</p>' : '';
    var retry = '<button class="btn btn-primary" type="button" data-action="voice-retry">Intentar de nuevo</button>';
    var type = '<button class="btn" type="button" data-action="voice-type">Escribir la cita</button>';
    var close = '<button class="btn" type="button" data-action="voice-close">Cerrar</button>';
    var h = '';
    var focusSel = 'h2';

    switch (state) {
      case 'intro':
        h = micBig + '<h2 id="voice-title" tabindex="-1">Buscar con su voz</h2>' +
          '<p class="text-left">Diga el nombre de un libro, el capítulo y el versículo, y la aplicación lo lleva allí.</p>' +
          '<p class="text-left">Para eso necesita usar el micrófono. Su teléfono le va a pedir permiso: toque «Permitir».</p>' +
          '<p class="text-left">Para entender lo que usted dice, su navegador puede enviar su voz al servicio de Google o de Apple. Esta aplicación no guarda grabaciones.</p>' +
          '<button class="btn btn-primary" type="button" data-action="voice-start">' + ICON.mic + '<span>Usar el micrófono</span></button>' +
          '<button class="btn" type="button" data-action="voice-type">Escribir en su lugar</button>' +
          '<button class="btn" type="button" data-action="voice-close">Cancelar</button>';
        break;
      case 'listening':
        h = micBig + '<h2 id="voice-title">Escuchando…</h2>' +
          '<p>Diga, por ejemplo: <strong>Juan 3:16</strong></p>' +
          '<p class="heard" id="voice-heard" aria-live="polite"></p>' +
          '<button class="btn btn-primary" type="button" data-action="voice-cancel">Cancelar</button>';
        focusSel = '[data-action="voice-cancel"]';
        break;
      case 'notfound':
        var f = failureText(data.res, 'decir');
        h = '<h2 id="voice-title" tabindex="-1">' + esc(f.title) + '</h2>' +
          '<p>' + esc(f.body) + '</p>' + heard +
          (f.chapterOnly
            ? '<button class="btn btn-primary" type="button" data-action="voice-go" data-href="' + esc(readHash(data.res.bookId, data.res.chapter)) + '">Ir a ' + esc(data.res.bookName + ' ' + data.res.chapter) + '</button>' +
              '<button class="btn" type="button" data-action="voice-retry">Intentar de nuevo</button>'
            : '<p class="examples-inline">Por ejemplo: «Juan 3:16», «Salmo 23» o «Mateo 5 del 1 al 12».</p>' + retry + type) +
          close;
        break;
      case 'nospeech':
        h = micBig + '<h2 id="voice-title" tabindex="-1">No le escuché.</h2>' +
          '<p>Toque «Intentar de nuevo» y hable cerca del teléfono, despacio y claro.</p>' + retry + type + close;
        break;
      case 'network':
        h = '<h2 id="voice-title" tabindex="-1">No pude reconocer su voz.</h2>' +
          '<p>Puede que no haya conexión a internet. Puede escribir la cita en su lugar.</p>' +
          '<button class="btn btn-primary" type="button" data-action="voice-type">Escribir la cita</button>' +
          '<button class="btn" type="button" data-action="voice-retry">Intentar de nuevo</button>' + close;
        break;
      case 'nomic':
        h = '<h2 id="voice-title" tabindex="-1">No encontramos un micrófono.</h2>' +
          '<p>Revise que ninguna otra aplicación esté usando el micrófono. También puede escribir la cita.</p>' +
          '<button class="btn btn-primary" type="button" data-action="voice-type">Escribir la cita</button>' +
          '<button class="btn" type="button" data-action="voice-retry">Intentar de nuevo</button>' + close;
        break;
      default: // generic problem — never show technical details
        h = '<h2 id="voice-title" tabindex="-1">No se pudo usar el micrófono.</h2>' +
          '<p>Puede intentar de nuevo o escribir la cita.</p>' + retry + type + close;
    }
    voiceInner.innerHTML = h;
    var f2 = voiceInner.querySelector(focusSel);
    if (f2) { try { f2.focus({ preventScroll: true }); } catch (e) { f2.focus(); } }
    voicePanel.scrollTop = 0;
  }

  function clearVoiceTimers() {
    Object.keys(voice.timers).forEach(function (k) { clearTimeout(voice.timers[k]); });
    voice.timers = {};
  }

  function startListening() {
    clearVoiceTimers();
    var rec;
    try { rec = new SR(); } catch (e) { renderVoice('error', {}); return; }
    rec.lang = voice.langs[voice.langIndex];
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    voice.rec = rec;
    voice.handled = false;
    voice.alts = []; voice.interim = ''; voice.gotSpeech = false;

    // Every handler checks it still belongs to the current session: an aborted
    // recogniser fires 'end' later, which must not end a newer session.
    rec.onresult = function (e) {
      if (rec !== voice.rec || voice.handled) return;
      voice.gotSpeech = true;
      var interim = '', finals = [];
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) { for (var a = 0; a < r.length; a++) finals.push(r[a].transcript); }
        else interim += r[0].transcript;
      }
      if (finals.length) voice.alts = finals;
      voice.interim = interim || finals[0] || voice.interim;
      var heardEl = document.getElementById('voice-heard');
      if (heardEl) heardEl.textContent = 'Oí: «' + voice.interim.trim() + '»';
      // Stop after a short silence (iOS sometimes never sends a final result).
      clearTimeout(voice.timers.silence);
      voice.timers.silence = setTimeout(finishListening, 2000);
      if (finals.length) finishListening();
    };

    rec.onerror = function (e) {
      if (rec !== voice.rec || voice.handled) return;
      var err = e.error;
      if (err === 'aborted') return;
      if (err === 'language-not-supported' && voice.langIndex < voice.langs.length - 1) {
        voice.handled = true; voice.langIndex++;
        setTimeout(startListening, 50);
        return;
      }
      voice.handled = true;
      clearVoiceTimers();
      if (err === 'no-speech') renderVoice('nospeech', {});
      else if (err === 'not-allowed' || err === 'service-not-allowed') {
        voice.deniedThisSession = true;
        closeVoice(false);
        buscarNotice = 'denied';
        go('#/buscar');
      }
      else if (err === 'network') renderVoice('network', {});
      else if (err === 'audio-capture') renderVoice('nomic', {});
      else renderVoice('error', {});
    };

    rec.onend = function () { if (rec === voice.rec && !voice.handled) finishListening(); };

    // Give up politely if nothing is heard; hard stop after 15 s.
    voice.timers.nospeech = setTimeout(function () {
      if (!voice.gotSpeech && !voice.handled) { abortListening(); renderVoice('nospeech', {}); }
    }, 8000);
    voice.timers.max = setTimeout(finishListening, 15000);

    try { rec.start(); }
    catch (err) { voice.handled = true; renderVoice('error', {}); }
  }

  function finishListening() {
    if (voice.handled) return;
    voice.handled = true;
    clearVoiceTimers();
    try { voice.rec && voice.rec.stop(); } catch (e) { /* ignore */ }
    var alts = voice.alts.length ? voice.alts : (voice.interim ? [voice.interim] : []);
    if (!alts.length || !alts[0].trim()) { renderVoice('nospeech', {}); return; }
    var res = Parser.parseBest(alts, { verseCounts: meta.verseCounts });
    var heard = res.heard || alts[0];
    if (res.ok) {
      // Go straight to the passage: no confirmation step. The reading screen
      // highlights the verse and moves focus to it (screen readers read it).
      closeVoice(false);
      go(refHash(res));
    }
    else renderVoice('notfound', { res: res, heard: heard });
  }

  function abortListening() {
    voice.handled = true;
    clearVoiceTimers();
    var old = voice.rec;
    voice.rec = null;
    if (old) { try { old.abort(); } catch (e) { /* ignore */ } }
  }

  // Esc key / Android back gesture closes the native dialog: make sure the mic stops.
  voicePanel.addEventListener('close', function () { abortListening(); voicePanel.classList.remove('is-listening'); });

  /* ================================================================== */
  /* Events                                                              */
  /* ================================================================== */

  hablarBtn.addEventListener('click', onHablar);

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    switch (action) {
      case 'continue':
        pendingResume = true;   // let the link navigate normally
        break;
      case 'retry':
        router();
        break;
      case 'listen':
        onListen(el.getAttribute('data-mode'));
        break;
      case 'bookmark':
        if (!currentReader) break;
        var id = currentReader.id, ch = currentReader.ch;
        var name = currentReader.book.name + ' ' + ch;
        if (isBookmarked(id, ch)) {
          confirmRemoveBookmark(id, ch).then(function (removed) {
            if (removed) refreshBookmarkButton();
          });
        } else {
          addBookmark(id, ch);
          refreshBookmarkButton();
          announce('Marcador guardado: ' + name + '. Puede verlo en «Marcadores».');
        }
        break;
      case 'bookmark-delete':
        confirmRemoveBookmark(el.getAttribute('data-book'), +el.getAttribute('data-ch')).then(function (removed) {
          if (removed) { renderMarcadores(); focusHeading(); }
        });
        break;
      case 'size-down':
      case 'size-up':
        var dir = action === 'size-up' ? 1 : -1;
        var ns = settings.size + dir * SIZE_STEP;
        if (ns < SIZE_MIN || ns > SIZE_MAX) {
          announce(dir > 0 ? 'Ya está en el tamaño más grande.' : 'Ya está en el tamaño más pequeño.');
          break;
        }
        settings.size = ns; saveSettings();
        document.getElementById('size-out').lastChild.textContent = sizeText();
        main.querySelector('[data-action="size-down"]').setAttribute('aria-disabled', String(ns <= SIZE_MIN));
        main.querySelector('[data-action="size-up"]').setAttribute('aria-disabled', String(ns >= SIZE_MAX));
        break;
      case 'rate-down':
      case 'rate-up':
        var d = action === 'rate-up' ? 1 : -1;
        var nr = settings.rate + d;
        if (nr < 0 || nr >= RATES.length) {
          announce(d > 0 ? 'Ya está en la velocidad más rápida.' : 'Ya está en la velocidad más lenta.');
          break;
        }
        settings.rate = nr; saveSettings();
        document.getElementById('rate-out').lastChild.textContent = RATES[nr].label;
        main.querySelector('[data-action="rate-down"]').setAttribute('aria-disabled', String(nr <= 0));
        main.querySelector('[data-action="rate-up"]').setAttribute('aria-disabled', String(nr >= RATES.length - 1));
        break;
      case 'test-voice':
        testVoice();
        break;
      case 'install':
        if (deferredInstall) {
          deferredInstall.prompt();
          deferredInstall.userChoice.finally(function () { deferredInstall = null; if (currentRoute === '#/ajustes') renderAjustes(); });
        }
        break;
      case 'search-retry':
        var q = document.getElementById('q');
        document.getElementById('search-result').innerHTML = '';
        if (q) { q.value = ''; q.focus(); }
        break;
      case 'voice-force':
        voice.deniedThisSession = false;
        store.set('micExplicado', true);
        openVoice('listening');
        startListening();
        break;
      case 'voice-start':
        store.set('micExplicado', true);
        renderVoice('listening', {});
        startListening();
        break;
      case 'voice-retry':
        abortListening();
        renderVoice('listening', {});
        startListening();
        break;
      case 'voice-cancel':
      case 'voice-close':
        closeVoice(true);
        break;
      case 'voice-type':
        closeVoice(false);
        go('#/buscar');
        setTimeout(function () { var q2 = document.getElementById('q'); if (q2) q2.focus(); }, 50);
        break;
      case 'voice-go':
        closeVoice(false);
        go(el.getAttribute('data-href'));
        break;
    }
  });

  function refreshBookmarkButton() {
    var old = document.getElementById('btn-bookmark');
    if (!old || !currentReader) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = bookmarkButtonHtml(isBookmarked(currentReader.id, currentReader.ch));
    var btn = wrap.firstChild;
    old.replaceWith(btn);
    btn.focus();
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'theme' || t.name === 'font') {
      settings[t.name] = t.value;
      saveSettings();
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'search-form') onSearchSubmit(e);
  });

  // Hide the bottom bar while typing so it doesn't sit on top of the keyboard.
  // It comes back only once focus has really left the search form; bringing it
  // back during a tap on "Buscar" would put the bar under the finger mid-tap.
  var typingTimer = null;
  document.addEventListener('focusin', function (e) {
    if (e.target.closest('.search-form')) {
      clearTimeout(typingTimer);
      document.body.classList.add('is-typing');
    }
  });
  document.addEventListener('focusout', function (e) {
    if (!e.target.closest('.search-form')) return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () {
      var a = document.activeElement;
      if (!a || !a.closest || !a.closest('.search-form')) document.body.classList.remove('is-typing');
    }, 400);
  });

  // Remember where the reader was in the chapter (as a fraction, so it survives size changes).
  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (!currentReader || currentRoute.indexOf('#/leer/') !== 0) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var last = store.get('ultimo', null);
      if (last && last.book === currentReader.id && last.chapter === currentReader.ch) {
        last.scroll = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        store.set('ultimo', last);
      }
    }, 400);
  }, { passive: true });

  // Keep body padding equal to the bottom bar's real height (it grows with system text size).
  function syncBarHeight() {
    document.documentElement.style.setProperty('--bar-height', bar.offsetHeight + 'px');
  }
  if ('ResizeObserver' in window) new ResizeObserver(syncBarHeight).observe(bar);
  window.addEventListener('resize', syncBarHeight);

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    if (currentRoute === '#/ajustes') renderAjustes();
  });

  if (ttsSupported && window.speechSynthesis.addEventListener) {
    // Voices load asynchronously in Chrome; asking once warms the list up.
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', function () { window.speechSynthesis.getVoices(); });
  }

  /* ================================================================== */
  /* Router                                                              */
  /* ================================================================== */

  var ROUTES = [
    [/^#\/libros$/, function () { renderLibros(); }],
    [/^#\/libros\/(at|nt)$/, function (m) { renderTestament(m[1]); }],
    [/^#\/libro\/([a-z0-9-]+)$/, function (m) { renderChapters(m[1]); }],
    [/^#\/leer\/([a-z0-9-]+)\/(\d+)(?:\/(\d+)(?:-(\d+))?)?$/, function (m) {
      renderReader(m[1], +m[2], m[3] ? +m[3] : null, m[4] ? +m[4] : null);
    }],
    [/^#\/marcadores$/, function () { renderMarcadores(); }],
    [/^#\/ajustes$/, function () { renderAjustes(); }],
    [/^#\/acerca$/, function () { renderAcerca(); }],
    [/^#\/buscar$/, function () { renderBuscar(); }]
  ];

  function router() {
    stopSpeaking();
    if (voicePanel.open) closeVoice(false);
    var hash = location.hash;
    currentRoute = hash;
    if (hash.indexOf('#/leer/') !== 0) currentReader = null;
    for (var i = 0; i < ROUTES.length; i++) {
      var m = hash.match(ROUTES[i][0]);
      if (m) {
        var isReader = hash.indexOf('#/leer/') === 0;
        if (!isReader) window.scrollTo(0, 0);
        else if (!pendingResume) window.scrollTo(0, 0);
        ROUTES[i][1](m);
        if (!isReader) focusHeading();
        return;
      }
    }
    location.replace('#/libros');
  }

  window.addEventListener('hashchange', router);

  /* ================================================================== */
  /* Start                                                               */
  /* ================================================================== */

  function start() {
    applySettings();
    syncBarHeight();
    loadMeta().then(function () {
      var h = location.hash;
      if (h === '#/buscar') {
        // Never open the app on the voice/typed search screen (e.g. a restored
        // tab or a home-screen icon saved there): start on Libros instead.
        history.replaceState(null, '', '#/libros');
      } else if (!h || h === '#' || h === '#/') {
        // "Resume where I left off": open the last chapter read.
        var last = store.get('ultimo', null);
        if (last && Books.get(last.book)) {
          pendingResume = true;
          history.replaceState(null, '', readHash(last.book, last.chapter));
        } else {
          history.replaceState(null, '', '#/libros');
        }
      }
      router();
    }).catch(function () {
      main.innerHTML = '<h1>Biblia</h1><p>No se pudo cargar la Biblia.</p>' +
        '<p>Revise su conexión a internet e intente de nuevo.</p>' +
        '<button class="btn btn-primary" type="button" onclick="location.reload()">Intentar de nuevo</button>';
    });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline mode unavailable */ });
      });
    }
  }

  start();
})();
