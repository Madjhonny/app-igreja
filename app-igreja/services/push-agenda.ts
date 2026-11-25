type Resposta = {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> } } };
};

type Dependencias = {
  acaoPadrao: string;
  ultimaResposta: () => Resposta | null;
  limparResposta: () => void;
  inscrever: (tratar: (resposta: Resposta) => void) => { remove: () => void };
  podeAbrir: () => Promise<boolean>;
  abrir: () => void;
};

export function observarToquesNaAgenda(deps: Dependencias) {
  let ativo = true;
  let ultimoId: string | undefined;
  const recentes = new Set<string>();

  const tratar = (resposta: Resposta) => {
    const { identifier, content } = resposta.notification.request;
    if (resposta.actionIdentifier !== deps.acaoPadrao || content.data?.tipo !== 'agenda' ||
        !identifier || recentes.has(identifier)) return;

    recentes.add(identifier);
    if (recentes.size > 32) recentes.delete(recentes.values().next().value!);
    ultimoId = identifier;
    deps.limparResposta();
    void deps.podeAbrir().then(permitido => {
      if (ativo && ultimoId === identifier && permitido) deps.abrir();
    }).catch(() => undefined);
  };

  const inscricao = deps.inscrever(tratar);
  const ultima = deps.ultimaResposta();
  if (ultima) tratar(ultima);
  return () => {
    ativo = false;
    inscricao.remove();
  };
}
