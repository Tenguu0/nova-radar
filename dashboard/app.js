// Nova Radar — the dashboard. Renders window.NOVA_RADAR (written by main.ts
// from the sealed snapshot) with no network and no framework.
// SPDX-License-Identifier: MIT
(function () {
  'use strict';
  var DATA = window.NOVA_RADAR;
  var rows = DATA.rows;
  var live = DATA.live;

  // ------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return s;
  }
  function pctClass(v) { return v === null ? '' : v >= 0 ? 'up' : 'down'; }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ------------------------------------------------------------- starred set
  var STAR_KEY = 'nova-radar-stars';
  var stars = {};
  try { stars = JSON.parse(localStorage.getItem(STAR_KEY) || '{}'); } catch (e) { stars = {}; }
  function isStarred(slug) { return !!stars[slug]; }
  function toggleStar(slug) {
    if (stars[slug]) delete stars[slug]; else stars[slug] = 1;
    try { localStorage.setItem(STAR_KEY, JSON.stringify(stars)); } catch (e) { /* private mode */ }
  }

  // ------------------------------------------------------------- header stats
  var top = rows[0];
  $('stats').innerHTML =
    stat(money(top ? top.implied_value_usd : 0), 'Top implied value') +
    stat(String(DATA.board_size), 'Pre-token protocols') +
    stat(String(DATA.watchlist_size), 'On the watchlist') +
    stat('×' + DATA.global_peer_multiple.toFixed(2), 'Global peer multiple') +
    stat(DATA.as_of, 'Snapshot date');
  function stat(value, label) {
    return '<div class="stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }
  $('source-line').textContent = 'Data: ' + DATA.source + '. Floor for the watchlist: ' + moneyFull(DATA.floor_usd) + '.';

  // ------------------------------------------------------------- filter options
  var categories = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  categories.sort();
  chains.sort();
  categories.forEach(function (c) { addOption($('category'), c, c); });
  chains.forEach(function (c) { addOption($('chain'), c, c); });
  function addOption(select, value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    select.appendChild(o);
  }

  // ------------------------------------------------------------- filtering
  function currentRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('category').value;
    var chain = $('chain').value;
    var minTvl = Number($('min-tvl').value);
    var watchOnly = $('watch-only').checked;
    var launchOnly = $('launch-only').checked;
    var starredOnly = $('starred-only').checked;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (r.tvl_usd < minTvl) return false;
      if (watchOnly && !r.on_watchlist) return false;
      if (launchOnly && !r.launch_candidate) return false;
      if (starredOnly && !isStarred(r.slug)) return false;
      return true;
    });
    var sort = $('sort').value;
    var by = {
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    };
    out.sort(by[sort] || by.value);
    return out;
  }

  function renderBoard() {
    var list = currentRows();
    var html = list.map(function (r) {
      var badge = r.on_watchlist
        ? '<span class="badge watch">WATCHLIST</span>'
        : (!r.launch_candidate ? '<span class="badge no">NOT A LAUNCH</span>' : '');
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><small>' + esc(r.slug) + '</small>' + badge + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">×' + r.peer_multiple.toFixed(2) + '</td>' +
        '<td class="star-col"><button class="star-btn' + (isStarred(r.slug) ? ' on' : '') + '" data-star="' + esc(r.slug) + '" aria-label="Star ' + esc(r.name) + '">' + (isStarred(r.slug) ? '★' : '☆') + '</button></td>' +
        '</tr>';
    }).join('');
    $('rows').innerHTML = html;
    $('empty').hidden = list.length !== 0;
    $('count').textContent = list.length + ' of ' + rows.length + ' pre-token protocols shown — click any row for its detail and farm plan.';
  }

  // ------------------------------------------------------------- live view
  $('live-rows').innerHTML = live.map(function (p) {
    return '<tr>' +
      '<td class="name"><b>' + esc(p.name) + '</b><small>' + esc(p.slug) + '</small></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td>' + esc(p.chains.slice(0, 3).join(', ')) + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + (p.mcap_usd === null ? '—' : money(p.mcap_usd)) + '</td>' +
      '<td class="num">' + (p.multiple === null ? '—' : '×' + p.multiple.toFixed(2)) + '</td>' +
      '<td class="num ' + pctClass(p.change_7d) + '">' + pct(p.change_7d) + '</td>' +
      '</tr>';
  }).join('');

  // ------------------------------------------------------------- method view
  $('method-body').innerHTML =
    '<h2>How Nova Radar prices a launch that has not happened</h2>' +
    '<p>Each protocol on the board records no token in the snapshot. Its implied value is what the ' +
    'token would be worth <i>if</i> the protocol launched one today and the market priced it like ' +
    'the tokens of its peers — nothing more. It is the board\u2019s own claim, never a prediction.</p>' +
    '<pre>peer multiple   median mcap / TVL of the token-bearing protocols\n' +
    '                in the same category, shrunk toward the global\n' +
    '                median (global ×' + DATA.global_peer_multiple.toFixed(2) + ') when peers are few;\n' +
    '                each peer\u2019s ratio is winsorised at 3× first, so a\n' +
    '                token trading at 400× a thin TVL cannot set the price\n' +
    'growth          1 + clamp(change_7d, -50, +150) / 100 × 0.6\n' +
    'maturity        0.80 + 0.20 × min(age_days, 1095) / 1095\n' +
    'breadth         1 + 0.02 × min(chains − 1, 5)\n' +
    'launch factor   0.05 for an exchange, a bridge, or a wrapped /\n' +
    '                staked product — not a launch at all; 1.00 otherwise\n\n' +
    'implied value = TVL × peer × growth × maturity × breadth × launch</pre>' +
    '<p>Every factor comes from the snapshot itself. No protocol name is special-cased: ' +
    'the same function scores all ' + DATA.board_size + ' rows. Protocols whose token already ' +
    'trades are kept apart under \u201cAlready trading\u201d and shown at the market\u2019s own value.</p>' +
    '<p>The watchlist (' + DATA.watchlist_size + ' protocols at or above ' + moneyFull(DATA.floor_usd) +
    ' TVL with no token and no wrapped/staked parent) is the floor, never the ceiling: the board ' +
    'carries every pre-token protocol in the snapshot, including the early ones below the floor.</p>' +
    '<h2>How to read a farm plan</h2>' +
    '<p>Each plan is concrete: what to do, what it costs in gas, and how long to hold the position. ' +
    'Farm with money you can leave untouched for 60 days, never more than 5% of a portfolio in one ' +
    'unlaunched protocol, and keep a log of every transaction hash — a plan is worthless if you ' +
    'cannot prove you did it.</p>';

  // ------------------------------------------------------------- detail view
  var selectedSlug = null;
  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var panel = $('detail');
    if (!r) { panel.hidden = true; selectedSlug = null; return; }
    selectedSlug = slug;
    var m = r;
    var maxBar = Math.max(m.peer_multiple, 1);
    function barRow(label, value, shown) {
      var width = Math.max(4, Math.min(100, (value / maxBar) * 100));
      return '<div class="bar-row"><span>' + label + '</span><div class="bar"><i style="width:' + width.toFixed(0) + '%"></i></div><span class="val">' + shown + '</span></div>';
    }
    var peers = live.filter(function (p) { return p.category === r.category; }).slice(0, 4);
    var peerLine = peers.length
      ? '<p>Live peers in ' + esc(r.category || 'this category') + ': ' + peers.map(function (p) { return esc(p.name) + ' ×' + (p.multiple === null ? '—' : p.multiple.toFixed(2)); }).join(' · ') + '.</p>'
      : '<p>No live-token peer in this category in the snapshot — the global multiple ×' + DATA.global_peer_multiple.toFixed(2) + ' was used instead.</p>';
    panel.innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      (r.on_watchlist ? ' · <span class="badge watch">WATCHLIST</span>' : '') +
      (r.launch_candidate ? '' : ' · <span class="badge no">NOT A LAUNCH CANDIDATE</span>') + '</p>' +
      '<div class="detail-grid">' +
      '<div class="kv"><b>' + moneyFull(r.implied_value_usd) + '</b><span>Implied value</span></div>' +
      '<div class="kv"><b>' + moneyFull(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="kv"><b class="' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</b><span>TVL change, 7d</span></div>' +
      '<div class="kv"><b>' + ageText(r.age_days) + '</b><span>Tracked since ' + esc(r.listed_at || 'unknown') + '</span></div>' +
      '<div class="kv"><b>×' + r.peer_multiple.toFixed(2) + '</b><span>Peer multiple (' + r.category_peers + ' peers)</span></div>' +
      '</div>' +
      '<h3>Why this value — the model, factor by factor</h3>' +
      '<div class="bars">' +
      barRow('Peer multiple', r.peer_multiple, '×' + r.peer_multiple.toFixed(2)) +
      barRow('Growth factor', r.growth_factor, '×' + r.growth_factor.toFixed(2)) +
      barRow('Maturity factor', r.maturity_factor, '×' + r.maturity_factor.toFixed(2)) +
      barRow('Breadth factor', r.breadth_factor, '×' + r.breadth_factor.toFixed(2)) +
      '</div>' + peerLine +
      '<h3>Farm plan — what to do, what it costs, how long it takes</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p><button id="detail-close" type="button">Close detail</button></p>';
    panel.hidden = false;
    $('detail-close').addEventListener('click', function () { showDetail(null); });
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ------------------------------------------------------------- events
  $('rows').addEventListener('click', function (ev) {
    var star = ev.target.closest('[data-star]');
    if (star) { toggleStar(star.getAttribute('data-star')); renderBoard(); return; }
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'category', 'chain', 'min-tvl', 'sort', 'watch-only', 'launch-only', 'starred-only']
    .forEach(function (id) {
      $(id).addEventListener(id === 'q' ? 'input' : 'change', renderBoard);
    });

  function setTab(which) {
    $('tab-board').classList.toggle('active', which === 'board');
    $('tab-live').classList.toggle('active', which === 'live');
    $('tab-method').classList.toggle('active', which === 'method');
    $('board-view').hidden = which !== 'board';
    $('live-view').hidden = which !== 'live';
    $('method-view').hidden = which !== 'method';
    $('controls').style.display = which === 'board' ? '' : 'none';
    $('count').style.display = which === 'board' ? '' : 'none';
  }
  $('tab-board').addEventListener('click', function () { setTab('board'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });
  $('tab-method').addEventListener('click', function () { setTab('method'); });

  // Deep links, used by the screenshots and by sharing a view:
  // ?detail=<slug>, ?category=<name>, ?watch=1, ?launch=1, ?q=<text>, ?tab=live|method
  var params = new URLSearchParams(window.location.search);
  if (params.get('category')) $('category').value = params.get('category');
  if (params.get('chain')) $('chain').value = params.get('chain');
  if (params.get('min-tvl')) $('min-tvl').value = params.get('min-tvl');
  if (params.get('sort')) $('sort').value = params.get('sort');
  if (params.get('q')) $('q').value = params.get('q');
  if (params.get('watch') === '1') $('watch-only').checked = true;
  if (params.get('launch') === '1') $('launch-only').checked = true;
  if (params.get('tab')) setTab(params.get('tab'));

  renderBoard();
  if (params.get('detail')) showDetail(params.get('detail'));
})();
