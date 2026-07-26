-- 0003_channels_unique_account
--
-- One channel per (tenant, platform, account).
--
-- Reconnecting a mailbox is normal: tokens get revoked, scopes change, someone
-- clicks Connect twice. Without this constraint each reconnect inserts a SECOND
-- channel row for the same mailbox, and both then register a Gmail watch
-- against the same address. Every message arrives twice, under two channel ids,
-- so the `unique (channel_id, external_id)` idempotency guard on `messages`
-- does not catch it — the channel ids differ. The timeline quietly doubles.
--
-- With this in place the OAuth callback can upsert on
-- (owner_id, type, display_name) and reconnecting refreshes the credential
-- rather than forking the channel.
--
-- owner_id is in the key because two tenants legitimately connect the same
-- shared mailbox, exactly as with contact_identities.
--
-- `display_name` holds the account's address for Gmail, which is the natural
-- key here. If a channel type ever needs a separate account identifier, add an
-- explicit `external_account_id` column rather than overloading this further.

alter table channels
  add constraint channels_owner_type_account_key
  unique (owner_id, type, display_name);
