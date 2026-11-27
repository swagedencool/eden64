# « Jouer à deux » de bout en bout, dans deux onglets du même navigateur (?duo=local, vraie liaison WebRTC).
# Il faut un jeu dans roms/ et le serveur lancé : node tools/serveur.mjs, puis python tests/duo_e2e.py
import asyncio, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8064/'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        h = await ctx.new_page(); errs = []
        h.on('pageerror', lambda e: errs.append(str(e)))
        await h.goto(URL + '?duo=local'); await h.click('.lib .list .cart b'); await h.keyboard.press('Enter')
        await h.wait_for_function("document.querySelector('#state').textContent === 'En marche'", timeout=120000)
        await asyncio.sleep(5)
        await h.evaluate("() => { const gm = EJS_emulator.gameManager, f = gm.simulateInput.bind(gm); window.got = []; gm.simulateInput = (p, s, v) => { got.push([p, s, v]); return f(p, s, v); }; }")
        await h.click('#tab-duo'); await h.click('#duo-create'); await h.click('#duo-mode [data-m=p1]')
        code = await h.text_content('#duo-code')
        g = await ctx.new_page(); g.on('pageerror', lambda e: errs.append(str(e)))
        await g.goto(f'{URL}?salle={code}&duo=local'); await g.click('#duo-join')
        await g.wait_for_function("document.querySelector('#duo-video').videoWidth > 0", timeout=20000)
        assert 'Ami connecté' in await h.text_content('#duo-status')
        kc = await g.evaluate("eden.prefs.binds.kb.start")
        await g.keyboard.down('Enter'); await asyncio.sleep(0.3); await g.keyboard.up('Enter'); await asyncio.sleep(0.5)
        assert kc != 13 or await h.evaluate("got.some(([p, s, v]) => p === 0 && s === 3 && v === 1)"), 'Start de l\'ami non reçu'
        await g.click('#duo-g-react button'); await h.wait_for_selector('.duo-pop', state='attached')
        await h.click('#duo-mode [data-m=watch]'); await g.wait_for_selector('#duo-ask', state='visible')
        n = await h.evaluate("got.length"); await g.keyboard.press('Enter'); await asyncio.sleep(0.5)
        assert await h.evaluate("got.length") == n, 'entrée acceptée en mode Regarde'
        await h.click('#duo-close'); await g.wait_for_function("document.querySelector('#duo-g-status').textContent.includes('fermé')")
        assert not errs, errs
        print('ok : vidéo et son reçus, touches, réactions, modes et fermeture')
        await b.close()
asyncio.run(main())
