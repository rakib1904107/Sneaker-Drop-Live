// Thin fetch wrapper around the backend REST API.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface the server's error message so the UI can toast it.
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  getDrops: () => request("/api/drops"),
  createDrop: (body) => request("/api/drops", { method: "POST", body: JSON.stringify(body) }),
  reserve: (dropId, username) =>
    request(`/api/drops/${dropId}/reserve`, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  purchase: (reservationId) =>
    request(`/api/reservations/${reservationId}/purchase`, { method: "POST" }),
};
