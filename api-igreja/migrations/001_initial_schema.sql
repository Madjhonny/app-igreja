CREATE TABLE IF NOT EXISTS congregacoes (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome_completo VARCHAR(120) NOT NULL,
  nome_exibicao VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  senha_hash TEXT NOT NULL,
  congregacao_id INTEGER REFERENCES congregacoes(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  cpf VARCHAR(11) NOT NULL,
  telefone VARCHAR(15),
  foto_perfil TEXT,
  bio VARCHAR(500),
  nivel_acesso VARCHAR(10) NOT NULL DEFAULT 'MEMBRO'
    CHECK (nivel_acesso IN ('MASTER', 'ADMIN', 'MEMBRO')),
  status_conta VARCHAR(12) NOT NULL DEFAULT 'PENDENTE'
    CHECK (status_conta IN ('APROVADO', 'PENDENTE', 'RECUSADO', 'BLOQUEADO')),
  data_cadastro TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_lower_uidx ON usuarios (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_cpf_uidx ON usuarios (cpf);
CREATE INDEX IF NOT EXISTS usuarios_congregacao_status_idx
  ON usuarios (congregacao_id, status_conta, data_cadastro DESC);

CREATE TABLE IF NOT EXISTS eventos (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(120) NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  horario TIME NOT NULL,
  duracao_minutos INTEGER NOT NULL DEFAULT 60
    CHECK (duracao_minutos BETWEEN 15 AND 1440),
  congregacao_id INTEGER NOT NULL REFERENCES congregacoes(id) ON DELETE RESTRICT,
  criado_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  legenda TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT eventos_periodo_check CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS eventos_periodo_idx
  ON eventos (congregacao_id, data_inicio, data_fim, horario);

CREATE TABLE IF NOT EXISTS mural_eventos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  congregacao_id INTEGER REFERENCES congregacoes(id) ON DELETE SET NULL,
  titulo VARCHAR(120) NOT NULL,
  descricao VARCHAR(2000),
  local VARCHAR(180),
  tipo_midia VARCHAR(10) CHECK (tipo_midia IN ('imagem', 'video')),
  midia TEXT,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mural_eventos_periodo_check CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS mural_eventos_periodo_idx
  ON mural_eventos (data_fim, data_inicio, criado_em DESC);
CREATE INDEX IF NOT EXISTS mural_eventos_congregacao_idx ON mural_eventos (congregacao_id);

CREATE TABLE IF NOT EXISTS mural_curtidas (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES mural_eventos(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, post_id)
);

-- Curtidas duplicadas são semanticamente equivalentes; preserve apenas uma antes
-- de criar a restrição necessária ao toggle atômico da API em bancos existentes.
DELETE FROM mural_curtidas atual
USING mural_curtidas duplicada
WHERE atual.ctid < duplicada.ctid
  AND atual.usuario_id = duplicada.usuario_id
  AND atual.post_id = duplicada.post_id;
CREATE UNIQUE INDEX IF NOT EXISTS mural_curtidas_usuario_post_uidx
  ON mural_curtidas (usuario_id, post_id);
CREATE INDEX IF NOT EXISTS mural_curtidas_post_idx ON mural_curtidas (post_id);

CREATE TABLE IF NOT EXISTS mural_comentarios (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES mural_eventos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  parent_id INTEGER,
  texto VARCHAR(2000) NOT NULL CHECK (LENGTH(TRIM(texto)) > 0),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mural_comentarios_id_post_unique UNIQUE (id, post_id),
  CONSTRAINT mural_comentarios_parent_same_post_fk
    FOREIGN KEY (parent_id, post_id)
    REFERENCES mural_comentarios (id, post_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mural_comentarios_post_idx
  ON mural_comentarios (post_id, criado_em);
CREATE INDEX IF NOT EXISTS mural_comentarios_parent_idx ON mural_comentarios (parent_id);

CREATE TABLE IF NOT EXISTS mural_comentario_curtidas (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  comentario_id INTEGER NOT NULL REFERENCES mural_comentarios(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, comentario_id)
);

DELETE FROM mural_comentario_curtidas atual
USING mural_comentario_curtidas duplicada
WHERE atual.ctid < duplicada.ctid
  AND atual.usuario_id = duplicada.usuario_id
  AND atual.comentario_id = duplicada.comentario_id;
CREATE UNIQUE INDEX IF NOT EXISTS mural_comentario_curtidas_usuario_comentario_uidx
  ON mural_comentario_curtidas (usuario_id, comentario_id);
CREATE INDEX IF NOT EXISTS mural_comentario_curtidas_comentario_idx
  ON mural_comentario_curtidas (comentario_id);

CREATE TABLE IF NOT EXISTS gestao_datas_rascunho (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo VARCHAR(120) NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  horario TIME NOT NULL,
  duracao_minutos INTEGER NOT NULL DEFAULT 60
    CHECK (duracao_minutos BETWEEN 15 AND 1440),
  congregacao_id INTEGER NOT NULL REFERENCES congregacoes(id) ON DELETE RESTRICT,
  legenda TEXT,
  marcador VARCHAR(10) NOT NULL DEFAULT 'NORMAL'
    CHECK (marcador IN ('NORMAL', 'REVISAR', 'CONFLITO')),
  publicado BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT gestao_datas_periodo_check CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS gestao_datas_master_pendente_idx
  ON gestao_datas_rascunho (master_id, data_inicio, horario)
  WHERE publicado = FALSE;
CREATE INDEX IF NOT EXISTS gestao_datas_congregacao_pendente_idx
  ON gestao_datas_rascunho (congregacao_id, data_inicio, data_fim)
  WHERE publicado = FALSE;

-- Compatibilidade com a versão anterior do projeto, que criava essas colunas no startup.
ALTER TABLE eventos
  ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER NOT NULL DEFAULT 60;
ALTER TABLE gestao_datas_rascunho
  ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER NOT NULL DEFAULT 60;
