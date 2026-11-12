# Agenda ADP 1.1 — Candidata de demonstração e plano de implantação

Data de preparação: 12/11/2026. **Status: somente planejamento e verificação. Não executar deploy, merge, migração ou alterações de segredos sem autorização expressa.**

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
- Branch `production`: migrations `001_initial_schema.sql`, `002_legacy_reconciliation.sql`; não tem `usuarios.token_version` ou `senha_recuperacoes`.
- Branch `homologacao-senhas-1-1`: também tem `003_password_recovery.sql`; fluxos de senha testados.
- **É obrigatório aplicar `003_password_recovery.sql` à produção ANTES de iniciar a nova API**. A mudança adiciona coluna com `DEFAULT 0` e tabela de recuperação; fazer backup/snapshot antes da alteração.
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
- [ ] Fazer backup/snapshot verificável da `production` no Neon e registrar plano de recuperação.
- [ ] Antes do deploy da API: aplicar migration `003` **na branch de produção**, somente após autorização e conferir aplicação.
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
- **Controle obrigatório:** NÃO fazer merge do PR #11 antes da migração `003` na branch `production` do Neon, com backup e autorização explícita. Avaliar desativar o auto-deploy enquanto o plano é executado, ou programar a migração antes de efetuar o merge.
- Credenciais e variáveis do serviço **não foram lidas nem alteradas** nesta verificação; em especial conferir `DB_*`, `JWT_SECRET`, `CORS_ORIGINS`, e remetente de e-mail de demonstração em canal privado.
- Nenhum deploy, reinício, mudança de serviço ou banco foi realizado.

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
