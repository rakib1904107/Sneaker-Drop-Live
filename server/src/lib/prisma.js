// Single shared PrismaClient instance for the whole app.
// Creating multiple clients exhausts the DB connection pool, so we export one.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
