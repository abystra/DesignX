-- Run as the PostgreSQL administrator against the existing designx database.
-- The application's migration command creates tables and records migration state.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'designx' THEN
    RAISE EXCEPTION 'Run this bootstrap against the designx database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'designx_tenant') THEN
    CREATE ROLE designx_tenant NOLOGIN;
  END IF;
END
$$;
GRANT designx_tenant TO workx WITH ADMIN OPTION;
COMMIT;
