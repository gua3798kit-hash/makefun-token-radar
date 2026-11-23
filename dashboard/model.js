/* Pre-token radar: the value model and the farm planner.
 * One file, run twice: main.ts evaluates it under node:vm to write board.json, and the page loads it
 * as a plain script to recompute every number it shows from the raw snapshot in data.js. Nothing in
 * here names a protocol: every row is scored by the same functions from the snapshot's own fields.
 *
 * implied = TVL x peerMultiple(category) x growth(change_7d) x tokenless(age) x breadth(chains) x parent
 *
 *   peerMultiple  what the market pays per $1 of TVL for tokens that already trade in the same category,
 *                 read from the snapshot's own mcap_usd / tvl_usd (log-median, shrunk to the global median)
 *   growth        sqrt of the 7-day TVL ratio, change clamped to -50%..+100%  -> 0.71x..1.41x
 *   tokenless     days since listed_at with no token: 0.70x at launch, 1.15x at two years, fading to 1.00x
 *                 after five (a long wait shows retention, a very long one lowers the odds of a launch)
 *   breadth       +4% per extra chain, up to 6 chains                         -> 1.00x..1.20x
 *   parent        0.5x when the token would likely accrue to a parent that already trades
 */
(function (root) {
  'use strict';

  var C = {
    winsorLo: 0.01, winsorHi: 5, shrinkK: 4,
    growthFloor: -50, growthCap: 100,
    ageFloor: 0.7, ageTop: 1.15, ageRampDays: 730, ageFadeStart: 1095, ageFadeDays: 730, ageFade: 0.15, unknownAgeDays: 365,
    breadthStep: 0.04, breadthMaxChains: 6,
    parentDiscount: 0.5,
    dropShare: 0.06
  };

  // The watchlist's own exclusion rules, as the snapshot README states them (parentProtocol aside).
  var SET_ASIDE_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPER_WORD = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function hasToken(p) { return p.gecko_id !== null || p.symbol !== null; }
  function familyKey(name) { var w = name.split(/[\s-]/)[0].toLowerCase(); return w.length >= 4 ? w : null; }
  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    return Math.max(0, Math.round((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 864e5));
  }

  /** Why a token-less protocol is a wrapper, a version or an exchange product, or null when it is its own. */
  function setAsideReason(p) {
    if (SET_ASIDE_CATEGORIES.indexOf(p.category) >= 0) return p.category + ' category';
    if (VERSIONED.test(p.name)) return 'versioned name';
    if (WRAPPER_WORD.test(p.name)) return 'wrapped / staked product';
    if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
    return null;
  }

  /** Peer multiples: the market's mcap / TVL for every category, from the protocols whose token trades. */
  function calibrate(protocols) {
    var logs = {}, all = [];
    protocols.forEach(function (p) {
      if (!hasToken(p) || !(p.mcap_usd > 0) || !(p.tvl_usd > 0)) return;
      var l = Math.log(clamp(p.mcap_usd / p.tvl_usd, C.winsorLo, C.winsorHi));
      var k = p.category || 'Uncategorised';
      (logs[k] = logs[k] || []).push(l);
      all.push(l);
    });
    var g = median(all);
    var cats = {};
    Object.keys(logs).forEach(function (k) {
      var n = logs[k].length, m = median(logs[k]);
      cats[k] = { n: n, raw: Math.exp(m), multiple: Math.exp((n * m + C.shrinkK * g) / (n + C.shrinkK)) };
    });
    return { global: Math.exp(g), peers: all.length, categories: cats };
  }

  function multipleFor(cal, category) {
    var c = cal.categories[category || 'Uncategorised'];
    return c ? c.multiple : cal.global;
  }

  function growthMult(change) {
    if (change === null || change === undefined) return 1;
    return Math.sqrt(1 + clamp(change, C.growthFloor, C.growthCap) / 100);
  }

  function tokenlessMult(age) {
    var d = age === null ? C.unknownAgeDays : age;
    var m = C.ageFloor + (C.ageTop - C.ageFloor) * Math.min(d, C.ageRampDays) / C.ageRampDays;
    if (d > C.ageFadeStart) m -= C.ageFade * Math.min((d - C.ageFadeStart) / C.ageFadeDays, 1);
    return m;
  }

  function breadthMult(chains) {
    return 1 + C.breadthStep * Math.max(0, Math.min(chains.length, C.breadthMaxChains) - 1);
  }

  /** Score one protocol: every factor of its implied value, so the page can show the build-up. */
  function score(p, snap, cal, ctx) {
    var age = ageDays(snap.as_of, p.listed_at);
    var parent = null;
    if (!ctx.watch[p.slug]) {
      if (p.tvl_usd >= snap.floor_usd) parent = 'DefiLlama files it under a parent protocol (it meets every visible watchlist test yet is off the list)';
      else if (ctx.families[familyKey(p.name)]) parent = 'shares its name with ' + ctx.families[familyKey(p.name)] + ', whose token trades';
    }
    var f = {
      multiple: multipleFor(cal, p.category),
      growth: growthMult(p.change_7d),
      tokenless: tokenlessMult(age),
      breadth: breadthMult(p.chains),
      parent: parent ? C.parentDiscount : 1
    };
    var implied = Math.max(1, Math.round(p.tvl_usd * f.multiple * f.growth * f.tokenless * f.breadth * f.parent));
    return {
      p: p, age: age, factors: f, parent: parent, implied: implied,
      watch: !!ctx.watch[p.slug],
      dropPer1k: Math.round(C.dropShare * implied / p.tvl_usd * 1000 * 100) / 100
    };
  }

  // ------------------------------------------------------------------ farm planner

  // Assumed cost of one ordinary DeFi transaction in USD (Nov 2026 orders of magnitude, not snapshot data).
  var GAS = {
    Ethereum: 1.5, Bitcoin: 1.2, Tron: 1.0, Binance: 0.06, Avalanche: 0.05, Polygon: 0.02, Arbitrum: 0.03,
    Base: 0.02, Optimism: 0.02, Ink: 0.02, Linea: 0.03, Scroll: 0.03, Unichain: 0.02, Sonic: 0.02, Berachain: 0.02,
    Monad: 0.01, Plasma: 0.01, 'Hyperliquid L1': 0.01, Solana: 0.01, Sui: 0.01, Aptos: 0.01, TON: 0.03,
    Ripple: 0.01, Stellar: 0.01, Algorand: 0.01, Cardano: 0.2, Flare: 0.01, Near: 0.01, Starknet: 0.03
  };
  var MAJOR = ['Ethereum', 'Arbitrum', 'Base', 'Optimism', 'Solana', 'Binance', 'Avalanche', 'Polygon', 'Tron', 'Bitcoin', 'Sui', 'Ripple', 'Stellar', 'Algorand', 'TON', 'Aptos', 'Cardano'];
  var OTHER_GAS = 0.05;

  /** The chain to farm on: the cheapest of the first three DefiLlama lists, unpriced chains last. */
  function farmChain(chains) {
    var best = chains[0] || 'Ethereum';
    chains.slice(0, 3).forEach(function (c) {
      var g = GAS[c] === undefined ? 9 : GAS[c], b = GAS[best] === undefined ? 9 : GAS[best];
      if (g < b) best = c;
    });
    return best;
  }

  var KIND = {
    lend: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management', 'Leveraged Farming', 'Dual-Token Stablecoin'],
    vault: ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Liquidity Manager', 'Basis Trading', 'Options Vault', 'Farm', 'Indexes', 'Governance Incentives'],
    trade: ['Dexs', 'Derivatives', 'Options', 'Prediction Market', 'Interest Rate Derivatives', 'OTC Marketplace', 'Synthetics', 'Launchpad'],
    rwa: ['RWA', 'Stablecoin Issuer', 'Stablecoin Wrapper', 'Algo-Stables', 'Reserve Currency', 'CeDeFi'],
    stake: ['Restaking', 'Staking Pool', 'Collateral Markets', 'Anchor BTC', 'Decentralized BTC'],
    chain: ['Chain', 'Cross Chain Bridge', 'Payments', 'Privacy', 'Crypto Card Issuer', 'Insurance', 'AI Agents']
  };
  function kindOf(category) {
    for (var k in KIND) if (KIND[k].indexOf(category) >= 0) return k;
    return 'chain';
  }

  function usd(x) { return x >= 100 ? '$' + Math.round(x).toLocaleString('en-US') : '$' + (Math.round(x * 100) / 100).toFixed(2); }

  /** The core moves for one kind of protocol: [title, text, transactions, minutes]. */
  function coreMoves(kind, n, t, chain) {
    var T = usd(t);
    switch (kind) {
      case 'lend': return [
        ['Supply', 'Supply ' + T + ' of USDC (or the stablecoin ' + n + ' lists with the deepest market) on ' + chain + '. Approve + supply is 2 transactions.', 2, 10],
        ['Borrow lightly', 'Borrow 20% of the supplied value in a second asset and leave it borrowed: borrow-side use is usually weighted above supply in points schemes. Keep the health factor above 2.0 so a 40% move cannot liquidate you.', 1, 5]];
      case 'vault': return [
        ['Pick the vault', 'On ' + n + '\'s app, pick its largest stablecoin vault on ' + chain + ' and read the redemption terms: note any withdrawal queue or lock (often 1 to 7 days) before you deposit.', 0, 15],
        ['Deposit', 'Deposit ' + T + ' USDC into that vault (approve + deposit, 2 transactions) and keep the vault-share receipt token in the same wallet: moving it can drop the position from a points snapshot.', 2, 10]];
      case 'trade': return [
        ['Provide liquidity', 'Put half of the ticket (' + usd(t / 2) + ') in ' + n + '\'s deepest stable or major pair on ' + chain + ', in a wide range so it needs no rebalancing. Approve + add is 2 transactions.', 2, 15],
        ['Trade weekly', 'With the other half, do $2,000 of volume a week (perps at 1-2x or spot round trips). At about 0.05% a side that is $2 a week in fees; skip weeks rather than wash-trade the same pair.', 0, 10]];
      case 'rwa': return [
        ['Onboard', 'Open ' + n + '\'s mint or deposit page on ' + chain + '. Issuers of real-world assets often gate minting to verified wallets: if KYC is asked, allow 1 to 3 days for approval before the clock starts.', 0, 30],
        ['Mint and use', 'Mint or buy ' + T + ' of its yield-bearing asset (2 transactions), then put it to work where the protocol lists integrations (a lending market or a pool), which often counts for more than holding.', 3, 15]];
      case 'stake': return [
        ['Choose the pool', 'Pick ' + n + '\'s most used pool or vault on ' + chain + ' and its operator, and read the unbonding period (often 7 to 21 days): your exit is that long.', 0, 20],
        ['Stake', 'Deposit ' + T + ' of the asset the pool takes (2 transactions). Keep the receipt token in place; restaking and staking points usually accrue per day of stake.', 2, 10]];
      default: return [
        ['Bridge in and use', 'Move ' + T + ' to ' + chain + ' and use ' + n + '\'s core product with it: one deposit or payment flow end to end, about 2 transactions.', 2, 20],
        ['Spread usage', 'Each week do one more real action in its ecosystem (a swap, a deposit, a payment) from the same wallet, so the wallet shows steady use rather than a single burst.', 0, 5]];
    }
  }

  /** Transactions and fixed fees a plan pays whatever its ticket: setup, weekly upkeep, exit, trading fees. */
  function fixedCost(kind, gas, bridge, weeks) {
    var txs = 2 + 1 + weeks + 2;
    return txs * gas + 2 * bridge + (kind === 'trade' ? 2 * weeks : 0);
  }

  /**
   * A concrete plan: what to do, what it costs and how long it takes, scaled to the protocol's own figures.
   * The ticket is the smallest deposit (in $250 steps, $250..$5,000) whose modelled drop covers the plan's
   * fixed costs five times over: a cheap chain and a rich drop per $1k mean a small ticket is enough.
   */
  function farmPlan(s) {
    var p = s.p, chain = farmChain(p.chains), kind = kindOf(p.category);
    var gas = GAS[chain] === undefined ? OTHER_GAS : GAS[chain];
    var hold = s.age === null || s.age >= 540 ? 60 : s.age >= 180 ? 90 : 120;
    var weeks = Math.round(hold / 7);
    var bridge = MAJOR.indexOf(chain) >= 0 ? 1 : 4;
    var fixed = fixedCost(kind, gas, bridge, weeks);
    var ticket = clamp(Math.ceil(5 * fixed / (s.dropPer1k / 1000) / 250) * 250, 250, 5000);
    var breakEven = Math.ceil(fixed / (s.dropPer1k / 1000));
    var moves = coreMoves(kind, p.name, ticket, chain);
    var steps = [];
    function add(title, text, txs, minutes, extra) {
      var cost = txs * gas + (extra || 0);
      steps.push({ title: title, text: text, cost: Math.round(cost * 100) / 100, minutes: minutes });
    }
    add('Check it is real', 'Open ' + p.name + ' from its DefiLlama listing, confirm the app domain against its docs and social links, and read the latest audit. DefiLlama records no token for it; check that no token or points claim has already passed.', 0, 20);
    add('Fund a wallet', 'Use a fresh wallet on ' + chain + ' with ' + usd(ticket) + ' of USDC plus ' + usd(Math.max(gas * 12, 1)) + ' of the gas token. Withdraw from an exchange or bridge from an L2: about ' + usd(bridge) + ' in fees and 10-30 minutes.', 0, 30, bridge);
    moves.forEach(function (m) { add(m[0], m[1], m[2], m[3], kind === 'trade' && m[0] === 'Trade weekly' ? 2 * weeks : 0); });
    add('Keep it alive', 'Once a week for ' + weeks + ' weeks, claim or compound and make one more interaction: about ' + weeks + ' transactions in all. Use any referral or points page the app shows and screenshot the balance on days 0, 30 and ' + hold + '.', weeks, 5 * weeks);
    add('Exit rules', 'Unwind if TVL falls more than 25% in a week, if the app changes its redemption terms, or once a token snapshot is announced. Withdraw + bridge out is about 2 transactions and ' + usd(bridge) + '.', 2, 20, bridge);
    var cost = 0, minutes = 0;
    steps.forEach(function (x) { cost += x.cost; minutes += x.minutes; });
    var drop = s.dropPer1k * ticket / 1000;
    var cover = cost > 0 ? drop / cost : 99;
    var verdict = cover >= 4 ? 'Worth a ticket' : cover >= 2 ? 'Marginal' : 'Costs dominate';
    steps.push({ title: 'Budget', text: 'Capital ' + usd(ticket) + ' at risk for ' + hold + ' days; fees and gas about ' + usd(cost) + '; about ' + Math.round(minutes / 6) / 10 + ' hours of work. If ' + Math.round(C.dropShare * 100) + '% of the implied value went to users pro rata to TVL, this ticket\'s share would be about ' + usd(drop) + ' (' + cover.toFixed(1) + 'x the costs: ' + verdict.toLowerCase() + '); below about ' + usd(breakEven) + ' deposited the costs outrun the modelled drop. A model figure, not a promise.', cost: 0, minutes: 0 });
    return { chain: chain, kind: kind, ticket: ticket, hold: hold, gas: gas, breakEven: breakEven, cover: Math.round(cover * 10) / 10, verdict: verdict, cost: Math.round(cost * 100) / 100, hours: Math.round(minutes / 6) / 10, drop: Math.round(drop * 100) / 100, steps: steps };
  }

  function stepText(x, i) {
    var tail = x.title === 'Budget' ? '' : ' (' + (x.cost ? 'cost ~' + usd(x.cost) : 'no cost') + ', ~' + x.minutes + ' min)';
    return (i + 1) + '. ' + x.title + ': ' + x.text + tail;
  }

  // ------------------------------------------------------------------ the radar

  /** The whole radar from one snapshot: the ranked pre-token board, the set-aside list and the live set. */
  function build(snap) {
    var cal = calibrate(snap.protocols);
    var ctx = { watch: {}, families: {} };
    snap.watchlist.forEach(function (s) { ctx.watch[s] = true; });
    snap.protocols.forEach(function (p) { var k = familyKey(p.name); if (hasToken(p) && k && !ctx.families[k]) ctx.families[k] = p.name; });

    var board = [], aside = [], live = [];
    snap.protocols.forEach(function (p) {
      if (hasToken(p)) { live.push({ p: p, ratio: p.mcap_usd > 0 ? p.mcap_usd / p.tvl_usd : null }); return; }
      var why = ctx.watch[p.slug] ? null : setAsideReason(p);
      if (why) aside.push({ p: p, reason: why });
      else board.push(score(p, snap, cal, ctx));
    });
    board.sort(function (a, b) { return b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1); });
    board.forEach(function (s, i) { s.rank = i + 1; s.plan = farmPlan(s); });
    return { constants: C, calibration: cal, board: board, aside: aside, live: live };
  }

  /** The gate's rows for board.json. */
  function boardRows(radar) {
    return radar.board.map(function (s) {
      return {
        slug: s.p.slug, name: s.p.name, rank: s.rank, implied_value_usd: s.implied,
        farm_steps: s.plan.steps.map(stepText),
        category: s.p.category, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, tokenless_days: s.age,
        watchlist: s.watch, parent_note: s.parent,
        factors: s.factors, drop_per_1k_usd: s.dropPer1k
      };
    });
  }

  root.RadarModel = { C: C, build: build, boardRows: boardRows, stepText: stepText, usd: usd };
})(typeof window !== 'undefined' ? window : globalThis);
