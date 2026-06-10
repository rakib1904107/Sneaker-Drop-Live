// Holds the Socket.io server instance so any module (routes, sweeper) can emit
// real-time events without circular imports. `init` is called once from index.js.
let io = null;

export function initIo(server, options) {
  // Lazy import keeps this module dependency-light.
  return import("socket.io").then(({ Server }) => {
    io = new Server(server, options);
    return io;
  });
}

export function getIo() {
  if (!io) throw new Error("Socket.io not initialized yet");
  return io;
}

// --- Domain event helpers -------------------------------------------------
// Centralizing emit calls keeps event names consistent across the codebase.

/** Broadcast a drop's new available stock to every connected client. */
export function emitStockUpdate(dropId, availableStock) {
  getIo().emit("stock:update", { dropId, availableStock });
}

/** Broadcast a new successful purchase (drives the live activity feed). */
export function emitPurchase(dropId, purchaser) {
  getIo().emit("purchase:new", { dropId, purchaser });
}
