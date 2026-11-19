-- Existing email accounts remain valid; new accounts need only a username.
ALTER TABLE users ADD COLUMN username text;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_login_identifier CHECK (email IS NOT NULL OR username IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_.-]{2,31}$');
CREATE UNIQUE INDEX users_username_unique ON users(username) WHERE username IS NOT NULL;
