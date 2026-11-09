// GET /api/coins
// Pulls Solana tokens from DexScreener's free public API and scores them with Level's checks.
// Cached at the edge for 60 seconds so the site stays well under DexScreener's rate limits.

const BASE = "https://api.dexscreener.com";
const LEVELS = [1e4, 5e4, 1e5, 2.5e5, 5e5, 1e6, 5e6, 1e7]; // market cap thresholds for Levels 1 to 8
const GAP = 10;            // market cap only counts up to 10x pool liquidity
const CHURN_LIMIT = 40;    // 24h volume above 40x liquidity is flagged (rough wash-trading proxy)
const MAX_TOKENS = 90;
const CHUNK = 30;          // DexScreener accepts up to 30 addresses per tokens request
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const level = (m) => LEVELS.filter((x) => m >= x).length;
const num = (x) => (Number.isFinite(+x) ? +x : 0);

async function getJson(path) {
  const r = await fetch(BASE + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(path + " returned " + r.status);
  return r.json();
}

// Discovery: tokens with a DexScreener profile or boost. This is not the whole market.
// Add your own mints with the TOKENS environment variable (comma separated).
async function discover() {
  const lists = await Promise.allSettled([
    getJson("/token-boosts/top/v1"),
    getJson("/token-profiles/latest/v1"),
    getJson("/token-boosts/latest/v1"),
  ]);
  const seen = new Set();
  for (const l of lists) {
    if (l.status !== "fulfilled" || !Array.isArray(l.value)) continue;
    for (const x of l.value) {
      if (x && x.chainId === "solana" && B58.test(x.tokenAddress || "")) seen.add(x.tokenAddress);
    }
  }
  return [...seen];
}

async function pairsFor(addresses) {
  const chunks = [];
  for (let i = 0; i < addresses.length; i += CHUNK) chunks.push(addresses.slice(i, i + CHUNK));
  const results = await Promise.allSettled(
    chunks.map((c) => getJson("/tokens/v1/solana/" + c.join(",")))
  );
  return results.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
}

function build(pairs, wanted) {
  // Keep each token's deepest pool, counting only pools where it is the base token.
  const best = new Map();
  for (const p of pairs) {
    const addr = p && p.baseToken && p.baseToken.address;
    if (!wanted.has(addr)) continue;
    const liq = num(p.liquidity && p.liquidity.usd);
    const cur = best.get(addr);
    if (!cur || liq > cur.liq) best.set(addr, { p, liq });
  }

  const coins = [];
  for (const [addr, { p, liq }] of best) {
    const m = num(p.marketCap) || num(p.fdv);
    if (m <= 0) continue;

    const vol = num(p.volume && p.volume.h24);
    const h1 = num(p.priceChange && p.priceChange.h1);
    const h24 = num(p.priceChange && p.priceChange.h24);

    // Hold-time approximation without a database: the market cap an hour ago,
    // estimated from the 1 hour price change (assumes supply did not change).
    const mAgo = h1 > -99 ? m / (1 + h1 / 100) : m;

    const cap = liq * GAP;
    const eff = Math.min(m, cap);          // pool depth check
    const effAgo = Math.min(mAgo, cap);
    const dl = level(eff);                 // level from depth-capped market cap now
    const S = level(effAgo);               // level an hour ago
    const lv = Math.min(dl, S);            // a level must hold across the last hour
    const turn = liq > 0 ? vol / liq : 0;

    let st;
    if (turn > CHURN_LIMIT) st = ["bad", "Flagged: churn " + turn.toFixed(0) + "x liquidity"];
    else if (dl > S) st = ["wait", "Pending: rose within the last hour"];
    else if (dl < S) st = ["wait", "Falling: was Level " + S + " an hour ago"];
    else if (eff < m) st = ["wait", "Capped by pool depth"];
    else st = ["ok", "Verified"];

    coins.push({
      t: String(p.baseToken.symbol || "?").slice(0, 12),
      name: String(p.baseToken.name || "").slice(0, 40),
      addr,
      pair: String((p.quoteToken && p.quoteToken.symbol) || "").slice(0, 10),
      m, liq, mAgo, S, turn,
      d: (h24 >= 0 ? "+" : "") + h24.toFixed(0) + "%",
      url: B58.test(p.pairAddress || "") ? "https://dexscreener.com/solana/" + p.pairAddress : null,
      v: { eff, dl, lv, st, cap: eff < m },
    });
  }
  coins.sort((a, b) => b.v.lv - a.v.lv || b.v.eff - a.v.eff);
  return coins.slice(0, 50);
}

async function handler(req, res) {
  try {
    const extra = (process.env.TOKENS || "").split(",").map((s) => s.trim()).filter((a) => B58.test(a));
    const found = await discover();
    const addresses = [...new Set([...extra, ...found])].slice(0, MAX_TOKENS);
    const pairs = await pairsFor(addresses);
    const coins = build(pairs, new Set(addresses));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({ updated: Date.now(), coins });
  } catch (e) {
    res.status(502).json({ error: "Could not load market data." });
  }
}

module.exports = handler;
module.exports._test = { build, level };
