#!/usr/bin/env node
/**
 * Visibility check: crawls the live sites the way search and AI crawlers do,
 * and fails loudly when something would stop them.
 *
 * Why this exists: a crawl block is an absence. Nothing errors, traffic just
 * never arrives, and nobody checks an absence. This runs daily in CI and turns
 * the absence into a red build.
 *
 *   node scripts/visibility-check.mjs
 *
 * Env:
 *   SUBMIT_INDEXNOW=true   also submit every sitemap URL to IndexNow (Bing,
 *                          Yandex, Seznam, Naver, Yep) for each site whose key
 *                          file is live. Off by default: IndexNow is for
 *                          telling engines about changes, not a daily blast.
 *   VISIBILITY_ORIGINS     JSON map of host -> origin, to point the check at a
 *                          local build, e.g. {"shareefi.co":"http://localhost:3012"}.
 *                          Redirect checks are skipped for overridden hosts.
 *
 * Levels: FAIL = crawlers are blocked or misled (exits 1). WARN = a signal is
 * missing or weak (reported, does not fail the run).
 */

import { appendFileSync } from "node:fs";

/* ---------------------------------------------------------------- config -- */

const PERSON_ID = "https://shareefi.co/#person";

const SITES = [
  {
    host: "shareefi.co",
    titleIncludes: "Ibrahim Shareef",
    nameInText: "Ibrahim Shareef",
    indexNowKey: "d0e9e916ece615af996965b082904092",
    entity: (nodes) =>
      nodes.some(
        (n) =>
          hasType(n, "Person") &&
          n["@id"] === PERSON_ID &&
          n.name === "Ibrahim Shareef" &&
          Array.isArray(n.sameAs) &&
          n.sameAs.length >= 5,
      ) || `no Person node ${PERSON_ID} named "Ibrahim Shareef" with 5+ sameAs links`,
  },
  {
    host: "itqanstudio.com",
    titleIncludes: "Itqan",
    nameInText: "Ibrahim Shareef",
    indexNowKey: "6bd42839add7a68fecb11bc425290ad5",
    entity: (nodes) =>
      nodes.some(
        (n) =>
          hasType(n, "Person") &&
          n.name === "Ibrahim Shareef" &&
          [].concat(n.sameAs ?? []).some((u) => String(u).startsWith("https://shareefi.co")),
      ) || "the founder Person does not link to shareefi.co in sameAs",
  },
  {
    host: "projectyou.app",
    titleIncludes: "Project You",
    nameInText: null, // client-rendered; the name lives in JSON-LD + <noscript>
    indexNowKey: "bdbc493db1edca63208e9dd953eb5dd7",
    entity: (nodes) =>
      JSON.stringify(nodes).includes(`"${PERSON_ID}"`) ||
      `nothing references the creator ${PERSON_ID}`,
  },
];

/** Crawlers whose view of the site matters. Token = robots.txt product token. */
const CRAWLERS = [
  { token: "Googlebot", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { token: "Bingbot", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { token: "OAI-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot" },
  { token: "GPTBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)" },
  { token: "ClaudeBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { token: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
];

const SITEMAP_SAMPLE = 12;
const TIMEOUT_MS = 20_000;

/* --------------------------------------------------------------- helpers -- */

const ORIGINS = JSON.parse(process.env.VISIBILITY_ORIGINS || "{}");
const originFor = (host) => ORIGINS[host] ?? `https://${host}`;
const overridden = (host) => host in ORIGINS;
/** Map a public URL onto the (possibly overridden) origin for its host. */
const toFetchable = (url) => {
  const u = new URL(url);
  return overridden(u.host) ? originFor(u.host) + u.pathname + u.search : url;
};

function hasType(node, type) {
  return [].concat(node?.["@type"] ?? []).includes(type);
}

async function get(url, { ua = CRAWLERS[0].ua, redirect = "follow" } = {}) {
  const res = await fetch(toFetchable(url), {
    redirect,
    headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = redirect === "manual" ? "" : await res.text();
  return { res, body, type: res.headers.get("content-type") ?? "" };
}

/** The document head, or the empty string when there is none. */
const headOf = (html) => {
  const end = html.search(/<\/head>/i);
  return end < 0 ? "" : html.slice(0, end);
};

/** An absolute URL for `href` against `base`, or "" when it does not parse. */
const resolveUrl = (href, base) => {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
};

/** The value of one attribute in one HTML tag (any quoting, any order), or undefined. */
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

const tagsIn = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);

/** The href of <link rel="canonical"> in a head, or "" when there is none. */
const canonicalOf = (head) => {
  const link = tagsIn(head, "link").find((t) => /(^|\s)canonical(\s|$)/i.test(attr(t, "rel") ?? ""));
  return link ? (attr(link, "href") ?? "") : "";
};

/**
 * The meta robots directives in a head that apply to one crawler: those in
 * <meta name="robots"> plus those in <meta name="<token>">, e.g. "googlebot".
 */
const metaRobots = (head, token) =>
  tagsIn(head, "meta")
    .filter((t) => ["robots", token.toLowerCase()].includes((attr(t, "name") ?? "").toLowerCase()))
    .map((t) => attr(t, "content") ?? "")
    .join(", ");

/**
 * Does a directive list (meta robots content or X-Robots-Tag) tell this
 * crawler not to index? "bingbot: noindex" scopes what follows to one
 * crawler, and "max-image-preview:none" is a preview limit, not a noindex.
 */
function blocksIndex(directives, token) {
  let scope = null;
  for (const raw of directives.split(",")) {
    let d = raw.trim().toLowerCase();
    const m = d.match(/^([a-z_-]+)\s*:\s*(.*)$/);
    if (m && !/^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/.test(m[1])) {
      scope = m[1];
      d = m[2];
    }
    if ((!scope || scope === token.toLowerCase()) && (d === "noindex" || d === "none")) return true;
  }
  return false;
}

function jsonLdNodes(html) {
  const nodes = [];
  const errors = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const doc = JSON.parse(m[1]);
      for (const d of [].concat(doc)) nodes.push(...(d["@graph"] ?? [d]));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { nodes, errors };
}

/**
 * robots.txt reading per RFC 9309: may this product token fetch this path?
 * Every group naming the token is merged (else every "*" group), only an
 * Allow/Disallow line ends a run of User-agent lines (Sitemap, Crawl-delay
 * and the like do not), "Googlebot/2.1" names Googlebot, and the longest
 * matching rule wins, with Allow winning a tie. `*` and a trailing `$` work
 * as wildcards.
 */
function robotsAllows(robotsTxt, token, path = "/") {
  const groups = [];
  let current = null;
  let inAgents = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const m = raw.replace(/#.*$/, "").trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!inAgents) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase().match(/^[a-z_*-]+/)?.[0] ?? "");
      inAgents = true;
    } else if (key === "allow" || key === "disallow") {
      inAgents = false;
      if (current && value) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const t = token.toLowerCase();
  let picked = groups.filter((g) => g.agents.includes(t));
  if (!picked.length) picked = groups.filter((g) => g.agents.includes("*"));
  const toRe = (p) =>
    new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$"));
  const hits = picked
    .flatMap((g) => g.rules)
    .filter((r) => toRe(r.path).test(path))
    .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return hits.length === 0 || hits[0].allow;
}

/* ---------------------------------------------------------------- checks -- */

const results = [];
const record = (site, level, check, detail = "") => results.push({ site, level, check, detail });

async function checkSite(site) {
  const { host } = site;
  const home = `https://${host}/`;
  /** Is this URL on this site (https, this exact host)? */
  const onHost = (url) => resolveUrl(url).startsWith(`https://${host}/`);

  // 1. Home page, once per crawler: reachable on this host, indexable, and
  // titled in <head>. All three sites sit behind one proxy, so a misrouted
  // host can answer with another site's (valid, indexable) page: the final
  // origin and the title are what show the right app answered.
  const homeOrigin = new URL(toFetchable(home)).origin;
  let homeHtml = "";
  for (const c of CRAWLERS) {
    try {
      const { res, body, type } = await get(home, { ua: c.ua });
      if (!res.ok) {
        record(host, "FAIL", `home as ${c.token}`, `HTTP ${res.status}`);
        continue;
      }
      if (new URL(res.url).origin !== homeOrigin) {
        record(host, "FAIL", `home as ${c.token}`, `redirected off the site: ended on ${res.url}`);
        continue;
      }
      if (!type.includes("text/html")) {
        record(host, "FAIL", `home as ${c.token}`, `content-type ${type}`);
        continue;
      }
      const xRobots = res.headers.get("x-robots-tag") ?? "";
      if (blocksIndex(xRobots, c.token)) {
        record(host, "FAIL", `home as ${c.token}`, `X-Robots-Tag: ${xRobots}`);
        continue;
      }
      const head = headOf(body);
      const robotsMeta = metaRobots(head, c.token);
      if (blocksIndex(robotsMeta, c.token)) {
        record(host, "FAIL", `home as ${c.token}`, `meta robots: ${robotsMeta}`);
        continue;
      }
      const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
      if (!title) {
        record(host, "FAIL", `home as ${c.token}`, "no <title> in <head> (a crawler that does not run JavaScript sees an untitled page)");
        continue;
      }
      if (!title.includes(site.titleIncludes)) {
        record(host, "FAIL", `home as ${c.token}`, `title "${title}" lacks "${site.titleIncludes}" (is another app answering?)`);
      } else {
        record(host, "PASS", `home as ${c.token}`, `200, title in <head>`);
      }
      if (!/<meta[^>]+name=["']description["']/i.test(head)) {
        record(host, "WARN", `description as ${c.token}`, "no meta description in <head>");
      }
      if (c.token === "Googlebot") homeHtml = body;
    } catch (e) {
      record(host, "FAIL", `home as ${c.token}`, `unreachable: ${e.message}`);
    }
  }

  // 2. Entity: the structured data joins this site to Ibrahim Shareef.
  if (homeHtml) {
    const { nodes, errors } = jsonLdNodes(homeHtml);
    if (errors.length) record(host, "FAIL", "structured data", `JSON-LD does not parse: ${errors[0]}`);
    const verdict = site.entity(nodes);
    record(host, verdict === true ? "PASS" : "WARN", "entity link", verdict === true ? `${nodes.length} JSON-LD nodes` : verdict);
    if (site.nameInText) {
      // Body text only: the <title> is checked above, and counting it here
      // would let this pass on a page whose visible text never names him.
      const bodyStart = homeHtml.search(/<body[\s>]/i);
      const bodyHtml = bodyStart >= 0 ? homeHtml.slice(bodyStart) : homeHtml.slice(headOf(homeHtml).length);
      const text = bodyHtml
        .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/\s+/g, " ");
      record(host, text.includes(site.nameInText) ? "PASS" : "WARN", "name in page text",
        text.includes(site.nameInText) ? `"${site.nameInText}" is readable` : `"${site.nameInText}" never appears in the body text`);
    }
    // The canonical tells Google which URL (and host) this page belongs to.
    const canonical = canonicalOf(headOf(homeHtml));
    if (!canonical) {
      record(host, "WARN", "canonical", "no <link rel=canonical> on the home page");
    } else if (resolveUrl(canonical, home) !== home) {
      record(host, "FAIL", "canonical", `home page canonical is ${canonical}, not ${home}`);
    } else {
      record(host, "PASS", "canonical", canonical);
    }
  }

  // 3. robots.txt: a real robots file that lets every crawler we care about in.
  let sitemapUrls = [];
  let robotsTxt = null;
  try {
    const { res, body, type } = await get(`https://${host}/robots.txt`);
    if (!res.ok || !type.includes("text/plain")) {
      record(host, "FAIL", "robots.txt", `HTTP ${res.status}, ${type || "no content-type"} (not a robots file)`);
    } else {
      robotsTxt = body;
      const blocked = CRAWLERS.filter((c) => !robotsAllows(body, c.token, "/")).map((c) => c.token);
      record(host, blocked.length ? "FAIL" : "PASS", "robots.txt",
        blocked.length ? `blocks / for ${blocked.join(", ")}` : "allows / for every checked crawler");
      sitemapUrls = [...body.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
      if (!sitemapUrls.length) record(host, "WARN", "robots.txt", "no Sitemap: line");
    }
  } catch (e) {
    record(host, "FAIL", "robots.txt", `unreachable: ${e.message}`);
  }

  // 4. Sitemap: every sitemap file (and every child of a sitemap index) is XML
  // served from this host, and together they list page URLs on this host that
  // robots.txt lets every crawler fetch. A sample of those URLs answer 200
  // without redirecting, are indexable, and name themselves as canonical.
  let sitemapsOk = true;
  /** One sitemap file's body, or "" (after recording a FAIL) when it is not usable. */
  const readSitemap = async (url) => {
    try {
      if (!onHost(url)) throw new Error(`not on https://${host}`);
      const { res, body, type } = await get(url);
      if (res.ok && /xml/.test(type)) return body;
      throw new Error(`HTTP ${res.status}, ${type || "no content-type"}`);
    } catch (e) {
      sitemapsOk = false;
      record(host, "FAIL", "sitemap", `${url}: ${e.message}`);
      return "";
    }
  };
  const locsIn = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const found = [];
  const lastmods = new Set();
  for (const sm of sitemapUrls.length ? sitemapUrls : [`https://${host}/sitemap.xml`]) {
    const xml = await readSitemap(sm);
    // A sitemap index lists child sitemaps, not pages: read each child.
    const urlsets = /<sitemapindex[\s>]/i.test(xml) ? [] : [xml];
    if (!urlsets.length) for (const child of locsIn(xml)) urlsets.push(await readSitemap(child));
    for (const set of urlsets) {
      found.push(...locsIn(set));
      for (const m of set.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/g)) lastmods.add(m[1].slice(0, 10));
    }
  }
  const locs = [...new Set(found)];
  if (!locs.length) {
    record(host, "FAIL", "sitemap", "no page URLs in any sitemap");
  } else if (sitemapsOk) {
    record(host, "PASS", "sitemap", `${locs.length} page URLs, ${lastmods.size} distinct lastmod date(s)`);
  }
  const pages = locs.filter(onHost);
  if (locs.length) {
    const foreign = locs.filter((u) => !onHost(u));
    record(host, foreign.length ? "FAIL" : "PASS", "sitemap hosts",
      foreign.length ? `${foreign.length} URL(s) not on https://${host}, e.g. ${foreign[0]}` : `every URL is on https://${host}`);
  }
  if (robotsTxt !== null && pages.length) {
    const disallowed = pages.flatMap((u) => {
      const { pathname, search } = new URL(u);
      const blocked = CRAWLERS.filter((c) => !robotsAllows(robotsTxt, c.token, pathname + search)).map((c) => c.token);
      return blocked.length ? [`${pathname}${search} (${blocked.join(", ")})`] : [];
    });
    record(host, disallowed.length ? "FAIL" : "PASS", "sitemap vs robots",
      disallowed.length
        ? `${disallowed.length} sitemap URL(s) disallowed: ${disallowed.slice(0, 5).join("; ")}`
        : `${pages.length} URLs allowed for every checked crawler`);
  }
  // The sample moves one slot each day, so every URL is checked within `step` days.
  const step = Math.max(1, Math.ceil(pages.length / SITEMAP_SAMPLE));
  const offset = Math.floor(Date.now() / 86_400_000) % step;
  const sample = pages.filter((_, i) => i % step === offset).slice(0, SITEMAP_SAMPLE);
  const broken = [];
  for (const url of sample) {
    const path = new URL(url).pathname;
    try {
      const { res } = await get(url, { redirect: "manual" });
      if (res.status !== 200) {
        broken.push(`${path} -> ${res.status}`);
        continue;
      }
      const head = headOf(await res.text());
      const noindex = [res.headers.get("x-robots-tag") ?? "", metaRobots(head, "Googlebot")].find((d) => blocksIndex(d, "Googlebot"));
      if (noindex) broken.push(`${path} is noindex (${noindex})`);
      const canonical = canonicalOf(head);
      if (canonical && resolveUrl(canonical, url) !== resolveUrl(url)) broken.push(`${path} canonical -> ${canonical}`);
    } catch (e) {
      broken.push(`${path}: ${e.message}`);
    }
  }
  if (sample.length) {
    record(host, broken.length ? "FAIL" : "PASS", "sitemap URLs",
      broken.length
        ? broken.join("; ")
        : `${sample.length} of ${pages.length} sampled (slice ${offset + 1} of ${step}): all 200, indexable, self-canonical`);
  }

  // 5. llms.txt and the IndexNow key.
  try {
    const { res, type } = await get(`https://${host}/llms.txt`);
    record(host, res.ok && type.includes("text/plain") ? "PASS" : "WARN", "llms.txt",
      res.ok && type.includes("text/plain") ? "served" : `HTTP ${res.status}, ${type}`);
  } catch (e) {
    record(host, "WARN", "llms.txt", e.message);
  }
  let keyLive = false;
  try {
    const { res, body } = await get(`https://${host}/${site.indexNowKey}.txt`);
    keyLive = res.ok && body.trim() === site.indexNowKey;
    record(host, keyLive ? "PASS" : "WARN", "IndexNow key", keyLive ? "live" : `not live (HTTP ${res.status})`);
  } catch (e) {
    record(host, "WARN", "IndexNow key", e.message);
  }

  // 6. One host, one scheme: www and http both redirect permanently.
  if (!overridden(host)) {
    for (const [label, url] of [["www -> apex", `https://www.${host}/`], ["http -> https", `http://${host}/`]]) {
      try {
        const { res } = await get(url, { redirect: "manual" });
        const loc = res.headers.get("location") ?? "";
        const permanent = [301, 308].includes(res.status);
        const ok = permanent && loc.startsWith(`https://${host}`);
        record(host, ok ? "PASS" : "WARN", label,
          ok ? `${res.status} -> ${loc}` : `${res.status}${loc ? ` -> ${loc}` : ""} (want a 301/308 to https://${host})`);
      } catch (e) {
        record(host, "WARN", label, e.message);
      }
    }
  }

  // 6b. Soft 404: a path that cannot exist must not answer 200. An app shell
  // that answers every path with 200 lets junk URLs into the index. WARN, not
  // FAIL: it hurts quality, it does not block crawling.
  try {
    const probe = `https://${host}/visibility-check-no-such-page-${Date.now()}`;
    const { res } = await get(probe, { redirect: "manual" });
    const ok = res.status === 404 || res.status === 410;
    record(host, ok ? "PASS" : "WARN", "unknown path",
      ok ? `HTTP ${res.status}` : `HTTP ${res.status} (soft 404: want 404 for a page that does not exist)`);
  } catch (e) {
    record(host, "WARN", "unknown path", e.message);
  }

  // 7. Optional: tell IndexNow about every URL. Fails closed without a live key.
  if (process.env.SUBMIT_INDEXNOW === "true") {
    if (!keyLive) {
      record(host, "WARN", "IndexNow submit", "skipped: key file is not live");
    } else if (!locs.length) {
      record(host, "WARN", "IndexNow submit", "skipped: no sitemap URLs");
    } else {
      const res = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host,
          key: site.indexNowKey,
          keyLocation: `https://${host}/${site.indexNowKey}.txt`,
          urlList: locs.slice(0, 10_000),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ok = res.status === 200 || res.status === 202;
      record(host, ok ? "PASS" : "FAIL", "IndexNow submit", `${locs.length} URLs -> HTTP ${res.status}`);
    }
  }
}

/* ---------------------------------------------------------------- report -- */

for (const site of SITES) await checkSite(site);

const ICON = { PASS: "✅", WARN: "⚠️", FAIL: "❌" };
const lines = [
  "## Visibility check",
  "",
  `Run ${new Date().toISOString()}. ❌ = crawlers blocked or misled (fails the run). ⚠️ = a missing or weak signal.`,
  "",
  "| Site | | Check | Detail |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.site} | ${ICON[r.level]} | ${r.check} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
];
const markdown = lines.join("\n");
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");

const fails = results.filter((r) => r.level === "FAIL").length;
const warns = results.filter((r) => r.level === "WARN").length;
console.log(`\n${fails} failing, ${warns} warnings, ${results.length - fails - warns} passing.`);
process.exit(fails ? 1 : 0);
