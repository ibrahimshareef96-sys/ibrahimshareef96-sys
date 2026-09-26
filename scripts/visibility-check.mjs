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
 *                          Redirect checks are skipped for overridden hosts. So
 *                          are the checks that pair a site with a live service
 *                          (the IndexNow submit, podcast freshness against
 *                          Apple), so a local build is never announced to, or
 *                          compared with, live data. Override that service's
 *                          host too (api.indexnow.org, itunes.apple.com) to run
 *                          those checks against a stub.
 *
 * Levels: FAIL = crawlers are blocked or misled. WARN = a signal is missing or
 * weak. Both fail the run (exit 1), except the warnings in ACCEPTED_WARNINGS
 * (a check name plus the one known case it accepts, never the whole check):
 * GitHub only notifies on a failed run, so a warning on a green run reaches
 * nobody. The report lists the accepted warnings and why each is accepted.
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
    // One index.html answers every route, so a canonical would point /terms
    // and /privacy at the home page.
    homeCanonical: false,
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
// Per request. Requests run one after another (about 25 per site), so this
// bounds even a slow site at a few minutes, inside the workflow's timeout.
const TIMEOUT_MS = 10_000;

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

// The Barakah Blueprint on Apple Podcasts (podcasts.apple.com/podcast/id1789764233).
// Apple's public lookup API lists released episodes, audio-only ones included,
// so it is the source of truth for what shareefi.co/podcast should have.
const PODCAST_APPLE_ID = "1789764233";
// Grace period, counted from each episode's release on Apple: an episode may
// be out this many days with no page before the check warns.
const PODCAST_MAX_LAG_DAYS = 7;

/**
 * Warnings that do not fail the run: a check name, why its warning is
 * accepted, and `matches`, which picks out the one accepted case. Any other
 * warning under the same name, and every other warning, fails the run, so a
 * new one reaches someone. Keep this short.
 */
const ACCEPTED_WARNINGS = new Map([
  ["http -> https", {
    why: "the proxy in front of all three sites answers http:// with a 302, not a 301; that is proxy config, outside the app code",
    // Check 6 warns only on a temporary redirect to the site's own https home
    // page (no redirect, or one to anywhere else, is a FAIL there), and only
    // the proxy's 302 is accepted.
    matches: (r) => r.detail.startsWith("302 -> "),
  }],
]);

/* --------------------------------------------------------------- helpers -- */

const ORIGINS = JSON.parse(process.env.VISIBILITY_ORIGINS || "{}");
const originFor = (host) => ORIGINS[host] ?? `https://${host}`;
const overridden = (host) => host in ORIGINS;
/** True when `host` is a local build but `service` is live: never mix the two. */
const localVsLive = (host, service) => overridden(host) && !overridden(service);
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

/**
 * An error's message, plus the cause that fetch's bare "fetch failed" hides
 * (ENOTFOUND, ECONNREFUSED, CERT_HAS_EXPIRED, a redirect loop...). The code
 * comes first: OpenSSL messages end in a newline.
 */
const why = (e) =>
  e?.cause ? `${e.message} (${String(e.cause.code ?? e.cause.message).trim()})` : String(e?.message ?? e);

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
  let unreachable = 0;
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
      unreachable++;
      record(host, "FAIL", `home as ${c.token}`, `unreachable: ${why(e)}`);
    }
  }
  // A site that never answers would spend a timeout on every remaining
  // request; one FAIL says it all, and the report still gets written.
  if (unreachable === CRAWLERS.length) {
    record(host, "FAIL", "site", "unreachable for every crawler, remaining checks skipped");
    return;
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
    // A site can opt out of having one (homeCanonical: false); a wrong one
    // still fails.
    const canonical = canonicalOf(headOf(homeHtml));
    if (!canonical && site.homeCanonical === false) {
      record(host, "PASS", "canonical", "none, by design (one app shell answers every route)");
    } else if (!canonical) {
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
    record(host, "FAIL", "robots.txt", `unreachable: ${why(e)}`);
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
      record(host, "FAIL", "sitemap", `${url}: ${why(e)}`);
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
  let uncanonical = 0;
  for (const url of sample) {
    const path = new URL(url).pathname;
    try {
      const { res } = await get(url, { redirect: "manual" });
      if (res.status !== 200) {
        broken.push(`${path} -> ${res.status}`);
        continue;
      }
      const head = headOf(await res.text());
      // Indexable for every checked crawler, as on the home page: a
      // "bingbot" meta or a "gptbot: noindex" header hides a page too.
      const xRobots = res.headers.get("x-robots-tag") ?? "";
      const noindexFor = CRAWLERS.filter((c) => blocksIndex(xRobots, c.token) || blocksIndex(metaRobots(head, c.token), c.token)).map((c) => c.token);
      if (noindexFor.length) broken.push(`${path} is noindex for ${noindexFor.join(", ")}`);
      const canonical = canonicalOf(head);
      if (!canonical) uncanonical++;
      else if (resolveUrl(canonical, url) !== resolveUrl(url)) broken.push(`${path} canonical -> ${canonical}`);
    } catch (e) {
      broken.push(`${path}: ${why(e)}`);
    }
  }
  if (sample.length) {
    const canonicals =
      uncanonical === sample.length ? "none has a canonical"
      : uncanonical ? `${uncanonical} without a canonical, the rest self-canonical`
      : "self-canonical";
    record(host, broken.length ? "FAIL" : "PASS", "sitemap URLs",
      broken.length
        ? broken.join("; ")
        : `${sample.length} of ${pages.length} sampled (slice ${offset + 1} of ${step}): all 200, indexable, ${canonicals}`);
  }

  // 5. llms.txt and the IndexNow key.
  try {
    const { res, type } = await get(`https://${host}/llms.txt`);
    record(host, res.ok && type.includes("text/plain") ? "PASS" : "WARN", "llms.txt",
      res.ok && type.includes("text/plain") ? "served" : `HTTP ${res.status}, ${type}`);
  } catch (e) {
    record(host, "WARN", "llms.txt", why(e));
  }
  let keyLive = false;
  try {
    const { res, body } = await get(`https://${host}/${site.indexNowKey}.txt`);
    keyLive = res.ok && body.trim() === site.indexNowKey;
    record(host, keyLive ? "PASS" : "WARN", "IndexNow key", keyLive ? "live" : `not live (HTTP ${res.status})`);
  } catch (e) {
    record(host, "WARN", "IndexNow key", why(e));
  }

  // 6. One host, one scheme: www and http both redirect permanently to this
  // site's https home page. A temporary redirect there is a WARN. No
  // redirect (a duplicate host), or one anywhere else (another site, a typo
  // domain), is a FAIL. "https://shareefi.co" and "https://shareefi.co/" are
  // the same target, so the Location is resolved before it is compared.
  if (!overridden(host)) {
    for (const [label, url] of [["www -> apex", `https://www.${host}/`], ["http -> https", `http://${host}/`]]) {
      try {
        const { res } = await get(url, { redirect: "manual" });
        const loc = res.headers.get("location") ?? "";
        const detail = `${res.status}${loc ? ` -> ${loc}` : ""}`;
        const onTarget = resolveUrl(loc, url) === home;
        if (onTarget && [301, 308].includes(res.status)) record(host, "PASS", label, detail);
        else if (onTarget && [302, 307].includes(res.status)) record(host, "WARN", label, `${detail} (want a 301/308)`);
        else record(host, "FAIL", label, `${detail} (want a 301/308 to ${home})`);
      } catch (e) {
        // A name of its own, so an outage is never taken for an accepted warning.
        record(host, "WARN", `${label} (unreachable)`, why(e));
      }
    }
  }

  // 6b. Soft 404: a path that cannot exist must not answer 200. An app shell
  // that answers every path with 200 lets junk URLs into the index. WARN, not
  // FAIL: it hurts quality, it does not block crawling. Redirects are
  // followed: a 308 to the trailing-slash form that then answers 404 is fine,
  // a redirect to the home page (200) is the soft 404 this looks for.
  try {
    const probe = `https://${host}/visibility-check-no-such-page-${Date.now()}`;
    const { res } = await get(probe);
    const ok = (res.status === 404 || res.status === 410) && new URL(res.url).origin === homeOrigin;
    const detail = `HTTP ${res.status}${res.redirected ? ` at ${res.url}, after a redirect` : ""}`;
    record(host, ok ? "PASS" : "WARN", "unknown path",
      ok ? detail : `${detail} (soft 404: want 404 for a page that does not exist)`);
  } catch (e) {
    record(host, "WARN", "unknown path", why(e));
  }

  // 7. Optional: tell IndexNow about every URL. Fails closed without a live
  // key, and never announces a local build or URLs that just failed. Only
  // this host's URLs go in: one foreign URL makes IndexNow reject the batch.
  if (process.env.SUBMIT_INDEXNOW === "true" && !localVsLive(host, new URL(INDEXNOW_ENDPOINT).host)) {
    const urlList = pages.slice(0, 10_000);
    if (!keyLive) {
      record(host, "WARN", "IndexNow submit", "skipped: key file is not live");
    } else if (!urlList.length) {
      record(host, "WARN", "IndexNow submit", `skipped: no sitemap URLs on https://${host}`);
    } else if (broken.length) {
      record(host, "WARN", "IndexNow submit", `skipped: ${broken.length} sampled sitemap URL(s) are broken`);
    } else {
      try {
        const res = await fetch(toFetchable(INDEXNOW_ENDPOINT), {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            host,
            key: site.indexNowKey,
            keyLocation: `https://${host}/${site.indexNowKey}.txt`,
            urlList,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const detail = `${urlList.length} URLs -> HTTP ${res.status}`;
        // 200 accepted, 202 accepted while the key is validated, 429 rate
        // limited (try later); anything else is a rejection with a reason.
        if (res.status === 200 || res.status === 202) {
          record(host, "PASS", "IndexNow submit", detail);
        } else if (res.status === 429) {
          record(host, "WARN", "IndexNow submit", `${detail}, rate limited, retry after ${res.headers.get("retry-after") ?? "a while"}`);
        } else {
          record(host, "FAIL", "IndexNow submit", `${detail}: ${(await res.text()).trim().slice(0, 200) || "no reason given"}`);
        }
      } catch (e) {
        record(host, "FAIL", "IndexNow submit", `request failed: ${why(e)}`);
      }
    }
  }
}

/* ------------------------------------------------------ podcast freshness -- */

/**
 * A released episode with no /podcast/<number>-<slug> page on shareefi.co is
 * invisible to search and AI answers, and it is another absence nobody checks.
 * Match each of Apple's newest episodes to a page in the live sitemap by its
 * episode number ("EP44 - ..." on Apple, /podcast/44-... on the site), and
 * warn once one has been out on Apple for PODCAST_MAX_LAG_DAYS, counted from
 * its own release, with no page. Dates cannot be compared instead: the site
 * dates an episode by its YouTube release, weeks away from Apple's.
 */
async function checkPodcastFreshness() {
  const check = "podcast freshness";
  if (localVsLive("shareefi.co", "itunes.apple.com")) return; // a local build says nothing about what is live
  let stage = "shareefi.co sitemap";
  try {
    const { res: sitemapRes, body: top } = await get("https://shareefi.co/sitemap.xml");
    if (!sitemapRes.ok) throw new Error(`HTTP ${sitemapRes.status}`);
    // Follow a sitemap index to its children. A broken child is already a
    // FAIL in the sitemap check, so here it only contributes nothing.
    let sitemap = top;
    if (/<sitemapindex[\s>]/i.test(top)) {
      sitemap = "";
      for (const m of top.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        sitemap += await get(m[1]).then(({ res, body }) => (res.ok ? body : ""), () => "");
      }
    }
    // Episode pages are /podcast/42-some-slug; /podcast/guests/... are not episodes.
    const pageNumbers = new Set(
      [...sitemap.matchAll(/<loc>\s*https:\/\/shareefi\.co\/podcast\/(\d+)-[^/<\s]+\/?\s*<\/loc>/g)].map((m) => Number(m[1])),
    );
    if (!pageNumbers.size) throw new Error("no /podcast/<number>-<slug> URL");

    stage = "Apple lookup";
    const { res, body } = await get(
      `https://itunes.apple.com/lookup?id=${PODCAST_APPLE_ID}&media=podcast&entity=podcastEpisode&limit=10`,
      { ua: "visibility-check" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const released = (JSON.parse(body).results ?? [])
      .filter((r) => (r.kind === "podcast-episode" || r.wrapperType === "podcastEpisode") && r.releaseDate)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
      .map((r) => ({
        title: r.trackName,
        date: r.releaseDate.slice(0, 10),
        releasedAt: Date.parse(r.releaseDate),
        // "EP44 - ...", "Episode 44: ...", "Ep. #44 ..."; null when the title has no number.
        number: Number(String(r.trackName).match(/\bep(?:isode)?\.?\s*#?(\d+)/i)?.[1]) || null,
      }));
    if (!released.length) throw new Error("no episodes in the response");

    const list = (episodes) => episodes.map((e) => `${e.date} "${e.title}"`).join("; ");
    const unnumbered = released.filter((e) => e.number === null);
    if (unnumbered.length === released.length) {
      // A title format without the number would otherwise pass forever.
      record("shareefi.co", "WARN", check, `no episode number in any Apple title, so none can be matched to a page: ${list(released.slice(0, 3))}`);
      return;
    }
    const cutoff = Date.now() - PODCAST_MAX_LAG_DAYS * 86_400_000;
    const missing = released.filter((e) => e.number !== null && !pageNumbers.has(e.number));
    const overdue = missing.filter((e) => e.releasedAt <= cutoff);
    const scope = unnumbered.length
      ? `the ${released.length - unnumbered.length} numbered episodes among Apple's ${released.length} newest`
      : `Apple's ${released.length} newest episodes`;
    const unchecked = unnumbered.length ? `; ${unnumbered.length} without an episode number not checked: ${list(unnumbered)}` : "";
    if (overdue.length) {
      record("shareefi.co", "WARN", check,
        `out on Apple for over ${PODCAST_MAX_LAG_DAYS} days with no /podcast/<number>- page, newest first: ${list(overdue)}${unchecked}`);
    } else {
      record("shareefi.co", "PASS", check,
        (missing.length
          ? `${scope}: ${missing.length} with no page yet, inside the ${PODCAST_MAX_LAG_DAYS}-day grace from release: ${list(missing)}`
          : `${scope} all have a page`) + unchecked);
    }
  } catch (e) {
    // Never pass on a failed lookup: a flake that hides a missing page is the
    // absence this check exists for.
    record("shareefi.co", "WARN", check, `${stage} failed: ${why(e)}`);
  }
}

/* ---------------------------------------------------------------- report -- */

for (const site of SITES) {
  // One site's crash must not cut the report short for the others.
  try {
    await checkSite(site);
  } catch (e) {
    record(site.host, "FAIL", "check crashed", why(e));
  }
}
await checkPodcastFreshness();

const accepted = (r) => r.level === "WARN" && (ACCEPTED_WARNINGS.get(r.check)?.matches(r) ?? false);
const fails = results.filter((r) => r.level === "FAIL").length;
const warns = results.filter((r) => r.level === "WARN").length;
const unaccepted = results.filter((r) => r.level === "WARN" && !accepted(r)).length;
const summary = `${fails} failing, ${warns} warnings (${unaccepted} not accepted), ${results.length - fails - warns} passing.`;

const ICON = { PASS: "✅", WARN: "⚠️", FAIL: "❌" };
// One table row per result: a newline in a detail (a multi-line <title>, an
// episode title, a rejection body) would split the row.
const cell = (s) => String(s).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
const lines = [
  "## Visibility check",
  "",
  `Run ${new Date().toISOString()}. ❌ = crawlers blocked or misled. ⚠️ = a missing or weak signal. Both fail the run, except the accepted warnings listed below.`,
  "",
  "| Site | | Check | Detail |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.site} | ${ICON[r.level]} | ${cell(r.check)}${accepted(r) ? " (accepted)" : ""} | ${cell(r.detail)} |`),
  "",
  "Accepted warnings (reported, do not fail the run):",
  "",
  ...[...ACCEPTED_WARNINGS].map(([check, accept]) => `- ${check}: ${accept.why}`),
  "",
  summary,
];
const markdown = lines.join("\n");
console.log(markdown);
// The step summary renders HTML, so "no <link rel=canonical>" would lose its
// tag there; escape it. The log keeps the plain text.
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown.replace(/</g, "&lt;") + "\n");

process.exit(fails || unaccepted ? 1 : 0);
