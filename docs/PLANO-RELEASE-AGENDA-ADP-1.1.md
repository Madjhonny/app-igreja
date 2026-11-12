# Agenda ADP 1.1 — Candidata de demonstração e plano de implantação

Data de preparação: 12/11/2026. **Status: migração 003 autorizada e aplicada em produção; deploy, merge, alterações de segredos e distribuição continuam sem autorização.**

## Estratégia de integração

A branch `release/agenda-adp-1.1-candidata` parte do código final de `feat/mural-imagens-sob-demanda-11`. Ela contém cumulativamente as mudanças dos PRs #3 a #10, sem exigir a publicação intermediária de cada PR.

Abrir um PR **rascunho** desta branch para `main` permite revisar todo o resultado agregado e executar CI. Não mesclar PRs isolados em `main` antes da autorização do plano de implantação, especialmente por causa da migração de senha.

### Entregas incluídas

| PR | Entrega | Resultado funcional informado |
| --- | --- | --- |
| #3 | Atualização localizada em Gestão de Datas | Homologada |
| #4 | Confirmação e validação de conflitos | Validada em cenários principais; rever permissões e conflitos excepcionais em regressão final |
| #5 | Correções de diálogos, criação e exclusão de eventos | Alterações aplicadas; repetir smoke test de regressão |
| #6 | Exclusão de comentários com autorização | Testada nos fluxos principais; checar ADMIN entre congregações |
| #7 | Alteração e recuperação de senha | Web/Android e códigos inválido, expirado, reutilizado testados |
| #8 | Filtro por congregação | Homologado Web/Android |
| #9 | Títulos centralizados e transições de abas | Homologado Web/Android |
| #10 | Imagens do mural sob demanda | Homologado Web/Android; medição de banda e rede lenta a avaliar |

A homologação funcional foi relatada pelo usuário em diferentes rodadas; não substitui regressão integrada em ambiente de demonstração.

## Estado do banco — última conferência (12/11/2026)

- Projeto Neon `agenda-igreja`; banco `neondb`.
- Branch `production`: migrations `001_initial_schema.sql`, `002_legacy_reconciliation.sql` e **`003_password_recovery.sql` aplicada com autorização do usuário**; `usuarios.token_version` e `senha_recuperacoes` verificados após a execução.
- Branch `homologacao-senhas-1-1`: também tem `003_password_recovery.sql`; fluxos de senha testados.
- **Migração `003_password_recovery.sql` aplicada à produção, após snapshot manual e autorização específica**. A nova API já tem os objetos de esquema necessários, mas ainda não foi publicada.
- Não executar `npm run db:migrate` contra `production` sem conferir destino e receber autorização.

## Domínio e e-mail para demonstração

A API já suporta `RESEND_API_KEY` e `EMAIL_FROM`.

- Sem domínio próprio, usar exclusivamente o remetente de testes `Agenda ADP <onboarding@resend.dev>` para envio **ao endereço autorizado da conta Resend**. Isso atende à demonstração interna de recuperação, não a pessoas com e-mails arbitrários.
- Não configurar o remetente de testes como se servisse a todos os usuários; para endereços não autorizados a entrega pode ser recusada, mesmo que a API retorne resposta genérica por privacidade.
- Para lançamento público, verificar domínio próprio no Resend, configurar autenticação DNS solicitada pelo provedor e alterar `EMAIL_FROM` no backend. Não requer reescrever o fluxo de senha.
- API key somente no backend/Render; nunca no Expo, GitHub, documento, comando público, captura de tela ou logs.
- Se não for demonstrar a recuperação, deixar Resend desconfigurado gera resposta de indisponibilidade (503); documentar essa limitação na demonstração.
- O endpoint de cadastro na API é público e a aplicação pode estar acessível mesmo sem divulgação. Não presumir que ausência de usuários signifique acesso privado.

## Checklist antes de qualquer deploy

- [ ] Confirmar que a revisão do PR consolidado e CI estão verdes no commit candidato.
- [ ] Verificar `npm ci`, `npm test`, `npm run check`, `npm run lint`, TypeScript, export Web.
- [ ] Fazer smoke test completo Web/Android: cadastro, login, convite/pedente, aprovação de conta, perfis MASTER/ADMIN/MEMBRO.
- [ ] Testar agenda: criação, edição e exclusão, filtros, rolagem entre meses; Gestão de Datas/publicação e conflitos, inclusive autorização MASTER.
- [ ] Testar Eventos: criar post de teste, feed, fullscreen, carrossel vertical, imagem, comentários e curtidas, exclusão de comentário e post.
- [ ] Testar senha: alterar, recuperar via e-mail autorizado, login com senha nova, senha antiga e código reaproveitado rejeitados.
- [x] Revisar serviço Render, branch, auto-deploy, start/build commands e deploy atualmente ativo (somente leitura). Variáveis de ambiente continuam pendentes de conferência manual segura, sem divulgar valores.
- [ ] Confirmar qual API está embutida na build Web/Android (`EXPO_PUBLIC_API_URL`); builds de demonstração devem apontar ao backend planejado.
- [x] Criado e verificado snapshot manual da `production` no Neon: `agenda-adp-1-1-pre-migracao-003`, ID `snap-long-truth-b6gxqftq`, criado em `2026-11-12T02:24:52Z`. Antes da migração, conferir novamente o snapshot e o caminho de restauração; nenhuma restauração foi testada.
- [x] Migration `003` aplicada **somente** na branch `production` após autorização explícita; confirmados coluna `token_version DEFAULT 0`, tabela, índice e registro na `schema_migrations`.
- [ ] Verificar segredos (sem expor valores): `JWT_SECRET`, `DB_*`, `DB_SSL`, `CORS_ORIGINS`; durante demo interna considerar Resend teste limitado.
- [ ] Conferir início do servidor, login e GET /mural em produção após deploy da API; aplicar smoke test com contas estritamente de teste.
- [ ] Implantar versão Web e gerar nova build Android quando o backend estiver pronto, sem distribuição pública antes da autorização.
- [ ] Confirmar versões `app.json`, distribuição e estratégia de rollback antes do anúncio.

## Revisão Render confirmada em 12/11/2026 (somente leitura)

- Workspace autorizado: `My Workspace`.
- Serviço: `app-igreja`, ID `srv-dboiqge417fc738d4d5g`, URL `https://app-igreja-eks0.onrender.com`.
- Repositório: `https://github.com/Madjhonny/app-igreja`.
- Branch vinculada: `main`; **auto-deploy ativado ao receber commits**. Mergir o PR de release em `main` pode acionar imediatamente nova implantação da API.
- Diretório raiz do serviço: `api-igreja/`; build `npm install`, start `npm start`.
- Serviço Node, plano Free, região Virginia, uma instância; previews de PR desativadas e sem health check configurado.
- Deploy ativo antes da versão 1.1: commit `444970e13469883eb4b34db5ae149c9b26859c05` da `main`, status `live`.
- **Controle obrigatório:** migração `003` já aplicada e verificada; **NÃO fazer merge do PR #11 nem deploy da API sem autorização específica**, pois o auto-deploy ao receber commits na `main` continua ativo. A conferência de configuração/segredos e smoke tests ainda são necessários.
- Credenciais e variáveis do serviço **não foram lidas nem alteradas** nesta verificação; em especial conferir `DB_*`, `JWT_SECRET`, `CORS_ORIGINS`, e remetente de e-mail de demonstração em canal privado.
- Nenhum deploy, reinício, mudança de serviço ou banco foi realizado.

## Snapshot de segurança pré-migração — confirmado

- Projeto Neon: `empty-brook-40220663` (`agenda-igreja`).
- Branch de origem: `production` (ID `br-still-grass-b6wfls3v`).
- Snapshot: `agenda-adp-1-1-pre-migracao-003` (ID `snap-long-truth-b6gxqftq`).
- Criação (UTC): `2026-11-12T02:24:52Z` — manual, verificado por listagem de snapshots.
- Esta captura não executou migração, deploy, mudança de credenciais nem substituiu dados da produção.
- **Antes de migrar:** conferir novamente existência e prazo de retenção do snapshot; preparar procedimento de restauração, sem restaurar sobre `production` automaticamente. Preferir testar restauração numa branch isolada caso autorizado.

## Conferência segura das variáveis Render — etapa atual

O conector Render disponível nesta revisão permite consultar serviço e deploy, mas **não ler os valores de Environment Variables**. A conferência final é manual, no dashboard do serviço **app-igreja → Environment**. **Não editar, salvar ou revelar os valores.**

### Comparação de `DB_HOST` (dados não secretos do Neon)

- Host da branch Neon `production`: `ep-odd-cloud-b6vjrv0e.c-2.sa-east-1.aws.neon.tech`
- Host da branch Neon `homologacao-senhas-1-1`: `ep-solitary-sunset-b6xgs4o4.c-2.sa-east-1.aws.neon.tech`
- Hosts opcionais com `-pooler` antes de `.c-2.` são variações do mesmo endpoint; conferir a identidade do prefixo `ep-odd-cloud-b6vjrv0e` para produção.
- Estado do Neon `production`: `001`, `002` e `003` **após aplicação autorizada**; coluna e tabela presentes.
- Snapshot manual `snap-long-truth-b6gxqftq` verificado como existente na lista. O retorno não apresentou data de expiração; isso **não comprova retenção ilimitada**.

### Variáveis a conferir no Render (somente valores de presença ou configuração, sem segredos)

- [x] `DB_HOST`: usuário mostrou no painel Render que corresponde ao host de **production** acima; sem divulgar credenciais.
- [x] `DB_NAME`: `neondb`, `DB_SSL`: `true` confirmados visualmente e **`DB_PORT=5432` confirmado pelo usuário**.
- [x] `DB_USER` e `DB_PASSWORD`: ambas aparecem configuradas com valores protegidos; sem conferir conteúdo.
- [x] `JWT_SECRET`: presença confirmada, valor preservado. Modificá-lo desconectaria sessões.
- [ ] `CORS_ORIGINS`: presença confirmada; ainda conferir localmente os domínios Web previstos, sem divulgar configurações sensíveis.
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`: não aparecem na lista de variáveis exibida no painel Render. Verificar existência de grupo de ambiente vinculado; se ausentes, recuperação de senha no Render ficará indisponível, embora esteja funcional localmente. Para demonstração sem domínio, usar remetente de testes apenas com e-mail autorizado.
- [ ] Verificar se existe `DATABASE_URL` ou variável duplicada de conexão e, caso exista, confirmar se é efetivamente usada; o `server.js` atual usa `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `DB_SSL`.
- [ ] Verificar se há variáveis em *Environment Groups* vinculados que possam colidir com as do serviço.
- [ ] **Não clicar em Save/Deploy** nessa etapa. A documentação Render esclarece que salvar alterações pode iniciar deploy ou afetar um deploy futuro.

**Limite da validação:** a identidade da conexão em execução no Render só estará confirmada após essa verificação manual, não apenas pela leitura do host no Neon.

### Verificação de painel recebida do usuário (12/11/2026)

- Captura do ambiente **Environment** do Render confirmou: host de `production` do Neon, banco `neondb`, SSL habilitado e presença das variáveis principais. O usuário confirmou posteriormente `DB_PORT=5432`. Valores sensíveis permanecem ocultos; nenhuma captura de segredo foi armazenada no repositório.
- Após essa inspeção, houve **autorização explícita e aplicação somente da migração `003` no Neon production**. Não houve alteração de configuração Render, deploy ou merge.

## Execução autorizada — migration 003 em production

- Autorização do usuário: aplicar somente `003_password_recovery.sql` na branch `production` após confirmação de `DB_PORT=5432`, sem atualizar Render/app.
- Pré-verificações: snapshot manual `snap-long-truth-b6gxqftq` presente; banco `neondb` com migrations `001` e `002`; coluna `token_version` e tabela de recuperação ausentes.
- Executada em transação única: `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`; `CREATE TABLE IF NOT EXISTS senha_recuperacoes` (conforme `migrations/003_password_recovery.sql`); `CREATE INDEX IF NOT EXISTS senha_recuperacoes_expira_idx`; registro `003_password_recovery.sql` em `schema_migrations`.
- Pós-verificação: `001`, `002`, `003` presentes; coluna com valor padrão 0, tabela e índice presentes; **6 usuários** com `token_version=0`; **0** entradas em `senha_recuperacoes`.
- Snapshot pré-migração preservado; restauração não executada.
- **Não houve** deploy, atualização do Render, merge de PR, alteração de variáveis ou distribuição de APK. Permanece necessária autorização específica para cada uma dessas ações.

## Sequência proposta para implantação futura (não executada)

1. Congelar commit de release e conferir logs/CI.
2. Confirmar backup do banco e parâmetros do serviço Render; planejar janela controlada.
3. Aplicar somente a migração requerida, verificando depois a coluna e a tabela.
4. Publicar API compatível com a migração (rotas existentes mantidas).
5. Executar smoke tests da API e do cliente Web.
6. Publicar Web e/ou criar APK de demonstração; verificar `EXPO_PUBLIC_API_URL` correto.
7. Validar testes finais e acompanhar logs por erros.
8. Em falha: interromper distribuição, fazer rollback da API/app compatível; **não reverter automaticamente a migration**. A coluna nova e a tabela são aditivas e podem permanecer até decisão deliberada.

## Pendências para anúncio oficial

- Domínio verificado para e-mail transacional a contas externas.
- Revisão de segurança, proteção de cadastro, privacidade e autorizações em ambiente publicamente acessível.
- Monitoramento, backup rotineiro, limites e custos de Neon/Render/Resend.
- Decidir política de distribuição Android e publicação de nova versão.
- Otimização adicional de mídia por armazenamento de objetos e medição de consumo, se os volumes justificarem.

**Nota:** nenhuma ação deste documento foi executada em produção por sua criação.
