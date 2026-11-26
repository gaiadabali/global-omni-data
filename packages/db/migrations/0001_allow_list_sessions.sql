-- Allow-list and sessions: the dashboard's own state (apps/dashboard/src/server/store/types.ts).
-- Runs as god_migrator inside the runner's transaction. The schema god_app exists already (roles/setup-roles.sql).

CREATE TABLE god_app.allow_list (
  id                text PRIMARY KEY CHECK (btrim(id) <> ''),
  name              text NOT NULL CHECK (btrim(name) <> ''),
  -- Lower case, matched once at first sign-in. After that the sub is used.
  email             text NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  yourtal_sub       text UNIQUE CHECK (yourtal_sub IS NULL OR btrim(yourtal_sub) <> ''),
  role              text NOT NULL CHECK (role IN ('owner', 'executive', 'data', 'brand_lead')),
  brand             text CHECK (brand IN ('yourtal', 'snapapp', 'ftr')),
  agreement_signed  date NOT NULL,
  original_held_by  text NOT NULL CHECK (btrim(original_held_by) <> ''),
  status            text NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  invited_by        text NOT NULL CHECK (btrim(invited_by) <> ''),
  invited_at        timestamptz NOT NULL DEFAULT now(),
  last_sign_in      timestamptz,
  -- A brand lead has exactly one brand, and nobody else has one.
  CONSTRAINT allow_list_brand_matches_role CHECK ((role = 'brand_lead') = (brand IS NOT NULL))
);

-- One live entry per email. A removed entry frees the email for a new invite.
CREATE UNIQUE INDEX allow_list_email_live_uq ON god_app.allow_list (email) WHERE status <> 'removed';

-- Once bound to a person's sub, an entry never moves to another sub.
CREATE FUNCTION god_app.allow_list_sub_is_final() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.yourtal_sub IS NOT NULL AND NEW.yourtal_sub IS DISTINCT FROM OLD.yourtal_sub THEN
    RAISE EXCEPTION 'allow_list.yourtal_sub is final once bound' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION god_app.allow_list_sub_is_final() FROM PUBLIC;
CREATE TRIGGER allow_list_sub_is_final BEFORE UPDATE ON god_app.allow_list
  FOR EACH ROW EXECUTE FUNCTION god_app.allow_list_sub_is_final();

CREATE TABLE god_app.sessions (
  id                   text PRIMARY KEY DEFAULT 'ses_' || replace(gen_random_uuid()::text, '-', ''),
  -- SHA-256 hex of the cookie token. The token itself is never stored.
  token_hash           text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id              text NOT NULL REFERENCES god_app.allow_list (id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL,
  last_seen_at         timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  auth_time            timestamptz NOT NULL,
  amr                  text[] NOT NULL DEFAULT '{}',
  user_agent           text CHECK (char_length(user_agent) <= 512),
  ip_prefix            text CHECK (char_length(ip_prefix) <= 64),
  revoked_at           timestamptz,
  revoked_by           text,
  -- The 8-hour absolute limit is a database rule, not only an application one.
  CONSTRAINT sessions_absolute_max CHECK (absolute_expires_at <= created_at + interval '8 hours'),
  CONSTRAINT sessions_revoke_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- listActive: not revoked, then the idle and absolute limits. Small partial indexes over live rows only.
CREATE INDEX sessions_live_last_seen_idx ON god_app.sessions (last_seen_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX sessions_live_user_idx ON god_app.sessions (user_id) WHERE revoked_at IS NULL;

-- Runtime role: no DELETE on either table (entries are removed by status, sessions by revoking), and UPDATE only on
-- the columns the dashboard changes. Everything else is fixed at insert.
GRANT SELECT, INSERT ON god_app.allow_list TO god_app;
GRANT UPDATE (yourtal_sub, status, last_sign_in) ON god_app.allow_list TO god_app;
GRANT SELECT, INSERT ON god_app.sessions TO god_app;
GRANT UPDATE (last_seen_at, auth_time, amr, revoked_at, revoked_by) ON god_app.sessions TO god_app;
