// Nova Radar — the valuation model for token-radar-01.
//
// SPDX-License-Identifier: MIT
//
// The entry reads one sealed DefiLlama snapshot and ranks every protocol that
// records no token yet. The ranking is a peer-multiple model computed from the
// snapshot itself — no name is ever special-cased, and every number the board
// shows can be traced back to the snapshot's own figures:
//
//   peer multiple   the median market-cap / TVL of the token-bearing
//                   protocols in the same category, shrunk toward the
//                   global median when the category has few peers.
//                   Each peer's own ratio is winsorised at 3x first:
//                   a token trading at 400x its TVL is a thin-TVL
//                   artefact, not a pricing anchor.
//   growth          1 + clamp(change_7d, -50, +150) / 100 * 0.6
//   maturity        0.80 + 0.20 * min(age_days, 1095) / 1095
//                   (age unknown: 0.90 — a protocol that has run for years
//                   with no token has had longer to earn a launch)
//   breadth         1 + 0.02 * min(chains - 1, 5)
//   launch factor   0.05 for categories that are not a launch at all
//                   (a centralised exchange, a bridge, a wrapped or
//                   staked product of a token that already trades),
//                   1.00 for everything else
//
//   implied_value_usd = round(tvl_usd * peer * growth * maturity
//                             * breadth * launch_factor), at least $1.
//
// Protocols whose token already trades are never ranked: they are set aside
// and shown with the market's own value, so the board stays a list of
// launches that have not happened yet.

export interface NovaProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface NovaSnapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: NovaProtocol[];
  watchlist: string[];
}

export interface NovaModelBreakdown {
  peer_multiple: number;
  category_peers: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  launch_factor: number;
  age_days: number | null;
}

export interface NovaBoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  launch_candidate: boolean;
  model: NovaModelBreakdown;
  farm_steps: string[];
}

export interface NovaLiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

export interface NovaRadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_peer_multiple: number;
  rows: NovaBoardRow[];
  live: NovaLiveRow[];
}

export class NovaSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NovaSnapshotError';
  }
}

export const NOVA_MODEL_VERSION = 'nova-comps-1';

// Categories that cannot be a token launch: an exchange, a bridge, or a
// wrapped / staked product of a token that already trades. They stay on the
// board (the snapshot lists them as pre-token) but their implied value is
// cut to 5% and they are flagged, so genuine launches rank above them.
const NON_LAUNCH_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const DAY_MS = 86_400_000;
const SHRINK_K = 4; // peers needed before a category's own median dominates
const WINSOR_CAP = 3; // no peer's mcap/TVL counts above 3x (thin-TVL artefacts)
const GROWTH_WEIGHT = 0.6;
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 150;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_FACTOR = 0.9;

/** Whole days from `listedAt` to `asOf`; null when either date is missing. */
export function novaAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A protocol is pre-token when the snapshot records no token for it. */
export function novaIsPreToken(p: NovaProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The peer multiples: for every category, the median mcap/TVL of its
 * token-bearing protocols, shrunk toward the global median. Categories with
 * no live peer at all fall back to the global median.
 */
export function novaPeerMultiples(
  protocols: NovaProtocol[],
): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const live = protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  // Winsorise each peer's ratio at WINSOR_CAP before any median is taken.
  const ratioOf = (p: NovaProtocol): number => Math.min(p.mcap_usd! / p.tvl_usd, WINSOR_CAP);
  const ratios = live.map(ratioOf);
  const global = ratios.length > 0 ? median(ratios) : 0.2;

  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const bucket = perCategory.get(key) ?? [];
    bucket.push(ratioOf(p));
    perCategory.set(key, bucket);
  }

  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, bucket] of perCategory) {
    const own = median(bucket);
    const shrunk = (bucket.length * own + SHRINK_K * global) / (bucket.length + SHRINK_K);
    byCategory.set(key, { multiple: shrunk, peers: bucket.length });
  }
  return { byCategory, global };
}

/** Score one pre-token protocol; every factor comes from the snapshot. */
export function novaScore(
  p: NovaProtocol,
  asOf: string,
  peers: { byCategory: Map<string, { multiple: number; peers: number }>; global: number },
): { implied: number; breakdown: NovaModelBreakdown } {
  const cat = peers.byCategory.get(p.category ?? 'Uncategorised');
  const peerMultiple = cat ? cat.multiple : peers.global;
  const categoryPeers = cat ? cat.peers : 0;

  const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, GROWTH_FLOOR, GROWTH_CAP);
  const growthFactor = 1 + (growthPct / 100) * GROWTH_WEIGHT;

  const age = novaAgeDays(asOf, p.listed_at);
  const maturityFactor =
    age === null ? UNKNOWN_AGE_FACTOR : 0.8 + (0.2 * Math.min(age, MATURITY_DAYS)) / MATURITY_DAYS;

  const breadthFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);

  const launchCandidate = !NON_LAUNCH_CATEGORIES.has(p.category ?? '');
  const launchFactor = launchCandidate ? 1 : 0.05;

  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * peerMultiple * growthFactor * maturityFactor * breadthFactor * launchFactor),
  );
  return {
    implied,
    breakdown: {
      peer_multiple: peerMultiple,
      category_peers: categoryPeers,
      growth_pct: growthPct,
      growth_factor: growthFactor,
      maturity_factor: maturityFactor,
      breadth_factor: breadthFactor,
      launch_factor: launchFactor,
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------- farm plans

const GAS_HINTS: Record<string, string> = {
  Ethereum: 'about $1-$4 of gas per transaction on Ethereum',
  Binance: 'about $0.03-$0.10 of gas per transaction on BNB Chain',
  Solana: 'about $0.001 of gas per transaction on Solana',
  Base: 'about $0.01-$0.05 of gas per transaction on Base',
  Arbitrum: 'about $0.01-$0.05 of gas per transaction on Arbitrum',
  Optimism: 'about $0.01-$0.05 of gas per transaction on Optimism',
  Polygon: 'about $0.01-$0.05 of gas per transaction on Polygon',
  Avalanche: 'about $0.05-$0.20 of gas per transaction on Avalanche',
  Hyperliquid: 'about $0.01 of gas per transaction on Hyperliquid',
};

function gasHint(chains: string[]): string {
  for (const chain of chains) {
    if (GAS_HINTS[chain] !== undefined) return GAS_HINTS[chain]!;
  }
  return 'a few cents of gas per transaction on this chain';
}

/** Category-flavoured opening actions; the generic set fits any protocol. */
function categoryActions(p: NovaProtocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasHint(p.chains);
  switch (p.category) {
    case 'Dexs':
      return [
        `Swap $25-$100 of tokens through ${p.name} on ${chain} once a week for 4-8 weeks, ${gas}; each swap is one on-chain touch the protocol can see.`,
        `Provide $50-$200 of liquidity to one of ${p.name}'s largest pools on ${chain} and keep it in for at least 30 days; expect $0.50-$2 of gas to add and the same again to remove it.`,
        `If ${p.name} runs a points or volume program, opt in before your first trade and check the leaderboard weekly, about 10 minutes a week.`,
      ];
    case 'Lending':
      return [
        `Supply $50-$200 of a major asset (ETH, USDC or wBTC) to ${p.name} on ${chain} and leave it supplied for 30-60 days, ${gas} per deposit or withdrawal.`,
        `Borrow 20-40% of your supplied value against it once, then repay within two weeks, so the position shows both sides of the market; budget $1-$5 of gas for the round trip.`,
        `Keep the health factor above 2.0 the whole time and check the position twice a week, about 5 minutes per check, so a price move never liquidates you.`,
      ];
    case 'Yield':
    case 'Yield Aggregator':
      return [
        `Deposit $50-$200 into ${p.name}'s highest-TVL vault on ${chain} and hold the position for 30-60 days, ${gas} to enter and the same to exit.`,
        `Claim or compound the vault's yield once a month rather than daily, so gas stays under 5% of what the position earns; about 10 minutes per harvest.`,
        `Try a second vault on a different asset after two weeks, so your activity spans more than one product instead of a single deposit.`,
      ];
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaking':
      return [
        `Stake $50-$200 of the underlying asset through ${p.name} on ${chain} and hold the receipt token for at least 30 days, ${gas} to stake.`,
        `Use the receipt token once in another protocol (as collateral or in a pool) so the position shows real usage, not a passive hold; budget $1-$3 of gas.`,
        `Note that ${p.name} is a staked product, so a token launch of its own is unlikely — farm it for yield, not for an airdrop.`,
      ];
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return [
        `Bridge $25-$100 between two chains ${p.name} supports once every 1-2 weeks for a month, ${gas} per crossing plus the destination chain's fee.`,
        `Use a different source chain at least once, so the activity is not a single repeated route; each crossing takes about 10-20 minutes to finalise.`,
        `Note that a bridge moves other tokens rather than issuing its own, so a launch here is unlikely — farm it only if you already need the crossing.`,
      ];
    case 'CDP':
      return [
        `Open a collateralised debt position on ${p.name} with $100-$300 of collateral on ${chain}, mint 20-30% of its value, and hold it for 30 days, ${gas}.`,
        `Repay half the minted amount after two weeks and re-mint it, showing repeated use of the facility; budget $1-$4 of gas for the round trip.`,
        `Keep the collateral ratio above 200% and check it weekly, about 5 minutes per check, so a dip never triggers liquidation.`,
      ];
    case 'RWA':
      return [
        `Hold $100-$500 of ${p.name}'s tokenised real-world asset on ${chain} for 30-60 days, ${gas} to buy and the same to sell.`,
        `If ${p.name} offers a vault or lending market for the asset, deposit a slice of the holding there for two weeks to show a second touch; about 15 minutes to set up.`,
        `Track the asset's redemption terms before you buy, and keep the position small enough that a 30-day lock would not hurt.`,
      ];
    case 'CEX':
      return [
        `This is a centralised exchange, not a protocol launch: there is no on-chain farming path, and any token it issues would come through its own account system, not a wallet.`,
        `If you already hold an account, keep normal trading activity there and watch its official announcements; do not buy a token on rumour.`,
        `Do not send funds to a lookalike site promising an early allocation — verify every link on the exchange's own domain first.`,
      ];
    default:
      return [
        `Use ${p.name}'s core product on ${chain} with $25-$100 once a week for 4-8 weeks, ${gas} per interaction; repeated use beats one large deposit.`,
        `If ${p.name} lists a second product (a vault, a pool or a market), try it once with a small amount after two weeks, so the activity covers more than one feature.`,
        `Follow ${p.name}'s official announcements for a points program or testnet, and join it in the first week if one opens; about 15 minutes to register.`,
      ];
  }
}

/**
 * A farm plan: the category actions first, then the shared tail — a
 * position-size rule and a record-keeping rule. Every step is 20-600
 * characters, concrete, with a cost and a time.
 */
export function novaFarmSteps(p: NovaProtocol): string[] {
  const steps = categoryActions(p);
  steps.push(
    `Size the whole farm at an amount you can leave untouched for 60 days, and never more than 5% of your portfolio in any single unlaunched protocol.`,
    `Keep a one-line log of every transaction hash, date and amount in a notes file, so you can prove each touch later; about 2 minutes after each interaction.`,
  );
  return steps.slice(0, 6);
}

// ---------------------------------------------------------------- the board

/** Parse and validate the sealed snapshot; throws NovaSnapshotError. */
export function novaParseSnapshot(text: string): NovaSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new NovaSnapshotError('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new NovaSnapshotError('snapshot is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || typeof doc.source !== 'string') {
    throw new NovaSnapshotError('snapshot is missing as_of or source');
  }
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new NovaSnapshotError('snapshot is missing protocols or watchlist');
  }
  return doc as unknown as NovaSnapshot;
}

/**
 * Build the ranked board: every pre-token protocol in the snapshot, ranked
 * by implied value (ties broken by TVL, then slug), plus the live-token set
 * aside for the dashboard's market view.
 */
export function novaBuildBoard(snapshot: NovaSnapshot): { rows: NovaBoardRow[]; live: NovaLiveRow[]; data: NovaRadarData } {
  const peers = novaPeerMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);

  const scored = snapshot.protocols
    .filter(novaIsPreToken)
    .map((p) => {
      const { implied, breakdown } = novaScore(p, snapshot.as_of, peers);
      return { p, implied, breakdown };
    })
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: NovaBoardRow[] = scored.map(({ p, implied, breakdown }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: breakdown.age_days,
    implied_value_usd: implied,
    on_watchlist: watchlist.has(p.slug),
    launch_candidate: breakdown.launch_factor === 1,
    model: breakdown,
    farm_steps: novaFarmSteps(p),
  }));

  const live: NovaLiveRow[] = snapshot.protocols
    .filter((p) => !novaIsPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 60)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null,
    }));

  const data: NovaRadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: NOVA_MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    live_size: live.length,
    global_peer_multiple: peers.global,
    rows: rows.map((r) => ({ ...r, farm_steps: r.farm_steps })),
    live,
  };
  return { rows, live, data };
}

/** A board the gate refuses, named, or null when it passes. */
export function novaBoardIssue(rows: NovaBoardRow[], snapshot: NovaSnapshot): string | null {
  if (rows.length < 100) return `board holds ${rows.length} rows, under the 100-row floor`;
  const slugs = new Set<string>();
  for (const r of rows) {
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug}: a farm step is ${t.length} characters`;
    }
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) {
      return `${r.slug}: implied value ${r.implied_value_usd} is not a positive whole number`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing from the board: ${missing.slice(0, 5).join(', ')}`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1..${rows.length}`;
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      return `implied value rises from rank ${i} to rank ${i + 1}`;
    }
  }
  if (rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) {
    return 'every implied value is the same: not a ranking';
  }
  return null;
}

/** The dashboard's data as a script: one global, no network, no imports. */
export function novaDataScript(data: NovaRadarData): string {
  const compact = {
    as_of: data.as_of,
    source: data.source,
    floor_usd: data.floor_usd,
    model_version: data.model_version,
    watchlist_size: data.watchlist_size,
    board_size: data.board_size,
    live_size: data.live_size,
    global_peer_multiple: data.global_peer_multiple,
    rows: data.rows.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      on_watchlist: r.on_watchlist,
      launch_candidate: r.launch_candidate,
      peer_multiple: r.model.peer_multiple,
      category_peers: r.model.category_peers,
      growth_factor: r.model.growth_factor,
      maturity_factor: r.model.maturity_factor,
      breadth_factor: r.model.breadth_factor,
      farm_steps: r.farm_steps,
    })),
    live: data.live,
  };
  return `// Nova Radar data — generated from the sealed snapshot by main.ts.\n// SPDX-License-Identifier: MIT\nwindow.NOVA_RADAR = ${JSON.stringify(compact)};\n`;
}
