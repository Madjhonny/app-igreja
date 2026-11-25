# Notificações push — Agenda ADP

## Escopo inicial

- Android e iOS, somente contas aprovadas e com congregação definida. Opt-in no Perfil; nenhum pedido de permissão ao instalar ou fazer login. A PWA não solicita notificações.
- Aviso genérico de novas atividades da própria congregação, tanto na criação direta de eventos quanto na publicação do planejamento. Um lote de planejamento gera um aviso por dispositivo (não um por evento). Não envia nome de usuário, título de evento ou dados da sessão ao provedor de push.
- A chave de revogação aleatória fica no SecureStore e somente seu hash no banco. Tokens são restritos ao backend, expiram após 30 dias e são renovados quando a sessão é validada, no máximo uma vez por dia. Logout e desativação solicitam revogação; se estiver offline, a chave é conservada para a próxima conexão. Avisos já enviados ou enviados durante uma revogação offline ainda podem chegar, por isso não contêm detalhes pessoais.
- Fila no PostgreSQL na mesma transação de publicação, com savepoint para não bloquear a agenda por falha de notificação. Revalida aprovação, congregação, versão da sessão e registro do dispositivo antes de enviar. Lotes de até 100, timeout de 10 segundos, recibos após 15 minutos, remoção de tokens inválidos, prazo máximo de 24 horas. Não repete envio de resultado ambíguo. A fila é de melhor esforço, processada durante atividade da API, inclusive health check, sem manter o banco permanentemente ativo. Sem garantias de entrega se o aparelho estiver offline ou o serviço suspenso.
- O aviso inclui apenas o marcador de navegação `tipo: agenda`. Um toque em sessão ativa e aprovada abre a Agenda se o dispositivo estiver registrado para a conta atual. Na abertura a frio, a navegação de sessão usual decide entre login e Agenda. A validação em Expo Go mantém o push remoto desativado.

## Ativação e homologação (não executar em produção antes de aprovar)

1. Executar a migração `20261120_push_notifications.sql` via `npm run db:migrate` primeiro no banco de homologação (conexão direta). Conferir o teste real em PostgreSQL isolado do CI antes de aplicar em produção.
2. Configurar projeto Firebase Cloud Messaging v1 para Android com package `br.com.agendaadp.app`, baixar `google-services.json` e registrar no EAS como variável de arquivo `GOOGLE_SERVICES_JSON` no ambiente apropriado. O `app.config.js` lê o caminho; não versionar o arquivo ou credenciais de conta de serviço.
3. Configurar credencial FCM v1 no EAS (`eas credentials --platform android`) e credencial APNs para iOS (`eas credentials --platform ios`). Não compartilhar chaves privadas no chat ou Git.
4. Ativar segurança de acesso no Expo Push Service e configurar `EXPO_PUSH_ACCESS_TOKEN` como segredo no backend de homologação. Usar `PUSH_NOTIFICATIONS_ENABLED=true` somente com a migração concluída e credenciais configuradas. O app usa `EXPO_PUBLIC_PUSH_ENABLED=true` no ambiente EAS de homologação; esse valor não é segredo.
5. Após autorização para a build nativa 1.4.0, preparar o ambiente preview com `EXPO_PUBLIC_API_URL` do backend isolado e as configurações dos passos anteriores. O hook `eas-build-pre-install` valida a URL do perfil, a flag de push e a associação do JSON Android ao Firebase `agenda-adp` e ao package correto. A CI testa o hook com fixtures. Em uma build nativa autorizada, verificar opt-in/out, conta pendente, congregações distintas, foreground, aplicativo fechado, logout, troca de conta, toque no aviso e publicação em lote. Push na PWA permanece fora do escopo.
6. Após aprovação, repetir configuração no backend e EAS de produção. As flags são desativadas por padrão; rollback pode desativar o envio sem remover tabelas.

Referência oficial: https://docs.expo.dev/push-notifications/push-notifications-setup/ e https://docs.expo.dev/push-notifications/sending-notifications/.
