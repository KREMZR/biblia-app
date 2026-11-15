# CLAUDE.md — context for Claude Code

Bible reading web app in Spanish for seniors and people with low vision.
Owner: kremzr. Live: https://kremzr.github.io/biblia-app/ (GitHub Pages, branch `main`, root).

## Hard requirements (from the original brief)
- All user-facing text in simple, neutral Latin American Spanish, "usted" form. `<html lang="es">`. Code comments in English.
- Single-page app, plain HTML/CSS/JS, **no build step**, no frameworks, no runtime dependencies. Installable PWA, works offline.
- Text: **Reina-Valera 1909** (public domain), bundled as local JSON. **Never use Reina-Valera 1960** (copyrighted).
- Accessibility is top priority: body text 24px default, adjustable 18–40px (A− / A+); line height ≥1.6; ~60ch lines; left-aligned, never justified; WCAG 2.2 AA, AAA contrast where possible; tap targets ≥60×60px; labels must never truncate (Spanish is long); semantic HTML + Spanish ARIA; works with VoiceOver/TalkBack and system font scaling.
- No icon-only buttons, no gesture-only actions, no auto-dismissing popups, no animations (only exception: pulsing mic while listening, disabled under prefers-reduced-motion).
- Few controls per screen. Persistent bottom bar: Libros · Hablar · Marcadores · Ajustes. Confirm destructive actions ("¿Desea borrar este marcador?"). No accounts, ads or sign-in.
- Themes: Claro (near-black on off-white), Modo oscuro, Alto contraste (yellow on black). Fonts: Atkinson Hyperlegible (default), Literata (optional serif).

## Features (all implemented)
Book → chapter picker (Antiguo/Nuevo Testamento) · reading screen with muted verse numbers and Anterior/Siguiente · opens to last chapter read + "Continuar leyendo" (never opens on the search screen `#/buscar`; that goes to Libros) · Escuchar (speechSynthesis, prefers es-MX → es-US → es-419 → es-ES, speed setting) · Marcadores · Ajustes with live preview · voice search "Hablar" (SpeechRecognition / webkitSpeechRecognition, es-MX → es-US → es-ES) with first-use mic explanation, a recognised reference opens the passage directly (no "Ir" confirmation; typed search still shows "Buscando: …" + Ir), verse highlight + scroll, friendly errors, typed fallback when unsupported/denied/offline, "Escuchar el versículo" after jumping.

## Code map
- `index.html` shell, bottom bar, `<dialog>`s · `css/styles.css` themes + layout · `sw.js` precaches app + all 66 books
- `js/config.js` translation id + `version` (shared with sw.js) · `js/books.js` 66 books, Spanish/spoken names, aliases · `js/parser.js` spoken/typed reference parser (UMD) · `js/app.js` hash router, screens, TTS, voice search, bookmarks, settings
- `data/rv1909/` one JSON per book + `meta.json` (verse counts, source) · `tools/build-data.js` converts a whole-Bible JSON (scrollmapper format or nested arrays) into `data/<id>/`
- Source text: CrossWire "SpaRV" module via scrollmapper/bible_databases (`formats/json/SpaRV.json`). build-data normalizes the 1909 drop-cap ("EN el principio" → "En el principio"); authentic 1909 spelling is kept ("á Jesús", "Châm"). 18 source verses are empty (versification) and are skipped when rendering.

## Decisions worth keeping
- No hyphenation in reading text or buttons (whole words are easier to read); headings may hyphenate.
- Read-aloud queues one utterance per verse; "Pausar" cancels and remembers the verse (Android's pause() is unreliable). Circumflexes stripped only from spoken text.
- Recognition `start()` is called synchronously inside the tap (iOS requirement); mic permission is pre-queried via the Permissions API where available.
- Every recognizer handler checks `rec === voice.rec` (an aborted recognizer's late `end` event used to kill the next session).
- The bottom bar stays hidden while focus is inside the search form, and reappears after a delay (it used to pop up mid-tap and steal the tap on "Buscar").
- Content sizes use `calc(var(--text-scale) * 1rem)` so they also follow system font size; iOS uses `font: -apple-system-body`.

## Commands
- Run locally: `python3 -m http.server 8765` (must be HTTP, not file://)
- Unit tests: `npm test` (= `node --test tests/parser.test.js`), 14 groups, all passing
- Browser QA: `python3 tests/browser/qa.py` (Playwright + Chromium + axe-core; mocked speech APIs). Last run: 65/65 flows, 84 layouts with no overflow/truncation/small targets, 36 axe scans with 0 violations incl. AAA contrast.

## Releasing
Commit to `main` and push → Pages updates in 1–2 minutes. **Always bump `version` in `js/config.js`** so installed copies refresh their offline cache.

## Open items
- [ ] Real-device test on iPhone Safari and Android Chrome (checklist in README.md). Never done; only Chromium with mocks so far.
