import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function luminancia(cor) {
  const [vermelho, verde, azul, opacidade = 1] = [...cor.matchAll(/[\d.]+/g)].map(x => Number(x[0]));
  assert.ok([vermelho, verde, azul].every(Number.isFinite), cor);
  // Branco é o caso de menor contraste para texto claro sobre a camada preta translúcida.
  const [r, g, b] = [vermelho, verde, azul].map(valor => {
    const canal = (valor * opacidade + 255 * (1 - opacidade)) / 255;
    return canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export async function verificarAcessibilidade({
  page, login, tab, logout, pool, users, postId, externoPostId, suspender, responder500, rotaLista, diretorio,
}) {
  await mkdir(diretorio, { recursive: true });
  const evidencias = { teclado: [], contraste: [] };
  const captura = nome => page.screenshot({ path: join(diretorio, nome + '.png') });
  const botao = (nome, raiz = page) => raiz.getByRole('button', { name: nome, exact: true });
  const teclado = tecla => page.keyboard.press(tecla);
  const focado = async (alvo, etapa) => {
    await page.waitForFunction(seletor => document.activeElement?.matches(seletor) === true, ':focus');
    const box = await alvo.evaluate(el => {
      const css = getComputedStyle(el);
      const { x, y, width, height } = el.getBoundingClientRect();
      return { ativo: el === document.activeElement, visivel: el.matches(':focus-visible'),
        contorno: css.outlineStyle, larguraContorno: css.outlineWidth, corContorno: css.outlineColor,
        nome: el.getAttribute('aria-label') || el.textContent.trim(), x, y, width, height };
    });
    assert.equal(box.ativo, true, 'Foco esperado em ' + etapa + '. Controle: ' + JSON.stringify(box));
    evidencias.teclado.push({ etapa, ...box });
    return box;
  };
  const esperarFoco = alvo => alvo.evaluate(el => {
    if (el === document.activeElement) return true;
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 3000);
      el.addEventListener('focus', () => { clearTimeout(timer); resolve(true); }, { once: true });
    });
  });
  const contraste = async (nome, frente, fundo, minimo, pseudo) => {
    const [cor, corFundo] = await Promise.all([
      frente.evaluate((el, pseudo) => getComputedStyle(el, pseudo).color, pseudo ?? null),
      fundo.evaluate(el => {
        for (let atual = el; atual; atual = atual.parentElement) {
          const cor = getComputedStyle(atual).backgroundColor;
          if (cor !== 'rgba(0, 0, 0, 0)' && cor !== 'transparent') return cor;
        }
        return 'rgb(255, 255, 255)';
      }),
    ]);
    const a = luminancia(cor);
    const b = luminancia(corFundo);
    const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    evidencias.contraste.push({ nome, cor, fundo: corFundo, razao: Number(razao.toFixed(2)), minimo });
    assert.ok(razao >= minimo, nome + ' tem contraste ' + razao.toFixed(2));
  };
  const esperarStatus = texto => page.waitForFunction(
    texto => document.querySelector('[data-testid="status-interesses"]')?.textContent === texto, texto
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login('Master');
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  const agenda = page.getByRole('heading', { name: 'Agenda', exact: true });
  const anterior = botao('Mês anterior');
  const proximo = botao('Próximo mês');
  const mes = page.getByTestId('agenda-mes');
  const textoMes = await mes.textContent();
  await anterior.focus();
  await teclado('Tab');
  const focoMes = await focado(proximo, 'Tab entre os meses');
  assert.equal(focoMes.visivel, true);
  assert.equal(focoMes.contorno, 'solid');
  assert.equal(focoMes.larguraContorno, '2px');
  assert.ok(focoMes.width >= 44 && focoMes.height >= 44);
  await captura('agenda-foco-mes');
  await contraste('Título Agenda', agenda, agenda.locator('../..'), 4.5);
  await contraste('Ícone de navegação da Agenda', proximo.locator(':scope > :first-child'), proximo, 3);
  const abaPerfil = page.getByLabel('Perfil', { exact: true });
  await contraste('Texto da aba inativa', abaPerfil.getByText('Perfil', { exact: true }), abaPerfil, 4.5);

  await teclado('Enter');
  await page.getByTestId('agenda-mes').filter({ hasNotText: textoMes.trim() }).waitFor();
  await teclado('Shift+Tab');
  await focado(anterior, 'Shift+Tab entre os meses');
  await teclado('Space');
  await mes.filter({ hasText: textoMes.trim() }).waitFor();
  assert.equal(await mes.getAttribute('aria-live'), 'polite');
  const hoje = page.locator('[data-testid="agenda-dia"][aria-current="date"]').and(page.getByRole('group', { name: /Hoje/ }));
  await hoje.waitFor();
  await page.getByRole('group', { name: /Com evento/ }).first().waitFor();
  evidencias.agendaSemantica = await page.getByTestId('agenda-calendario').ariaSnapshot();
  const seletor = page.getByRole('button', { name: /^Filtrar por congregação\./ });
  await seletor.focus();
  await teclado('Enter');
  const modalAgenda = page.getByRole('dialog', { name: 'Filtrar por congregação' });
  const fecharFiltro = botao('Fechar filtro', modalAgenda);
  assert.equal(await esperarFoco(fecharFiltro), true);
  const todas = botao('Todas as congregações', modalAgenda);
  await teclado('Tab');
  await focado(todas, 'Filtro da Agenda recebe foco na primeira opção');
  assert.equal(await todas.getAttribute('aria-pressed'), 'true');
  await teclado('Escape');
  await modalAgenda.waitFor({ state: 'hidden' });
  assert.equal(await esperarFoco(seletor), true);
  await focado(seletor, 'Escape retorna ao filtro da Agenda');
  await teclado('Enter');
  assert.equal(await esperarFoco(fecharFiltro), true);
  const sede = botao('Sede E2E', modalAgenda);
  await sede.waitFor();
  await teclado('Tab');
  await focado(todas, 'Todas as congregações precede as opções individuais');
  await teclado('Tab');
  await focado(botao('Outra congregação E2E', modalAgenda), 'Opções de congregação seguem a ordem apresentada');
  await teclado('Tab');
  await focado(sede, 'Tab alcança a opção de congregação');
  await teclado('Space');
  await modalAgenda.waitFor({ state: 'hidden' });
  const filtroSede = page.getByRole('button', { name: 'Filtrar por congregação. Sede E2E' });
  assert.equal(await esperarFoco(filtroSede), true);
  const atividade = page.getByTestId(/^agenda-evento-/).filter({ hasText: 'Evento público E2E' });
  await atividade.focus();
  await teclado('Enter');
  const detalhes = page.getByRole('dialog', { name: 'Detalhes do evento' });
  assert.equal(await esperarFoco(botao('Fechar detalhes', detalhes)), true);
  await teclado('Escape');
  await detalhes.waitFor({ state: 'hidden' });
  assert.equal(await esperarFoco(atividade), true);
  console.log('OK 13.15: Agenda por teclado, mês anunciado, dia atual, eventos e retorno do foco.');

  await tab('Eventos');
  const sincronizar = botao('Sincronizar interesses');
  const todos = botao('Todos');
  const minha = botao('Minha congregação');
  const filtroInteresses = botao('Filtrar meus interesses');
  const novoPost = botao('Nova publicação');
  await sincronizar.focus();
  for (const [alvo, etapa] of [[todos, 'Todos'], [minha, 'Minha congregação'], [filtroInteresses, 'Interesses'], [novoPost, 'Nova publicação']]) {
    await teclado('Tab');
    await focado(alvo, etapa);
  }
  await teclado('Shift+Tab');
  await focado(filtroInteresses, 'Shift+Tab retorna de Nova publicação para Interesses');
  await teclado('Space');
  assert.equal(await filtroInteresses.getAttribute('aria-pressed'), 'true');
  assert.equal(await todos.getAttribute('aria-pressed'), 'false');
  await teclado('Shift+Tab');
  await focado(minha, 'Filtro Minha congregação em ordem reversa');
  await teclado('Enter');
  assert.equal(await minha.getAttribute('aria-pressed'), 'true');
  assert.equal(await filtroInteresses.getAttribute('aria-pressed'), 'false');
  await teclado('Shift+Tab');
  await teclado('Enter');
  assert.equal(await todos.getAttribute('aria-pressed'), 'true');

  const card = page.getByTestId('mural-card-' + postId);
  const marcador = card.getByRole('button', { name: 'Interesse na publicação', pressed: false });
  const rotaPut = 'http://localhost:3000/mural/' + postId + '/interesse';
  const pendente = await suspender(rotaPut, 'PUT', route => route.continue());
  await marcador.focus();
  await teclado('Space');
  await pendente.recebida();
  const marcadorId = page.getByTestId('interesse-feed-' + postId);
  await page.waitForFunction(id => document.querySelector('[data-testid="interesse-feed-' + id + '"][aria-busy="true"][aria-disabled="true"][aria-pressed="true"]'), postId);
  await pendente.concluir();
  await card.getByRole('button', { name: 'Interesse na publicação', pressed: true, disabled: false }).waitFor();
  await page.waitForFunction(id => document.querySelector('[data-testid="interesse-feed-' + id + '"][aria-busy="false"]'), postId);
  assert.equal((await pool.query('SELECT 1 FROM mural_interesses WHERE usuario_id=$1 AND post_id=$2', [users.Master, postId])).rowCount, 1);

  const curtida = card.getByRole('button', { name: 'Curtir publicação', pressed: false });
  await curtida.focus();
  await teclado('Enter');
  await card.getByRole('button', { name: 'Curtir publicação', pressed: true }).waitFor();
  await teclado('Space');
  await curtida.waitFor();
  await filtroInteresses.focus();
  await teclado('Space');
  await marcadorId.focus();
  await teclado('Enter');
  await card.waitFor({ state: 'hidden' });
  await esperarStatus('Interesse removido.');
  assert.equal(await esperarFoco(filtroInteresses), true);
  assert.equal(await page.getByTestId('status-interesses').getAttribute('aria-live'), 'polite');

  const erro = await suspender(rotaLista, 'GET', responder500);
  await sincronizar.focus();
  await teclado('Enter');
  await erro.recebida();
  await esperarStatus('Carregando seus interesses.');
  assert.equal(await sincronizar.getAttribute('aria-busy'), 'true');
  await erro.concluir();
  await esperarStatus('Não foi possível consultar seus interesses.');
  const tentar = botao('Atualizar interesses');
  await tentar.focus();
  await teclado('Space');
  await esperarStatus('Interesses atualizados.');
  await todos.focus();
  await teclado('Enter');
  console.log('OK 13.15: filtros, curtidas e interesses alternáveis, estados ocupado/desabilitado e anúncios de recuperação.');

  const opcoes = botao('Opções da publicação', card);
  await opcoes.focus();
  await teclado('Enter');
  const menu = page.getByRole('dialog', { name: 'Opções da publicação' });
  const cancelar = botao('Cancelar', menu);
  assert.equal(await esperarFoco(cancelar), true);
  await focado(cancelar, 'Menu abre com foco em Cancelar');
  await teclado('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await esperarFoco(opcoes), true);

  const imagem = card.locator('img[alt^="Imagem da publicação:"]');
  await imagem.waitFor();
  const ampliar = page.getByTestId('mural-ampliar-' + postId);
  await ampliar.focus();
  await teclado('Enter');
  const slide = page.getByTestId('mural-slide-' + postId);
  const voltar = slide.getByTestId('voltar-fullscreen');
  assert.equal(await esperarFoco(voltar), true);
  await focado(voltar, 'Fullscreen foca Voltar');
  await contraste('Ícone de voltar sobre foto clara', voltar.locator(':scope > :first-child'), voltar, 3);
  const legenda = slide.getByTestId('mural-legenda-fullscreen');
  await contraste('Legenda do fullscreen sobre foto clara', legenda.getByText('Mural E2E', { exact: true }), legenda, 4.5);
  await teclado('ArrowDown');
  const proximoSlide = page.getByTestId('mural-slide-' + externoPostId);
  assert.equal(await esperarFoco(proximoSlide.getByTestId('voltar-fullscreen')), true);
  assert.equal(await slide.getAttribute('aria-hidden'), 'true');
  assert.equal(await voltar.evaluate(el => el.tabIndex), -1);
  await teclado('ArrowUp');
  assert.equal(await esperarFoco(voltar), true);
  await teclado('Tab');
  await focado(botao('Curtir publicação', slide), 'Fullscreen segue de Voltar para Curtir');
  await teclado('Tab');
  const abrirComentarios = botao('Ver comentários', slide);
  await focado(abrirComentarios, 'Fullscreen segue de Curtir para Comentários');
  await teclado('Space');
  const dialogo = page.getByRole('dialog', { name: 'Comentários' });
  const fechar = botao('Fechar comentários', dialogo);
  assert.equal(await esperarFoco(fechar), true);
  assert.equal(await dialogo.evaluate(el => {
    for (let atual = el; atual; atual = atual.parentElement) {
      if (atual.getAnimations().some(animacao => animacao.playState === 'running')) return false;
    }
    return true;
  }), true);
  const campo = dialogo.getByRole('textbox', { name: 'Escreva um comentário' });
  const curtirComentario = botao('Curtir comentário de Master', dialogo);
  await curtirComentario.waitFor();
  assert.equal(await curtirComentario.getAttribute('aria-pressed'), 'false');
  await contraste('Placeholder de comentário', campo, campo, 4.5, '::placeholder');
  evidencias.comentariosSemantica = await dialogo.ariaSnapshot();
  for (const tecla of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await teclado(tecla);
    assert.equal(await dialogo.evaluate(el => el.contains(document.activeElement)), true, 'Foco saiu dos comentários');
  }
  await captura('comentarios-foco');
  await teclado('Escape');
  await dialogo.waitFor({ state: 'hidden' });
  assert.equal(await esperarFoco(abrirComentarios), true);
  await teclado('Escape');
  await slide.waitFor({ state: 'hidden' });
  assert.equal(await esperarFoco(ampliar), true);
  await focado(ampliar, 'Escape retorna ao acionador do fullscreen');
  console.log('OK 13.15: foco de menu, fullscreen e comentários, atalhos, Escape e texto alternativo.');

  await page.setViewportSize({ width: 320, height: 568 });
  assert.ok(!(await page.locator('meta[name=viewport]').getAttribute('content')).match(/user-scalable\s*=\s*no|maximum-scale/));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.waitForFunction(() => Math.abs(visualViewport.scale - 2) < 0.01);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await cdp.detach();
  const textosAmpliados = await page.evaluate(() => {
    const textos = [...document.querySelectorAll('[role="heading"], [data-testid="filtro-todos"] > div, [data-testid^="mural-abrir-"] > div')];
    const tamanhos = textos.map(el => parseFloat(getComputedStyle(el).fontSize));
    textos.forEach((el, index) => el.style.setProperty('font-size', 2 * tamanhos[index] + 'px', 'important'));
    return textos.map((el, index) => parseFloat(getComputedStyle(el).fontSize) / tamanhos[index]);
  });
  assert.ok(textosAmpliados.length > 2 && textosAmpliados.every(escala => escala === 2));
  await card.waitFor();
  const reflow = await page.evaluate(() => ({
    viewport: innerWidth, documento: document.documentElement.scrollWidth,
    card: document.querySelector('[data-testid^="mural-card-"]').getBoundingClientRect().width,
  }));
  assert.ok(reflow.documento <= reflow.viewport + 1 && reflow.card <= reflow.viewport);
  evidencias.reflow = { ...reflow, escalaDoTexto: 2, escalaVisualEmulada: 2 };
  await captura('eventos-texto-ampliado');
  await writeFile(join(diretorio, 'evidencias-acessibilidade.json'), JSON.stringify(evidencias, null, 2), 'utf8');
  await logout();
  console.log('OK 13.15: viewport compacto com texto ampliado, contraste e preferência de movimento reduzido.');
}
