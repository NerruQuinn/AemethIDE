-- Rebuild the Bolt conversation table with a composite owner-scoped primary key.
--
-- Why: conversation ids used to be globally unique (PK = id). Two accounts could
-- never hold the same id, and an upsert keyed on the bare id could not be
-- isolated per user. Local chat ids are now UUIDs, but legacy numeric ids may
-- still exist on multiple devices. Keying rows by (user_id, id) lets every user
-- own their own id space and lets the sync API upsert/delete with a conflict
-- target that is always scoped to the session user.
--
-- Column layout and soft-delete/tombstone semantics are unchanged. Requires
-- migrations/0000 to have run first (it creates the original table).

create table "conversation_new" (
  "id" text not null,
  "user_id" text not null references "user" ("id") on delete cascade,
  "url_id" text,
  "description" text,
  "messages" text not null,
  "metadata" text,
  "created_at" text not null,
  "updated_at" text not null,
  "deleted_at" text,
  primary key ("user_id", "id")
);

insert into "conversation_new" ("id", "user_id", "url_id", "description", "messages", "metadata", "created_at", "updated_at", "deleted_at")
  select "id", "user_id", "url_id", "description", "messages", "metadata", "created_at", "updated_at", "deleted_at"
  from "conversation";

drop table "conversation";

alter table "conversation_new" rename to "conversation";

create index "conversation_user_updated_idx" on "conversation" ("user_id", "updated_at");
