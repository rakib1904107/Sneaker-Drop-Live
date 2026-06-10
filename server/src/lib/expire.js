// Shared expiration logic, used by BOTH layers of the recovery strategy:
//   1. the per-reservation setTimeout (precise, happy path)
//   2. the background sweeper (durable, survives restarts)
// Both call expireReservation(); the atomic ACTIVE->EXPIRED guard ensures the
// stock is returned EXACTLY ONCE even if both fire for the same reservation.
import { prisma } from "./prisma.js";
import { emitStockUpdate } from "./io.js";

/**
 * Expire a single reservation: mark it EXPIRED and return its unit to stock.
 * Safe to call multiple times / from multiple sources for the same id.
 *
 * @returns {Promise<boolean>} true if THIS call performed the expiry
 *   (and therefore emitted the socket update), false if it was already handled.
 */
export async function expireReservation(reservationId) {
  const newStock = await prisma.$transaction(async (tx) => {
    // Atomic guard: only the first caller flips ACTIVE -> EXPIRED.
    // updateMany returns a count we can check — same "DB as referee" trick
    // used to prevent overselling.
    const flipped = await tx.reservation.updateMany({
      where: { id: reservationId, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });

    // count === 0 means someone already expired/purchased it. Do nothing.
    if (flipped.count === 0) return null;

    // We won the race: return the unit to available stock.
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      select: { dropId: true },
    });

    const drop = await tx.drop.update({
      where: { id: reservation.dropId },
      data: { availableStock: { increment: 1 } },
      select: { id: true, availableStock: true },
    });

    return drop;
  });

  if (!newStock) return false; // already handled by another layer

  // Tell every connected client the stock went back up.
  emitStockUpdate(newStock.id, newStock.availableStock);
  return true;
}
