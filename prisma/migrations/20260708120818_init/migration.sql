-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyBattles" TEXT,
    "mercenaryContracts" TEXT,
    "reports" TEXT,
    "userTracking" TEXT,
    "countryTracking" TEXT,
    "proxyTracking" TEXT,
    "countryGroups" TEXT,
    "spectre" TEXT,
    "leaderboard" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WeeklyDamageSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "csv" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "WeeklyDamageSnapshot_serverId_kind_idx" ON "WeeklyDamageSnapshot"("serverId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDamageSnapshot_serverId_kind_week_key" ON "WeeklyDamageSnapshot"("serverId", "kind", "week");
