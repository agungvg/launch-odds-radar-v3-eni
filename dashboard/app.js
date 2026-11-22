// Launch-Odds Radar v3 dashboard: renders window.RADAR (written by main.ts).
// No network, no fetch: data.js is loaded beside this page. Hash state:
// #detail=<slug>, #category=, #verdict=, #q=, #watchlist=1, #sort=ev|terminal|tvl|odds
// A deep link shows what it asked for first (detail, or the filtered board),
// so it is in the first viewport without scrolling.
(function () {
  var D = window.RADAR; if (!D) return;
  var app = document.getElementById('app'); app.setAttribute('aria-busy', 'false');
  var money = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  function hash() { var o = {}; location.hash.slice(1).split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) o[kv[0]] = decodeURIComponent(kv[1] || ''); }); return o; }
  function setHash(o) { var s = Object.keys(o).filter(function (k) { return o[k]; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); history.replaceState(null, '', s ? '#' + s : location.pathname); }
  var H = hash();
  var state = { q: H.q || '', cat: H.category || '', verdict: H.verdict || '', wl: H.watchlist === '1', sort: H.sort || 'ev', detail: H.detail || '' };
  var cats = [...new Set(D.rows.map(function (r) { return r.category || 'Uncategorised'; }))].sort();
  var acc = D.accounting;
  var excl = Object.entries(acc.excludedByReason).map(function (e) { return e[1] + ' ' + e[0]; }).join(', ');
  var kpi = function (b, s, sm) { return '<div class="kpi"><b>' + b + '</b><span>' + s + '</span>' + (sm ? '<small>' + sm + '</small>' : '') + '</div>'; };
  function filtered() {
    var rows = D.rows.filter(function (r) {
      if (state.wl && !D.watchlistSlugs.includes(r.slug)) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q.toLowerCase()) < 0) return false;
      return true;
    });
    var key = state.sort === 'terminal' ? 'terminal_value_usd' : state.sort === 'tvl' ? 'tvl_usd' : state.sort === 'odds' ? 'launch_odds' : 'implied_value_usd';
    rows.sort(function (a, b) { return b[key] - a[key] || a.slug.localeCompare(b.slug); });
    return rows;
  }
  function detailHtml(r) {
    return '<section class="detail" id="detail"><h2>Detail: ' + esc(r.name) + ' — rank ' + r.rank + ' · ' + r.verdict + '</h2>' +
      '<dl><dt>Expected value</dt><dd>' + money(r.implied_value_usd) + '</dd><dt>Terminal value</dt><dd>' + money(r.terminal_value_usd) + '</dd>' +
      '<dt>Launch odds</dt><dd>' + (r.launch_odds * 100).toFixed(1) + '%</dd><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>Peer multiple</dt><dd>' + r.peer_multiple + 'x (n=' + r.peer_n + ')</dd><dt>7-day change</dt><dd>' + (r.change_7d === null ? 'n/a' : r.change_7d + '%') + '</dd>' +
      '<dt>Growth mult</dt><dd>' + r.growth_mult + '</dd><dt>Maturity mult</dt><dd>' + r.maturity_mult + '</dd>' +
      '<dt>Breadth mult</dt><dd>' + r.breadth_mult + '</dd><dt>Age</dt><dd>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</dd>' +
      '<dt>Deposit size</dt><dd>$' + r.deposit_usd + '</dd><dt>Chains</dt><dd>' + esc(r.chains.join(', ')) + '</dd></dl>' +
      '<p class="note">Terminal = TVL x peer multiple x growth x maturity x breadth. Expected = terminal x launch odds. ' +
      'Peer multiple is the category median log(mcap/TVL) of traded protocols, shrunk toward the global median. Odds are the category traded share, shrunk toward the global share.</p>' +
      '<h3>Farm plan — ' + r.verdict + ' (deposit $' + r.deposit_usd + ')</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></section>';
  }
  function render() {
    var rows = filtered();
    var det = state.detail ? D.rows.find(function (r) { return r.slug === state.detail; }) : null;
    var h1 = D.holdouts[0], h2 = D.holdouts[1];
    var headerHtml = '<header><div><h1>LAUNCH-ODDS <span>RADAR v3</span></h1>' +
      '<p class="sub">Which pre-token protocol is worth farming next, and what to do about it. Ranked by expected value = terminal value x launch odds, fitted from the traded protocols in this snapshot — no name is special-cased.</p></div>' +
      '<div class="meta">Snapshot ' + D.as_of + '<br>Floor $' + D.floor_usd.toLocaleString('en-US') + '<br>Model ' + D.model_version + '</div></header>';
    var kpiHtml = '<div class="kpis">' +
      kpi('758', 'protocols accounted for', acc.ranked + ' ranked + ' + acc.excludedPreToken + ' excluded pre-token + ' + acc.tokenRecordedNoMcap + ' token-recorded, no mcap + ' + acc.traded + ' traded') +
      kpi('40 / 40', 'watchlist covered', 'every watchlist protocol is on the board') +
      kpi('x' + D.fit.fullMiss + ' vs x' + D.fit.fullNaive, 'full fit vs naive', 'median miss, traded protocols, n=' + D.fit.tradedN) +
      kpi('x' + h1.fittedMiss + ' vs x' + h1.naiveMiss, 'H1 5-fold hold-out', 'peer + coefs refit per fold') +
      kpi('x' + h2.fittedMiss + ' vs x' + h2.naiveMiss, 'H2 leave-one-out', 'peer refit, coefs held') +
      kpi('Farm ' + D.verdictCounts.Farm + ' · Thin ' + D.verdictCounts.Thin + ' · Skip ' + D.verdictCounts.Skip, 'farm verdicts', 'Farm: EV >= $25M and odds >= 7%. Thin: EV >= $5M.') +
      '</div>';
    var modelHtml = '<div class="grid2"><section class="card"><h2>How the price is fitted</h2><p>Terminal = TVL x peer multiple x growth x maturity x breadth. ' +
      'Peer multiple: category median mcap/TVL, shrunk toward global ' + D.fit.globalMultiple + 'x. Fitted terms: growth a=' + D.fit.a + ', maturity b=' + D.fit.b + ', breadth c=' + D.fit.c + ' (grid search, median absolute log error on ' + D.fit.tradedN + ' traded protocols). ' +
      'Launch odds: category traded share, shrunk toward the global share. Typical miss is exp(median |log predicted − log actual|): lower is better, naive is the global median multiple alone.</p>' +
      '<h3>Peer multiples (top categories by traded count)</h3><table><tr><th>Category</th><th class="n">Traded</th><th class="n">Multiple</th></tr>' +
      D.peerTable.map(function (t) { return '<tr><td>' + esc(t.category) + '</td><td class="n">' + t.n + '</td><td class="n">' + t.multiple + 'x</td></tr>'; }).join('') + '</table></section>' +
      '<section class="card"><h2>Accounting — all 758</h2><table><tr><th>Group</th><th class="n">Count</th></tr>' +
      '<tr><td>Ranked pre-token (this board)</td><td class="n">' + acc.ranked + '</td></tr>' +
      '<tr><td>Excluded pre-token (' + esc(excl) + ')</td><td class="n">' + acc.excludedPreToken + '</td></tr>' +
      '<tr><td>Token recorded, no market cap</td><td class="n">' + acc.tokenRecordedNoMcap + '</td></tr>' +
      '<tr><td>Token trades (' + acc.tradedPriced + ' priced, ' + acc.tradedNonPositive + ' non-positive mcap)</td><td class="n">' + acc.traded + '</td></tr>' +
      '<tr><td><b>Total</b></td><td class="n"><b>' + acc.total + '</b></td></tr></table>' +
      '<p class="note">A protocol records no token means DefiLlama records no token for it — not proof it has none. Wrapped, staked and bridged products of tokens that already trade are not launches of their own, so they are counted here, not ranked.</p>' +
      '<h3>Traded anchors (market values, not ranked)</h3><table><tr><th>Protocol</th><th class="n">TVL</th><th class="n">Mcap</th></tr>' +
      D.live.slice(0, 6).map(function (l) { return '<tr><td>' + esc(l.name) + '</td><td class="n">' + money(l.tvl_usd) + '</td><td class="n">' + money(l.mcap_usd) + '</td></tr>'; }).join('') + '</table></section></div>';
    var boardHtml = '<h2 id="board">Board — ' + rows.length + ' of ' + D.rows.length + ' ranked rows</h2>' +
      '<div class="filters"><input id="q" type="search" placeholder="Search name or slug" value="' + esc(state.q) + '">' +
      '<select id="cat"><option value="">All categories</option>' + cats.map(function (c) { return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="verdict"><option value="">All verdicts</option>' + ['Farm', 'Thin', 'Skip'].map(function (v) { return '<option' + (state.verdict === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select>' +
      '<select id="sort"><option value="ev"' + (state.sort === 'ev' ? ' selected' : '') + '>Sort: expected value</option><option value="terminal"' + (state.sort === 'terminal' ? ' selected' : '') + '>Sort: terminal value</option><option value="tvl"' + (state.sort === 'tvl' ? ' selected' : '') + '>Sort: TVL</option><option value="odds"' + (state.sort === 'odds' ? ' selected' : '') + '>Sort: launch odds</option></select>' +
      '<label><input id="wl" type="checkbox"' + (state.wl ? ' checked' : '') + '> Watchlist only</label></div>' +
      '<table><tr><th class="n">#</th><th>Protocol</th><th>Category</th><th class="n">TVL</th><th class="n">Peer</th><th class="n">Terminal</th><th class="n">Odds</th><th class="n">Expected</th><th>Verdict</th></tr>' +
      rows.slice(0, 60).map(function (r) {
        return '<tr class="click" data-slug="' + r.slug + '"><td class="n">' + r.rank + '</td><td><b>' + esc(r.name) + '</b><br><span class="note">' + esc(r.slug) + '</span></td><td>' + esc(r.category || '—') + '</td><td class="n">' + money(r.tvl_usd) + '</td><td class="n">' + r.peer_multiple + 'x</td><td class="n">' + money(r.terminal_value_usd) + '</td><td class="n">' + (r.launch_odds * 100).toFixed(1) + '%</td><td class="n"><b>' + money(r.implied_value_usd) + '</b></td><td><span class="pill ' + r.verdict + '">' + r.verdict + '</span></td></tr>';
      }).join('') + '</table><p class="note">Showing 60 rows at a time; use search, category and verdict filters to find the rest. Click a row for its full model breakdown and farm plan.</p>';
    var footHtml = '<p class="foot">Launch-Odds Radar v3. Implied values are this entry’s own claim from the sealed snapshot; they are not a prediction that a token will be issued, or when. Farm plans are a starting point, not financial advice.</p>';
    var isFiltered = !!(state.verdict || state.cat || state.q || state.wl);
    var body = det ? headerHtml + detailHtml(det) + kpiHtml + modelHtml + boardHtml
      : isFiltered ? headerHtml + boardHtml + kpiHtml + modelHtml
      : headerHtml + kpiHtml + modelHtml + boardHtml;
    app.innerHTML = '<div class="wrap">' + body + footHtml + '</div>';
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; state.detail = ''; sync(); });
    document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; sync(); });
    document.getElementById('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; sync(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; sync(); });
    document.getElementById('wl').addEventListener('change', function (e) { state.wl = e.target.checked; sync(); });
    app.querySelectorAll('tr.click').forEach(function (tr) { tr.addEventListener('click', function () { state.detail = tr.getAttribute('data-slug'); sync(); var d = document.getElementById('detail'); if (d) d.scrollIntoView(); }); });
  }
  function sync() { setHash({ q: state.q, category: state.cat, verdict: state.verdict, watchlist: state.wl ? '1' : '', sort: state.sort === 'ev' ? '' : state.sort, detail: state.detail }); render(); }
  render();
})();
