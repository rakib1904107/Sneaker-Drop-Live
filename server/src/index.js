import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";

import { initIo } from "./lib/io.js";
import { startSweeper } from "./sweeper.js";
import dropsRouter from "./routes/drops.js";
import reservationsRouter from "./routes/reservations.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
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
initIo(server, { cors: { origin: CLIENT_ORIGIN } }).then((io) => {
  io.on("connection", (socket) => {
    console.log(`socket connected: ${socket.id}`);
    socket.on("disconnect", () => console.log(`socket disconnected: ${socket.id}`));
  });

  startSweeper();

  server.listen(PORT, () => {
    console.log(`API + WebSocket server listening on http://localhost:${PORT}`);
  });
});
