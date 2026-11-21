CREATE TABLE IF NOT EXISTS push_devices (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_version INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL UNIQUE,
  revoke_hash CHAR(64) NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);
CREATE INDEX IF NOT EXISTS push_devices_usuario_idx ON push_devices(usuario_id);

CREATE TABLE IF NOT EXISTS push_jobs (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  revoke_hash CHAR(64) NOT NULL,
  congregacao_id INTEGER NOT NULL REFERENCES congregacoes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sending', 'receipt')),
  ticket_id TEXT
);
CREATE INDEX IF NOT EXISTS push_jobs_due_idx ON push_jobs(state, due_at);
