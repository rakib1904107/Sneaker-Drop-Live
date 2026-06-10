// Seeds the database with demo users and a couple of drops so the app has
// something to show immediately. Run with: npm run seed
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // --- Users ---
  const usernames = ["sneakerhead", "hypebeast", "kickscollector", "soleseeker", "dropbot"];
  await prisma.user.createMany({
    data: usernames.map((username) => ({ username })),
    skipDuplicates: true,
  });
  console.log(`Seeded ${usernames.length} users`);

  // --- Drops ---
  const drops = [
    {
      name: "Air Jordan 1 Retro High OG",
      description: "Chicago colorway. The grail. 100 pairs only.",
      imageUrl: "https://images.unsplash.com/photo-1556906781-9a412961c28c?w=600",
      totalStock: 100,
    },
    {
      name: "Nike Dunk Low Panda",
      description: "The everyday classic. Limited restock of 5.",
      imageUrl: "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600",
      totalStock: 5,
    },
    {
      name: "Yeezy Boost 350 V2",
      description: "Last call. Only 1 pair left in the vault.",
      imageUrl: "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=600",
      totalStock: 1,
    },
  ];

  for (const d of drops) {
    await prisma.drop.create({
      data: { ...d, availableStock: d.totalStock },
    });
  }
  console.log(`Seeded ${drops.length} drops`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
