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
 *   VISIBILITY_REPORT      a file path: the markdown report is also written
 *                          there (the workflow files it as a GitHub issue).
 *
 * Levels: FAIL = crawlers are blocked or misled. WARN = a signal is missing or
 * weak. Both fail the run (exit 1), except the warnings in ACCEPTED_WARNINGS
 * (a check name plus the one known case it accepts, never the whole check):
 * GitHub only notifies on a failed run, so a warning on a green run reaches
 * nobody. The report lists the accepted warnings and why each is accepted.
 */

import { appendFileSync, writeFileSync } from "node:fs";

/* ---------------------------------------------------------------- config -- */

const PERSON_ID = "https://shareefi.co/#person";
const ORG_ID = "https://itqanstudio.com/#organization";
const LINKEDIN = "https://www.linkedin.com/in/shareefibrahim/";

/**
 * The entity joins each site must carry, checked as typed nodes rather than as
 * strings anywhere in the JSON: the same person @id on every site, the studio
 * as one Organization @id, and each relationship pointing at the other's @id.
 * Each check returns true, or what is missing.
 */
const SITES = [
  {
    host: "shareefi.co",
    titleIncludes: "Ibrahim Shareef",
    nameInText: "Ibrahim Shareef",
    // The page that answers "who is Ibrahim Shareef": fetched as every crawler.
    keyPages: ["/about"],
    indexNowKey: "d0e9e916ece615af996965b082904092",
    entity: (nodes) => {
      const person = entityById(nodes, PERSON_ID, "Person");
      if (!person?.name?.includes("Ibrahim Shareef")) return `no Person node ${PERSON_ID} named "Ibrahim Shareef"`;
      if (!ids(person.sameAs).includes(LINKEDIN)) return `Person.sameAs lacks his LinkedIn (${LINKEDIN})`;
      if (!ids(person.worksFor).includes(ORG_ID)) return `Person.worksFor does not point at ${ORG_ID}`;
      const org = entityById(nodes, ORG_ID, "Organization");
      if (!org || !ids(org.founder).includes(PERSON_ID)) return `no Organization ${ORG_ID} whose founder includes ${PERSON_ID}`;
      return true;
    },
  },
  {
    host: "itqanstudio.com",
    titleIncludes: "Itqan",
    nameInText: "Ibrahim Shareef",
    keyPages: ["/about"],
    indexNowKey: "6bd42839add7a68fecb11bc425290ad5",
    entity: (nodes) => {
      const org = entityById(nodes, ORG_ID, "Organization");
      if (!org) return `no Organization node ${ORG_ID}`;
      if (!ids(org.founder).includes(PERSON_ID)) return `Organization.founder does not include ${PERSON_ID}`;
      const person = entityById(nodes, PERSON_ID, "Person");
      if (!person?.name?.includes("Ibrahim Shareef")) return `no Person node ${PERSON_ID} named "Ibrahim Shareef"`;
      if (!ids(person.sameAs).some((u) => u.startsWith("https://shareefi.co"))) return "the founder Person does not link to shareefi.co in sameAs";
      return true;
    },
  },
  {
    host: "projectyou.app",
    titleIncludes: "Project You",
    nameInText: null, // client-rendered; the name lives in JSON-LD + <noscript>
    // One index.html answers every route, so a canonical would point /terms
    // and /privacy at the home page.
    homeCanonical: false,
    keyPages: [],
    indexNowKey: "bdbc493db1edca63208e9dd953eb5dd7",
    entity: (nodes) => {
      const apps = nodes.filter((n) => hasType(n, "WebApplication") || hasType(n, "SoftwareApplication"));
      if (!apps.length) return "no WebApplication node";
      if (!apps.some((a) => ids(a.creator).includes(PERSON_ID))) return `the app's creator is not ${PERSON_ID}`;
      if (!apps.some((a) => ids(a.publisher).includes(ORG_ID))) return `the app's publisher is not ${ORG_ID}`;
      return true;
    },
  },
];

/**
 * Crawlers whose view of the site matters. Token = robots.txt product token.
 * The search crawlers build the indexes assistants answer from; the "-User"
 * agents fetch a page live when someone asks an assistant about it. Strings
 * are the vendors' documented ones (checked 2026-09-27: OpenAI's and
 * Perplexity's bot pages). Anthropic documents its tokens but not full
 * strings, so its three follow the ClaudeBot format around each token.
 */
const CRAWLERS = [
  { token: "Googlebot", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
  { token: "Bingbot", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
  { token: "OAI-SearchBot", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot" },
  { token: "ChatGPT-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" },
  { token: "GPTBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot" },
  { token: "ClaudeBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { token: "Claude-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +claudebot@anthropic.com)" },
  { token: "Claude-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)" },
  { token: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  { token: "Perplexity-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)" },
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
// Released episodes with no page on purpose, and why. Every other released
// episode must have one. When one of these gets a page, the check says so, so
// the entry is removed rather than left to hide a future gap.
const EPISODES_WITHOUT_PAGE = new Map([
  [12, "audio only: released on Apple and Spotify, never on YouTube"],
]);
// Apple episodes with no number in the title (a trailer, a bonus) cannot be
// matched to a /podcast/<number>- page, so each one warns once past the grace
// period until its Apple id (trackId) is listed here with the reason, or the
// title gets its number. Empty: every episode so far is numbered.
const UNNUMBERED_WITHOUT_PAGE = new Map([]);

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

/**
 * What a JSON-LD property points at, one value or a list: plain strings (a
 * sameAs URL) as they are, nodes by their @id. A node without an @id counts
 * for nothing, so a join cannot pass on a name alone.
 */
const ids = (value) =>
  [].concat(value ?? []).map((v) => (typeof v === "string" ? v : v?.["@id"] ?? "")).filter(Boolean);

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

/**
 * Markup text as the parser reads it: HTML attribute values and XML <loc>
 * values write "&" as "&amp;". Decoded on both sides, a sitemap URL and a
 * canonical compare as the same URL. "&amp;" goes last, so "&amp;lt;" stays "&lt;".
 */
const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'")
    .replace(/&amp;/g, "&");

/** The value of one attribute in one HTML tag (any quoting, any order), decoded, or undefined. */
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : undefined;
};

const tagsIn = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);

/** The text of the <title> in a head, or "" when there is none. */
const titleOf = (head) => head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";

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

/**
 * Every typed node in the page's JSON-LD, nested ones included: a Person's
 * worksFor may be a whole Organization node rather than a reference to one.
 */
function jsonLdNodes(html) {
  const nodes = [];
  const errors = [];
  const collect = (value) => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (!value || typeof value !== "object") return;
    if (value["@type"]) nodes.push(value);
    for (const [key, child] of Object.entries(value)) if (key !== "@context") collect(child);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collect(JSON.parse(m[1]));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { nodes, errors };
}

/**
 * One entity as JSON-LD sees it: every node of this type with this @id is the
 * same thing, so their properties add up (a full node on the page and a
 * nested copy under someone's worksFor). Each property comes back as a list.
 * null when no node has the @id.
 */
function entityById(nodes, id, type) {
  const parts = nodes.filter((n) => n["@id"] === id && hasType(n, type));
  if (!parts.length) return null;
  // No prototype: the keys come from remote JSON, and a "__proto__" key must
  // stay an ordinary property.
  const merged = Object.create(null);
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) merged[key] = [...(merged[key] ?? []), ...[].concat(value)];
  }
  return merged;
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

/**
 * Fetch one page as one crawler and judge it the way that crawler would: it
 * answers 200 on the expected origin, it is HTML, nothing tells this crawler
 * not to index it (X-Robots-Tag or meta robots, its own token included), and
 * it has a <title> in <head>. Returns { problem } or { head, body, title }.
 * A network error is thrown, so the caller can tell "down" from "wrong".
 */
async function crawlPage(url, crawler, expectOrigin) {
  const { res, body, type } = await get(url, { ua: crawler.ua });
  if (!res.ok) return { problem: `HTTP ${res.status}` };
  if (new URL(res.url).origin !== expectOrigin) return { problem: `redirected off the site: ended on ${res.url}` };
  if (!type.includes("text/html")) return { problem: `content-type ${type || "none"}` };
  const xRobots = res.headers.get("x-robots-tag") ?? "";
  if (blocksIndex(xRobots, crawler.token)) return { problem: `X-Robots-Tag: ${xRobots}` };
  const head = headOf(body);
  const robotsMeta = metaRobots(head, crawler.token);
  if (blocksIndex(robotsMeta, crawler.token)) return { problem: `meta robots: ${robotsMeta}` };
  const title = titleOf(head);
  if (!title) return { problem: "no <title> in <head> (a crawler that does not run JavaScript sees an untitled page)" };
  return { head, body, title };
}

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
      const { problem, head, body, title } = await crawlPage(home, c, homeOrigin);
      if (problem) {
        record(host, "FAIL", `home as ${c.token}`, problem);
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

  // 2b. The pages that answer "who is Ibrahim Shareef", fetched as every
  // crawler (the sitemap sample below fetches as Googlebot only): each must
  // answer, be indexable, be titled in <head> and name itself as canonical.
  for (const path of site.keyPages ?? []) {
    const url = new URL(path, home).href;
    const problems = [];
    for (const c of CRAWLERS) {
      try {
        const page = await crawlPage(url, c, homeOrigin);
        if (page.problem) {
          problems.push(`${c.token}: ${page.problem}`);
          continue;
        }
        if (!page.title.includes(site.titleIncludes)) problems.push(`${c.token}: title "${page.title}" lacks "${site.titleIncludes}"`);
        // Each crawler's own copy: a user-agent switch can serve another head.
        // An empty href would resolve to the page itself, so it is checked first.
        const canonical = canonicalOf(page.head);
        if (!canonical) problems.push(`${c.token}: no <link rel=canonical>`);
        else if (resolveUrl(canonical, url) !== url) problems.push(`${c.token}: canonical -> ${canonical}`);
      } catch (e) {
        problems.push(`${c.token}: unreachable: ${why(e)}`);
      }
    }
    record(host, problems.length ? "FAIL" : "PASS", `${path} as every crawler`,
      problems.length ? problems.join("; ") : `${CRAWLERS.length} crawlers: 200, indexable, titled in <head>, self-canonical`);
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
  // The key pages must be fetchable too, whether or not a sitemap lists them.
  if (robotsTxt !== null) {
    for (const path of site.keyPages ?? []) {
      const blocked = CRAWLERS.filter((c) => !robotsAllows(robotsTxt, c.token, path)).map((c) => c.token);
      if (blocked.length) record(host, "FAIL", "robots.txt", `blocks ${path} for ${blocked.join(", ")}`);
    }
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
  // A <loc> is XML text: "&" in a URL is written "&amp;".
  const locsIn = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decodeEntities(m[1]));
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
  // Pages without a canonical on a site that gives every page one. Not a
  // block, so a WARN; a canonical pointing elsewhere misleads, so a FAIL.
  const noCanonical = [];
  let uncanonical = 0;
  for (const url of sample) {
    const path = new URL(url).pathname;
    try {
      const { res } = await get(url, { redirect: "manual" });
      if (res.status !== 200) {
        broken.push(`${path} -> ${res.status}`);
        continue;
      }
      // A sitemap lists pages: a 200 that is JSON, a file or an untitled
      // document is not one, whatever its status says.
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("text/html")) {
        broken.push(`${path} is ${type || "no content-type"}, not an HTML page`);
        continue;
      }
      const head = headOf(await res.text());
      if (!titleOf(head)) broken.push(`${path} has no <title> in <head>`);
      // Indexable for every checked crawler, as on the home page: a
      // "bingbot" meta or a "gptbot: noindex" header hides a page too.
      const xRobots = res.headers.get("x-robots-tag") ?? "";
      const noindexFor = CRAWLERS.filter((c) => blocksIndex(xRobots, c.token) || blocksIndex(metaRobots(head, c.token), c.token)).map((c) => c.token);
      if (noindexFor.length) broken.push(`${path} is noindex for ${noindexFor.join(", ")}`);
      const canonical = canonicalOf(head);
      if (!canonical) {
        uncanonical++;
        if (site.homeCanonical !== false) noCanonical.push(path);
      } else if (resolveUrl(canonical, url) !== resolveUrl(url)) {
        broken.push(`${path} canonical -> ${canonical}`);
      }
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
        : `${sample.length} of ${pages.length} sampled (slice ${offset + 1} of ${step}): all 200 HTML, titled, indexable, ${canonicals}`);
    if (noCanonical.length) {
      record(host, "WARN", "sitemap canonicals", `no <link rel=canonical> on ${noCanonical.join(", ")}`);
    }
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
  // key, and never announces a local build, a site with any failing check
  // (a robots block, a broken sitemap, a misrouted host), or URLs that just
  // failed. Only this host's URLs go in: one foreign URL makes IndexNow
  // reject the batch.
  if (process.env.SUBMIT_INDEXNOW === "true" && !localVsLive(host, new URL(INDEXNOW_ENDPOINT).host)) {
    const urlList = pages.slice(0, 10_000);
    const siteFails = results.filter((r) => r.site === host && r.level === "FAIL").length;
    if (siteFails) {
      record(host, "WARN", "IndexNow submit", `skipped: ${siteFails} failing check(s) on this site`);
    } else if (!keyLive) {
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
 * Match every episode Apple lists (all of them, not only the newest: a page
 * missing since 2025 is as missing as last week's) to a page in the live
 * sitemap by its episode number ("EP44 - ..." on Apple, /podcast/44-... on the
 * site), and warn once one has been out on Apple for PODCAST_MAX_LAG_DAYS,
 * counted from its own release, with no page, unless EPISODES_WITHOUT_PAGE
 * names it. Dates cannot be compared instead: the site dates an episode by its
 * YouTube release, weeks away from Apple's.
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
    // 200 is the lookup API's maximum. Past that the oldest drop off the end,
    // and the check says how many it read.
    const { res, body } = await get(
      `https://itunes.apple.com/lookup?id=${PODCAST_APPLE_ID}&media=podcast&entity=podcastEpisode&limit=200`,
      { ua: "visibility-check" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const released = (JSON.parse(body).results ?? [])
      .filter((r) => (r.kind === "podcast-episode" || r.wrapperType === "podcastEpisode") && r.releaseDate)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
      .map((r) => ({
        id: String(r.trackId ?? ""),
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
    // Every numbered episode Apple lists should have a page, bar the named exceptions.
    const expected = released.filter((e) => e.number !== null && !EPISODES_WITHOUT_PAGE.has(e.number));
    const missing = expected.filter((e) => !pageNumbers.has(e.number));
    const overdue = missing.filter((e) => e.releasedAt <= cutoff);
    const scope = `${expected.length - missing.length} of the ${expected.length} episodes that should have a page (Apple lists ${released.length})`;
    const unchecked = unnumbered.length ? `; ${unnumbered.length} without an episode number not checked: ${list(unnumbered)}` : "";
    // An unnumbered episode can never be matched to a page, so past the grace
    // period it warns (listing it in a PASS row would let it hide for good).
    const unnumberedOverdue = unnumbered.filter((e) => e.releasedAt <= cutoff && !UNNUMBERED_WITHOUT_PAGE.has(e.id));
    if (unnumberedOverdue.length) {
      record("shareefi.co", "WARN", check,
        `no episode number in the Apple title, so no page can be matched, out over ${PODCAST_MAX_LAG_DAYS} days: ` +
        `${unnumberedOverdue.map((e) => `${e.date} "${e.title}" (Apple id ${e.id})`).join("; ")}. ` +
        "Number it on Apple, or add its Apple id to UNNUMBERED_WITHOUT_PAGE with the reason");
    }
    const excused = [...EPISODES_WITHOUT_PAGE].filter(([n]) => !pageNumbers.has(n));
    const byDesign = excused.length ? `; no page by design: ${excused.map(([n, reason]) => `EP${n} (${reason})`).join(", ")}` : "";
    // An exception whose episode now has a page would hide nothing today, but
    // it is stale, and a stale exception is how the next gap goes unseen.
    const stale = [...EPISODES_WITHOUT_PAGE.keys()].filter((n) => pageNumbers.has(n));
    if (stale.length) {
      record("shareefi.co", "WARN", check, `EPISODES_WITHOUT_PAGE lists ${stale.map((n) => `EP${n}`).join(", ")}, which now has a page: remove the entry`);
    }
    if (overdue.length) {
      record("shareefi.co", "WARN", check,
        `out on Apple for over ${PODCAST_MAX_LAG_DAYS} days with no /podcast/<number>- page, newest first: ${list(overdue)}${unchecked}`);
    } else {
      record("shareefi.co", "PASS", check,
        (missing.length
          ? `${scope} have one; ${missing.length} not yet, inside the ${PODCAST_MAX_LAG_DAYS}-day grace from release: ${list(missing)}`
          : `${scope} have one`) + byDesign + unchecked);
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
// episode title, a rejection body) would split the row. Details quote what the
// sites and Apple sent (titles, URLs, headers), so each is capped in length.
const CELL_MAX = 500;
const cell = (s) => {
  const flat = String(s).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
  return flat.length > CELL_MAX ? `${flat.slice(0, CELL_MAX - 1)}…` : flat;
};
/**
 * The report as GitHub renders it (the step summary and the failure issue in
 * this public repo): quoted remote text must stay inert. "<" is escaped so a
 * tag shows as text, "@" gets a zero-width space so a name in a page title
 * pings nobody, and "](" and "![" are broken so it cannot become a link or an
 * image. The log keeps the plain text.
 */
const rendered = (md) =>
  md.replace(/</g, "&lt;").replace(/@/g, "@​").replace(/\]\(/g, "]​(").replace(/!\[/g, "!​[");
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
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, rendered(markdown) + "\n");
// The workflow files this report as a GitHub issue when the run fails.
if (process.env.VISIBILITY_REPORT) writeFileSync(process.env.VISIBILITY_REPORT, rendered(markdown) + "\n");

process.exit(fails || unaccepted ? 1 : 0);
