-- Better Auth core schema (v1.7.2, sqlite/kysely dialect).
-- Generated from the installed better-auth@1.7.2 migration planner; do not edit column names/types.

create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text not null primary key,
  "issuer" text not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

create unique index "account_issuer_accountId_uidx" on "account" ("issuer", "accountId");

-- Bolt application table: whole-conversation cloud sync (Phase 1).
-- messages holds the full ai.Message[] array as JSON, preserving tool-call,
-- annotation, artifact and boltAction data verbatim.

create table "conversation" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "url_id" text,
  "description" text,
  "messages" text not null,
  "metadata" text,
  "created_at" text not null,
  "updated_at" text not null,
  "deleted_at" text
);

create index "conversation_user_updated_idx" on "conversation" ("user_id", "updated_at");
