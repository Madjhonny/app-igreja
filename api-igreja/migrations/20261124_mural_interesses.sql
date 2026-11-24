SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

CREATE TABLE IF NOT EXISTS mural_interesses (
    usuario_id INTEGER NOT NULL
        REFERENCES usuarios(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL
        REFERENCES mural_eventos(id) ON DELETE CASCADE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, post_id)
);

CREATE INDEX IF NOT EXISTS mural_interesses_post_idx
    ON mural_interesses (post_id);