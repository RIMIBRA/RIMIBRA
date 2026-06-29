# 👋 Nicaise Ibrahim OUEDRAOGO

**Web Developer · Cisco Network Engineer · Independent Builder**
📍 Ouagadougou, Burkina Faso 🇧🇫
📧 indg98@gmail.com

---

## 🎯 Featured project: RIMIBRA — multi-sport prediction platform

A full-stack prediction engine covering 7 sports (football, NFL, NBA, NHL, MLB, handball, tennis),
with tiered subscriptions, daily auto-generated parlays ("combinés") with live win/loss tracking,
and a JWT-authenticated REST API backed by PostgreSQL. This repo's source code (`src/`, `public/`)
*is* the app — not a tutorial clone.

**Live in this repo:**

| | |
|---|---|
| 🧪 Tests | 53 unit tests (Jest) on the core prediction logic, plan-access rules, and parlay scoring |
| ⚙️ CI | GitHub Actions runs the full suite on every push/PR ([.github/workflows/ci.yml](.github/workflows/ci.yml)) |
| 🔐 Auth | JWT + bcrypt, PostgreSQL-backed plans (free/premium/vip), admin override |
| 🛡️ Security | helmet, rate-limiting, and fixed XSS injection points (unescaped email/search fields) |

### Why it's interesting beyond CRUD

- **Multi-source resilience.** Each prediction blends the sport's official API, bookmaker odds
  (the-odds-api.com), and scraped sources (Forebet, BeSoccer, Soccerway via Puppeteer) — if any
  one source fails or hits its quota, the algorithm degrades gracefully instead of crashing
  (`Promise.allSettled`-style fallbacks in [predictor.js](src/algorithm/predictor.js)).
- **Concurrency bug found and fixed in production.** The original file-based cache read-modified-wrote
  a JSON file per request; concurrent requests (form, head-to-head, full-day analysis) raced and
  silently dropped each other's writes. Rewritten to hold the cache in memory and flush via
  `setImmediate` ([db.js](src/cache/db.js)).
  - Same root cause once crashed the server in a different spot: pre-generating tomorrow's parlays
    for 7 sports fired 14 heavy scraping jobs at once. Fixed with a sequential queue
    ([combos.js](src/routes/combos.js)) — currently disabled in production pending a careful re-test
    under real load, a tracked and intentional decision, not an oversight.
- **Real test coverage on the logic that matters.** Not snapshot tests — behavioral tests on parlay
  candidate selection, combined-probability math, win/loss classification, match-state detection
  (including a "stale match" heuristic for leagues whose provider never updates a finished game's
  status), and pick validation (1X2 / BTTS / over-under). See
  [combos.test.js](src/routes/combos.test.js), [predictor.test.js](src/algorithm/predictor.test.js),
  [tiers.test.js](src/auth/tiers.test.js).
- **Tiered access as a first-class concern**, not an afterthought bolted onto routes: plan/feature
  access is centralized in a small, pure, fully-tested module
  ([tiers.js](src/auth/tiers.js)) that every route checks against the same rules.

### Try it

```bash
npm install
cp .env.example .env   # fill in API keys + PostgreSQL connection
npm run migrate
npm run dev            # http://localhost:3001
npm test                # 53 tests, ~15s
```

### Stack

Node.js · Express · PostgreSQL · vanilla JS frontend · Puppeteer (scraping fallback) · Jest · GitHub Actions

---

## 🛠️ Tech Stack

| Domain | Technologies |
|--------|-------------|
| Frontend | HTML · CSS · JavaScript |
| Backend | Node.js · Express · Java |
| Database | PostgreSQL · MySQL · SQL |
| Networks | Cisco IOS · Packet Tracer · TCP/IP |
| Tools | Git · GitHub · Jest · Netlify · Linux |

---

## 📂 Other Projects

| Project | Description | Tech |
|---------|-------------|------|
| [PROJET-CISCO](https://github.com/RIMIBRA/PROJET-CISCO) | CCNA 3 & 4 network labs | Cisco Packet Tracer |
| [backend-tenko](https://github.com/RIMIBRA/backend-tenko) | REST API for client website | Node.js · MySQL |
| [wakanda-backend](https://github.com/RIMIBRA/wakanda-backend) | Restaurant backend API | Node.js · MySQL |
| [mon-portfolio](https://github.com/RIMIBRA/mon-portfolio) | Personal portfolio website | HTML · CSS · JS |

---

## 🎯 Current Goals

- 🎓 Completing Bachelor's in Computer Science (2027)
- 🔐 Pursuing Master's in Cybersecurity & Network Security
- 🌏 Applying for MEXT Scholarship — Japan (2028)
- 🚀 Launching African social platform & mobile game

---

## 📫 Connect

[![Portfolio](https://img.shields.io/badge/Portfolio-Visit-blue)](https://nicaise-portefolio.netlify.app)
[![GitHub](https://img.shields.io/badge/GitHub-RIMIBRA-black)](https://github.com/RIMIBRA)
[![Email](https://img.shields.io/badge/Email-indg98@gmail.com-red)](mailto:indg98@gmail.com)
