-- Rastreia somente imagens criadas pelo backend; links legados nunca são excluídos aqui.
-- O vínculo NULL também permite reconciliar uploads incompletos e exclusões de posts.
CREATE TABLE IF NOT EXISTS mural_cloudinary_assets (
    public_id TEXT PRIMARY KEY CHECK (public_id ~ '^agenda-adp-mural-[0-9a-f]{32}$'),
    post_id INTEGER UNIQUE REFERENCES mural_eventos(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mural_cloudinary_assets_pending_idx
    ON mural_cloudinary_assets (created_at, public_id) WHERE post_id IS NULL;
