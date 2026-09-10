import { useStore } from '@nanostores/react';
import { useState, type FormEvent } from 'react';
import { classNames } from '~/utils/classNames';
import {
  authStore,
  hydrateAuth,
  signInWithEmail,
  signOutFromAuth,
  signUpWithEmail,
} from '~/lib/stores/auth';

interface AuthMenuProps {
  /** Called after a successful sign-in/out so callers can re-sync + reload. */
  onAuthStateChanged?: () => void;
}

const inputClass = classNames(
  'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700',
  'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none',
  'focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/50',
);

/**
 * Compact sign-in / account control for the sidebar header. Better Auth
 * handles the actual session; this component only drives the auth store.
 */
export function AuthMenu({ onAuthStateChanged }: AuthMenuProps) {
  const auth = useStore(authStore);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'signIn' | 'signUp'>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const authenticated = auth.status === 'authenticated';
  const user = auth.user;

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    setError(null);

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (!trimmedEmail || !password) {
      setError('Email and password are required.');
      return;
    }

    if (view === 'signUp' && !trimmedName) {
      setError('Please enter your name.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);

    try {
      if (view === 'signIn') {
        await signInWithEmail(trimmedEmail, password);
      } else {
        await signUpWithEmail(trimmedName, trimmedEmail, password);
      }

      setEmail('');
      setPassword('');
      setName('');
      setOpen(false);
      onAuthStateChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);

    try {
      await signOutFromAuth();
    } catch (err) {
      console.warn('[auth] sign out failed', err);
    } finally {
      setBusy(false);
      setOpen(false);
      onAuthStateChanged?.();
    }
  };

  const refreshSession = async () => {
    await hydrateAuth();
    onAuthStateChanged?.();
  };

  return (
    <div className="relative">
      {!authenticated ? (
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            void refreshSession();
          }}
          title="Sign in or create an account to sync your chats"
          className={classNames(
            'flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400',
            'hover:text-purple-700 dark:hover:text-purple-300 transition-colors',
          )}
        >
          <span className="inline-block i-ph:sign-in text-base" />
          <span>Sign in</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          title={user?.email ?? 'Signed in'}
          className={classNames(
            'flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400',
            'hover:text-emerald-900 dark:hover:text-emerald-300 transition-colors max-w-[200px]',
          )}
        >
          <span className="inline-block i-ph:cloud-check text-base" />
          <span className="truncate">{user?.email}</span>
        </button>
      )}

      {open && (
        <div
          className={classNames(
            'absolute left-0 top-full z-50 mt-2 w-72 rounded-xl shadow-xl',
            'bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800',
          )}
        >
          {authenticated ? (
            <div className="p-4 space-y-3">
              <div className="text-sm text-gray-900 dark:text-gray-100 break-words">{user?.email}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Your conversations sync to the cloud when signed in. Chats you delete here are removed on your other
                devices too.
              </div>
              <button
                type="button"
                onClick={signOut}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-60 transition-colors"
              >
                <span className="inline-block i-ph:sign-out" />
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {view === 'signIn' ? 'Sign in' : 'Create account'}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setView(view === 'signIn' ? 'signUp' : 'signIn');
                    setError(null);
                  }}
                  className="text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
                >
                  {view === 'signIn' ? 'Register instead' : 'Sign in instead'}
                </button>
              </div>

              {view === 'signUp' && (
                <label className="block">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Name</span>
                  <input
                    className={inputClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                  />
                </label>
              )}

              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">Email</span>
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label className="block">
                <span className="text-xs text-gray-500 dark:text-gray-400">Password</span>
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={view === 'signUp' ? 'new-password' : 'current-password'}
                  required
                />
              </label>

              {error && <div className="text-xs text-red-500 leading-snug">{error}</div>}

              <button
                type="submit"
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-3 py-2 disabled:opacity-60 transition-colors"
              >
                {busy ? 'Please wait…' : view === 'signIn' ? 'Sign in' : 'Create account'}
              </button>

              <div className="text-[11px] leading-snug text-gray-400 dark:text-gray-500">
                Signed-in chats are stored in your private cloud history. AI providers are never involved in
                authentication.
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
