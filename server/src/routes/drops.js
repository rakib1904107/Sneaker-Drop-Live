import { Router } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { emitStockUpdate } from "../lib/io.js";
import { expireReservation } from "../lib/expire.js";

const router = Router();

const TTL_SECONDS = Number(process.env.RESERVATION_TTL_SECONDS) || 60;

// Small helper to build an http error with a status code.
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * GET /api/drops
 * List all drops, each with its 3 most recent successful purchasers (activity feed).
 */
router.get("/", async (_req, res, next) => {
  try {
    const drops = await prisma.drop.findMany({
      orderBy: { startsAt: "desc" },
      include: {
        purchases: {
          orderBy: { createdAt: "desc" },
          take: 3, // top 3 latest buyers
          select: {
            id: true,
            createdAt: true,
            user: { select: { username: true } },
          },
        },
      },
    });

    // Flatten the purchaser shape for the frontend.
    const shaped = drops.map((d) => ({
      ...d,
      recentPurchasers: d.purchases.map((p) => ({
        username: p.user.username,
        purchasedAt: p.createdAt,
      })),
      purchases: undefined,
    }));

    res.json(shaped);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/drops
 * Create a new merch drop (the "Merch Drop API").
 * Body: { name, description?, imageUrl?, totalStock, startsAt? }
 */
router.post("/", async (req, res, next) => {
  try {
    const { name, description, imageUrl, totalStock, startsAt } = req.body;

    if (!name || typeof name !== "string") {
      throw httpError(400, "name is required");
    }
    const stock = Number(totalStock);
    if (!Number.isInteger(stock) || stock < 1) {
      throw httpError(400, "totalStock must be a positive integer");
    }
    let startsAtDate = undefined;
    if (startsAt !== undefined) {
      startsAtDate = new Date(startsAt);
      if (Number.isNaN(startsAtDate.getTime())) {
        throw httpError(400, "startsAt must be a valid date");
      }
    }

    const drop = await prisma.drop.create({
      data: {
        name,
        description: description ?? null,
        imageUrl: imageUrl ?? null,
        totalStock: stock,
        availableStock: stock, // initialize live stock to the full quantity
        ...(startsAtDate ? { startsAt: startsAtDate } : {}),
      },
    });

    res.status(201).json(drop);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/drops/:id/reserve
 * Atomically reserve one unit for 60 seconds.
 * Body: { username }
 *
 * Overselling is prevented by a single conditional UPDATE
 * (availableStock decrement WHERE availableStock > 0). Under concurrency,
 * Postgres row-locks serialize the updates; only requests that still see
 * stock > 0 succeed. We check the affected-row count to pick winner vs loser.
 */
router.post("/:id/reserve", async (req, res, next) => {
  try {
    const { id: dropId } = req.params;
    const { username } = req.body;
    if (!username || typeof username !== "string") {
      throw httpError(400, "username is required");
    }

    // Find or create the user (no auth in this assessment).
    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username },
    });

    const reservationId = randomUUID();
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

    // THE oversell-proof core: ONE atomic, auto-committed SQL statement that
    // conditionally decrements stock AND inserts the reservation via a CTE.
    //  - "WHERE availableStock > 0" + Postgres row-locking serialize concurrent
    //    reserves, so only winners decrement (no overselling, never negative).
    //  - The NOT EXISTS clause folds the "one ACTIVE reservation per user per drop"
    //    UX guard into the SAME statement, so the hot path is a single round-trip.
    //  - No interactive transaction means no connection is held across round-trips,
    //    so it stays robust under hundreds of simultaneous requests.
    // If nothing qualifies, `upd` matches no row, `ins` inserts nothing, and the
    // final SELECT returns zero rows.
    const rows = await prisma.$queryRaw`
      WITH upd AS (
        UPDATE "Drop"
        SET "availableStock" = "availableStock" - 1, "updatedAt" = now()
        WHERE id = ${dropId}
          AND "availableStock" > 0
          AND NOT EXISTS (
            SELECT 1 FROM "Reservation" r
            WHERE r."dropId" = "Drop".id
              AND r."userId" = ${user.id}
              AND r.status = 'ACTIVE'::"ReservationStatus"
          )
        RETURNING id, "availableStock"
      ), ins AS (
        INSERT INTO "Reservation" (id, "dropId", "userId", status, "expiresAt", "createdAt")
        SELECT ${reservationId}, id, ${user.id}, 'ACTIVE'::"ReservationStatus", ${expiresAt}, now()
        FROM upd
        RETURNING id, "expiresAt"
      )
      SELECT u."availableStock" AS "availableStock",
             i.id              AS "reservationId",
             i."expiresAt"     AS "expiresAt"
      FROM upd u JOIN ins i ON true
    `;

    if (!rows || rows.length === 0) {
      // Failure path only (off the hot path): one query to report the precise reason.
      const drop = await prisma.drop.findUnique({
        where: { id: dropId },
        select: { availableStock: true },
      });
      if (!drop) throw httpError(404, "Drop not found");
      if (drop.availableStock <= 0) throw httpError(409, "Sold out — no stock available");
      // Stock exists but we still didn't get a unit → the per-user guard blocked it.
      throw httpError(409, "You already have an active reservation for this drop");
    }

    const availableStock = Number(rows[0].availableStock);

    // Layer 1 of recovery: precise per-reservation timer for the happy path.
    // (The DB-backed sweeper is the durable authority if this is ever lost.)
    setTimeout(() => {
      expireReservation(reservationId).catch((e) =>
        console.error("setTimeout expiry error:", e)
      );
    }, TTL_SECONDS * 1000);

    // Real-time: tell everyone the stock dropped.
    emitStockUpdate(dropId, availableStock);

    res.status(201).json({
      reservationId,
      dropId,
      userId: user.id,
      username: user.username,
      expiresAt: rows[0].expiresAt,
      availableStock,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
