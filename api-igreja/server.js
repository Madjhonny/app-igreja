const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();


const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurada no arquivo .env');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Limite aumentado para permitir envio de fotos em Base64

// === CONFIGURAÇÃO DO BANCO DE DADOS ===
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});

// === ROTA DE CADASTRO DE USUÁRIO ===
app.post('/cadastro', async (req, res) => {
  try {
    const { nome_completo, email, senha, congregacao_id, cpf, telefone, foto_perfil } = req.body;

    // 1. Verifica se o email ou CPF já existem no banco
    const userExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1 OR cpf = $2', [email, cpf]);
    if (userExistente.rows.length > 0) {
      return res.status(400).json({ erro: 'Este E-mail ou CPF já está cadastrado.' });
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
    res.status(500).json({ erro: 'Erro interno ao cadastrar usuário' });
  }
});

// === ROTA DE LOGIN ===
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    
    // 1. Busca o usuário pelo email
    const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Email ou senha inválidos.' });
    }
    
    const usuario = resultado.rows[0];

    // 2. Compara a senha digitada com a senha criptografada do banco
    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return res.status(400).json({ erro: 'Email ou senha inválidos.' });
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

const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ erro: 'Acesso negado. Faça login para realizar esta ação.' });
  
  const token = authHeader.split(' ')[1];
  try {
    const decodificado = jwt.verify(token, JWT_SECRET);
    req.usuario = decodificado;
    next();
  } catch (erro) {
    res.status(401).json({ erro: 'Token inválido ou expirado. Faça login novamente.' });
  }
};

const verificarAprovacao = (req, res, next) => {
  if (req.usuario.nivel_acesso !== 'MASTER' && req.usuario.status_conta !== 'APROVADO') {
    return res.status(403).json({ erro: 'Sua conta ainda não foi aprovada pelo Master.' });
  }
  next();
};

const somenteMaster = (req, res, next) => {
  if (req.usuario.nivel_acesso !== 'MASTER') {
    return res.status(403).json({ erro: 'Acesso negado. Apenas o Master pode realizar esta ação.' });
  }
  next();
};

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

app.post('/eventos', verificarToken, verificarAprovacao, async (req, res) => {
  try {
    const { titulo, data_inicio, data_fim, horario, congregacao_id, legenda } = req.body;
    const { id: usuario_id, nivel_acesso, congregacao_id: congregacaoAdmin } = req.usuario;

    if (!titulo || !data_inicio || !data_fim || !horario) {
      return res.status(400).json({ erro: "Preencha todos os campos obrigatórios (Título, Datas e Horário)." });
    }

    let congregacaoFinal = congregacao_id;
    if (nivel_acesso === 'ADMIN') {
      congregacaoFinal = congregacaoAdmin;
    } else if (nivel_acesso === 'MASTER' && !congregacaoFinal) {
      return res.status(400).json({ erro: "O Master deve selecionar uma congregação para o evento." });
    }

    const query = `
      INSERT INTO eventos (titulo, data_inicio, data_fim, horario, congregacao_id, criado_por_usuario_id, legenda)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const valores = [titulo, data_inicio, data_fim, horario, congregacaoFinal, usuario_id, legenda || null];
    const resultado = await pool.query(query, valores);

    res.status(201).json({ mensagem: "Evento criado com sucesso!", evento: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao criar evento:", erro);
    res.status(500).json({ erro: "Erro ao criar evento" });
  }
});

app.put('/eventos/:id', verificarToken, verificarAprovacao, async (req, res) => {
  try {
    const eventoId = req.params.id;
    const { titulo, data_inicio, data_fim, horario, congregacao_id, legenda } = req.body;
    const { nivel_acesso, congregacao_id: congregacaoAdmin } = req.usuario;

    const eventoRes = await pool.query('SELECT * FROM eventos WHERE id = $1', [eventoId]);
    if (eventoRes.rowCount === 0) {
      return res.status(404).json({ erro: "Evento não encontrado." });
    }
    const eventoAtual = eventoRes.rows[0];

    if (nivel_acesso === 'ADMIN' && eventoAtual.congregacao_id !== congregacaoAdmin) {
      return res.status(403).json({ erro: "Admin só pode editar eventos da sua própria congregação." });
    }

    let congregacaoFinal = nivel_acesso === 'MASTER' ? congregacao_id : congregacaoAdmin;

    const query = `
      UPDATE eventos 
      SET titulo = $1, data_inicio = $2, data_fim = $3, horario = $4, congregacao_id = $5, legenda = $6
      WHERE id = $7
      RETURNING *;
    `;
    const valores = [titulo, data_inicio, data_fim, horario, congregacaoFinal, legenda || null, eventoId];
    const resultado = await pool.query(query, valores);

    res.json({ mensagem: "Evento atualizado com sucesso!", evento: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao atualizar evento:", erro);
    res.status(500).json({ erro: "Erro ao atualizar evento" });
  }
});

app.delete('/eventos/:id', verificarToken, verificarAprovacao, async (req, res) => {
  try {
    const eventoId = req.params.id;
    const { nivel_acesso, congregacao_id: congregacaoAdmin } = req.usuario;

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

app.get('/usuarios', verificarToken, async (req, res) => {
  try {
    const { nivel_acesso, congregacao_id } = req.usuario;

    if (nivel_acesso === 'MEMBRO') {
      return res.status(403).json({ erro: "Acesso negado." });
    }

    let query = `
      SELECT u.id, u.nome_completo, u.nome_exibicao, u.email, u.nivel_acesso, u.status_conta, u.cpf, u.telefone, u.foto_perfil, c.nome as congregacao, c.id as congregacao_id
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

app.put('/usuarios/:id/status', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status_conta } = req.body;
    const { nivel_acesso, congregacao_id } = req.usuario;

    if (nivel_acesso === 'ADMIN') {
      const targetUser = await pool.query('SELECT congregacao_id FROM usuarios WHERE id = $1', [id]);
      if (targetUser.rowCount === 0 || targetUser.rows[0].congregacao_id !== congregacao_id) {
        return res.status(403).json({ erro: "Você só pode alterar status de usuários da sua congregação." });
      }
    }
    
    const query = `UPDATE usuarios SET status_conta = $1 WHERE id = $2 RETURNING *;`;
    const resultado = await pool.query(query, [status_conta, id]);
    
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
    
    const query = `UPDATE usuarios SET nivel_acesso = $1 WHERE id = $2 RETURNING *;`;
    const resultado = await pool.query(query, [nivel_acesso, id]);
    
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
    
    const congCheck = await pool.query('SELECT * FROM congregacoes WHERE id = $1', [congregacao_id]);
    if (congCheck.rowCount === 0) {
      return res.status(404).json({ erro: "Congregação não encontrada." });
    }

    const query = `UPDATE usuarios SET congregacao_id = $1 WHERE id = $2 RETURNING *;`;
    await pool.query(query, [congregacao_id, id]);
    
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

    const query = `
      UPDATE usuarios 
      SET nome_exibicao = $1, bio = $2, foto_perfil = $3
      WHERE id = $4
      RETURNING id, nome_completo, nome_exibicao, email, nivel_acesso, status_conta, congregacao_id, foto_perfil, telefone, cpf, bio;
    `;
    const valores = [nome_exibicao, bio, foto_perfil, usuario_id];
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

app.post('/mural', verificarToken, async (req, res) => {
  try {
    const { titulo, descricao, local, tipo_midia, midia, data_inicio, data_fim } = req.body;
    const usuario_id = req.usuario.id;
    const congregacao_id = req.usuario.congregacao_id || null; 

    if (!data_inicio || !data_fim) {
      return res.status(400).json({ erro: "É necessário informar a data de início e término do evento." });
    }

    const query = `
      INSERT INTO mural_eventos (usuario_id, congregacao_id, titulo, descricao, local, tipo_midia, midia, data_inicio, data_fim)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const valores = [usuario_id, congregacao_id, titulo, descricao, local, tipo_midia, midia, data_inicio, data_fim];
    const resultado = await pool.query(query, valores);

    res.status(201).json({ mensagem: "Post criado com sucesso!", post: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao criar post no mural:", erro);
    res.status(500).json({ erro: "Erro interno ao criar publicação." });
  }
});

app.get('/mural', verificarToken, async (req, res) => {
  try {
    await pool.query(`DELETE FROM mural_eventos WHERE data_fim < CURRENT_DATE;`);

    const usuario_atual_id = req.usuario.id;

    const query = `
      SELECT m.*, COALESCE(u.nome_exibicao, u.nome_completo) as autor, u.foto_perfil as autor_foto,
        (SELECT COUNT(*) FROM mural_curtidas mc WHERE mc.post_id = m.id) as total_curtidas,
        EXISTS (SELECT 1 FROM mural_curtidas mc WHERE mc.post_id = m.id AND mc.usuario_id = $1) as curtiu_por_mim
      FROM mural_eventos m
      JOIN usuarios u ON m.usuario_id = u.id
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

app.delete('/mural/:id', verificarToken, async (req, res) => {
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

app.post('/mural/:id/curtir', verificarToken, async (req, res) => {
  try {
    const post_id = req.params.id;
    const usuario_id = req.usuario.id;

    const check = await pool.query('SELECT * FROM mural_curtidas WHERE usuario_id = $1 AND post_id = $2', [usuario_id, post_id]);

    if (check.rows.length > 0) {
      await pool.query('DELETE FROM mural_curtidas WHERE usuario_id = $1 AND post_id = $2', [usuario_id, post_id]);
      return res.json({ curtiu: false, mensagem: "Curtida removida." });
    } else {
      await pool.query('INSERT INTO mural_curtidas (usuario_id, post_id) VALUES ($1, $2)', [usuario_id, post_id]);
      return res.json({ curtiu: true, mensagem: "Post curtido!" });
    }
  } catch (erro) {
    console.error("Erro ao curtir post:", erro);
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

app.post('/mural/:id/comentarios', verificarToken, async (req, res) => {
  try {
    const post_id = req.params.id;
    const usuario_id = req.usuario.id;
    const { texto, parent_id } = req.body;

    if (!texto || !texto.trim()) {
      return res.status(400).json({ erro: "O comentário não pode estar vazio." });
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
    res.status(500).json({ erro: "Erro ao publicar comentário." });
  }
});

app.post('/comentarios/:id/curtir', verificarToken, async (req, res) => {
  try {
    const comentario_id = req.params.id;
    const usuario_id = req.usuario.id;

    const check = await pool.query('SELECT * FROM mural_comentario_curtidas WHERE usuario_id = $1 AND comentario_id = $2', [usuario_id, comentario_id]);

    if (check.rows.length > 0) {
      await pool.query('DELETE FROM mural_comentario_curtidas WHERE usuario_id = $1 AND comentario_id = $2', [usuario_id, comentario_id]);
      return res.json({ curtiu: false });
    } else {
      await pool.query('INSERT INTO mural_comentario_curtidas (usuario_id, comentario_id) VALUES ($1, $2)', [usuario_id, comentario_id]);
      return res.json({ curtiu: true });
    }
  } catch (erro) {
    console.error("Erro ao curtir comentário:", erro);
    res.status(500).json({ erro: "Erro ao curtir comentário." });
  }
});

app.delete('/comentarios/:id', verificarToken, async (req, res) => {
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
      WHERE (horario, horario + duracao_minutos * INTERVAL '1 minute')
        OVERLAPS ($4::time, $4::time + $5 * INTERVAL '1 minute')
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

    await pool.query('DELETE FROM gestao_datas_rascunho WHERE id = $1 AND master_id = $2', [id, master_id]);
    res.json({ mensagem: "Item removido do planejamento." });
  } catch (erro) {
    console.error("Erro ao excluir item do planejamento:", erro);
    res.status(500).json({ erro: "Erro ao excluir evento." });
  }
});

app.post('/gestao-datas/publicar', verificarToken, somenteMaster, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const master_id = req.usuario.id;

    const rascunhosRes = await client.query(` SELECT * FROM gestao_datas_rascunho WHERE master_id = $1 AND publicado = FALSE ORDER BY id FOR UPDATE; `, 
      [master_id]);

    if (rascunhosRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: "Não há eventos pendentes para publicar." });
    }

    for (const rascunho of rascunhosRes.rows) {
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
        rascunho.legenda
      ]);
    }

    await client.query(
      'UPDATE gestao_datas_rascunho SET publicado = TRUE WHERE master_id = $1 AND publicado = FALSE', 
      [master_id]
    );

    await client.query('COMMIT');
    res.json({ mensagem: "Todos os eventos foram publicados com sucesso na Agenda geral!" });
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error("Erro na publicação em lote:", erro);
    res.status(500).json({ erro: "Erro ao publicar eventos na Agenda." });
  } finally {
    client.release();
  }
});

// Migração compatível: eventos antigos recebem duração padrão de 60 minutos.
// IF NOT EXISTS evita alterar ou duplicar dados já existentes.
const iniciarServidor = async () => {
  try {
    await pool.query(`
      ALTER TABLE gestao_datas_rascunho
      ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER NOT NULL DEFAULT 60;
    `);
    await pool.query(`
      ALTER TABLE eventos
      ADD COLUMN IF NOT EXISTS duracao_minutos INTEGER NOT NULL DEFAULT 60;
    `);

    app.listen(3000, () => {
      console.log('✅ Servidor rodando na porta 3000!');
    });
  } catch (erro) {
    console.error('❌ Não foi possível preparar as colunas de duração:', erro);
    process.exit(1);
  }
};

iniciarServidor();