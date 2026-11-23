-- Jain Farms call-report accounts and sessions.
-- Apply once through the n8n PostgreSQL credential used by the call-report API.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.jfr_report_users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'user')),
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.jfr_report_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS jfr_report_users_email_lower_uidx
  ON public.jfr_report_users (lower(email));

CREATE INDEX IF NOT EXISTS jfr_report_users_role_active_idx
  ON public.jfr_report_users (role, is_active);

CREATE TABLE IF NOT EXISTS public.jfr_report_sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.jfr_report_users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS jfr_report_sessions_user_expiry_idx
  ON public.jfr_report_sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS public.jfr_report_login_attempts (
  email_normalized text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

CREATE OR REPLACE FUNCTION public.jfr_report_new_session(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_token text := encode(gen_random_bytes(32), 'hex');
BEGIN
  DELETE FROM public.jfr_report_sessions
  WHERE user_id = p_user_id OR expires_at <= now();

  INSERT INTO public.jfr_report_sessions (token_hash, user_id, expires_at)
  VALUES (digest(v_token, 'sha256'), p_user_id, now() + interval '8 hours');

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.jfr_report_session_user(p_token text)
RETURNS TABLE (user_id uuid, full_name text, email text, role text)
LANGUAGE sql
AS $$
  UPDATE public.jfr_report_sessions AS s
     SET last_seen_at = now()
    FROM public.jfr_report_users AS u
   WHERE s.user_id = u.user_id
     AND u.is_active
     AND s.expires_at > now()
     AND s.token_hash = digest(COALESCE(p_token, ''), 'sha256')
  RETURNING u.user_id, u.full_name, u.email, u.role;
$$;

CREATE OR REPLACE FUNCTION public.jfr_report_auth_api(
  p_action text,
  p_payload jsonb,
  p_session_token text,
  p_bootstrap_verified boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_action text := lower(COALESCE(p_action, ''));
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_name text := btrim(COALESCE(p_payload->>'fullName', p_payload->>'name', ''));
  v_password text := COALESCE(p_payload->>'password', '');
  v_role text := lower(COALESCE(p_payload->>'role', 'user'));
  v_actor record;
  v_target public.jfr_report_users%ROWTYPE;
  v_user public.jfr_report_users%ROWTYPE;
  v_token text;
  v_attempt public.jfr_report_login_attempts%ROWTYPE;
  v_lock timestamptz;
  v_target_id uuid;
  v_active boolean;
  v_super_count integer;
  v_user_json jsonb;
BEGIN
  IF v_action = 'bootstrap_status' THEN
    RETURN jsonb_build_object(
      'statusCode', 200,
      'body', jsonb_build_object('needsBootstrap', NOT EXISTS (SELECT 1 FROM public.jfr_report_users))
    );
  END IF;

  IF v_action = 'bootstrap' THEN
    IF NOT COALESCE(p_bootstrap_verified, false) THEN
      RETURN jsonb_build_object('statusCode', 403, 'body', jsonb_build_object('error', 'Initial setup is not authorized.'));
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('jfr-report-bootstrap'));
    IF EXISTS (SELECT 1 FROM public.jfr_report_users) THEN
      RETURN jsonb_build_object('statusCode', 409, 'body', jsonb_build_object('error', 'Initial setup is already complete. Sign in instead.'));
    END IF;
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR length(v_name) NOT BETWEEN 1 AND 120
       OR length(v_password) NOT BETWEEN 12 AND 72 THEN
      RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'Enter a valid name and email. Password must be 12–72 characters.'));
    END IF;

    INSERT INTO public.jfr_report_users (full_name, email, role, password_hash)
    VALUES (v_name, v_email, 'super_admin', crypt(v_password, gen_salt('bf', 12)))
    RETURNING * INTO v_user;
    v_token := public.jfr_report_new_session(v_user.user_id);
    RETURN jsonb_build_object('statusCode', 201, 'body', jsonb_build_object(
      'token', v_token,
      'user', jsonb_build_object('id', v_user.user_id, 'name', v_user.full_name, 'email', v_user.email, 'role', v_user.role)
    ));
  END IF;

  IF v_action = 'login' THEN
    SELECT * INTO v_attempt
      FROM public.jfr_report_login_attempts
     WHERE email_normalized = v_email;
    IF FOUND AND v_attempt.locked_until > now() THEN
      RETURN jsonb_build_object('statusCode', 429, 'body', jsonb_build_object('error', 'Too many failed sign-in attempts. Try again in 15 minutes.'));
    END IF;

    SELECT * INTO v_user
      FROM public.jfr_report_users
     WHERE lower(email) = v_email;
    IF NOT FOUND OR NOT v_user.is_active OR v_password = ''
       OR crypt(v_password, COALESCE(v_user.password_hash, crypt('invalid', gen_salt('bf', 4)))) <> v_user.password_hash THEN
      INSERT INTO public.jfr_report_login_attempts (email_normalized, failed_count, window_started_at, locked_until)
      VALUES (v_email, 1, now(), NULL)
      ON CONFLICT (email_normalized) DO UPDATE SET
        failed_count = CASE
          WHEN public.jfr_report_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
          ELSE public.jfr_report_login_attempts.failed_count + 1
        END,
        window_started_at = CASE
          WHEN public.jfr_report_login_attempts.window_started_at < now() - interval '15 minutes' THEN now()
          ELSE public.jfr_report_login_attempts.window_started_at
        END,
        locked_until = CASE
          WHEN (CASE
            WHEN public.jfr_report_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
            ELSE public.jfr_report_login_attempts.failed_count + 1
          END) >= 5 THEN now() + interval '15 minutes'
          ELSE NULL
        END
      RETURNING locked_until INTO v_lock;
      IF v_lock IS NOT NULL THEN
        RETURN jsonb_build_object('statusCode', 429, 'body', jsonb_build_object('error', 'Too many failed sign-in attempts. Try again in 15 minutes.'));
      END IF;
      RETURN jsonb_build_object('statusCode', 401, 'body', jsonb_build_object('error', 'Email or password is incorrect.'));
    END IF;

    DELETE FROM public.jfr_report_login_attempts WHERE email_normalized = v_email;
    UPDATE public.jfr_report_users SET last_login_at = now(), updated_at = now() WHERE user_id = v_user.user_id;
    v_token := public.jfr_report_new_session(v_user.user_id);
    RETURN jsonb_build_object('statusCode', 200, 'body', jsonb_build_object(
      'token', v_token,
      'user', jsonb_build_object('id', v_user.user_id, 'name', v_user.full_name, 'email', v_user.email, 'role', v_user.role)
    ));
  END IF;

  SELECT * INTO v_actor FROM public.jfr_report_session_user(p_session_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('statusCode', 401, 'body', jsonb_build_object('error', 'Your session expired. Sign in again.'));
  END IF;

  IF v_action = 'me' THEN
    RETURN jsonb_build_object('statusCode', 200, 'body', jsonb_build_object(
      'user', jsonb_build_object('id', v_actor.user_id, 'name', v_actor.full_name, 'email', v_actor.email, 'role', v_actor.role)
    ));
  ELSIF v_action = 'logout' THEN
    DELETE FROM public.jfr_report_sessions WHERE token_hash = digest(COALESCE(p_session_token, ''), 'sha256');
    RETURN jsonb_build_object('statusCode', 200, 'body', jsonb_build_object('ok', true));
  ELSIF v_action = 'list_users' THEN
    IF v_actor.role NOT IN ('super_admin', 'admin') THEN
      RETURN jsonb_build_object('statusCode', 403, 'body', jsonb_build_object('error', 'User management access is required.'));
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', user_id, 'name', full_name, 'email', email, 'role', role,
      'active', is_active, 'createdAt', created_at, 'lastLoginAt', last_login_at
    ) ORDER BY created_at DESC), '[]'::jsonb)
      INTO v_user_json
      FROM public.jfr_report_users;
    RETURN jsonb_build_object('statusCode', 200, 'body', jsonb_build_object('users', v_user_json));
  ELSIF v_action = 'create_user' THEN
    IF v_actor.role NOT IN ('super_admin', 'admin') THEN
      RETURN jsonb_build_object('statusCode', 403, 'body', jsonb_build_object('error', 'User management access is required.'));
    END IF;
    IF v_actor.role = 'admin' AND v_role = 'super_admin' THEN
      RETURN jsonb_build_object('statusCode', 403, 'body', jsonb_build_object('error', 'Only a super admin can create a super admin.'));
    END IF;
    IF v_role NOT IN ('super_admin', 'admin', 'user')
       OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR length(v_name) NOT BETWEEN 1 AND 120
       OR length(v_password) NOT BETWEEN 12 AND 72 THEN
      RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'Check the name, email, role, and password. Password must be 12–72 characters.'));
    END IF;
    INSERT INTO public.jfr_report_users (full_name, email, role, password_hash, created_by)
    VALUES (v_name, v_email, v_role, crypt(v_password, gen_salt('bf', 12)), v_actor.user_id)
    RETURNING user_id, full_name, email, role, is_active, created_at, last_login_at INTO v_user;
    RETURN jsonb_build_object('statusCode', 201, 'body', jsonb_build_object('user', jsonb_build_object(
      'id', v_user.user_id, 'name', v_user.full_name, 'email', v_user.email, 'role', v_user.role,
      'active', v_user.is_active, 'createdAt', v_user.created_at, 'lastLoginAt', v_user.last_login_at
    )));
  ELSIF v_action IN ('update_user', 'reset_password') THEN
    IF v_actor.role NOT IN ('super_admin', 'admin') THEN
      RETURN jsonb_build_object('statusCode', 403, 'body', jsonb_build_object('error', 'User management access is required.'));
    END IF;
    BEGIN
      v_target_id := NULLIF(p_payload->>'id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_target_id := NULL;
    END;
    IF v_target_id IS NULL THEN
      RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'Choose a valid user.'));
    END IF;
    SELECT * INTO v_target FROM public.jfr_report_users WHERE user_id = v_target_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('statusCode', 404, 'body', jsonb_build_object('error', 'User not found.'));
    END IF;
    IF v_actor.role = 'admin' AND v_target.role = 'super_admin' THEN
      RETURN jsonb_build_object('statusCode', 403, 'body', jsonb_build_object('error', 'Admins cannot change a super admin.'));
    END IF;

    IF v_action = 'reset_password' THEN
      IF length(v_password) NOT BETWEEN 12 AND 72 THEN
        RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'Password must be 12–72 characters.'));
      END IF;
      UPDATE public.jfr_report_users
         SET password_hash = crypt(v_password, gen_salt('bf', 12)), updated_at = now()
       WHERE user_id = v_target_id;
      DELETE FROM public.jfr_report_sessions WHERE user_id = v_target_id;
      RETURN jsonb_build_object('statusCode', 200, 'body', jsonb_build_object('ok', true, 'message', 'Password changed. The user must sign in again.'));
    END IF;

    v_email := lower(btrim(COALESCE(p_payload->>'email', v_target.email)));
    v_name := btrim(COALESCE(p_payload->>'fullName', p_payload->>'name', v_target.full_name));
    v_role := lower(COALESCE(p_payload->>'role', v_target.role));
    v_active := COALESCE((p_payload->>'active')::boolean, v_target.is_active);
    IF v_actor.role = 'admin' AND v_role = 'super_admin' THEN
      RETURN jsonb_build_object('statusCode', 403, 'body', jsonb_build_object('error', 'Admins cannot assign the super admin role.'));
    END IF;
    IF v_role NOT IN ('super_admin', 'admin', 'user')
       OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR length(v_name) NOT BETWEEN 1 AND 120 THEN
      RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'Check the name, email, and role.'));
    END IF;
    IF v_target_id = v_actor.user_id AND (NOT v_active OR v_role <> v_actor.role) THEN
      RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'You cannot deactivate or change your own role.'));
    END IF;
    IF v_target.role = 'super_admin' AND (v_role <> 'super_admin' OR NOT v_active) THEN
      SELECT count(*) INTO v_super_count FROM public.jfr_report_users WHERE role = 'super_admin' AND is_active;
      IF v_super_count <= 1 THEN
        RETURN jsonb_build_object('statusCode', 409, 'body', jsonb_build_object('error', 'Keep at least one active super admin.'));
      END IF;
    END IF;
    UPDATE public.jfr_report_users
       SET full_name = v_name, email = v_email, role = v_role, is_active = v_active, updated_at = now()
     WHERE user_id = v_target_id
    RETURNING user_id, full_name, email, role, is_active, created_at, last_login_at INTO v_user;
    IF NOT v_active THEN
      DELETE FROM public.jfr_report_sessions WHERE user_id = v_target_id;
    END IF;
    RETURN jsonb_build_object('statusCode', 200, 'body', jsonb_build_object('user', jsonb_build_object(
      'id', v_user.user_id, 'name', v_user.full_name, 'email', v_user.email, 'role', v_user.role,
      'active', v_user.is_active, 'createdAt', v_user.created_at, 'lastLoginAt', v_user.last_login_at
    )));
  END IF;

  RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'Unsupported account action.'));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('statusCode', 409, 'body', jsonb_build_object('error', 'An account with this email already exists.'));
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('statusCode', 400, 'body', jsonb_build_object('error', 'Invalid account details.'));
END;
$$;

SELECT true AS ok;
