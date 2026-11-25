import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verificarPerfis({ novoContexto, origin, pool, users, congregation, postId, login, tab, logout, diretorio }) {
  const api = 'http://localhost:3000';
  const hoje = new Date();
  const { rows: [contaPendente] } = await pool.query('SELECT senha_hash FROM usuarios WHERE id=$1', [users.Pendente]);
  const { rows: [congregacao] } = await pool.query('SELECT nome FROM congregacoes WHERE id=$1', [congregation]);
  const { rows: [jardim] } = await pool.query("INSERT INTO congregacoes (nome) VALUES ('Jardim Perfis E2E') RETURNING id,nome");
  const { rows: [externo] } = await pool.query(`INSERT INTO usuarios
    (nome_completo,nome_exibicao,email,senha_hash,congregacao_id,cpf,status_conta)
    VALUES ('Conta Jardim E2E','Conta Jardim E2E','jardim-perfis@example.test',$1,$2,'53000000001','PENDENTE') RETURNING id`,
  [contaPendente.senha_hash, jardim.id]);

  const contextos = [];
  const abrir = async perfil => {
    const contexto = await novoContexto();
    contextos.push(contexto);
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(14000);
    if (perfil) await login(perfil, pagina);
    return pagina;
  };
  const texto = (pagina, nome) => pagina.getByText(nome, { exact: true }).filter({ visible: true });
  const opcao = (pagina, titulo, nome) => pagina.getByRole('dialog')
    .filter({ has: texto(pagina, titulo) }).getByText(nome, { exact: true });
  const chamada = async (pagina, rota, metodo = 'GET', corpo) => {
    const token = pagina ? await pagina.evaluate(() => localStorage.getItem('userToken')) : null;
    return fetch(api + rota, {
      method: metodo,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  };
  const atalhos = {
    status: 'Aprovar/Status', nivel: 'Mudar Nível', painel: 'Abrir painel de gestão',
    pendente: 'Sua conta está aguardando aprovação.',
  };
  const abrirPainel = async pagina => {
    await tab('Perfil', pagina);
    await pagina.getByRole('button', { name: atalhos.painel }).click();
  };
  const abrirCongregacao = (pagina, nome) => pagina.goto(`${origin}/usuarios-congregacao?congregacaoNome=${encodeURIComponent(nome)}`);
  const estado = async id => (await pool.query(
    'SELECT nome_exibicao,bio,nivel_acesso,status_conta FROM usuarios WHERE id=$1', [id],
  )).rows[0];
  const editarPerfil = async (pagina, nome, bio) => {
    await tab('Perfil', pagina);
    assert.equal(await pagina.getByRole('button', { name: atalhos.painel }).count(), 0);
    await pagina.getByRole('button', { name: 'Editar perfil' }).click();
    await pagina.getByRole('textbox', { name: 'Nome de exibição' }).fill(nome);
    await pagina.getByRole('textbox', { name: 'Biografia' }).fill(bio);
    await pagina.getByRole('button', { name: 'Salvar alterações do perfil' }).click();
    await texto(pagina, 'Perfil atualizado com sucesso!').waitFor();
    await pagina.getByRole('button', { name: 'OK', exact: true }).click();
  };

  try {
    const master = await abrir('Master');
    const admin = await abrir('Admin');
    const pendente = await abrir('Pendente');

    await abrirPainel(master);
    await master.waitForURL('**/gestao-usuarios');
    await texto(master, congregacao.nome).click();
    await texto(master, 'Master').click();
    await master.getByRole('dialog').waitFor();
    assert.equal(await texto(master, atalhos.status).count(), 0);
    assert.equal(await texto(master, atalhos.nivel).count(), 0);
    assert.equal((await chamada(master, `/usuarios/${users.Master}/status`, 'PUT', { status_conta: 'BLOQUEADO' })).status, 403);
    assert.equal((await chamada(master, `/usuarios/${users.Master}/nivel`, 'PUT', { nivel_acesso: 'MEMBRO' })).status, 403);
    await abrirCongregacao(master, jardim.nome);
    await texto(master, 'Conta Jardim E2E').waitFor();
    await master.reload();
    await texto(master, 'Conta Jardim E2E').click();
    await texto(master, atalhos.nivel).click();
    await texto(master, 'Promover/Rebaixar').waitFor();
    assert.equal(await opcao(master, 'Promover/Rebaixar', 'ADMIN').count(), 0);
    assert.equal(await opcao(master, 'Promover/Rebaixar', 'MASTER').count(), 0);
    assert.equal((await chamada(master, `/usuarios/${externo.id}/nivel`, 'PUT', { nivel_acesso: 'ADMIN' })).status, 404);
    await abrirCongregacao(master, jardim.nome);
    await texto(master, 'Conta Jardim E2E').click();
    await texto(master, atalhos.status).click();
    await opcao(master, 'Alterar Status', 'APROVADO').click();
    await master.getByText('Status: APROVADO', { exact: false }).waitFor();
    await texto(master, atalhos.nivel).click();
    await opcao(master, 'Promover/Rebaixar', 'ADMIN').click();
    await master.getByText('Nível: ADMIN', { exact: false }).waitFor();
    assert.equal((await estado(externo.id)).nivel_acesso, 'ADMIN');
    assert.equal((await estado(externo.id)).status_conta, 'APROVADO');
    console.log('OK 15: MASTER gerencia outra congregação, aprova e promove sem poder alterar o próprio nível ou status.');

    await abrirPainel(admin);
    await admin.waitForURL('**/usuarios-congregacao?*');
    await texto(admin, 'Master').click();
    await admin.getByRole('dialog').waitFor();
    assert.equal(await texto(admin, atalhos.status).count(), 0);
    assert.equal(await texto(admin, atalhos.nivel).count(), 0);
    assert.equal((await chamada(admin, `/usuarios/${externo.id}/status`, 'PUT', { status_conta: 'BLOQUEADO' })).status, 404);
    assert.equal((await chamada(admin, `/usuarios/${users.Master}/status`, 'PUT', { status_conta: 'BLOQUEADO' })).status, 404);
    assert.equal((await chamada(admin, `/usuarios/${users.Pendente}/nivel`, 'PUT', { nivel_acesso: 'ADMIN' })).status, 403);
    const listaAdmin = await (await chamada(admin, '/usuarios')).json();
    assert.ok(listaAdmin.some(usuario => usuario.id === users.Pendente));
    assert.ok(listaAdmin.every(usuario => usuario.congregacao_id === congregation && !('cpf' in usuario) && !('telefone' in usuario)));
    await admin.goto(origin + '/gestao-datas');
    await admin.waitForURL('**/agenda');
    assert.equal((await chamada(admin, '/gestao-datas')).status, 403);
    console.log('OK 15: ADMIN tem gestão restrita à própria congregação e a contas MEMBRO, sem acesso ao planejamento.');

    await texto(pendente, atalhos.pendente).waitFor();
    await editarPerfil(pendente, 'Pendente atualizado E2E', 'Perfil editado antes da aprovação.');
    assert.equal((await estado(users.Pendente)).bio, 'Perfil editado antes da aprovação.');
    await abrirCongregacao(admin, congregacao.nome);
    await texto(admin, 'Pendente').click();
    await texto(admin, atalhos.status).click();
    await opcao(admin, 'Alterar Status', 'APROVADO').click();
    await admin.getByText('Status: APROVADO', { exact: false }).waitFor();
    await pendente.getByRole('button', { name: 'Verificar se a conta já foi aprovada' }).click();
    await texto(pendente, atalhos.pendente).waitFor({ state: 'hidden' });
    await tab('Eventos', pendente);
    await pendente.getByTestId(`interesse-feed-${postId}`).waitFor();
    assert.equal((await chamada(pendente, '/mural/interesses')).status, 200);
    assert.equal((await estado(users.Pendente)).status_conta, 'APROVADO');
    console.log('OK 15: PENDENTE edita o perfil e a sessão atual ganha acesso de MEMBRO após aprovação pela interface do ADMIN.');

    await editarPerfil(pendente, 'Membro atualizado E2E', 'Perfil editado depois da aprovação.');
    assert.equal((await estado(users.Pendente)).bio, 'Perfil editado depois da aprovação.');
    const { rows: [comentario] } = await pool.query(`INSERT INTO mural_comentarios (post_id,usuario_id,texto)
      VALUES ($1,$2,'Comentário de outro usuário E2E') RETURNING id`, [postId, users.Master]);
    await tab('Eventos', pendente);
    await pendente.getByTestId(`mural-card-${postId}`).getByLabel('Ver comentários', { exact: true }).click();
    await texto(pendente, 'Comentário de outro usuário E2E').waitFor();
    assert.equal(await pendente.getByRole('button', { name: /Excluir comentário/ }).count(), 0);
    assert.equal((await chamada(pendente, `/comentarios/${comentario.id}`, 'DELETE')).status, 403);
    assert.equal((await pool.query('SELECT 1 FROM mural_comentarios WHERE id=$1', [comentario.id])).rowCount, 1);
    console.log('OK 15: MEMBRO edita o próprio perfil e não pode excluir comentário de terceiro na interface ou na API.');

    const dataEvento = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    for (const gestor of [master, admin]) {
      const eMaster = gestor === master;
      const dados = { titulo: `Agenda E2E ${eMaster ? 'Master' : 'Admin'}`, data_inicio: dataEvento,
        data_fim: dataEvento, horario: '08:00', congregacao_id: jardim.id };
      const criacao = await chamada(gestor, '/eventos', 'POST', dados);
      assert.equal(criacao.status, 201);
      const { evento } = await criacao.json();
      assert.equal(evento.congregacao_id, eMaster ? jardim.id : congregation);
      const rota = `/eventos/${evento.id}`;
      if (eMaster) {
        assert.equal((await chamada(admin, rota, 'PUT', dados)).status, 403);
        assert.equal((await chamada(admin, rota, 'DELETE')).status, 403);
      }
      await gestor.goto(origin + '/agenda');
      await texto(gestor, dados.titulo).click();
      await texto(gestor, 'Editar').click();
      await gestor.waitForURL('**/editar-evento?*');
      await gestor.reload();
      const campoTitulo = gestor.getByRole('textbox');
      await campoTitulo.fill('Evento editado E2E');
      const [edicao] = await Promise.all([
        gestor.waitForResponse(r => r.url() === api + rota && r.request().method() === 'PUT'),
        gestor.getByRole('button', { name: 'ATUALIZAR EVENTO' }).click(),
      ]);
      assert.equal(edicao.status(), 200);
      assert.equal((await pool.query('SELECT titulo FROM eventos WHERE id=$1', [evento.id])).rows[0].titulo, 'Evento editado E2E');
      await gestor.getByRole('button', { name: 'Voltar à agenda', exact: true }).click();
      await gestor.waitForURL('**/agenda');
      await texto(gestor, 'Evento editado E2E').click();
      await texto(gestor, 'Editar').click();
      await gestor.getByRole('button', { name: 'EXCLUIR EVENTO' }).click();
      const [exclusao] = await Promise.all([
        gestor.waitForResponse(r => r.url() === api + rota && r.request().method() === 'DELETE'),
        gestor.getByRole('button', { name: 'Excluir', exact: true }).click(),
      ]);
      assert.equal(exclusao.status(), 200);
      await gestor.getByRole('button', { name: 'Voltar à agenda', exact: true }).click();
      await gestor.waitForURL('**/agenda');
      assert.equal((await pool.query('SELECT 1 FROM eventos WHERE id=$1', [evento.id])).rowCount, 0);
    }
    console.log('OK 15: MASTER e ADMIN criam, editam e excluem eventos dentro dos respectivos escopos no PostgreSQL.');

    await master.goto(origin + '/explore');
    await master.getByRole('button', { name: 'Nova publicação' }).click();
    await master.waitForURL('**/criar-post');
    const png = await master.evaluate(() => {
      const canvas = document.createElement('canvas');
      const contexto = canvas.getContext('2d');
      contexto.fillStyle = '#2A4B4C';
      contexto.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const [seletor] = await Promise.all([
      master.waitForEvent('filechooser'), texto(master, 'Toque para anexar uma foto').click(),
    ]);
    await seletor.setFiles({ name: 'agenda-perfis.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await texto(master, 'Trocar').waitFor();
    const titulo = 'Publicação verificável MASTER';
    await master.getByPlaceholder('Ex: Culto de Celebração').fill(titulo);
    await texto(master, 'Selecionar data de início e término').click();
    await texto(master, String(hoje.getDate())).click();
    await texto(master, 'Confirmar').click();
    const [publicacao] = await Promise.all([
      master.waitForResponse(r => r.url() === `${api}/mural` && r.request().method() === 'POST'),
      texto(master, 'PUBLICAR NO MURAL').click(),
    ]);
    assert.equal(publicacao.status(), 201);
    const { post } = await publicacao.json();
    assert.equal((await pool.query('SELECT titulo FROM mural_eventos WHERE id=$1', [post.id])).rows[0].titulo, titulo);
    await master.getByRole('button', { name: 'OK', exact: true }).click();
    const card = master.getByTestId(`mural-card-${post.id}`);
    await card.getByRole('button', { name: 'Opções da publicação' }).click();
    await master.getByTestId('mural-menu-publicacao').getByText('Excluir publicação').click();
    const [remocao] = await Promise.all([
      master.waitForResponse(r => r.url() === `${api}/mural/${post.id}` && r.request().method() === 'DELETE'),
      master.getByRole('button', { name: 'Excluir', exact: true }).click(),
    ]);
    assert.equal(remocao.status(), 200);
    await card.waitFor({ state: 'hidden' });
    assert.equal((await pool.query('SELECT 1 FROM mural_eventos WHERE id=$1', [post.id])).rowCount, 0);
    console.log('OK 15: MASTER publica com anexo pela interface e remove a publicação, com confirmação no PostgreSQL.');

    await pendente.goto(origin + '/gestao-usuarios');
    await pendente.waitForURL('**/agenda');
    assert.equal((await chamada(pendente, '/usuarios')).status, 403);
    const convidado = await abrir();
    await convidado.goto(origin + '/login');
    await convidado.getByRole('button', { name: 'Entrar como convidado' }).click();
    await convidado.waitForURL('**/agenda');
    await tab('Perfil', convidado);
    assert.equal(await convidado.getByRole('button', { name: atalhos.painel }).count(), 0);
    await convidado.getByRole('button', { name: 'Criar uma conta' }).click();
    await convidado.waitForURL('**/registro');
    await convidado.getByRole('button', { name: 'Voltar ao login' }).click();
    await convidado.waitForURL('**/login');
    assert.equal(await convidado.evaluate(() => localStorage.getItem('userToken')), null);
    for (const rota of ['/usuarios', '/mural/interesses', '/gestao-datas', '/sessao']) {
      assert.equal((await chamada(null, rota)).status, 401, rota);
    }
    console.log('OK 15: CONVIDADO alterna para cadastro e login, e acessos diretos protegidos exigem autenticação.');

    for (const status of ['BLOQUEADO', 'RECUSADO']) {
      const credencial = await pendente.evaluate(() => localStorage.getItem('userToken'));
      assert.ok(credencial);
      assert.equal((await chamada(master, `/usuarios/${users.Pendente}/status`, 'PUT', { status_conta: status })).status, 200);
      assert.equal((await chamada(pendente, '/sessao')).status, 403);
      const tentativa = pendente.waitForResponse(r => r.url() === `${api}/sessao` && r.status() === 403);
      await pendente.evaluate(() => window.dispatchEvent(new Event('focus')));
      await tentativa;
      await pendente.waitForURL('**/login?*');
      assert.equal(await pendente.evaluate(() => localStorage.getItem('userToken')), null);
      const [negacao] = await Promise.all([
        pendente.waitForResponse(r => r.url() === `${api}/login` && r.request().method() === 'POST'),
        (async () => {
          await pendente.getByLabel('E-mail', { exact: true }).fill('pendente@example.test');
          await pendente.getByLabel('Senha', { exact: true }).fill('TesteWeb123!');
          await pendente.getByRole('button', { name: 'Entrar', exact: true }).click();
        })(),
      ]);
      assert.equal(negacao.status(), 403);
      assert.equal(await pendente.evaluate(() => localStorage.getItem('userToken')), null);
      assert.equal((await chamada(master, `/usuarios/${users.Pendente}/status`, 'PUT', { status_conta: 'APROVADO' })).status, 200);
      await login('Pendente', pendente);
    }
    await logout(pendente);
    console.log('OK 15: contas BLOQUEADA e RECUSADA perdem a sessão ativa e têm novo login negado.');
  } catch (erro) {
    await mkdir(diretorio, { recursive: true });
    const paginas = [];
    for (const [index, contexto] of contextos.entries()) {
      const [pagina] = contexto.pages();
      if (!pagina || pagina.isClosed()) continue;
      paginas.push({ rota: new URL(pagina.url()).pathname, texto: await pagina.locator('body').innerText() });
      await pagina.screenshot({ path: join(diretorio, `perfis-falha-${index + 1}.png`) });
    }
    await writeFile(join(diretorio, 'perfis-falha.json'), JSON.stringify(paginas, null, 2));
    throw erro;
  } finally {
    await Promise.all(contextos.map(contexto => contexto.close()));
  }
}
