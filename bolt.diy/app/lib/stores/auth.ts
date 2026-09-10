import { atom } from 'nanostores';
import type { HistoryScope } from '~/lib/persistence/historyScope';

/**
 * Client auth store. The server Better Auth session is authoritative; this
 * store is only a thin, hydrated mirror used by the UI. No authentication
 * logic is duplicated in the browser.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  session: AuthSession | null;
}

const initialState: AuthState = {
  status: 'loading',
  user: null,
  session: null,
};

const unauthenticatedState: AuthState = {
  status: 'unauthenticated',
  user: null,
  session: null,
};

export const authStore = atom<AuthState>(initialState);

async function postJson(url: string, payload?: unknown): Promise<any> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      credentials: 'same-origin',
    });
  } catch (error) {
    console.error(`[auth] network error on ${url}`, error);
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }

  let body: any = null;

  try {
    body = await response.json();
  } catch {
    // Non-JSON error responses are reported generically below.
  }

  if (!response.ok) {
    const message = body?.message || body?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body ?? null;
}

export function isAuthenticated(): boolean {
  return authStore.get().status === 'authenticated';
}

/**
 * The history scope the UI should render right now, or null while the session
 * is still hydrating. null means: do not render any history at all.
 */
export function currentHistoryScope(): HistoryScope | null {
  const state = authStore.get();

  if (state.status === 'authenticated' && state.user?.id) {
    return { kind: 'user', userId: state.user.id };
  }

  if (state.status === 'unauthenticated') {
    return { kind: 'guest' };
  }

  return null;
}

/** Fetch the current server session and mirror it into the store. */
export async function hydrateAuth(): Promise<AuthState> {
  try {
    const response = await fetch('/api/auth/get-session', { credentials: 'same-origin' });

    let body: any = null;

    try {
      body = await response.json();
    } catch {
      // fall through to unauthenticated
    }

    const user = body?.user ?? null;
    const session = body?.session ?? null;

    if (response.ok && user && session) {
      authStore.set({ status: 'authenticated', user, session });

      return authStore.get();
    }

    authStore.set(unauthenticatedState);

    return authStore.get();
  } catch (error) {
    // Offline / backend unreachable: never block the local guest chat experience.
    console.warn('[auth] session hydration failed, assuming guest', error);
    authStore.set(unauthenticatedState);

    return authStore.get();
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthState> {
  await postJson('/api/auth/sign-in/email', { email, password });

  return hydrateAuth();
}

export async function signUpWithEmail(name: string, email: string, password: string): Promise<AuthState> {
  await postJson('/api/auth/sign-up/email', { name, email, password });

  return hydrateAuth();
}

export async function signOutFromAuth(): Promise<void> {
  try {
    await postJson('/api/auth/sign-out', {});
  } finally {
    authStore.set(unauthenticatedState);
  }
}
