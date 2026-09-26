# My week with Claude: Instagram carousel

An 11-slide Instagram carousel (1080 x 1350, 4:5) showing how I run Itqan Studio with Claude, one workflow per day. The format follows Claude's "A week with Claude for Small Business" campaign from 15 September 2026: day tiles, a "Run it" prompt, and the tools each workflow touches.

Two finished versions, same content:

| Version | Folder | Look |
|---|---|---|
| Claude style | `out/claude/` | Claude's campaign palette: ivory, pastel day colours, clay orange |
| Itqan | `out/itqan/` | My own brand: deep teal `#0d282b` and lime `#d7fd64` |

`out/contact-sheet-*.png` shows all 11 slides of each version on one image. Caption, alt text and a posting checklist are in [caption.md](caption.md).

## Claims to confirm before posting

Every sentence on a slide is a public claim about how the studio works, so each one is either sourced or flagged. **Verified** means it comes from my profile README or my public repos (`claude-skills`, `the-boardroom`, `markaz-mcp`). **Confirm** means it was inferred from the tools connected to my Claude account and I still need to check it's true.

| Slide | Claim | Status |
|---|---|---|
| 03 Plan the week | Claude reads calendar and inbox and writes a one-page weekly brief (Gmail, Google Calendar, Notion) | confirm |
| 04 Build in Claude Code | Client sites, the Itqan CRM and its iOS app; GitHub, Supabase, Docker, Terraform | verified |
| 05 The Panel | Five models from four vendors, Claude only synthesizes, a blocking seat that dies means INCONCLUSIVE, `/panel` | verified |
| 06 Calls become proposals | Calls recorded with consent, Claude drafts the proposal from notes and past projects (Calendly, Fathom, Google Drive, Gmail) | confirm |
| 07 Tax citations | Markaz returns verbatim articles with citations or nothing, `get_provision` | verified |
| 08 Content | Each Barakah Blueprint episode becomes clips, posts and a newsletter (YouTube, Kit, Canva, Metricool) | confirm |
| 09 The Boardroom | Four blind advisors built to disagree, `/board` | verified |
| 10 Check the absences | The 45-day backup story is verified. "Now Claude reads every status nobody watches" at month end is not | confirm |
| 11 Closing | "Nothing sends, merges, posts or pays without my OK" | confirm |

To change or drop a claim, edit `content.js` and re-render. Each slide there carries the same `status` field.

## Things to check that aren't design

- **Recording client calls (slide 06).** The slide says calls are recorded with consent, so that has to be true for every call, and the client contract or privacy notice should say that call notes go to third-party tools (Fathom, Claude). UAE privacy law is strict about recording people without consent. Get a lawyer to confirm the exact obligations. I couldn't verify them here because the Ansvar Law connector has no UAE coverage.
- **Tax slide (07).** It carries the line "A retrieval tool, not tax advice", matching the Markaz README. Keep it.
- **Advertising rules.** The closing slide promotes the studio. Check whether the UAE Media Council's advertiser permit rules apply to posts promoting your own business. This one also couldn't be verified here.
- **Brand look.** The Claude-style version uses Claude's palette and layout language but no Claude or Anthropic logo, and the handle is on every slide. The caption says where the format comes from. It's still close enough that someone skimming could take it for an official Claude post. The Itqan version avoids that entirely.

## Edit and re-render

Everything a viewer reads is in `content.js`. The illustrations are hand-written SVG in `illustrations.js`, and the layout and both colour themes are in `slides.html`.

```bash
npm install                 # once; on a new machine also run: npx playwright install chromium
npm run render              # both versions -> out/claude, out/itqan
node render.mjs itqan       # just one version
```

The render script fails if a slide isn't exactly 1080 x 1350. It warns when copy gets long enough to squeeze an illustration below 240px or push into the bottom edge, so shorten the text when you see that. Open `slides.html` in a browser to preview (`slides.html?theme=itqan` for the other version).

## Credits

- Fonts: Source Serif 4, Poppins, JetBrains Mono, Amiri, all under the SIL Open Font License (`fonts/OFL-*.txt`).
- Line icons: [Lucide](https://lucide.dev) (ISC).
- Tool glyphs: [Simple Icons](https://simpleicons.org) (CC0). The logos are trademarks of their owners and are used only to name the tools I use.
- Format inspired by Claude's "A week with Claude for Small Business" (claude.com, 15 September 2026). Not affiliated with or endorsed by Anthropic.
