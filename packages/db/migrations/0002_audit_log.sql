-- The audit log: append-only, enforced in the database in three layers.
--   1. god_app holds INSERT on five columns and SELECT, and nothing else (no UPDATE, DELETE, TRUNCATE).
--   2. Triggers raise on UPDATE, DELETE and TRUNCATE for every role, including the owner and a superuser.
--   3. `seq` is GENERATED ALWAYS and the time is set by the database: god_app has no INSERT on those columns.

CREATE TABLE god_app.audit_log (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- AuditEvent.when. "when" is a reserved word, so the column is occurred_at.
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  who          text NOT NULL CHECK (btrim(who) <> '' AND char_length(who) <= 200),
  action       text NOT NULL CHECK (action IN
                 ('person.open', 'export.pdf', 'allowlist.invite', 'allowlist.change', 'session.revoke', 'signin.refused')),
  target       text NOT NULL CHECK (btrim(target) <> '' AND char_length(target) <= 200),
  reason       text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 2000),
  outcome      text NOT NULL DEFAULT 'done' CHECK (outcome IN ('done', 'refused'))
);

CREATE INDEX audit_log_occurred_idx ON god_app.audit_log (occurred_at DESC, seq DESC);
CREATE INDEX audit_log_who_idx ON god_app.audit_log (who, seq DESC);
CREATE INDEX audit_log_target_idx ON god_app.audit_log (target, seq DESC);

CREATE FUNCTION god_app.audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END
$$;
REVOKE ALL ON FUNCTION god_app.audit_log_append_only() FROM PUBLIC;

CREATE TRIGGER audit_log_no_row_change BEFORE UPDATE OR DELETE ON god_app.audit_log
  FOR EACH ROW EXECUTE FUNCTION god_app.audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON god_app.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION god_app.audit_log_append_only();

GRANT SELECT ON god_app.audit_log TO god_app;
GRANT INSERT (who, action, target, reason, outcome) ON god_app.audit_log TO god_app;
