-- Fotos de perfil são recursos autenticados, separados das imagens públicas do mural.
CREATE TABLE IF NOT EXISTS profile_cloudinary_assets (
    public_id TEXT PRIMARY KEY CHECK (public_id ~ '^agenda-adp-profile-[0-9a-f]{32}$'),
    user_id INTEGER UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS profile_cloudinary_assets_pending_idx
    ON profile_cloudinary_assets (created_at, public_id) WHERE user_id IS NULL;
