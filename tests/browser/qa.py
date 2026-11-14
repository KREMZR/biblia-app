"""
Browser QA for the Biblia app (Chromium via Playwright):
  - axe-core accessibility scan (WCAG 2.2 AA + AAA contrast) in all three themes
  - truncated text / horizontal scrolling / tap targets under 60x60 px
  - layouts at 375 px, 320 px, 200 % zoom (desktop and phone), tablet, 40 px text
  - end-to-end flows with mocked SpeechRecognition (exposed as webkitSpeechRecognition,
    like iPhone Safari) and speechSynthesis; typed fallback; offline mode

Usage:
  pip install playwright && python -m playwright install chromium
  python -m http.server 8765        # from the app folder, in another terminal
  python tests/browser/qa.py        # screenshots go to tests/browser/shots/

The mocks can't replace testing on real phones: see "Device test checklist" in README.md.
"""
import json, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8765/')
OUT = os.path.join(HERE, 'shots') + os.sep
AXE = open(os.path.join(HERE, 'axe.min.js')).read()
os.makedirs(OUT, exist_ok=True)

MOCKS = r"""
(() => {
  // ---- Fake SpeechRecognition, exposed only as webkitSpeechRecognition (like iOS Safari) ----
  window.__sr = { instances: [] };
  class FakeSR {
    constructor() { this.lang=''; this.continuous=false; this.interimResults=false; this.maxAlternatives=1; window.__sr.instances.push(this); }
    start() { this.started = true; window.__sr.last = this; if (window.__srAutoError) { const e = window.__srAutoError; setTimeout(() => { this.onerror && this.onerror({error: e}); this.onend && this.onend(); }, 20); } }
    stop() { this.stopped = true; setTimeout(() => this.onend && this.onend(), 10); }
    abort() { this.aborted = true; setTimeout(() => { this.onerror && this.onerror({error:'aborted'}); this.onend && this.onend(); }, 10); }
  }
  if (!window.__noSR) { try { delete window.SpeechRecognition; } catch(e){} window.SpeechRecognition = undefined; window.webkitSpeechRecognition = FakeSR; }
  else { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; }
  window.__emit = (alts, isFinal) => {
    const r = window.__sr.last; const res = alts.map(t => ({transcript: t, confidence: .9}));
    res.isFinal = isFinal !== false; r.onresult({resultIndex: 0, results: [res]});
  };
  // ---- Fake speechSynthesis ----
  const spoken = []; window.__spoken = spoken;
  const synth = {
    speaking: false, pending: false, paused: false, queue: [], current: null,
    getVoices() { return [{lang:'en-US',name:'Alex',localService:true},{lang:'es-ES',name:'Monica',localService:true},{lang:'es-MX',name:'Paulina',localService:true}]; },
    speak(u) { spoken.push({text:u.text, lang:u.lang, voice:u.voice && u.voice.name, rate:u.rate}); this.queue.push(u); if (!this.current) this._next(); },
    _next() { const u = this.queue.shift(); this.current = u || null; this.speaking = !!u; if (u) setTimeout(() => u.onstart && u.onstart({}), 5); },
    _end() { const u = this.current; if (u && u.onend) u.onend({}); this._next(); },
    cancel() { const all = [this.current, ...this.queue].filter(Boolean); this.queue = []; this.current = null; this.speaking = false; all.forEach(u => u.onerror && u.onerror({error:'interrupted'})); },
    pause() {}, resume() {}, addEventListener() {}
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
})();
"""

CHECK_LAYOUT = r"""
() => {
  const issues = [];
  const de = document.documentElement;
  const vw = de.clientWidth;
  if (de.scrollWidth > vw + 1) issues.push(`horizontal scroll ${de.scrollWidth} > ${vw}`);
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.classList.contains('visually-hidden') && !el.closest('.visually-hidden'); };
  const scope = document.querySelector('dialog[open]') || document;
  scope.querySelectorAll('.btn, .bar-btn, .choice, h1, h2, output, label, .result-title').forEach(el => {
    if (!visible(el)) return;
    if (el.scrollWidth > el.clientWidth + 1) issues.push(`content wider than box: "${el.textContent.trim().slice(0,40)}" ${el.scrollWidth}>${el.clientWidth}`);
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) issues.push(`outside viewport: "${el.textContent.trim().slice(0,40)}"`);
    if (getComputedStyle(el).textOverflow === 'ellipsis') issues.push(`ellipsis: ${el.textContent.trim().slice(0,30)}`);
  });
  // tap targets
  const small = [];
  scope.querySelectorAll('button, a[href], input:not([type=radio]), .choice').forEach(el => {
    if (!visible(el) || el.classList.contains('skip-link')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 59.5 || r.height < 59.5) small.push(`${el.tagName} "${(el.textContent||el.placeholder||'').trim().slice(0,25)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  if (small.length) issues.push('small targets: ' + small.join('; '));
  return issues;
}
"""

def axe(pg, label, results):
    pg.add_script_tag(content=AXE)
    res = pg.evaluate("""async () => {
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] },
        rules: { 'color-contrast-enhanced': { enabled: true }, 'region': { enabled: false } } });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length,
        sample: v.nodes.slice(0,3).map(n => (n.target.join(' ') + ' :: ' + (n.any[0] && n.any[0].message || n.failureSummary || '')).slice(0,220)) }));
    }""")
    results.append((label, res))

def check(pg, label, layout_results):
    issues = pg.evaluate(CHECK_LAYOUT)
    layout_results.append((label, issues))

SCREENS = [
  ('libros', '#/libros'), ('at', '#/libros/at'), ('nt', '#/libros/nt'), ('salmos', '#/libro/salmos'),
  ('juan3', '#/leer/juan/3'), ('found', '#/leer/juan/3/16-18'), ('marcadores', '#/marcadores'),
  ('ajustes', '#/ajustes'), ('acerca', '#/acerca'), ('buscar', '#/buscar'),
]

def run():
    axe_results, layout_results, flow = [], [], []
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---------- Layout matrix ----------
        configs = [
          ('375', dict(viewport={'width':375,'height':812}, device_scale_factor=2, is_mobile=True, has_touch=True), 24),
          ('375-40px', dict(viewport={'width':375,'height':812}, device_scale_factor=2, is_mobile=True, has_touch=True), 40),
          ('320', dict(viewport={'width':320,'height':568}, device_scale_factor=2, is_mobile=True, has_touch=True), 24),
          ('zoom200-desktop', dict(viewport={'width':640,'height':400}, device_scale_factor=2), 24),
          ('zoom200-phone', dict(viewport={'width':188,'height':406}, device_scale_factor=4, is_mobile=True), 24),
          ('tablet', dict(viewport={'width':820,'height':1180}, device_scale_factor=2, is_mobile=True, has_touch=True), 24),
        ]
        for name, ctxargs, size in configs:
            ctx = b.new_context(locale='es-MX', **ctxargs)
            ctx.add_init_script(MOCKS)
            ctx.add_init_script(f"try{{localStorage.setItem('biblia.ajustes', JSON.stringify({{size:{size},theme:'claro',font:'sans',rate:2}}));localStorage.setItem('biblia.marcadores', JSON.stringify([{{book:'1-tesalonicenses',chapter:5,savedAt:Date.now()}},{{book:'juan',chapter:3,savedAt:Date.now()}}]));localStorage.setItem('biblia.ultimo', JSON.stringify({{book:'2-tesalonicenses',chapter:3,scroll:0}}));}}catch(e){{}}")
            pg = ctx.new_page()
            for sname, h in SCREENS:
                pg.goto(BASE + h); pg.wait_for_timeout(450)
                check(pg, f'{name}/{sname}', layout_results)
                if name in ('375', 'zoom200-desktop', 'zoom200-phone', '375-40px', '320'):
                    pg.screenshot(path=f'{OUT}{name}-{sname}.png')
            # voice panel intro + confirm dialog at this size
            pg.goto(BASE + '#/libros'); pg.wait_for_timeout(300)
            pg.click('#btn-hablar'); pg.wait_for_timeout(200)
            check(pg, f'{name}/voice-intro', layout_results)
            if name in ('375', 'zoom200-desktop', '375-40px', '320'): pg.screenshot(path=f'{OUT}{name}-voice-intro.png')
            pg.click('[data-action="voice-start"]'); pg.wait_for_timeout(150)
            check(pg, f'{name}/voice-listening', layout_results)
            if name in ('375', '320'): pg.screenshot(path=f'{OUT}{name}-voice-listening.png')
            pg.evaluate("window.__emit(['juan tres dieciséis'])"); pg.wait_for_timeout(150)
            check(pg, f'{name}/voice-result', layout_results)
            if name in ('375', '375-40px', '320'): pg.screenshot(path=f'{OUT}{name}-voice-result.png')
            pg.click('[data-action="voice-close"]'); pg.wait_for_timeout(100)
            pg.goto(BASE + '#/marcadores'); pg.wait_for_timeout(300)
            pg.click('.btn-delete >> nth=0'); pg.wait_for_timeout(150)
            check(pg, f'{name}/confirm', layout_results)
            if name in ('375', '375-40px'): pg.screenshot(path=f'{OUT}{name}-confirm.png')
            ctx.close()

        # ---------- axe in each theme ----------
        for theme in ('claro', 'oscuro', 'contraste'):
            ctx = b.new_context(locale='es-MX', viewport={'width':375,'height':812}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ctx.add_init_script(MOCKS)
            ctx.add_init_script(f"try{{localStorage.setItem('biblia.ajustes', JSON.stringify({{size:24,theme:'{theme}',font:'sans',rate:2}}));localStorage.setItem('biblia.marcadores', JSON.stringify([{{book:'juan',chapter:3,savedAt:Date.now()}}]));localStorage.setItem('biblia.ultimo', JSON.stringify({{book:'juan',chapter:3,scroll:0}}));}}catch(e){{}}")
            pg = ctx.new_page()
            for sname, h in SCREENS:
                pg.goto(BASE + h); pg.wait_for_timeout(450)
                axe(pg, f'{theme}/{sname}', axe_results)
                if sname in ('juan3', 'found', 'ajustes', 'libros'): pg.screenshot(path=f'{OUT}theme-{theme}-{sname}.png')
            # search result + voice panel states
            pg.goto(BASE + '#/buscar'); pg.wait_for_timeout(300)
            pg.fill('#q', 'Juan 3:16'); pg.click('button[type=submit]'); pg.wait_for_timeout(150)
            axe(pg, f'{theme}/buscar-result', axe_results)
            pg.goto(BASE + '#/libros'); pg.wait_for_timeout(300)
            pg.click('#btn-hablar'); pg.wait_for_timeout(150)
            axe(pg, f'{theme}/voice-intro', axe_results)
            ctx.close()

        # ---------- Flows (iPhone-like: only webkitSpeechRecognition) ----------
        ctx = b.new_context(locale='es-MX', viewport={'width':390,'height':844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        ctx.add_init_script(MOCKS)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        def ok(cond, msg): flow.append(('PASS' if cond else 'FAIL', msg))

        pg.goto(BASE); pg.wait_for_timeout(500)
        ok(pg.url.endswith('#/libros'), 'first launch opens Libros (no history yet)')
        ok(pg.is_visible('text=Bienvenido'), 'welcome text on first launch')

        # Voice: first use explains the microphone
        pg.click('#btn-hablar'); pg.wait_for_timeout(150)
        ok(pg.is_visible('#voice-panel h2:has-text("Buscar con su voz")'), 'first use shows microphone explanation')
        pg.click('[data-action="voice-start"]'); pg.wait_for_timeout(150)
        ok(pg.is_visible('text=Escuchando…'), 'listening panel shows "Escuchando…"')
        ok(pg.is_visible('text=Diga, por ejemplo:'), 'listening panel shows example')
        lang = pg.evaluate('window.__sr.last.lang')
        ok(lang == 'es-MX', f'recognition language is es-MX (got {lang})')
        ok(pg.evaluate("document.activeElement.textContent.trim()") == 'Cancelar', 'focus is on Cancelar while listening')
        pg.evaluate("window.__emit(['juan tres die'], false)"); pg.wait_for_timeout(80)
        ok('juan tres die' in pg.inner_text('#voice-heard'), 'interim words are shown while listening')
        pg.evaluate("window.__emit(['juan tres dieciséis', 'juan 3 16'])"); pg.wait_for_timeout(150)
        ok(pg.is_visible('h2:has-text("Buscando: Juan 3:16")'), 'shows "Buscando: Juan 3:16"')
        ok(pg.is_visible('[data-action="voice-go"]:has-text("Ir")') and pg.is_visible('text=Intentar de nuevo'), 'Ir and Intentar de nuevo buttons shown')
        pg.click('[data-action="voice-go"]'); pg.wait_for_timeout(600)
        ok('#/leer/juan/3/16' in pg.url, 'Ir jumps to Juan 3:16')
        ok(pg.locator('.verse.is-found').count() == 1 and pg.get_attribute('.verse.is-found', 'data-v') == '16', 'verse 16 highlighted')
        top = pg.evaluate("document.querySelector('#v16').getBoundingClientRect().top")
        ok(0 <= top < 200, f'found verse scrolled into view (top={round(top)})')
        ok(pg.evaluate("document.activeElement.id") == 'v16', 'focus moved to found verse (screen readers read it)')
        ok(pg.is_visible('text=Escuchar el versículo'), 'offers "Escuchar el versículo" after jumping')

        # Read found verse aloud
        pg.evaluate("window.__spoken.length = 0")
        pg.click('text=Escuchar el versículo'); pg.wait_for_timeout(100)
        sp = pg.evaluate("window.__spoken")
        ok(len(sp) == 2 and sp[0]['text'].startswith('Juan, capítulo 3, versículo 16') and sp[1]['text'].startswith('Porque de tal manera'), 'reads reference then verse 16')
        ok(sp and sp[0]['voice'] == 'Paulina' and sp[0]['lang'] == 'es-MX', f'uses es-MX voice over es-ES (got {sp[0] if sp else None})')
        ok(pg.is_visible('.found-callout >> text=Pausar'), 'button turns into Pausar while speaking')
        pg.click('.found-callout >> text=Pausar'); pg.wait_for_timeout(80)
        ok(pg.is_visible('.found-callout >> text=Continuar'), 'Pausar → Continuar')

        # Range by voice
        pg.click('#btn-hablar'); pg.wait_for_timeout(120)
        ok(pg.is_visible('text=Escuchando…'), 'second use goes straight to listening (no explanation again)')
        pg.evaluate("window.__emit(['Mateo cinco del uno al doce'])"); pg.wait_for_timeout(120)
        ok(pg.is_visible('h2:has-text("Buscando: Mateo 5:1-12")'), 'range: Mateo 5:1-12')
        pg.click('[data-action="voice-go"]'); pg.wait_for_timeout(600)
        ok(pg.locator('.verse.is-found').count() == 12, '12 verses highlighted')

        # Not understood
        pg.click('#btn-hablar'); pg.wait_for_timeout(120)
        pg.evaluate("window.__emit(['hola cómo está'])"); pg.wait_for_timeout(120)
        ok(pg.is_visible('h2:has-text("No entendí.")') and pg.is_visible('text=Intente decir el libro, capítulo y versículo.'), 'friendly "No entendí" message')
        ok(pg.is_visible('text=Por ejemplo:'), 'examples shown when not understood')
        # chapter that doesn't exist
        pg.click('[data-action="voice-retry"]'); pg.wait_for_timeout(100)
        pg.evaluate("window.__emit(['Juan veintidós'])"); pg.wait_for_timeout(120)
        ok(pg.is_visible('text=Juan tiene 21 capítulos'), 'helpful message for missing chapter')
        pg.click('[data-action="voice-close"]'); pg.wait_for_timeout(80)
        ok(pg.evaluate("document.activeElement.id") == 'btn-hablar', 'closing returns focus to Hablar')

        # Escape closes the panel and stops listening
        pg.click('#btn-hablar'); pg.wait_for_timeout(120)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        ok(not pg.evaluate("document.getElementById('voice-panel').open") and pg.evaluate("window.__sr.last.aborted === true"), 'Esc closes panel and stops the microphone')

        # No speech
        pg.click('#btn-hablar'); pg.wait_for_timeout(120)
        pg.evaluate("const r=window.__sr.last; r.onerror({error:'no-speech'}); r.onend && r.onend();"); pg.wait_for_timeout(100)
        ok(pg.is_visible('text=No le escuché.'), 'no-speech → "No le escuché."')
        pg.click('[data-action="voice-close"]')

        # Permission denied → typed fallback
        pg.evaluate("window.__srAutoError = 'not-allowed'")
        pg.click('#btn-hablar'); pg.wait_for_timeout(300)
        ok(pg.url.endswith('#/buscar') and pg.is_visible('text=no tiene permiso para usar el micrófono'), 'permission denied → typed search with explanation')
        pg.fill('#q', 'primera de corintios trece'); pg.click('button[type=submit]'); pg.wait_for_timeout(100)
        ok(pg.is_visible('text=Buscando: 1 Corintios 13'), 'typed fallback uses the same parser')
        pg.click('#search-result >> text=Ir'); pg.wait_for_timeout(500)
        ok('#/leer/1-corintios/13' in pg.url, 'typed Ir opens 1 Corintios 13')
        pg.click('#btn-hablar'); pg.wait_for_timeout(200)
        ok(pg.url.endswith('#/buscar'), 'after denial, Hablar goes straight to the text box this session')
        pg.evaluate("window.__srAutoError = null")
        pg.fill('#q', 'xyz'); pg.click('button[type=submit]'); pg.wait_for_timeout(100)
        ok(pg.is_visible('text=Intente escribir el libro, capítulo y versículo.'), 'typed: friendly not-understood message')

        # Reading screen: Escuchar chapter, Anterior/Siguiente, bookmarks
        pg.goto(BASE + '#/leer/salmos/23'); pg.wait_for_timeout(500)
        pg.evaluate("window.__spoken.length = 0")
        pg.click('[data-mode="chapter"]'); pg.wait_for_timeout(100)
        sp = pg.evaluate("window.__spoken")
        ok(len(sp) == 7 and sp[0]['text'] == 'Salmos, capítulo 23.', f'Escuchar queues title + 6 verses (got {len(sp)})')
        ok(abs(sp[0]['rate'] - 0.9) < 1e-6, 'default speed 0.9 ("Un poco lenta")')
        pg.evaluate("window.speechSynthesis._end()"); pg.wait_for_timeout(50)
        ok(pg.locator('.verse.is-speaking').count() == 1 and pg.get_attribute('.verse.is-speaking', 'data-v') == '1', 'current verse is marked while reading')
        pg.click('[data-mode="chapter"]'); pg.wait_for_timeout(50)   # pause
        pg.evaluate("window.__spoken.length = 0")
        pg.click('[data-mode="chapter"]'); pg.wait_for_timeout(120)  # resume
        sp = pg.evaluate("window.__spoken")
        ok(len(sp) == 6 and sp[0]['text'].startswith('Jehová es mi pastor') or (sp and 'pastor' in sp[0]['text']), 'Continuar resumes from the same verse')
        pg.click('a[rel="next"]'); pg.wait_for_timeout(400)
        ok(pg.url.endswith('#/leer/salmos/24') and pg.evaluate("window.speechSynthesis.current") is None, 'Siguiente → Salmos 24 and speech stops')
        pg.goto(BASE + '#/leer/malaquias/4'); pg.wait_for_timeout(400)
        ok(pg.is_visible('a[rel="next"] >> text=Mateo 1'), 'Siguiente after Malaquías 4 is Mateo 1')
        pg.goto(BASE + '#/leer/genesis/1'); pg.wait_for_timeout(400)
        ok(pg.locator('a[rel="prev"]').count() == 0, 'no Anterior on Génesis 1')
        ok(pg.inner_text('#v1').endswith('En el principio crió Dios los cielos y la tierra.'), 'RV1909 text (Génesis 1:1 "crió")')

        pg.click('#btn-bookmark'); pg.wait_for_timeout(100)
        ok(pg.is_visible('#btn-bookmark >> text=Guardado'), 'one tap saves bookmark')
        pg.click('#btn-bookmark'); pg.wait_for_timeout(100)
        ok(pg.is_visible('#dialog >> text=¿Desea borrar este marcador?'), 'tapping again asks before deleting')
        pg.click('#dialog >> text=No, conservar'); pg.wait_for_timeout(100)
        ok(pg.is_visible('#btn-bookmark >> text=Guardado'), '"No, conservar" keeps it')
        pg.click('a[data-nav="marcadores"]'); pg.wait_for_timeout(300)
        ok(pg.is_visible('.bookmark >> text=Génesis 1'), 'bookmark listed in Marcadores')
        ok(pg.is_visible('text=Guardado el'), 'bookmark shows date in Spanish')
        pg.click('.btn-delete'); pg.wait_for_timeout(100)
        pg.click('#dialog >> text=Sí, borrar'); pg.wait_for_timeout(200)
        ok(pg.is_visible('text=Todavía no tiene marcadores.'), 'confirmed delete removes it')

        # Settings: live + remembered
        pg.click('a[data-nav="ajustes"]'); pg.wait_for_timeout(300)
        fs0 = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.preview-text')).fontSize)")
        pg.click('[data-action="size-up"]'); pg.click('[data-action="size-up"]'); pg.wait_for_timeout(50)
        fs1 = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.preview-text')).fontSize)")
        ok(abs(fs0 - 24) < .5 and abs(fs1 - 28) < .5, f'A+ changes text live (24 → {fs1})')
        pg.click('text=Alto contraste'); pg.wait_for_timeout(50)
        ok(pg.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(0, 0, 0)' and pg.evaluate("getComputedStyle(document.body).color") == 'rgb(255, 255, 0)', 'Alto contraste = yellow on black, live')
        pg.click('text=Letra clásica'); pg.wait_for_timeout(50)
        ok('Literata' in pg.evaluate("getComputedStyle(document.querySelector('.preview-text')).fontFamily"), 'serif font option applies to preview')
        pg.click('[data-action="rate-up"]'); pg.wait_for_timeout(50)
        ok(pg.inner_text('#rate-out').endswith('Normal'), 'speed stepper shows words ("Normal")')
        pg.evaluate("window.__spoken.length = 0"); pg.click('[data-action="test-voice"]'); pg.wait_for_timeout(100)
        sp = pg.evaluate("window.__spoken")
        ok(sp and abs(sp[0]['rate'] - 1.0) < 1e-6, 'Probar la voz uses the new speed')
        for _ in range(12):
            if pg.get_attribute('[data-action="size-up"]', 'aria-disabled') != 'true': pg.click('[data-action="size-up"]')
        ok(': 40' in pg.inner_text('#size-out'), 'size stops at 40')
        ok(pg.get_attribute('[data-action="size-up"]', 'aria-disabled') == 'true', 'A+ marked unavailable at 40')
        pg.reload(); pg.wait_for_timeout(500)
        ok(pg.evaluate("document.documentElement.dataset.theme") == 'contraste' and ': 40' in pg.inner_text('#size-out'), 'settings remembered after reload')

        # Resume where I left off
        pg.goto(BASE + '#/leer/romanos/8'); pg.wait_for_timeout(500)
        pg.evaluate("window.scrollTo(0, document.documentElement.scrollHeight * 0.5)"); pg.wait_for_timeout(700)
        pg.goto(BASE); pg.wait_for_timeout(800)
        ok(pg.url.endswith('#/leer/romanos/8'), 'reopening the app goes to the last chapter read')
        y = pg.evaluate("window.scrollY")
        ok(y > 500, f'and restores the reading position (scrollY={int(y)})')
        pg.click('a[data-nav="libros"]'); pg.wait_for_timeout(300)
        ok(pg.is_visible('text=Continuar leyendo') and pg.is_visible('text=Romanos 8'), '"Continuar leyendo: Romanos 8" on Libros')
        ok(not errors, 'no JavaScript errors: ' + '; '.join(errors[:3]))
        ctx.close()

        # ---------- Firefox-like: no speech recognition at all ----------
        ctx = b.new_context(locale='es-MX', viewport={'width':375,'height':812}, is_mobile=True, has_touch=True)
        ctx.add_init_script("window.__noSR = true;"); ctx.add_init_script(MOCKS)
        pg = ctx.new_page(); pg.goto(BASE); pg.wait_for_timeout(400)
        ok(pg.is_visible('#btn-hablar'), 'no speech recognition: Hablar button still visible (nothing hidden)')
        pg.click('#btn-hablar'); pg.wait_for_timeout(300)
        ok(pg.url.endswith('#/buscar') and pg.is_visible('text=Su navegador no permite buscar con la voz'), 'unsupported → typed search with explanation')
        pg.fill('#q', 'Salmo 23'); pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
        ok(pg.is_visible('text=Buscando: Salmos 23'), 'Enter key submits typed search')
        pg.screenshot(path=f'{OUT}nosr-buscar.png')
        ctx.close()

        # ---------- Offline (service worker) ----------
        ctx = b.new_context(locale='es-MX', viewport={'width':375,'height':812})
        pg = ctx.new_page(); pg.goto(BASE); pg.wait_for_timeout(500)
        pg.evaluate("navigator.serviceWorker.ready"); pg.wait_for_timeout(4000)
        n = pg.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(a => a.flat().length)")
        ok(n >= 85, f'service worker cached app + Bible ({n} files)')
        ctx.set_offline(True)
        pg.goto(BASE + '#/leer/apocalipsis/22'); pg.reload(); pg.wait_for_timeout(800)
        ok(pg.locator('.verse').count() > 15, 'offline: Apocalipsis 22 opens with no internet')
        pg.goto(BASE + '#/acerca'); pg.wait_for_timeout(800)
        ok('Puede leer sin internet' in pg.inner_text('#offline-status'), 'Acerca de reports offline-ready')
        ctx.close()
        b.close()

    # ---------- Report ----------
    print('=== FLOWS ===')
    for s, m in flow: print(s, m)
    print('\n=== LAYOUT (truncation / overflow / tap targets) ===')
    bad = [(l, i) for l, i in layout_results if i]
    print(f'{len(layout_results)} screens checked, {len(bad)} with issues')
    for l, i in bad: print(' ', l, '→', i)
    print('\n=== AXE ===')
    for l, v in axe_results:
        if v: print(' ', l, json.dumps(v, ensure_ascii=False)[:900])
    print(f'{len(axe_results)} screens scanned, {sum(1 for _, v in axe_results if v)} with violations')
    failed = sum(1 for s, _ in flow if s == 'FAIL') + len(bad) + sum(1 for _, v in axe_results if v)
    sys.exit(1 if failed else 0)

run()
