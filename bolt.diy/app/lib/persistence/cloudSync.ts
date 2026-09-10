/**
 * Client-side cloud synchronization layer.
 *
 * IndexedDB remains the local/offline cache but every local chat record is
 * scoped to an owner (guest or Better Auth user id, see historyScope.ts). This
 * layer only ever merges the CURRENT scope's local records with the CURRENT
 * user's D1 history - never guest records, never another account's records.
 *
 * First login runs a one-time guest migration: eligible (visible, unclaimed)
 * guest chats are copied into the account scope and uploaded to D1. Guest
 * originals are kept and marked as claimed so they can never leak into another
 * account. Every failure is logged and swallowed: chat and AI generation never
 * depend on cloud sync.
 */
import { db, deleteById, getAll, getMessages, getSnapshot, setSnapshot, putChat, newChatId, getUrlId } from './db';
import type { ChatHistoryItem } from './useChatHistory';
import { authStore } from '~/lib/stores/auth';
import { planMerge, toCloudPayload, type CloudConversation, type CloudChatPayload } from './planMerge';
import {
  buildMigrationCopy,
  isGuestMigrationEligible,
  itemInScope,
  markMigratedToUser,
  selectForScope,
  type HistoryScope,
} from './historyScope';
export { planMerge };
export type { CloudConversation, CloudChatPayload } from './planMerge';
const SYNC_INTERVAL_MS = 10_000;
let lastSyncAt = 0;
let syncChain: Promise<void> = Promise.resolve();
function shortUserId(userId: string): string {
  return userId.length <= 8 ? userId : `${userId.slice(0, 4)}…${userId.slice(-4)}`;
}
function logSync(action: string, detail?: unknown) {
  console.info(`[cloudSync] ${action}`, detail === undefined ? '' : detail);
}
function logSyncIssue(action: string, error: unknown) {
  console.warn(`[cloudSync] ${action} failed (chat continues to work locally)`, error);
}
/** Resolve the active history scope for cloud operations; null while loading or signed out. */
function activeScope(): Extract<HistoryScope, { kind: 'user' }> | null {
  const state = authStore.get();
  if (state.status === 'authenticated' && state.user?.id) {
    return { kind: 'user', userId: state.user.id };
  }
  return null;
}
/** GET /api/sync — every row for the current user, tombstones included. */
export async function fetchCloudConversations(): Promise<CloudConversation[]> {
  if (!activeScope()) {
    return [];
  }
  const response = await fetch('/api/sync', { credentials: 'same-origin' });
  if (response.status === 401) {
    authStore.set({ status: 'unauthenticated', user: null, session: null });
    return [];
  }
  if (!response.ok) {
    throw new Error(`sync list failed with status ${response.status}`);
  }
  const data = (await response.json()) as { conversations?: CloudConversation[] };
  return data.conversations ?? [];
}
/** UPSERT one conversation (only allowed while an account session is active). */
export async function pushChatToCloud(payload: CloudChatPayload): Promise<boolean> {
  if (!activeScope()) {
    return false;
  }
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'upsert', conversation: payload }),
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    authStore.set({ status: 'unauthenticated', user: null, session: null });
    return false;
  }
  if (!response.ok) {
    throw new Error(`sync upsert failed with status ${response.status}`);
  }
  return true;
}
/** Soft-delete one conversation so deletion can propagate to other devices. */
export async function deleteChatOnCloud(id: string): Promise<boolean> {
  const scope = activeScope();
  if (!scope) {
    return false;
  }
  const response = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'delete', id, deleted_at: new Date().toISOString() }),
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    authStore.set({ status: 'unauthenticated', user: null, session: null });
    return false;
  }
  if (!response.ok) {
    throw new Error(`sync delete failed with status ${response.status}`);
  }
  return true;
}
/**
 * Read a chat from IndexedDB and push it to the cloud - but only when that
 * chat actually belongs to the currently authenticated user. A guest chat (or
 * another account's chat) can never be uploaded into this account.
 */
export async function pushChatById(idOrUrlId: string): Promise<void> {
  const scope = activeScope();
  if (!db || !scope) {
    return;
  }
  try {
    const item = await getMessages(db, idOrUrlId);
    if (!item || !itemInScope(item, scope)) {
      return;
    }
    if ((item.messages?.length ?? 0) === 0 && !item.description) {
      return; // nothing worth uploading yet
    }
    await pushChatToCloud(toCloudPayload(item));
  } catch (error) {
    logSyncIssue(`push ${idOrUrlId}`, error);
  }
}
const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * Debounced background push for a chat id. Called after every local write; the
 * trailing timer uploads the final state (including mid-stream snapshots). The
 * owner check inside pushChatById keeps guest/foreign chats from ever leaking.
 */
export function scheduleCloudPush(idOrUrlId: string): void {
  if (!activeScope()) {
    return;
  }
  const existing = pendingPushes.get(idOrUrlId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    pendingPushes.delete(idOrUrlId);
    void pushChatById(idOrUrlId);
  }, 1500);
  pendingPushes.set(idOrUrlId, timer);
}
export function cancelCloudPush(idOrUrlId: string): void {
  const existing = pendingPushes.get(idOrUrlId);
  if (existing) {
    clearTimeout(existing);
    pendingPushes.delete(idOrUrlId);
  }
}
async function applyPlan(
  plan: { localWrites: ChatHistoryItem[]; localDeletes: string[]; cloudUpserts: CloudChatPayload[] },
  scope: Extract<HistoryScope, { kind: 'user' }>,
): Promise<void> {
  if (!db) {
    return;
  }
  for (const item of plan.localWrites) {
    try {
      // Cloud rows always belong to the current account: rewrite the local
      // record (if any) as owned by this user instead of merely updating it.
      const ownedItem: ChatHistoryItem = { ...item, ownerType: 'user', ownerId: scope.userId };
      await putChat(db, ownedItem);
    } catch (error) {
      logSyncIssue(`local write ${item.id}`, error);
    }
  }
  for (const id of plan.localDeletes) {
    try {
      await deleteById(db, id);
    } catch (error) {
      logSyncIssue(`local delete ${id}`, error);
    }
  }
  for (const payload of plan.cloudUpserts) {
    try {
      await pushChatToCloud(payload);
    } catch (error) {
      logSyncIssue(`upload ${payload.id}`, error);
    }
  }
}
/**
 * First-login guest migration. Copies every still-unclaimed, visible guest chat
 * into the current account (fresh id/urlId so it can never collide) and marks
 * the guest original as claimed. Guest history is never deleted; because the
 * originals are marked claimed they can never be migrated into a second account
 * or re-copied on the next login.
 */
async function migrateGuestHistory(scope: Extract<HistoryScope, { kind: 'user' }>): Promise<void> {
  if (!db) {
    return;
  }
  const guests = selectForScope(await getAll(db), { kind: 'guest' }).filter(isGuestMigrationEligible);
  if (guests.length === 0) {
    return;
  }
  let migrated = 0;
  for (const guest of guests) {
    try {
      const newId = newChatId();
      const newUrlId = await getUrlId(db, newId);
      const copy = buildMigrationCopy(guest, scope.userId, newId, newUrlId) as ChatHistoryItem;
      await putChat(db, copy);
      // The guest snapshot travels with the conversation (fresh key, user-owned).
      const snapshot = await getSnapshot(db, guest.id);
      if (snapshot) {
        await setSnapshot(db, newId, snapshot, { ownerType: 'user', ownerId: scope.userId });
      }
      // Best-effort immediate upload; the next full sync would upload it anyway.
      try {
        await pushChatToCloud(toCloudPayload(copy));
      } catch (error) {
        logSyncIssue(`guest migration upload ${guest.id}`, error);
      }
      // Claim the original so it is never copied into another account.
      await putChat(db, markMigratedToUser(guest, scope.userId) as ChatHistoryItem);
      migrated++;
    } catch (error) {
      logSyncIssue(`guest migration ${guest.id}`, error);
    }
  }
  logSync(`guest migration finished (${migrated}/${guests.length} copied for user ${shortUserId(scope.userId)})`);
}
async function doSync(force: boolean): Promise<void> {
  const scope = activeScope();
  if (!db || !scope) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastSyncAt < SYNC_INTERVAL_MS) {
    return;
  }
  lastSyncAt = now;
  try {
    const cloud = await fetchCloudConversations();
    const localAll = await getAll(db);
    // Only THIS user's local records take part in the merge. Guest records and
    // other accounts' records are invisible here, so they can neither overwrite
    // nor be overwritten by this account's D1 history.
    const localForUser = selectForScope(localAll, scope);
    const plan = planMerge(localForUser, cloud);
    await applyPlan(plan, scope);
    // Runs after the merge so records the cloud already knows about for this
    // user are never duplicated by the migration step.
    await migrateGuestHistory(scope);
  } catch (error) {
    logSyncIssue('sync', error);
  }
}
/**
 * Full two-way sync for the CURRENT account: pull D1, merge with the current
 * user's IndexedDB scope, apply locally, push winners and run the one-time
 * guest migration. Calls are serialized so two overlapping syncs (e.g. sidebar
 * open + window focus) can never double-run a merge or migration.
 */
export async function syncAll(force = false): Promise<void> {
  const run = async () => {
    await doSync(force);
  };
  const next = syncChain.then(run, run);
  syncChain = next.catch(() => undefined);
  return next;
}
export async function syncAllIfNeeded(): Promise<void> {
  if (activeScope()) {
    await syncAll();
  }
}
