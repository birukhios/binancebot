type SymbolCfg = {
  symbol: string;
};

export async function learnFromTrades(
  cfg: SymbolCfg,
  opts: { force?: boolean } = {},
): Promise<{ applied: boolean; note: string }> {
  void opts;
  return {
    applied: false,
    note: `Learning for ${cfg.symbol} needs durable trade-history storage and is disabled in local Better Auth mode.`,
  };
}
