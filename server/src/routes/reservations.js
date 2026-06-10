import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { emitPurchase } from "../lib/io.js";

const router = Router();

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * POST /api/reservations/:id/purchase
 * Complete a purchase for a reservation the user currently holds.
 *
 * Stock was already decremented at reserve time, so purchasing simply makes that
 * deduction permanent — we do NOT touch availableStock here. We atomically flip
 * ACTIVE -> COMPLETED so the expiry layers (setTimeout/sweeper) won't return the
 * unit: once COMPLETED, expireReservation's ACTIVE guard makes it a no-op.
 */
router.post("/:id/purchase", async (req, res, next) => {
  try {
    const { id: reservationId } = req.params;

    const purchase = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: { user: { select: { id: true, username: true } } },
      });

      if (!reservation) throw httpError(404, "Reservation not found");
      if (reservation.status === "COMPLETED") {
        throw httpError(409, "This reservation has already been purchased");
      }
      if (reservation.status === "EXPIRED" || reservation.expiresAt < new Date()) {
        throw httpError(410, "Reservation expired — please reserve again");
      }

      // Atomic guard: only flip if still ACTIVE (prevents racing with expiry).
      const flipped = await tx.reservation.updateMany({
        where: { id: reservationId, status: "ACTIVE" },
        data: { status: "COMPLETED" },
      });
      if (flipped.count === 0) {
        // Lost the race to the sweeper/timeout in the last instant.
        throw httpError(410, "Reservation just expired — please reserve again");
      }

      const created = await tx.purchase.create({
        data: {
          dropId: reservation.dropId,
          userId: reservation.userId,
          reservationId: reservation.id,
        },
      });

      return {
        id: created.id,
        dropId: reservation.dropId,
        username: reservation.user.username,
        createdAt: created.createdAt,
      };
    });

    // Real-time: push the new buyer into everyone's activity feed.
    emitPurchase(purchase.dropId, {
      username: purchase.username,
      purchasedAt: purchase.createdAt,
    });

    res.status(201).json({
      purchaseId: purchase.id,
      dropId: purchase.dropId,
      username: purchase.username,
      purchasedAt: purchase.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
