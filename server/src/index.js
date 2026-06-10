import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";

import { initIo } from "./lib/io.js";
import { startSweeper } from "./sweeper.js";
import dropsRouter from "./routes/drops.js";
import reservationsRouter from "./routes/reservations.js";

const PORT = process.env.PORT || 4000;

// Explicit origins from env (comma-separated). We also auto-allow localhost and
// any *.vercel.app domain so every Vercel deploy/preview URL works without
// reconfiguring CLIENT_ORIGIN each time.
const allowedExact = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser clients (curl, server-to-server, health checks)
  if (allowedExact.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (hostname === "vercel.app" || hostname.endsWith(".vercel.app")) return true;
  } catch {
    /* malformed origin → fall through to deny */
  }
  return false;
}

// Shared by both Express REST and Socket.io so they agree on what's allowed.
const corsOptions = {
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

// Health check (handy for uptime monitors and deploy platforms)
app.get("/health", (_req, res) => res.json({ ok: true }));

// REST API
app.use("/api/drops", dropsRouter);
app.use("/api/reservations", reservationsRouter);

// Centralized error handler — routes call next(err) and land here.
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Internal Server Error" });
});

const server = http.createServer(app);

// Boot Socket.io, then start the background sweeper, then listen.
initIo(server, { cors: corsOptions }).then((io) => {
  io.on("connection", (socket) => {
    console.log(`socket connected: ${socket.id}`);
    socket.on("disconnect", () => console.log(`socket disconnected: ${socket.id}`));
  });

  startSweeper();

  server.listen(PORT, () => {
    console.log(`API + WebSocket server listening on http://localhost:${PORT}`);
  });
});
