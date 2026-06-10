// Concurrency / anti-overselling proof.
//
// Fires N simultaneous reserve requests at a freshly created 1-stock drop and
// asserts that EXACTLY ONE succeeds. This is the evidence that the atomic
// conditional UPDATE prevents overselling under a race.
//
// Usage (server must be running):
//   node scripts/concurrency-test.js
//   N=200 API=http://localhost:4000 node scripts/concurrency-test.js
import "dotenv/config";

const API = process.env.API || `http://localhost:${process.env.PORT || 4000}`;
const N = Number(process.env.N) || 100;
const STOCK = Number(process.env.STOCK) || 1;

async function main() {
  console.log(`Target: ${API}`);
  console.log(`Creating a drop with stock=${STOCK}, then firing ${N} concurrent reserves...\n`);

  // 1. Create a fresh drop with limited stock.
  const createRes = await fetch(`${API}/api/drops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Race Test ${new Date().toISOString()}`,
      totalStock: STOCK,
      description: "Created by concurrency-test.js",
    }),
  });
  if (!createRes.ok) throw new Error(`Failed to create drop: ${createRes.status}`);
  const drop = await createRes.json();
  console.log(`Created drop ${drop.id} (stock ${drop.availableStock})`);

  // 2. Fire N reserve requests as simultaneously as possible.
  //    Each uses a distinct username so the per-user guard never interferes.
  const attempts = Array.from({ length: N }, (_, i) =>
    fetch(`${API}/api/drops/${drop.id}/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `racer_${i}_${Date.now()}` }),
    }).then((r) => r.status)
  );

  const statuses = await Promise.all(attempts);

  // 3. Tally results.
  const success = statuses.filter((s) => s === 201).length;
  const conflict = statuses.filter((s) => s === 409).length;
  const other = statuses.filter((s) => s !== 201 && s !== 409);

  console.log(`\n--- Results for ${N} concurrent reserves on ${STOCK} unit(s) ---`);
  console.log(`✅ Succeeded (201):     ${success}`);
  console.log(`🚫 Rejected  (409):     ${conflict}`);
  if (other.length) console.log(`❓ Unexpected statuses: ${other.join(", ")}`);

  const pass = success === STOCK && conflict === N - STOCK;
  console.log(
    `\n${pass ? "PASS ✅" : "FAIL ❌"} — expected exactly ${STOCK} success and ${N - STOCK} rejections.`
  );

  // 4. Confirm stock is exactly 0 (not negative — no overselling).
  const list = await (await fetch(`${API}/api/drops`)).json();
  const after = list.find((d) => d.id === drop.id);
  console.log(`Final availableStock: ${after?.availableStock} (must be 0, never negative)`);

  process.exit(pass && after?.availableStock === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
