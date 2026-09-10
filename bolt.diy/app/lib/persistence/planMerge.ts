/**
 * Pure, type-only LWW merge planner shared by cloud sync.
 *
 * Kept free of runtime imports (only `import type`) so Node can run a unit
 * test against it without a browser or bundler. cloudSync re-exports the types
 * and the planner from here for back-compat.
 */

import type { Message } from 'ai';
import type { IChatMetadata } from './db';
import type { ChatHistoryItem } from './useChatHistory';

export interface CloudConversation {
  id: string;
  url_id: string | null;
  description: string | null;
  messages: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CloudChatPayload {
  id: string;
  url_id?: string;
  description?: string;
  messages: Message[];
  metadata?: IChatMetadata;
  updated_at: string;
}

function toValidIso(value: string | undefined | null): string {
  if (value && !isNaN(Date.parse(value))) {
    return value;
  }

  return new Date().toISOString();
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toLocalItem(cloud: CloudConversation): ChatHistoryItem {
  const item: ChatHistoryItem = {
    id: cloud.id,
    urlId: cloud.url_id ?? undefined,
    description: cloud.description ?? undefined,
    messages: safeJsonParse<Message[]>(cloud.messages, []),
    timestamp: toValidIso(cloud.updated_at),
    metadata: safeJsonParse<IChatMetadata | undefined>(cloud.metadata, undefined),
  };

  if (!Array.isArray(item.messages)) {
    item.messages = [];
  }

  return item;
}

export function toCloudPayload(item: ChatHistoryItem): CloudChatPayload {
  return {
    id: item.id,
    url_id: item.urlId,
    description: item.description,
    messages: item.messages,
    metadata: item.metadata,
    updated_at: toValidIso(item.timestamp),
  };
}

/**
 * Compute what to write locally, delete locally and upload, applying the
 * Phase 1 whole-conversation last-write-wins merge rule:
 *
 * - same conversation -> newer `updated_at` wins
 * - local only          -> upload to D1
 * - cloud only          -> download into IndexedDB
 * - renamed             -> newer description wins (part of the whole object)
 * - cloud tombstone newer than the local copy -> delete locally
 * - local copy newer than the tombstone       -> resurrect (re-upload)
 */
export function planMerge(
  local: ChatHistoryItem[],
  cloud: CloudConversation[],
): { localWrites: ChatHistoryItem[]; localDeletes: string[]; cloudUpserts: CloudChatPayload[] } {
  const localWrites: ChatHistoryItem[] = [];
  const localDeletes: string[] = [];
  const cloudUpserts: CloudChatPayload[] = [];

  const localById = new Map<string, ChatHistoryItem>();

  for (const item of local) {
    localById.set(item.id, item);
  }

  const cloudIds = new Set<string>();

  for (const cloudItem of cloud) {
    cloudIds.add(cloudItem.id);

    const localItem = localById.get(cloudItem.id);
    const cloudDeletedAt = cloudItem.deleted_at ? toValidIso(cloudItem.deleted_at) : null;

    if (cloudDeletedAt) {
      if (!localItem) {
        // Nothing local to remove; tombstone already matches local state.
        continue;
      }

      const localTime = Date.parse(toValidIso(localItem.timestamp));
      const deleteTime = Date.parse(cloudDeletedAt);

      if (deleteTime >= localTime) {
        localDeletes.push(cloudItem.id);
      } else {
        // Local copy was edited after the deletion -> resurrect it.
        cloudUpserts.push(toCloudPayload(localItem));
      }

      continue;
    }

    if (!localItem) {
      localWrites.push(toLocalItem(cloudItem));
      continue;
    }

    const cloudTime = Date.parse(toValidIso(cloudItem.updated_at));
    const localTime = Date.parse(toValidIso(localItem.timestamp));

    if (cloudTime > localTime) {
      localWrites.push(toLocalItem(cloudItem));
    } else if (localTime > cloudTime) {
      cloudUpserts.push(toCloudPayload(localItem));
    }
    // Equal timestamps -> nothing to do.
  }

  // Local-only conversations are uploaded (initial migration on first login).
  for (const item of local) {
    if (cloudIds.has(item.id)) {
      continue;
    }

    if ((item.messages?.length ?? 0) === 0 && !item.description) {
      continue;
    }

    cloudUpserts.push(toCloudPayload(item));
  }

  return { localWrites, localDeletes, cloudUpserts };
}
