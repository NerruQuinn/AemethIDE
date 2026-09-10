/**
 * Pure, server-side conversation query builders for the D1 sync endpoints.
 *
 * Split from the Remix route so the SQL and its bindings can be unit-tested in
 * Node. Every builder takes the session-derived `userId` - a client can never
 * influence whose rows are touched, because the client payload contains no
 * owner field at all.
 */

export const MAX_MESSAGES_BYTES = 10_000_000;

export interface ListConversationStatement {
  sql: string;
  params: [string];
}

/** Every row for ONE user, tombstones included, newest first. */
export function listConversationsStatement(userId: string): ListConversationStatement {
  return {
    sql:
      'SELECT id, url_id, description, messages, metadata, created_at, updated_at, deleted_at ' +
      'FROM conversation WHERE user_id = ?1 ORDER BY updated_at DESC',
    params: [userId],
  };
}

export interface UpsertConversationStatement {
  sql: string;
  params: (string | null)[];
}

export interface UpsertConversationError {
  error: string;
}

/**
 * Upsert one conversation into the session user's history. Rows are keyed by
 * (user_id, id), so a conversation id can never collide with - or overwrite -
 * another user's row. The `WHERE conversation.updated_at < excluded.updated_at`
 * guard keeps the last-write-wins rule on the server as well.
 */
export function upsertConversationStatement(
  userId: string,
  conv: Record<string, unknown>,
): UpsertConversationStatement | UpsertConversationError {
  const { id, url_id, description, messages, metadata, updated_at } = conv as {
    id?: unknown;
    url_id?: unknown;
    description?: unknown;
    messages?: unknown;
    metadata?: unknown;
    updated_at?: unknown;
  };

  if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
    return { error: 'conversation.id is required' };
  }

  let messagesText: string;

  if (typeof messages === 'string') {
    messagesText = messages;
  } else if (messages !== undefined && messages !== null) {
    messagesText = JSON.stringify(messages);
  } else {
    return { error: 'conversation.messages is required' };
  }

  if (new TextEncoder().encode(messagesText).byteLength > MAX_MESSAGES_BYTES) {
    return { error: 'conversation.messages is too large' };
  }

  const updatedAt = typeof updated_at === 'string' && !isNaN(Date.parse(updated_at)) ? updated_at : new Date().toISOString();
  const urlId = typeof url_id === 'string' ? url_id : null;
  const descriptionText = typeof description === 'string' ? description : null;
  const metadataText = metadata === undefined || metadata === null ? null : JSON.stringify(metadata);

  return {
    sql:
      'INSERT INTO conversation (id, user_id, url_id, description, messages, metadata, created_at, updated_at, deleted_at) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL) ' +
      'ON CONFLICT (user_id, id) DO UPDATE SET ' +
      'url_id = excluded.url_id, description = excluded.description, messages = excluded.messages, ' +
      'metadata = excluded.metadata, updated_at = excluded.updated_at, deleted_at = NULL ' +
      'WHERE conversation.updated_at < excluded.updated_at',
    params: [id, userId, urlId, descriptionText, messagesText, metadataText, updatedAt, updatedAt],
  };
}

export interface DeleteConversationStatement {
  sql: string;
  params: [string, string, string];
}

export interface DeleteConversationError {
  error: string;
}

/**
 * Soft-delete (tombstone) ONE user's conversation. Deletion is scoped by the
 * session user id and only ever moves forward (never un-deletes an older tombstone).
 */
export function deleteConversationStatement(
  userId: string,
  body: Record<string, unknown>,
): DeleteConversationStatement | DeleteConversationError {
  const { id, deleted_at } = body as { id?: unknown; deleted_at?: unknown };

  if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
    return { error: 'id is required' };
  }

  const deletedAt = typeof deleted_at === 'string' && !isNaN(Date.parse(deleted_at)) ? deleted_at : new Date().toISOString();

  return {
    sql:
      'UPDATE conversation SET deleted_at = ?1, updated_at = ?1 ' +
      'WHERE id = ?2 AND user_id = ?3 AND (deleted_at IS NULL OR deleted_at < ?1)',
    params: [deletedAt, id, userId],
  };
}
