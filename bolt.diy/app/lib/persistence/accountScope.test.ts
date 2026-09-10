/**
 * Account-scoping + first-login migration regression tests (pure; no browser).
 *
 * Mirrors the merge planner test in scripts/planMerge.test.mjs. Covers the
 * ownership model from historyScope.ts, the session-scoped SQL builders in
 * syncQueries.ts and the integration points between both layers.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import type { ChatHistoryItem } from './useChatHistory';
import {
  buildMigrationCopy,
  isGuestMigrationEligible,
  itemInScope,
  markMigratedToUser,
  resolveHistoryListState,
  selectForScope,
  type HistoryScope,
} from './historyScope';
import { planMerge } from './planMerge';
import {
  deleteConversationStatement,
  listConversationsStatement,
  upsertConversationStatement,
} from '../.server/syncQueries';
const USER_A = 'user-a';
const USER_B = 'user-b';
const T1 = '2026-09-04T10:00:00.000Z';
const T2 = '2026-09-04T10:10:00.000Z';
const T3 = '2026-09-04T10:20:00.000Z';
function guest(id: string, over: Partial<ChatHistoryItem> = {}): ChatHistoryItem {
  return {
    id,
    urlId: `${id}-url`,
    description: `Chat ${id}`,
    messages: [{ id: `m-${id}`, role: 'user', content: 'hello', createdAt: new Date(T1) }],
    timestamp: T1,
    ownerType: 'guest',
    ownerId: null,
    ...over,
  };
}
function userItem(id: string, owner: string, over: Partial<ChatHistoryItem> = {}): ChatHistoryItem {
  return { ...guest(id), ownerType: 'user', ownerId: owner, ...over };
}
function cloudRow(id: string, updatedAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    url_id: null,
    description: `cloud ${id}`,
    messages: JSON.stringify([{ id: 'c1', role: 'assistant', content: 'yo', createdAt: updatedAt }]),
    metadata: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: null,
    ...over,
  };
}
const scopeA: HistoryScope = { kind: 'user', userId: USER_A };
const scopeB: HistoryScope = { kind: 'user', userId: USER_B };
const guestScope: HistoryScope = { kind: 'guest' };
function ids(items: { id: string }[]): string[] {
  return items.map((x) => x.id);
}
describe('history scope isolation', () => {
  it('guest history survives a refresh (records are read back in guest scope)', () => {
    const stored = [guest('g1')];
    // getAll + selectForScope is exactly what the sidebar does after a reload.
    assert.deepEqual(ids(selectForScope(stored, guestScope)), ['g1']);
  });
  it('an account only ever sees its own records', () => {
    const stored = [guest('g1'), userItem('a1', USER_A), userItem('b1', USER_B)];
    assert.deepEqual(ids(selectForScope(stored, scopeA)), ['a1']);
    assert.deepEqual(ids(selectForScope(stored, scopeB)), ['b1']);
  });
  it('signing out never shows a previous account history as guest content', () => {
    const stored = [guest('g1'), userItem('a1', USER_A)];
    assert.deepEqual(ids(selectForScope(stored, guestScope)), ['g1']);
  });
  it('history never renders while the auth session is still resolving', () => {
    assert.deepEqual(resolveHistoryListState('loading', null), { kind: 'loading' });
    assert.deepEqual(resolveHistoryListState('loading', USER_A), { kind: 'loading' });
    assert.deepEqual(resolveHistoryListState('unauthenticated', null), { kind: 'guest' });
    assert.deepEqual(resolveHistoryListState('authenticated', USER_A), { kind: 'user', userId: USER_A });
  });
});
describe('first-login guest migration', () => {
  it('migrates guest chats into the account and keeps the claimed originals for the guest', () => {
    const dbState = [guest('g1'), userItem('a1', USER_A), guest('empty', { messages: [], description: '' })];
    const eligible = dbState.filter((item) => itemInScope(item, guestScope)).filter(isGuestMigrationEligible);
    assert.deepEqual(ids(eligible), ['g1'], 'empty/no-title chats are never migrated');
    const copies = eligible.map((g, i) => buildMigrationCopy(g, USER_A, `migrated-${i}`, `migrated-${i}-url`)) as ChatHistoryItem[];
    const claimed = eligible.map((g) => markMigratedToUser(g, USER_A));
    const finalState: ChatHistoryItem[] = [...claimed, ...copies, userItem('a1', USER_A)];
    // The account sees only the fresh copy...
    assert.deepEqual(ids(selectForScope(finalState, scopeA)), ['migrated-0', 'a1']);
    // ...the guest keeps the original (claimed, never deleted),...
    const original = finalState.find((x) => x.id === 'g1');
    assert.deepEqual(original?.migratedTo, [USER_A]);
    // ...and it is no longer eligible for a second account.
    assert.equal(isGuestMigrationEligible(original!), false, 'claimed guest chats are not migrated again');
  });
  it('guest chats stay visible for the guest after a claimed migration (logout)', () => {
    const stored = [markMigratedToUser(guest('g1'), USER_A), userItem('a1', USER_A), userItem('b1', USER_B)];
    assert.deepEqual(ids(selectForScope(stored, guestScope)), ['g1']);
    assert.deepEqual(ids(selectForScope(stored, scopeB)), ['b1']);
  });
});
describe('cloud merge stays inside the active account', () => {
  it('second browser: empty local history pulls the account rows without touching D1', () => {
    const plan = planMerge([], [cloudRow('c1', T2)]);
    assert.deepEqual(ids(plan.localWrites), ['c1']);
    assert.deepEqual(plan.cloudUpserts, [], 'nothing to upload');
    assert.deepEqual(plan.localDeletes, []);
  });
  it('empty D1 never overwrites valid local history during migration', () => {
    const plan = planMerge([userItem('a1', USER_A, { timestamp: T3 })], []);
    assert.deepEqual(ids(plan.cloudUpserts), ['a1'], 'local account history is uploaded');
    assert.deepEqual(plan.localDeletes, [], 'local history is never deleted');
    assert.deepEqual(plan.localWrites, []);
  });
});
describe('sync query builders are session-scoped', () => {
  it('lists rows only for the session user', () => {
    const statement = listConversationsStatement(USER_B);
    assert.match(statement.sql, /WHERE user_id = \?1/);
    assert.deepEqual(statement.params, [USER_B]);
  });
  it('upserts are keyed by (user_id, id) and ignore any client-supplied owner', () => {
    const statement = upsertConversationStatement(USER_A, {
      id: 'shared-id',
      user_id: USER_B, // malicious/legacy client field: never used
      messages: [],
      updated_at: T3,
    });
    assert.ok(!('error' in statement), 'no error for a valid conversation');
    if ('error' in statement) return;
    assert.match(statement.sql, /ON CONFLICT \(user_id, id\)/);
    assert.match(statement.sql, /VALUES \(\?1, \?2/);
    assert.equal(statement.params[1], USER_A, 'row is written for the SESSION user, not the payload');
  });
  it('deletes only the session users row and only moves the tombstone forward', () => {
    const statement = deleteConversationStatement(USER_A, { id: 'shared-id', deleted_at: T3 });
    assert.ok(!('error' in statement));
    if ('error' in statement) return;
    assert.match(statement.sql, /WHERE id = \?2 AND user_id = \?3/);
    assert.equal(statement.params[2], USER_A);
    assert.match(statement.sql, /deleted_at IS NULL OR deleted_at < \?1/);
  });
});
describe('snapshots follow conversation ownership', () => {
  it('a chat owned by A cannot be restored while B or the guest is active', () => {
    // useChatHistory gates on the conversation record BEFORE reading the
    // snapshot store, so restore is impossible across scopes.
    const aChat = userItem('a1', USER_A);
    assert.equal(itemInScope(aChat, scopeB), false);
    assert.equal(itemInScope(aChat, guestScope), false);
    assert.equal(itemInScope(aChat, scopeA), true);
  });
});
