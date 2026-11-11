# Roteiro de evolução — Agenda ADP 1.1

Última revisão: 11/11/2026. A versão de produção não deve ser atualizada antes da homologação.

## Escopo confirmado

O Agenda ADP organiza **eventos únicos**, com duração de um ou mais dias, e oferece agenda, gestão de usuários e mural de comunicação entre congregações.

### P0 — Corrigir antes de qualquer nova publicação

| Entrega | Critério de aceite | Estado |
| --- | --- | --- |
| Criar eventos na Web | Após salvar com sucesso, exibir diálogo visual do app e retornar à agenda | Implementada nesta branch; homologação pendente |
| Excluir eventos na Web | Diálogo de confirmação próprio, exclusão na API, atualização da agenda | Implementada nesta branch; homologação pendente |
| Não recarregar a Gestão de Datas ao alterar registros | Criar, excluir, alterar marcador e publicar sem loading geral | Implementada na branch da etapa 1; homologada pelo usuário |
| Conferir conflitos antes da publicação | API revalida contra publicados e dentro do lote, com rollback em erro | Implementada na etapa 2; avisos homologados pelo usuário |
| Confirmação excepcional do MASTER | Exibir rascunhos e horários em conflito; confirmar apenas por decisão explícita | API e interface implementadas; homologação pendente |
| Testes das operações críticas | Testes automatizados aprovados e testes Web/Android sem regressões | API automatizada aprovada; validação visual pendente |

### P1 — Alta prioridade, após homologar os P0

| Entrega | Critério de aceite | Estado |
| --- | --- | --- |
| Diálogos consistentes | Substituir pop-ups do navegador e alertas nativos por componentes internos em todas as telas | Implementada nesta branch; homologação pendente |
| Exclusão de comentários | Autor exclui seu comentário; ADMIN e MASTER excluem qualquer comentário; pendente não exclui | Planejada |
| Recuperação e alteração de senha | Usuários recuperam acesso por fluxo seguro, sem intervenção manual | Planejada |
| Filtros e busca da agenda | Pesquisar título e filtrar congregação | Planejada |
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
