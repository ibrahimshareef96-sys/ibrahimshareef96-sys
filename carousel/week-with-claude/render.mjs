// Renders every slide in slides.html to a 1080x1350 PNG (Instagram portrait 4:5),
// plus a contact sheet per theme. Usage: node render.mjs [claude] [itqan]
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const themes = process.argv.slice(2).length ? process.argv.slice(2) : ['claude', 'itqan'];
const pageUrl = (q) => `${pathToFileURL(join(here, 'slides.html')).href}?${q}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });

for (const theme of themes) {
  const out = join(here, 'out', theme);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  await page.goto(pageUrl(`theme=${theme}`));
  await page.waitForSelector('body[data-ready="1"]');
  const slides = await page.$$('.slide');
  for (const [i, el] of slides.entries()) {
    const key = await el.getAttribute('data-key');
    const box = await el.boundingBox();
    if (Math.round(box.width) !== 1080 || Math.round(box.height) !== 1350) throw new Error(`slide ${key} is ${box.width}x${box.height}`);
    // Anything spilling past the slide's bottom padding means the copy is too long for the layout.
    const overflow = await el.evaluate((s) => {
      const limit = s.getBoundingClientRect().bottom - 40;
      return [...s.querySelectorAll('.foot, .how, .body, .fine, .ov-list, .cta, .tiles')]
        .filter((n) => n.getBoundingClientRect().bottom > limit + 1).map((n) => n.className);
    });
    if (overflow.length) console.warn(`  ! ${theme}/${key}: content reaches the bottom edge (${overflow.join(', ')})`);
    // Long copy never overflows first: the illustration gives up its space. Below this it stops reading.
    const art = await el.evaluate((s) => s.querySelector('.art')?.getBoundingClientRect().height ?? null);
    if (art !== null && art < 240) console.warn(`  ! ${theme}/${key}: illustration squeezed to ${Math.round(art)}px, shorten the copy`);
    await el.screenshot({ path: join(out, `${String(i + 1).padStart(2, '0')}-${key}.png`) });
  }
  await page.goto(pageUrl(`theme=${theme}&sheet=1`));
  await page.waitForSelector('body[data-ready="1"]');
  await (await page.$('#deck')).screenshot({ path: join(here, 'out', `contact-sheet-${theme}.png`) });
  console.log(`${theme}: ${slides.length} slides -> out/${theme}/`);
}
await browser.close();
