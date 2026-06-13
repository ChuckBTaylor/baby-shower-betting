# 🍼 Baby Shower Prediction Game

A local React app for running a baby shower betting pool. Guests place $3 standalone bets on 9 categories and unlimited parlays ($1–$50). The host enters actuals after the baby arrives and the app scores everything automatically.

## Quick Start

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## How It Works

**Guests** enter their name, pick categories to bet on ($3 each), and optionally build parlays (2+ legs, $1–$50 stake, true 2× per leg odds). Submissions are saved to `localStorage` so they persist across page refreshes.

**Host** clicks the subtle "Host" button (top right), enters PIN `1234` (change `HOST_PIN` in `src/App.jsx`), and gets access to:

| Tab | What it shows |
|-----|---------------|
| Overview | Total bets, pot sizes, parlay liability |
| Categories | Every bettor's guess per category |
| Parlays | All parlay slips with stakes + max payouts |
| Bettors | Who submitted and how much they owe |
| Enter Actuals | Input real values after baby arrives |
| Results ★ | Per-person payouts, winners, parlay hit/miss |

## Scoring Rules

| Category | Standalone | Parlay |
|----------|-----------|--------|
| Choice (eye/hair/day) | Exact match wins, pot split if tied | Exact match |
| Birth weight | Closest guess wins | Within 3 oz |
| Birth length | Closest guess wins | Within ¼ inch |
| Birth date | Closest date wins | Exact date match |
| Apgar score | Closest guess wins | Exact match |

Date range bets (parlay mode): hit if actual falls inside the range.

## Customizing

- **Change the PIN**: Edit `HOST_PIN` at the top of `src/App.jsx`
- **Change the fee**: Edit `CAT_FEE` (default `3`)
- **Add/remove categories**: Edit the `CATEGORIES` array
- **Clear all data**: Open DevTools → Application → Local Storage → delete both keys

## Data Storage

All submissions and actuals are stored in `localStorage` under:
- `baby-shower-submissions`
- `baby-shower-actuals`

Data is per-browser. For a shared experience where multiple devices/guests can submit, you'd need a backend — but for a party where the host's laptop is the hub, this works great.
