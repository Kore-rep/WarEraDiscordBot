import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { DiscordService } from '../discord/DiscordService';
import { AutoroleApi, AutoroleUser } from './autoroleApi';
import { LinkStore } from './linkStore';
import { parseUserInput } from './parseUserInput';
import { generateLinkCode, isVerificationExpired, LINK_CODE_TTL_MS } from './linkCode';
import {
  buildReviewComponents,
  buildReviewRequestContent,
  buildVerificationDmComponents,
  buildVerificationDmContent,
} from './reviewMessages';

const COMPANY_CHECK_TIMEOUT_MS = 30_000;

export type LinkResult =
  | { status: 'invalid-input' }
  | { status: 'not-found' }
  | { status: 'already-linked-other' }
  | { status: 'already-pending-other' }
  | { status: 'linked'; username: string }
  | { status: 'verification-dm-sent'; username: string; expiresAt: Date }
  | { status: 'dm-failed' }
  | { status: 'pending-review'; username: string; reviewPosted: boolean };

export type VerifyResult =
  | { status: 'no-verification' }
  | { status: 'expired' }
  | { status: 'code-not-found'; code: string }
  | { status: 'verified'; username: string };

export type ReviewResult =
  | { status: 'no-pending' }
  | { status: 'already-linked-other' }
  | { status: 'approved'; username: string; discordUserId: string }
  | { status: 'denied'; username: string; discordUserId: string }
  | { status: 'not-found'; username: string; discordUserId: string, reason: string };

export interface UnlinkResult {
  removedLink: boolean;
  removedPending: boolean;
  removedVerification: boolean;
}

/**
 * The WarEra account-linking state machine, shared by /link, the persistent
 * link button's modal, the verification DM buttons, and the staff review
 * Approve/Deny buttons. Discord I/O is limited to DMs and the review channel;
 * interaction replies belong to the callers.
 */
export class LinkFlow {
  constructor(
    private readonly api: AutoroleApi,
    private readonly store: LinkStore,
    private readonly discordService: DiscordService,
    /** Called after a link is stored so the member gets synced immediately. */
    private readonly onLinked: (serverId: string, discordUserId: string) => Promise<void>
  ) {}

  /** Start linking `rawInput` (username / id / profile URL) to a member. */
  async beginLink(params: {
    serverId: string;
    discordUserId: string;
    memberRoleIds: string[];
    rawInput: string;
  }): Promise<LinkResult> {
    const { serverId, discordUserId, memberRoleIds, rawInput } = params;
    const cfg = ServerConfigManager.getAutoroleConfig(serverId);

    const parsed = parseUserInput(rawInput);
    if (!parsed) {
      return { status: 'invalid-input' };
    }

    const user: AutoroleUser | null =
      parsed.kind === 'id'
        ? await this.api.getUserLite(parsed.value)
        : await this.api.resolveUserByUsername(parsed.value);
    if (!user) {
      return { status: 'not-found' };
    }

    const existingLink = await this.store.findLinkByWareraId(serverId, user._id);
    if (existingLink && existingLink.discordUserId !== discordUserId) {
      return { status: 'already-linked-other' };
    }
    const existingPending = await this.store.findPendingLinkByWareraId(serverId, user._id);
    if (existingPending && existingPending.discordUserId !== discordUserId) {
      return { status: 'already-pending-other' };
    }

    const countryAllowed = !!user.country && (cfg?.allowedCountryIds ?? []).includes(user.country);
    const proxyBypass = (cfg?.proxyRoleIds ?? []).some(roleId => memberRoleIds.includes(roleId));

    if (countryAllowed || proxyBypass) {
      if (cfg?.skipCompanyVerification) {
        await this.finalizeLink(serverId, discordUserId, user._id);
        return { status: 'linked', username: user.username };
      }
      return this.startVerification(serverId, discordUserId, user);
    }

    await this.store.upsertPendingLink({
      serverId,
      discordUserId,
      wareraUserId: user._id,
      wareraUsername: user.username,
      countryId: user.country || undefined,
    });

    let reviewPosted = false;
    if (cfg?.reviewChannelId) {
      const messageId = await this.discordService.sendToChannelWithComponents(
        cfg.reviewChannelId,
        buildReviewRequestContent({
          discordUserId,
          wareraUsername: user.username,
          wareraUserId: user._id,
          countryId: user.country || undefined,
        }),
        buildReviewComponents(discordUserId)
      );
      if (messageId) {
        await this.store.setPendingLinkReviewMessage(serverId, discordUserId, cfg.reviewChannelId, messageId);
        reviewPosted = true;
      }
    }
    return { status: 'pending-review', username: user.username, reviewPosted };
  }

  private async startVerification(
    serverId: string,
    discordUserId: string,
    user: AutoroleUser
  ): Promise<LinkResult> {
    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.store.upsertVerification({
      serverId,
      discordUserId,
      wareraUserId: user._id,
      wareraUsername: user.username,
      code,
      expiresAt,
    });

    const delivered = await this.discordService.sendDirectMessage(
      discordUserId,
      buildVerificationDmContent(code, expiresAt),
      buildVerificationDmComponents(serverId)
    );
    if (!delivered) {
      await this.store.deleteVerification(serverId, discordUserId);
      return { status: 'dm-failed' };
    }
    return { status: 'verification-dm-sent', username: user.username, expiresAt };
  }

  /** Check the member's companies for their verification code. */
  async runVerification(serverId: string, discordUserId: string): Promise<VerifyResult> {
    const verification = await this.store.getVerification(serverId, discordUserId);
    if (!verification) {
      return { status: 'no-verification' };
    }
    if (isVerificationExpired(verification.expiresAt)) {
      await this.store.deleteVerification(serverId, discordUserId);
      return { status: 'expired' };
    }

    let companyNames: string[] = [];
    try {
      companyNames = await Promise.race([
        this.api.getCompanyNamesForUser(verification.wareraUserId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('company lookup timed out')), COMPANY_CHECK_TIMEOUT_MS)
        ),
      ]);
    } catch (error) {
      logger.warn(`Autorole: company verification lookup failed for ${verification.wareraUserId}`, error);
      return { status: 'code-not-found', code: verification.code };
    }

    if (!companyNames.some(name => name === verification.code)) {
      return { status: 'code-not-found', code: verification.code };
    }

    await this.finalizeLink(serverId, discordUserId, verification.wareraUserId);
    return { status: 'verified', username: verification.wareraUsername };
  }

  /** Drop an in-flight verification (DM Cancel button). */
  async cancelVerification(serverId: string, discordUserId: string): Promise<boolean> {
    return this.store.deleteVerification(serverId, discordUserId);
  }

  /** Approve a review-pending link (staff button or /autorole links approve). */
  async approvePendingLink(serverId: string, discordUserId: string, reviewerLabel: string): Promise<ReviewResult> {
    const pending = await this.store.getPendingLink(serverId, discordUserId);
    if (!pending) {
      return { status: 'no-pending' };
    }
    const existingLink = await this.store.findLinkByWareraId(serverId, pending.wareraUserId);
    if (existingLink && existingLink.discordUserId !== discordUserId) {
      return { status: 'already-linked-other' };
    }

    
    const user: AutoroleUser | null = await this.api.getUserLite(pending.wareraUserId);
    if (!user) {
      await this.resolveReviewMessage(pending, `Error ⚠️ — unable to find user with username ${pending.wareraUsername}. TraceId: ${pending.wareraUserId+Date.now()}`);
      await this.discordService.sendDirectMessage(
          discordUserId,
          `Something went wrong with your WarEra link request for **${pending.wareraUsername}**. Please contact staff for help. Trace ID: ${pending.wareraUserId+Date.now()}`
        );
      return { status: 'not-found', username: pending.wareraUsername, discordUserId, reason: 'User not found' };
    }

    await this.resolveReviewMessage(pending, `Approved to begin verification ✅ — reviewed by ${reviewerLabel}`);
    await this.discordService.sendDirectMessage(
          discordUserId,
          `You were approved to begin linking your WarEra profile **${pending.wareraUsername}**.`
        );
    await this.startVerification(serverId, discordUserId, user);

    return { status: 'approved', username: pending.wareraUsername, discordUserId };
  }

  /** Deny a review-pending link (staff button or /autorole links deny). */
  async denyPendingLink(
    serverId: string,
    discordUserId: string,
    reviewerLabel: string,
    reason?: string
  ): Promise<ReviewResult> {
    const pending = await this.store.getPendingLink(serverId, discordUserId);
    if (!pending) {
      return { status: 'no-pending' };
    }
    await this.store.deletePendingLink(serverId, discordUserId);
    await this.store.deleteVerification(serverId, discordUserId);
    await this.resolveReviewMessage(pending, `Denied ❌ — reviewed by ${reviewerLabel}`);
    await this.discordService.sendDirectMessage(
      discordUserId,
      `Your WarEra link request for **${pending.wareraUsername}** was denied.${reason ? ` Reason: ${reason}` : ''}`
    );
    return { status: 'denied', username: pending.wareraUsername, discordUserId };
  }

  /** Remove a member's link and any pending state. */
  async unlink(serverId: string, discordUserId: string): Promise<UnlinkResult> {
    const pending = await this.store.getPendingLink(serverId, discordUserId);
    const [removedLink, removedPending, removedVerification] = await Promise.all([
      this.store.deleteLink(serverId, discordUserId),
      this.store.deletePendingLink(serverId, discordUserId),
      this.store.deleteVerification(serverId, discordUserId),
    ]);
    if (pending) {
      await this.resolveReviewMessage(pending, 'Withdrawn — the user unlinked.');
    }
    return { removedLink, removedPending, removedVerification };
  }

  private async finalizeLink(serverId: string, discordUserId: string, wareraUserId: string): Promise<void> {
    await this.store.upsertLink(serverId, discordUserId, wareraUserId);
    await this.store.deletePendingLink(serverId, discordUserId);
    await this.store.deleteVerification(serverId, discordUserId);
    try {
      await this.onLinked(serverId, discordUserId);
    } catch (error) {
      logger.warn(`Autorole: post-link sync failed for ${discordUserId} in ${serverId}`, error);
    }
  }

  /** Rewrite a review message with the decision and strip its buttons. */
  private async resolveReviewMessage(
    pending: {
      discordUserId: string;
      wareraUserId: string;
      wareraUsername: string;
      countryId: string | null;
      reviewChannelId: string | null;
      reviewMessageId: string | null;
    },
    suffix: string
  ): Promise<void> {
    if (!pending.reviewChannelId || !pending.reviewMessageId) {
      return;
    }
    const content = buildReviewRequestContent({
      discordUserId: pending.discordUserId,
      wareraUsername: pending.wareraUsername,
      wareraUserId: pending.wareraUserId,
      countryId: pending.countryId ?? undefined,
    });
    await this.discordService.editMessage(pending.reviewChannelId, pending.reviewMessageId, {
      content: `${content}\n\n**${suffix}**`,
      components: [],
    });
  }
}
