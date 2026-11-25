# Histórico de versões do Agenda ADP

## 1.4.0 — Candidata à publicação

### Agenda e Eventos

- Cabeçalhos atualizados, calendário mais legível e melhor distribuição dos controles em telas compactas e amplas.
- Publicações centralizadas, imagens com proporção original e navegação em tela cheia sincronizada com o feed.
- Filtros **Todos**, **Minha congregação** e **Interesses**, com ações administrativas reunidas no menu da publicação.

### Tenho interesse

- Usuários aprovados podem marcar, remover e consultar seus próprios interesses no feed e em tela cheia. O servidor preserva as marcações por conta, inclusive após sair e entrar de novo.
- A lista se atualiza ao voltar para Eventos, recuperar o foco ou usar a sincronização manual. Uma falha de conexão pode reverter a atualização imediata e reconciliar o estado com o servidor.

### Acessibilidade e web

- Navegação por teclado e foco visível, estados de filtros e marcadores anunciados, atalhos em tela cheia e retorno de foco ao fechar diálogos.
- Ajustes de contraste, áreas de interação e ampliação de texto, com suporte à preferência por movimento reduzido.
- Hidratação da exportação estática corrigida. A PWA mantém a navegação pela rede e apresenta uma página genérica quando falta conexão.

### Publicação

- A nova tabela `mural_interesses` é aditiva. O próximo frontend depende dos endpoints da candidata e, por isso, deve ser publicado após o banco e o backend.
- Notificações foram validadas com provedores simulados. A entrega real depende de build nativa e autorização específica.

[Notas para usuários](docs/RELEASE-1.4.0.md) · [Homologação](docs/HOMOLOGACAO-RELEASE-1.4.0.md) · [Publicação e rollback](docs/PLANO-RELEASE-1.4.0.md)

## 1.3.1

- Orientação inicial para ativação de notificações, com acesso às configurações pelo perfil.

[Histórico da preparação da 1.3.0 e 1.3.1](docs/RELEASE-1.3.0.md)
