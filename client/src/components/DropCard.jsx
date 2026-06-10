import { useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { getUsername } from "../lib/username.js";
import Countdown from "./Countdown.jsx";

export default function DropCard({ drop }) {
  // Local reservation state for THIS browser (the active hold, if any).
  const [reservation, setReservation] = useState(null);
  const [reserving, setReserving] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchased, setPurchased] = useState(false);

  const soldOut = drop.availableStock <= 0;
  const low = !soldOut && drop.availableStock <= 5;

  async function handleReserve() {
    setReserving(true);
    try {
      const res = await api.reserve(drop.id, getUsername());
      setReservation(res); // { reservationId, expiresAt, ... }
      setPurchased(false);
      toast.success("Reserved! You have 60s to complete checkout.");
    } catch (err) {
      // 409 from the atomic concurrency guard lands here.
      toast.error(err.message || "Could not reserve");
    } finally {
      setReserving(false);
    }
  }

  async function handlePurchase() {
    if (!reservation) return;
    setPurchasing(true);
    try {
      await api.purchase(reservation.reservationId);
      setPurchased(true);
      setReservation(null);
      toast.success("Purchase complete! 🎉");
    } catch (err) {
      toast.error(err.message || "Purchase failed");
      // If it expired, drop the stale reservation so the user can retry.
      if (err.status === 410) setReservation(null);
    } finally {
      setPurchasing(false);
    }
  }

  function handleExpire() {
    setReservation(null);
    toast("Your reservation expired — the unit was returned.", { icon: "⌛" });
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-lg">
      {drop.imageUrl && (
        <img
          src={drop.imageUrl}
          alt={drop.name}
          className="h-44 w-full object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-lg font-bold">{drop.name}</h3>
          {drop.description && (
            <p className="mt-0.5 text-sm text-slate-400">{drop.description}</p>
          )}
        </div>

        {/* Live stock count — the key real-time number */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Available stock</span>
          <span
            className={
              "rounded-md px-2 py-0.5 text-sm font-bold tabular-nums " +
              (soldOut
                ? "bg-red-500/15 text-red-400"
                : low
                ? "bg-amber-500/15 text-amber-400"
                : "bg-emerald-500/15 text-emerald-400")
            }
          >
            {soldOut ? "SOLD OUT" : `${drop.availableStock} / ${drop.totalStock}`}
          </span>
        </div>

        {/* Action area */}
        <div className="mt-auto space-y-2">
          {reservation ? (
            <>
              <Countdown expiresAt={reservation.expiresAt} onExpire={handleExpire} />
              <button
                onClick={handlePurchase}
                disabled={purchasing}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {purchasing ? "Processing…" : "Complete Purchase"}
              </button>
            </>
          ) : (
            <button
              onClick={handleReserve}
              disabled={reserving || soldOut}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {soldOut ? "Sold Out" : reserving ? "Reserving…" : purchased ? "Reserve Again" : "Reserve"}
            </button>
          )}
        </div>

        {/* Activity feed: top 3 recent purchasers */}
        <div className="border-t border-slate-800 pt-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recent buyers
          </p>
          {drop.recentPurchasers?.length ? (
            <ul className="space-y-0.5">
              {drop.recentPurchasers.map((p, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="font-medium">{p.username}</span>
                  <span className="text-xs text-slate-500">copped</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">No purchases yet — be the first!</p>
          )}
        </div>
      </div>
    </div>
  );
}
