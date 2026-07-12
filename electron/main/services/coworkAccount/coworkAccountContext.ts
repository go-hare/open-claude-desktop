export type CoworkAccountDetails = {
  accountTaggedId?: string;
  accountUuid?: string;
  displayName?: string;
  emailAddress?: string;
  fullName?: string;
  hasWiggle?: boolean;
  isLoggedOut: boolean;
  isRaven?: boolean;
};

export type CoworkAccountIdentity = {
  accountUuid: string;
  organizationUuid: string;
};

type AccountListener = (details: CoworkAccountDetails) => void;

export type CoworkAccountContextOptions = {
  loadBootstrapIdentity?: () => Promise<CoworkAccountIdentity | null>;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeAccountDetails(value: unknown): CoworkAccountDetails {
  const input =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    accountTaggedId: nonEmptyString(input.accountTaggedId),
    accountUuid: nonEmptyString(input.accountUuid),
    displayName: nonEmptyString(input.displayName),
    emailAddress: nonEmptyString(input.emailAddress),
    fullName: nonEmptyString(input.fullName),
    hasWiggle: input.hasWiggle === true,
    isLoggedOut: input.isLoggedOut === true,
    isRaven: input.isRaven === true,
  };
}

function identityFromDetails(
  details: CoworkAccountDetails | null,
  organizationUuid?: string,
): CoworkAccountIdentity | null {
  if (details?.isLoggedOut || !details?.accountUuid) return null;
  if (!organizationUuid) return null;
  return {
    accountUuid: details.accountUuid,
    organizationUuid,
  };
}

export class CoworkAccountContext {
  private readonly loadBootstrapIdentity?: CoworkAccountContextOptions["loadBootstrapIdentity"];
  private details: CoworkAccountDetails | null = null;
  private readonly listeners = new Set<AccountListener>();
  private organizationUuid: string | undefined;

  constructor(options: CoworkAccountContextOptions = {}) {
    this.loadBootstrapIdentity = options.loadBootstrapIdentity;
  }

  getAccountDetails(): CoworkAccountDetails | null {
    return this.details ? { ...this.details } : null;
  }

  getIdentity(): CoworkAccountIdentity | null {
    return identityFromDetails(this.details, this.organizationUuid);
  }

  setAccountDetails(value: unknown): CoworkAccountDetails {
    const details = normalizeAccountDetails(value);
    this.details = details;
    for (const listener of this.listeners) listener({ ...details });
    return { ...details };
  }

  waitForIdentity(timeoutMs = 5_000): Promise<CoworkAccountIdentity | null> {
    const current = this.getIdentity();
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (identity: CoworkAccountIdentity | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.listeners.delete(onChange);
        resolve(identity);
      };
      const onChange: AccountListener = (details) => {
        const identity = identityFromDetails(details, this.organizationUuid);
        if (identity || details.isLoggedOut) finish(identity);
      };
      const timer = setTimeout(() => {
        void this.loadFallbackIdentity().then(finish);
      }, timeoutMs);
      this.listeners.add(onChange);
    });
  }

  private async loadFallbackIdentity(): Promise<CoworkAccountIdentity | null> {
    const fallback = await this.loadBootstrapIdentity?.().catch(() => null);
    if (!fallback) return null;
    this.organizationUuid = fallback.organizationUuid;
    const accountUuid = this.details?.accountUuid ?? fallback.accountUuid;
    if (!accountUuid || this.details?.isLoggedOut) return null;
    return { accountUuid, organizationUuid: fallback.organizationUuid };
  }
}
