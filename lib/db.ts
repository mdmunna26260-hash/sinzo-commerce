import { PrismaClient } from "@prisma/client";

const globalAny: any = global;

export const db: PrismaClient = globalAny.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
});
if (process.env.NODE_ENV !== "production") globalAny.__prisma = db;
