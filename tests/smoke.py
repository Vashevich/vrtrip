"""Автотест VRtrip (Тимур, QA): быстрый прогон в браузере без шлема.
Запуск:  python3 -m http.server 8766 &   затем   python3 tests/smoke.py [--url http://localhost:8766/] [--heavy]
Проверяет: загрузку страницы на разных экранах, все тестовые модели из tests/models,
режимы и инструменты, ошибки JavaScript. Выход с кодом 1, если что-то упало."""
import asyncio, os, re, sys, time, json
from playwright.async_api import async_playwright

URL = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--url=')), 'http://localhost:8766/index.html')
HEAVY = '--heavy' in sys.argv
LIBS = os.environ.get('VRTRIP_LIBS')          # локальная папка node_modules вместо CDN (для офлайн-прогона)
MODELS = os.path.join(os.path.dirname(__file__), 'models')
SHOTS = os.environ.get('VRTRIP_SHOTS', os.path.join(os.path.dirname(__file__), 'shots'))
EXPECT_BAD = {'09_empty.obj'}                   # тут ждём понятную ошибку, а не падение
EXPECT_WARN = {'04_missing_mtl.obj': 'Не найдены', '08_broken.obj': 'повреждённые'}   # грузится, но с предупреждением
VIEWS = [('desktop', 1366, 768, False), ('phone_portrait', 390, 844, True), ('phone_landscape', 844, 390, True)]

results, problems = [], []
def ok(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    if not cond: problems.append(f'{name}: {detail}')

def local(url):
    if not LIBS: return None
    m = re.match(r'https://cdn\.jsdelivr\.net/npm/(three|three-mesh-bvh)@[\d.]+/(.*)', url)
    if m: return os.path.join(LIBS, m.group(1), m.group(2))
    if 'jszip' in url: return os.path.join(LIBS, 'jszip/dist/jszip.min.js')

async def wait_idle(pg, timeout=120000):
    t0 = time.time()
    await pg.wait_for_function("() => document.querySelector('#busy').hidden", timeout=timeout)
    return time.time() - t0

TOAST_LOG = '''
  window.__toasts = [];
  addEventListener('DOMContentLoaded', () => {
    const t = document.querySelector('#toast');
    new MutationObserver(() => { if (!t.hidden && t.textContent) { const l = window.__toasts[window.__toasts.length - 1];
      if (!l || l.text !== t.textContent) window.__toasts.push({ text: t.textContent, bad: t.classList.contains('bad') }); } })
      .observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
  });'''

async def toast(pg, since=0):
    """последнее сообщение, появившееся после отметки since (даже если уже исчезло)"""
    l = await pg.evaluate(f'() => window.__toasts.slice({since})')
    return l[-1] if l else None

async def toast_mark(pg):
    return await pg.evaluate('() => window.__toasts.length')

async def run_view(b, name, w, h, touch):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
    pg = await ctx.new_page(); errs = []
    await pg.add_init_script(TOAST_LOG)
    async def route(r):
        f = local(r.request.url)
        if f and os.path.exists(f): await r.fulfill(path=f, content_type='application/javascript')
        elif 'fonts.g' in r.request.url and LIBS: await r.abort()
        else: await r.continue_()
    await pg.route('**/*', route)
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errs.append(f'console.error: {m.text}') if m.type == 'error' and 'favicon' not in m.text and not (LIBS and 'ERR_FAILED' in m.text) else None)
    await pg.goto(URL); await pg.wait_for_timeout(2500); await wait_idle(pg)
    # браузер без видеокарты рисует затенение углов и тени по 2+ секунды на кадр — в автотесте выключаем,
    # иначе клики не успевают. Сами эффекты проверяем на настоящих устройствах.
    await pg.evaluate("""() => ['#v-ao', '#v-shadows'].forEach(s => { const c = document.querySelector(s);
      if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); } })""")
    fms = await pg.evaluate("() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => ++n < 10 ? requestAnimationFrame(f) : r((performance.now() - t0) / 10); requestAnimationFrame(f); })")
    results.append((f'  [{name}] кадр в браузере без видеокарты', True, f'{fms:.0f} мс'))
    ver = await pg.evaluate("() => document.querySelector('#ver')?.textContent")
    ok(f'[{name}] страница открылась', ver, f'версия {ver}')
    # горизонтальная прокрутка страницы — признак поломанной раскладки
    sw = await pg.evaluate('() => document.documentElement.scrollWidth')
    ok(f'[{name}] нет горизонтальной прокрутки', sw <= w + 1, f'ширина страницы {sw} при экране {w}')
    await pg.screenshot(path=f'{SHOTS}/{name}_start.png')

    files = sorted(f for f in os.listdir(MODELS) if not f.endswith('.mtl') and (HEAVY or not f.startswith('heavy')))
    if name != 'desktop': files = ['01_pavilion_m.obj', '08_broken.obj']       # на телефонных раскладках — только быстрый набор
    for f in files:
        n0 = await pg.evaluate("() => document.querySelectorAll('#models li .pick').length")
        paths = [os.path.join(MODELS, f)]
        mtl = os.path.join(MODELS, f[:-4] + '.mtl')
        if f.endswith('.obj') and os.path.exists(mtl): paths.append(mtl)
        e0 = len(errs)
        # прячем уже загруженные модели, чтобы сцена не разрасталась (браузер без видеокарты)
        await pg.evaluate("() => document.querySelectorAll('#models li .pick[aria-pressed=\"true\"]').forEach(b => b.click())")
        await wait_idle(pg); tm = await toast_mark(pg)
        print(f'  … [{name}] {f}', flush=True)
        await pg.set_input_files('#file', paths, timeout=180000)
        await pg.wait_for_timeout(300)
        try: dt = await wait_idle(pg, 300000)
        except Exception: ok(f'[{name}] {f}: загрузка завершилась', False, 'зависла дольше 5 минут'); continue
        await pg.wait_for_timeout(400)
        t = await toast(pg, tm); n1 = await pg.evaluate("() => document.querySelectorAll('#models li .pick').length")
        new_errs = [e for e in errs[e0:] if not (f in EXPECT_BAD and e.startswith('console.error: Error:'))]
        del errs[e0:]; errs += new_errs
        if f in EXPECT_WARN:
            ok(f'[{name}] {f}: загрузилась с предупреждением', n1 == n0 + 1 and t and EXPECT_WARN[f] in t['text'] and not new_errs, f"сообщение: {t and t['text']!r}; ошибки JS: {new_errs[:2]}")
        elif f in EXPECT_BAD:
            ok(f'[{name}] {f}: понятная ошибка вместо падения', t and t['bad'] and not new_errs and n1 == n0, f"сообщение: {t and t['text']!r}; ошибки JS: {new_errs[:2]}")
        else:
            ok(f'[{name}] {f}: загрузилась', n1 == n0 + 1 and not new_errs, f"{dt:.1f} с; сообщение: {t and t['text']!r}; ошибки JS: {new_errs[:2]}")
        results.append((f'  время {f}', True, f'{dt:.1f} с'))
    await pg.screenshot(path=f'{SHOTS}/{name}_models.png')

    # режимы
    for mid in ('m-walk', 'm-orbit', 'm-cardboard', 'm-orbit'):
        e0 = len(errs)
        btn = pg.locator(f'#{mid}')
        if not await btn.is_visible(): ok(f'[{name}] режим {mid}: кнопка видна', False, 'кнопка не видна'); continue
        await btn.click(); await pg.wait_for_timeout(700)
        if mid == 'm-cardboard': await pg.screenshot(path=f'{SHOTS}/{name}_cardboard.png'); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        if mid == 'm-walk': await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        ok(f'[{name}] режим {mid}', len(errs) == e0, f'ошибки JS: {errs[e0:][:2]}')
    # если режим VR-очков не закрылся по Esc — выходим кнопкой
    await pg.evaluate("() => { const b = document.querySelector('#cb-exit'); if (b && !document.querySelector('#cbui').hidden) b.click(); }")
    await pg.wait_for_timeout(400)

    # инструменты: выбрать и кликнуть по модели
    box = await pg.locator('canvas').first.bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    for tool in ('pin', 'measure', 'pen', 'section', 'explode', 'erase', 'nav'):
        e0 = len(errs); btn = pg.locator(f'[data-tool="{tool}"]').first
        if not await btn.is_visible():
            await btn.scroll_into_view_if_needed()
        if not await btn.is_visible(): ok(f'[{name}] инструмент {tool}: кнопка видна', False, 'кнопка не видна'); continue
        try: await btn.click(timeout=8000)
        except Exception as ex: ok(f"[{name}] инструмент {tool}: кнопка нажимается", False, str(ex).splitlines()[-1][:160]); continue
        await pg.wait_for_timeout(300)
        if tool in ('pin', 'measure'):
            await pg.mouse.click(cx, cy); await pg.wait_for_timeout(200); await pg.mouse.click(cx + 40, cy + 20); await pg.wait_for_timeout(200)
            await pg.keyboard.press('Escape')
        elif tool == 'pen':
            await pg.mouse.move(cx - 30, cy); await pg.mouse.down(); await pg.mouse.move(cx + 30, cy + 10, steps=8); await pg.mouse.up()
        elif tool == 'explode':
            await pg.mouse.move(cx, cy); await pg.mouse.wheel(0, -400); await pg.wait_for_timeout(500); await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(300)
        ok(f'[{name}] инструмент {tool}', len(errs) == e0, f'ошибки JS: {errs[e0:][:2]}')
    await pg.screenshot(path=f'{SHOTS}/{name}_tools.png')
    ok(f'[{name}] без ошибок JavaScript за весь прогон', not errs, '; '.join(errs[:4]))
    await ctx.close()

async def main():
    os.makedirs(SHOTS, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        for v in VIEWS:
            if any(a.startswith('--only=') for a in sys.argv) and v[0] not in next(a for a in sys.argv if a.startswith('--only='))[7:].split(','): continue
            await run_view(b, *v)
        await b.close()
    for n, good, d in results: print(('  ✓ ' if good else '  ✗ ') + n + (f' — {d}' if d else ''))
    print(f'\nПроблем: {len(problems)}')
    json.dump({'problems': problems, 'results': results}, open(f'{SHOTS}/report.json', 'w'), ensure_ascii=False, indent=1)
    sys.exit(1 if problems else 0)

asyncio.run(main())
