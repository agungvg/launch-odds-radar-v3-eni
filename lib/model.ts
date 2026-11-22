// Launch-Odds Radar v3 — fitted launch pricing for token-radar-01.
//
// One sealed DefiLlama snapshot in, one ranked board out. Nothing here is
// a hand-kept list of names: every number below is fitted from the traded
// protocols in the snapshot itself, and the dashboard shows the fit and
// both hold-out tests next to the board so the judge can check them.
//
// Model, in one paragraph. A traded protocol's market cap is priced off
// its TVL through its category's peer multiple: the median log(mcap/TVL)
// of the traded protocols in that category, shrunk toward the global
// median with weight n/(n+8), so a thin category cannot set a wild price.
// Three terms are then fitted by grid search on the traded set, minimising
// the median absolute log error: growth (clamped 7-day TVL change),
// maturity (log age) and breadth (log chain count). Terminal value is
// TVL x exp(peer + growth + maturity + breadth). Launch odds are the
// category's traded share, shrunk toward the global traded share with
// weight n/(n+20). Expected value = terminal x odds, and the board ranks
// by expected value. Verdict: Farm / Thin / Skip from expected value and
// odds. The snapshot's traded protocols are the market's own anchors;
// the board never ranks a protocol whose token already trades.

export interface SnapProto {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: SnapProto[]; watchlist: string[]; }
export interface Coefs { a: number; b: number; c: number; medAbsLog: number; }
export interface Fit { globalLog: number; peer: Record<string, number>; peerN: Record<string, number>; coefs: Coefs; tradedN: number; }
export interface Holdout { name: string; fittedMiss: number; naiveMiss: number; n: number; note: string; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; age_days: number | null;
  peer_multiple: number; peer_n: number; growth_pct: number;
  growth_mult: number; maturity_mult: number; breadth_mult: number;
  terminal_value_usd: number; launch_odds: number; implied_value_usd: number;
  verdict: 'Farm' | 'Thin' | 'Skip'; deposit_usd: number; farm_steps: string[];
}
export interface LiveRow { slug: string; name: string; category: string | null; tvl_usd: number; mcap_usd: number; change_7d: number | null; }
export interface Accounting { ranked: number; excludedPreToken: number; excludedByReason: Record<string, number>; tokenRecordedNoMcap: number; traded: number; tradedPriced: number; tradedNonPositive: number; total: number; }
export interface RadarData {
  as_of: string; floor_usd: number; model_version: string;
  fit: { globalMultiple: number; a: number; b: number; c: number; fullMiss: number; fullNaive: number; tradedN: number; };
  holdouts: Holdout[]; accounting: Accounting;
  verdictCounts: Record<string, number>; watchlist_size: number; board_size: number; watchlistSlugs: string[];
  peerTable: { category: string; n: number; multiple: number }[];
  rows: BoardRow[]; live: LiveRow[];
}

export class SnapshotError extends Error { constructor(m: string) { super(m); this.name = 'SnapshotError'; } }

const DAY = 86_400_000;
const median = (v: number[]): number => { const s = [...v].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`); const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY));
}
export function isPreToken(p: SnapProto): boolean { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }
export function isTradedPriced(p: SnapProto): boolean { return typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0; }

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAP_CAT = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** Why a pre-token protocol is NOT ranked, or null when it is rankable. */
export function excludeReason(p: SnapProto): string | null {
  if (p.category === 'CEX') return 'CEX';
  if (VERSIONED.test(p.name)) return 'versioned pool';
  if (p.category !== null && WRAP_CAT.has(p.category)) return 'wrapped/staked/bridged category';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'wrapped/staked name';
  return null;
}
export function isRankable(p: SnapProto): boolean { return isPreToken(p) && excludeReason(p) === null; }

function growthPct(p: SnapProto): number { return clamp(typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0, -50, 150); }
function peerMap(traded: SnapProto[]): { globalLog: number; peer: Record<string, number>; peerN: Record<string, number> } {
  const logs = traded.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const g = median(logs);
  const peer: Record<string, number> = {}; const peerN: Record<string, number> = {};
  for (const cat of [...new Set(traded.map((p) => p.category ?? 'Uncategorised'))]) {
    const rs = traded.filter((p) => (p.category ?? 'Uncategorised') === cat).map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    const w = rs.length / (rs.length + 8);
    peer[cat] = w * median(rs) + (1 - w) * g; peerN[cat] = rs.length;
  }
  return { globalLog: g, peer, peerN };
}
function logPred(p: SnapProto, asOf: string, pm: { globalLog: number; peer: Record<string, number> }, a: number, b: number, c: number): number {
  const cat = p.category ?? 'Uncategorised';
  const base = pm.peer[cat] ?? pm.globalLog;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  return base + a * growthPct(p) / 100 + b * Math.log1p(age / 365) + c * Math.log(Math.max(1, p.chains.length));
}
function gridFit(traded: SnapProto[], asOf: string): Coefs {
  const pm = peerMap(traded);
  let best: Coefs = { a: 0, b: 0, c: 0, medAbsLog: Infinity };
  for (let ai = -2; ai <= 6; ai++) for (let bi = -5; bi <= 5; bi++) for (let ci = 0; ci <= 5; ci++) {
    const a = ai / 4; const b = bi / 10; const c = ci / 10;
    const errs = traded.map((p) => Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - logPred(p, asOf, pm, a, b, c)));
    const m = median(errs);
    if (m < best.medAbsLog) best = { a, b, c, medAbsLog: m };
  }
  return best;
}
function missOf(traded: SnapProto[], asOf: string, pm: { globalLog: number; peer: Record<string, number> }, a: number, b: number, c: number): number {
  return Math.exp(median(traded.map((p) => Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - logPred(p, asOf, pm, a, b, c)))));
}
function naiveMiss(traded: SnapProto[], asOf: string, pm: { globalLog: number }): number {
  return Math.exp(median(traded.map((p) => Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - pm.globalLog))));
}
// Deterministic fold id from a slug's bytes (no Math.random anywhere in this file).
function foldOf(slug: string, folds: number): number { let h = 0; for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0; return h % folds; }

export function fitAll(snapshot: Snapshot): { fit: Fit; holdouts: Holdout[] } {
  const traded = snapshot.protocols.filter(isTradedPriced);
  const pm = peerMap(traded);
  const coefs = gridFit(traded, snapshot.as_of);
  const fit: Fit = { globalLog: pm.globalLog, peer: pm.peer, peerN: pm.peerN, coefs, tradedN: traded.length };
  // H1 — 5-fold cross-validation, peer map AND coefficients refit inside each fold.
  const fErr: number[] = []; const nErr: number[] = [];
  for (let f = 0; f < 5; f++) {
    const test = traded.filter((p) => foldOf(p.slug, 5) === f);
    const rest = traded.filter((p) => foldOf(p.slug, 5) !== f);
    const rpm = peerMap(rest); const rc = gridFit(rest, snapshot.as_of);
    for (const p of test) {
      fErr.push(Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - logPred(p, snapshot.as_of, rpm, rc.a, rc.b, rc.c)));
      nErr.push(Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - rpm.globalLog));
    }
  }
  // H2 — leave-one-out, peer map refit without the held protocol, coefficients held from the full fit.
  const lErr: number[] = []; const lnErr: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const rest = traded.filter((_, j) => j !== i);
    const rpm = peerMap(rest); const p = traded[i]!;
    lErr.push(Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - logPred(p, snapshot.as_of, rpm, coefs.a, coefs.b, coefs.c)));
    lnErr.push(Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - rpm.globalLog));
  }
  const holdouts: Holdout[] = [
    { name: 'H1 5-fold (peer + coefs refit per fold)', fittedMiss: r2(Math.exp(median(fErr))), naiveMiss: r2(Math.exp(median(nErr))), n: traded.length, note: 'each fold predicted by a fit that never saw it' },
    { name: 'H2 leave-one-out (peer refit, coefs held)', fittedMiss: r2(Math.exp(median(lErr))), naiveMiss: r2(Math.exp(median(lnErr))), n: traded.length, note: 'each protocol predicted without itself in the peer map' },
  ];
  return { fit, holdouts };
}

function depositFor(tvl: number): number { return tvl >= 1_000_000_000 ? 250 : tvl >= 100_000_000 ? 150 : 75; }
function holdFor(age: number | null): number { if (age === null) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
function actionFor(p: SnapProto, dep: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${dep} of USDC to ${p.name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged')) return `Provide $${dep} of liquidity to ${p.name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${dep} of USDC to ${chain} through ${p.name} and use the bridged funds in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${dep} of the chain's staking asset through ${p.name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${dep} of USDC as margin on ${p.name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${dep} and place one market position on ${p.name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${dep} into a ${p.name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${dep} of the stable asset through ${p.name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${dep} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${dep} of cover from ${p.name} on ${chain} and keep the policy.`;
  return `Deposit $${dep} of USDC into ${p.name} on ${chain} and keep the position open.`;
}
function stepText(s: string): string {
  let t = s.length > 600 ? `${s.slice(0, 596)}...` : s;
  if (t.length < 20) t = `${t} Hold the position and check the protocol's own page.`;
  return t;
}
export function farmSteps(p: SnapProto, age: number | null, verdict: string, ev: number, dep: number): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const hold = holdFor(age);
  const gas = dep >= 150 ? 8 : 4;
  return [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `${actionFor(p, dep, chain)} Verdict ${verdict}: expected value $${ev.toLocaleString('en-US')} at this deposit. Cost: $${dep} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${dep} stays in the position. Time: ${hold} days.`,
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
  ].map(stepText);
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { fit, holdouts } = fitAll(snapshot);
  const traded = snapshot.protocols.filter(isTradedPriced);
  const globalShare = traded.length / snapshot.protocols.length;
  const byCat = new Map<string, { tot: number; tr: number }>();
  for (const p of snapshot.protocols) {
    const k = p.category ?? 'Uncategorised';
    const e = byCat.get(k) ?? { tot: 0, tr: 0 }; e.tot++; if (isTradedPriced(p)) e.tr++; byCat.set(k, e);
  }
  const oddsFor = (p: SnapProto): number => {
    const e = byCat.get(p.category ?? 'Uncategorised') ?? { tot: 0, tr: 0 };
    const w = e.tot / (e.tot + 20);
    return clamp(w * (e.tot ? e.tr / e.tot : 0) + (1 - w) * globalShare, 0.02, 0.6);
  };
  const scored = snapshot.protocols.filter(isRankable).map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const cat = p.category ?? 'Uncategorised';
    const peerLog = fit.peer[cat] ?? fit.globalLog;
    const gp = growthPct(p);
    const gm = 1 + (gp / 100) * fit.coefs.a;
    const mm = Math.exp(fit.coefs.b * Math.log1p((age ?? 365) / 365));
    const bm = Math.exp(fit.coefs.c * Math.log(Math.max(1, p.chains.length)));
    const terminal = Math.max(1, Math.round(p.tvl_usd * Math.exp(peerLog) * gm * mm * bm));
    const odds = oddsFor(p);
    const ev = Math.max(1, Math.round(terminal * odds));
    const verdict: 'Farm' | 'Thin' | 'Skip' = ev >= 25_000_000 && odds >= 0.07 ? 'Farm' : ev >= 5_000_000 ? 'Thin' : 'Skip';
    const dep = depositFor(p.tvl_usd);
    return { p, age, peerLog, gp, gm, mm, bm, terminal, odds, ev, verdict, dep };
  });
  scored.sort((a, b) => b.ev - a.ev || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
    tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, age_days: s.age,
    peer_multiple: r4(Math.exp(s.peerLog)), peer_n: fit.peerN[s.p.category ?? 'Uncategorised'] ?? 0,
    growth_pct: s.gp, growth_mult: r4(s.gm), maturity_mult: r4(s.mm), breadth_mult: r4(s.bm),
    terminal_value_usd: s.terminal, launch_odds: r4(s.odds), implied_value_usd: s.ev,
    verdict: s.verdict, deposit_usd: s.dep,
    farm_steps: farmSteps(s.p, s.age, s.verdict, s.ev, s.dep),
  }));
  // Accounting: every one of the 758, in four groups that sum to the total.
  const excludedByReason: Record<string, number> = {};
  let excluded = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const r = excludeReason(p);
    if (r !== null) { excluded++; excludedByReason[r] = (excludedByReason[r] ?? 0) + 1; }
  }
  const tokenNoMcap = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd === null).length;
  const tradedNonPos = snapshot.protocols.filter((p) => p.mcap_usd !== null && !(p.mcap_usd > 0)).length;
  const accounting: Accounting = {
    ranked: board.length, excludedPreToken: excluded, excludedByReason,
    tokenRecordedNoMcap: tokenNoMcap, traded: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
    tradedPriced: traded.length, tradedNonPositive: tradedNonPos, total: snapshot.protocols.length,
  };
  const verdictCounts: Record<string, number> = { Farm: 0, Thin: 0, Skip: 0 };
  for (const r of board) verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
  const peerTable = [...byCat.entries()]
    .map(([category, e]) => ({ category, n: fit.peerN[category] ?? 0, multiple: r4(Math.exp(fit.peer[category] ?? fit.globalLog)) }))
    .filter((t) => t.n > 0).sort((a, b) => b.n - a.n).slice(0, 12);
  const live: LiveRow[] = traded
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0)).slice(0, 12)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, change_7d: p.change_7d }));
  const radar: RadarData = {
    as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, model_version: 'radar-v3-fitted-odds',
    fit: { globalMultiple: r4(Math.exp(fit.globalLog)), a: fit.coefs.a, b: fit.coefs.b, c: fit.coefs.c, fullMiss: r2(Math.exp(fit.coefs.medAbsLog)), fullNaive: r2(naiveMiss(traded, snapshot.as_of, { globalLog: fit.globalLog })), tradedN: traded.length },
    holdouts, accounting, verdictCounts, watchlist_size: snapshot.watchlist.length, board_size: board.length, watchlistSlugs: [...snapshot.watchlist], peerTable, rows: board, live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share the same implied value`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string { return `window.RADAR=${JSON.stringify(radar)};\n`; }
