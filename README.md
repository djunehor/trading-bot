# Alpaca Automated Stock Trading Bot 📈

An automated stock trading system built with TypeScript, Express, SQLite, Redis, and the Alpaca Trading API. It runs multiple trading strategies simultaneously, executes trades automatically, manages risk with stop-losses and trailing stops, and serves a real-time responsive web dashboard.

---

## How the Bot Works

The bot runs two independent engines: a **stock bot** (US equities & ETFs) and a **crypto bot** (24/7 crypto pairs). Each engine runs on a fixed cycle (default 5 minutes):

1. **Strategy cycle** — scans the watchlist for entry signals and executes BUY/SELL orders.
2. **Risk-management tick** — every 30 seconds, checks open positions against stop-loss / take-profit / trailing-stop rules.

Every trade is logged with a **reason note** naming the strategy that triggered it, so strategy performance can be evaluated by filtering the order history.

### Position Sizing

Each buy is sized at **5% of available cash** (deterministic, no AI involvement). A position never risks more than a fraction of the portfolio.

### Risk Management Rules

| Rule | Stocks | ETFs (SPY/QQQ) | Crypto |
|------|--------|----------------|--------|
| Stop-loss | 2% | 8% | 1.5% |
| Take-profit | 3% | 20% | 3% |
| Trailing stop | 1.5% | 5% | 1.5% |

Additional exit mechanisms: **scale-out** (sell 50% at threshold), **peak-stall exit** (sell if no new high for 90s while profitable).

### Market Hours Handling

- **Regular session** (9:30 AM – 4:00 PM ET): market orders.
- **Extended hours** (pre-market / after-hours): limit orders only.
- **At market open**: all leftover limit orders are canceled so they can't hold shares hostage.

---

## Trading Strategies

Each strategy generates BUY signals with a confidence score (0–1). The bot acts on signals with confidence ≥ 0.55. Strategies with higher confidence fire first.

### Active Strategies

#### 1. Momentum Breakout (confidence 0.70)
Buys when a stock is surging.
- Price **above** VWAP
- RSI between 55–75 (strong but not overbought)
- Price up ≥ 0.5% in the last 5 minutes
- Volume ≥ 1.3× average

*Why:* catches real momentum early. Best-performing strategy by far.

#### 2. Sustained 2h Uptrend (confidence 0.80)
The "momentum train" — joins a stock that's been rising steadily for ~2 hours.
- Gain of 1–8% over the last 24 five-minute bars
- At least 60% of bars closed green
- Price above VWAP
- Healthy volume

*Why:* a steady climb is more durable than a parabolic spike. Works at any time of day — what matters is the 2-hour trend happened.

#### 3. Opening Range Breakout (confidence 0.75)
Buys when price breaks above the first 30 minutes' high of the day.
- Price above the 9:30–10:00 AM high
- Volume ≥ 1.2× average
- **Only fires 9:30–11:30 AM ET**

*Why:* early strength tends to continue through the morning.

#### 4. 52-Week High Breakout (confidence 0.70)
Buys when price is near or making a new 52-week high.
- Price within -1% to +3% of the 52-week high
- Price above VWAP

*Why:* new highs attract buyers — the strongest momentum signal.

#### 5. Gap-and-Go (confidence 0.68)
Buys a stock that gapped up at open and is holding its gains.
- Gap up of 1–10% vs. yesterday's close
- Price holding at or above today's open
- Normal-or-better volume

*Why:* continuation of pre-market strength.

#### 6. RSI Bullish Divergence (confidence 0.62)
Buys when price makes a lower low but RSI makes a higher low.
- Lower price low, higher RSI low over the last 20 bars
- RSI still below 50

*Why:* momentum is fading on the downside — a reversal may be near. (Kept despite being a "reversal" signal because it's been profitable.)

#### 7. Golden Cross (confidence 0.55)
Buys when the 20-period SMA crosses above the 50-period SMA.
- SMA20 > SMA50
- Price above VWAP
- RSI between 40–70

*Why:* classic trend-reversal confirmation. High volume, but lower per-trade edge.

#### 8. News Sentiment
Scans live headlines, scores them -1 (bearish) to +1 (bullish) using Gemini 3.6 Flash, and:
- **Buys** when a stock's sentiment score ≥ +0.15
- **Sells** when score ≤ -0.15

*Why:* catalysts (earnings, deals, news) drive short-term price moves.

#### 9. Sector Rotation
Ranks ~27 sector/theme ETFs by a momentum score and rotates capital into the top sectors.
- Score = above VWAP + strong RSI + positive momentum + volume
- Buys top-ranked sectors (up to 3 held, 2 bought per cycle)
- Exits sectors that fall out of the top 5

*Why:* follow the money across sectors rather than guessing individual stocks.

#### 10. Index Accumulation (fallback)
When cash exceeds 40% of the portfolio, slowly accumulates SPY/QQQ for long-term growth.

*Why:* idle cash earns nothing; index ETFs are a low-risk deployment.

### Disabled Strategies

These dip-buying strategies are **disabled** because they conflict with the tight stop-loss (buying weakness then cutting at -2% is structurally loss-making):

- **VWAP Pull** — buy below VWAP with oversold RSI (was -$189, the worst performer)
- **Bollinger Bounce** — buy below the lower Bollinger band
- **Freefall Reversal** — buy a sharp drop expecting a bounce

---

## Key Features

- **Multi-strategy engine** — momentum, trend, breakout, divergence, news, and sector rotation run together.
- **Risk management** — stop-loss, take-profit, trailing stop, scale-out, peak-stall exit.
- **Deterministic position sizing** — 5% of cash per trade, no AI guesswork.
- **Caching** — Redis with in-memory fallback to protect API quotas.
- **SQLite persistence** — orders, logs, risk state, and equity snapshots survive restarts.
- **Optional basic auth** — when `AUTH_USERNAME`/`AUTH_PASSWORD` are set, the UI and API require HTTP Basic auth.
- **Dashboard** — live metrics, open positions, closed-position performance, streamgraph, order history, and bot controls.

---

## Requirements

- **Node.js 20+** (Node 22 LTS recommended — matches the production server) — uses the global `fetch` API and runs TypeScript via `tsx`.
- **Alpaca account** — paper (free) or live, with API keys. Required for trading.
- **Redis** *(optional)* — used for caching; falls back to in-memory cache if not running.
- **SQLite** — bundled, no installation needed.
- **API keys** *(all optional)* — the bot degrades gracefully:
  - `GEMINI_API_KEY` — news sentiment via Gemini 3.6 Flash; falls back to VADER.
  - `WEBZ_TOKEN` / `NEWSAPI_KEY` — news sources; falls back to VADER if both absent.

---

## Directory Structure

```text
├── public/              # Frontend web application (HTML, CSS, JS)
├── scripts/             # Utility runner scripts (buy, sell, cancel, portfolio)
├── src/
│   ├── config/          # Alpaca API & account configuration
│   ├── db/              # SQLite database schema, indexes & operations
│   ├── services/        # Alpaca Service, News Engine, Cache & Trading Bot
│   ├── types/           # TypeScript interface definitions
│   └── server.ts        # Express REST API application entry point
└── tests/               # Unit & integration test suites
```

---

## Environment Configuration

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

```env
# Account Execution Mode: "paper" or "live"
ALPACA_ACCOUNT_MODE=paper

# Paper Credentials (required)
ALPACA_PAPER_KEY_ID=your_paper_key_id
ALPACA_PAPER_SECRET_KEY=your_paper_secret_key

# Live Credentials (used only when switching to Live mode)
ALPACA_LIVE_KEY_ID=your_live_key_id
ALPACA_LIVE_SECRET_KEY=your_live_secret_key

# Google Gemini API key (optional — falls back to VADER)
GEMINI_API_KEY=your_gemini_key

# News sources (optional — falls back to VADER if both absent)
WEBZ_TOKEN=your_webz_token
NEWSAPI_KEY=your_newsapi_key

# Optional Redis Server URL
REDIS_URL=redis://127.0.0.1:6379

# Optional basic auth — if both set, the UI and API require these credentials
AUTH_USERNAME=
AUTH_PASSWORD=

# Server Port
PORT=3000
```

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# edit .env with your Alpaca keys
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Production
```bash
npm run build
npm start
```

---

## Development & Testing Commands

- **Build TypeScript Project**:
  ```bash
  npm run build
  ```

- **Run Type Check**:
  ```bash
  npm run lint
  ```

- **Run Full Test Suite & Coverage**:
  ```bash
  npm run test:cov
  ```

- **Execute Script Utilities**:
  ```bash
  # Check portfolio status
  npx tsx scripts/portfolioStatus.ts

  # Cancel all open pending orders
  npx tsx scripts/cancelAllOrders.ts
  ```

---

## License

MIT License.
