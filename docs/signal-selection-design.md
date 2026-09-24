# Signal Selection & Thresholding — Design for Review

Status: **PROPOSED — not implemented, not deployed.**
Author: agent, 2026-09-24. Evidence gathered from `/var/www/trading` production DB + live Alpaca data.

---

## 1. Problem

`TechnicalService.analyzeTechnical()` runs a fixed-ordered list of detectors and returns the
**first** one that fires. `BotEngine.runTechnicalStrategy()` then applies a **single** confidence
gate to everything:

```ts
// tradingBot.ts:850
if (signal.confidence < TECH_MIN_CONFIDENCE) continue;   // 0.7
```

Two defects follow.

### Defect A — a weaker signal can preempt a stronger one (ordering inversion)

| # | Detector | Action | Confidence |
|---|----------|--------|-----------:|
| 1 | detectSustainedUptrend | BUY | 0.80 |
| 2 | detectOpeningRangeBreakout | BUY | 0.75 |
| 3 | detect52WeekHigh | BUY | 0.70 |
| 4 | **detectGapAndGo** | BUY | **0.68** |
| 5 | **detectMomentumBreakout** | BUY | **0.70** |
| 6 | detectRsiDivergence | BUY | 0.62 |
| 7 | detectGoldenCross | BUY | 0.55 |
| 8 | detectVwapBreakdown | SELL | 0.60 |
| 9 | detectRsiOverbought | SELL | 0.55 |

`detectGapAndGo` (0.68) is evaluated *before* `detectMomentumBreakout` (0.70). When both fire,
gap-and-go is returned, then rejected by the 0.7 gate — so a valid 0.70 momentum trade is
**suppressed by a signal that can never trade**. This only surfaces once the daily-bars fetch is
fixed (52wk/gap currently return `null`), which is why it is a latent trap.

### Defect B — the BUY gate also gates SELL, killing all technical exits (confirmed in production)

The gate at `tradingBot.ts:851` is applied regardless of `action`. The two SELL detectors are
0.60 and 0.55 — both below 0.7 — so they are **always discarded**.

Production evidence (`orders` table, `reason LIKE 'Technical SELL%'`, status=filled):

```
last technical SELL: 2026-08-18T13:39:51Z      (123 total, all before this)
technical SELLs after the 0.7 change: 0       (in ~5 weeks)
technical BUYs continue: 139 in September
```

`TECH_MIN_CONFIDENCE` was raised 0.55 → 0.7 in commit `6a061e1` (Aug 18). The last technical sell
is the same day. The exit rule was collateral damage of a change aimed at entries.

---

## 2. Design

### 2.1 Order-independent selection

Evaluate **all** detectors and select explicitly, instead of "first match wins":

- **BUY outranks SELL** (preserves today's de-facto precedence — all BUYs precede all SELLs).
- **Within the same action, higher confidence wins.**
- **Ties** go to the earlier detector in the declared list (stable).

```ts
private selectSignal(context: SignalContext): TechnicalSignal | null {
  let best: TechnicalSignal | null = null;
  for (const detect of this.signalDetectors) {
    const signal = detect(context);
    if (signal && (best === null || this.outranks(signal, best))) {
      best = signal;
    }
  }
  return best;
}

/** BUY takes precedence over SELL; within an action, higher confidence wins. */
private outranks(candidate: TechnicalSignal, incumbent: TechnicalSignal): boolean {
  if (candidate.action !== incumbent.action) {
    return candidate.action === 'BUY';
  }
  return candidate.confidence > incumbent.confidence;   // strict: ties keep the incumbent
}
```

`analyzeTechnical` returns `selectSignal(context) ?? { action: 'HOLD', ... }`.

**Property:** the chosen signal no longer depends on array order w.r.t. confidence, so future
detectors cannot reintroduce Defect A by being inserted in the wrong place.

**Is it a behaviour change today?** No. With the daily-bars fetch currently broken, `52WeekHigh`
and `GapAndGo` always return `null`, and every other detector pair is already in non-increasing
confidence order. So `selectSignal` and "first match" agree on **every** input that can occur in
production today. This change is a **strict no-op until the data fix lands.**

### 2.2 Separate BUY / SELL thresholds

Entries and exits have different jobs and should not share one bar.

```ts
// botConfig.ts
export const TECH_MIN_CONFIDENCE = 0.7;       // BUY entries (unchanged)
export const TECH_SELL_MIN_CONFIDENCE = 0.55; // SELL exits (restores pre-Aug-18 behaviour)
```

```ts
// tradingBot.ts, runTechnicalStrategy loop
const minConfidence = signal.action === 'SELL' ? TECH_SELL_MIN_CONFIDENCE : TECH_MIN_CONFIDENCE;
if (signal.confidence < minConfidence) continue;
```

0.55 re-enables **both** exit detectors. Use 0.60 to enable only `VwapBreakdown`. (Decision D2.)

**Behaviour change:** yes — technical exits resume. This is the intended repair of Defect B, but it
is a live-trading change and is deliberately isolated from 2.1.

### 2.3 Data fix (separate, already scoped)

`TechnicalService.fetchDailyBars` needs `start` + `feed=iex` (`docs`/finding): the shipped query
returns **1 bar** against production keys; the fixed query returns 260. With 2.1 in place this
becomes safe — it enables `52WeekHigh` (0.70) without letting `GapAndGo` (0.68) preempt momentum.
Note `GapAndGo` stays disabled by the 0.7 BUY gate regardless, so it is currently unreachable by
design; that is a product decision (raise it to 0.7, or delete it).

---

## 3. Change / risk matrix

| Change | Behaviour change today? | Risk | Reversible |
|--------|------------------------|------|-----------|
| 2.1 selection algorithm | **No** (provably inert until data fix) | Very low | trivially |
| 2.2 separate SELL threshold | **Yes** — exits resume | Medium | one constant |
| 2.3 daily-bars data fix | **Yes** — 52wk entries resume | Medium | revert URL |

Recommended order: **2.1 → 2.3 → 2.2**, each independently shippable and revertible.

---

## 4. Test plan

1. **Selection:** when both gap (0.68) and momentum (0.70) conditions hold, momentum is chosen.
2. **Selection precedence:** when a BUY and a SELL both fire, BUY is chosen.
3. **Selection tie-break:** two BUYs at equal confidence → earlier detector wins.
4. **No-op guard:** for the current detector set, `selectSignal` === old first-match on a fixture
   battery (locks in "2.1 changes nothing today").
5. **Thresholds:** a 0.60 SELL surfaces under `TECH_SELL_MIN_CONFIDENCE` but not under 0.7;
   a 0.68 BUY is still rejected.
6. **Regression:** existing `technicalService.test.ts` (including the malformed-timestamp crash
   fix) stays green.

---

## 5. Open decisions for the reviewer

- **D1 — BUY over SELL precedence:** keep status quo (BUY wins) or make SELL win for held symbols?
  Status quo is proposed to minimise change. For a held symbol a firing SELL is currently ignored
  whenever any BUY detector also fires.
- **D2 — SELL threshold:** 0.55 (both exits) vs 0.60 (VWAP breakdown only).
- **D3 — Gap-and-Go:** unreachable under the 0.7 BUY gate. Raise to 0.7, or remove it and its docs?
- **D4 — 2.3 rollout:** fix the daily-bars fetch at all, or leave the 52-week strategy dormant?

---

## 6. Out of scope

`portfolioService.getTodayRealizedPl` today-only FIFO: **investigated and dismissed as a bug.**
An existing test (`Alpaca API Mock - getTodayRealizedPl sums today-only fills`) encodes the
today-only semantics as intended. A change was attempted and reverted. Not part of this design.
