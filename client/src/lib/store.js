import { create } from "zustand";
import { api } from "./api.js";

// Central client state: the list of drops plus live mutations from WebSockets.
export const useStore = create((set, get) => ({
  drops: [],
  loading: true,
  error: null,

  fetchDrops: async () => {
    set({ loading: true, error: null });
    try {
      const drops = await api.getDrops();
      set({ drops, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  // --- Live updates pushed from the server over Socket.io ---

  // stock:update — patch a single drop's available stock in place.
  setStock: (dropId, availableStock) =>
    set((state) => ({
      drops: state.drops.map((d) =>
        d.id === dropId ? { ...d, availableStock } : d
      ),
    })),

  // purchase:new — prepend the new buyer, keep only the latest 3.
  addPurchaser: (dropId, purchaser) =>
    set((state) => ({
      drops: state.drops.map((d) =>
        d.id === dropId
          ? { ...d, recentPurchasers: [purchaser, ...d.recentPurchasers].slice(0, 3) }
          : d
      ),
    })),
}));
