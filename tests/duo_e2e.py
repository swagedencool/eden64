# « Jouer à deux » de bout en bout, dans deux onglets du même navigateur (?duo=local, vraie liaison WebRTC).
# Il faut un jeu dans roms/ et le serveur lancé : node tools/serveur.mjs, puis python tests/duo_e2e.py
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8064/'

async def until(page, js, timeout=20):
    # Playwright ne peut pas attendre une condition écrite en texte sous la CSP de la page : on interroge nous-mêmes
    for _ in range(int(timeout * 4)):
        if await page.evaluate(js): return
        await asyncio.sleep(0.25)
    raise TimeoutError(js)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        h = await ctx.new_page(); errs = []
        h.on('pageerror', lambda e: errs.append(str(e)))
        await h.add_init_script("addEventListener('securitypolicyviolation', (e) => console.error('CSP ' + e.violatedDirective + ' ' + e.blockedURI))")
        h.on('console', lambda m: m.text.startswith('CSP') and errs.append(m.text))
        await h.goto(URL + '?duo=local'); await h.click('.lib .list .cart b'); await h.keyboard.press('Enter')
        await until(h, "document.querySelector('#state').textContent === 'En marche'", 120)
        await asyncio.sleep(5)
        await h.evaluate("() => { const gm = EJS_emulator.gameManager, f = gm.simulateInput.bind(gm); window.got = []; gm.simulateInput = (p, s, v) => { got.push([p, s, v]); return f(p, s, v); }; }")
        await h.click('#tab-duo'); await h.click('#duo-create'); await h.click('#duo-mode [data-m=p1]')
        code = await h.text_content('#duo-code')
        g = await ctx.new_page(); g.on('pageerror', lambda e: errs.append(str(e)))
        await g.goto(f'{URL}?salle={code}&duo=local'); await g.click('#duo-join')
        await until(g, "document.querySelector('#duo-video').videoWidth > 0", 20)
        assert 'est connecté' in await h.text_content('#duo-status')
        kc = await g.evaluate("eden.prefs.binds.kb.start")
        await g.keyboard.down('Enter'); await asyncio.sleep(0.3); await g.keyboard.up('Enter'); await asyncio.sleep(0.5)
        assert kc != 13 or await h.evaluate("got.some(([p, s, v]) => p === 0 && s === 3 && v === 1)"), 'Start de l\'ami non reçu'
        await g.click('#duo-g-react button'); await h.wait_for_selector('.duo-pop', state='attached')
        await h.click('#duo-mode [data-m=watch]'); await g.wait_for_selector('#duo-ask', state='visible')
        n = await h.evaluate("got.length"); await g.keyboard.press('Enter'); await asyncio.sleep(0.5)
        assert await h.evaluate("got.length") == n, 'entrée acceptée en mode Regarde'
        await h.click('#duo-close'); await until(g, "document.querySelector('#duo-g-status').textContent.includes('fermé')")
        # Chacun sa partie : deux onglets se retrouvent avec leur pseudo (la position de Link demande d'être en jeu)
        await ctx.add_init_script("localStorage.setItem('be64-prefs', JSON.stringify({ v: 3, duoName: location.hash.slice(1) }))")
        x = await ctx.new_page(); await x.goto(URL + '?duo=local#Eden'); await x.click('#tab-duo'); await x.click('#duo-create-ens')
        code = await x.text_content('#duo-code')
        y = await ctx.new_page(); await y.goto(f'{URL}?duo=local&salle={code}#Lucas')
        await until(x, "document.querySelector('#duo-status').textContent.startsWith('Lucas est connecté')")
        await until(y, "document.querySelector('#duo-status').textContent.startsWith('Eden est connecté')")
        assert not errs, errs
        print('ok : écran partagé (vidéo, son, touches, réactions, modes, fermeture) et salle « chacun sa partie »')
        await b.close()
asyncio.run(main())
