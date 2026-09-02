// allplaatsplus - popup logic

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

function $(id) { return document.getElementById(id); }

var els = {
  blockAds: $('blockAds'),
  blockByTitle: $('blockByTitle'),
  blockByDescription: $('blockByDescription'),
  darkMode: $('darkMode'),
  hdImages: $('hdImages'),
  hideBlocked: $('hideBlocked'),
  aggressiveIdBlock: $('aggressiveIdBlock'),
  titleInput: $('titleInput'),
  descInput: $('descInput'),
  titleTags: $('titleTags'),
  descTags: $('descTags'),
  citiesInput: $('citiesInput'),
  countriesInput: $('countriesInput'),
  reset: $('reset'),
  status: $('status')
};

var settings = Object.assign({}, DEFAULTS);

function save() {
  chrome.storage.local.set(settings, function () {
    if (chrome.runtime.lastError) {
      flashStatus('Error: ' + chrome.runtime.lastError.message);
    } else {
      flashStatus('Saved');
    }
  });
}

function flashStatus(msg) {
  els.status.textContent = msg;
  setTimeout(function () { els.status.textContent = ''; }, 900);
}

function parseCSV(v) {
  return String(v || '')
    .split(/[,;]/)
    .map(function (x) { return x.trim().toLowerCase(); })
    .filter(Boolean);
}

function renderTag(key, container) {
  container.innerHTML = '';
  (settings[key] || []).forEach(function (word, i) {
    var span = document.createElement('span');
    span.className = 'tag';
    span.textContent = word;
    var x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.addEventListener('click', function () {
      settings[key].splice(i, 1);
      renderTag(key, container);
      save();
    });
    span.appendChild(x);
    container.appendChild(span);
  });
}

function bindToggle(id, key) {
  els[id].addEventListener('change', function () {
    settings[key] = els[id].checked;
    save();
  });
}

function bindWordInput(inputEl, key, tagEl) {
  inputEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var v = inputEl.value.trim().toLowerCase();
    if (!v) return;
    settings[key] = settings[key] || [];
    if (settings[key].indexOf(v) === -1) settings[key].push(v);
    inputEl.value = '';
    renderTag(key, tagEl);
    save();
  });
}

function load() {
  chrome.storage.local.get(DEFAULTS, function (s) {
    settings = Object.assign({}, DEFAULTS, s);

    els.blockAds.checked = settings.blockAds;
    els.blockByTitle.checked = settings.blockByTitle;
    els.blockByDescription.checked = settings.blockByDescription;
    els.darkMode.checked = settings.darkMode;
    els.hdImages.checked = settings.hdImages;
    els.hideBlocked.checked = settings.hideBlocked;
    els.aggressiveIdBlock.checked = settings.aggressiveIdBlock;
    els.citiesInput.value = (settings.blockCities || []).join(', ');
    els.countriesInput.value = (settings.blockCountries || []).join(', ');

    renderTag('titleWords', els.titleTags);
    renderTag('descWords', els.descTags);
  });
}

bindToggle('blockAds', 'blockAds');
bindToggle('blockByTitle', 'blockByTitle');
bindToggle('blockByDescription', 'blockByDescription');
bindToggle('darkMode', 'darkMode');
bindToggle('hdImages', 'hdImages');
bindToggle('hideBlocked', 'hideBlocked');
bindToggle('aggressiveIdBlock', 'aggressiveIdBlock');

bindWordInput(els.titleInput, 'titleWords', els.titleTags);
bindWordInput(els.descInput, 'descWords', els.descTags);

els.citiesInput.addEventListener('change', function () {
  settings.blockCities = parseCSV(els.citiesInput.value);
  save();
});
els.countriesInput.addEventListener('change', function () {
  settings.blockCountries = parseCSV(els.countriesInput.value);
  save();
});

els.reset.addEventListener('click', function () {
  settings = Object.assign({}, DEFAULTS);
  chrome.storage.local.set(settings, function () {
    load();
    flashStatus('Reset');
  });
});

// Context-aware UI: show/hide options that only apply to the site in the active
// tab (e.g. itemId-"a"/HD-image rules are Marktplaats-specific, and the German
// site quotes/sells differently). Toggling rows off does NOT change settings.
function siteLabel(site) {
  switch (site) {
    case 'german': return 'allplaatsplus · Kleinanzeigen (DE)';
    case 'marktplaats': return 'allplaatsplus · Marktplaats (NL)';
    case '2ememain': return 'allplaatsplus · 2ememain (BE/FR)';
    case 'leboncoin': return 'allplaatsplus · Leboncoin (FR)';
    default: return 'allplaatsplus';
  }
}

function applySite(site) {
  document.getElementById('title').textContent = siteLabel(site);

  // Marktplaats-only rules (itemId-"a" kill + HD image rewrite) don't apply on
  // the German/French/other sites, so hide their rows there.
  var foreign = site === 'german' || site === 'leboncoin';
  var rows = ['row-aggressiveIdBlock', 'row-hdImages', 'hint-hdImages'];
  rows.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = foreign ? 'none' : '';
  });
}

// ---------- block statistics ----------
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function fmtNum(n) { return n >= 1000 ? Math.floor(n / 1000) + 'K' : String(n); }

function renderStats(s) {
  s = s || { blockedReq: 0, totalReq: 0, blockedJs: 0, totalJs: 0, listingsKilled: 0, listingsTotal: 0, domRemoved: 0, domTotal: 0 };
  var total = s.blockedReq + s.listingsKilled + s.domRemoved;
  $('statTotal').textContent = fmtNum(total);
  $('statTraffic').textContent = s.blockedReq + ' / ' + s.totalReq + ' (' + pct(s.blockedReq, s.totalReq) + '%)';
  $('statListings').textContent = s.listingsKilled + ' (' + pct(s.listingsKilled, s.listingsTotal) + '%)';
  $('statDom').textContent = pct(s.domRemoved, s.domTotal) + '%';
  $('statJs').textContent = pct(s.blockedJs, s.totalJs) + '%';
}

function loadStats() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tabId = tabs && tabs[0] && tabs[0].id;
    chrome.runtime.sendMessage({ type: 'MARKTPL_GET_STATS', tabId: tabId }, function (s) {
      renderStats(s);
    });
  });
}

function getActiveSite() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var url = (tabs && tabs[0] && tabs[0].url) || '';
    var site = 'other';
    if (/kleinanzeigen\.de/i.test(url)) site = 'german';
    else if (/marktplaats\.(nl|com)/i.test(url)) site = 'marktplaats';
    else if (/2ememain\.(be|fr)|2dehands\.(be|com)/i.test(url)) site = '2ememain';
    else if (/leboncoin\.fr/i.test(url)) site = 'leboncoin';
    applySite(site);
  });
}

document.addEventListener('DOMContentLoaded', function () { load(); getActiveSite(); loadStats(); });
