// Core universe of liquid, large-cap US stocks the scanner always evaluates.
// Day-trade scans additionally pull Yahoo's "most actives" and "day gainers"
// screeners so fresh momentum names enter the funnel automatically.

export const CORE_UNIVERSE: string[] = [
  // Mega-cap tech
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AVGO", "ORCL", "CRM",
  "AMD", "ADBE", "NFLX", "INTC", "QCOM", "TXN", "MU", "AMAT", "LRCX", "KLAC",
  "NOW", "INTU", "IBM", "CSCO", "PLTR", "SNOW", "PANW", "CRWD", "ANET", "SMCI",
  "MRVL", "ON", "ARM", "DELL", "UBER", "ABNB", "SHOP", "COIN", "SQ", "PYPL",
  // Financials
  "JPM", "BAC", "WFC", "GS", "MS", "C", "SCHW", "BLK", "AXP", "V",
  "MA", "BRK-B", "KKR", "BX",
  // Healthcare
  "LLY", "UNH", "JNJ", "ABBV", "MRK", "PFE", "TMO", "ABT", "ISRG", "AMGN",
  "GILD", "VRTX", "REGN", "BMY", "MDT", "CVS",
  // Consumer
  "WMT", "COST", "HD", "LOW", "MCD", "SBUX", "NKE", "TGT", "KO", "PEP",
  "PG", "PM", "DIS", "CMG", "LULU", "TJX", "BKNG", "MAR",
  // Industrials & energy
  "CAT", "DE", "BA", "GE", "HON", "UNP", "UPS", "LMT", "RTX", "ETN",
  "XOM", "CVX", "COP", "SLB", "EOG", "OXY", "FCX", "NEM",
  // Communications / other
  "T", "VZ", "TMUS", "CMCSA", "GM", "F", "DAL", "UAL", "AAL", "CCL",
  "RCL", "MRNA", "DKNG", "RBLX", "HOOD", "SOFI", "MARA", "RIOT",
];

// Benchmark used for relative-strength comparisons.
export const BENCHMARK = "SPY";

// Liquidity gates: skip anything too cheap or too thinly traded to trade safely.
export const MIN_PRICE = 5;
export const MIN_AVG_DOLLAR_VOLUME = 20_000_000; // $20M/day

// Funnel sizes — keep API usage and function runtime bounded.
export const MAX_SCREENER_ADDS = 40; // symbols pulled in from Yahoo screeners
export const MAX_DEEP_DIVE = 45; // symbols that get full chart analysis per scan
export const TOP_PICKS = 8; // picks surfaced per category
