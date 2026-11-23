/* Pre-token radar: the page. It reads window.SNAPSHOT (../data.js, written by main.ts), runs
 * RadarModel.build from model.js on it, and renders three views by hash route:
 *   #/board?q=&chain=&cat=&seg=&sort=&dir=   the ranked board with sort and filters
 *   #/p/<slug>                               one protocol: value build-up, peers, farm plan
 *   #/model, #/apart                         the model's calibration, and what the board keeps apart
 */
(function () {
  'use strict';
  var view = document.getElementById('view');
  if (!window.SNAPSHOT || !window.RadarModel) {
    view.innerHTML = '<p class="empty">No data: run main.ts so that data.js sits beside this dashboard folder.</p>';
    return;
  }
  var S = window.SNAPSHOT, M = window.RadarModel, R = M.build(S), C = M.C;
  var bySlug = {};
  R.board.forEach(function (s) { bySlug[s.p.slug] = s; });
  var maxImplied = R.board[0].implied;
  var floor = S.floor_usd;
  var lastBoard = '#/board';

  document.getElementById('meta').textContent = 'DefiLlama snapshot ' + S.as_of + ' · ' + S.protocols.length + ' protocols · ' + R.board.length + ' pre-token ranked';

  // ---------------------------------------------------------------- formatting
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function money(x) {
    if (x === null || x === undefined) return '—';
    var a = Math.abs(x);
    if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (x / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'K';
    return '$' + x.toFixed(x < 10 ? 2 : 0);
  }
  function pct(x) {
    if (x === null || x === undefined) return '<span class="faint">n/a</span>';
    var c = x > 0.005 ? 'up' : x < -0.005 ? 'down' : 'dim';
    return '<span class="num ' + c + '">' + (x > 0 ? '+' : '') + x.toFixed(1) + '%</span>';
  }
  function days(d) {
    if (d === null) return '<span class="faint">unknown</span>';
    return d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d';
  }
  function x2(v) { return v.toFixed(v < 0.1 ? 3 : 2) + '×'; }
  function tags(s) {
    return (s.watch ? '<span class="tag w">WATCHLIST</span>' : s.p.tvl_usd < floor ? '<span class="tag e">EARLY</span>' : '') +
      (s.parent ? '<span class="tag p" title="' + esc(s.parent) + '">PARENT</span>' : '');
  }
  function verdictTag(plan) {
    var k = plan.verdict === 'Worth a ticket' ? 'good' : plan.verdict === 'Marginal' ? 'mid' : 'bad';
    return '<span class="vd ' + k + '" title="modelled drop ' + plan.cover + 'x the plan’s costs">' + plan.verdict + '</span>';
  }
  function chainsText(cs) { return cs.length > 3 ? cs.slice(0, 3).join(', ') + ' +' + (cs.length - 3) : cs.join(', '); }

  // ---------------------------------------------------------------- routing
  function parse() {
    var h = location.hash.replace(/^#\/?/, ''), q = {}, i = h.indexOf('?');
    if (i >= 0) {
      h.slice(i + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      h = h.slice(0, i);
    }
    return { path: h.split('/'), q: q };
  }
  function boardHash(st) {
    var parts = [];
    ['q', 'chain', 'cat', 'seg', 'sort', 'dir'].forEach(function (k) {
      if (st[k] && !(k === 'seg' && st[k] === 'all') && !(k === 'sort' && st[k] === 'implied') && !(k === 'dir' && st[k] === 'desc')) parts.push(k + '=' + encodeURIComponent(st[k]));
    });
    return '#/board' + (parts.length ? '?' + parts.join('&') : '');
  }
  function setTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a'), function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === name); });
  }

  // ---------------------------------------------------------------- board
  var SEGS = [
    ['all', 'All', function () { return true; }],
    ['watch', 'Watchlist', function (s) { return s.watch; }],
    ['early', 'Below floor', function (s) { return s.p.tvl_usd < floor; }],
    ['rising', 'Rising 7d', function (s) { return s.p.change_7d > 0; }],
    ['parent', 'Parent-linked', function (s) { return !!s.parent; }],
    ['worth', 'Worth farming', function (s) { return s.plan.verdict === 'Worth a ticket'; }]
  ];
  var COLS = [
    ['rank', '#', function (s) { return -s.rank; }],
    ['name', 'Protocol', function (s) { return s.p.name.toLowerCase(); }],
    ['tvl', 'TVL', function (s) { return s.p.tvl_usd; }],
    ['growth', '7d', function (s) { return s.p.change_7d === null ? -1e9 : s.p.change_7d; }],
    ['age', 'No token for', function (s) { return s.age === null ? -1 : s.age; }],
    ['multiple', 'Peer multiple', function (s) { return s.factors.multiple; }],
    ['implied', 'Implied value', function (s) { return s.implied; }],
    ['drop', 'Drop / $1k', function (s) { return s.dropPer1k; }],
    ['farm', 'Farm', function (s) { return s.plan.cover; }]
  ];

  function counted(list, key) {
    var n = {};
    list.forEach(function (s) { [].concat(key(s)).forEach(function (k) { n[k] = (n[k] || 0) + 1; }); });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a < b ? -1 : 1); }).map(function (k) { return [k, n[k]]; });
  }
  var CHAINS = counted(R.board, function (s) { return s.p.chains; });
  var CATS = counted(R.board, function (s) { return s.p.category || 'Uncategorised'; });

  function filtered(st) {
    var seg = SEGS.filter(function (x) { return x[0] === st.seg; })[0] || SEGS[0];
    var q = (st.q || '').toLowerCase();
    var rows = R.board.filter(function (s) {
      if (!seg[2](s)) return false;
      if (st.chain && s.p.chains.indexOf(st.chain) < 0) return false;
      if (st.cat && (s.p.category || 'Uncategorised') !== st.cat) return false;
      if (q && (s.p.name + ' ' + s.p.slug + ' ' + (s.p.category || '') + ' ' + s.p.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var col = COLS.filter(function (c) { return c[0] === st.sort; })[0] || COLS[6];
    var sign = st.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var x = col[2](a), y = col[2](b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign || a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard(q) {
    var st = { q: q.q || '', chain: q.chain || '', cat: q.cat || '', seg: q.seg || 'all', sort: q.sort || 'implied', dir: q.dir || 'desc' };
    var rows = filtered(st);
    lastBoard = boardHash(st);
    var total = 0, watch = 0;
    R.board.forEach(function (s) { total += s.implied; if (s.watch) watch++; });
    var shownValue = 0;
    rows.forEach(function (s) { shownValue += s.implied; });
    var filteredOn = st.q || st.chain || st.cat || st.seg !== 'all';

    var html = '<section class="hero"><div><h1>' + R.board.length + ' pre-token protocols, ranked by implied value</h1>' +
      '<p class="lede">Implied value = TVL × the market’s own mcap/TVL for tokens already trading in the same category, adjusted for 7-day growth, ' +
      'time live without a token, chain reach and parent links. All ' + S.watchlist.length + ' watchlist protocols are here, plus ' +
      (R.board.length - watch) + ' the watchlist leaves out. Select a row for its build-up and farm plan.</p></div>' +
      '<div class="kpis">' +
      '<div class="kpi"><b>' + watch + ' / ' + S.watchlist.length + '</b><span>watchlist covered</span></div>' +
      '<div class="kpi"><b>' + (R.board.length - watch) + '</b><span>ranked beyond it</span></div>' +
      '<div class="kpi"><b>' + R.live.length + '</b><span>live tokens kept apart</span></div>' +
      '<div class="kpi hi"><b>' + money(filteredOn ? shownValue : total) + '</b><span>' + (filteredOn ? 'implied, this view' : 'implied, whole board') + '</span></div>' +
      '</div></section>';

    html += '<div class="filters" role="search">' +
      '<input id="f-q" type="search" placeholder="Search name, category, chain  ( / )" value="' + esc(st.q) + '" aria-label="Search">' +
      '<select id="f-chain" aria-label="Chain"><option value="">All chains</option>' + CHAINS.map(function (c) {
        return '<option value="' + esc(c[0]) + '"' + (c[0] === st.chain ? ' selected' : '') + '>' + esc(c[0]) + ' (' + c[1] + ')</option>';
      }).join('') + '</select>' +
      '<select id="f-cat" aria-label="Category"><option value="">All categories</option>' + CATS.map(function (c) {
        return '<option value="' + esc(c[0]) + '"' + (c[0] === st.cat ? ' selected' : '') + '>' + esc(c[0]) + ' (' + c[1] + ')</option>';
      }).join('') + '</select>' +
      '<div class="chips" role="group" aria-label="Segment">' + SEGS.map(function (g) {
        return '<button class="chip' + (g[0] === st.seg ? ' on' : '') + '" data-seg="' + g[0] + '">' + g[1] + '<i>' + R.board.filter(g[2]).length + '</i></button>';
      }).join('') + '</div>' +
      (filteredOn ? '<button class="reset" id="f-reset">Clear filters</button>' : '') +
      '<span class="count">' + rows.length + ' of ' + R.board.length + ' rows</span></div>';

    html += '<div class="tablewrap"><table><thead><tr>' + COLS.map(function (c) {
      var on = c[0] === st.sort;
      var right = ['tvl', 'growth', 'age', 'multiple', 'drop'].indexOf(c[0]) >= 0;
      return '<th class="sort' + (on ? ' on' + (st.dir === 'asc' ? ' asc' : '') : '') + (right ? ' r' : '') + (c[0] === 'multiple' || c[0] === 'drop' ? ' hide-m' : '') + '" data-sort="' + c[0] + '">' + c[1] + '</th>';
    }).join('') + '<th>Flags</th></tr></thead><tbody>';
    if (!rows.length) html += '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>';
    rows.forEach(function (s) {
      var w = Math.max(2, Math.sqrt(s.implied / maxImplied) * 100);
      html += '<tr data-slug="' + esc(s.p.slug) + '">' +
        '<td class="rank">' + s.rank + '</td>' +
        '<td><span class="name">' + esc(s.p.name) + '</span><span class="sub">' + esc(s.p.category || 'Uncategorised') + ' · ' + esc(chainsText(s.p.chains)) + '</span></td>' +
        '<td class="r num">' + money(s.p.tvl_usd) + '</td>' +
        '<td class="r">' + pct(s.p.change_7d) + '</td>' +
        '<td class="r num">' + days(s.age) + '</td>' +
        '<td class="r num dim hide-m">' + x2(s.factors.multiple) + '</td>' +
        '<td><span class="bar"><span style="width:' + w.toFixed(1) + '%"></span></span><span class="num val">' + money(s.implied) + '</span></td>' +
        '<td class="r num hide-m">' + money(s.dropPer1k) + '</td>' +
        '<td>' + verdictTag(s.plan) + '</td>' +
        '<td>' + tags(s) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    view.innerHTML = html;

    function go(patch) {
      var next = {};
      for (var k in st) next[k] = st[k];
      for (var j in patch) next[j] = patch[j];
      location.replace(boardHash(next));
    }
    var qi = document.getElementById('f-q');
    var timer;
    qi.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { go({ q: qi.value }); }, 180);
    });
    document.getElementById('f-chain').addEventListener('change', function (e) { go({ chain: e.target.value }); });
    document.getElementById('f-cat').addEventListener('change', function (e) { go({ cat: e.target.value }); });
    var reset = document.getElementById('f-reset');
    if (reset) reset.addEventListener('click', function () { location.hash = boardHash({ sort: st.sort, dir: st.dir }); });
    view.querySelectorAll('[data-seg]').forEach(function (b) { b.addEventListener('click', function () { go({ seg: b.getAttribute('data-seg') }); }); });
    view.querySelectorAll('[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        go({ sort: k, dir: k === st.sort ? (st.dir === 'asc' ? 'desc' : 'asc') : (k === 'name' ? 'asc' : 'desc') });
      });
    });
    view.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
    });
    if (st.q) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }

  // ---------------------------------------------------------------- detail
  function peersOf(cat) {
    return R.live.filter(function (l) { return (l.p.category || 'Uncategorised') === cat && l.ratio !== null; })
      .sort(function (a, b) { return b.p.tvl_usd - a.p.tvl_usd; }).slice(0, 6);
  }

  function renderDetail(slug) {
    var s = bySlug[slug];
    if (!s) { view.innerHTML = '<p class="empty">No ranked protocol has the slug “' + esc(slug) + '”. <a href="#/board">Back to the board</a></p>'; return; }
    var p = s.p, f = s.factors, cat = p.category || 'Uncategorised';
    var cal = R.calibration.categories[cat];
    var plan = s.plan;
    var steps = [
      ['', 'TVL', money(p.tvl_usd), 'DefiLlama, ' + S.as_of],
      ['×', 'Peer multiple', x2(f.multiple), cal ? cal.n + ' ' + cat + ' token' + (cal.n === 1 ? '' : 's') + ' trade at a median ' + x2(cal.raw) + ' mcap/TVL; shrunk toward the all-category ' + x2(R.calibration.global) : 'no ' + cat + ' token trades in the snapshot: the all-category median ' + x2(R.calibration.global)],
      ['×', '7-day growth', x2(f.growth), p.change_7d === null ? 'no 7-day change reported: neutral' : 'TVL ' + (p.change_7d > 0 ? '+' : '') + p.change_7d.toFixed(2) + '% in 7 days, square-rooted and clamped to −50%..+100%'],
      ['×', 'Time without a token', x2(f.tokenless), s.age === null ? 'no listing date: ' + C.unknownAgeDays + ' days assumed' : s.age + ' days since DefiLlama began tracking it (' + p.listed_at + ')'],
      ['×', 'Chain reach', x2(f.breadth), p.chains.length + ' chain' + (p.chains.length === 1 ? '' : 's') + ': ' + chainsText(p.chains)],
      ['×', 'Parent link', x2(f.parent), s.parent || 'no sign the token would accrue to another protocol']
    ];
    var running = p.tvl_usd, factorOf = [1, f.multiple, f.growth, f.tokenless, f.breadth, f.parent];
    var html = '<a class="crumb" href="' + esc(lastBoard) + '">← Board</a>' +
      '<div class="dhead"><div><span class="rk">#' + s.rank + ' of ' + R.board.length + '</span><h1>' + esc(p.name) + '</h1>' +
      '<p class="lede">' + tags(s) + esc(cat) + ' · ' + esc(p.chains.join(', ')) + '. DefiLlama records no token for it (no CoinGecko id, no symbol).</p></div>' +
      '<div class="big">' + money(s.implied) + '<small>implied value if it launched a token on today’s record</small></div></div>';

    html += '<div class="grid2"><div class="stack"><section class="panel"><h2>How the value is built</h2><table class="build"><tbody>';
    steps.forEach(function (row, i) {
      running = i === 0 ? running : running * factorOf[i];
      html += '<tr><td class="op">' + row[0] + '</td><td>' + row[1] + '<span class="why">' + esc(row[3]) + '</span></td><td class="r num">' + row[2] + '</td><td class="r num dim">' + money(running) + '</td></tr>';
    });
    html += '<tr class="total"><td class="op">=</td><td>Implied value</td><td></td><td class="r num">' + money(s.implied) + '</td></tr></tbody></table></section>';

    var peers = peersOf(cat);
    html += '<section class="panel"><h2>Peers whose token trades (' + esc(cat) + ')</h2>' + (peers.length ?
      '<table class="mini"><thead><tr><th>Protocol</th><th>Token</th><th class="r">TVL</th><th class="r">Mcap</th><th class="r">Mcap/TVL</th></tr></thead><tbody>' + peers.map(function (l) {
        return '<tr><td>' + esc(l.p.name) + '</td><td class="num dim">' + esc(l.p.symbol || '—') + '</td><td class="r num">' + money(l.p.tvl_usd) + '</td><td class="r num">' + money(l.p.mcap_usd) + '</td><td class="r num">' + x2(l.ratio) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="dim">No token in this category trades with a market cap in the snapshot, so the model uses the all-category median of ' + x2(R.calibration.global) + '.</p>') + '</section>';

    html += '<section class="panel"><h2>Snapshot record</h2><dl class="kv num">' +
      ['slug', 'category', 'tvl_usd', 'change_7d', 'listed_at', 'mcap_usd', 'gecko_id', 'symbol'].map(function (k) {
        var v = p[k];
        return '<dt>' + k + '</dt><dd' + (v === null ? ' class="faint"' : '') + '>' + (v === null ? 'null' : esc(typeof v === 'number' ? v.toLocaleString('en-US') : v)) + '</dd>';
      }).join('') + '<dt>chains</dt><dd>' + p.chains.length + '</dd></dl></section></div>';

    html += '<section class="panel"><h2>Farm plan</h2><div class="facts">' +
      '<div class="fact"><b>' + esc(plan.chain) + '</b><span>chain</span></div>' +
      '<div class="fact"><b>' + money(plan.ticket) + '</b><span>ticket</span></div>' +
      '<div class="fact"><b>' + plan.hold + ' d</b><span>hold</span></div>' +
      '<div class="fact"><b>' + M.usd(plan.cost) + '</b><span>fees + gas</span></div>' +
      '<div class="fact"><b>' + plan.hours + ' h</b><span>your time</span></div>' +
      '<div class="fact"><b>' + M.usd(plan.drop) + '</b><span>modelled drop</span></div></div><p class="verdict">' + verdictTag(plan) + ' The modelled drop is ' + plan.cover + '× what the plan costs; it breaks even from about ' + M.usd(plan.breakEven) + ' deposited.</p><ol class="steps">';
    plan.steps.forEach(function (x) {
      var budget = x.title === 'Budget';
      html += '<li' + (budget ? ' class="budget"' : '') + '><b>' + esc(x.title) + '</b><p>' + esc(x.text) + '</p>' +
        (budget ? '' : '<div class="pills"><span class="pill">' + (x.cost ? '~' + M.usd(x.cost) : 'free') + '</span><span class="pill">~' + x.minutes + ' min</span></div>') + '</li>';
    });
    html += '</ol></section></div>';

    var prev = R.board[s.rank - 2], next = R.board[s.rank];
    html += '<nav class="pager">' + (prev ? '<a href="#/p/' + esc(prev.p.slug) + '">← #' + prev.rank + ' ' + esc(prev.p.name) + '</a>' : '<span></span>') +
      (next ? '<a href="#/p/' + esc(next.p.slug) + '">#' + next.rank + ' ' + esc(next.p.name) + ' →</a>' : '') + '</nav>';
    view.innerHTML = html;
  }

  // ---------------------------------------------------------------- model and kept-apart views
  function renderModel() {
    var cats = Object.keys(R.calibration.categories).map(function (k) { return [k, R.calibration.categories[k]]; })
      .sort(function (a, b) { return b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1); });
    var onBoard = {};
    R.board.forEach(function (s) { var k = s.p.category || 'Uncategorised'; onBoard[k] = (onBoard[k] || 0) + 1; });
    var html = '<h1>The value model</h1><p class="lede">One formula scores every row; no protocol is named in the code. Its only inputs are the snapshot’s own fields.</p><div class="grid2" style="margin-top:24px"><div class="stack">' +
      '<section class="panel"><h2>Formula</h2><div class="formula">implied = <em>TVL</em>\n  × peerMultiple(<em>category</em>)\n  × √(1 + clamp(<em>change_7d</em>, −50, 100) / 100)\n  × tokenless(<em>days since listed_at</em>)\n  × (1 + 0.04 × (min(<em>chains</em>, 6) − 1))\n  × parent (0.5 if linked, else 1)</div></section>' +
      '<section class="panel notes"><h2>Why each term</h2>' +
      '<p><b>Peer multiple.</b> The ' + R.calibration.peers + ' protocols in the snapshot whose token trades show what the market pays per dollar of TVL. Each ratio is clipped to ' + C.winsorLo + '×..' + C.winsorHi + '×, the category’s log-median is taken and shrunk toward the all-category median ' + x2(R.calibration.global) + ' with weight ' + C.shrinkK + ', so a category with one or two peers cannot swing the board.</p>' +
      '<p><b>Growth.</b> Rising TVL raises the value, falling TVL lowers it; the square root keeps a single week from doubling it.</p>' +
      '<p><b>Time without a token.</b> ' + C.ageFloor + '× at listing, rising to ' + C.ageTop + '× at two years: TVL that stays without a token is sticky. After three years it fades by up to ' + C.ageFade + ', since a very long wait lowers the odds a token ever comes.</p>' +
      '<p><b>Parent link.</b> Halved when the token would likely accrue elsewhere: a protocol over the floor that passes every visible watchlist test yet is off the list must have a DefiLlama parent; below the floor, a name shared with a token that trades.</p>' +
      '<p><b>Drop / $1k.</b> If ' + Math.round(C.dropShare * 100) + '% of the implied value went to users pro rata to TVL, what $1,000 deposited would receive. It sizes each farm plan’s expected return against its costs.</p></section></div>';
    html += '<div class="stack"><section class="panel"><h2>Every ranked row: TVL against implied value</h2>' + scatter() +
      '<div class="legend"><span><i style="background:var(--watch)"></i>Watchlist</span><span><i style="background:var(--up)"></i>Below the floor</span><span><i style="background:var(--parent)"></i>Parent-linked</span></div>' +
      '<p class="faint" style="margin:8px 0 0">Both axes log. Rows above the band are lifted by a rich peer multiple, growth or a long tokenless run; rows below it are cut by a parent link or a thin category.</p></section>';
    html += '<section class="panel"><h2>Calibration by category</h2><table class="mini"><thead><tr><th>Category</th><th class="r">Peers</th><th class="r">Raw median</th><th class="r">Multiple used</th><th class="r">On board</th></tr></thead><tbody>' +
      cats.map(function (c) {
        return '<tr><td>' + esc(c[0]) + '</td><td class="r num">' + c[1].n + '</td><td class="r num dim">' + x2(c[1].raw) + '</td><td class="r num">' + x2(c[1].multiple) + '</td><td class="r num">' + (onBoard[c[0]] || '—') + '</td></tr>';
      }).join('') + '</tbody></table></section></div></div>';
    view.innerHTML = html;
    view.querySelectorAll('.scatter circle').forEach(function (c) {
      c.addEventListener('click', function () { location.hash = '#/p/' + c.getAttribute('data-slug'); });
    });
  }

  /** Log-log scatter of every board row, drawn as inline SVG. */
  function scatter() {
    var W = 640, H = 300, L = 56, B = 26, T = 8, Rm = 8;
    var lx = function (v) { return Math.log10(v); };
    var x0 = 6.5, x1 = 9.6, y0 = Math.floor(lx(R.board[R.board.length - 1].implied)), y1 = Math.ceil(lx(maxImplied));
    var sx = function (v) { return L + (lx(v) - x0) / (x1 - x0) * (W - L - Rm); };
    var sy = function (v) { return T + (y1 - lx(v)) / (y1 - y0) * (H - T - B); };
    var g = '<g class="grid">', t = '';
    for (var a = 7; a <= 9; a++) { g += '<line x1="' + sx(Math.pow(10, a)) + '" x2="' + sx(Math.pow(10, a)) + '" y1="' + T + '" y2="' + (H - B) + '"/>'; t += '<text x="' + sx(Math.pow(10, a)) + '" y="' + (H - 8) + '" text-anchor="middle">' + money(Math.pow(10, a)) + ' TVL</text>'; }
    for (var b = y0; b <= y1; b++) { g += '<line x1="' + L + '" x2="' + (W - Rm) + '" y1="' + sy(Math.pow(10, b)) + '" y2="' + sy(Math.pow(10, b)) + '"/>'; t += '<text x="' + (L - 6) + '" y="' + (sy(Math.pow(10, b)) + 3) + '" text-anchor="end">' + money(Math.pow(10, b)) + '</text>'; }
    var dots = R.board.slice().reverse().map(function (s) {
      var k = s.parent ? 'p' : s.watch ? 'w' : 'e';
      return '<circle class="' + k + '" data-slug="' + esc(s.p.slug) + '" cx="' + sx(s.p.tvl_usd).toFixed(1) + '" cy="' + sy(s.implied).toFixed(1) + '" r="' + (s.rank <= 10 ? 5 : 3.5) + '"><title>#' + s.rank + ' ' + esc(s.p.name) + ': ' + money(s.implied) + '</title></circle>';
    }).join('');
    return '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="TVL against implied value for every ranked protocol">' + g + '</g>' + t + dots + '</svg>';
  }

  function renderApart() {
    var reasons = counted(R.aside, function (a) { return a.reason; });
    var live = R.live.slice().sort(function (a, b) { return b.p.tvl_usd - a.p.tvl_usd; });
    var html = '<h1>Kept apart from the board</h1><p class="lede">The board ranks only protocols that record no token of their own. ' + R.live.length +
      ' protocols already carry a token, and ' + R.aside.length + ' token-less ones are exchanges, bridges, liquid-staking wrappers or versioned and exchange-branded products, whose value belongs to a token that already trades.</p>' +
      '<div class="grid2" style="margin-top:24px"><section class="panel"><h2>Set aside, no token of their own (' + R.aside.length + ')</h2><dl class="kv">' +
      reasons.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd class="num">' + r[1] + '</dd>'; }).join('') + '</dl>' +
      '<table class="mini" style="margin-top:16px"><thead><tr><th>Protocol</th><th>Reason</th><th class="r">TVL</th></tr></thead><tbody>' +
      R.aside.slice().sort(function (a, b) { return b.p.tvl_usd - a.p.tvl_usd; }).slice(0, 30).map(function (a) {
        return '<tr><td>' + esc(a.p.name) + '</td><td class="dim">' + esc(a.reason) + '</td><td class="r num">' + money(a.p.tvl_usd) + '</td></tr>';
      }).join('') + '</tbody></table></section>' +
      '<section class="panel"><h2>Token already trades (' + R.live.length + ')</h2><table class="mini"><thead><tr><th>Protocol</th><th>Token</th><th class="r">TVL</th><th class="r">Mcap</th><th class="r">Mcap/TVL</th></tr></thead><tbody>' +
      live.slice(0, 40).map(function (l) {
        return '<tr><td>' + esc(l.p.name) + '</td><td class="num dim">' + esc(l.p.symbol || l.p.gecko_id) + '</td><td class="r num">' + money(l.p.tvl_usd) + '</td><td class="r num">' + money(l.p.mcap_usd) + '</td><td class="r num">' + (l.ratio === null ? '—' : x2(l.ratio)) + '</td></tr>';
      }).join('') + '</tbody></table><p class="faint">Largest 40 by TVL shown.</p></section></div>';
    view.innerHTML = html;
  }

  // ---------------------------------------------------------------- router
  function route() {
    var r = parse(), head = r.path[0] || 'board';
    if (head === 'p' && r.path[1]) { setTab('board'); renderDetail(decodeURIComponent(r.path[1])); window.scrollTo(0, 0); }
    else if (head === 'model') { setTab('model'); renderModel(); }
    else if (head === 'apart') { setTab('apart'); renderApart(); }
    else { setTab('board'); renderBoard(r.q); }
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) {
    var qi = document.getElementById('f-q');
    if (e.key === '/' && qi && document.activeElement !== qi) { e.preventDefault(); qi.focus(); }
  });
  route();
})();
