// Illustrative economic presets, not investment advice or live on-chain state.
export const PRESETS = Object.freeze([
  Object.freeze({
    id: "community-launch", name: "Community graduation",
    description: "A gradual USDC-quoted launch with partial permanent LP lock.",
    quoteSymbol: "USDC", quoteDecimals: 6, tokenSupply: 1000000000,
    initialMarketCap: 25000, migrationMarketCap: 250000,
    startingFeeBps: 150, endingFeeBps: 150,
    creatorTradingFeePercentage: 10, creatorLiquidityPercent: 25, lockedLiquidityPercent: 30
  }),
  Object.freeze({
    id: "long-discovery", name: "Long discovery",
    description: "Wider market-cap range, declining fee and greater locked allocation.",
    quoteSymbol: "USDC", quoteDecimals: 6, tokenSupply: 100000000,
    initialMarketCap: 5000, migrationMarketCap: 75000,
    startingFeeBps: 300, endingFeeBps: 100,
    creatorTradingFeePercentage: 0, creatorLiquidityPercent: 15, lockedLiquidityPercent: 60
  }),
  Object.freeze({
    id: "compact-experiment", name: "Compact experiment",
    description: "Lower supply and static trading fee, with more locked LP.",
    quoteSymbol: "USDC", quoteDecimals: 6, tokenSupply: 50000000,
    initialMarketCap: 10000, migrationMarketCap: 120000,
    startingFeeBps: 100, endingFeeBps: 100,
    creatorTradingFeePercentage: 0, creatorLiquidityPercent: 20, lockedLiquidityPercent: 40
  })
]);
export function findPreset(id) { return PRESETS.find((preset) => preset.id === id); }
