-- First-boot database setup for the compose stack.
--
-- Do NOT mount this file into /docker-entrypoint-initdb.d: the postgres image
-- would run it as plain SQL without the psql variables below. It is run by
-- deploy/postgres/init.sh, which passes the passwords from the environment:
--
--   psql -v ON_ERROR_STOP=1 -v medusa_pw=... -v seller_hub_pw=... -f init.sql
--
-- Safe on a fresh database only. The postgres image runs init scripts once,
-- when the data directory is empty; running this against a database that
-- already has these roles fails on CREATE ROLE and changes nothing further
-- (ON_ERROR_STOP).

BEGIN;

CREATE ROLE medusa LOGIN PASSWORD :'medusa_pw';
CREATE ROLE seller_hub LOGIN PASSWORD :'seller_hub_pw';

-- Medusa owns the public schema of this database.
ALTER SCHEMA public OWNER TO medusa;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- seller-hub owns its own schema and sees nothing else.
CREATE SCHEMA seller_hub AUTHORIZATION seller_hub;
ALTER ROLE seller_hub SET search_path = seller_hub;

-- Only the two service roles may connect to this database.
REVOKE CONNECT ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO medusa, seller_hub;

COMMIT;
