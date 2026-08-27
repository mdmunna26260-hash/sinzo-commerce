import { PrismaClient } from "@prisma/client";
const globalAny: any = global;
export const db: PrismaClient = globalAny.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalAny.__prisma = db;
