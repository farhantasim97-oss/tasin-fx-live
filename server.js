
import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TWELVE_DATA_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");

// Serve public website files
app.use(express.static(PUBLIC_DIR));

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Supported trading symbols
const symbols = [
  { key: "XAUUSD", api: "XAU/USD", name: "Gold", digits: 2 },
  { key: "EURUSD", api: "EUR/USD", name: "EUR/USD", digits: 5 }
];

const cache = new Map();
const CACHE_MS = 60000;

// Fetch market candles
async function candles(symbol, interval) {
  const cacheKey = `${symbol}:${interval}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.data;
  }

  const url = new URL("https://api.twelvedata.com/time_series");

  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", "120");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", API_KEY);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Market data HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (payload.status === "error" || !Array.isArray(payload.values)) {
    throw new Error(payload.message || "Market data unavailable");
  }

  const data = payload.values.map(v => ({
    time: v.datetime,
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close)
  })).reverse();

  cache.set(cacheKey, { at: Date.now(), data });

  return data;
}

// EMA calculation
function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);

  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
}

// ATR calculation
function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;

  const trs = [];

  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];

    trs.push(Math.max(
      b.high - b.low,
      Math.abs(b.high - prev.close),
      Math.abs(b.low - prev.close)
    ));
  }

  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// New York session filter
function nySession(dateString) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(dateString));

    const hour = Number(parts.find(p => p.type === "hour")?.value);

    return hour >= 8 && hour < 11;
  } catch {
    return false;
  }
}

// Signal engine
function makeSignal(m5, m15, digits) {
  if (m5.length < 40 || m15.length < 55) {
    return {
      side: "NO TRADE",
      reason: "Not enough candles to confirm setup."
    };
  }

  // Ignore currently forming candles
  const bars = m5.slice(0, -1);
  const htf = m15.slice(0, -1);

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  const closes15 = htf.map(x => x.close);

  const trendFast = ema(closes15, 20);
  const trendSlow = ema(closes15, 50);
  const volatility = atr(bars, 14);

  if (!trendFast || !trendSlow || !volatility || volatility <= 0) {
    return {
      side: "NO TRADE",
      reason: "Indicator data is incomplete."
    };
  }

  if (!nySession(last.time)) {
    return {
      side: "NO TRADE",
      reason: "Outside New York entry window (08:00–11:00 New York time)."
    };
  }

  const lookback = bars.slice(-13, -1);

  const priorHigh = Math.max(...lookback.map(x => x.high));
  const priorLow = Math.min(...lookback.map(x => x.low));

  const sweepLow =
    prev.low < priorLow &&
    prev.close > priorLow &&
    last.close > prev.high;

  const sweepHigh =
    prev.high > priorHigh &&
    prev.close < priorHigh &&
    last.close < prev.low;

  const bullish =
    trendFast > trendSlow &&
    last.close > trendFast;

  const bearish =
    trendFast < trendSlow &&
    last.close < trendFast;

  let side = "NO TRADE";
  let entry = null;
  let sl = null;
  let tp = null;

  let reason = "No confirmed liquidity sweep and structure break.";

  if (sweepLow && bullish) {
    side = "BUY";
    entry = last.close;
    sl = Math.min(prev.low, last.low) - volatility * 0.25;
    tp = entry + (entry - sl) * 1.5;

    reason = "Bullish liquidity sweep and 15M trend confirmation.";
  } else if (sweepHigh && bearish) {
    side = "SELL";
    entry = last.close;
    sl = Math.max(prev.high, last.high) + volatility * 0.25;
    tp = entry - (sl - entry) * 1.5;

    reason = "Bearish liquidity sweep and 15M trend confirmation.";
  }

  const fmt = n => Number(n).toFixed(digits);

  return {
    side,
    entry: entry === null ? null : fmt(entry),
    sl: sl === null ? null : fmt(sl),
    tp: tp === null ? null : fmt(tp),
    rr: "1:1.5",
    time: last.time,
    price: fmt(last.close),
    session: "New York 08:00–11:00",
    reason
  };
}

// API endpoint
app.get("/api/status", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      error: "API key missing. Add TWELVE_DATA_API_KEY in Render Environment."
    });
  }

  try {
    const output = await Promise.all(
      symbols.map(async s => {
        const [m5, m15] = await Promise.all([
          candles(s.api, "5min"),
          candles(s.api, "15min")
        ]);

        return {
          key: s.key,
          name: s.name,
          symbol: s.api,
          signal: makeSignal(m5, m15, s.digits),
          source: "Twelve Data",
          updatedAt: new Date().toISOString()
        };
      })
    );

    res.json({
      data: output,
      checkedAt: new Date().toISOString(),
      provider: "Twelve Data"
    });

  } catch (error) {
    res.status(502).json({
      error: error.message,
      hint: "Check Twelve Data API key and account access."
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`TASIN FX running on port ${PORT}`);
});
