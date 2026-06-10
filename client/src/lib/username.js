// Generates and persists a per-browser username (no auth in this assessment).
// Stored in localStorage so each browser window is a distinct "user" — handy
// for the two-window real-time demo.
const KEY = "sneaker-drop-username";

const ADJECTIVES = ["swift", "hyped", "rare", "fresh", "iced", "gold", "noir", "neon"];
const NOUNS = ["sole", "kick", "drip", "heat", "grail", "fly", "lace", "boost"];

function generate() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${a}_${n}${num}`;
}

export function getUsername() {
  let name = localStorage.getItem(KEY);
  if (!name) {
    name = generate();
    localStorage.setItem(KEY, name);
  }
  return name;
}
