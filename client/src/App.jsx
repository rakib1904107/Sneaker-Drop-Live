import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useStore } from "./lib/store.js";
import { socket } from "./lib/socket.js";
import { getUsername } from "./lib/username.js";
import { api } from "./lib/api.js";
import DropCard from "./components/DropCard.jsx";

export default function App() {
  const { drops, loading, error, fetchDrops, setStock, addPurchaser } = useStore();
  const [connected, setConnected] = useState(socket.connected);
  const username = getUsername();

  useEffect(() => {
    fetchDrops();

    // --- Wire real-time events to the store ---
    const onStock = ({ dropId, availableStock }) => setStock(dropId, availableStock);
    const onPurchase = ({ dropId, purchaser }) => addPurchaser(dropId, purchaser);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("stock:update", onStock);
    socket.on("purchase:new", onPurchase);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("stock:update", onStock);
      socket.off("purchase:new", onPurchase);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [fetchDrops, setStock, addPurchaser]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">👟 Sneaker Drop — Live</h1>
            <p className="text-xs text-slate-400">Real-time limited-edition inventory</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span
                className={"h-2 w-2 rounded-full " + (connected ? "bg-emerald-400" : "bg-red-400")}
              />
              {connected ? "Live" : "Offline"}
            </span>
            <span className="text-slate-400">
              You: <span className="font-semibold text-slate-200">{username}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <CreateDropForm onCreated={fetchDrops} />

        {loading && <p className="text-slate-400">Loading drops…</p>}
        {error && (
          <p className="rounded-lg bg-red-500/10 p-3 text-red-400">
            Failed to load: {error}. Is the backend running?
          </p>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {drops.map((drop) => (
              <DropCard key={drop.id} drop={drop} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// Small collapsible form to demo the "Merch Drop API" (feature 5).
function CreateDropForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [totalStock, setTotalStock] = useState(10);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createDrop({ name, totalStock: Number(totalStock), description });
      toast.success(`Drop "${name}" created`);
      setName("");
      setDescription("");
      setTotalStock(10);
      setOpen(false);
      onCreated();
    } catch (err) {
      toast.error(err.message || "Could not create drop");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
      >
        {open ? "− Close" : "+ New Drop"}
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-4"
        >
          <input
            required
            placeholder="Drop name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            required
            type="number"
            min="1"
            placeholder="Stock"
            value={totalStock}
            onChange={(e) => setTotalStock(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
          <input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm sm:col-span-4"
          />
        </form>
      )}
    </div>
  );
}
