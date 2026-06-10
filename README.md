# Limited Edition Sneaker Drop — Real-Time Inventory System

A real-time, high-traffic inventory system for limited-edition merch drops. Users see
live stock counts over WebSockets, **reserve** an item for 60 seconds, and **purchase**
within that window. The system guarantees **no overselling** under concurrency and
**automatically recovers stock** from expired reservations.

## Stack
| Layer | Tech |
|-------|------|
| Frontend | React (Vite) + Tailwind CSS + Zustand + react-hot-toast |
| Backend | Node.js + Express |
| Database | PostgreSQL (Neon) |
| Real-time | Socket.io |
| ORM | Prisma |

## Project structure
```
.
├── server/                 # Express + Prisma + Socket.io API
│   ├── prisma/
│   │   ├── schema.prisma   # data model: Drop, User, Reservation, Purchase
│   │   └── seed.js         # demo users + drops
│   ├── scripts/
│   │   └── concurrency-test.js  # 100-request anti-oversell proof
│   └── src/
│       ├── index.js        # app entry: Express + HTTP + Socket.io + sweeper
│       ├── sweeper.js      # durable expiry sweeper (setInterval)
│       ├── lib/
│       │   ├── prisma.js   # shared Prisma client
│       │   ├── io.js       # Socket.io instance + event emitters
│       │   └── expire.js   # shared "return a unit to stock" logic
│       └── routes/
│           ├── drops.js          # list (w/ activity feed), create, reserve
│           └── reservations.js   # purchase
└── client/                 # React + Vite dashboard
    └── src/
        ├── App.jsx
        ├── components/{DropCard,Countdown}.jsx
        └── lib/{api,socket,store,username}.js
```

---

## How to run locally

### Prerequisites
- Node.js 18+ and npm
- A PostgreSQL database. Easiest is a free **[Neon](https://neon.tech)** project (also used for deployment).

### 1. Database (Neon)
1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the connection string (ends with `?sslmode=require`).

### 2. Backend
```bash
cd server
cp .env.example .env          # then paste your DATABASE_URL into .env
npm install
npx prisma migrate dev --name init   # creates the tables
npm run seed                  # optional: demo users + drops
npm run dev                   # starts API + WebSocket on http://localhost:4000
```

### 3. Frontend
```bash
cd client
cp .env.example .env          # default points at http://localhost:4000
npm install
npm run dev                   # starts UI on http://localhost:5173
```

Open **http://localhost:5173**. Open it in **two browser windows** side-by-side to see
real-time stock sync.

### SQL schema setup
The schema is managed by Prisma (`server/prisma/schema.prisma`). Running
`npx prisma migrate dev` generates and applies the SQL migration that creates the
`Drop`, `User`, `Reservation`, and `Purchase` tables (with indexes). The generated SQL
lives in `server/prisma/migrations/` after the first migrate.

---

## API reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`  | `/api/drops` | List drops, each with `recentPurchasers` (top 3 latest buyers) |
| `POST` | `/api/drops` | Create a drop. Body: `{ name, totalStock, description?, imageUrl?, startsAt? }` |
| `POST` | `/api/drops/:id/reserve` | Atomically reserve 1 unit for 60s. Body: `{ username }` |
| `POST` | `/api/reservations/:id/purchase` | Complete a purchase for a held reservation |

**WebSocket events (server → client):**
- `stock:update` → `{ dropId, availableStock }` — emitted on reserve, expiry, and (no-op for) purchase.
- `purchase:new` → `{ dropId, purchaser }` — emitted on a completed purchase (live activity feed).

---

## Architecture Choice: how the 60-second expiration works

A reservation stores a durable `expiresAt` timestamp (`createdAt + 60s`) in Postgres.
Recovery uses a **two-layer strategy**:

1. **Per-reservation `setTimeout(60s)`** (in `routes/drops.js`) — fires precisely at the
   60-second mark for instant recovery in the happy path.
2. **A background sweeper `setInterval`** (in `sweeper.js`, every ~3s) — queries the DB for
   any `ACTIVE` reservations whose `expiresAt` is in the past and recovers them.

**The sweeper is the source of truth; the `setTimeout` is just a latency optimization.**
Because the deadline lives in the database, the sweeper keeps working even after a server
restart — when in-memory `setTimeout` timers would have been lost. Without it, a restart
mid-window would strand a unit forever.

When a reservation expires, `expireReservation()` runs a single transaction that:
1. flips the reservation `ACTIVE → EXPIRED` **only if it is still `ACTIVE`** (`updateMany` + count check), and
2. increments the drop's `availableStock` by 1,

then emits `stock:update` so all clients refresh. The `ACTIVE`-only guard makes this
**idempotent**: if both the timer and the sweeper fire for the same reservation, only the
first performs the recovery, so a unit is returned **exactly once**.

---

## Concurrency: how overselling is prevented

The reserve endpoint never does a read-then-write (which has a race window). Instead it
issues a **single atomic SQL statement** (a CTE) that conditionally decrements stock **and**
inserts the reservation in one auto-committed round-trip (`src/routes/drops.js`):

```sql
WITH upd AS (
  UPDATE "Drop"
  SET "availableStock" = "availableStock" - 1
  WHERE id = $1
    AND "availableStock" > 0                 -- the oversell guard
    AND NOT EXISTS (                          -- one ACTIVE reservation per user
      SELECT 1 FROM "Reservation" r
      WHERE r."dropId" = "Drop".id AND r."userId" = $2 AND r.status = 'ACTIVE'
    )
  RETURNING id, "availableStock"
), ins AS (
  INSERT INTO "Reservation" (id, "dropId", "userId", status, "expiresAt", "createdAt")
  SELECT $3, id, $2, 'ACTIVE', $4, now() FROM upd     -- only runs if upd matched a row
  RETURNING id, "expiresAt"
)
SELECT u."availableStock", i.id AS "reservationId", i."expiresAt"
FROM upd u JOIN ins i ON true;
```

Postgres takes a **row lock** per row write, so concurrent updates to the same drop are
**serialized**: each runs to completion before the next begins. Only requests that still
observe `availableStock > 0` change a row. We use the **returned rows** to decide the
outcome — one row back means the caller won a unit and a reservation; **zero rows** means
sold out (or the per-user guard blocked it) → `409 Conflict`, surfaced as a toast in the UI.
Because the decrement and the insert are the **same statement**, they are inherently atomic
(no `BEGIN/COMMIT` needed).

**Result:** if 100 (or 200) users reserve the last unit at the same millisecond, exactly
**one** succeeds and stock lands at `0` — never negative. Verified by
`npm run test:concurrency` (see below).

### Why a single statement instead of an interactive transaction
An earlier version wrapped `updateMany` + `reservation.create` in a Prisma
`$transaction(async tx => …)`. That is also correct, but an **interactive transaction holds
a DB connection open for its whole callback**. Under 100 simultaneous reserves that
exhausted the connection pool (`P2028` / `P2024`), so most requests failed with `500`
instead of a clean `409`. Collapsing the work into one auto-committed CTE — plus tuning the
pool (`connection_limit=21`, `pool_timeout=20` in the connection string) and keeping the hot
path to a single round-trip — made the system pass cleanly at 100 and 200 concurrent
requests. This is the difference between *logically* correct and *robust under load*.

### Alternatives considered
- **`SELECT … FOR UPDATE`** (pessimistic lock): correct, but an extra round-trip and holds
  the lock for the whole transaction. The single conditional UPDATE is leaner.
- **Optimistic versioning** (`WHERE version = n`): viable, but the conditional decrement
  already expresses the exact invariant (`availableStock > 0`) with no version bookkeeping.
- **App-level / Redis locks**: unnecessary — the database is already the single source of
  truth and enforces it atomically.

### Proving it
With the server running:
```bash
cd server
npm run test:concurrency       # default: 100 reserves on 1 unit
N=200 npm run test:concurrency # custom load
```
Expected output: **1 success (201), 99 rejections (409), final stock = 0.**

---

## Deployment (bonus)

- **Database:** Neon (serverless Postgres). Set `DATABASE_URL` from its connection string.
- **Frontend:** Vercel (static Vite build). Set `VITE_API_URL` to the deployed backend URL.
- **Backend:** **Render or Railway** rather than Vercel. Socket.io needs a long-lived
  server connection, which Vercel's serverless functions don't hold well; a persistent
  Node service on Render/Railway is the reliable choice for WebSockets.
- **Environment variables:** never commit `.env`. Set `DATABASE_URL`, `PORT`,
  `CLIENT_ORIGIN` (backend) and `VITE_API_URL` (frontend) in the host's dashboard.

---

## Notes / scope decisions
- **No auth:** users are identified by a per-browser username (generated and stored in
  `localStorage`), so two browser windows act as two distinct users — ideal for the demo.
  `reserve`/`purchase` upsert the user by username.
- **One active reservation per user per drop** is enforced to prevent a single user from
  draining stock by clicking repeatedly.
- **Stock is decremented at reserve time**, not purchase time; purchase just makes the
  deduction permanent (and flips the reservation to `COMPLETED` so expiry can't return it).
