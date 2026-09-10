import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '~/lib/.server/auth/auth';

/**
 * Better Auth catch-all resource route.
 *
 * All `/api/auth/*` requests (sign-in, sign-up, sign-out, get-session, ...) are
 * delegated to the Better Auth handler. Set-Cookie headers set by Better Auth
 * pass through the Remix response untouched.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const auth = getAuth(context.cloudflare.env, request);
    return auth.handler(request);
  } catch (error) {
    console.error('[api.auth] GET handler error', error);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const auth = getAuth(context.cloudflare.env, request);
    return auth.handler(request);
  } catch (error) {
    console.error('[api.auth] action handler error', error);
    return json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
