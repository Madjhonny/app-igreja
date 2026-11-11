const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();


const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurada no arquivo .env');
}

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.use(cors({
  origin(origin, callback) {
    // Aplicativos nativos não enviam Origin. Clientes web devem estar na allowlist.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida pelo CORS.'));
  },
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '4mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' },
});
const cadastroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.CADASTRO_RATE_LIMIT || 5),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { erro: 'Muitos cadastros a partir deste endereço. Tente novamente mais tarde.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 2_000_000);

const textoValido = (value, min, max) =>
  typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const idValido = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const dataValida = value => {
  if (typeof value !== 'string' || !DATA_RE.test(value)) return false;
  const [ano, mes, dia] = value.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
};
const imagemValida = value => {
  if (value == null || value === '') return true;
  if (typeof value !== 'string') return false;
  if (/^https:\/\/[^\s]+$/i.test(value)) return value.length <= 2048;
  const match = IMAGE_RE.exec(value);
  if (!match) return false;
  const padding = (match[2].match(/=*$/) || [''])[0].length;
  return Math.floor(match[2].length * 3 / 4) - padding <= MAX_IMAGE_BYTES;
};
const validarEvento = ({ titulo, data_inicio, data_fim, horario }) => {
  if (!textoValido(titulo, 1, 120)) return 'O título deve ter entre 1 e 120 caracteres.';
  if (!dataValida(data_inicio) || !dataValida(data_fim) || data_inicio > data_fim) {
    return 'Informe um período de datas válido.';
  }
  if (typeof horario !== 'string' || !HORA_RE.test(horario.slice(0, 5))) {
    return 'Horário inválido. Utilize HH:mm.';
  }
  return null;
};

// Namespace para serializar alterações na agenda por congregação.
// A publicação e as alterações diretas compartilham este lock transacional.
const AGENDA_LOCK_NAMESPACE = 414441;

const bloquearAgendaDaCongregacao = async (client, ids) => {
  const ordenados = [...new Set(ids.map(Number))].sort((a, b) => a - b);
  for (const id of ordenados) {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [AGENDA_LOCK_NAMESPACE, id]);
  }
};

const minutosDoHorario = (horario) => {
  const [horas, minutos] = String(horario).slice(0, 5).split(':').map(Number);
  return horas * 60 + minutos;
};

const eventosSobrepostos = (primeiro, segundo) =>
  Number(primeiro.congregacao_id) === Number(segundo.congregacao_id) &&
  String(primeiro.data_inicio).slice(0, 10) <= String(segundo.data_fim).slice(0, 10) &&
  String(primeiro.data_fim).slice(0, 10) >= String(segundo.data_inicio).slice(0, 10) &&
  minutosDoHorario(primeiro.horario) < minutosDoHorario(segundo.horario) + Number(segundo.duracao_minutos || 60) &&
  minutosDoHorario(segundo.horario) < minutosDoHorario(primeiro.horario) + Number(primeiro.duracao_minutos || 60);

// Consulta compartilhada por criação e edição direta de eventos.
// Intervalos são semiabertos: terminar às 20h não conflita com começar às 20h.
const consultarConflitosPublicados = async (client, evento, ignorarId = null) => {
  const resultado = await client.query(`
    SELECT id, titulo, data_inicio::text AS data_inicio, data_fim::text AS data_fim,
           horario::text AS horario, COALESCE(duracao_minutos, 60) AS duracao_minutos,
           congregacao_id
    FROM eventos
    WHERE congregacao_id = $1
      AND data_inicio <= $3::date AND data_fim >= $2::date
      AND ($6::integer IS NULL OR id <> $6)
      AND EXTRACT(EPOCH FROM horario::time) < EXTRACT(EPOCH FROM $4::time) + $5 * 60
      AND EXTRACT(EPOCH FROM horario::time) + COALESCE(duracao_minutos, 60) * 60 > EXTRACT(EPOCH FROM $4::time)
    ORDER BY data_inicio, horario, id
    LIMIT 8;
  `, [evento.congregacao_id, evento.data_inicio, evento.data_fim,
      evento.horario, Number(evento.duracao_minutos || 60), ignorarId]);
  return resultado.rows;
};

const respostaConflitoDireto = (conflitos) => ({
  codigo: 'CONFLITO_AGENDA',
  erro: 'Já existe um evento da mesma congregação nesse período e horário.',
  eventosConflitantes: conflitos,
  podeConfirmar: true,
});

// === CONFIGURAÇÃO DO BANCO DE DADOS ===
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),

  ssl: process.env.DB_SSL === 'true'
    ? {
        rejectUnauthorized: true,
        ...(process.env.DB_SSL_CA
          ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') }
          : {}),
      }
    : undefined,
});

// === ROTA DE CADASTRO DE USUÁRIO ===
app.post('/cadastro', cadastroLimiter, async (req, res) => {
  try {
    const { nome_completo, senha, congregacao_id, foto_perfil } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const cpf = typeof req.body.cpf === 'string' ? req.body.cpf.replace(/\D/g, '') : '';
    const telefone = typeof req.body.telefone === 'string' ? req.body.telefone.replace(/\D/g, '') : '';

    if (!textoValido(nome_completo, 3, 120) || !EMAIL_RE.test(email) || email.length > 254 ||
        !textoValido(senha, 10, 128) || !/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha) ||
        cpf.length !== 11 || telefone.length < 10 || telefone.length > 15 ||
        !idValido(congregacao_id) || !imagemValida(foto_perfil)) {
      return res.status(400).json({
        erro: 'Dados inválidos. Use senha com ao menos 10 caracteres, letras e números, além de CPF, telefone e congregação válidos.',
      });
    }

    // 1. Verifica se o email ou CPF já existem no banco
    const userExistente = await pool.query(
      'SELECT id FROM usuarios WHERE LOWER(email) = $1 OR cpf = $2 LIMIT 1',
      [email, cpf]
    );
    if (userExistente.rows.length > 0) {
      return res.status(409).json({ erro: 'Não foi possível concluir o cadastro com os dados informados.' });
    }

    // 2. Criptografa a senha antes de salvar
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senha, salt);

    // 3. Salva no banco com o CPF, Telefone, Foto e inicializa o nome_exibicao igual ao nome_completo
    const query = `
      INSERT INTO usuarios (nome_completo, nome_exibicao, email, senha_hash, congregacao_id, cpf, telefone, foto_perfil)
      VALUES ($1, $1, $2, $3, $4, $5, $6, $7)
      RETURNING id, nome_completo, nome_exibicao, email, nivel_acesso, status_conta;
    `;
    const valores = [nome_completo, email, senhaHash, congregacao_id, cpf, telefone, foto_perfil || null];
    const resultado = await pool.query(query, valores);

    res.status(201).json({ 
      mensagem: 'Usuário cadastrado com sucesso! Aguarde aprovação do Master.', 
      usuario: resultado.rows[0] 
    });
  } catch (erro) {
    console.error('Erro no cadastro:', erro);
    if (erro?.code === '23505') {
      return res.status(409).json({ erro: 'Não foi possível concluir o cadastro com os dados informados.' });
    }
    if (erro?.code === '23503' || erro?.code === '23514') {
      return res.status(400).json({ erro: 'Os dados informados não são válidos.' });
    }
    res.status(500).json({ erro: 'Erro interno ao cadastrar usuário' });
  }
});

// === ROTA DE LOGIN ===
app.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { senha } = req.body;
    if (!EMAIL_RE.test(email) || email.length > 254 || typeof senha !== 'string' || !senha || senha.length > 128) {
      return res.status(400).json({ erro: 'Informe e-mail e senha.' });
    }
    
    // 1. Busca o usuário pelo email
    const resultado = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [email]);
    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Email ou senha inválidos.' });
    }
    
    const usuario = resultado.rows[0];

    // 2. Compara a senha digitada com a senha criptografada do banco
    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return res.status(400).json({ erro: 'Email ou senha inválidos.' });
    }

    if (!['APROVADO', 'PENDENTE'].includes(usuario.status_conta)) {
      return res.status(403).json({ codigo: 'CONTA_SEM_ACESSO', erro: 'Sua conta não tem acesso. Procure a administração.' });
    }

    // 3. Se tudo estiver certo, gera o Token
    const token = jwt.sign(
      { 
        id: usuario.id, 
        nivel_acesso: usuario.nivel_acesso, 
        status_conta: usuario.status_conta,
        congregacao_id: usuario.congregacao_id 
      }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    // 4. Devolve o Token e os dados completos para o aplicativo
    res.json({ 
      mensagem: 'Login realizado com sucesso!', 
      token: token,
      usuario: {
        id: usuario.id,
        nome_completo: usuario.nome_completo,
        nome_exibicao: usuario.nome_exibicao || usuario.nome_completo,
        email: usuario.email,
        nivel_acesso: usuario.nivel_acesso,
        status_conta: usuario.status_conta,
        congregacao_id: usuario.congregacao_id,
        foto_perfil: usuario.foto_perfil,
        telefone: usuario.telefone,
        cpf: usuario.cpf,
        bio: usuario.bio
      }
    });
  } catch (erro) {
    console.error('Erro no login:', erro);
    res.status(500).json({ erro: 'Erro interno ao fazer login' });
  }
});

// ========================================================
// === MIDDLEWARES DE SEGURANÇA ===
// ========================================================

const verificarToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const match = typeof authHeader === 'string' && /^Bearer ([^\s]+)$/i.exec(authHeader);
  if (!match) return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });
  let decodificado;
  try {
    decodificado = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] });
    if (!decodificado || !Number.isSafeInteger(decodificado.id) || decodificado.id <= 0) throw new Error('Identidade inválida');
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado. Faça login novamente.' });
  }
  try {
    // Permissões atuais: revogações não dependem da expiração do token.
    const resultado = await pool.query(
      'SELECT id, nivel_acesso, status_conta, congregacao_id FROM usuarios WHERE id = $1',
      [decodificado.id]
    );
    const usuario = resultado.rows[0];
    if (!usuario) return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });
    if (!['MASTER', 'ADMIN', 'MEMBRO'].includes(usuario.nivel_acesso) ||
        !['APROVADO', 'PENDENTE'].includes(usuario.status_conta)) {
      return res.status(403).json({ codigo: 'CONTA_SEM_ACESSO', erro: 'Sua conta não tem acesso. Procure a administração.' });
    }
    req.usuario = usuario;
  } catch (erro) {
    console.error('Erro ao validar sessão:', erro);
    return res.status(500).json({ erro: 'Não foi possível validar sua sessão.' });
  }
  return next();
};

const somenteGestores = (req, res, next) => {
  if (!['MASTER', 'ADMIN'].includes(req.usuario.nivel_acesso)) {
    return res.status(403).json({ erro: 'Apenas Master e administradores podem realizar esta ação.' });
  }
  return verificarAprovacao(req, res, next);
};

const verificarAprovacao = (req, res, next) => {
  if (req.usuario.status_conta !== 'APROVADO') {
    return res.status(403).json({ erro: 'Sua conta ainda não foi aprovada pelo Master.' });
  }
  return next();
};

const somenteMaster = (req, res, next) => {
  if (req.usuario.nivel_acesso !== 'MASTER') {
    return res.status(403).json({ erro: 'Acesso negado. Apenas o Master pode realizar esta ação.' });
  }
  return verificarAprovacao(req, res, next);
};

// Dados atuais da sessão, sem senha/hash ou dados de outros usuários.
app.get('/sessao', verificarToken, async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT id, nome_completo, nome_exibicao, email, nivel_acesso, status_conta,
             congregacao_id, foto_perfil, telefone, cpf, bio
      FROM usuarios WHERE id = $1
    `, [req.usuario.id]);
    if (!resultado.rowCount) return res.status(401).json({ erro: 'Sessão inválida. Faça login novamente.' });
    res.set('Cache-Control', 'no-store');
    res.json({ usuario: resultado.rows[0] });
  } catch (erro) {
    console.error('Erro ao carregar sessão:', erro);
    res.status(500).json({ erro: 'Não foi possível carregar sua sessão.' });
  }
});

// ========================================================
// === ROTAS DE CONGREGAÇÕES ===
// ========================================================

app.get('/congregacoes', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT id, nome FROM congregacoes ORDER BY nome ASC;');
    res.json(resultado.rows);
  } catch (erro) {
    res.status(500).json({ erro: "Erro ao buscar congregações." });
  }
});

// ========================================================
// === ROTAS DE EVENTOS (AGENDA) ===
// ========================================================

app.get('/eventos', verificarToken, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    if ((mes == null) !== (ano == null)) {
      return res.status(400).json({ erro: 'Informe mês e ano juntos.' });
    }
    if (mes != null && (!Number.isInteger(Number(mes)) || Number(mes) < 1 || Number(mes) > 12 ||
        !Number.isInteger(Number(ano)) || Number(ano) < 2000 || Number(ano) > 2200)) {
      return res.status(400).json({ erro: 'Mês ou ano inválido.' });
    }
    let query = `
      SELECT e.*, c.nome as congregacao, u.nome_completo as criado_por
      FROM eventos e
      JOIN congregacoes c ON e.congregacao_id = c.id
      JOIN usuarios u ON e.criado_por_usuario_id = u.id
    `;
    
    const valores = [];
    if (mes && ano) {
      query += ` WHERE e.data_inicio <=
      (DATE_TRUNC('month', make_date($2, $1, 1)) + INTERVAL '1 month - 1 day')::date AND e.data_fim >= make_date($2, $1, 1)`;
      valores.push(mes, ano);
    }

    query += ` ORDER BY e.data_inicio ASC, e.horario ASC;`;

    const resultado = await pool.query(query, valores);
    res.json(resultado.rows);
  } catch (erro) {
    console.error("Erro ao buscar eventos:", erro);
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

app.post('/eventos', verificarToken, somenteGestores, async (req, res) => {
  let client;
  let transacaoAberta = false;
  try {
    const { titulo, data_inicio, data_fim, horario, congregacao_id, legenda } = req.body;
    const { id: usuario_id, nivel_acesso, congregacao_id: congregacaoAdmin } = req.usuario;

    const erroValidacao = validarEvento(req.body);
    if (erroValidacao) return res.status(400).json({ erro: erroValidacao });
    if (legenda != null && !textoValido(legenda, 0, 2000)) {
      return res.status(400).json({ erro: 'A legenda deve ter no máximo 2000 caracteres.' });
    }

    const duracao = Number(req.body.duracao_minutos ?? 60);
    if (!Number.isInteger(duracao) || duracao < 15 || duracao > 1440) {
      return res.status(400).json({ erro: 'A duração deve estar entre 15 e 1440 minutos.' });
    }

    const congregacaoFinal = nivel_acesso === 'ADMIN' ? congregacaoAdmin : congregacao_id;
    if (!idValido(congregacaoFinal)) {
      return res.status(400).json({ erro: 'Selecione uma congregação válida.' });
    }

    const eventoNovo = {
      titulo: titulo.trim(), data_inicio, data_fim, horario: horario.slice(0, 5),
      duracao_minutos: duracao, congregacao_id: Number(congregacaoFinal),
    };

    client = await pool.connect();
    await client.query('BEGIN');
    transacaoAberta = true;
    await bloquearAgendaDaCongregacao(client, [congregacaoFinal]);

    const conflitos = await consultarConflitosPublicados(client, eventoNovo);
    if (conflitos.length > 0 && !(nivel_acesso === 'MASTER' && req.body.confirmar_conflito === true)) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return res.status(409).json({
        ...respostaConflitoDireto(conflitos),
        podeConfirmar: nivel_acesso === 'MASTER',
      });
    }

    const resultado = await client.query(`
      INSERT INTO eventos (titulo, data_inicio, data_fim, horario, duracao_minutos, congregacao_id, criado_por_usuario_id, legenda)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `, [
      eventoNovo.titulo, data_inicio, data_fim, eventoNovo.horario, duracao,
      Number(congregacaoFinal), usuario_id, legenda?.trim() || null,
    ]);

    await client.query('COMMIT');
    transacaoAberta = false;
    res.status(201).json({ mensagem: 'Evento criado com sucesso!', evento: resultado.rows[0] });
  } catch (erro) {
    if (transacaoAberta && client) {
      try { await client.query('ROLLBACK'); } catch (rollbackErro) {
        console.error('Erro ao desfazer criação de evento:', rollbackErro);
      }
    }
    console.error('Erro ao criar evento:', erro);
    res.status(500).json({ erro: 'Erro ao criar evento' });
  } finally {
    client?.release();
  }
});

app.put('/eventos/:id', verificarToken, somenteGestores, async (req, res) => {
  let client;
  let transacaoAberta = false;
  try {
    const eventoId = req.params.id;
    const { titulo, data_inicio, data_fim, horario, congregacao_id, legenda } = req.body;
    const { nivel_acesso, congregacao_id: congregacaoAdmin } = req.usuario;

    if (!idValido(eventoId)) return res.status(400).json({ erro: 'Evento inválido.' });
    const erroValidacao = validarEvento(req.body);
    if (erroValidacao) return res.status(400).json({ erro: erroValidacao });
    if (legenda != null && !textoValido(legenda, 0, 2000)) {
      return res.status(400).json({ erro: 'A legenda deve ter no máximo 2000 caracteres.' });
    }

    const congregacaoFinal = nivel_acesso === 'MASTER' ? congregacao_id : congregacaoAdmin;
    if (!idValido(congregacaoFinal)) {
      return res.status(400).json({ erro: 'Selecione uma congregação válida.' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    transacaoAberta = true;
    await bloquearAgendaDaCongregacao(client, [congregacaoFinal]);

    const eventoRes = await client.query('SELECT * FROM eventos WHERE id = $1 FOR UPDATE', [eventoId]);
    if (eventoRes.rowCount === 0) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return res.status(404).json({ erro: 'Evento não encontrado.' });
    }

    const eventoAtual = eventoRes.rows[0];
    if (nivel_acesso === 'ADMIN' && Number(eventoAtual.congregacao_id) !== Number(congregacaoAdmin)) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return res.status(403).json({ erro: 'Admin só pode editar eventos da sua própria congregação.' });
    }

    const duracao = Number(req.body.duracao_minutos ?? eventoAtual.duracao_minutos ?? 60);
    if (!Number.isInteger(duracao) || duracao < 15 || duracao > 1440) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return res.status(400).json({ erro: 'A duração deve estar entre 15 e 1440 minutos.' });
    }

    const eventoEditado = {
      titulo: titulo.trim(), data_inicio, data_fim, horario: horario.slice(0, 5),
      duracao_minutos: duracao, congregacao_id: Number(congregacaoFinal),
    };
    const conflitos = await consultarConflitosPublicados(client, eventoEditado, Number(eventoId));
    if (conflitos.length > 0 && !(nivel_acesso === 'MASTER' && req.body.confirmar_conflito === true)) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return res.status(409).json({
        ...respostaConflitoDireto(conflitos),
        podeConfirmar: nivel_acesso === 'MASTER',
      });
    }

    const resultado = await client.query(`
      UPDATE eventos
      SET titulo = $1, data_inicio = $2, data_fim = $3, horario = $4,
          congregacao_id = $5, legenda = $6, duracao_minutos = $7
      WHERE id = $8
      RETURNING *;
    `, [
      eventoEditado.titulo, data_inicio, data_fim, eventoEditado.horario,
      Number(congregacaoFinal), legenda?.trim() || null, duracao, eventoId,
    ]);

    await client.query('COMMIT');
    transacaoAberta = false;
    res.json({ mensagem: 'Evento atualizado com sucesso!', evento: resultado.rows[0] });
  } catch (erro) {
    if (transacaoAberta && client) {
      try { await client.query('ROLLBACK'); } catch (rollbackErro) {
        console.error('Erro ao desfazer edição de evento:', rollbackErro);
      }
    }
    console.error('Erro ao atualizar evento:', erro);
    res.status(500).json({ erro: 'Erro ao atualizar evento' });
  } finally {
    client?.release();
  }
});

app.delete('/eventos/:id', verificarToken, somenteGestores, async (req, res) => {
  try {
    const eventoId = req.params.id;
    const { nivel_acesso, congregacao_id: congregacaoAdmin } = req.usuario;

    if (!idValido(eventoId)) return res.status(400).json({ erro: 'Evento inválido.' });

    const eventoRes = await pool.query('SELECT * FROM eventos WHERE id = $1', [eventoId]);
    if (eventoRes.rowCount === 0) {
      return res.status(404).json({ erro: "Evento não encontrado." });
    }
    const evento = eventoRes.rows[0];

    if (nivel_acesso === 'ADMIN' && evento.congregacao_id !== congregacaoAdmin) {
      return res.status(403).json({ erro: "Você não tem permissão para excluir eventos de outra congregação." });
    }

    await pool.query('DELETE FROM eventos WHERE id = $1', [eventoId]);
    res.json({ mensagem: "Evento excluído com sucesso!" });
  } catch (erro) {
    console.error("Erro ao excluir evento:", erro);
    res.status(500).json({ erro: "Erro ao excluir evento" });
  }
});

// ========================================================
// === GESTÃO DE USUÁRIOS (MASTER E ADMIN) ===
// ========================================================

app.get('/usuarios', verificarToken, somenteGestores, async (req, res) => {
  try {
    const { nivel_acesso, congregacao_id } = req.usuario;

    if (nivel_acesso === 'MEMBRO') {
      return res.status(403).json({ erro: "Acesso negado." });
    }

    const camposSensiveis = nivel_acesso === 'MASTER' ? ', u.cpf, u.telefone' : '';
    let query = `
      SELECT u.id, u.nome_completo, u.nome_exibicao, u.email, u.nivel_acesso, u.status_conta, u.foto_perfil${camposSensiveis}, c.nome as congregacao, c.id as congregacao_id
      FROM usuarios u
      JOIN congregacoes c ON u.congregacao_id = c.id
    `;

    const valores = [];

    if (nivel_acesso === 'ADMIN') {
      query += ` WHERE u.congregacao_id = $1`;
      valores.push(congregacao_id);
    }

    query += ` ORDER BY CASE WHEN u.status_conta = 'PENDENTE' THEN 1 ELSE 2 END, u.data_cadastro DESC;`;

    const resultado = await pool.query(query, valores);
    res.json(resultado.rows);
  } catch (erro) {
    console.error("Erro ao buscar usuários:", erro);
    res.status(500).json({ erro: "Erro interno ao buscar usuários." });
  }
});

app.put('/usuarios/:id/status', verificarToken, somenteGestores, async (req, res) => {
  try {
    const { id } = req.params;
    const { status_conta } = req.body;
    const { nivel_acesso, congregacao_id } = req.usuario;

    if (!idValido(id) || !['APROVADO', 'PENDENTE', 'RECUSADO', 'BLOQUEADO'].includes(status_conta)) {
      return res.status(400).json({ erro: 'Status de conta inválido.' });
    }
    if (String(id) === String(req.usuario.id)) {
      return res.status(403).json({ erro: 'Você não pode alterar o próprio status.' });
    }
    // Escopo também no UPDATE para evitar alteração fora da congregação.
    const resultado = await pool.query(`
      UPDATE usuarios SET status_conta = $1 WHERE id = $2
      AND ($3 = 'MASTER' OR (congregacao_id = $4 AND nivel_acesso = 'MEMBRO'))
      RETURNING id, nome_completo, nome_exibicao, email, nivel_acesso, status_conta, congregacao_id;
    `, [status_conta, id, nivel_acesso, congregacao_id]);
    if (!resultado.rowCount) {
      return res.status(404).json({ erro: 'Usuário não encontrado ou fora da sua permissão.' });
    }

    res.json({ mensagem: "Status atualizado com sucesso!", usuario: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao atualizar status:", erro);
    res.status(500).json({ erro: "Erro ao atualizar status do usuário." });
  }
});

app.put('/usuarios/:id/nivel', verificarToken, somenteMaster, async (req, res) => {
  try {
    const { id } = req.params;
    const { nivel_acesso } = req.body;
    
    if (!idValido(id) || !['MASTER', 'ADMIN', 'MEMBRO'].includes(nivel_acesso)) {
      return res.status(400).json({ erro: 'Nível de acesso inválido.' });
    }
    if (String(id) === String(req.usuario.id)) {
      return res.status(403).json({ erro: 'Você não pode alterar o próprio nível de acesso.' });
    }
    const query = `UPDATE usuarios SET nivel_acesso = $1 WHERE id = $2
      AND ($1 = 'MEMBRO' OR status_conta = 'APROVADO')
      RETURNING id, nome_completo, nome_exibicao, email, nivel_acesso, status_conta, congregacao_id;`;
    const resultado = await pool.query(query, [nivel_acesso, id]);
    if (!resultado.rowCount) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    
    res.json({ mensagem: "Nível de acesso atualizado com sucesso!", usuario: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao atualizar nível:", erro);
    res.status(500).json({ erro: "Erro ao atualizar nível de acesso." });
  }
});

// Nova Rota: Alterar a congregação vinculada ao usuário (Exclusivo Master)
app.put('/usuarios/:id/congregacao', verificarToken, somenteMaster, async (req, res) => {
  try {
    const { id } = req.params;
    const { congregacao_id } = req.body;
    
    if (!idValido(id) || !idValido(congregacao_id)) {
      return res.status(400).json({ erro: 'Usuário ou congregação inválida.' });
    }
    const congCheck = await pool.query('SELECT id FROM congregacoes WHERE id = $1', [congregacao_id]);
    if (congCheck.rowCount === 0) {
      return res.status(404).json({ erro: "Congregação não encontrada." });
    }

    const query = `UPDATE usuarios SET congregacao_id = $1 WHERE id = $2 RETURNING *;`;
    const alteracao = await pool.query(query, [congregacao_id, id]);
    if (!alteracao.rowCount) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    
    const usuarioAtualizado = await pool.query(`
      SELECT u.id, u.nome_completo, u.nome_exibicao, u.email, u.nivel_acesso, u.status_conta, u.cpf, u.telefone, u.foto_perfil, c.nome as congregacao, c.id as congregacao_id
      FROM usuarios u
      JOIN congregacoes c ON u.congregacao_id = c.id
      WHERE u.id = $1;
    `, [id]);

    res.json({ mensagem: "Congregação do usuário atualizada com sucesso!", usuario: usuarioAtualizado.rows[0] });
  } catch (erro) {
    console.error("Erro ao atualizar congregação:", erro);
    res.status(500).json({ erro: "Erro ao atualizar congregação do usuário." });
  }
});

app.put('/usuarios/perfil', verificarToken, async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nome_exibicao, bio, foto_perfil } = req.body;

    if (!textoValido(nome_exibicao, 2, 120) ||
        (bio != null && !textoValido(bio, 0, 500)) || !imagemValida(foto_perfil)) {
      return res.status(400).json({ erro: 'Nome, biografia ou foto inválidos.' });
    }

    const query = `
      UPDATE usuarios 
      SET nome_exibicao = $1, bio = $2, foto_perfil = $3
      WHERE id = $4
      RETURNING id, nome_completo, nome_exibicao, email, nivel_acesso, status_conta, congregacao_id, foto_perfil, telefone, cpf, bio;
    `;
    const valores = [nome_exibicao.trim(), bio?.trim() || null, foto_perfil || null, usuario_id];
    const resultado = await pool.query(query, valores);

    res.json({ 
      mensagem: "Perfil atualizado com sucesso!", 
      usuario: resultado.rows[0] 
    });
  } catch (erro) {
    console.error("Erro ao atualizar perfil:", erro);
    res.status(500).json({ erro: "Erro interno ao atualizar perfil." });
  }
});

// ========================================================
// === ROTAS DO MURAL DE EVENTOS ===
// ========================================================

app.post('/mural', verificarToken, somenteGestores, async (req, res) => {
  try {
    const { titulo, descricao, local, tipo_midia, midia, data_inicio, data_fim } = req.body;
    const usuario_id = req.usuario.id;
    const congregacao_id = req.usuario.congregacao_id || null; 

    if (!textoValido(titulo, 1, 120) || !dataValida(data_inicio) || !dataValida(data_fim) ||
        data_inicio > data_fim || (descricao != null && !textoValido(descricao, 0, 2000)) ||
        (local != null && !textoValido(local, 0, 180)) || tipo_midia !== 'imagem' || !midia || !imagemValida(midia)) {
      return res.status(400).json({
        erro: 'Preencha título, período e uma imagem JPEG, PNG ou WebP válida.',
      });
    }

    const query = `
      INSERT INTO mural_eventos (usuario_id, congregacao_id, titulo, descricao, local, tipo_midia, midia, data_inicio, data_fim)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const valores = [
      usuario_id,
      congregacao_id,
      titulo.trim(),
      descricao?.trim() || null,
      local?.trim() || null,
      tipo_midia,
      midia,
      data_inicio,
      data_fim,
    ];
    const resultado = await pool.query(query, valores);

    res.status(201).json({ mensagem: "Post criado com sucesso!", post: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao criar post no mural:", erro);
    res.status(500).json({ erro: "Erro interno ao criar publicação." });
  }
});

app.get('/mural', verificarToken, async (req, res) => {
  try {
    const usuario_atual_id = req.usuario.id;

    const query = `
      SELECT m.*, COALESCE(u.nome_exibicao, u.nome_completo) as autor, u.foto_perfil as autor_foto,
        (SELECT COUNT(*) FROM mural_curtidas mc WHERE mc.post_id = m.id) as total_curtidas,
        EXISTS (SELECT 1 FROM mural_curtidas mc WHERE mc.post_id = m.id AND mc.usuario_id = $1) as curtiu_por_mim
      FROM mural_eventos m
      JOIN usuarios u ON m.usuario_id = u.id
      WHERE m.data_fim >= CURRENT_DATE
      ORDER BY m.data_inicio ASC, m.criado_em DESC;
    `;
    const resultado = await pool.query(query, [usuario_atual_id]);
    
    const posts = resultado.rows.map(post => ({
      id: post.id,
      usuario_id: post.usuario_id,
      congregacao_id: post.congregacao_id,
      autor: post.autor,
      autor_foto: post.autor_foto,
      titulo: post.titulo,
      descricao: post.descricao,
      local: post.local,
      tipo: post.tipo_midia,
      midia: post.midia,
      totalCurtidas: parseInt(post.total_curtidas) || 0,
      curtiuPorMim: post.curtiu_por_mim,
      dataInicio: post.data_inicio,
      dataFim: post.data_fim,
      comentarios: []
    }));

    res.json(posts);
  } catch (erro) {
    console.error("Erro ao buscar mural:", erro);
    res.status(500).json({ erro: "Erro interno ao buscar o mural." });
  }
});

app.delete('/mural/:id', verificarToken, somenteGestores, async (req, res) => {
  try {
    const post_id = req.params.id;
    const { nivel_acesso, congregacao_id } = req.usuario;

    const postResult = await pool.query('SELECT * FROM mural_eventos WHERE id = $1', [post_id]);
    if (postResult.rowCount === 0) {
      return res.status(404).json({ erro: "Post não encontrado." });
    }
    const post = postResult.rows[0];

    const isMaster = nivel_acesso === 'MASTER';
    const isAdminDaCongregacao = nivel_acesso === 'ADMIN' && post.congregacao_id === congregacao_id;

    if (!isMaster && !isAdminDaCongregacao) {
      return res.status(403).json({ erro: "Você não tem permissão para excluir este post." });
    }

    await pool.query('DELETE FROM mural_eventos WHERE id = $1', [post_id]);
    res.json({ mensagem: "Post excluído com sucesso!" });
  } catch (erro) {
    console.error("Erro ao excluir post:", erro);
    res.status(500).json({ erro: "Erro interno ao excluir publicação." });
  }
});

app.post('/mural/:id/curtir', verificarToken, verificarAprovacao, async (req, res) => {
  try {
    const post_id = req.params.id;
    const usuario_id = req.usuario.id;
    if (!idValido(post_id)) return res.status(400).json({ erro: 'Post inválido.' });

    const resultado = await pool.query(`
      WITH removida AS (
        DELETE FROM mural_curtidas WHERE usuario_id = $1 AND post_id = $2 RETURNING 1
      ), inserida AS (
        INSERT INTO mural_curtidas (usuario_id, post_id)
        SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM removida)
        ON CONFLICT (usuario_id, post_id) DO NOTHING
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM inserida) AS curtiu;
    `, [usuario_id, post_id]);
    const curtiu = Boolean(resultado.rows[0]?.curtiu);
    return res.json({ curtiu, mensagem: curtiu ? 'Post curtido!' : 'Curtida removida.' });
  } catch (erro) {
    console.error("Erro ao curtir post:", erro);
    if (erro?.code === '23503') return res.status(404).json({ erro: 'Post não encontrado.' });
    res.status(500).json({ erro: "Erro interno ao processar curtida." });
  }
});

app.get('/mural/:id/comentarios', verificarToken, async (req, res) => {
  try {
    const post_id = req.params.id;
    const usuario_atual_id = req.usuario.id;

    const query = `
      SELECT 
        c.*, 
        COALESCE(u.nome_exibicao, u.nome_completo) as autor, 
        u.foto_perfil as autor_foto,
        (SELECT COUNT(*) FROM mural_comentario_curtidas mcc WHERE mcc.comentario_id = c.id) as total_curtidas,
        EXISTS (SELECT 1 FROM mural_comentario_curtidas mcc WHERE mcc.comentario_id = c.id AND mcc.usuario_id = $2) as curtiu_por_mim
      FROM mural_comentarios c
      JOIN usuarios u ON c.usuario_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.criado_em ASC;
    `;
    const resultado = await pool.query(query, [post_id, usuario_atual_id]);
    res.json(resultado.rows);
  } catch (erro) {
    console.error("Erro ao buscar comentários:", erro);
    res.status(500).json({ erro: "Erro ao carregar comentários." });
  }
});

app.post('/mural/:id/comentarios', verificarToken, verificarAprovacao, async (req, res) => {
  try {
    const post_id = req.params.id;
    const usuario_id = req.usuario.id;
    const { texto, parent_id } = req.body;

    if (!idValido(post_id) || !textoValido(texto, 1, 2000) || (parent_id != null && !idValido(parent_id))) {
      return res.status(400).json({ erro: "O comentário não pode estar vazio." });
    }

    if (parent_id != null) {
      const parent = await pool.query(
        'SELECT id FROM mural_comentarios WHERE id = $1 AND post_id = $2',
        [parent_id, post_id]
      );
      if (!parent.rowCount) {
        return res.status(400).json({ erro: 'O comentário respondido não pertence a esta publicação.' });
      }
    }

    const query = `
      INSERT INTO mural_comentarios (post_id, usuario_id, parent_id, texto)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const resultado = await pool.query(query, [post_id, usuario_id, parent_id || null, texto.trim()]);
    
    const comentarioCriado = await pool.query(`
      SELECT c.*, COALESCE(u.nome_exibicao, u.nome_completo) as autor, u.foto_perfil as autor_foto, 0 as total_curtidas, false as curtiu_por_mim
      FROM mural_comentarios c
      JOIN usuarios u ON c.usuario_id = u.id
      WHERE c.id = $1;
    `, [resultado.rows[0].id]);

    res.status(201).json(comentarioCriado.rows[0]);
  } catch (erro) {
    console.error("Erro ao criar comentário:", erro);
    if (erro?.code === '23503') return res.status(404).json({ erro: 'Publicação não encontrada.' });
    res.status(500).json({ erro: "Erro ao publicar comentário." });
  }
});

app.post('/comentarios/:id/curtir', verificarToken, verificarAprovacao, async (req, res) => {
  try {
    const comentario_id = req.params.id;
    const usuario_id = req.usuario.id;

    if (!idValido(comentario_id)) return res.status(400).json({ erro: 'Comentário inválido.' });
    const resultado = await pool.query(`
      WITH removida AS (
        DELETE FROM mural_comentario_curtidas
        WHERE usuario_id = $1 AND comentario_id = $2 RETURNING 1
      ), inserida AS (
        INSERT INTO mural_comentario_curtidas (usuario_id, comentario_id)
        SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM removida)
        ON CONFLICT (usuario_id, comentario_id) DO NOTHING
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM inserida) AS curtiu;
    `, [usuario_id, comentario_id]);
    return res.json({ curtiu: Boolean(resultado.rows[0]?.curtiu) });
  } catch (erro) {
    console.error("Erro ao curtir comentário:", erro);
    if (erro?.code === '23503') return res.status(404).json({ erro: 'Comentário não encontrado.' });
    res.status(500).json({ erro: "Erro ao curtir comentário." });
  }
});

app.delete('/comentarios/:id', verificarToken, verificarAprovacao, async (req, res) => {
  try {
    const comentario_id = req.params.id;
    const { id: usuario_id, nivel_acesso, congregacao_id } = req.usuario;

    const queryInfo = `
      SELECT c.*, p.congregacao_id as post_congregacao_id 
      FROM mural_comentarios c
      JOIN mural_eventos p ON c.post_id = p.id
      WHERE c.id = $1;
    `;
    const comentarioRes = await pool.query(queryInfo, [comentario_id]);
    if (comentarioRes.rowCount === 0) {
      return res.status(404).json({ erro: "Comentário não encontrado." });
    }
    const com = comentarioRes.rows[0];

    const isMaster = nivel_acesso === 'MASTER';
    const isDono = com.usuario_id === usuario_id;
    const isAdminDaCongregacao = nivel_acesso === 'ADMIN' && com.post_congregacao_id === congregacao_id;

    if (!isMaster && !isDono && !isAdminDaCongregacao) {
      return res.status(403).json({ erro: "Você não tem permissão para excluir este comentário." });
    }

    await pool.query('DELETE FROM mural_comentarios WHERE id = $1 OR parent_id = $1', [comentario_id]);
    res.json({ mensagem: "Comentário excluído com sucesso!" });
  } catch (erro) {
    console.error("Erro ao excluir comentário:", erro);
    res.status(500).json({ erro: "Erro ao excluir comentário." });
  }
});

app.get('/usuarios/:id/perfil-publico', verificarToken, async (req, res) => {
  try {
    const usuario_alvo_id = req.params.id;
    const query = `
      SELECT id, COALESCE(nome_exibicao, nome_completo) as nome_exibicao, foto_perfil, bio 
      FROM usuarios 
      WHERE id = $1;
    `;
    const resultado = await pool.query(query, [usuario_alvo_id]);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: "Usuário não encontrado." });
    }
    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error("Erro ao buscar perfil público:", erro);
    res.status(500).json({ erro: "Erro ao carregar perfil." });
  }
});

// ========================================================
// === ROTAS DE GESTÃO DE DATAS (EXCLUSIVO MASTER) ========
// ========================================================

app.get('/gestao-datas', verificarToken, somenteMaster, async (req, res) => {
  try {
    const master_id = req.usuario.id;
    const query = `
      SELECT g.*, c.nome as congregacao 
      FROM gestao_datas_rascunho g
      JOIN congregacoes c ON g.congregacao_id = c.id
      WHERE g.master_id = $1 AND g.publicado = FALSE
      ORDER BY g.data_inicio ASC, g.horario ASC;
    `;
    const resultado = await pool.query(query, [master_id]);
    res.json(resultado.rows);
  } catch (erro) {
    console.error("Erro ao buscar rascunhos de gestão de datas:", erro);
    res.status(500).json({ erro: "Erro ao carregar rascunhos." });
  }
});


app.post('/gestao-datas', verificarToken, somenteMaster, async (req, res) => {
  try {
    const master_id = req.usuario.id;
    const {
      titulo,
      data_inicio,
      data_fim,
      horario,
      duracao_minutos = 60,
      congregacao_id,
      legenda,
      marcador
    } = req.body;

    if (!titulo?.trim() || !data_inicio || !data_fim ||
        !horario || !congregacao_id) {
      return res.status(400).json({
        erro: "Preencha todos os campos obrigatórios."
      });
    }

    if (data_inicio > data_fim) {
      return res.status(400).json({
        erro: "A data final não pode ser anterior à data inicial."
      });
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) {
      return res.status(400).json({
        erro: "Horário inválido. Utilize HH:mm."
      });
    }

    const duracao = Number(duracao_minutos);
    if (!Number.isInteger(duracao) || duracao < 15 || duracao > 1440) {
      return res.status(400).json({
        erro: "A duração deve estar entre 15 e 1440 minutos."
      });
    }

    const marcadorPermitido = ['NORMAL', 'REVISAR', 'CONFLITO'];

    if (marcador && !marcadorPermitido.includes(marcador)) {
      return res.status(400).json({
        erro: "Marcador inválido."
      });
    }

    const congregacao = await pool.query(
      'SELECT id FROM congregacoes WHERE id = $1',
      [congregacao_id]
    );

    if (congregacao.rowCount === 0) {
      return res.status(404).json({
        erro: "Congregação não encontrada."
      });
    }

    // Verifica sobreposição de datas e horários
    // tanto no planejamento quanto na agenda publicada.
    const conflito = await pool.query(`
      SELECT titulo, data_inicio, data_fim, horario, origem
      FROM (
        SELECT
          titulo,
          data_inicio,
          data_fim,
          horario::time AS horario,
          COALESCE(duracao_minutos, 60) AS duracao_minutos,
          'PLANEJAMENTO' AS origem
        FROM gestao_datas_rascunho
        WHERE congregacao_id = $1
          AND publicado = FALSE
          AND data_inicio <= $3
          AND data_fim >= $2

        UNION ALL

        SELECT
          titulo,
          data_inicio,
          data_fim,
          horario,
          COALESCE(duracao_minutos, 60) AS duracao_minutos,
          'AGENDA PUBLICADA' AS origem
        FROM eventos
        WHERE congregacao_id = $1
          AND data_inicio <= $3
          AND data_fim >= $2
      ) AS eventos_conflitantes
      WHERE EXTRACT(EPOCH FROM horario::time) < EXTRACT(EPOCH FROM $4::time) + $5 * 60
        AND EXTRACT(EPOCH FROM horario::time) + duracao_minutos * 60 > EXTRACT(EPOCH FROM $4::time)
      LIMIT 5;
    `, [congregacao_id, data_inicio, data_fim, horario, duracao]);

    const conflitoDetectado = conflito.rowCount > 0;

    let marcadorFinal = marcador || 'NORMAL';

    // Conflito tem prioridade sobre os demais marcadores.
    if (conflitoDetectado) {
      marcadorFinal = 'CONFLITO';
    }

    const resultado = await pool.query(`
      INSERT INTO gestao_datas_rascunho
      (
        master_id,
        titulo,
        data_inicio,
        data_fim,
        horario,
        duracao_minutos,
        congregacao_id,
        legenda,
        marcador
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `, [
      master_id,
      titulo.trim(),
      data_inicio,
      data_fim,
      horario,
      duracao,
      congregacao_id,
      legenda || null,
      marcadorFinal
    ]);

    res.status(201).json({
      mensagem: conflitoDetectado
        ? "Evento salvo, mas foi identificado um conflito."
        : "Evento adicionado ao planejamento!",
      conflitoDetectado,
      eventosConflitantes: conflito.rows,
      evento: resultado.rows[0]
    });

  } catch (erro) {
    console.error("Erro ao salvar evento:", erro);
    res.status(500).json({
      erro: "Erro ao salvar evento no planejamento."
    });
  }
});


app.put('/gestao-datas/:id/marcador', verificarToken, somenteMaster, async (req, res) => {
  try {
    const { id } = req.params;
    const { marcador } = req.body;
    const master_id = req.usuario.id;

    if (!idValido(id) || !['NORMAL', 'REVISAR', 'CONFLITO'].includes(marcador)) {
      return res.status(400).json({ erro: 'Marcador inválido.' });
    }

    const query = `
      UPDATE gestao_datas_rascunho 
      SET marcador = $1 
      WHERE id = $2 AND master_id = $3 
      RETURNING *;
    `;
    const resultado = await pool.query(query, [marcador, id, master_id]);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: "Evento não encontrado." });
    }

    res.json({ mensagem: "Marcador atualizado com sucesso!", evento: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao atualizar marcador:", erro);
    res.status(500).json({ erro: "Erro ao atualizar marcador." });
  }
});

app.delete('/gestao-datas/:id', verificarToken, somenteMaster, async (req, res) => {
  try {
    const { id } = req.params;
    const master_id = req.usuario.id;

    if (!idValido(id)) return res.status(400).json({ erro: 'Item inválido.' });
    const resultado = await pool.query(
      'DELETE FROM gestao_datas_rascunho WHERE id = $1 AND master_id = $2 RETURNING id',
      [id, master_id]
    );
    if (!resultado.rowCount) return res.status(404).json({ erro: 'Item não encontrado.' });
    res.json({ mensagem: "Item removido do planejamento." });
  } catch (erro) {
    console.error("Erro ao excluir item do planejamento:", erro);
    res.status(500).json({ erro: "Erro ao excluir evento." });
  }
});

app.post('/gestao-datas/publicar', verificarToken, somenteMaster, async (req, res) => {
  let client;
  let transacaoAberta = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transacaoAberta = true;

    const master_id = req.usuario.id;
    const confirmarConflitos = req.body?.confirmar_conflitos === true;

    // Bloqueia os rascunhos até o fim da publicação para impedir duplicação.
    const rascunhosRes = await client.query(`
      SELECT id, titulo, data_inicio::text AS data_inicio, data_fim::text AS data_fim,
             horario::text AS horario, duracao_minutos, congregacao_id, legenda, marcador
      FROM gestao_datas_rascunho
      WHERE master_id = $1 AND publicado = FALSE
      ORDER BY id FOR UPDATE;
    `, [master_id]);

    if (rascunhosRes.rowCount === 0) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return res.status(400).json({ erro: 'Não há eventos pendentes para publicar.' });
    }

    const rascunhos = rascunhosRes.rows;
    await bloquearAgendaDaCongregacao(client, rascunhos.map(r => r.congregacao_id));

    const inicio = rascunhos.reduce((min, r) => r.data_inicio < min ? r.data_inicio : min, rascunhos[0].data_inicio);
    const fim = rascunhos.reduce((max, r) => r.data_fim > max ? r.data_fim : max, rascunhos[0].data_fim);
    const congregacoes = [...new Set(rascunhos.map(r => Number(r.congregacao_id)))];
    const publicadosRes = await client.query(`
      SELECT id, titulo, data_inicio::text AS data_inicio, data_fim::text AS data_fim,
             horario::text AS horario, COALESCE(duracao_minutos, 60) AS duracao_minutos,
             congregacao_id
      FROM eventos
      WHERE congregacao_id = ANY($1::integer[])
        AND data_inicio <= $3::date AND data_fim >= $2::date;
    `, [congregacoes, inicio, fim]);

    const conflitos = [];
    const idsComConflitos = new Set();

    for (const rascunho of rascunhos) {
      for (const publicado of publicadosRes.rows) {
        if (!eventosSobrepostos(rascunho, publicado)) continue;
        idsComConflitos.add(rascunho.id);
        conflitos.push({
          rascunho_id: rascunho.id,
          titulo: rascunho.titulo,
          evento_conflitante: publicado.titulo,
          origem: 'AGENDA PUBLICADA',
        });
      }
    }

    // Também valida eventos dentro do mesmo lote, antes de inserir qualquer registro.
    for (let i = 0; i < rascunhos.length; i++) {
      for (let j = i + 1; j < rascunhos.length; j++) {
        const a = rascunhos[i];
        const b = rascunhos[j];
        if (!eventosSobrepostos(a, b)) continue;
        idsComConflitos.add(a.id);
        idsComConflitos.add(b.id);
        conflitos.push({
          rascunho_id: a.id,
          titulo: a.titulo,
          evento_conflitante: b.titulo,
          origem: 'PLANEJAMENTO',
        });
      }
    }

    const revisar = rascunhos.filter(r => r.marcador === 'REVISAR').length;
    const marcadosConflito = rascunhos.filter(r => r.marcador === 'CONFLITO').length;
    const resumo = {
      revisar,
      marcadosConflito,
      eventosEmConflito: idsComConflitos.size,
      sobreposicoesEncontradas: conflitos.length,
    };

    // Marcadores são avisos manuais; conflito real é sempre recalculado no servidor.
    if ((revisar > 0 || marcadosConflito > 0 || conflitos.length > 0) && !confirmarConflitos) {
      await client.query('ROLLBACK');
      transacaoAberta = false;
      return res.status(409).json({
        codigo: 'CONFIRMACAO_CONFLITOS_NECESSARIA',
        erro: 'Há eventos com conflito ou pendentes de revisão. O MASTER deve confirmar a publicação.',
        resumo,
        conflitos: conflitos.slice(0, 8),
      });
    }

    for (const rascunho of rascunhos) {
      await client.query(`
        INSERT INTO eventos (titulo, data_inicio, data_fim, horario, duracao_minutos, congregacao_id, criado_por_usuario_id, legenda)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
      `, [
        rascunho.titulo,
        rascunho.data_inicio,
        rascunho.data_fim,
        rascunho.horario,
        rascunho.duracao_minutos || 60,
        rascunho.congregacao_id,
        master_id,
        rascunho.legenda,
      ]);
    }

    await client.query(
      'UPDATE gestao_datas_rascunho SET publicado = TRUE WHERE master_id = $1 AND publicado = FALSE',
      [master_id]
    );

    await client.query('COMMIT');
    transacaoAberta = false;
    res.json({
      mensagem: 'Todos os eventos foram publicados com sucesso na Agenda geral!',
      quantidadePublicada: rascunhos.length,
      confirmacaoExcepcional: confirmarConflitos,
    });
  } catch (erro) {
    if (transacaoAberta && client) {
      try { await client.query('ROLLBACK'); } catch (rollbackErro) {
        console.error('Erro ao desfazer publicação:', rollbackErro);
      }
    }
    console.error('Erro na publicação em lote:', erro);
    res.status(500).json({ erro: 'Erro ao publicar eventos na Agenda.' });
  } finally {
    client?.release();
  }
});

app.use((erro, _req, res, next) => {
  if (erro?.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'O conteúdo enviado excede o limite permitido.' });
  }
  if (erro instanceof SyntaxError && 'body' in erro) {
    return res.status(400).json({ erro: 'JSON inválido.' });
  }
  if (erro?.message === 'Origem não permitida pelo CORS.') {
    return res.status(403).json({ erro: erro.message });
  }
  return next(erro);
});

const iniciarServidor = async () => {
  try {
    await pool.query('SELECT 1');

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando na porta ${PORT}!`);
    });

  } catch (erro) {
    console.error('❌ Não foi possível conectar ao banco. Execute npm run db:migrate:', erro);
    process.exit(1);
  }
};

iniciarServidor();
