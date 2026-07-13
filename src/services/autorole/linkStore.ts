import { LinkedUser, PendingLink, PendingVerification } from '@prisma/client';
import { prisma } from '../../persistence/prisma';

export type { LinkedUser, PendingLink, PendingVerification };

/**
 * SQLite access for autorole link state: confirmed links, review-pending
 * links, and in-flight company-rename verifications. All rows are scoped by
 * serverId; uniqueness of a WarEra account per server is enforced by the
 * schema's composite unique constraints.
 */
export class LinkStore {
  // --- Linked users ---

  async getLink(serverId: string, discordUserId: string): Promise<LinkedUser | null> {
    return prisma.linkedUser.findUnique({
      where: { serverId_discordUserId: { serverId, discordUserId } },
    });
  }

  /** The member already linked to this WarEra account, if any. */
  async findLinkByWareraId(serverId: string, wareraUserId: string): Promise<LinkedUser | null> {
    return prisma.linkedUser.findUnique({
      where: { serverId_wareraUserId: { serverId, wareraUserId } },
    });
  }

  async listLinks(serverId: string): Promise<LinkedUser[]> {
    return prisma.linkedUser.findMany({ where: { serverId } });
  }

  async upsertLink(serverId: string, discordUserId: string, wareraUserId: string): Promise<void> {
    await prisma.linkedUser.upsert({
      where: { serverId_discordUserId: { serverId, discordUserId } },
      create: { serverId, discordUserId, wareraUserId },
      update: { wareraUserId },
    });
  }

  async deleteLink(serverId: string, discordUserId: string): Promise<boolean> {
    const res = await prisma.linkedUser.deleteMany({ where: { serverId, discordUserId } });
    return res.count > 0;
  }

  async setMuNoticeSentAt(serverId: string, discordUserId: string, at: Date): Promise<void> {
    await prisma.linkedUser.updateMany({
      where: { serverId, discordUserId },
      data: { muNoticeSentAt: at },
    });
  }

  // --- Pending links (staff review) ---

  async getPendingLink(serverId: string, discordUserId: string): Promise<PendingLink | null> {
    return prisma.pendingLink.findUnique({
      where: { serverId_discordUserId: { serverId, discordUserId } },
    });
  }

  async findPendingLinkByWareraId(serverId: string, wareraUserId: string): Promise<PendingLink | null> {
    return prisma.pendingLink.findUnique({
      where: { serverId_wareraUserId: { serverId, wareraUserId } },
    });
  }

  async listPendingLinks(serverId: string): Promise<PendingLink[]> {
    return prisma.pendingLink.findMany({ where: { serverId }, orderBy: { createdAt: 'asc' } });
  }

  async upsertPendingLink(data: {
    serverId: string;
    discordUserId: string;
    wareraUserId: string;
    wareraUsername: string;
    countryId?: string;
  }): Promise<void> {
    const { serverId, discordUserId, ...rest } = data;
    await prisma.pendingLink.upsert({
      where: { serverId_discordUserId: { serverId, discordUserId } },
      create: { serverId, discordUserId, ...rest },
      update: rest,
    });
  }

  async setPendingLinkReviewMessage(
    serverId: string,
    discordUserId: string,
    reviewChannelId: string,
    reviewMessageId: string
  ): Promise<void> {
    await prisma.pendingLink.updateMany({
      where: { serverId, discordUserId },
      data: { reviewChannelId, reviewMessageId },
    });
  }

  async deletePendingLink(serverId: string, discordUserId: string): Promise<boolean> {
    const res = await prisma.pendingLink.deleteMany({ where: { serverId, discordUserId } });
    return res.count > 0;
  }

  // --- Pending verifications (company-rename codes) ---

  async getVerification(serverId: string, discordUserId: string): Promise<PendingVerification | null> {
    return prisma.pendingVerification.findUnique({
      where: { serverId_discordUserId: { serverId, discordUserId } },
    });
  }

  async upsertVerification(data: {
    serverId: string;
    discordUserId: string;
    wareraUserId: string;
    wareraUsername: string;
    code: string;
    expiresAt: Date;
  }): Promise<void> {
    const { serverId, discordUserId, ...rest } = data;
    await prisma.pendingVerification.upsert({
      where: { serverId_discordUserId: { serverId, discordUserId } },
      create: { serverId, discordUserId, ...rest },
      update: rest,
    });
  }

  async deleteVerification(serverId: string, discordUserId: string): Promise<boolean> {
    const res = await prisma.pendingVerification.deleteMany({ where: { serverId, discordUserId } });
    return res.count > 0;
  }

  async deleteExpiredVerifications(now: Date): Promise<number> {
    const res = await prisma.pendingVerification.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return res.count;
  }
}
