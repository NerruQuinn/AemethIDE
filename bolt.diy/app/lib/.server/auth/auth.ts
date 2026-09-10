/**
 * Server-only Better Auth instance factory.
 *
 * The auth instance is created per Cloudflare binding env + request origin so that
 * the cookie domain/secure flags and CSRF checks match the host that served the
 * request (local dev, preview URLs and custom domains all just work). The D1
 * database binding (`env.DB`) is auto-detected by better-auth 1.7's kysely/D1
 * dialect — no manual adapter wiring needed.
 *
 * Never import this module from client code.
 */

import { betterAuth, type BetterAuthOptions } from 'better-auth';

export type AuthInstance = ReturnType<typeof betterAuth>;

const instancesByEnv = new WeakMap<object, Map<string, AuthInstance>>();

export function getAuth(env: Env, request: Request): AuthInstance {
  const secret = env.BETTER_AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET is not configured. Set it in .dev.vars locally and as a Cloudflare Pages ' +
        'environment variable in production (32+ random characters).',
    );
  }

  let byOrigin = instancesByEnv.get(env);

  if (!byOrigin) {
    byOrigin = new Map();
    instancesByEnv.set(env, byOrigin);
  }

  const origin = new URL(request.url).origin;
  let auth: AuthInstance | undefined = byOrigin.get(origin);

  if (!auth) {
    // Explicitly widen the literal to BetterAuthOptions so betterAuth's return
    // type matches AuthInstance (strict inference would produce a narrower,
    // incompatible Auth<> variant).
    const options: BetterAuthOptions = {
      appName: 'bolt',
      database: env.DB,
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      emailAndPassword: {
        enabled: true,
      },
      telemetry: {
        enabled: false,
      },
    };

    auth = betterAuth(options);

    byOrigin.set(origin, auth);
  }

  return auth;
}

export type BetterAuthInstance = ReturnType<typeof getAuth>;
