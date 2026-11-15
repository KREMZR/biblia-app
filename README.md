# Biblia Reina-Valera 1909 · letra grande

Aplicación web para leer y escuchar la Biblia, pensada para personas mayores y personas con baja visión. Funciona en teléfonos y tabletas, se puede instalar como aplicación y funciona sin internet.

---

## Para usuarios

### ¿Qué hace?

- **Libros**: elija Antiguo o Nuevo Testamento, luego el libro y el capítulo.
- **Leer**: un capítulo por página, con letra grande. Abajo están los botones **Anterior** y **Siguiente**.
- **Continuar leyendo**: cuando vuelve a abrir la aplicación, aparece el último capítulo que leyó, en el mismo lugar.
- **Escuchar**: toque **Escuchar** y la aplicación lee el capítulo en voz alta. Toque **Pausar** para detenerla y **Continuar** para seguir.
- **Hablar**: toque **Hablar** y diga una cita, por ejemplo «Juan 3:16». La aplicación lo lleva allí directamente y marca el versículo en amarillo.
- **Marcadores**: toque **Guardar** para guardar un capítulo. Los encuentra en **Marcadores**.
- **Ajustes**: cambie el tamaño de la letra (**A−** y **A+**), los colores (**Claro**, **Modo oscuro**, **Alto contraste**), el tipo de letra y la velocidad de la voz. Los cambios se ven al momento y se guardan.

### Cómo instalarla en su teléfono

- **Android (Chrome)**: abra la dirección de la aplicación, toque el menú de tres puntos y luego **Instalar aplicación** o **Agregar a la pantalla principal**.
- **iPhone (Safari)**: abra la dirección de la aplicación, toque el botón **Compartir** y luego **Agregar a inicio**.

La primera vez, deje la aplicación abierta un minuto con internet. Así se guarda la Biblia completa en su teléfono. Después puede leer sin internet. En **Ajustes → Acerca de** puede ver si ya está lista.

### Cómo buscar con su voz

Toque **Hablar** y diga el libro, el capítulo y el versículo. Por ejemplo:

- «Juan tres dieciséis»
- «Salmo veintitrés»
- «Mateo cinco, del uno al doce»
- «Romanos ocho, versículos veintiocho a treinta»
- «Primera de Corintios trece»

La primera vez, la aplicación le explica por qué necesita el micrófono, y su teléfono le pide permiso. Toque **Permitir**.

**Si «Hablar» no funciona**, la aplicación le muestra un cuadro para escribir la cita. Esto pasa si:

- su navegador no permite reconocer la voz (por ejemplo, Firefox), o
- no dio permiso para usar el micrófono, o
- no hay internet (la mayoría de los teléfonos necesitan internet para reconocer la voz).

Para volver a permitir el micrófono, búsquelo en los ajustes de su navegador, en los permisos de este sitio.

### Privacidad

No necesita cuenta. No hay anuncios. Sus marcadores y ajustes se guardan solo en su teléfono. Cuando usa **Hablar**, su navegador puede enviar su voz al servicio de reconocimiento de Google o de Apple para convertirla en texto. La aplicación no guarda grabaciones.

### El texto

Se usa la **Reina-Valera 1909**, que es de dominio público. Se conserva la ortografía original de 1909: por ejemplo, «á» lleva tilde («vino á Jesús») y algunos nombres llevan acento circunflejo («Châm»). No se usa la Reina-Valera 1960, que todavía tiene derechos de autor.

---

## For developers

Plain HTML, CSS and JavaScript. No build step, no frameworks, no runtime dependencies.

### Project layout

```
index.html              App shell (lang="es"), bottom bar, dialogs
manifest.webmanifest    PWA manifest
sw.js                   Service worker: precaches the app and the whole Bible
css/styles.css          Themes (Claro / Modo oscuro / Alto contraste), large-text layout
js/config.js            Which translation to load + app version (shared with sw.js)
js/books.js             66 books: Spanish names, spoken names, aliases for voice search
js/parser.js            Spanish spoken/typed reference parser (UMD: browser + Node)
js/app.js               Routing, screens, read-aloud, voice search, bookmarks, settings
data/rv1909/            meta.json (verse counts, source) + one JSON file per book
fonts/                  Atkinson Hyperlegible + Literata (woff2, OFL licenses included)
icons/                  App icons (PNG + SVG, maskable)
tools/build-data.js     Converts a whole-Bible JSON into data/<translation>/
tests/parser.test.js    Unit tests for the parser (node:test)
tests/browser/qa.py     Browser QA (Playwright + axe-core)
```

### Run it

It must be served over HTTP. Opening `index.html` from disk won't work, because `fetch` and service workers are blocked on `file://`.

```bash
cd biblia-app
python3 -m http.server 8765
# open http://localhost:8765
```

Any static host works (GitHub Pages, Netlify, Cloudflare Pages, a plain web server). All paths are relative, so it also works from a subfolder.

**On a phone, use HTTPS.** Service workers (offline/install) and the microphone only work on `https://` or `localhost`. To test on your own phone, deploy to a static host or use an HTTPS tunnel. A `http://192.168.x.x` address won't give you offline mode or voice search.

### Tests

```bash
npm test                 # or: node --test tests/parser.test.js
```

14 test groups cover every example in the spec plus edge cases. Examples: number words ("tres dieciséis", "treinta y uno", "ciento diecinueve", old-style "diez y seis"), "capítulo/versículo" keywords, "3:16" / "3,16" / "3.16", ranges ("del uno al doce", "28 a 30", "16-18"), numbered books ("Primera de Corintios", "1 Corintios", "1ra", "II Reyes"), Juan vs 1/2/3 Juan, singular/plural and missing accents, fuzzy matches ("Jenesis", "Apocalisis", "Ebreos"), single-chapter books ("Judas 3" = verse 3), the recognizer glitch "Juan 316" → 3:16, and friendly failures ("Juan 22" → "Juan tiene 21 capítulos").

Browser QA (needs Python + Playwright with Chromium; serve the app on port 8765 first):

```bash
pip install playwright && python -m playwright install chromium
python3 tests/browser/qa.py
```

It runs 65 end-to-end checks with mocked speech APIs, an axe-core scan of 36 screen/theme combinations (WCAG 2.2 AA + the AAA contrast rule), and checks 84 screen/size combinations for cut-off text, sideways scrolling, and tap targets under 60×60 px.

### Swapping the translation

Use only texts you have the right to distribute (public domain or properly licensed).

1. Get the whole Bible as JSON in one of these formats (66 books, Protestant canon order):
   - scrollmapper/bible_databases format: `{ "books": [ { "chapters": [ { "verses": [ { "verse": 1, "text": "…" } ] } ] } ] }`
   - or plain nested arrays: `[ [ [ "verse 1", "verse 2" ], …chapters ], …books ]`
2. Convert it:
   ```bash
   node tools/build-data.js source.json mytranslation "Full name" "SHORT" "Source / credit"
   ```
   This writes `data/mytranslation/<book>.json` and `data/mytranslation/meta.json`. The parser uses the verse counts in `meta.json`, so versification differences are handled.
3. In `js/config.js`, set `translation: 'mytranslation'` and bump `version` (for example `'1.1.0'`). The new version makes installed copies download the new text and delete the old cache.
4. Update the credit text in the "Acerca de" screen (`renderAcerca` in `js/app.js`) if needed. The source line is read from `meta.json` automatically.
5. Optionally delete the old `data/rv1909/` folder.

`build-data.js` also normalizes the 1909 "drop cap" convention ("EN el principio" → "En el principio", "Y ACONTECIÓ" → "Y aconteció"), because screen readers may spell all-caps words letter by letter. Pass `--keep-caps` to turn this off.

### Accessibility notes

- **Text size**: 18–40 px (default 24) in `rem`, so it also grows with the phone's or browser's own text size. On iOS, `font: -apple-system-body` follows Dynamic Type. Pinch-zoom is never disabled.
- **Reading text**: line height 1.7, max 60ch per line, left-aligned, no hyphenation, verse numbers smaller and muted but still ≥ 7:1 contrast.
- **Tap targets**: everything is at least 60×60 px. Labels wrap instead of being cut off. The bottom bar switches to 2×2 on narrow screens, and drops its icons (keeping the words) on short screens.
- **Contrast** (computed from the theme variables; text targets AAA 7:1, non-text 3:1):

  | Pair | Claro | Modo oscuro | Alto contraste |
  |---|---|---|---|
  | Text / background | 16.3:1 | 16.2:1 | 19.6:1 |
  | Text / button | 17.4:1 | 14.4:1 | 19.6:1 |
  | Verse number (muted) / background | 8.4:1 | 9.9:1 | 19.6:1 |
  | Primary button | 10.3:1 | 11.1:1 | 19.6:1 |
  | Highlighted verse | 15.0:1 | 11.4:1 | 19.6:1 |
  | Button border (non-text) | 10.9:1 | 10.8:1 | 19.6:1 |
  | Focus indicator | 9.6:1 | 13.3:1 | 21.0:1 |
  | Delete button | 8.0:1 | 10.4:1 | 19.6:1 |

  The voice panel is always yellow/white on black (19.6:1 / 21:1).
- **Screen readers**: semantic landmarks, one `h1` per screen with focus moved to it on navigation, Spanish `aria-label`s that contain the visible text, a polite live region for confirmations, and focus moved to the found verse after a search. Numbered books are spoken as "Primera de Corintios" in read-aloud.
- **No surprises**: popups never close by themselves. Deleting a bookmark always asks "¿Desea borrar este marcador?". No gestures are required. There are no animations except the pulsing microphone while listening, which the spec asked for. That one stops when the system's "reduce motion" setting is on.
- **Read-aloud**: one utterance per verse, so pause/resume works reliably (Android's `speechSynthesis.pause()` is unreliable, so "Pausar" stops and remembers the verse). The verse being read is highlighted. Voice preference: es-MX → es-US → es-419 → es-ES → any Spanish voice. Circumflexes (Châm) are removed from the spoken text only.
- **Voice search**: `SpeechRecognition` / `webkitSpeechRecognition`, language es-MX with fallback to es-US / es-ES, 5 alternatives tried in order, auto-stop after 2 s of silence (8 s if nothing is heard, 15 s maximum). `start()` runs inside the tap, which iOS requires.

### Device test checklist (do this before release)

Automated tests ran in Chromium with mocked speech APIs. Real speech recognition and real voices need a real device. Please check:

**iPhone, Safari (iOS 17+), served over HTTPS**
- [ ] Hablar → explanation → "Usar el micrófono" → iOS permission prompt → say "Juan tres dieciséis" → opens Juan 3:16 directly (no confirmation) → verse highlighted.
- [ ] Say "Primera de Corintios trece" and "Mateo cinco del uno al doce".
- [ ] Deny the microphone → the text box appears with an explanation.
- [ ] Turn off Siri & Dictation → Hablar shows the text box instead of an error.
- [ ] Installed to the home screen: if `webkitSpeechRecognition` isn't available in standalone mode, Hablar must open the text box.
- [ ] Escuchar uses a Spanish voice. Pausar/Continuar works. Speed setting changes the voice.
- [ ] VoiceOver: navigate Libros → book → chapter, Escuchar, Guardar, delete a bookmark.
- [ ] Settings → Accessibility → Larger Text: text grows and nothing is cut off.

**Android, Chrome, served over HTTPS**
- [ ] Same voice search checks as above (Chrome may play a beep when listening starts).
- [ ] Airplane mode: reading works. Hablar shows the "no pude reconocer su voz" message with "Escribir la cita".
- [ ] Install from the menu. The app opens to the last chapter read.
- [ ] TalkBack pass. System font size at maximum.

**Firefox (desktop or Android)**
- [ ] Hablar opens the text box ("Su navegador no permite buscar con la voz…"). Typed search works.

### Known limitations

- Most phones need internet for speech recognition. Reading, read-aloud (with an installed voice), bookmarks and typed search all work offline.
- Voice quality and availability depend on the device. Some Android phones need a Spanish voice installed in Settings → Text-to-speech.
- 18 verses are empty in the source (for example, Numbers 12:16 and Job 38:39–41), because the digital edition maps Spanish verse divisions onto a different numbering. They are skipped when shown.

### Credits and licenses

- Text: Reina-Valera 1909, public domain. Digital text: CrossWire Bible Society "SpaRV" module, via [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).
- Fonts: Atkinson Hyperlegible (Braille Institute) and Literata. SIL Open Font License 1.1, license files in `fonts/`.
- axe-core (only used by the test script): Mozilla Public License 2.0.
- App code: MIT.
