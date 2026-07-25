-- DEV ONLY. Creates a pre-confirmed account so the sign-in flow can be tested
-- without sending a confirmation email to a fake address from Supabase's
-- rate-limited SMTP.
--
-- ⚠ Do not run this against anything that matters, and delete the account
--   before the system holds real data:
--
--     delete from auth.users where email = 'dev@switchboard.test';
--
-- Deleting the user cascades to every owned row, because owner_id references
-- auth.users(id) on delete cascade.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  -- ⚠ These four MUST be '' and not NULL, even though the columns are
  --   nullable and default to NULL.
  --
  --   GoTrue scans them into non-nullable Go strings. A NULL fails the scan
  --   and the login returns HTTP 500 `Database error querying schema` — which
  --   reads like a broken database, not a malformed row, and sends you looking
  --   in entirely the wrong place. The app surfaces it as "those credentials
  --   did not work", which is wronger still.
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'dev@switchboard.test',
  extensions.crypt('devpassword123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

-- GoTrue resolves a password grant through auth.identities, not auth.users
-- alone. Without this row the account exists but cannot sign in.
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, created_at, updated_at
)
values (
  gen_random_uuid(),
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","email":"dev@switchboard.test","email_verified":true}'::jsonb,
  'email', now(), now()
)
on conflict do nothing;
