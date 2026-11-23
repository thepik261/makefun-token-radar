// Token Radar console: reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, filters, a per-protocol drawer with the model's own inputs and the farm
// plan, and the already-trading view. No network: every byte shown is in data.js.
//
// The page recomputes each row's implied value from the snapshot figures (TVL, seven-day growth,
// age with no token, chain count) and checks the number board.json carries, so the page's
// arithmetic and the board's data are visibly the same model.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the same arithmetic lib/model.ts runs, from the same constants.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + Math.min((row.chains || []).length, model.breadth_max_chains) * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('wl') === '1') state.wl = true;
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.wl) p.set('wl', '1');
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.wl && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortBtn(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' &#9660;' : ' &#9650;') : '';
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + label + arrow + '</button></th>';
  }

  function headerHtml() {
    return '<header class="masthead">' +
      '<div class="brand"><span class="ring" aria-hidden="true"></span><div><b>TOKEN RADAR</b>' +
      '<span>Pre-token protocols, ranked by implied value</span></div></div>' +
      '<div class="meta"><span>Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span>DefiLlama protocol index</span>' +
      '<span>Model <b>' + esc(DATA.model_version) + '</b></span></div></header>';
  }

  function heroHtml() {
    return '<section class="hero"><div><h1>' + DATA.watchlist_size +
      ' watchlist protocols, ranked by what a launch would be worth</h1>' +
      '<p>The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) +
      'M of TVL</b> and no token on record. The early radar adds <b>' + DATA.early_size +
      ' launch candidates below that floor</b>. Implied value is a model, not a price — and never a ' +
      'promise that a token comes at all.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows ranked</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="stat"><span>Early rows below the floor</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '</div></section>';
  }

  function options(list, current, allLabel) {
    var html = '<option value="all"' + (current === 'all' ? ' selected' : '') + '>' + allLabel + '</option>';
    list.forEach(function (v) {
      html += '<option value="' + esc(v) + '"' + (current === v ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    return html;
  }

  function controlsHtml() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    return '<div class="toolbar">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Name, slug, category or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + options(categories, state.category, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' + options(chains, state.chain, 'All chains') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<div class="tabs" role="group" aria-label="Token status">' +
      '<button type="button" data-tab="pre" aria-pressed="' + (state.tab === 'pre') + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Already trading</button></div>' +
      '<span class="shown">' + (state.tab === 'pre' ? filteredRows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols') + '</span></div>';
  }

  function boardHtml() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return '<div class="card"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="btn" type="button" id="clear-filters">Clear filters</button></div></div>';
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var rows = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var pct = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" class="' + (state.selected === r.slug ? 'sel' : '') + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' +
        esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + gc + '">' + growth + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td><span class="bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
        '<span class="num implied">' + fmtUsd(r.implied_value_usd) + '</span></td>' +
        '<td><span class="pill">no token</span></td></tr>';
    }).join('');
    return '<div class="card"><div class="scroller"><table>' +
      '<caption>Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</caption>' +
      '<thead><tr>' + sortBtn('implied', 'Rank') + sortBtn('name', 'Protocol') + sortBtn('tvl', 'TVL') +
      sortBtn('growth', '7d') + sortBtn('age', 'Age') + sortBtn('implied', 'Implied value') +
      '<th scope="col">Token</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function liveHtml() {
    var rows = DATA.live.map(function (r) {
      return '<tr><td><span class="pill live">live</span></td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' +
        esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></div></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td><span class="pill live">already trades</span></td></tr>';
    }).join('');
    return '<div class="card"><div class="scroller"><table>' +
      '<caption>Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th>' +
      '<th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  function modelHtml() {
    var m = DATA.model;
    return '<section class="card model"><h2>How implied value is computed</h2>' +
      '<p class="muted">One function scores every row, from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked.</p>' +
      '<div class="formula">implied = round( tvl_usd x <b>' + m.base_multiple + '</b> x (1 + clamp(change_7d, ' +
      m.growth_floor + ', ' + m.growth_cap + ') / 100 x <b>' + m.growth_weight + '</b>) x (' + m.maturity_floor +
      ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x <b>' + m.maturity_range +
      '</b>) x (1 + min(chains, ' + m.breadth_max_chains + ') x <b>' + m.breadth_per_chain + '</b>) )</div>' +
      '<p class="muted">TVL sets the scale. Seven-day growth moves it most: a protocol compounding fast is worth more than a stagnant one the same size. Age is the time since the protocol was first listed — how long it has run with no token; an unlisted age uses ' +
      m.unknown_age_days + ' days. Running on more chains adds a little for distribution.</p>' +
      '<p class="muted">Set aside, not ranked: <b style="color:var(--ink)">' + DATA.set_aside +
      ' pre-token records</b> are receipts of a token that already trades — wrapped, staked or bridged products such as WBTC, Binance staked ETH and USDT0 — and a receipt is not a launch of its own.</p></section>';
  }

  function footHtml() {
    return '<section class="card note"><p><b>What this radar does not do.</b> It does not predict whether or when a token is issued. ' +
      'It says a protocol <b>records</b> no token, never that it has none: DefiLlama&rsquo;s record is not proof, and a protocol on the list may still have a token its record does not carry. ' +
      'Implied value is this entry&rsquo;s own claim, built from the snapshot of ' + esc(DATA.as_of) + '; treat it as a way to choose what to farm next, not as a price.</p></section>';
  }

  function drawerHtml(row) {
    var recomputed = impliedOf(row, DATA.model);
    var ok = recomputed === row.implied_value_usd;
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    return '<div class="drawer-head"><div><span class="kicker">RANK ' + row.rank + ' OF ' + DATA.board_size + '</span>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') +
      ' &middot; listed ' + esc(row.listed_at || 'unknown') + '</p></div>' +
      '<button class="close" type="button" id="drawer-close" aria-label="Close details">&#10005;</button></div>' +
      '<section class="dsection"><h3>Implied value</h3><div class="math">' +
      '<div><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + fmtPct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + fmtAge(row.age_days) + '</b></div>' +
      '<div><span>Growth multiplier</span><b>' + row.growth_multiplier + '</b></div>' +
      '<div><span>Maturity multiplier</span><b>' + row.maturity_multiplier + '</b></div>' +
      '<div><span>Chain breadth multiplier</span><b>' + row.breadth_multiplier + '</b></div>' +
      '<div class="total"><span>Implied value</span><b>' + fmtUsd(row.implied_value_usd) + '</b></div></div>' +
      '<p class="verify ' + (ok ? 'ok' : '') + '">Model ' + esc(DATA.model_version) + ': the page recomputes this row as ' +
      fmtUsd(recomputed) + (ok ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.') +
      ' This is an estimate, not a price.</p></section>' +
      '<section class="dsection"><h3>Farm plan</h3><ol class="steps">' + steps + '</ol></section>';
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    var drawer = document.getElementById('drawer');
    var scrim = document.getElementById('scrim');
    if (!row || !drawer || !scrim) return;
    state.selected = slug;
    writeHash();
    drawer.innerHTML = drawerHtml(row);
    drawer.hidden = false;
    scrim.hidden = false;
    var close = document.getElementById('drawer-close');
    if (close) close.addEventListener('click', closeDetail);
    render();
  }
  function closeDetail() {
    var drawer = document.getElementById('drawer');
    var scrim = document.getElementById('scrim');
    if (drawer) { drawer.hidden = true; drawer.innerHTML = ''; }
    if (scrim) scrim.hidden = true;
    state.selected = null;
    writeHash();
    render();
  }

  function render() {
    app.innerHTML = '<div class="wrap">' + headerHtml() + heroHtml() + controlsHtml() +
      (state.tab === 'pre' ? boardHtml() : liveHtml()) +
      (state.tab === 'pre' ? modelHtml() : '') + footHtml() + '</div>' +
      '<div class="scrim" id="scrim" hidden></div>' +
      '<aside class="drawer" id="drawer" aria-label="Protocol detail" hidden></aside>';
    app.setAttribute('aria-busy', 'false');

    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    var cat = document.getElementById('category');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    var clear = document.getElementById('clear-filters');
    if (clear) clear.addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); });
    var tabs = app.querySelectorAll('[data-tab]');
    tabs.forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); });
    });
    var sorts = app.querySelectorAll('[data-sort]');
    sorts.forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
      });
    });
    var rows = app.querySelectorAll('tbody tr[data-slug]');
    rows.forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); }
      });
    });
    var scrim = document.getElementById('scrim');
    if (scrim) scrim.addEventListener('click', closeDetail);

    if (state.selected) {
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
      if (row) {
        var drawer = document.getElementById('drawer');
        var scr = document.getElementById('scrim');
        drawer.innerHTML = drawerHtml(row);
        drawer.hidden = false;
        scr.hidden = false;
        var close = document.getElementById('drawer-close');
        if (close) close.addEventListener('click', closeDetail);
      }
    }
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDetail();
  });
})();
