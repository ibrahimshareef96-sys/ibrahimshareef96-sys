# Ibrahim Shareef

**AI agent engineer. Dubai, UAE.**

[![Website](https://img.shields.io/badge/shareefi.co-0d282b?style=for-the-badge&logoColor=d7fd64)](https://shareefi.co)
[![Itqan Studio](https://img.shields.io/badge/Itqan_Studio-0d282b?style=for-the-badge&logoColor=d7fd64)](https://itqanstudio.com)
[![ProjectYou](https://img.shields.io/badge/ProjectYou-d7fd64?style=for-the-badge&labelColor=0d282b)](https://projectyou.app)

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0d282b?style=for-the-badge&logo=linkedin&logoColor=d7fd64)](https://www.linkedin.com/in/shareefibrahim/)
[![YouTube](https://img.shields.io/badge/YouTube-0d282b?style=for-the-badge&logo=youtube&logoColor=d7fd64)](https://www.youtube.com/@shareefico)
[![Instagram](https://img.shields.io/badge/Instagram-0d282b?style=for-the-badge&logo=instagram&logoColor=d7fd64)](https://www.instagram.com/shareefico/)
[![TikTok](https://img.shields.io/badge/TikTok-0d282b?style=for-the-badge&logo=tiktok&logoColor=d7fd64)](https://www.tiktok.com/@shareefico)

---

I build the layer around the model. Review gates that fail closed, retrieval that refuses to guess, motion tokens that hold across brands, advisor harnesses built to disagree with me. Almost all of it started as something I needed for my own work and stayed because it held up.

I came in sideways. I left pharmacy and spent the next stretch on survival jobs: substitute teaching, a warehouse, customer support tickets. At night I taught myself design off YouTube, shipped work that was genuinely ugly, and turned it into a paying portfolio. Then a technical consultant role in Sweden asked for Arabic, the applicant pool was nearly empty, and the portfolio made the argument for me. Dubai came later.

I run [Itqan Studio](https://itqanstudio.com), a B2B web and AI agency, and I host the Barakah Blueprint podcast, 40+ episodes in. Itqan is Arabic for doing something with the precision it deserves, which is a hard standard to keep when a model writes code faster than you can read it. That gap is what most of my tooling is for.

I am a hafiz of the Qur'an. You either have the text exactly or you do not, and that is roughly how I feel about citations in software.

## Featured work

### [The Panel](https://github.com/ibrahimshareef96-sys/claude-skills)

A code review board. Five frontier models from four vendors read the same diff, each through one exclusive lens, then Claude synthesizes the findings. No seat is Claude, because Claude reviewing Claude's code misses Claude-shaped bugs. Same priors, same blind spots, same confident wrong answer.

The gate is two tier and fails closed. If a blocking seat dies or times out, the run returns INCONCLUSIVE, never a pass. An abstention is not an approval. Most review harnesses fail open, which means the day your reviewer breaks is the day everything gets approved.

The repo also carries four judgment skills: architecture, code review, debugging, prompt craft.

### [Markaz](https://github.com/ibrahimshareef96-sys/markaz-mcp)

A citation-first MCP server over UAE Federal Tax Authority legislation. Postgres with pgvector. Retrieval is hybrid: tsvector keyword search and bge-m3 dense embeddings merged with Reciprocal Rank Fusion, so neither channel dominates the ranking. Embeddings are generated locally through Ollama, so the corpus never leaves the machine.

It returns verbatim statute text with the citation attached, or it returns nothing. Anything it cannot verify against source is flagged `verified=false` rather than smoothed into prose. Ask a general model a tax question and you get fluent, confident, unsourced text, and you cannot tell the right answers from the wrong ones without checking the law yourself.

### [Motion System](https://github.com/ibrahimshareef96-sys/motion-system)

W3C DTCG motion tokens compiled to CSS, JS and Tailwind, with a component utility layer and a framework-agnostic runtime on top. Vendor neutral and multi-brand, informed by Material 3 and Uber Base. Duration and easing get decided once, in one place, instead of separately inside every component.

### [The Boardroom](https://github.com/ibrahimshareef96-sys/the-boardroom)

Four AI advisors, each answering inside a sealed context window, genuinely blind to each other, so they cannot converge into one agreeable voice. They are built to disagree. The Operator refuses to think past eight weeks. The Capital Allocator refuses to think inside them. When they split, the split is the part worth reading.

**Also shipped:** [ProjectYou](https://projectyou.app), a Qur'an-centric life OS, and a CMS I built and still run.

## Stack

[![Stack](https://skillicons.dev/icons?i=ts,py,react,nextjs,tailwind,nodejs,postgres,supabase,docker,aws,vercel,figma)](https://skillicons.dev)

Claude Code is where most of the day happens. Docker for anything with more than one moving part, Supabase for hosted Postgres, GitHub for everything else. AWS is the one I am learning in public right now, which mostly means posting the parts that break before I know why.

## Itqan

My first websites were bad. I shipped them anyway, and a few are probably still online somewhere. I am not going looking.

I named the studio after itqan because it is the bar I want held against my own work, not a line for a landing page. In practice it is unglamorous: read the actual error before guessing, write the test that is allowed to fail, build the gate so it cannot quietly wave something through. Nobody claps for that part.
