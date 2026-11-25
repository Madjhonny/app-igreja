import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const mensagemHidratacao = /React error #(?:418|419|421|422|423|425)\b|hydration (?:failed|mismatch|error)|a tree hydrated|while hydrating|server[- ]rendered HTML.*(?:match|recover)|during hydration/i;
const erroReactCapturado = /the above error occurred|react will try to recreate|\buncaught (?:type|reference|range)?error/i;

export function criarMonitorJavaScript() {
  const ocorrencias = [];

  return {
    acompanhar(contexto) {
      contexto.on('page', page => {
        const registrar = (origem, mensagem) => {
          ocorrencias.push({
            rota: new URL(page.url()).pathname,
            origem,
            hidratacao: mensagemHidratacao.test(mensagem),
            mensagem,
          });
        };
        page.on('pageerror', erro => registrar('pageerror', erro.message));
        page.on('console', mensagem => {
          const tipo = mensagem.type();
          if (!['error', 'warning'].includes(tipo)) return;
          const texto = mensagem.text();
          if (mensagemHidratacao.test(texto) || (tipo === 'error' && erroReactCapturado.test(texto))) {
            registrar('console.' + tipo, texto);
          }
        });
      });
    },

    async verificar(diretorio) {
      const resumo = {
        errosJavaScript: ocorrencias.filter(item => item.origem === 'pageerror' || item.origem === 'console.error').length,
        errosHidratacao: ocorrencias.filter(item => item.hidratacao).length,
        ocorrencias,
      };
      await mkdir(diretorio, { recursive: true });
      await writeFile(join(diretorio, 'erros-navegador.json'), JSON.stringify(resumo, null, 2), 'utf8');
      console.log('DIAGNÓSTICO FINAL DO NAVEGADOR:', resumo.errosJavaScript, 'erro(s) JavaScript e', resumo.errosHidratacao, 'ocorrência(s) de hidratação.');
      assert.deepEqual(ocorrencias, [], 'Erros de JavaScript ou divergências de hidratação no E2E');
    },
  };
}

const casos = [
  {
    fuso: 'America/Sao_Paulo', viewport: { width: 320, height: 568 }, serviceWorkers: 'block',
    mes: 'DEZEMBRO 2026', planejamento: 'DEZEMBRO 2026',
  },
  {
    fuso: 'Pacific/Kiritimati', viewport: { width: 1366, height: 768 }, serviceWorkers: 'allow',
    mes: 'JANEIRO 2027', planejamento: 'ANO 2027',
  },
];

export async function verificarHidratacao({ novoContexto, origin, armazenamentoMaster, diretorio }) {
  const evidencias = [];
  const instante = new Date('2027-01-01T01:00:00Z');

  for (const caso of casos) {
    const contexto = await novoContexto({
      viewport: caso.viewport, timezoneId: caso.fuso, serviceWorkers: caso.serviceWorkers,
    });

    try {
      const page = await contexto.newPage();
      await page.clock.setFixedTime(instante);
      await page.goto(origin + '/agenda');
      await page.waitForURL('**/login');
      await page.getByRole('button', { name: 'Entrar como convidado' }).click();
      await page.waitForURL('**/agenda');
      await page.getByText(caso.mes, { exact: true }).waitFor();

      // Preserva uma referência ao HTML entregue antes de liberar a hidratação.
      const entrada = '**/_expo/static/js/web/entry-*.js';
      const liberar = Promise.withResolvers();
      const entradaPedida = page.waitForRequest(entrada);
      const respostaLiberada = Promise.withResolvers();
      const reter = async route => {
        await liberar.promise;
        try {
          await route.continue();
          respostaLiberada.resolve();
        } catch (erro) {
          respostaLiberada.resolve(erro);
        }
      };
      const cabecalho = page.getByRole('heading', { name: 'Agenda', exact: true }).locator('../..');
      await page.route(entrada, reter, { times: 1 });
      let estatico;
      try {
        await page.reload({ waitUntil: 'commit' });
        await entradaPedida;
        estatico = await cabecalho.evaluate(el => {
          window.__agendaE2ECabecalho = el;
          return { icone: el.lastElementChild.textContent, html: el.outerHTML };
        });
      } finally {
        liberar.resolve();
      }
      const erroDaRota = await respostaLiberada.promise;
      if (erroDaRota) throw erroDaRota;

      assert.equal(estatico.icone, String.fromCodePoint(61910), 'Glifo calendar-outline deve sair no HTML estático');
      await page.getByText(caso.mes, { exact: true }).waitFor();
      const hidratado = await cabecalho.evaluate(el => ({
        icone: el.lastElementChild.textContent,
        mesmoNo: el === window.__agendaE2ECabecalho,
        html: el.outerHTML,
      }));
      assert.equal(hidratado.mesmoNo, true, 'React deve reutilizar o cabeçalho estático');
      assert.equal(hidratado.icone, estatico.icone);
      if (caso.serviceWorkers === 'allow') {
        await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
      } else {
        assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), false);
      }

      await page.getByLabel('Eventos', { exact: true }).click();
      await page.waitForURL('**/explore');
      await page.reload();
      await page.getByRole('heading', { name: 'Eventos', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sincronizar interesses' }).count(), 0);
      await page.goto(origin + '/gestao-datas');
      await page.waitForURL('**/agenda');
      await page.getByText(caso.mes, { exact: true }).waitFor();
      evidencias.push({ fuso: caso.fuso, viewport: caso.viewport, serviceWorker: caso.serviceWorkers,
        mes: caso.mes, antes: estatico, depois: hidratado });
    } finally {
      await contexto.close();
    }

    const contextoMaster = await novoContexto({
      viewport: caso.viewport, timezoneId: caso.fuso, serviceWorkers: caso.serviceWorkers,
      storageState: armazenamentoMaster,
    });
    try {
      const page = await contextoMaster.newPage();
      await page.clock.setFixedTime(instante);
      await page.goto(origin + '/gestao-datas');
      await page.getByText(caso.planejamento, { exact: true }).waitFor();
      await page.reload();
      await page.getByText(caso.planejamento, { exact: true }).waitFor();
      await page.goto(origin + '/agenda');
      await page.getByText(caso.mes, { exact: true }).waitFor();
      await page.getByText('Novo Evento', { exact: true }).waitFor();
    } finally {
      await contextoMaster.close();
    }
    console.log('OK 13.14: hidratação, acesso direto e recarga em ' + caso.fuso + ' (' + caso.viewport.width + ' px).');
  }

  await mkdir(diretorio, { recursive: true });
  await writeFile(join(diretorio, 'comparacao-html-hidratacao.json'), JSON.stringify(evidencias, null, 2), 'utf8');
}
