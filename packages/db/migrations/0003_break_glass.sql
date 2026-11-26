-- Break-glass: one sealed emergency Owner passkey, registered with the dashboard itself (not YourTal), for when
-- YourTal is down (founder decision 2026-11-27). apps/dashboard/src/server/breakglass/ and store/types.ts
-- (BreakGlassStore). Runs as god_migrator inside the runner's transaction. Forward-only.
--
-- 1. break_glass_credentials: the WebAuthn public key and nothing else about the key or the person.
-- 2. break_glass_enrolment_codes: one-time codes the lead makes on the server (node /app/db/src/cli.ts
--    break-glass-code). Only the SHA-256 is stored. god_app can read and use a code but never make one, so a
--    stolen Owner session alone cannot enrol a key (two-person rule: server access plus an Owner session).
-- 3. sessions: an emergency session (amr has 'break-glass') lasts at most 1 hour, and stays an emergency session.
-- 4. audit_log: the action CHECK is widened for the break-glass events, and for signin.ok, signin.fresh and signout,
--    which the sign-in code already writes but 0002's CHECK did not list.

CREATE TABLE god_app.break_glass_credentials (
  -- base64url WebAuthn credential id (at most 1023 bytes, so at most 1364 characters).
  -- (Postgres regex bounds stop at 255, so the length is a separate test.)
  credential_id  text PRIMARY KEY CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND char_length(credential_id) <= 1400),
  -- COSE public key.
  public_key     bytea NOT NULL CHECK (octet_length(public_key) BETWEEN 16 AND 4096),
  sign_count     bigint NOT NULL DEFAULT 0 CHECK (sign_count BETWEEN 0 AND 4294967295),
  owner_id       text NOT NULL REFERENCES god_app.allow_list (id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz
);

-- At most one active key per Owner entry.
CREATE UNIQUE INDEX break_glass_one_active_per_owner
  ON god_app.break_glass_credentials (owner_id) WHERE revoked_at IS NULL;

-- On insert: only for an active Owner entry, and at most 2 active keys in total. The advisory lock serialises
-- concurrent enrolments (it needs no table privilege, unlike LOCK TABLE), and the count then sees every committed key.
CREATE FUNCTION god_app.break_glass_credentials_insert_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7340113202);
  IF NOT EXISTS (
    SELECT 1 FROM god_app.allow_list a WHERE a.id = NEW.owner_id AND a.role = 'owner' AND a.status = 'active'
  ) THEN
    RAISE EXCEPTION 'break-glass keys are for active Owner entries only' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM god_app.break_glass_credentials c WHERE c.revoked_at IS NULL) >= 2 THEN
    RAISE EXCEPTION 'at most 2 active break-glass keys' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION god_app.break_glass_credentials_insert_rules() FROM PUBLIC;
CREATE TRIGGER break_glass_credentials_insert_rules BEFORE INSERT ON god_app.break_glass_credentials
  FOR EACH ROW EXECUTE FUNCTION god_app.break_glass_credentials_insert_rules();

-- On update: a revoked key never changes again (revocation is final), and the signature counter never goes back.
CREATE FUNCTION god_app.break_glass_credentials_update_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked break-glass key is final' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.sign_count < OLD.sign_count THEN
    RAISE EXCEPTION 'break-glass sign_count cannot go back' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION god_app.break_glass_credentials_update_rules() FROM PUBLIC;
CREATE TRIGGER break_glass_credentials_update_rules BEFORE UPDATE ON god_app.break_glass_credentials
  FOR EACH ROW EXECUTE FUNCTION god_app.break_glass_credentials_update_rules();

CREATE TABLE god_app.break_glass_enrolment_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SHA-256 hex of the normalised code. The code itself is shown once, on the server, and never stored.
  code_hash   text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  owner_id    text NOT NULL REFERENCES god_app.allow_list (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  used_at     timestamptz,
  -- 15 minutes at most, a database rule.
  CONSTRAINT break_glass_codes_15_minutes CHECK (expires_at <= created_at + interval '15 minutes')
);

-- A used code stays used.
CREATE FUNCTION god_app.break_glass_codes_used_is_final() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'a used enrolment code is final' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION god_app.break_glass_codes_used_is_final() FROM PUBLIC;
CREATE TRIGGER break_glass_codes_used_is_final BEFORE UPDATE ON god_app.break_glass_enrolment_codes
  FOR EACH ROW EXECUTE FUNCTION god_app.break_glass_codes_used_is_final();

-- An emergency session lasts 1 hour at most. Existing rows have no 'break-glass' in amr, so they all pass.
ALTER TABLE god_app.sessions ADD CONSTRAINT sessions_break_glass_one_hour
  CHECK (NOT ('break-glass' = ANY (amr)) OR absolute_expires_at <= created_at + interval '1 hour');

-- Once an emergency session, always one: a later passkey check cannot wash 'break-glass' out of amr.
CREATE FUNCTION god_app.sessions_break_glass_is_final() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF 'break-glass' = ANY (OLD.amr) AND NOT ('break-glass' = ANY (NEW.amr)) THEN
    RAISE EXCEPTION 'an emergency session stays an emergency session' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION god_app.sessions_break_glass_is_final() FROM PUBLIC;
CREATE TRIGGER sessions_break_glass_is_final BEFORE UPDATE OF amr ON god_app.sessions
  FOR EACH ROW EXECUTE FUNCTION god_app.sessions_break_glass_is_final();

-- The audit actions. 0002 named its column CHECK audit_log_action_check (Postgres's default name); it is replaced, not
-- edited. Validating it reads the table once; it never updates a row, so the append-only triggers do not fire.
ALTER TABLE god_app.audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE god_app.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'person.open', 'export.pdf', 'allowlist.invite', 'allowlist.change', 'session.revoke',
  'signin.refused', 'signin.ok', 'signin.fresh', 'signout',
  'breakglass.code', 'breakglass.enrol', 'breakglass.revoke', 'breakglass.signin', 'breakglass.refused'
));

-- Runtime role: no DELETE on either table (revocation and use are updates), INSERT only of the columns a new key
-- needs (the times, the counter's history and revocation are not the app's to choose at insert), and UPDATE only of
-- the columns that change. Enrolment codes: read and mark used only; god_app cannot make one.
GRANT SELECT ON god_app.break_glass_credentials TO god_app;
GRANT INSERT (credential_id, public_key, sign_count, owner_id) ON god_app.break_glass_credentials TO god_app;
GRANT UPDATE (sign_count, last_used_at, revoked_at) ON god_app.break_glass_credentials TO god_app;
GRANT SELECT ON god_app.break_glass_enrolment_codes TO god_app;
GRANT UPDATE (used_at) ON god_app.break_glass_enrolment_codes TO god_app;
