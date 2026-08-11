-- AlterTable
ALTER TABLE "Server" ADD COLUMN "militaryUnits" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LinkedUser" (
    "serverId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "wareraUserId" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "muNoticeSentAt" DATETIME,
    "opsecRevoked" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("serverId", "discordUserId")
);
INSERT INTO "new_LinkedUser" ("discordUserId", "linkedAt", "muNoticeSentAt", "serverId", "wareraUserId") SELECT "discordUserId", "linkedAt", "muNoticeSentAt", "serverId", "wareraUserId" FROM "LinkedUser";
DROP TABLE "LinkedUser";
ALTER TABLE "new_LinkedUser" RENAME TO "LinkedUser";
CREATE UNIQUE INDEX "LinkedUser_serverId_wareraUserId_key" ON "LinkedUser"("serverId", "wareraUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
