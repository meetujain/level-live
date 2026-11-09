# Level (live data version)

Shows live Solana tokens from DexScreener, scored by Level's checks.
Nothing here touches user funds. It only reads public market data.

## What's in it

- `api/coins.js` serverless function: finds tokens, pulls pool data, applies the checks, returns JSON. Cached 60 s.
- `public/index.html` the site. Home, Launch (preview only), Coins (live), Checks (simulator), Analytics (live), Docs.

## Deploy on Vercel (free tier works)

1. Put this folder in a GitHub repo.
2. In Vercel, choose Add New > Project, import the repo, framework preset "Other", then Deploy.
3. Open the deployed URL. The Coins page should fill in within a few seconds.

To test locally: `npm i -g vercel`, then `vercel dev` in this folder.

## Optional settings

- `TOKENS` environment variable: comma-separated Solana mint addresses to always include.

## How levels are scored here

| Check | How it works in this version |
|---|---|
| Pool depth | Market cap counts only up to 10x the deepest pool's liquidity. Real data. |
| Hold time | The market cap an hour ago is estimated from the 1 hour price change. The level is the lower of now and an hour ago. An estimate, not true hold time. |
| Trading churn | 24 hour volume above 40x liquidity is flagged. A rough stand-in for wash trading, not proof. |
| Grace period | Not built. Needs a database that stores each coin's history. |

## Known limits

- The list is drawn from tokens with a DexScreener profile or boost. Boosts are paid promotion, so this is not a neutral sample of the market. Use `TOKENS` or add another source to widen it.
- DexScreener's free limits are 60 requests/min for profile and boost endpoints and 300/min for token endpoints. Caching keeps this well under. Check their current docs and terms before relying on it commercially.
- Market cap figures come from DexScreener and can be missing, delayed or wrong.
- This was tested against mock data only, not the live API. Check the first deploy yourself.
- Launch, perks, rewards and payouts are not implemented. They need an on-chain program and an audit.
