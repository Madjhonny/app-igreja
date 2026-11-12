# API Igreja

API Express/PostgreSQL usada pelo aplicativo Expo. Requer Node.js 20 ou superior e PostgreSQL 15 ou superior.

## Configuração local

1. Copie `.env.example` para `.env` e preencha uma chave JWT longa e as credenciais do banco.
2. Instale de forma reproduzível com `npm ci`.
3. Crie o schema com `npm run db:migrate`.
4. Cadastre as congregações necessárias na tabela `congregacoes`.
5. Inicie com `npm start`.

As migrations são aplicadas em ordem, sob lock consultivo, e registradas em `schema_migrations`. Faça backup e teste a migration antes de aplicá-la a um banco antigo com dados que possam violar as novas constraints.

## Segurança e ambiente

- `CORS_ORIGINS` é obrigatório para clientes web e aceita uma lista separada por vírgula. Clientes nativos não enviam `Origin`.
- Em produção, mantenha `DB_SSL=true`. Certificados públicos usam a trust store do sistema; para uma CA privada, informe `DB_SSL_CA`.
- Fotos aceitas: JPEG, PNG ou WebP por HTTPS ou data URI, até `MAX_IMAGE_BYTES`.
- Login e cadastro possuem limites por IP configuráveis pelas variáveis do `.env.example`.

## Verificação

```bash
npm run check
npm test
npm audit --omit=dev
```

Os testes atuais isolam regras de autenticação/autorização. A suíte ainda deve ser complementada por integração HTTP contra um PostgreSQL descartável.

## Recuperação e alteração de senha (Agenda ADP 1.1)

- `POST /senha/solicitar-recuperacao`: envia código numérico de 8 dígitos ao e-mail cadastrado. A resposta não informa se a conta existe. Requer `RESEND_API_KEY` e `EMAIL_FROM` no ambiente da API.
- `POST /senha/redefinir`: recebe `email`, `codigo` e `nova_senha`. Código válido por **15 minutos**, uso único e no máximo **5 erros por código**.
- `POST /senha/alterar`: autenticada; recebe `senha_atual` e `nova_senha` e exige a senha atual correta.
- Nova senha: 10 a 128 caracteres, pelo menos uma letra maiúscula, uma minúscula e um número.
- A alteração ou redefinição incrementa `usuarios.token_version`: todas as sessões antigas deixam de ser aceitas; o usuário deve entrar novamente.
- Hash do código armazenado via HMAC-SHA256, sem código em texto simples no banco. Há cooldown de 2 minutos entre envios por conta e limites por IP para solicitação e validação.

### Configuração do e-mail

1. Configure um provedor de e-mail transacional (integração implementada com a API HTTP do [Resend](https://resend.com/docs/send-with-nodejs)).
2. Valide o domínio remetente e configure `EMAIL_FROM` como endereço desse domínio. Use `RESEND_API_KEY` **somente no backend** (ambiente Render e .env local), nunca `EXPO_PUBLIC_` nem Git.
3. A API usa o endpoint `https://api.resend.com/emails`, sem dependências adicionais.
4. Sem as duas variáveis de e-mail, a solicitação devolve HTTP **503**; em caso de falha no envio, o servidor registra apenas o erro, sem revelar código ou credenciais.
5. Garanta que o provedor realmente entregue o e-mail na homologação. Testes automatizados não verificam a entrega real.

### Migração obrigatória

A migração `003_password_recovery.sql` cria `usuarios.token_version` e `senha_recuperacoes`.
**Antes de executar no Neon**, confira se as variáveis `DB_HOST`/`DB_NAME` apontam para o banco de homologação, faça backup, e execute `npm run db:migrate`. O script registra a migração em `schema_migrations` e não deve ser executado inadvertidamente em produção.

**Não inicie a nova API contra um banco que ainda não tenha aplicado essa migração**: a verificação de sessão consulta `token_version`.

## Imagens do mural sob demanda (Agenda ADP 1.1)

- O aplicativo atualizado solicita `GET /mural?midia=link`. O JSON contém apenas metadados e caminhos temporários para imagens guardadas em Base64 no PostgreSQL; não carrega o Base64 inteiro de cada publicação.
- `GET /mural/:id/imagem?exp=...&sig=...` entrega os bytes originais JPEG/PNG/WebP após validar assinatura HMAC e prazo de validade (até 12 horas). Os links concedem apenas leitura daquela foto e podem ser compartilhados por quem os possuir **até expirarem**. O conteúdo da foto é servido com cache privativo por até 30 minutos.
- O acesso ao feed que emite os links continua exigindo JWT. Não logue ou divulgue links assinados em locais públicos. Não coloque JWT nos links ou em propriedades de `Image`.
- Clientes antigos que utilizam `GET /mural` sem o parâmetro `midia=link` continuam recebendo a propriedade `midia` em seu formato original. Não remover essa compatibilidade antes de concluir a distribuição de versões atualizadas.
- Fotos existentes, registros e esquema do banco permanecem inalterados; a otimização exige **atualizar a API local e o app juntos** para testar. O app novo não deve ser direcionado ao Render antigo antes do deploy da API correspondente.
- O uso de Base64 no banco ainda consome espaço. A migração para armazenamento de objetos/URLs permanentes é uma etapa futura com planejamento de custos, backups e homologação separada.

### Homologação das imagens

1. Carregar o mural e confirmar títulos, autores, datas e curtidas normalmente.
2. Verificar imagens antigas na lista e em tela cheia na Web e no Android.
3. Conferir imagens JPEG, PNG e WebP, inclusive publicações com mídia em URL HTTPS preexistente.
4. Testar rolagem, atualização puxando para baixo, comentários e curtir.
5. Criar e excluir uma publicação de teste, sem afetar publicações reais.
6. Reabrir o mural com internet lenta e verificar que as imagens aparecem sob demanda sem travar o feed.
7. Confirmar que links inválidos, vencidos ou alterados não exibem fotos.
8. Conferir no inspetor de rede que `GET /mural?midia=link` não contém dados `data:image/...` para imagens do banco.

**Nenhuma migração de banco é necessária nesta fase.**
