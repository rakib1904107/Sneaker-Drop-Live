// The background sweeper: the DURABLE source of truth for reservation expiry.
//
// Every SWEEPER_INTERVAL_MS it asks the database "which ACTIVE reservations are
// past their expiresAt?" and recovers their stock. Because it reads the deadline
// from Postgres (not from memory), it keeps working even after a server restart,
// when any per-reservation setTimeout timers would have been lost.
//
// The per-reservation setTimeout (see routes/drops.js) is just a latency
// optimization for the happy path; THIS is the authority.
import { prisma } from "./lib/prisma.js";
import { expireReservation } from "./lib/expire.js";

const INTERVAL_MS = Number(process.env.SWEEPER_INTERVAL_MS) || 3000;

let timer = null;
let running = false; // prevents overlapping runs if a sweep takes longer than the interval

async function sweep() {
  if (running) return;
  running = true;
  try {
    const expired = await prisma.reservation.findMany({
      where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
      select: { id: true },
    });

    for (const r of expired) {
      // expireReservation is idempotent thanks to the ACTIVE guard, so even if
      // a setTimeout fires at the same moment, stock is returned only once.
      const did = await expireReservation(r.id);
      if (did) console.log(`[sweeper] recovered stock from reservation ${r.id}`);
    }
  } catch (err) {
    console.error("[sweeper] error:", err);
  } finally {
    running = false;
  }
}

export function startSweeper() {
  if (timer) return;
  console.log(`[sweeper] started, interval ${INTERVAL_MS}ms`);
  timer = setInterval(sweep, INTERVAL_MS);
  // Run one immediately on boot to catch anything that expired while we were down.
  sweep();
}

export function stopSweeper() {
  if (timer) clearInterval(timer);
  timer = null;
}
