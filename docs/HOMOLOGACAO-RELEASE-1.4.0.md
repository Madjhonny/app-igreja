# Homologação consolidada do Agenda ADP 1.4.0

## Aceite do responsável

- **Perfis.** A etapa 15 contou com aprovação geral do responsável pelos perfis MASTER, ADMIN, MEMBRO, PENDENTE e CONVIDADO. Os resultados automatizados e o aceite são registros distintos. [Etapa 15](HOMOLOGACAO-PERFIS-1.4.0.md).
- **Plataformas e verificações físicas.** Na abertura da etapa 17.1, o responsável aprovou os testes da etapa 16 e autorizou o encerramento da homologação. Esse aceite é geral. O registro disponível não inclui modelo de aparelho, versão do sistema ou resultados individuais de testes físicos, TalkBack, VoiceOver, instalação móvel da PWA ou entrega real de push. [Etapa 16](HOMOLOGACAO-PLATAFORMAS-1.4.0.md).

## Escopo das evidências automatizadas

A validação da candidata reúne TypeScript, ESLint, sintaxe da API, testes de rede e lógica do frontend, integrações de interesses e notificações push com PostgreSQL 17 isolado, responsividade, acessibilidade, resiliência, hidratação, PWA e regressões dos perfis. As exportações web, Android e iOS são locais. Os cenários web exercitam Chromium, Chrome, Edge, Firefox e WebKit. A instalação e o modo standalone são verificados no Chrome automatizado. No Firefox, o teste de upload usa o `input` da aplicação com a seleção de arquivo simulada.

As integrações de push usam provedores simulados. Os testes verificam registro, associação e revogação de dispositivos, escopo, duplicidade, fila e falhas. O teste de navegação mantém o payload genérico da Agenda. A entrega real e o toque em um aparelho serão validados com autorização específica em uma build nativa. A PWA depende de conexão para consultar a Agenda, Eventos e o perfil. Quando a rede falha em uma navegação, ela mostra uma página genérica e conserva os dados privados fora do Cache Storage. Os testes de contraste, foco, semântica, teclado e movimento reduzido cobrem os cenários definidos e têm escopo de automação.

## Resultado da etapa 17.1

| Grupo | Verificações aprovadas |
| --- | ---: |
| Frontend | 141 |
| Backend, incluindo integrações reais de PostgreSQL e push simulado | 200 |
| PWA e dependências | 13 |
| Cenários de resiliência web | 3 |
| Cenários da suíte E2E da candidata | 73 |
| Migrações em schema novo e reexecução | 1 |
| Migração da base 1.3.1 com dados fictícios | 1 |
| Backup e restauração da base 1.3.1 | 1 |
| Cliente web 1.3.1 contra a API candidata | 1 |
| **Total distinto** | **434** |

As 431 verificações da suíte anterior foram repetidas e compõem o total. Na rodada final, houve zero falhas e zero testes obrigatórios ignorados. Os monitores E2E e de resiliência registraram zero erros JavaScript inesperados, zero erros de hidratação e zero ocorrências do React #418. Tipagem, lint, exportação web estática, validação do export PWA, bundles de desenvolvimento para Android e iOS e `git diff --check` também passaram. As auditorias npm do frontend e do backend retornaram zero vulnerabilidades conhecidas. Essas tarefas de validação de ferramentas ficam fora da soma de cenários distintos.

## Migração, backup e compatibilidade

- A comparação com o commit `8a17fd3` da 1.3.1 mostrou que as seis migrações anteriores e as rotas existentes da API foram preservadas. As novas rotas de interesses são aditivas. Os testes exercitam os contratos de permissões e de imagens Base64 legadas.
- Em outro cluster PostgreSQL 17 local, a base 1.3.1 recebeu dados fictícios de usuários, eventos, publicações, curtidas e comentários. O dump foi restaurado em um banco separado com histórico e contagens preservados. O executor da candidata aplicou somente `20261124_mural_interesses.sql`, verificou a chave primária, as chaves estrangeiras e o índice, e reexecutou sem reaplicar migrações ou perder o interesse de teste. Evidência em `postgres17-aecebaee490c49f290b8e40270f25283/resultado.json`.
- O cliente web exportado do arquivo Git de `8a17fd3` usou a API candidata em Chromium e PostgreSQL isolado. Login, Agenda, Mural, recarga, curtida e comentário funcionaram. O banco confirmou a curtida e o comentário e preservou o interesse prévio. O cenário registrou zero exceções JavaScript. Evidência em `cliente-131-4dd1bfeb/resultado.json`.
- O ensaio local equivalente em PostgreSQL 18 ficou pendente porque a instalação local não contém `share/postgres.bki`. Confirme a versão vinculada ao Render e repita o ensaio em ambiente isolado compatível antes da migração em produção. O ensaio do cliente 1.3.1 cobre web automatizada. A atualização de APK é uma verificação da etapa 17.7.

## Evidências e reprodução

O roteiro `scripts/validar-homologacao.ps1 -Etapa 17` grava cada rodada em `app-igreja/dist/artefatos-teste/17.1/<id>`, com logs da auditoria ou saídas separadas conforme o ambiente de execução. A rodada final usou o diretório `754752a0535c47439b8f30fd512febc9`. `e2e/erros-navegador.json`, `e2e/plataformas/resultados.json` e `resiliencia/erros-navegador.json` registram a execução no navegador. Os arquivos `bancos-antes.json` e `bancos-depois.json` documentam o estado dos bancos de testes. As 206 evidências das etapas 13.13 a 13.15 tiveram a contagem e o hash agregado reconferidos. Os artefatos posteriores também permanecem em seus diretórios originais.

Na primeira execução da etapa 17.1, a PWA instalou e abriu em standalone. A limpeza por `PWA.uninstall` falhou no Chrome headless após o cenário. O teste passou a usar um perfil temporário criado e descartado pelo Playwright. As verificações de instalação e modo standalone foram mantidas. Uma tentativa de captura do log com caminhos relativos foi interrompida pelo PowerShell, e outra com redirecionamento combinado interrompeu o comando de migração. A rodada final usou saída e erro separados, com caminhos absolutos. O schema temporário criado pela execução interrompida foi identificado pelos arquivos de estado e limpo no banco isolado. Evidência em `limpeza-transitorio.json`.

## Versionamento e consolidação da etapa 17.2

- A versão pública e os metadados npm do frontend indicam `1.4.0`. A API conserva a versão interna `1.1.0`. A configuração Android `br.com.agendaadp.app`, o identificador iOS, o scheme `appigreja`, o projeto EAS e o versionamento remoto com `autoIncrement` foram conferidos contra a base. O manifesto PWA conserva a identidade instalada e o Service Worker usa navegação pela rede sem cache versionado.
- O Expo Doctor identificou três versões fora da faixa esperada do SDK 58 na primeira execução. O lockfile passou a resolver `expo` 58.0.26, `expo-router` 58.0.32 e `expo-web-browser` 58.1.0. A reexecução do Expo Doctor aprovou os 20 critérios. A suíte ganhou uma asserção de consistência entre Expo, `package.json` e as duas entradas de versão do lockfile. [Versionamento no Expo](https://docs.expo.dev/build-reference/app-versions/) · [Verificações do Expo Doctor](https://docs.expo.dev/develop/tools/).
- Os commits locais separam sessão e interesses, interface e hidratação, compatibilidade web e PWA, push, automação e CI, documentação e versionamento. As alterações herdadas da etapa 17.1 foram incluídas por finalidade. Logs, capturas, dumps, bancos locais, caches, bundles, configurações Firebase e arquivos de ambiente ficam fora dos commits.
- A rodada final registrou **435 verificações distintas**. Foram 141 frontend, 200 backend, 14 PWA e dependências, 3 de resiliência, 73 E2E da candidata e 4 de migração, backup, restauração e uso do cliente web 1.3.1. As verificações do Expo Doctor são registradas separadamente. Houve zero falhas, testes obrigatórios ignorados, erros JavaScript inesperados, divergências de hidratação ou ocorrências do React #418. TypeScript, ESLint, exportação web estática, bundles locais Android e iOS, auditorias npm e `git diff --check` passaram. O log final está em `app-igreja/dist/artefatos-teste/17.2/validacao-final.log`.

Para consultar o SHA exato, os commits acrescentados e o estado da candidata a partir do checkout validado, use os comandos abaixo. O registro local `app-igreja/dist/artefatos-teste/17.2/candidata.json` guarda os valores da execução.

```powershell
git rev-parse HEAD
git log --reverse --oneline 9ed6f90..HEAD
git rev-list --count main..HEAD
git status --short --branch
```

[Reproduzir a homologação](HOMOLOGACAO-1.4.0.md) · [Plano de publicação e rollback](PLANO-RELEASE-1.4.0.md) · [Notas para usuários](RELEASE-1.4.0.md).
