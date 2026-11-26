-- GOD dashboard: database, roles and grants. Run ONCE by a Postgres superuser, and again whenever you like:
-- every statement is idempotent. No password is in this file; set them by hand afterwards:
--
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f setup-roles.sql
--   sudo -u postgres psql -c '\password god_migrator'
--   sudo -u postgres psql -c '\password god_app'
--
-- Topology (see packages/db/README.md):
--   god_migrator  owns the database and the schema god_app. Used only by the migration runner, never by the app.
--   god_app       the dashboard's runtime role. LOGIN, no DDL, no superuser, no access outside schema god_app.
--                 Table grants are made by the migrations themselves, one table at a time.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'god_migrator') THEN
    CREATE ROLE god_migrator LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'god_app') THEN
    CREATE ROLE god_app LOGIN;
  END IF;
END
$$;

-- Re-assert the attributes every time, so a role that already existed ends up the same.
ALTER ROLE god_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5;
ALTER ROLE god_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20;

-- CREATE DATABASE cannot run inside a DO block, so psql runs the generated statement (\gexec).
-- Template0 with the C.UTF-8 locale: the same on every box, and it never depends on template1.
SELECT 'CREATE DATABASE god_dashboard OWNER god_migrator ENCODING ''UTF8'' TEMPLATE template0 LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8'''
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'god_dashboard')
\gexec

ALTER DATABASE god_dashboard OWNER TO god_migrator;
-- PUBLIC may no longer connect or make temp tables here. Only the two roles may connect.
REVOKE ALL ON DATABASE god_dashboard FROM PUBLIC;
GRANT CONNECT ON DATABASE god_dashboard TO god_migrator, god_app;

\connect god_dashboard

-- Nothing for anyone in the default schema.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM god_app;

CREATE SCHEMA IF NOT EXISTS god_app AUTHORIZATION god_migrator;
ALTER SCHEMA god_app OWNER TO god_migrator;
REVOKE ALL ON SCHEMA god_app FROM PUBLIC;
-- USAGE only: god_app can name objects in the schema, but cannot create any. Table privileges come from migrations.
GRANT USAGE ON SCHEMA god_app TO god_app;
REVOKE CREATE ON SCHEMA god_app FROM god_app;

ALTER ROLE god_migrator IN DATABASE god_dashboard SET search_path = god_app;
ALTER ROLE god_app      IN DATABASE god_dashboard SET search_path = god_app;
