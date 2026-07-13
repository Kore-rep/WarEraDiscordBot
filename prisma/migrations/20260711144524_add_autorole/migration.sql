-- AlterTable
ALTER TABLE "Server" ADD COLUMN "autorole" TEXT;

-- CreateTable
CREATE TABLE "LinkedUser" (
    "serverId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "wareraUserId" TEXT NOT NULL,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "muNoticeSentAt" DATETIME,

    PRIMARY KEY ("serverId", "discordUserId")
);

-- CreateTable
CREATE TABLE "PendingLink" (
    "serverId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "wareraUserId" TEXT NOT NULL,
    "wareraUsername" TEXT NOT NULL,
    "countryId" TEXT,
    "reviewChannelId" TEXT,
    "reviewMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("serverId", "discordUserId")
);

-- CreateTable
CREATE TABLE "PendingVerification" (
    "serverId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "wareraUserId" TEXT NOT NULL,
    "wareraUsername" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("serverId", "discordUserId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedUser_serverId_wareraUserId_key" ON "LinkedUser"("serverId", "wareraUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingLink_serverId_wareraUserId_key" ON "PendingLink"("serverId", "wareraUserId");
