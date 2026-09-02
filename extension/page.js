// allplaatsplus - page script (runs in the page's main world)
//
// Ported from inject.py. Hooks window.fetch and XMLHttpRequest so that listing
// JSON (which React/Next.js fetches from /lrp/api/search and
// /hp/api/feed-items) is filtered BEFORE it gets rendered. Because we filter at
// the network layer (like mitmproxy did) the ad cards never appear in the DOM.
//
// Settings are read from window.__MARKTPL_SETTINGS__ (set by content.js) and
// kept up to date via postMessage({ type: 'MARKTPL_SETTINGS' }).

(function () {
  'use strict';

  var settings = window.__MARKTPL_SETTINGS__ || {};

  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'MARKTPL_SETTINGS') {
      settings = e.data.payload || {};
    }
  });

  // Ported from inject.py (plus the other dagtopper trait variants)
  var BAD_TRAITS = ['ADMARKT_CONSOLE', 'DAG_TOPPER_7DAYS', 'DAG_TOPPER_3DAYS', 'DAG_TOPPER', 'PROFILE'];
  var BAD_PRIORITY = ['DAGTOPPER', 'TOPADVERTENTIE'];

  function listOrEmpty(v) { return Array.isArray(v) ? v : []; }

  function isAd(item) {
    if (!item || typeof item !== 'object') return false;

    // Ad markers only apply when "Block ads" is enabled. This keeps the toggle
    // working: turning it off stops the network-level removal entirely.
    var blockAds = settings.blockAds !== false;

    if (blockAds) {
      var itemId = String(item.itemId == null ? '?' : item.itemId);
      var traits = listOrEmpty(item.traits);

      // itemId starting with "a" = an ad (matches inject.py). Real listings use
      // other letters (e.g. "m2437820726"). This is opt-in via aggressiveIdBlock.
      if (settings.aggressiveIdBlock === true && itemId.charAt(0) === "a") {
        return true;
      }

      for (var i = 0; i < traits.length; i++) {
        if (BAD_TRAITS.indexOf(traits[i]) !== -1) return true;
      }

      if (BAD_PRIORITY.indexOf(item.priorityProduct) !== -1) return true;

      // "admarkt" anywhere in the JSON blob of the item (this covers the
      // picture.url admarkt-cdn CDN and casData tracking params used by ads).
      try {
        var picUrl = (item.picture && item.picture.url) || '';
        if (picUrl.indexOf('admarkt') !== -1) return true;
        if (JSON.stringify(item).indexOf('admarkt') !== -1) return true;
      } catch (e) { /* ignore */ }

      if (item.trackingData) return true;
      if (item.reserved === true) return true;
    }

    // Title word filter
    if (settings.blockByTitle) {
      var title = String(item.title || '').toLowerCase();
      var tw = listOrEmpty(settings.titleWords);
      for (var t = 0; t < tw.length; t++) {
        if (title.indexOf(tw[t]) !== -1) return true;
      }
    }

    // Description word filter
    if (settings.blockByDescription) {
      var dw = listOrEmpty(settings.descWords);
      var fields = ['description', 'categorySpecificDescription'];
      for (var f = 0; f < fields.length; f++) {
        var text = String(item[fields[f]] || '');
        if (!text) continue;
        text = text.toLowerCase();
        for (var d = 0; d < dw.length; d++) {
          if (text.indexOf(dw[d]) !== -1) return true;
        }
      }
    }

    // Location filter (city / country)
    var loc = item.location;
    if (loc && typeof loc === 'object') {
      var cities = listOrEmpty(settings.blockCities);
      var countries = listOrEmpty(settings.blockCountries);
      if (cities.length || countries.length) {
        var city = String(loc.cityName || '').toLowerCase();
        var countryName = String(loc.countryName || '').toLowerCase();
        var countryAbbr = String(loc.countryAbbreviation || '').toLowerCase();
        if (cities.indexOf(city) !== -1 ||
            countries.indexOf(countryName) !== -1 ||
            countries.indexOf(countryAbbr) !== -1) {
          return true;
        }
      }
    }

    return false;
  }

  // leboncoin.fr ad items: paid storefront sellers ("owner.type === 'pro'") are
  // ads; private sellers are kept. Their items use "list_id", not "itemId".
  function isLbcAd(item) {
    if (!item || typeof item !== 'object') return false;
    var blockAds = settings.blockAds !== false;
    if (!blockAds) return false;
    var owner = item.owner;
    if (owner && typeof owner === 'object' && owner.type === 'pro') return true;
    if (typeof item.new_item_price !== 'undefined' && (item.custom_ref || item.stock_quantity)) return true;
    return false;
  }

  function isAdItem(item) {
    if (item && typeof item === 'object' && ('list_id' in item || 'owner' in item)) return isLbcAd(item);
    return isAd(item);
  }

  function isListingsArray(a) {
    return Array.isArray(a) && a.length && a[0] && typeof a[0] === 'object' &&
           ('itemId' in a[0] || 'list_id' in a[0]);
  }

  // Recursively drop ads from any object/array that holds objects with itemId.
  function nukeListings(data, depth) {
    depth = depth || 0;
    if (depth > 15 || !data) return 0;

    var killed = 0;

    if (Array.isArray(data)) {
      if (isListingsArray(data)) {
        for (var i = data.length - 1; i >= 0; i--) {
          if (isAdItem(data[i])) { data.splice(i, 1); killed++; }
        }
      } else {
        for (var j = 0; j < data.length; j++) {
          killed += nukeListings(data[j], depth + 1);
        }
      }
    } else if (data && typeof data === 'object') {
      for (var key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          var val = data[key];
          if (isListingsArray(val)) {
            var before = val.length;
            data[key] = val.filter(function (x) { return !isAdItem(x); });
            killed += before - data[key].length;
          } else {
            killed += nukeListings(val, depth + 1);
          }
        }
      }
    }

    return killed;
  }

  function shouldInspect(urlStr) {
    if (!urlStr) return false;
    // The app fetches these API endpoints with RELATIVE paths (e.g.
    // '/hp/api/feed-items?feedType=FOR_YOU'), so resolve against the page
    // origin before the host check — otherwise no host is present to match.
    try { if (urlStr.charAt(0) === '/') urlStr = location.origin + urlStr; } catch (e) { /* ignore */ }

    // leboncoin.fr: inspect EVERY JSON response. Its listings pages are served
    // from arbitrary _next/data/<build>/.../*.json routes (e.g. .../p-3.json,
    // .../recherche.json) whose names change per category, so no path whitelist
    // can cover them. The listing detection below still verifies the payload
    // really holds listings (objects with itemId/list_id) and leaves every
    // non-listing JSON response completely untouched, so it's safe to inspect
    // everything on this host.
    if (/leboncoin\.fr/.test(urlStr)) return true;

    // Other sites (marktplaats family, kleinanzeigen): keep the targeted URL
    // whitelist so we only touch known listing API endpoints, never their other
    // JSON traffic.
    var api = /\/lrp\/api\/(search|complementary-listings)/.test(urlStr) ||
              /\/hp\/api\/feed-items/.test(urlStr) ||
              /\/v\/api\/feed-items/.test(urlStr) ||
              /\/api\/search/.test(urlStr);
    if (!api) return false;

    return /(marktplaats\.(com|nl)|2ememain\.(be|fr)|2dehands\.(be|com)|kleinanzeigen\.de)/.test(urlStr);
  }

  // Count itemId-bearing listings in the same structure nukeListings walks, so
  // the "N listings were ads (P%)" stat can be reported alongside the kill count.
  function countListings(data) {
    var n = 0;
    (function walk(v) {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) {
        if (isListingsArray(v)) {
          n += v.length;
        } else {
          for (var i = 0; i < v.length; i++) walk(v[i]);
        }
        return;
      }
      for (var key in v) {
        if (Object.prototype.hasOwnProperty.call(v, key)) walk(v[key]);
      }
    })(data);
    return n;
  }

  function reportStats(killed, total) {
    try {
      window.postMessage({
        type: 'MARKTPL_STATS_API',
        data: { listingsKilled: killed, listingsTotal: total }
      }, '*');
    } catch (e) { /* ignore */ }
  }

  // ---- fetch hook ----
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var urlStr;
      try {
        urlStr = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (e) { urlStr = ''; }

      return origFetch.apply(this, arguments).then(function (resp) {
        if (!resp || !urlStr || !shouldInspect(urlStr)) return resp;
        var ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
        if (ct.indexOf('json') === -1) return resp;

        // Clone so we can read the body without consuming the original.
        return resp.clone().text().then(function (text) {
          try {
            if (!text) return resp;
            var data = JSON.parse(text);
            var total = countListings(data);
            var killed = nukeListings(data);
            reportStats(killed, total);
            if (killed > 0) {
              // Mirror inject.py's fix_response(): drop length/encoding headers
              // so the new body length actually matches what the reader receives.
              var headers = new Headers(resp.headers);
              headers.delete('content-length');
              headers.delete('content-encoding');
              headers.delete('transfer-encoding');
              return new Response(JSON.stringify(data), {
                status: resp.status,
                statusText: resp.statusText,
                headers: headers
              });
            }
          } catch (e) { /* not JSON, ignore */ }
          return resp;
        });
      });
    };
  }

  // ---- XHR hook (mitmproxy catches XMLHttpRequest fetches too) ----
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origResponse = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__marktlUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var listener = function () {
      if (xhr.readyState !== 4) return;
      try {
        if (origResponse && origResponse.get && xhr.__marktlUrl &&
            shouldInspect(xhr.__marktlUrl)) {
          var text = origResponse.get.call(xhr);
          if (!text) return;
          var data = JSON.parse(text);
          var total = countListings(data);
          var killed = nukeListings(data);
          reportStats(killed, total);
          if (killed > 0) {
            var modified = JSON.stringify(data);
            // Rewrite the already-parsed body so consumers grabbing
            // responseText/response get the filtered data.
            try {
              Object.defineProperty(xhr, 'responseText', { value: modified, configurable: true });
              Object.defineProperty(xhr, 'response', { value: modified, configurable: true });
            } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { /* not JSON, ignore */ }
    };

    if ('addEventListener' in xhr) xhr.addEventListener('load', listener);
    origSend.apply(this, arguments);
  };
})();
