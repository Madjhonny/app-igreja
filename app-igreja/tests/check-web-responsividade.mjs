import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const resolucoes = [
  [320, 568], [360, 800], [390, 844], [430, 932], [844, 390],
  [768, 1024], [1024, 768], [1366, 768], [1920, 1080],
];

const tituloEvento = 'Celebração de Ação de Graças e Encontro de Formação para Famílias e Lideranças das Congregações';
const tituloMural = 'Conferência de Oração e Formação para Famílias, Jovens e Lideranças de Todas as Congregações';
const descricao = 'Programação especial de oração, comunhão e formação. A recepção começa com orientações para as famílias e a programação segue com música, reflexão e atividades para todas as idades. '.repeat(4).trim();
const comentario = 'Que alegria participar da celebração com toda a congregação. '.repeat(8).trim();
const vazio = 'Você ainda não marcou nenhuma publicação com interesse.';

async function caixa(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'Elemento sem caixa: ' + locator);
  return box;
}

function dentro(a, b, mensagem, margem = 1) {
  assert.ok(a.x >= b.x - margem && a.y >= b.y - margem &&
    a.x + a.width <= b.x + b.width + margem &&
    a.y + a.height <= b.y + b.height + margem, mensagem + ' ' + JSON.stringify({ item: a, limite: b }));
}

function semSobreposicao(a, b, mensagem) {
  assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 ||
    a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1, mensagem + ' ' + JSON.stringify([a, b]));
}

async function toque(locator) {
  const box = await caixa(locator);
  assert.ok(box.width >= 43.9 && box.height >= 43.9, locator + ' abaixo de 44 × 44: ' + JSON.stringify(box));
  return box;
}

async function semRolagemHorizontal(page) {
  const problemas = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const elementos = [document.documentElement, document.body, ...document.querySelectorAll('div')];
    return elementos.filter(el => {
      return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 &&
        (el === document.body || el === document.documentElement || /^(auto|scroll)$/.test(getComputedStyle(el).overflowX)) &&
        el.getBoundingClientRect().width <= viewport + 1;
    }).map(el => ({ cliente: el.clientWidth, conteudo: el.scrollWidth, classe: el.className }));
  });
  assert.deepEqual(problemas, [], 'Rolagem horizontal inesperada');
}

async function textoInteiro(locator, limite) {
  const linhas = await locator.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].filter(r => r.width > 0).map(({ x, y, width, height }) => ({ x, y, width, height }));
  });
  assert.ok(linhas.length > 0, 'Texto sem conteúdo visível');
  for (const linha of linhas) dentro(linha, limite, 'Linha fora do card', 2);
}

export async function verificarResponsividade({ page, pool, users, congregation, postIds, origin, login, tab, logout, suspender, responder500, rotaLista, diretorioCapturas }) {
  const pasta = resolve(diretorioCapturas ?? 'dist/artefatos-teste/13.13');
  await mkdir(pasta, { recursive: true });
  const captura = nome => page.screenshot({ path: resolve(pasta, nome + '.png') });
  const botao = (nome) => page.getByRole('button', { name: nome, exact: true });
  const texto = (nome) => page.getByText(nome, { exact: true });
  const aguardarCabecalho = async nome => {
    const header = page.getByRole('heading', { name: nome, exact: true });
    await page.waitForFunction(texto => {
      return [...document.querySelectorAll('[role="heading"]')].some(el =>
        el.textContent === texto && Math.abs(el.getBoundingClientRect().left - 22) <= 1
      );
    }, nome);
    return header;
  };
  const evento = await pool.query(
    'INSERT INTO eventos(titulo,data_inicio,data_fim,horario,congregacao_id,criado_por_usuario_id) VALUES ($1,date_trunc(\'month\',CURRENT_DATE)::date+10,date_trunc(\'month\',CURRENT_DATE)::date+12,\'19:30\',$2,$3) RETURNING id',
    [tituloEvento, congregation, users.Master]
  );
  const midias = [[400, 400], [360, 600], [640, 320]];
  for (const [index, id] of postIds.entries()) {
    const imagem = await page.evaluate(([width, height]) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#E2EAE9';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#2A4B4C';
      ctx.fillRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
      ctx.fillStyle = '#F7F5EC';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(width + ' × ' + height, width / 2, height / 2);
      return canvas.toDataURL('image/png');
    }, midias[index]);
    await pool.query('UPDATE mural_eventos SET titulo=$1,descricao=$2,local=$3,midia=$4 WHERE id=$5',
      [index === 0 ? tituloMural : 'Celebração com imagem ' + (index === 1 ? 'vertical' : 'horizontal'), descricao,
        'Salão de Encontros da Congregação', imagem, id]);
  }
  await pool.query('INSERT INTO mural_comentarios(post_id,usuario_id,texto) VALUES($1,$2,$3)', [postIds[0], users.Master, comentario]);

  const slideVisivel = async id => {
    try {
      await page.waitForFunction(id => {
        const slide = document.querySelector('[data-testid="mural-slide-' + id + '"]');
        if (!slide) return false;
        const box = slide.getBoundingClientRect();
        return Math.abs(box.top) <= 1 && Math.abs(box.bottom - innerHeight) <= 1;
      }, id);
    } catch (error) {
      const slides = await page.getByTestId(/^mural-slide-/).evaluateAll(elements => elements.map(slide => {
        const { top, bottom } = slide.getBoundingClientRect();
        return { slide: slide.getAttribute('data-testid'), top, bottom };
      }));
      throw new Error('Slide esperado ' + id + ' em ' + JSON.stringify(page.viewportSize()) + ': ' + JSON.stringify(slides), { cause: error });
    }
  };
  const imagemFullscreen = (id, [iw, ih]) => page.waitForFunction(({ id, iw, ih }) => {
    const imagem = document.querySelector('[data-testid="mural-slide-' + id + '"] img');
    return imagem?.naturalWidth === iw && imagem.naturalHeight === ih && getComputedStyle(imagem).objectFit === 'contain';
  }, { id, iw, ih });

  await login('Master');
  for (const [width, height] of resolucoes) {
    const nome = width + 'x' + height;
    const viewport = { x: 0, y: 0, width, height };
    const capturarDetalhes = [320, 844, 1366].includes(width);
    await page.setViewportSize({ width, height });
    await tab('Agenda');
    const cabAgenda = await aguardarCabecalho('Agenda');
    const cabA = await caixa(cabAgenda);
    dentro(cabA, viewport, 'Cabeçalho da Agenda');
    assert.equal(await cabAgenda.locator('../..').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(42, 75, 76)');
    const calendario = page.getByTestId('agenda-calendario');
    await calendario.waitFor();
    await calendario.evaluate(el => {
      for (let pai = el.parentElement; pai; pai = pai.parentElement) pai.scrollTop = 0;
    });
    const filtroAgenda = await caixa(texto('Filtrar por congregação'));
    dentro(filtroAgenda, viewport, 'Filtro da Agenda fora da tela');
    assert.ok(filtroAgenda.y >= cabA.y + cabA.height, 'Cabeçalho sobre o filtro da Agenda');
    await semRolagemHorizontal(page);
    await captura(nome + '-agenda');
    const dias = page.getByTestId('agenda-dias-semana');
    const nomesDias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const centros = await Promise.all(nomesDias.map(async dia => {
      const box = await caixa(dias.getByText(dia, { exact: true }));
      return box.x + box.width / 2;
    }));
    const grade = await caixa(dias);
    const diasCalendario = await calendario.getByTestId('agenda-dia').evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect();
      return r.x + r.width / 2;
    }));
    centros.forEach((centro, index) => {
      assert.ok(Math.abs(centro - (grade.x + grade.width * (index + 0.5) / 7)) <= 1, nome + ' coluna irregular');
      assert.ok(diasCalendario.some(pos => Math.abs(pos - centro) <= 1), nome + ' dia desalinhado');
    });
    await toque(page.getByLabel('Mês anterior', { exact: true }));
    await toque(page.getByLabel('Próximo mês', { exact: true }));
    const cardEvento = page.getByTestId('agenda-evento-' + evento.rows[0].id);
    await cardEvento.scrollIntoViewIfNeeded();
    const caixaEvento = await caixa(cardEvento);
    await textoInteiro(cardEvento.getByText(tituloEvento, { exact: true }), caixaEvento);
    await textoInteiro(cardEvento.getByText('Sede E2E', { exact: true }), caixaEvento);
    if (capturarDetalhes) await cardEvento.screenshot({ path: resolve(pasta, nome + '-agenda-card.png') });

    await tab('Eventos');
    const cabE = await caixa(await aguardarCabecalho('Eventos'));
    dentro(cabE, viewport, 'Cabeçalho de Eventos');
    await botao('Sincronizar interesses').waitFor();
    const controles = await Promise.all([
      texto('Todos').locator('..'), texto('Minha congregação').locator('..'),
      botao('Filtrar meus interesses'), botao('Nova publicação'), botao('Sincronizar interesses'),
    ].map(toque));
    for (const [index, a] of controles.entries()) {
      dentro(a, viewport, 'Filtro ou ação fora da tela');
      for (const b of controles.slice(index + 1)) semSobreposicao(a, b, 'Filtros ou ações sobrepostos');
    }
    await texto('Minha congregação').click();
    await page.getByTestId('mural-card-' + postIds[2]).waitFor({ state: 'hidden' });
    await botao('Filtrar meus interesses').click();
    await texto(vazio).waitFor();
    await texto('Todos').click();
    await semRolagemHorizontal(page);
    for (const [index, id] of postIds.entries()) {
      const card = page.getByTestId('mural-card-' + id);
      const imagem = page.getByTestId('mural-imagem-' + id);
      const [iw, ih] = midias[index];
      await page.waitForFunction(({ id, iw, ih }) => {
        const bloco = document.querySelector('[data-testid="mural-imagem-' + id + '"]');
        const img = bloco?.querySelector('img');
        return img?.naturalWidth === iw && img.naturalHeight === ih && Math.abs(bloco.clientWidth / (iw / ih) - bloco.clientHeight) < 2;
      }, { id, iw, ih });
      const box = await caixa(card);
      const foto = await caixa(imagem);
      assert.ok(Math.abs(box.x + box.width / 2 - width / 2) <= 2 && box.width <= 640.5, nome + ' card fora do centro');
      dentro(foto, box, 'Imagem fora do card');
      const marcador = await toque(card.getByTestId('interesse-feed-' + id));
      dentro(marcador, box, 'Marcador fora do card');
      assert.ok(marcador.x > box.x + box.width / 2, 'Marcador fora da lateral direita');
      await textoInteiro(card.getByText(descricao, { exact: true }), box);
      await textoInteiro(card.getByText(index === 0 ? tituloMural : 'Celebração com imagem ' + (index === 1 ? 'vertical' : 'horizontal'), { exact: true }), box);
    }
    await captura(nome + '-eventos');
    if (width === 390) {
      for (const [index, id] of postIds.entries()) {
        await page.getByTestId('mural-imagem-' + id).screenshot({ path: resolve(pasta, nome + '-imagem-' + (index + 1) + '.png') });
      }
    }

    const primeiro = page.getByTestId('mural-card-' + postIds[0]);
    await page.getByTestId('mural-card-' + postIds[2]).getByRole('button', { name: 'Opções da publicação' }).waitFor();
    await primeiro.getByRole('button', { name: 'Opções da publicação' }).click();
    const menu = page.getByTestId('mural-menu-publicacao');
    await menu.waitFor();
    dentro(await caixa(menu), viewport, 'Menu cortado');
    for (const nomeAcao of ['Excluir publicação', 'Cancelar']) {
      dentro(await toque(menu.getByRole('button', { name: nomeAcao })), await caixa(menu), nomeAcao + ' fora do menu');
    }
    if (capturarDetalhes) await captura(nome + '-menu');
    await menu.getByRole('button', { name: 'Cancelar' }).click();
    await menu.waitFor({ state: 'hidden' });
    await primeiro.getByRole('button', { name: 'Ampliar publicação: ' + tituloMural }).click();
    await page.getByLabel('Eventos', { exact: true }).waitFor({ state: 'hidden' });
    await slideVisivel(postIds[0]);
    await imagemFullscreen(postIds[0], midias[0]);
    const slide = page.getByTestId('mural-slide-' + postIds[0]);
    const legenda = await caixa(slide.getByTestId('mural-legenda-fullscreen'));
    dentro(legenda, viewport, 'Legenda fora da tela');
    const acoes = [
      slide.getByTestId('voltar-fullscreen'),
      slide.getByRole('button', { name: 'Curtir publicação', exact: true }),
      slide.getByRole('button', { name: 'Ver comentários', exact: true }),
      slide.getByTestId('interesse-fullscreen-' + postIds[0]),
    ];
    const areas = await Promise.all(acoes.map(toque));
    for (const [i, area] of areas.entries()) {
      dentro(area, viewport, 'Ação fullscreen fora da tela');
      semSobreposicao(area, legenda, 'Legenda sobre controles');
      for (const outra of areas.slice(i + 1)) semSobreposicao(area, outra, 'Ações fullscreen sobrepostas');
      const icone = await acoes[i].evaluate(el => parseFloat(getComputedStyle(el.firstElementChild).fontSize));
      assert.equal(icone, i === 0 ? 26 : 24, 'Tamanho visual do ícone');
    }
    await captura(nome + '-fullscreen');
    await acoes[2].click();
    const modal = page.getByRole('dialog').getByTestId('mural-modal-comentarios');
    await modal.getByText(comentario, { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const painel = document.querySelector('[data-testid="mural-modal-comentarios"]');
      if (!painel || Math.abs(painel.getBoundingClientRect().bottom - innerHeight) > 1) return false;
      for (let el = painel; el; el = el.parentElement) {
        if (el.getAnimations().some(animacao => animacao.playState === 'running')) return false;
      }
      return true;
    });
    const fechar = modal.getByRole('button', { name: 'Fechar comentários' });
    const box = await caixa(modal);
    dentro(box, viewport, 'Modal de comentários cortado');
    dentro(await toque(fechar), box, 'Fechar fora do modal');
    dentro(await toque(modal.getByRole('button', { name: 'Enviar comentário' })), box, 'Enviar fora do modal');
    const campo = modal.getByPlaceholder('Escreva um comentário...');
    const composicao = await campo.evaluate(el => {
      const painel = el.closest('[data-testid="mural-modal-comentarios"]');
      const retangulo = elemento => {
        const { x, y, width, height } = elemento.getBoundingClientRect();
        return { x, y, width, height };
      };
      return { campo: retangulo(el), painel: retangulo(painel) };
    });
    dentro(composicao.painel, viewport, 'Painel do campo fora da tela');
    dentro(composicao.campo, composicao.painel, 'Campo fora do modal');
    if (capturarDetalhes) await captura(nome + '-comentarios');
    if (width === 844) {
      await modal.getByRole('button', { name: 'Excluir comentário de Master' }).click();
      await modal.getByText('Excluir este comentário?', { exact: true }).waitFor();
      const trecho = await modal.getByText(comentario, { exact: true }).evaluate(el => {
        const estilo = getComputedStyle(el);
        return { altura: el.clientHeight, linha: parseFloat(estilo.lineHeight) };
      });
      assert.ok(trecho.altura <= 3 * trecho.linha, 'O trecho de confirmação deixa uma quarta linha cortada');
      const cancelar = modal.getByRole('button', { name: 'Cancelar', exact: true });
      await cancelar.scrollIntoViewIfNeeded();
      dentro(await toque(cancelar), await caixa(modal), 'Cancelar exclusão fora do painel');
      dentro(await toque(modal.getByRole('button', { name: 'Excluir', exact: true })), await caixa(modal), 'Confirmação fora do painel');
      await captura(nome + '-confirmacao-comentario');
      await cancelar.click();
      await modal.getByText(comentario, { exact: true }).waitFor();
    }
    await fechar.click();
    await modal.waitFor({ state: 'hidden' });
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, height);
    await slideVisivel(postIds[2]);
    await imagemFullscreen(postIds[2], midias[2]);
    let ultimoSlide = postIds[2];
    if ([390, 844].includes(width)) {
      await page.mouse.wheel(0, height);
      await slideVisivel(postIds[1]);
      await imagemFullscreen(postIds[1], midias[1]);
      ultimoSlide = postIds[1];
    }
    await page.getByTestId('mural-slide-' + ultimoSlide).getByTestId('voltar-fullscreen').click();
    await page.getByRole('heading', { name: 'Eventos', exact: true }).waitFor();
    await page.getByLabel('Eventos', { exact: true }).waitFor({ state: 'visible' });
    console.log('OK 13.13: ' + nome + ' Agenda, mural e fullscreen.');
  }
  await logout();

  await page.setViewportSize({ width: 320, height: 568 });
  await login('Admin');
  const proximoMes = page.getByLabel('Próximo mês', { exact: true });
  const falhaAgenda = await suspender('http://localhost:3000/eventos?*', 'GET', route => route.fulfill({
    status: 500, json: {}, headers: { 'access-control-allow-origin': origin },
  }));
  await proximoMes.click();
  await falhaAgenda.recebida();
  const progressoAgenda = page.getByLabel('Carregando atividades do mês');
  await progressoAgenda.scrollIntoViewIfNeeded();
  await captura('320x568-agenda-carregando');
  await falhaAgenda.concluir();
  const erroAgenda = texto('Não foi possível carregar a agenda.');
  await erroAgenda.scrollIntoViewIfNeeded();
  await captura('320x568-agenda-erro');
  await texto('Tentar novamente').click();
  await texto('Nenhum evento cadastrado neste mês.').scrollIntoViewIfNeeded();
  await captura('320x568-agenda-vazia');
  await page.getByLabel('Mês anterior', { exact: true }).click();
  await texto(tituloEvento).waitFor();
  console.log('OK 13.13: Agenda em carregamento, erro, recuperação e mês vazio.');

  const falhaInicial = await suspender(rotaLista, 'GET', responder500);
  await tab('Eventos');
  await falhaInicial.recebida();
  await botao('Filtrar meus interesses').click();
  await texto('Carregando seus interesses...').waitFor();
  await captura('320x568-interesses-carregando');
  await falhaInicial.concluir();
  await texto('Não foi possível carregar seus interesses.').waitFor();
  const limiteCompacto = { x: 0, y: 0, width: 320, height: (await caixa(page.getByLabel('Eventos', { exact: true }))).y };
  dentro(await caixa(botao('Atualizar publicações')), limiteCompacto, 'Ação de recuperação atrás da barra de abas');
  await captura('320x568-interesses-erro');
  await botao('Atualizar interesses').click();
  await page.getByTestId('mural-card-' + postIds[0]).waitFor();
  await texto('Todos').click();
  await page.getByTestId('mural-card-' + postIds[0]).getByRole('button', { name: 'Opções da publicação' }).waitFor();
  assert.equal(await page.getByTestId('mural-card-' + postIds[2]).getByRole('button', { name: 'Opções da publicação' }).count(), 0);
  await logout();

  await pool.query("UPDATE usuarios SET status_conta='APROVADO' WHERE id=$1", [users.Membro]);
  for (const perfil of ['Membro', 'Pendente', 'Convidado']) {
    if (perfil === 'Convidado') {
      await page.goto(origin + '/login');
      await botao('Entrar como convidado').click();
      await page.waitForURL('**/agenda');
    } else {
      await login(perfil);
    }
    await tab('Eventos');
    await page.getByTestId('mural-card-' + postIds[0]).waitFor();
    assert.equal(await botao('Nova publicação').count(), 0);
    assert.equal(await botao('Opções da publicação').count(), 0);
    if (perfil === 'Membro') {
      await botao('Sincronizar interesses').waitFor();
      await page.getByTestId('interesse-feed-' + postIds[0]).waitFor();
      await pool.query('DELETE FROM mural_interesses WHERE usuario_id=$1', [users.Membro]);
      await botao('Sincronizar interesses').click();
      await botao('Filtrar meus interesses').click();
      await texto(vazio).waitFor();
      await captura('320x568-interesses-vazio');
    } else {
      assert.equal(await botao('Sincronizar interesses').count(), 0);
      assert.equal(await botao('Filtrar meus interesses').count(), 0);
      assert.equal(await page.getByTestId('interesse-feed-' + postIds[0]).count(), 0);
    }
    await semRolagemHorizontal(page);
    if (perfil !== 'Convidado') await logout();
  }
  console.log('OK 13.13: estados de interesses, acentuação e permissões dos cinco perfis.');
}
