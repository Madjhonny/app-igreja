# Etapa 16 — Homologação por plataforma

A [etapa 15](HOMOLOGACAO-PERFIS-1.4.0.md) foi encerrada por aprovação geral do responsável pelos testes dos cinco perfis. Este roteiro usa o PostgreSQL isolado da etapa 15, as contas fictícias e o servidor local. Os testes automáticos usam provedores simulados para notificações e e-mail.

Na abertura da etapa 17.1, o responsável aprovou os testes da etapa 16 e autorizou o encerramento da homologação. O aceite das verificações físicas é geral. Modelo de aparelho, versão do sistema, resultado individual de cada item e entrega real de push seguem sem evidência registrada. A [consolidação da release](HOMOLOGACAO-RELEASE-1.4.0.md) registra a automação e o aceite em seções próprias.

## Reproduzir a automação

```powershell
$env:WEB_TEST_DATABASE_URL = 'postgresql://agenda_homolog@127.0.0.1:55415/agenda_web_test'
$env:INTERESSES_TEST_DATABASE_URL = 'postgresql://agenda_homolog@127.0.0.1:55415/agenda_interesses_test'
$env:PUSH_TEST_DATABASE_URL = 'postgresql://agenda_homolog@127.0.0.1:55415/agenda_push_test'

Push-Location app-igreja
& .\node_modules\.bin\playwright.cmd install firefox webkit
Pop-Location
.\scripts\validar-homologacao.ps1 -Etapa 16
```

A rodada inclui Chromium, Chrome e Edge instalados no Windows, além de Firefox e WebKit quando disponíveis. O Playwright usa perfis descartáveis e mantém os resultados por navegador no diretório de artefatos da etapa 16. WebKit no Playwright é a verificação de um motor web em ambiente controlado. O teste em Safari físico faz parte do roteiro abaixo.

No Firefox headless, o diálogo de arquivos é simulado porque a automação emite `cancel` ao interceptá-lo. Os testes inserem o arquivo no campo real e verificam o tratamento do evento, o preview, a proporção e a remoção do campo. A caixa nativa de seleção do Firefox segue para verificação manual.

## Limites da PWA e do Expo Go

- O Service Worker busca as páginas pela rede e apresenta uma página genérica quando uma navegação não consegue conectar. Um erro HTTP do servidor continua visível. A aplicação depende da conexão para Agenda, Mural, perfil e operações autenticadas. Dados privados de contas anteriores e respostas da API ficam fora do Cache Storage.
- O manifesto declara `standalone` e a distribuição fornece ícones de instalação e toque da Apple. Instalação e Service Worker em aparelho físico dependem de um contexto seguro. Use uma origem HTTPS isolada e confiável para o aparelho. O HTTP do endereço de rede local da etapa 15 serve para testar a versão web comum no celular. O loopback permite testar a PWA automatizada neste computador.
- Expo Go com SDK 58 serve ao fluxo do aplicativo e às interações nativas com as funcionalidades disponíveis no cliente. O recebimento remoto e o toque em uma notificação real serão verificados em uma build nativa autorizada. Consulte [Notificações push](NOTIFICACOES-PUSH.md) para Firebase FCM v1, APNs e as variáveis de homologação.

## Roteiro físico reduzido

Registre modelo, versão do sistema, cliente usado e resultado de cada item. Use as contas fictícias da [etapa 15](HOMOLOGACAO-PERFIS-1.4.0.md).

1. **Android e iOS com Expo Go.** Abra pelo endereço da rede local, confira o formulário de cadastro e entre com uma conta de teste. Visite Agenda e Eventos. Confira teclado virtual e áreas seguras. Gire o aparelho e confira a orientação de retrato configurada no app nativo. Abra uma publicação com imagem, deslize no fullscreen, volte ao feed e confirme um diálogo. Abra o seletor de imagens e confira o preview proporcional. Ative a preferência de movimento reduzido e repita a transição. Coloque o app em segundo plano, corte e recupere a conexão e confirme a atualização ao retornar. Se o sistema disponibilizar um profiler, verifique o consumo em repouso e a ausência de requisições repetidas.
2. **Acessibilidade física.** Com TalkBack no Android e VoiceOver no iOS, percorra o calendário, as ações dos cards, o marcador de interesse e os comentários. Confirme a ordem dos anúncios e o retorno de foco ao fechar o fullscreen ou um modal. Repita com texto ampliado.
3. **PWA Android e iOS.** Em HTTPS de homologação, instale pelo Chrome no Android e adicione à tela de início pelo Safari no iOS. Abra pelo ícone e confira a janela standalone. Após login, desligue a rede e recarregue uma rota. Confira a página genérica, religue a rede, selecione **Tentar novamente** e confirme a sessão conforme a opção **Manter conectado**. Encerre a sessão, entre com outra conta fictícia e confira a separação dos interesses.
4. **Push real em build de homologação autorizada.** Use apenas um dispositivo e contas fictícias que tenham aceitado notificações. Verifique a permissão do sistema, envio único numa publicação em lote, toque em primeiro plano e com o aplicativo fechado, logout e troca de conta. Compare com outra congregação e com o registro revogado. Execute o envio real somente com autorização específica.

Referências: [Expo SDK 58 e notificações](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/) · [Apps na tela inicial do iOS](https://developer.apple.com/videos/play/wwdc2023/10120/) · [Navegadores do Playwright](https://playwright.dev/docs/browsers).
