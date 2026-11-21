# Agenda ADP 1.3.0 — homologação consolidada

## Antes da build

- CI da branch `feat/notificacoes-push` aprovada e código candidato sem alterações locais.
- Ambiente EAS **preview**: `EXPO_PUBLIC_API_URL=https://agenda-adp-api-homologacao.onrender.com`, `EXPO_PUBLIC_PUSH_ENABLED=true`, `GOOGLE_SERVICES_JSON` como arquivo do projeto Firebase `agenda-adp` para `br.com.agendaadp.app`.
- FCM v1 configurado no EAS; segurança de acesso do Expo Push Service ativada; `EXPO_PUSH_ACCESS_TOKEN` e `PUSH_NOTIFICATIONS_ENABLED=true` no Render de homologação; migração de push aplicada no banco de homologação. Nunca copiar chaves privadas para o app.
- Conferir o versionCode remoto com `eas build:version:get --platform android --profile preview`. O `preview` incrementa automaticamente o versionCode. Deve resultar em número superior à versão instalada.
- Gerar somente uma build Android consolidada com `eas build --platform android --profile preview`, após conferência das variáveis. O hook de pré-instalação impede configurações incorretas.

## Testes físicos (Android, APK de homologação)

Usar contas e eventos de teste na homologação. Instalar sobre o aplicativo anterior somente se desejar substituir o APK instalado (mesmo identificador Android).

1. Instalação, login, cadastro, convidado, aprovação, navegação, agenda, mural, perfil e recuperação de senha.
2. Notificações desativadas inicialmente, sem solicitar permissão durante o login. Ativar no Perfil e conceder permissão.
3. Publicar evento na congregação do dispositivo; receber aviso genérico com app aberto, em segundo plano e fechado (não forçado a parar pelo sistema). Validar publicação em lote.
4. Evento de outra congregação, conta pendente e dispositivo desativado não recebem novos avisos, respeitando entregas já em trânsito.
5. Desativar a opção e verificar logout; reativar apenas com consentimento. Verificar revogação pendente quando offline ao reconectar.
6. Repetir navegação web/PWA, inclusive iOS; notificações da PWA não fazem parte desta release. Push iOS nativo exige APNs e build iOS própria.

## Liberação (somente após aprovação)

- Confirmar migrações e configuração de produção separadamente; não reutilizar banco de homologação.
- Integrar PR #35 e acompanhar CI, deploy e saúde da API/web.
- Ativar envio em produção de forma controlada, se homologado; manter opção de desativar a flag no backend, sem remover os dados da migração.

Nenhuma etapa de produção é automática por este documento. O APK preview não é uma build de produção.
