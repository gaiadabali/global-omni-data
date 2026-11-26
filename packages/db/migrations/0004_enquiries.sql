-- Enquiries: what the public contact form on god.gaiada.com sends (apps/dashboard/src/server/enquiries/ and
-- store/types.ts, EnquiryStore). Runs as god_migrator inside the runner's transaction. Forward-only.
--
-- 1. enquiries: the visitor's words, stored FIRST. Email to hello@god.gaiada.com is only a best-effort notification, so
--    a failed or deferred email loses nothing. The only unauthenticated write the dashboard has, so the database holds
--    its own limits: length and shape checks on every field, and no way for the runtime role to choose the time, the id
--    or the status of a new row.
-- 2. audit_log: the action CHECK is widened for enquiry.update (an Owner marking an enquiry read or archived).
--
-- RETENTION: TODO for the founder to decide. An enquiry holds a name, a company and an email address, and nothing here
-- deletes one. Suggested: delete (or anonymise) enquiries 24 months after received_at, by a scheduled job run as
-- god_migrator (god_app has no DELETE and must not get it), and say so in the site's privacy statement.

CREATE TABLE god_app.enquiries (
  id           text PRIMARY KEY DEFAULT 'enq_' || replace(gen_random_uuid()::text, '-', ''),
  -- Set by the database, in the order rows arrive. god_app has no INSERT on it.
  received_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Single-line fields: no control characters at all (no CR, LF or tab), so none can ever reach a mail header.
  name         text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 100 AND name !~ '[[:cntrl:]]'),
  company      text NOT NULL CHECK (btrim(company) <> '' AND char_length(company) <= 120 AND company !~ '[[:cntrl:]]'),
  -- The same shape the site checks (something@something.something, no spaces), and none of the characters that make a
  -- header carry a second address or a display name: < > ( ) , ; : " [ ] and the backslash.
  email        text NOT NULL CHECK (
                 char_length(email) <= 254
                 AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
                 AND email !~ '[[:cntrl:]]'
                 AND translate(email, E'<>(),;:"[]\\', '') = email
               ),
  -- The message. Line breaks are allowed here.
  want         text NOT NULL CHECK (btrim(want) <> '' AND char_length(want) <= 4000),
  budget       text NOT NULL DEFAULT '' CHECK (char_length(budget) <= 60 AND budget !~ '[[:cntrl:]]'),
  -- A coarse network prefix only ("203.0.113.x", "2001:db8:1::/48"), never the full address.
  ip_prefix    text CHECK (char_length(ip_prefix) <= 64),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  handled_by   text CHECK (btrim(handled_by) <> '' AND char_length(handled_by) <= 200),
  handled_at   timestamptz,
  -- A new enquiry has not been handled; a read or archived one says who and when.
  CONSTRAINT enquiries_handled_matches_status CHECK (
    (status = 'new' AND handled_by IS NULL AND handled_at IS NULL)
    OR (status <> 'new' AND handled_by IS NOT NULL AND handled_at IS NOT NULL)
  )
);

CREATE INDEX enquiries_received_idx ON god_app.enquiries (received_at DESC, id DESC);
CREATE INDEX enquiries_new_idx ON god_app.enquiries (received_at DESC) WHERE status = 'new';

-- What the visitor sent never changes. god_app cannot update those columns (no privilege), and this refuses it for
-- every other role too, including the owner.
CREATE FUNCTION god_app.enquiries_content_is_final() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.company IS DISTINCT FROM OLD.company
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.want IS DISTINCT FROM OLD.want
     OR NEW.budget IS DISTINCT FROM OLD.budget
     OR NEW.ip_prefix IS DISTINCT FROM OLD.ip_prefix THEN
    RAISE EXCEPTION 'an enquiry is final once received; only its status changes' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION god_app.enquiries_content_is_final() FROM PUBLIC;
CREATE TRIGGER enquiries_content_is_final BEFORE UPDATE ON god_app.enquiries
  FOR EACH ROW EXECUTE FUNCTION god_app.enquiries_content_is_final();

-- The audit actions. 0003 replaced the column CHECK (audit_log_action_check); it is replaced again, not edited.
ALTER TABLE god_app.audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE god_app.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
  'person.open', 'export.pdf', 'allowlist.invite', 'allowlist.change', 'session.revoke',
  'signin.refused', 'signin.ok', 'signin.fresh', 'signout',
  'breakglass.code', 'breakglass.enrol', 'breakglass.revoke', 'breakglass.signin', 'breakglass.refused',
  'enquiry.update'
));

-- Runtime role: no DELETE. INSERT only of what the visitor sent plus the coarse prefix: the id, the time, the status and
-- the handling columns are not the app's to choose at insert (a new enquiry is always new, and received now).
-- UPDATE only of the three columns an Owner changes by marking it read or archived.
GRANT SELECT ON god_app.enquiries TO god_app;
GRANT INSERT (name, company, email, want, budget, ip_prefix) ON god_app.enquiries TO god_app;
GRANT UPDATE (status, handled_by, handled_at) ON god_app.enquiries TO god_app;
