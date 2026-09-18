-- Pulsewatch initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  password_hash     text NOT NULL,
  name              text NOT NULL DEFAULT '',
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE organizations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days IN (7,30,90,365)),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip         inet,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE user_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('password_reset','email_verify')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,
  token_hash   text NOT NULL,
  role         text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys (org_id);

CREATE TABLE monitors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  type                  text NOT NULL CHECK (type IN ('http','api','tcp','dns','ping')),
  enabled               boolean NOT NULL DEFAULT true,
  interval_seconds      integer NOT NULL DEFAULT 60 CHECK (interval_seconds >= 30),
  timeout_ms            integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 60000),
  failure_threshold     integer NOT NULL DEFAULT 3 CHECK (failure_threshold >= 1),
  recovery_threshold    integer NOT NULL DEFAULT 2 CHECK (recovery_threshold >= 1),
  degraded_latency_ms   integer,
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','up','degraded','down','paused')),
  consecutive_failures  integer NOT NULL DEFAULT 0,
  consecutive_successes integer NOT NULL DEFAULT 0,
  last_check_at         timestamptz,
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  last_status_change_at timestamptz,
  next_run_at           timestamptz NOT NULL DEFAULT now(),
  last_latency_ms       integer,
  last_error            text,
  last_resolved_ip      inet,
  ssl_expires_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX monitors_org_idx ON monitors (org_id);
CREATE INDEX monitors_due_idx ON monitors (next_run_at) WHERE enabled;

-- Raw check results, range-partitioned by month.
CREATE TABLE monitor_checks (
  id          bigserial,
  monitor_id  uuid NOT NULL,
  org_id      uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ok          boolean NOT NULL,
  degraded    boolean NOT NULL DEFAULT false,
  status_code integer,
  latency_ms  integer,
  timings     jsonb,
  resolved_ip inet,
  error       text,
  meta        jsonb,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX monitor_checks_monitor_time_idx ON monitor_checks (monitor_id, created_at DESC);

CREATE TABLE monitor_check_rollups (
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  period     text NOT NULL CHECK (period IN ('hour','day')),
  bucket     timestamptz NOT NULL,
  checks     integer NOT NULL,
  failures   integer NOT NULL,
  avg_ms     numeric(10,2),
  p50_ms     numeric(10,2),
  p95_ms     numeric(10,2),
  p99_ms     numeric(10,2),
  min_ms     integer,
  max_ms     integer,
  PRIMARY KEY (monitor_id, period, bucket)
);
CREATE INDEX rollups_bucket_idx ON monitor_check_rollups (period, bucket DESC);

CREATE TABLE monitor_ip_history (
  id         bigserial PRIMARY KEY,
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  ip         inet NOT NULL,
  family     integer NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX monitor_ip_history_key ON monitor_ip_history (monitor_id, ip);

CREATE TABLE incidents (
  id                      bigserial PRIMARY KEY,
  org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  monitor_id              uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status                  text NOT NULL CHECK (status IN ('open','acknowledged','resolved')),
  severity                text NOT NULL DEFAULT 'down' CHECK (severity IN ('down','degraded')),
  started_at              timestamptz NOT NULL DEFAULT now(),
  resolved_at             timestamptz,
  duration_seconds        integer,
  detected_after_failures integer NOT NULL DEFAULT 0,
  cause                   text,
  last_success_latency_ms integer,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_monitor_idx ON incidents (monitor_id, started_at DESC);
CREATE INDEX incidents_org_idx ON incidents (org_id, started_at DESC);
CREATE UNIQUE INDEX incidents_one_open ON incidents (monitor_id) WHERE status <> 'resolved';

CREATE TABLE incident_events (
  id          bigserial PRIMARY KEY,
  incident_id bigint NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,
  message     text NOT NULL,
  data        jsonb
);
CREATE INDEX incident_events_incident_idx ON incident_events (incident_id, at);

CREATE TABLE notification_channels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('email','discord','slack','webhook')),
  name       text NOT NULL,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  event_types      text[] NOT NULL,
  channel_id       uuid NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  monitor_ids      uuid[],
  agent_ids        uuid[],
  thresholds       jsonb NOT NULL DEFAULT '{}'::jsonb,
  cooldown_seconds integer NOT NULL DEFAULT 900,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_deliveries (
  id         bigserial PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id    uuid REFERENCES alert_rules(id) ON DELETE SET NULL,
  channel_id uuid REFERENCES notification_channels(id) ON DELETE SET NULL,
  subject_id text,
  event_type text NOT NULL,
  status     text NOT NULL CHECK (status IN ('sent','failed','suppressed')),
  error      text,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_deliveries_cooldown_idx
  ON alert_deliveries (rule_id, subject_id, event_type, created_at DESC);

CREATE TABLE maintenance_windows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  monitor_ids     uuid[],
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  suppress_checks boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_active_idx ON maintenance_windows (org_id, starts_at, ends_at);

CREATE TABLE status_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  branding    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE status_page_monitors (
  status_page_id uuid NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  monitor_id     uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  display_name   text,
  group_name     text NOT NULL DEFAULT 'Services',
  sort_order     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (status_page_id, monitor_id)
);

CREATE TABLE server_agents (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  hostname                  text,
  token_prefix              text NOT NULL UNIQUE,
  token_hash                text NOT NULL,
  status                    text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','online','offline')),
  heartbeat_timeout_seconds integer NOT NULL DEFAULT 120,
  last_seen_at              timestamptz,
  os                        jsonb,
  ipv4                      text[] NOT NULL DEFAULT '{}',
  ipv6                      text[] NOT NULL DEFAULT '{}',
  thresholds                jsonb NOT NULL DEFAULT '{"cpu":90,"memory":90,"disk":90}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX server_agents_org_idx ON server_agents (org_id);

CREATE TABLE server_metrics (
  id             bigserial,
  agent_id       uuid NOT NULL,
  org_id         uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  cpu            numeric(5,2),
  memory         numeric(5,2),
  disk           numeric(5,2),
  load1          numeric(8,2),
  load5          numeric(8,2),
  load15         numeric(8,2),
  uptime_seconds bigint,
  net_rx_bytes   bigint,
  net_tx_bytes   bigint,
  processes      jsonb,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX server_metrics_agent_time_idx ON server_metrics (agent_id, created_at DESC);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  org_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user','api_key','system','agent')),
  actor_id   text,
  action     text NOT NULL,
  target     text,
  data       jsonb,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs (org_id, created_at DESC);

-- Creates the monthly partition covering `at` when it does not exist yet.
CREATE OR REPLACE FUNCTION ensure_month_partition(parent text, at timestamptz)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  start_ts date := date_trunc('month', at AT TIME ZONE 'UTC')::date;
  end_ts   date := (date_trunc('month', at AT TIME ZONE 'UTC') + interval '1 month')::date;
  part     text := format('%s_%s', parent, to_char(start_ts, 'YYYYMM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   part, parent, start_ts, end_ts);
  END IF;
END $fn$;

SELECT ensure_month_partition('monitor_checks', now());
SELECT ensure_month_partition('monitor_checks', now() + interval '1 month');
SELECT ensure_month_partition('server_metrics', now());
SELECT ensure_month_partition('server_metrics', now() + interval '1 month');
