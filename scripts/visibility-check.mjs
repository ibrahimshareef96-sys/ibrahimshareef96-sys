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

/** Minimal robots.txt reading: is "/" allowed for this product token? */
function robotsAllowsRoot(robotsTxt, token) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, field, value] = m;
    const key = field.toLowerCase();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === "allow" || key === "disallow")) {
        current.rules.push({ allow: key === "allow", path: value });
      }
    }
  }
  const t = token.toLowerCase();
  const group =
    groups.find((g) => g.agents.includes(t)) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  // Longest matching rule for "/" wins; an Allow beats a Disallow of equal length.
  const matching = group.rules
    .filter((r) => r.path !== "" && ["/", "/*", "/$", "*"].includes(r.path))
    .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matching.length === 0 || matching[0].allow;
}

/* ---------------------------------------------------------------- checks -- */

const results = [];
const record = (site, level, check, detail = "") => results.push({ site, level, check, detail });

async function checkSite(site) {
  const { host } = site;
  const home = `https://${host}/`;

  // 1. Home page, once per crawler: reachable, indexable, titled in <head>.
  let homeHtml = "";
  for (const c of CRAWLERS) {
    try {
      const { res, body, type } = await get(home, { ua: c.ua });
      if (!res.ok) {
        record(host, "FAIL", `home as ${c.token}`, `HTTP ${res.status}`);
        continue;
      }
      if (!type.includes("text/html")) {
        record(host, "FAIL", `home as ${c.token}`, `content-type ${type}`);
        continue;
      }
      const xRobots = res.headers.get("x-robots-tag") ?? "";
      if (/noindex|none/i.test(xRobots)) {
        record(host, "FAIL", `home as ${c.token}`, `X-Robots-Tag: ${xRobots}`);
        continue;
      }
      const head = headOf(body);
      const metaRobots = head.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
      if (/noindex|none/i.test(metaRobots)) {
        record(host, "FAIL", `home as ${c.token}`, `meta robots: ${metaRobots}`);
        continue;
      }
      const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
      if (!title) {
        record(host, "FAIL", `home as ${c.token}`, "no <title> in <head> (a crawler that does not run JavaScript sees an untitled page)");
        continue;
      }
      if (!title.includes(site.titleIncludes)) {
        record(host, "WARN", `home as ${c.token}`, `title "${title}" lacks "${site.titleIncludes}"`);
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
      const text = homeHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
      record(host, text.includes(site.nameInText) ? "PASS" : "WARN", "name in page text",
        text.includes(site.nameInText) ? `"${site.nameInText}" is readable` : `"${site.nameInText}" never appears as text`);
    }
  }

  // 3. robots.txt: a real robots file that lets every crawler we care about in.
  let sitemapUrls = [];
  try {
    const { res, body, type } = await get(`https://${host}/robots.txt`);
    if (!res.ok || !type.includes("text/plain")) {
      record(host, "FAIL", "robots.txt", `HTTP ${res.status}, ${type || "no content-type"} (not a robots file)`);
    } else {
      const blocked = CRAWLERS.filter((c) => !robotsAllowsRoot(body, c.token)).map((c) => c.token);
      record(host, blocked.length ? "FAIL" : "PASS", "robots.txt",
        blocked.length ? `blocks / for ${blocked.join(", ")}` : "allows / for every checked crawler");
      sitemapUrls = [...body.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
      if (!sitemapUrls.length) record(host, "WARN", "robots.txt", "no Sitemap: line");
    }
  } catch (e) {
    record(host, "FAIL", "robots.txt", `unreachable: ${e.message}`);
  }

  // 4. Sitemap: parses, and a sample of its URLs answer 200 without redirecting.
  const locs = [];
  for (const sm of sitemapUrls.length ? sitemapUrls : [`https://${host}/sitemap.xml`]) {
    try {
      const { res, body, type } = await get(sm);
      if (!res.ok || !/xml/.test(type)) {
        record(host, "FAIL", "sitemap", `${sm}: HTTP ${res.status}, ${type || "no content-type"}`);
        continue;
      }
      const found = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
      if (/<sitemapindex/i.test(body)) {
        for (const child of found) {
          const r = await get(child);
          locs.push(...[...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
        }
      } else {
        locs.push(...found);
      }
      const lastmods = new Set([...body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1].slice(0, 10)));
      record(host, "PASS", "sitemap", `${found.length} URLs, ${lastmods.size} distinct lastmod date(s)`);
    } catch (e) {
      record(host, "FAIL", "sitemap", `${sm}: ${e.message}`);
    }
  }
  const sample = locs.filter((_, i) => i % Math.max(1, Math.ceil(locs.length / SITEMAP_SAMPLE)) === 0).slice(0, SITEMAP_SAMPLE);
  const broken = [];
  for (const url of sample) {
    try {
      const { res } = await get(url, { redirect: "manual" });
      if (res.status !== 200) broken.push(`${new URL(url).pathname} -> ${res.status}`);
    } catch (e) {
      broken.push(`${url}: ${e.message}`);
    }
  }
  if (sample.length) {
    record(host, broken.length ? "FAIL" : "PASS", "sitemap URLs",
      broken.length ? broken.join("; ") : `${sample.length} sampled, all 200`);
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
