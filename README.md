# TASIN FX Live Dashboard (starter)

## What this project does
- Fetches 5-minute and 15-minute candles for XAU/USD and EUR/USD from Twelve Data.
- Keeps the API key on the server (not in browser JavaScript).
- Runs a basic experimental rule set on completed 5-minute candles:
  - New York 08:00–11:00 entry window
  - Recent liquidity sweep + close confirmation
  - 15-minute EMA trend alignment
  - ATR-based stop and 1:1.5 target
- Displays BUY, SELL, or NO TRADE. Refreshes every 60 seconds.

## Important limitations
This is a starter implementation, not a validated trading system. The rule set is deliberately simple and has not been backtested or forward-tested. It does not promise 1–3 trades per day or any win rate. It does not place trades. Check data entitlement, delay, symbol availability, spread, broker quote differences, and licensing before use or public redistribution. A provider's composite XAU/USD or EUR/USD feed may differ from your broker's CFD/spot feed.

## 1. Get a market data API key
Create an account at https://twelvedata.com/ and create an API key. Check your plan supports:
- XAU/USD and EUR/USD
- 5min and 15min time_series data
- The required refresh frequency / credit allowance

Twelve Data docs: https://twelvedata.com/docs

## 2. Run locally
Install Node.js 18+.
Copy `.env.example` to `.env`, then put your key in `.env`:
`TWELVE_DATA_API_KEY=your_real_key`

In this project folder run:
```bash
npm install
npm start
```
Open http://localhost:3000

## 3. Publish online
Deploy this folder to a Node.js host such as Render or Railway:
- Build command: `npm install`
- Start command: `npm start`
- Add environment variable `TWELVE_DATA_API_KEY` in the host dashboard.
- Do not commit or share `.env`.
- Use HTTPS and review provider redistribution/licensing terms before making a public signal website.

## Before real trading
Run a proper historical backtest and demo forward-test. Include spread, slippage, commissions, session/DST behavior, and conservative handling when SL and TP are touched in the same candle. Compare the feed with your intended broker.
