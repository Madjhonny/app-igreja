# Roteiro de evolução — Agenda ADP 1.1

Última revisão: 11/11/2026. A versão de produção não deve ser atualizada antes da homologação.

## Escopo confirmado

O Agenda ADP organiza **eventos únicos**, com duração de um ou mais dias, e oferece agenda, gestão de usuários e mural de comunicação entre congregações.

### P0 — Corrigir antes de qualquer nova publicação

| Entrega | Critério de aceite | Estado |
| --- | --- | --- |
| Criar eventos na Web | Após salvar com sucesso, exibir diálogo visual do app e retornar à agenda | Implementada nesta branch; homologação pendente |
| Excluir eventos na Web | Diálogo de confirmação próprio, exclusão na API, atualização da agenda | Implementada nesta branch; homologação pendente |
| Exclusão pela lista de eventos (Web e Android) | Confirmação dentro do próprio modal de detalhes, sem sobreposição; cancelar preserva evento; sucesso atualiza sem recarga global | Corrigida nesta branch; homologação pendente |
| Não recarregar a Gestão de Datas ao alterar registros | Criar, excluir, alterar marcador e publicar sem loading geral | Implementada na branch da etapa 1; homologada pelo usuário |
| Conferir conflitos antes da publicação | API revalida contra publicados e dentro do lote, com rollback em erro | Implementada na etapa 2; avisos homologados pelo usuário |
| Confirmação excepcional do MASTER | Exibir rascunhos e horários em conflito; confirmar apenas por decisão explícita | API e interface implementadas; homologação pendente |
| Testes das operações críticas | Testes automatizados aprovados e testes Web/Android sem regressões | API automatizada aprovada; validação visual pendente |

### P1 — Alta prioridade, após homologar os P0

| Entrega | Critério de aceite | Estado |
| --- | --- | --- |
| Diálogos consistentes | Substituir pop-ups do navegador e alertas nativos por componentes internos em todas as telas | Implementada nesta branch; homologação pendente |
| Exclusão de comentários | Autor exclui seu comentário; ADMIN e MASTER excluem qualquer comentário; pendente não exclui | Implementada no PR #6; homologação Web/Android pendente |
| Recuperação e alteração de senha | Código por e-mail de uso único, revogação de sessões e senha atual obrigatória | Implementada no PR #7; migração e homologação pendentes |
| Filtro por congregação na agenda | Selecionar uma congregação ou todas; filtrar atividades e marcações do calendário, preservando navegação de meses | **Homologada pelo usuário na Web e Android** (PR #8) |
| Padronização dos cabeçalhos | Aba Agenda com título `Agenda`; aba Eventos com título `Eventos`, ambos centralizados, sem ocultar ação de nova postagem | Em implementação no PR #9 |
| Transições entre as abas principais | Agenda ↔ Eventos ↔ Perfil com deslizamento horizontal bidirecional, barra inferior com indicador e ícones animados em sincronia, preservando navegação e estilos | Em implementação no PR #9 |
| Otimização e armazenamento de imagens | Reduzir payload do mural e preservar desempenho | Planejada |
| Refatoração modular | Separar responsabilidades de telas extensas e rotas da API sem mudar comportamento | Planejada |

### P2 — Versões seguintes

- Suporte a **vídeos curtos no mural**, depois de preparar o armazenamento de mídia.
- Notificações push relevantes, com preferências de recebimento.

### P3 — Opcional

- Confirmação de presença em eventos, somente após demanda comprovada das congregações.

### Fora de escopo (descartado)

- Eventos recorrentes.
- Exportação para Google Calendar e integração com calendário do celular.
- Histórico dos eventos realizados.
- Painéis de indicadores de participantes e atividades por congregação.

## Homologação da correção Web e dos diálogos

1. **Web**: criar evento, confirmar sucesso, voltar à agenda e visualizar registro.
2. **Web**: excluir o mesmo evento pela tela da agenda, confirmando e depois cancelando a exclusão em tentativa separada.
3. **Android**: repetir o fluxo de criação, edição e exclusão.
4. **Web e Android**: testar sair da conta, excluir post do mural e mensagens de cadastro/perfil; observar diálogos com a identidade visual do app.
5. **Gestão de Datas**: criar dois rascunhos com horários sobrepostos e tentar publicar.
6. **Aviso detalhado**: confirmar que o diálogo mostra congregação, datas, horários e nome de ambos os eventos.
7. **Cancelar**: nenhum rascunho deve ser publicado.
8. **Confirmar exceção (MASTER)**: todos os rascunhos são publicados, com atualização visual sem recarga global.
9. **ADMIN**: criação/edição direta em conflito deve ser impedida sem autorização excepcional.
10. **Regressão**: executar CI (lint, TypeScript, exportação Web e testes da API) e verificar Android antes de qualquer merge.

## Controle de branches

- Etapa 1: `feat/gestao-datas-atualizacao-sem-recarga` (PR #3).
- Etapa 2: `feat/validacao-conflitos-publicacao` (PR #4, dependente da etapa 1).
- Etapa 3: `fix/dialogos-web-e-conflitos-11` (depende da etapa 2).

Não realizar merge diretamente na `main` antes de fechar a homologação dos P0.

## Homologação — comentários do mural (P1)

1. **MEMBRO aprovado**: publicar um comentário próprio, excluir e verificar remoção imediata; o botão não deve aparecer nos comentários dos outros membros.
2. **ADMIN**: excluir um comentário de teste de outra congregação, confirmando que o servidor autoriza moderação global.
3. **MASTER**: excluir um comentário de teste de qualquer publicação.
4. **Convidado pendente**: visualizar comentários, sem acesso ao botão excluir.
5. **Cancelar**: tocar em excluir e cancelar; o comentário deve permanecer.
6. **Resposta encadeada**: excluir um comentário que contém respostas; a árvore descendente deve desaparecer e o banco deve removê-la por cascata.
7. **Falha de API**: interromper temporariamente a API local e excluir um comentário; a UI deve restaurá-lo e exibir erro.
8. **Interfaces**: validar feed normal e modo tela cheia no navegador e no Android, sem modal sobreposto nem recarregamento global.

### Branch de comentários

- Etapa 4: `feat/exclusao-comentarios-mural-11` (PR #6, baseado na etapa 3).


## Homologação — Segurança das senhas (P1)

1. Aplicar `003_password_recovery.sql` **somente em banco verificado**, após backup. O PR não executa migração automaticamente.
2. Em Dados e Segurança, alterar senha informando a senha atual correta, confirmar que todas as sessões são revogadas e que a nova senha permite login.
3. Tentar senha atual incorreta e senha fraca: o servidor deve rejeitar sem modificar a conta.
4. Configurar `RESEND_API_KEY` e `EMAIL_FROM` no backend, sem divulgar essas credenciais.
5. No login, solicitar código usando e-mail cadastrado; verificar recebimento no endereço correto.
6. Testar código errado, expirado, repetido e múltiplas tentativas. Nenhum deles pode redefinir a senha.
7. Com código válido, redefinir a senha, confirmar invalidação das sessões e fazer novo login.
8. Testar um e-mail inexistente: a resposta deve ser indistinguível da solicitação existente.
9. Homologar telas na Web e Android, inclusive estado de conexão ruim e indisponibilidade do provedor.
10. Verificar que login, cadastro, agenda e mural não sofreram regressões.

- Etapa 5: `feat/recuperacao-alteracao-senha-11` (PR #7, baseada na etapa 4).

## Homologação — filtro por congregação da Agenda (P1)

1. Abrir a Agenda com o filtro inicial **Todas as congregações**; verificar que a lista e as marcações do calendário não mudam.
2. Escolher uma congregação com eventos; conferir que apenas eventos dessa congregação aparecem, tanto na lista quanto nos dias destacados.
3. Selecionar congregação sem eventos no mês; conferir a mensagem específica e ausência de marcações indevidas.
4. Navegar entre meses, inclusive entre dezembro e janeiro; o filtro deve permanecer selecionado sem travar o gesto de deslizar o calendário.
5. Usar **Mostrar todas as congregações**; restaurar todos os eventos e as marcações.
6. Abrir e fechar a seleção sem alterar o filtro; verificar ausência de modais sobrepostos com os detalhes dos eventos.
7. Após criar, editar ou excluir um evento, voltar à Agenda e conferir a lista filtrada e o calendário atualizados.
8. Conferir comportamento com diferentes perfis de usuário (MEMBRO, ADMIN, MASTER) e em telas Web e Android.
9. Desligar temporariamente a API, abrir o seletor e conferir que a mensagem de erro permite **Tentar novamente** sem fechar a tela.
10. Confirmar que **não há pesquisa por título**, conforme escopo final escolhido.

- Etapa 6: `feat/filtro-congregacao-agenda-11` (PR #8, baseada no PR #7).
- O filtro é local aos eventos já carregados para o mês; não exige migração ou alteração nas rotas da API.

## Homologação — senhas (registro de resultados)

- Alteração de senha: usuário confirmou testes na Web e no Android.
- Recuperação por e-mail: usuário confirmou recebimento e redefinição bem-sucedidos no ambiente de homologação.
- Código inválido, reutilizado, expirado e senha anterior: os quatro cenários foram testados e aprovados pelo usuário.
- **Publicação em produção pendente**: remetente `onboarding@resend.dev` é exclusivo de testes; é necessário domínio de envio verificado antes de liberar recuperação para todos os usuários.
- Não houve migração em produção; `003_password_recovery.sql` foi aplicada somente na branch Neon `homologacao-senhas-1-1`.

## Homologação — cabeçalhos e transições entre abas (P1)

- Escopo visual: nenhuma mudança de regras, autenticação, API, banco, layout interno de telas ou ordem das abas.
- Cabeçalho da Agenda: **Agenda**, centralizado.
- Cabeçalho de Eventos: **Eventos**, centralizado independentemente da presença do botão de criar postagem (MASTER/ADMIN).
- Transição das telas: entrar em aba à direita faz a página atual deslizar à esquerda e a próxima vir da direita; navegar no sentido contrário inverte os movimentos.
- Rodapé: preservar cores e desenhos dos três ícones, com ícone selecionado verde-escuro; animar o pequeno deslocamento do ícone ativo e o indicador horizontal entre as posições.
- **Sincronização:** usar o mesmo tempo e curva de suavização para as cenas e o rodapé; evitar piscar e renderizar desnecessariamente.
- **Agenda → Eventos → Perfil → Eventos → Agenda:** testar sequência completa em Web e Android, inclusive pulando diretamente de Agenda para Perfil e voltando.
- Verificar que o gesto horizontal do calendário da Agenda continua navegando **meses**, não abas.
- Confirmar que o mural mantém seu fullscreen e a barra inferior oculta durante o fullscreen.
- Testar abertura/fechamento de modal, voltar a telas internas, criação e exclusão, mudança de conta e rotação de tela sem falhas.
- Em dispositivos lentos e com opções de movimento reduzido, avaliar conforto e responsividade.
- **Homologação pendente:** CI e testes manuais na Web/Android antes de merge/deploy.

### Branch de cabeçalhos e transições

- Etapa 7: `feat/transicoes-abas-headers-11` (PR #9, baseada no PR #8).
- Não realizar merge nem deploy em produção sem homologação do usuário.
