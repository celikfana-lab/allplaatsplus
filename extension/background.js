// allplaatsplus - background
// Ported from blockurl.py (hosts + URL patterns) as a webRequest filter.
// Only applies to the ad / telemetry hosts below, so it never breaks the rest
// of the user's browsing.
//
// NOTE: MV2 webRequest blocking listeners must return synchronously, so we
// keep a cached copy of the settings in memory and refresh it on change.

var DEFAULTS = {
  blockAds: true,
  blockByTitle: false,
  blockByDescription: false,
  titleWords: [],
  descWords: [],
  blockCities: [],
  blockCountries: [],
  hideBlocked: false,
  aggressiveIdBlock: true,
  darkMode: false,
  hdImages: false
};

var cache = Object.assign({}, DEFAULTS);

function refreshCache() {
  chrome.storage.local.get(DEFAULTS, function (s) {
    cache = s;
  });
}

refreshCache();
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "local") refreshCache();
});
chrome.runtime.onInstalled.addListener(refreshCache);
chrome.runtime.onStartup.addListener(refreshCache);

// ---------- per-tab block statistics ----------
// Counts what the extension blocks on each tab so the badge can show a running
// count (formatted "1K"/"2K" past 1000) and the popup can render the
// "% of traffic / listings / DOM / JS" summary. All counters reset on a full
// page load (tabs.onUpdated -> status "loading").
var stats = {}; // tabId -> { blockedReq, totalReq, blockedJs, totalJs, listingsKilled, listingsTotal, domRemoved, domTotal }

var STAT_DEFAULTS = {
  blockedReq: 0, totalReq: 0,
  blockedJs: 0, totalJs: 0,
  listingsKilled: 0, listingsTotal: 0,
  domRemoved: 0, domTotal: 0
};

function statCell(tabId) {
  if (!stats[tabId]) stats[tabId] = Object.assign({}, STAT_DEFAULTS);
  return stats[tabId];
}

// 1000 -> "1K", 1500 -> "1K", 2000 -> "2K", ...
function badgeText(n) {
  if (n >= 1000) return Math.floor(n / 1000) + 'K';
  return String(n);
}

// The badge number = everything blocked: network requests + listing ads + DOM
// elements. (JS blocks are already part of the request count, so not added
// again — but they're shown separately in the popup.)
function totalBlocked(c) {
  return c.blockedReq + c.listingsKilled + c.domRemoved;
}

function updateBadge(tabId) {
  if (tabId == null || tabId < 0) return;
  var c = statCell(tabId);
  var n = totalBlocked(c);
  try {
    if (n > 0) {
      chrome.browserAction.setBadgeText({ tabId: tabId, text: badgeText(n) });
      chrome.browserAction.setBadgeBackgroundColor({ tabId: tabId, color: '#c0392b' });
    } else {
      chrome.browserAction.setBadgeText({ tabId: tabId, text: '' });
    }
  } catch (e) { /* ignore */ }
}

function resetStats(tabId) {
  if (tabId == null || tabId < 0) return;
  stats[tabId] = Object.assign({}, STAT_DEFAULTS);
  updateBadge(tabId);
}

// Reset on a full page load (reload / address-bar nav), not on SPA routing.
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'loading') resetStats(tabId);
});
chrome.tabs.onRemoved.addListener(function (tabId) {
  delete stats[tabId];
});

// Accept incremental stats from the content script (DOM removals, SSR listings,
// and the listing counts that page.js relays). The popup requests a snapshot.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  try {
    if (msg && msg.type === 'MARKTPL_STATS') {
      var tabId = msg.tabId != null ? msg.tabId : (sender.tab && sender.tab.id);
      if (tabId == null || tabId < 0) return;
      var d = msg.data || {};
      var c = statCell(tabId);
      if (typeof d.listingsKilled === 'number' && d.listingsKilled) c.listingsKilled += d.listingsKilled;
      if (typeof d.listingsTotal === 'number' && d.listingsTotal) c.listingsTotal += d.listingsTotal;
      if (typeof d.domRemoved === 'number' && d.domRemoved) c.domRemoved += d.domRemoved;
      if (typeof d.domTotal === 'number' && d.domTotal) c.domTotal = d.domTotal;
      updateBadge(tabId);
    } else if (msg && msg.type === 'MARKTPL_GET_STATS') {
      var tid = msg.tabId != null ? msg.tabId : (sender.tab && sender.tab.id);
      if (tid != null && tid >= 0) sendResponse(statCell(tid));
    }
  } catch (e) { /* ignore */ }
});

// Whole-host blocks. Only block AD / TELEMETRY hosts entirely — NEVER the app
// CDN (hzcdn.io serves the site's own scripts, so blocking it wholesale breaks
// the page). Other hosts are handled via specific path patterns below.
var BLOCKED_HOSTS = [
  "admarkt-cdn.marktplaats.com",
  "admarkt-cdn.2dehands.com",
  "admarkt-cdn.2dehands.be",
  "tagmanager.marktplaats.nl",
  "consent.marktplaats.nl",
  "faas.marktplaats.nl",
  "4422a912521b.edge.sdk.awswaf.com",
  // leboncoin.fr ad/consent/tracking infrastructure
  "cdn.cookielaw.org",                 // OneTrust CookieLaw consent + tracking
  "static-assets.vinted.com",          // Vinted static ad/tracking assets
  "logs-ingress.svc.vinted.com",       // Vinted logging/telemetry ingress
  "metrics.vinted.lt",                 // Vinted metrics/telemetry
  "sdk.privacy-center.org",            // Didomi consent + tracking
  "cdn.hubvisor.io",                   // Liberty / Hubvisor ad engine
  "securepubads.g.doubleclick.net",    // Google GPT
  "pagead2.googlesyndication.com",     // Google AdSense
  "www.googletagmanager.com",
  "www.google-analytics.com"
];

// URL path patterns on ANY of the mediated hosts. These target the specific ad
// scripts (and only those) so legitimate site assets keep loading.
var BLOCKED_PATTERNS = [
  /\/lrp\/api\/complementary-listings/,
  /\/v\/api\/feed-items/,
  // the ads-adsscript.js banner loader (lives on hzcdn.io / marktplaats CDN).
  // NOTE: do NOT block the `index.mp.nlnl.*` bundle — that's a webpack chunk the
  // site's React app imports, and blocking it crashes the whole page.
  /\.?hzcdn\.io\/bff\/static\/vendor\/ecg-js-banners\/ads\/ads-adsscript\.js/,
  /\/bff\/static\/vendor\/ecg-js-banners\/ads\/ads-adsscript\.js/,
  /bff\/static\/js\/auroraAdobeDmpJs\..*/,
  /lrp\/api\/audience-targeting/,
  /static\/js\/adsenseForSearch\..*\.js/,
  /bff\/static\/css\/adsenseForSearch\.mp\..*\.css/,
  // p.marktplaats.net specific ad / consent scripts
  /p\.marktplaats\.net\/.*(ad|consent|tag|analytics|measure|collect|beacon)/i,
  /edge\.sdk\.awswaf\.com\/.*\/challenge\.compact\.js/,
  // Kleinanzeigen.de trackers. The `<*>_type_script_index_0_lang.*` catch-all
  // blocks EVERY loader in that family (GoogleAnalyticsTags, LibertyTagLoader,
  // GATrackingDispatcher, PromotionScript, ...) plus any future variants.
  /frontend-web\/_red-web\/assets\/[A-Za-z0-9]+\.astro_astro_type_script_index_0_lang/,
  // Also block the root-level randomized tracking/tag paths those loaders
  // dispatch to, e.g. /Rv_8dlvBZ/jCNKdNU/Wg/... — several dash-less token
  // segments immediately after the domain. Content routes use "s-anzeigen"
  // (dashes), so this won't touch real pages.
  /kleinanzeigen\.de(\/[A-Za-z0-9_%]+){4,}/,
  /kleinanzeigen\.de\/liberty\//,
  /kleinanzeigen\.de\/gdpr\//,
  /kleinanzeigen\.de\/Rv_8dlvBZ\//,
  /kleinanzeigen\.de\/Rv_8dlvBZ\/jCNKdNU\/Wg\/EYEcz48LGDzQQ8L55Y\/SXktOwsLYAQ\/Qg4KA3xJ\/aQwC/,
  // Vinted "gtg" (get the grading? / tracking / consent) path — block the path
  // only, not the whole vinted.nl domain.
  /vinted\.(nl|com|fr|de|co\.uk)\/[A-Za-z0-9_%/-]*gtg\//i,
  // Vinted metrics telemetry endpoint (`https://metrics.vinted.lt/web/v4`) —
  // block this path only, keep the rest of metrics.vinted.lt reachable.
  /metrics\.vinted\.lt\/web\/v4\//,
  // Vinted API telemetry ingestion endpoint (`https://api.vinted.nl/j3r4zw/v1/consume`)
  // — block this path only, keep the rest of api.vinted.nl reachable.
  /api\.vinted\.(nl|com|fr|de|lt|lv|ee)\/j3r4zw\/v1\/consume/,
  // Vinted promoted-closets ad endpoint (`https://www.vinted.nl/api/v2/promoted_closets`)
  // — block this path only, keep the rest of vinted.nl reachable.
  /www\.vinted\.(nl|com|fr|de|lt|lv|ee)\/api\/v2\/promoted_closets/
];

function hostMatches(host) {
  for (var i = 0; i < BLOCKED_HOSTS.length; i++) {
    var b = BLOCKED_HOSTS[i];
    if (host === b || host.endsWith("." + b)) return true;
  }
  return false;
}

// "HD image": rewrite images.marktplaats.com URLs so the rule suffix changes
// from `...$_<digits>` to `...$_omega` (full-resolution). e.g.
//   ...?rule=ecg_mp_eps$_83  ->  ...?rule=ecg_mp_eps$_omega
function toHdUrl(urlStr) {
  // works for the whole Marktplaats/2ememain/2dehands family's image CDN
  if (/images\.(marktplaats\.com|2ememain\.|2dehands\.)/.test(urlStr) === false) return null;
  var m = urlStr.match(/([?&]rule=[^&]*?)\$_(\d+)(&|$)/);
  if (!m) return null;
  return urlStr.replace(/([?&]rule=[^&]*?)\$_(\d+)(&|$)/, function (match, head, digits, delim) {
    return head + "$_omega" + delim;
  });
}

chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    try {
      var host = new URL(details.url).hostname;
      var tabId = details.tabId;
      var c = tabId >= 0 ? statCell(tabId) : null;
      var isScript = details.type === 'script';

      if (c) {
        c.totalReq++;
        if (isScript) c.totalJs++;
      }

      // 1) Ad / telemetry blocking
      var blocked = false;
      if (cache.blockAds) {
        if (hostMatches(host)) blocked = true;
        else if (BLOCKED_PATTERNS.some(function (re) { return re.test(details.url); })) blocked = true;
      }

      if (blocked) {
        if (c) {
          c.blockedReq++;
          if (isScript) c.blockedJs++;
        }
        updateBadge(tabId);
        return { cancel: true };
      }

      // 2) HD image rewrite (independent toggle)
      if (cache.hdImages) {
        var hd = toHdUrl(details.url);
        if (hd) return { redirectUrl: hd };
      }
    } catch (e) {
      // ignore malformed URLs
    }

    return { cancel: false };
  },
  {
    urls: [
      "*://*.marktplaats.nl/*",
      "*://*.marktplaats.com/*",
      "*://*.marktplaats.net/*",
      "*://*.2ememain.be/*",
      "*://*.2ememain.fr/*",
      "*://*.2dehands.be/*",
      "*://*.2dehands.com/*",
      "*://*.leboncoin.fr/*",
      "*://*.kleinanzeigen.de/*",
      "*://www.vinted.nl/gtg/*",
      "*://static-assets.vinted.com/*",
      "*://metrics.vinted.lt/web/v4/*",
      "*://metrics.vinted.lt/*",
      "*://logs-ingress.svc.vinted.com/*",
      "*://api.vinted.nl/j3r4zw/v1/consume*",
      "*://www.vinted.nl/api/v2/promoted_closets*",
      "*://*.hzcdn.io/*",
      "*://4422a912521b.edge.sdk.awswaf.com/*",
      "*://*.privacy-center.org/*",
      "*://*.hubvisor.io/*",
      "*://*.cookielaw.org/*",
      "*://*.doubleclick.net/*",
      "*://*.googlesyndication.com/*",
      "*://*.googletagmanager.com/*",
      "*://*.google-analytics.com/*"
    ]
  },
  ["blocking"]
);
