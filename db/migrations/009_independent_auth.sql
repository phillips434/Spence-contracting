-- Additive authentication storage. Existing users and company data remain intact.
CREATE TABLE IF NOT EXISTS auth_accounts (
 uid text PRIMARY KEY,
 email text NOT NULL,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_email ON auth_accounts(lower(email));
CREATE TABLE IF NOT EXISTS auth_sessions (
 token_hash text PRIMARY KEY,
 uid text NOT NULL REFERENCES auth_accounts(uid) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_email_tokens (
 token_hash text PRIMARY KEY,
 email text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('signup','reset')),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
 key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now()
);
