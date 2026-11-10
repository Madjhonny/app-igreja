-- Reconcile the schema created by early versions of the API with the
-- constraints expected by the current application. The migration runner wraps
-- this file in a transaction, so any invalid legacy row leaves production
-- untouched instead of being silently discarded.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

UPDATE usuarios
SET nome_exibicao = nome_completo
WHERE nome_exibicao IS NULL OR BTRIM(nome_exibicao) = '';

UPDATE usuarios
SET email = LOWER(BTRIM(email));

UPDATE usuarios
SET cpf = REGEXP_REPLACE(cpf, '\D', '', 'g')
WHERE cpf IS NOT NULL;

UPDATE eventos
SET data_fim = data_inicio
WHERE data_fim IS NULL;

UPDATE gestao_datas_rascunho
SET marcador = 'NORMAL'
WHERE marcador IS NULL;

UPDATE gestao_datas_rascunho
SET publicado = FALSE
WHERE publicado IS NULL;

ALTER TABLE usuarios
  ALTER COLUMN nome_exibicao SET NOT NULL,
  ALTER COLUMN cpf SET NOT NULL,
  ALTER COLUMN nivel_acesso SET NOT NULL,
  ALTER COLUMN status_conta SET NOT NULL;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_nivel_acesso_check,
  ADD CONSTRAINT usuarios_nivel_acesso_check
    CHECK (nivel_acesso IN ('MASTER', 'ADMIN', 'MEMBRO'));

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_status_conta_check,
  ADD CONSTRAINT usuarios_status_conta_check
    CHECK (status_conta IN ('APROVADO', 'PENDENTE', 'RECUSADO', 'BLOQUEADO'));

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_cpf_format_check,
  ADD CONSTRAINT usuarios_cpf_format_check CHECK (cpf ~ '^[0-9]{11}$');

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_email_normalized_check,
  ADD CONSTRAINT usuarios_email_normalized_check CHECK (email = LOWER(BTRIM(email)));

ALTER TABLE eventos
  ALTER COLUMN data_fim SET NOT NULL,
  ALTER COLUMN congregacao_id SET NOT NULL,
  ALTER COLUMN criado_por_usuario_id SET NOT NULL;

ALTER TABLE eventos
  DROP CONSTRAINT IF EXISTS eventos_periodo_check,
  ADD CONSTRAINT eventos_periodo_check CHECK (data_fim >= data_inicio);

ALTER TABLE eventos
  DROP CONSTRAINT IF EXISTS eventos_duracao_minutos_check,
  ADD CONSTRAINT eventos_duracao_minutos_check
    CHECK (duracao_minutos BETWEEN 15 AND 1440);

ALTER TABLE mural_eventos
  ALTER COLUMN usuario_id SET NOT NULL,
  ALTER COLUMN data_inicio SET NOT NULL,
  ALTER COLUMN data_fim SET NOT NULL;

ALTER TABLE mural_eventos
  DROP CONSTRAINT IF EXISTS mural_eventos_congregacao_id_fkey,
  ADD CONSTRAINT mural_eventos_congregacao_id_fkey
    FOREIGN KEY (congregacao_id) REFERENCES congregacoes(id) ON DELETE SET NULL;

ALTER TABLE mural_eventos
  DROP CONSTRAINT IF EXISTS mural_eventos_tipo_midia_check,
  ADD CONSTRAINT mural_eventos_tipo_midia_check
    CHECK (tipo_midia IN ('imagem', 'video'));

ALTER TABLE mural_eventos
  DROP CONSTRAINT IF EXISTS mural_eventos_periodo_check,
  ADD CONSTRAINT mural_eventos_periodo_check CHECK (data_fim >= data_inicio);

ALTER TABLE mural_curtidas
  ALTER COLUMN usuario_id SET NOT NULL,
  ALTER COLUMN post_id SET NOT NULL;

ALTER TABLE mural_comentarios
  ALTER COLUMN post_id SET NOT NULL,
  ALTER COLUMN usuario_id SET NOT NULL;

ALTER TABLE mural_comentarios
  DROP CONSTRAINT IF EXISTS mural_comentarios_texto_check,
  ADD CONSTRAINT mural_comentarios_texto_check
    CHECK (LENGTH(BTRIM(texto)) > 0);

ALTER TABLE mural_comentarios
  DROP CONSTRAINT IF EXISTS mural_comentarios_parent_same_post_fk;

ALTER TABLE mural_comentarios
  DROP CONSTRAINT IF EXISTS mural_comentarios_id_post_unique,
  ADD CONSTRAINT mural_comentarios_id_post_unique UNIQUE (id, post_id);

ALTER TABLE mural_comentarios
  ADD CONSTRAINT mural_comentarios_parent_same_post_fk
    FOREIGN KEY (parent_id, post_id)
    REFERENCES mural_comentarios (id, post_id)
    ON DELETE CASCADE;

ALTER TABLE mural_comentario_curtidas
  ALTER COLUMN usuario_id SET NOT NULL,
  ALTER COLUMN comentario_id SET NOT NULL;

ALTER TABLE gestao_datas_rascunho
  ALTER COLUMN master_id SET NOT NULL,
  ALTER COLUMN congregacao_id SET NOT NULL,
  ALTER COLUMN marcador SET NOT NULL,
  ALTER COLUMN publicado SET NOT NULL,
  ALTER COLUMN horario TYPE TIME USING horario::TIME;

ALTER TABLE gestao_datas_rascunho
  DROP CONSTRAINT IF EXISTS gestao_datas_periodo_check,
  ADD CONSTRAINT gestao_datas_periodo_check CHECK (data_fim >= data_inicio);

ALTER TABLE gestao_datas_rascunho
  DROP CONSTRAINT IF EXISTS gestao_datas_rascunho_duracao_minutos_check,
  ADD CONSTRAINT gestao_datas_rascunho_duracao_minutos_check
    CHECK (duracao_minutos BETWEEN 15 AND 1440);

ALTER TABLE gestao_datas_rascunho
  DROP CONSTRAINT IF EXISTS gestao_datas_rascunho_marcador_check,
  ADD CONSTRAINT gestao_datas_rascunho_marcador_check
    CHECK (marcador IN ('NORMAL', 'REVISAR', 'CONFLITO'));
