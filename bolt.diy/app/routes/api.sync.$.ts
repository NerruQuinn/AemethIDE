import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '~/lib/.server/auth/auth';
import {
  deleteConversationStatement,
  listConversationsStatement,
  upsertConversationStatement,
} from '~/lib/.server/syncQueries';

/**
 * Authenticated conversation sync endpoints.
 *
 * Every query is scoped by the session's user.id; client-supplied user ids are
 * ignored (the client payload has no owner field at all). Conversations store
 * the whole ai.Message[] array as JSON (`messages` column). Deletion is a
 * soft-delete/tombstone so it can propagate to other devices. Rows are keyed by
 * (user_id, id) - see migrations/0001 - so ids can never collide across users.
 */

interface ConversationRow {
  id: string;
  url_id: string | null;
  description: string | null;
  messages: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

async function getSessionUser(env: Env, request: Request) {
  const auth = getAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });

  return session?.user ?? null;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await getSessionUser(context.cloudflare.env, request);

  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const statement = listConversationsStatement(user.id);
    const result = await context.cloudflare.env.DB.prepare(statement.sql)
      .bind(...statement.params)
      .all<ConversationRow>();

    return json({ conversations: result.results ?? [] });
  } catch (error) {
    console.error('[api.sync] list failed', error);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await getSessionUser(context.cloudflare.env, request);

  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { op?: string } & Record<string, unknown>;

    switch (body.op) {
      case 'upsert': {
        const conversation = (body.conversation ?? {}) as Record<string, unknown>;
        const statement = upsertConversationStatement(user.id, conversation);

        if ('error' in statement) {
          return json({ error: statement.error }, { status: 400 });
        }

        await context.cloudflare.env.DB.prepare(statement.sql)
          .bind(...statement.params)
          .run();

        return json({ ok: true });
      }
      case 'delete': {
        const statement = deleteConversationStatement(user.id, body);

        if ('error' in statement) {
          return json({ error: statement.error }, { status: 400 });
        }

        await context.cloudflare.env.DB.prepare(statement.sql)
          .bind(...statement.params)
          .run();

        return json({ ok: true });
      }
      default:
        return json({ error: 'Unsupported operation' }, { status: 400 });
    }
  } catch (error) {
    console.error('[api.sync] action failed', error);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
