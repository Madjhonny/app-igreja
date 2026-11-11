-- Recuperação de senha com uso único, tentativas limitadas e revogação de sessões.
-- A API precisa dessa migração aplicada ANTES de publicar a nova versão.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS senha_recuperacoes (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash CHAR(64) NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0)
);

CREATE INDEX IF NOT EXISTS senha_recuperacoes_expira_idx ON senha_recuperacoes (expira_em);
