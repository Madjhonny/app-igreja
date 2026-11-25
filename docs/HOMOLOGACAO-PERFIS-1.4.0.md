# Etapa 15 — Homologação dos perfis

**Etapa encerrada por confirmação do responsável pela homologação.** O responsável aprovou de forma geral os testes dos perfis MASTER, ADMIN, MEMBRO, PENDENTE e CONVIDADO. A confirmação não inclui registros individuais de execução manual, aparelhos utilizados ou evidências por perfil.

Ambiente descartável com dados fictícios. O servidor web recebe conexões da rede local na porta `4150`. A API fica atrás do mesmo endereço, em `/api`, e o PostgreSQL da etapa escuta apenas em `127.0.0.1:55415`. Push e e-mail real ficam inativos.

## Contas de teste

A senha fictícia é `AgendaADP-Teste15!` para todas as contas abaixo. Use as contas apenas neste ambiente. No celular, conecte-se à mesma rede do computador que hospeda o ambiente.

| Perfil | E-mail | Congregação inicial |
|---|---|---|
| MASTER | `master@homologacao.test` | Sede de Homologação |
| ADMIN | `admin@homologacao.test` | Sede de Homologação |
| MEMBRO | `membro@homologacao.test` | Sede de Homologação |
| PENDENTE | `pendente@homologacao.test` | Sede de Homologação |
| PENDENTE de apoio | `pendente-jardim@homologacao.test` | Jardim de Homologação |
| MEMBRO de apoio | `membro-jardim@homologacao.test` | Jardim de Homologação |
| BLOQUEADO | `bloqueado@homologacao.test` | Sede de Homologação |
| RECUSADO | `recusado@homologacao.test` | Jardim de Homologação |
| CONVIDADO | Botão **Entrar como convidado** | — |

## Iniciar no Windows

Com o PostgreSQL da etapa ativo e a partir da raiz do repositório, use o IP privado atual do computador. As variáveis abaixo pertencem ao PowerShell de homologação.

```powershell
$ipLan = '192.168.1.71'
$env:EXPO_NO_DOTENV = '1'
$env:EXPO_NO_TELEMETRY = '1'
$env:EXPO_PUBLIC_PUSH_ENABLED = 'false'
$env:EXPO_PUBLIC_API_URL = "http://${ipLan}:4150/api"
$env:HOMOLOGACAO_DATABASE_URL = 'postgresql://agenda_homolog@127.0.0.1:55415/agenda_homologacao'

Push-Location app-igreja
& .\node_modules\.bin\expo.cmd export --platform web --output-dir dist/artefatos-teste/15/web-manual
Pop-Location
node scripts/servir-homologacao.cjs $ipLan app-igreja/dist/artefatos-teste/15/web-manual
```

Abra `http://192.168.1.71:4150/login`. Para Expo Go, use uma versão compatível com o SDK 58 e execute `expo start --go --offline --port 8081` em `app-igreja` com as mesmas variáveis `EXPO_PUBLIC_*` e `REACT_NATIVE_PACKAGER_HOSTNAME` definido como o IP privado. O terminal fornece o endereço `exp://`. O frontend e a API web também podem ser retomados sem reexportar se o IP e o código continuarem iguais. As mudanças nos dados fictícios persistem entre reinícios.

Se o cluster estiver parado, inicie o diretório `app-igreja/dist/artefatos-teste/15/postgres15-local` com o `pg_ctl` do PostgreSQL 17, passando `-o '-h 127.0.0.1 -p 55415'`. Para usar outro PostgreSQL local, configure `HOMOLOGACAO_DATABASE_URL` de forma segura com o método descrito no [guia de homologação](HOMOLOGACAO-1.4.0.md) e use um banco dedicado chamado `agenda_homologacao`.

## Repetir a automação

A suíte completa da etapa 14 inclui os cenários da etapa 15. Para usar o cluster local preparado nesta etapa, configure as três URLs abaixo no processo que inicia a validação. O runner usa schemas temporários nos bancos de teste e o ambiente manual mantém seu schema em `agenda_homologacao`.

```powershell
$env:WEB_TEST_DATABASE_URL = 'postgresql://agenda_homolog@127.0.0.1:55415/agenda_web_test'
$env:INTERESSES_TEST_DATABASE_URL = 'postgresql://agenda_homolog@127.0.0.1:55415/agenda_interesses_test'
$env:PUSH_TEST_DATABASE_URL = 'postgresql://agenda_homolog@127.0.0.1:55415/agenda_push_test'
.\scripts\validar-homologacao.ps1
```

## Matriz de permissões

| Ação | MASTER | ADMIN | MEMBRO | PENDENTE | CONVIDADO |
|---|---|---|---|---|---|
| Ler Agenda e Mural | Sim | Sim | Sim | Sim | Conteúdo público |
| Ler comentários | Sim | Sim | Sim | Sim, somente leitura | — |
| Curtir, comentar, marcar e filtrar interesses | Sim | Sim | Sim | — | — |
| Excluir comentários | Moderação | Moderação | Próprios | — | — |
| Criar, editar e excluir eventos | Todas as congregações | Própria congregação | — | — | — |
| Criar e excluir publicações | Todas as congregações | Própria congregação | — | — | — |
| Gerenciar contas | Todas as congregações | Status de MEMBRO da própria congregação | — | — | — |
| Alterar nível de outra conta | Sim, conforme status da conta | — | — | — | — |
| Alterar o próprio nível ou status | — | — | — | — | — |
| Gestão de Datas e publicação do planejamento | Sim | — | — | — | — |
| Editar o próprio perfil | Sim | Sim | Sim | Sim | — |

## Roteiro manual por perfil

Comece pelo MASTER. Termine cada perfil, registre aparelho, sistema, cliente utilizado e resultado, e encerre a sessão antes de seguir. Use uma conta de apoio para ações de aprovação ou promoção, preservando a conta PENDENTE de teste até seu turno.

1. **MASTER.** No aparelho físico, entre com a conta de teste e verifique o teclado virtual, o caminho do foco até **Entrar** e a legibilidade da Agenda após o teclado fechar. Em Eventos, abra **Publicação da Sede**, deslize para outra publicação e volte ao feed. Observe fluidez, posição ao retornar e retorno de foco. Com TalkBack ou VoiceOver, confira a ordem de leitura no feed, o estado do marcador de interesse, o título do fullscreen e o fechamento dos comentários. Repita com texto ampliado. Em seguida, confira os formulários de evento e planejamento e o painel de contas com o leitor ativo.
2. **ADMIN.** Confirme a legibilidade dos modais de conta e moderação e verifique o retorno do foco ao fechar. Use dados da Sede para conferir os controles permitidos e compare a apresentação com uma publicação do Jardim.
3. **MEMBRO.** Confira teclado virtual e leitor de tela ao comentar e editar o perfil. Verifique nomes, estados alternáveis e foco entre feed, fullscreen e filtro Interesses, inclusive com texto ampliado.
4. **PENDENTE.** Confirme o anúncio do aviso de aprovação, a ausência de ações de escrita e a legibilidade do perfil. Após aprovação pelo ADMIN, use **Verificar aprovação** e confirme a atualização dos controles na mesma sessão.
5. **CONVIDADO.** Verifique o anúncio dos limites de acesso, a navegação pública e o foco ao chegar ao cadastro e voltar ao login.

A instalação da PWA, o uso offline e o recebimento real de push ficam para a etapa 16, após autorização.
