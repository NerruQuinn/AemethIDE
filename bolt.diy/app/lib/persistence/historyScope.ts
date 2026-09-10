/**
 * Pure, account-scoping + first-login migration helpers for local chat history.
 *
 * Kept free of runtime imports (only local types) so Node can unit-test it
 * without a browser or bundler, mirroring `planMerge.ts`.
 *
 * Ownership model on a local chat record:
 *   ownerType: 'guest' | 'user'          (absent/legacy records read as guest)
 *   ownerId:   null for guest, Better Auth user.id for authenticated chats
 *   migratedTo: user ids a guest chat was copied into (guest records only)
 */

export type ChatOwnerType = 'guest' | 'user';

export interface ChatOwnerFields {
  ownerType?: ChatOwnerType;
  ownerId?: string | null;
  migratedTo?: string[];
}

export type HistoryScope = { kind: 'guest' } | { kind: 'user'; userId: string };

export interface ScopeableItem extends ChatOwnerFields {
  id: string;
  urlId?: string;
  description?: string;
  timestamp?: string;
  messages: unknown[];
  metadata?: unknown;
}

export function scopeMatchesOwner(owner: ChatOwnerFields | null | undefined, scope: HistoryScope): boolean {
  const type = owner?.ownerType ?? 'guest';

  if (type === 'guest') {
    return scope.kind === 'guest';
  }

  return scope.kind === 'user' && owner?.ownerId === scope.userId;
}

export function itemInScope<T extends ScopeableItem>(item: T, scope: HistoryScope): boolean {
  return scopeMatchesOwner(item, scope);
}

export function selectForScope<T extends ScopeableItem>(items: T[], scope: HistoryScope): T[] {
  return items.filter((item) => scopeMatchesOwner(item, scope));
}

export function isGuestOwned<T extends ScopeableItem>(item: T): boolean {
  return (item.ownerType ?? 'guest') === 'guest';
}

/** True when this guest chat has never been copied into any account yet. */
export function isUnclaimed<T extends ScopeableItem>(item: T): boolean {
  return !Array.isArray(item.migratedTo) || item.migratedTo.length === 0;
}

export function isVisibleChat<T extends ScopeableItem>(item: T): boolean {
  return Boolean(item.urlId && item.description);
}

export function hasConversationContent<T extends ScopeableItem>(item: T): boolean {
  return Array.isArray(item.messages) && item.messages.length > 0;
}

/**
 * A guest chat is eligible for first-login migration when it is still unclaimed,
 * visible in the history list and holds real messages. Empty no-title chats are
 * never migrated.
 */
export function isGuestMigrationEligible<T extends ScopeableItem>(item: T): boolean {
  return isGuestOwned(item) && isUnclaimed(item) && isVisibleChat(item) && hasConversationContent(item);
}

export function markMigratedToUser<T extends ScopeableItem>(item: T, userId: string): T {
  const migratedTo = [...(Array.isArray(item.migratedTo) ? item.migratedTo : [])];

  if (!migratedTo.includes(userId)) {
    migratedTo.push(userId);
  }

  return { ...item, migratedTo };
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build the account-scoped copy of a guest chat. The copy always gets a fresh
 * id/urlId so it can never collide with the guest original or other scopes.
 */
export function buildMigrationCopy<T extends ScopeableItem>(item: T, userId: string, newId: string, newUrlId: string) {
  return {
    id: newId,
    urlId: newUrlId,
    description: item.description,
    messages: deepClone(item.messages),
    timestamp: item.timestamp,
    metadata: item.metadata === undefined ? undefined : deepClone(item.metadata),
    ownerType: 'user' as const,
    ownerId: userId,
  };
}

/**
 * Resolve the visible history state for the sidebar given the auth status.
 * Returns { kind: 'loading' } while the account scope is still unknown so no
 * history from another scope can ever be rendered first.
 */
export function resolveHistoryListState(status: 'loading' | 'authenticated' | 'unauthenticated', userId: string | null) {
  if (status === 'authenticated' && userId) {
    return { kind: 'user', userId } as const;
  }

  if (status === 'unauthenticated') {
    return { kind: 'guest' } as const;
  }

  return { kind: 'loading' } as const;
}
