import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client for the whole process. SQLite allows one writer at a
 * time, so a single connection is what we want.
 */
export const prisma = new PrismaClient();
