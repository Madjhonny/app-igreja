import { useAppDialog } from '@/components/app-dialog';
import { apiUrl, apiFetch, authenticatedFetch, canInteract, canManage, isGuestMode, refreshSession } from '@/services/session';
import { useSessionUser } from '@/hooks/use-session-user';
import { useMuralInteresses } from '@/hooks/use-mural-interesses';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { filtrarInteresses } from '@/services/mural-interesses';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, ScrollView, TextInput, Modal, ActivityIndicator, FlatList, RefreshControl, StatusBar, BackHandler, PixelRatio, Platform, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage, type ImageLoadEventData } from 'expo-image';
import { imageAspectRatio, optimizedMuralUrl } from '@/services/mural-image';
import { filtrarPublicacoes, podeFiltrarCongregacao, type FiltroMural } from '@/services/mural-feed';
import { indiceValido, limitarIndice, indicePorDeslocamento } from '@/services/mural-navigation';

// Compatibilidade com URLs temporárias relativas da API e imagens antigas em Data URI.
const origemImagem = (valor: string) => valor.startsWith('/') ? apiUrl(valor) : valor;

// Limita o cache de proporções às últimas 100 imagens, sem cache persistente de links assinados.
const proporcoesCache = new Map<number, { uri: string; razao: number }>();

const ImagemMural = React.memo(function ImagemMural({ postId, uri, titulo, fullscreen = false }: { postId: number; uri: string; titulo: string; fullscreen?: boolean }) {
  const otimizada = optimizedMuralUrl(uri);
  const [fallback, setFallback] = useState(false);
  const [medida, setMedida] = useState<number>();
  const cache = proporcoesCache.get(postId);
  const razao = medida ?? (cache?.uri === uri ? cache.razao : 1);
  const fonte = fallback ? uri : otimizada;

  const onLoad = ({ source }: ImageLoadEventData) => {
    const novaRazao = imageAspectRatio(source.width, source.height);
    if (!novaRazao) return;
    proporcoesCache.delete(postId);
    proporcoesCache.set(postId, { uri, razao: novaRazao });
    if (proporcoesCache.size > 100) proporcoesCache.delete(proporcoesCache.keys().next().value!);
    setMedida(novaRazao);
  };

  const imagem = <ExpoImage
    source={{ uri: fonte }}
    alt={`Imagem da publicação: ${titulo}`}
    accessibilityLabel={`Imagem da publicação: ${titulo}`}
    style={fullscreen ? styles.fullscreenImage : styles.mediaContentFeed}
    contentFit="contain"
    cachePolicy={otimizada !== uri ? 'memory-disk' : 'none'}
    recyclingKey={fonte}
    onLoad={onLoad}
    onError={() => { if (!fallback && otimizada !== uri) setFallback(true); }}
  />;
  return fullscreen ? imagem : <View testID={`mural-imagem-${postId}`} style={[styles.mediaImagemFeed, { aspectRatio: razao }]}>{imagem}</View>;
});

export default function TelaEventos() {
  const { alert: mostrarDialogo } = useAppDialog();
  const { height: alturaJanela } = useWindowDimensions();
  const reduzirMovimento = useReducedMotion();
  const [posts, setPosts] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const requisicaoMural = useRef<AbortController | null>(null);

  const [usuarioLogado, setUsuarioLogado] = useSessionUser();
  const [convidado, setConvidado] = useState(false);

  const {
    permitido: podeMarcarInteresse,
    estado: estadoInteresses,
    alternar: alternarInteresse,
    carregar: carregarInteresses,
  } = useMuralInteresses(usuarioLogado, convidado);
  const [filtro, setFiltro] = useState<FiltroMural | 'interesses'>('todos');
  const [menuPostId, setMenuPostId] = useState<number | null>(null);

  // Controle do modo Fullscreen e navegação por slides
  const [modoFullscreen, setModoFullscreen] = useState(false);
  const [indiceAcessivel, setIndiceAcessivel] = useState(0);
  const [anuncioInteresses, setAnuncioInteresses] = useState('');
  const origemFullscreen = useRef<string | null>(null);
  const focarProximoSlide = useRef(false);
  const [indiceInicial, setIndiceInicial] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const navigation = useNavigation();

  // Medidas reais da área do fullscreen (cada slide ocupa exatamente uma "página")
  const [alturaPagina, setAlturaPagina] = useState(alturaJanela);
  const [fullscreenMedido, setFullscreenMedido] = useState(false);
  // Na Web, o onLayout inicial pode não disparar quando a camada é absoluta.
  // A lista já pode usar a altura inicial da janela sem aguardar essa medição.
  // Índice do slide visível (usado como ponto de partida ao abrir e se a lista precisar ser recriada)
  const indiceAtualRef = useRef(0);
  const timerEncaixeWeb = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alturaInicialWebRef = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerEncaixeWeb.current), [modoFullscreen, alturaPagina]);

  // Estados dos Modais e Interações
  const [modalComentariosVisivel, setModalComentariosVisivel] = useState(false);
  const [postSelecionadoId, setPostSelecionadoId] = useState<number | null>(null);
  const [comentarios, setComentarios] = useState<any[]>([]);
  const [textoComentario, setTextoComentario] = useState('');
  const [respostaPara, setRespostaPara] = useState<any>(null);
  const [comentarioParaExcluir, setComentarioParaExcluir] = useState<any>(null);
  const [excluindoComentario, setExcluindoComentario] = useState(false);
  const [erroComentario, setErroComentario] = useState('');
  const [avisoComentario, setAvisoComentario] = useState('');
  const excluindoComentarioRef = useRef(false);

  // Estados para curtidas
  const [postsCurtidas, setPostsCurtidas] = useState<{ [key: number]: { total: number, curtiu: boolean } }>({});
  const [comentariosCurtidas, setComentariosCurtidas] = useState<{ [key: number]: { total: number, curtiu: boolean } }>({});

  // Intercepta o botão de voltar físico do celular para fechar o fullscreen em vez de trocar de aba
  useEffect(() => {
    const backAction = () => {
      if (modoFullscreen) {
        setModoFullscreen(false);
        return true; // Impede a ação padrão (que mudaria de aba ou sairia)
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [modoFullscreen]);

  useEffect(() => {
    if (!modoFullscreen) return;
    navigation.setOptions({ tabBarStyle: { display: 'none' } });
    return () => navigation.setOptions({ tabBarStyle: { backgroundColor: '#F7F5EC' } });
  }, [modoFullscreen, navigation]);

  const buscarPosts = useCallback(async () => {
    requisicaoMural.current?.abort();
    const controle = new AbortController();
    requisicaoMural.current = controle;
    const { signal } = controle;
    // Mantem os eventos visiveis ao retornar para a aba.
    setErroCarregamento('');
    try {
      const modoConvidado = await isGuestMode();
      if (signal.aborted) return;
      const resposta = modoConvidado
        ? await apiFetch('/publico/mural', { signal })
        : await authenticatedFetch('/mural?midia=link', { signal });
      if (resposta.ok) {
        const dados = await resposta.json();
        if (signal.aborted) return;
        setPosts(dados);

        const mapCurtidas: { [key: number]: { total: number, curtiu: boolean } } = {};
        dados.forEach((p: any) => {
          mapCurtidas[p.id] = { total: p.totalCurtidas, curtiu: p.curtiuPorMim };
        });
        setPostsCurtidas(mapCurtidas);
      } else {
        const dados = await resposta.json().catch(() => ({}));
        if (!signal.aborted) setErroCarregamento(dados.erro || 'Não foi possível carregar as publicações.');
      }
    } catch {
      if (!signal.aborted) setErroCarregamento('Falha de conexão. Verifique sua internet e tente novamente.');
    } finally {
      if (requisicaoMural.current === controle) {
        requisicaoMural.current = null;
        setCarregando(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let ativo = true;
    void (async () => {
      try {
        const modoConvidado = await isGuestMode();
        if (!ativo) return;

        setConvidado(modoConvidado);

        if (modoConvidado) {
          setUsuarioLogado(null);
        } else {
          const usuario = await refreshSession();
          if (!ativo) return;
          setUsuarioLogado(usuario);
        }

        if (ativo) await buscarPosts();
      } catch {
        if (ativo) {
          setErroCarregamento('Falha de conexão. Verifique sua internet e tente novamente.');
          setCarregando(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      ativo = false;
      const pendente = requisicaoMural.current;
      requisicaoMural.current = null;
      pendente?.abort();
    };
  }, [buscarPosts, setUsuarioLogado]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void buscarPosts();
    void carregarInteresses();
  }, [buscarPosts, carregarInteresses]);

  const podeInteragir = !convidado && canInteract(usuarioLogado);

  const congregacaoId = usuarioLogado?.congregacao_id;
  const filtroDisponivel = podeFiltrarCongregacao(congregacaoId, convidado);
  const filtroAtivo = filtro === 'interesses'
    ? (podeMarcarInteresse ? 'interesses' : 'todos')
    : (filtroDisponivel ? filtro : 'todos');

  const postsVisiveis = React.useMemo(
    () => filtroAtivo === 'interesses'
      ? filtrarInteresses(
          posts,
          estadoInteresses.ids,
          podeMarcarInteresse && estadoInteresses.pronto
        )
      : filtrarPublicacoes(
          posts,
          filtroAtivo,
          congregacaoId,
          convidado
        ),
    [
      posts,
      filtroAtivo,
      congregacaoId,
      convidado,
      estadoInteresses.ids,
      estadoInteresses.pronto,
      podeMarcarInteresse
    ]
  );
  const slideAcessivel = postsVisiveis[indiceAcessivel]?.id;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const quadro = requestAnimationFrame(() => {
      if (modoFullscreen && focarProximoSlide.current) {
        const voltar = document.querySelector<HTMLElement>(
          `[data-testid="mural-slide-${slideAcessivel}"] [data-testid="voltar-fullscreen"]`
        );
        if (voltar) {
          voltar.focus({ preventScroll: true });
          focarProximoSlide.current = false;
        }
      } else if (!modoFullscreen && origemFullscreen.current) {
        const origem = document.querySelector<HTMLElement>(`[data-testid="${origemFullscreen.current}"]`);
        const filtro = filtroAtivo === 'interesses' ? 'filtro-interesses' : 'filtro-todos';
        (origem ?? document.querySelector<HTMLElement>(`[data-testid="${filtro}"]`))?.focus();
        origemFullscreen.current = null;
      }
    });
    return () => cancelAnimationFrame(quadro);
  }, [filtroAtivo, modoFullscreen, slideAcessivel]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !modoFullscreen || modalComentariosVisivel) return;
    const navegar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        setModoFullscreen(false);
      } else if (evento.key === 'ArrowUp' || evento.key === 'ArrowDown') {
        evento.preventDefault();
        const proximo = limitarIndice(indiceAtualRef.current + (evento.key === 'ArrowUp' ? -1 : 1), postsVisiveis.length);
        if (proximo === indiceAtualRef.current) return;
        focarProximoSlide.current = true;
        indiceAtualRef.current = proximo;
        setIndiceAcessivel(proximo);
        flatListRef.current?.scrollToOffset({ offset: proximo * alturaPagina, animated: false });
      }
    };
    window.addEventListener('keydown', navegar);
    return () => window.removeEventListener('keydown', navegar);
  }, [alturaPagina, modalComentariosVisivel, modoFullscreen, postsVisiveis.length]);

  // Reinicia a selecao quando o contexto da sessao muda.
  const contextoFiltro = JSON.stringify([
    usuarioLogado?.id ?? null,
    congregacaoId ?? null,
    convidado,
    podeMarcarInteresse
  ]);

  const [contextoAnterior, setContextoAnterior] = useState(contextoFiltro);

  if (contextoAnterior !== contextoFiltro) {
    setContextoAnterior(contextoFiltro);
    setMenuPostId(null);
    setFiltro('todos');
    setModoFullscreen(false);
    setIndiceInicial(0);
    setAnuncioInteresses('');
  } else if (modoFullscreen && postsVisiveis.length === 0) {
    setModoFullscreen(false);
    setIndiceInicial(0);
  }

  const alterarFiltro = (novoFiltro: FiltroMural | 'interesses') => {
    if (novoFiltro === 'interesses' && !podeMarcarInteresse) return;
    setMenuPostId(null);
    setFiltro(novoFiltro);
    setModoFullscreen(false);
    setIndiceInicial(0);
    indiceAtualRef.current = 0;
  };

  const curtirPost = async (postId: number) => {
    if (!podeInteragir) return;
    const anterior = postsCurtidas[postId] || { total: 0, curtiu: false };
    setPostsCurtidas(prev => {
      const atual = prev[postId] || { total: 0, curtiu: false };
      return {
        ...prev,
        [postId]: {
          total: atual.curtiu ? atual.total - 1 : atual.total + 1,
          curtiu: !atual.curtiu
        }
      };
    });

    try {
      const resposta = await authenticatedFetch(`/mural/${postId}/curtir`, { method: 'POST' });
      if (!resposta.ok) throw new Error('LIKE_FAILED');
    } catch {
      setPostsCurtidas(prev => ({ ...prev, [postId]: anterior }));
      mostrarDialogo('Não foi possível curtir', 'Tente novamente em alguns instantes.');
    }
  };

  const curtirComentario = async (comentarioId: number) => {
    if (!podeInteragir) return;
    const anterior = comentariosCurtidas[comentarioId] || { total: 0, curtiu: false };
    setComentariosCurtidas(prev => {
      const atual = prev[comentarioId] || { total: 0, curtiu: false };
      return {
        ...prev,
        [comentarioId]: {
          total: atual.curtiu ? atual.total - 1 : atual.total + 1,
          curtiu: !atual.curtiu
        }
      };
    });

    try {
      const resposta = await authenticatedFetch(`/comentarios/${comentarioId}/curtir`, { method: 'POST' });
      if (!resposta.ok) throw new Error('LIKE_FAILED');
    } catch {
      setComentariosCurtidas(prev => ({ ...prev, [comentarioId]: anterior }));
      mostrarDialogo('Não foi possível curtir', 'Tente novamente em alguns instantes.');
    }
  };

  const abrirComentarios = async (postId: number) => {
    if (convidado) {
      mostrarDialogo(
        'Acesso restrito',
        'Entre na sua conta para visualizar e participar dos comentários.'
      );
      return;
    }

    setPostSelecionadoId(postId);
    setComentarioParaExcluir(null);
    setErroComentario('');
    setAvisoComentario('');
    setModalComentariosVisivel(true);
    await carregarComentarios(postId);
  };

  const fecharComentarios = () => {
    if (excluindoComentarioRef.current) return;
    setModalComentariosVisivel(false);
    setComentarioParaExcluir(null);
    setErroComentario('');
    setAvisoComentario('');
  };

  const podeExcluirComentario = (comentario: any) => {
    if (!podeInteragir || !usuarioLogado) return false;
    return Number(comentario.usuario_id) === Number(usuarioLogado.id) ||
      usuarioLogado.nivel_acesso === 'ADMIN' ||
      usuarioLogado.nivel_acesso === 'MASTER';
  };

  const carregarComentarios = async (postId: number) => {
    try {
      const resp = await authenticatedFetch(`/mural/${postId}/comentarios`);
      if (resp.ok) {
        const dados = await resp.json();
        setComentarios(dados);

        const mapC: { [key: number]: { total: number, curtiu: boolean } } = {};
        dados.forEach((c: any) => {
          mapC[c.id] = { total: parseInt(c.total_curtidas) || 0, curtiu: c.curtiu_por_mim };
        });
        setComentariosCurtidas(mapC);
      } else {
        const dados = await resp.json().catch(() => ({}));
        mostrarDialogo('Erro', dados.erro || 'Não foi possível carregar os comentários.');
      }
    } catch {
      mostrarDialogo('Erro', 'Falha de conexão ao carregar os comentários.');
    }
  };

  const enviarComentario = async () => {
    if (!podeInteragir || !textoComentario.trim() || !postSelecionadoId) return;

    try {
      const resp = await authenticatedFetch(`/mural/${postSelecionadoId}/comentarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texto: textoComentario,
          parent_id: respostaPara ? respostaPara.id : null
        })
      });

      if (resp.ok) {
        setTextoComentario('');
        setRespostaPara(null);
        await carregarComentarios(postSelecionadoId);
      } else {
        const dados = await resp.json().catch(() => ({}));
        mostrarDialogo('Erro', dados.erro || 'Não foi possível enviar o comentário.');
      }
    } catch {
      mostrarDialogo("Erro", "Não foi possível enviar o comentário.");
    }
  };

  const iniciarExclusaoComentario = (comentario: any) => {
    if (!podeExcluirComentario(comentario) || excluindoComentarioRef.current) return;
    setErroComentario('');
    setAvisoComentario('');
    setComentarioParaExcluir(comentario);
  };

  const excluirComentario = async () => {
    if (!comentarioParaExcluir || !podeExcluirComentario(comentarioParaExcluir) || excluindoComentarioRef.current) return;

    const id = Number(comentarioParaExcluir.id);
    const anteriores = comentarios;
    // A FK de comentários remove também respostas descendentes. Atualiza a UI com a mesma regra.
    const removidos = new Set<number>([id]);
    let encontrou = true;
    while (encontrou) {
      encontrou = false;
      for (const item of anteriores) {
        if (item.parent_id != null && removidos.has(Number(item.parent_id)) &&
            !removidos.has(Number(item.id))) {
          removidos.add(Number(item.id));
          encontrou = true;
        }
      }
    }

    excluindoComentarioRef.current = true;
    setExcluindoComentario(true);
    setErroComentario('');
    setComentarios(atuais => atuais.filter(item => !removidos.has(Number(item.id))));
    setComentarioParaExcluir(null);

    try {
      const resp = await authenticatedFetch(`/comentarios/${id}`, { method: 'DELETE' });
      if (!resp.ok) {
        const dados = await resp.json().catch(() => ({}));
        throw new Error(dados.erro || 'Não foi possível excluir o comentário.');
      }
      setRespostaPara((atual: any) => atual && removidos.has(Number(atual.id)) ? null : atual);
      setComentariosCurtidas(atuais => {
        const atualizadas = { ...atuais };
        removidos.forEach(itemId => { delete atualizadas[itemId]; });
        return atualizadas;
      });
      setAvisoComentario('Comentário excluído com sucesso.');
    } catch (erro) {
      setComentarios(anteriores);
      setErroComentario(erro instanceof Error ? erro.message : 'Falha de conexão ao excluir o comentário.');
    } finally {
      excluindoComentarioRef.current = false;
      setExcluindoComentario(false);
    }
  };

  const excluirPost = async (postId: number) => {
    mostrarDialogo("Excluir Publicação", "Tem certeza que deseja excluir este post?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          try {
            const resp = await authenticatedFetch(`/mural/${postId}`, { method: 'DELETE' });
            if (resp.ok) {
              setPosts(atuais => atuais.filter(p => p.id !== postId));
              setModoFullscreen(false);
            } else {
              mostrarDialogo("Erro", "Você não tem permissão para excluir este post.");
            }
          } catch {
            mostrarDialogo("Erro", "Falha na conexão.");
          }
        }
      }
    ]);
  };

  const podeExcluirPost = (post: any) => {
    if (convidado || !usuarioLogado || !canManage(usuarioLogado)) return false;
    if (usuarioLogado.nivel_acesso === 'MASTER') return true;
    if (usuarioLogado.nivel_acesso === 'ADMIN' && post.congregacao_id === usuarioLogado.congregacao_id) return true;
    return false;
  };

  const postMenu = postsVisiveis.find(post => post.id === menuPostId);
  const menuDisponivel = !!postMenu && podeExcluirPost(postMenu);

  const abrirFullscreenNoPost = (index: number, origem: string) => {
    setMenuPostId(null);
    if (!indiceValido(index, postsVisiveis.length)) return;
    indiceAtualRef.current = index;
    origemFullscreen.current = origem;
    focarProximoSlide.current = true;
    setIndiceAcessivel(index);
    alturaInicialWebRef.current = undefined;
    setIndiceInicial(index);
    if (Platform.OS === 'web') setAlturaPagina(alturaJanela);
    setModoFullscreen(true);
  };

  const alterarInteresse = async (id: number) => {
    const remover = estadoInteresses.ids.includes(id);
    if (filtroAtivo === 'interesses' && remover) {
      const perdeuFoco = Platform.OS === 'web' && document.activeElement?.getAttribute('data-testid') === `interesse-feed-${id}`;
      setAnuncioInteresses('');
      if (await alternarInteresse(id)) setAnuncioInteresses('Interesse removido.');
      if (perdeuFoco && document.activeElement === document.body) {
        document.querySelector<HTMLElement>('[data-testid="filtro-interesses"]')?.focus();
      }
    } else {
      await alternarInteresse(id);
    }
  };

  const tentarCarregarInteresses = async () => {
    setAnuncioInteresses('Carregando seus interesses.');
    setAnuncioInteresses(await carregarInteresses() ? 'Interesses atualizados.' : '');
  };

  // Renderização da lista principal (feed tradicional)
  const renderPostFeed = ({ item: post, index }: { item: any, index: number }) => {
    const curInfo = postsCurtidas[post.id] || {
      total: post.totalCurtidas,
      curtiu: post.curtiuPorMim
    };

    const autorFoto = post.autor_foto;
    const totalCurtidas = Math.max(0, Number(curInfo.total) || 0);

    return (
      <View testID={`mural-card-${post.id}`} style={[
        styles.postCard,
        Platform.OS === 'web' && styles.postCardWeb
      ]}>
        <View style={styles.postHeader}>
          <TouchableOpacity
            style={styles.authorContainer}
            disabled={convidado}
            accessibilityRole="button"
            accessibilityLabel={`Perfil de ${post.autor}`}
            onPress={() => {
              if (!convidado) {
                router.push({
                  pathname: '/perfil-publico',
                  params: { id: post.usuario_id }
                } as any);
              }
            }}
          >
            {autorFoto ? (
              <Image
                source={{ uri: autorFoto }}
                style={styles.authorAvatar}
              />
            ) : (
              <View style={styles.authorAvatarPlaceholder}>
                <Ionicons name="person" size={18} color="#777" />
              </View>
            )}

            <View style={{ flex: 1 }}>
              <Text style={styles.authorName} numberOfLines={2}>
                {post.autor}
              </Text>
            </View>
          </TouchableOpacity>

          {podeExcluirPost(post) && (
            <TouchableOpacity
              onPress={() => setMenuPostId(post.id)}
              style={styles.postIconButton}
              accessibilityRole="button"
              accessibilityLabel="Opções da publicação"
              accessibilityHint="Abre o menu administrativo"
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={24}
                color="#2A4B4C"
              />
            </TouchableOpacity>
          )}
        </View>

        {post.midia ? (
          <TouchableOpacity
            activeOpacity={0.96}
            testID={`mural-ampliar-${post.id}`}
            onPress={() => abrirFullscreenNoPost(index, `mural-ampliar-${post.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Ampliar publicação: ${post.titulo}`}
          >
            {post.tipo === 'video' ? (
              <View style={styles.mediaContainerFeed}>
                <View style={styles.videoPlaceholder}>
                  <Ionicons
                    name="play-circle"
                    size={40}
                    color="#fff"
                  />
                  <Text style={styles.videoText}>Vídeo</Text>
                </View>
              </View>
            ) : (
              <ImagemMural
                key={post.midia}
                postId={post.id}
                titulo={post.titulo}
                uri={origemImagem(post.midia)}
              />
            )}
          </TouchableOpacity>
        ) : null}

        <View style={styles.postActionsFooter}>
          {podeInteragir && (
            <TouchableOpacity
              style={styles.postIconButton}
              onPress={() => curtirPost(post.id)}
              accessibilityRole="button"
              accessibilityLabel={
                Platform.OS !== 'web' && curInfo.curtiu
                  ? 'Remover curtida'
                  : 'Curtir publicação'
              }
              {...(Platform.OS === 'web' ? { 'aria-pressed': !!curInfo.curtiu } : { accessibilityState: { selected: !!curInfo.curtiu } })}
            >
              <Ionicons
                name={curInfo.curtiu ? 'heart' : 'heart-outline'}
                size={27}
                color={curInfo.curtiu ? '#E63946' : '#2A4B4C'}
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.postIconButton}
            onPress={() => abrirComentarios(post.id)}
            accessibilityRole="button"
            accessibilityLabel="Ver comentários"
          >
            <Ionicons
              name="chatbubble-outline"
              size={24}
              color="#2A4B4C"
            />
          </TouchableOpacity>

          {podeMarcarInteresse && (
            <TouchableOpacity
              style={[
                styles.postIconButton,
                styles.interesseBotao,
                (!estadoInteresses.pronto ||
                  estadoInteresses.carregando ||
                  estadoInteresses.pendente !== null) &&
                  styles.interesseDesabilitado
              ]}
              disabled={
                !estadoInteresses.pronto ||
                estadoInteresses.carregando ||
                estadoInteresses.pendente !== null
              }
              onPress={() => void alterarInteresse(post.id)}
              accessibilityRole="button"
              accessibilityLabel={
                Platform.OS === 'web' ? 'Interesse na publicação' : estadoInteresses.ids.includes(post.id)
                  ? 'Remover interesse'
                  : 'Tenho interesse'
              }
              aria-busy={estadoInteresses.pendente === post.id}
              {...(Platform.OS === 'web' ? { 'aria-pressed': estadoInteresses.ids.includes(post.id) } : {})}
              accessibilityState={{
                selected: Platform.OS === 'web' ? undefined : estadoInteresses.ids.includes(post.id),
                disabled:
                  !estadoInteresses.pronto ||
                  estadoInteresses.carregando ||
                  estadoInteresses.pendente !== null,
              }}
              testID={`interesse-feed-${post.id}`}
            >
              <Ionicons
                name={
                  estadoInteresses.ids.includes(post.id)
                    ? 'bookmark'
                    : 'bookmark-outline'
                }
                size={26}
                color="#2A4B4C"
              />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.postInfoBox}>
          {podeInteragir && (
            <Text style={styles.postLikesText}>
              {totalCurtidas} {totalCurtidas === 1 ? 'curtida' : 'curtidas'}
            </Text>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            testID={`mural-abrir-${post.id}`}
            onPress={() => abrirFullscreenNoPost(index, `mural-abrir-${post.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Abrir publicação: ${post.titulo}`}
          >
            <Text style={styles.postTitle}>
              {post.titulo}
            </Text>

            {post.descricao ? (
              <Text style={styles.postDesc}>
                {post.descricao}
              </Text>
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.postCommentsLink}
            onPress={() => abrirComentarios(post.id)}
            accessibilityRole="button"
          >
            <Text style={styles.postCommentsText}>
              Ver comentários
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Renderização do Slide Fullscreen Individual (Estilo Reels/TikTok limpo)
  const renderPostFullscreen = ({ item: post, index }: { item: any; index: number }) => {
    const curInfo = postsCurtidas[post.id] || { total: post.totalCurtidas, curtiu: post.curtiuPorMim };
    const autorFoto = post.autor_foto;

    return (
      <View testID={`mural-slide-${post.id}`} aria-hidden={indiceAcessivel !== index}
        importantForAccessibility={indiceAcessivel === index ? 'auto' : 'no-hide-descendants'}
        style={[styles.fullscreenSlide, { height: alturaPagina }]}>
        {/* Camada de Mídia Principal (Ocupa 100% da página; a foto é exibida inteira, sem cortes nem distorção) */}
        <View style={styles.fullscreenMediaLayer}>
          {post.midia ? (
            post.tipo === 'video' ? (
              <View style={styles.videoFullscreenPlaceholder}>
                <Ionicons name="play-circle" size={70} color="#fff" />
                <Text style={styles.videoTextLarge}>Vídeo indisponível nesta versão</Text>
              </View>
            ) : (
              <ImagemMural key={post.midia} postId={post.id} titulo={post.titulo} uri={origemImagem(post.midia)} fullscreen />
            )
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 }}>
              <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', fontWeight: 'bold' }}>{post.titulo}</Text>
            </View>
          )}
        </View>

        {/* Botão de Voltar Flutuante no Topo Esquerdo */}
        <TouchableOpacity
          style={styles.backFullscreenBtn}
          focusable={indiceAcessivel === index}
          onPress={() => setModoFullscreen(false)}
          accessibilityRole="button"
          accessibilityLabel="Voltar para publicações"
          testID="voltar-fullscreen"
        >
          <Ionicons name="arrow-back" size={26} color="#fff" />
        </TouchableOpacity>

        {/* Ícones Flutuantes na Lateral Direita */}
        <View style={[styles.floatingRightControls, alturaPagina < 500 && styles.floatingRightControlsCompact]}>
          {podeInteragir && <TouchableOpacity style={styles.floatingActionClean} onPress={() => curtirPost(post.id)} focusable={indiceAcessivel === index}
            accessibilityRole="button" accessibilityLabel={Platform.OS !== 'web' && curInfo.curtiu ? 'Remover curtida' : 'Curtir publicação'}
            {...(Platform.OS === 'web' ? { 'aria-pressed': !!curInfo.curtiu } : { accessibilityState: { selected: !!curInfo.curtiu } })}>
            <Ionicons name={curInfo.curtiu ? "heart" : "heart-outline"} size={24} color={curInfo.curtiu ? "#FF8089" : "#fff"} style={styles.dropShadow} />
            <Text style={[styles.floatingTextClean, styles.dropShadowText]}>{curInfo.total}</Text>
          </TouchableOpacity>}

          <TouchableOpacity style={styles.floatingActionClean} onPress={() => abrirComentarios(post.id)} focusable={indiceAcessivel === index} accessibilityRole="button" accessibilityLabel="Ver comentários">
            <Ionicons name="chatbubble-outline" size={24} color="#fff" style={styles.dropShadow} />
            <Text style={[styles.floatingTextClean, styles.dropShadowText]}>{podeInteragir ? 'Comentar' : 'Comentários'}</Text>
          </TouchableOpacity>

          {podeMarcarInteresse && (
            <TouchableOpacity
              focusable={indiceAcessivel === index}
              style={[
                styles.floatingActionClean,
                styles.interesseFullscreen,
                (!estadoInteresses.pronto ||
                  estadoInteresses.carregando ||
                  estadoInteresses.pendente !== null) &&
                  styles.interesseDesabilitado
              ]}
              disabled={
                !estadoInteresses.pronto ||
                estadoInteresses.carregando ||
                estadoInteresses.pendente !== null
              }
              onPress={() => {
                if (filtroAtivo === 'interesses') {
                  setModoFullscreen(false);
                  setIndiceInicial(0);
                  indiceAtualRef.current = 0;
                }

                void alterarInteresse(post.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                Platform.OS === 'web' ? 'Interesse na publicação' : estadoInteresses.ids.includes(post.id)
                  ? 'Remover interesse'
                  : 'Tenho interesse'
              }
              aria-busy={estadoInteresses.pendente === post.id}
              {...(Platform.OS === 'web' ? { 'aria-pressed': estadoInteresses.ids.includes(post.id) } : {})}
              accessibilityState={{
                selected: Platform.OS === 'web' ? undefined : estadoInteresses.ids.includes(post.id),
                disabled:
                  !estadoInteresses.pronto ||
                  estadoInteresses.carregando ||
                  estadoInteresses.pendente !== null,
              }}
              testID={`interesse-fullscreen-${post.id}`}
            >
              <Ionicons
                name={
                  estadoInteresses.ids.includes(post.id)
                    ? 'bookmark'
                    : 'bookmark-outline'
                }
                size={24}
                color="#FFFFFF"
                style={styles.dropShadow}
              />
              <Text style={[
                styles.floatingTextClean,
                styles.dropShadowText
              ]}>
                {estadoInteresses.ids.includes(post.id)
                  ? 'Marcado'
                  : 'Interesse'}
              </Text>
            </TouchableOpacity>
          )}


        </View>

        {/* Nome do Autor e Legenda no Rodapé */}
        <View testID="mural-legenda-fullscreen" style={[styles.fullscreenFooterClean, alturaPagina < 500 && styles.fullscreenFooterCompact]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Perfil de ${post.autor}`} disabled={convidado} focusable={indiceAcessivel === index}
            style={styles.authorRowFooter}
            onPress={() => { setModoFullscreen(false); if (!convidado) router.push({ pathname: '/perfil-publico', params: { id: post.usuario_id } } as any); }}
          >
            {autorFoto ? (
              <Image source={{ uri: autorFoto }} style={styles.authorAvatarFooter} />
            ) : (
              <View style={styles.authorAvatarPlaceholderFooter}>
                <Ionicons name="person" size={16} color="#777" />
              </View>
            )}
            <Text style={[styles.authorNameFooter, styles.dropShadowText]}>{post.autor}</Text>
          </TouchableOpacity>

          <Text style={[styles.fullscreenTitle, styles.dropShadowText]} numberOfLines={2}>{post.titulo}</Text>
          {post.local ? <Text style={[styles.fullscreenLocal, styles.dropShadowText]} numberOfLines={1}>📍 {post.local}</Text> : null}
          <Text style={[styles.fullscreenDesc, styles.dropShadowText]} numberOfLines={3}>{post.descricao}</Text>
        </View>
      </View>
    );
  };

  // Se estiver em modo fullscreen, substitui a tela por uma camada independente acima de tudo
  const avisoInteresses = podeMarcarInteresse && estadoInteresses.erro &&
    estadoInteresses.pendente === null ? (
      <TouchableOpacity
        style={[styles.interesseAviso, modoFullscreen && styles.interesseAvisoFullscreen]}
        onPress={() => void tentarCarregarInteresses()}
        accessibilityRole="button"
        accessibilityLabel="Atualizar interesses"
      >
        <Text style={styles.interesseAvisoTexto}>
          {estadoInteresses.erro} Toque para atualizar.
        </Text>
      </TouchableOpacity>
    ) : null;

  const statusInteresses = (
    <Text testID="status-interesses" style={styles.leitorTela}
      aria-live="polite" aria-atomic accessibilityLiveRegion="polite">
      {estadoInteresses.erro || anuncioInteresses}
    </Text>
  );

  if (modoFullscreen && postsVisiveis.length > 0) {
    const indiceDeAbertura = limitarIndice(indiceInicial, postsVisiveis.length);
    const encaixarSlide = (offsetY: number) => {
      const indice = indicePorDeslocamento(offsetY, alturaPagina, postsVisiveis.length);
      indiceAtualRef.current = indice;
      setIndiceAcessivel(indice);
      const alvo = indice * alturaPagina;
      if (Math.abs(offsetY - alvo) > 1) {
        flatListRef.current?.scrollToOffset({ offset: alvo, animated: !reduzirMovimento });
      }
    };

    return (
      <View
        style={styles.fullscreenWrapper}
        onLayout={(e) => {
          // Mede a área real disponível: cada slide, o snap e o getItemLayout usam exatamente essa altura
          const alturaMedida = PixelRatio.roundToNearestPixel(e.nativeEvent.layout.height);
          if (alturaMedida > 0 && Math.abs(alturaMedida - alturaPagina) > 0.5) {
            setIndiceInicial(limitarIndice(indiceAtualRef.current, postsVisiveis.length));
            setAlturaPagina(alturaMedida);
          }
          if (alturaMedida > 0 && !fullscreenMedido) setFullscreenMedido(true);
        }}
      >
        <StatusBar hidden={true} />
        {(Platform.OS === 'web' || fullscreenMedido) && (
          <FlatList
            key={`fullscreen-${alturaPagina}`}
            ref={flatListRef}
            data={postsVisiveis}
            extraData={{ postsCurtidas, estadoInteresses, indiceAcessivel }}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderPostFullscreen}
            pagingEnabled={Platform.OS !== 'web'}
            showsVerticalScrollIndicator={false}
            snapToInterval={alturaPagina}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            bounces={false}
            overScrollMode="never"
            // No navegador, renderiza também o vizinho anterior antes de saltar ao slide escolhido.
            initialScrollIndex={Platform.OS === 'web' ? Math.max(0, indiceDeAbertura - 1) : indiceDeAbertura}
            getItemLayout={(data, index) => ({ length: alturaPagina, offset: alturaPagina * index, index })}
            initialNumToRender={Platform.OS === 'web' ? 3 : 1}
            maxToRenderPerBatch={2}
            windowSize={3}
            scrollEventThrottle={16}
            onContentSizeChange={Platform.OS === 'web' ? () => {
              if (alturaInicialWebRef.current === alturaPagina || !flatListRef.current) return;
              alturaInicialWebRef.current = alturaPagina;
              flatListRef.current.scrollToOffset({ offset: indiceDeAbertura * alturaPagina, animated: false });
            } : undefined}
            onMomentumScrollEnd={Platform.OS === 'web' ? undefined : e => encaixarSlide(e.nativeEvent.contentOffset.y)}
            onScroll={Platform.OS === 'web' ? e => {
              const offsetY = e.nativeEvent.contentOffset.y;
              // O snap obrigatório do navegador também alinha os espaços sem itens da lista virtualizada.
              clearTimeout(timerEncaixeWeb.current);
              timerEncaixeWeb.current = setTimeout(() => encaixarSlide(offsetY), 120);
            } : undefined}
          />
        )}

        {avisoInteresses}
        {statusInteresses}

        {/* MODAL DE COMENTÁRIOS NO MODO FULLSCREEN */}
        <Modal visible={modalComentariosVisivel} accessibilityLabel="Comentários" animationType={reduzirMovimento ? 'none' : Platform.OS === 'web' ? 'fade' : 'slide'} transparent={true} onRequestClose={fecharComentarios}>
          <View style={styles.modalOverlay}>
            <View testID="mural-modal-comentarios" style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{comentarioParaExcluir ? 'Excluir comentário' : 'Comentários'}</Text>
                <TouchableOpacity style={styles.postIconButton} onPress={fecharComentarios} accessibilityRole="button" accessibilityLabel="Fechar comentários">
                  <Ionicons name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>

              {comentarioParaExcluir ? (
                <ScrollView style={styles.confirmacaoComentarioScroll} contentContainerStyle={styles.confirmacaoComentario}>
                  <View style={styles.confirmacaoComentarioIcone}>
                    <Ionicons name="trash-outline" size={25} color="#D84343" />
                  </View>
                  <Text style={styles.confirmacaoComentarioTitulo}>Excluir este comentário?</Text>
                  <Text style={styles.confirmacaoComentarioAutor}>{comentarioParaExcluir.autor}</Text>
                  <View style={styles.confirmacaoComentarioTrecho}>
                    <Text style={styles.confirmacaoComentarioTexto} numberOfLines={3}>{comentarioParaExcluir.texto}</Text>
                  </View>
                  <Text style={styles.confirmacaoComentarioAviso}>
                    As respostas a este comentário também serão removidas.
                  </Text>
                  <View style={styles.confirmacaoComentarioAcoes}>
                    <TouchableOpacity
                      style={styles.cancelarExclusaoComentario}
                      onPress={() => setComentarioParaExcluir(null)}
                      disabled={excluindoComentario}
                      accessibilityRole="button"
                    >
                      <Text style={styles.cancelarExclusaoComentarioTexto}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.confirmarExclusaoComentario, excluindoComentario && { opacity: 0.6 }]}
                      onPress={() => void excluirComentario()}
                      disabled={excluindoComentario}
                      accessibilityRole="button"
                    >
                      <Text style={styles.confirmarExclusaoComentarioTexto}>
                        {excluindoComentario ? 'Excluindo...' : 'Excluir'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                <>
                  {erroComentario ? (
                    <Text accessibilityRole="alert" style={styles.erroComentario}>{erroComentario}</Text>
                  ) : null}
                  {avisoComentario ? (
                    <Text accessibilityRole="alert" style={styles.avisoComentario}>{avisoComentario}</Text>
                  ) : null}
                  <ScrollView style={styles.listaComentarios}>
                {comentarios.length === 0 ? (
                  <Text style={styles.emptyComentarios}>{podeInteragir ? 'Nenhum comentário ainda. Seja o primeiro a comentar!' : 'Nenhum comentário disponível.'}</Text>
                ) : (
                  comentarios.map((c) => {
                    const comCur = comentariosCurtidas[c.id] || { total: parseInt(c.total_curtidas) || 0, curtiu: c.curtiu_por_mim };

                    return (
                      <View key={c.id} style={[styles.comentarioItem, c.parent_id && { marginLeft: 25, borderLeftWidth: 2, borderLeftColor: '#2A4B4C', paddingLeft: 10 }]}>
                        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2}}>
                          <Text style={styles.comentarioAutor}>{c.autor}</Text>
                          {podeInteragir && <TouchableOpacity style={styles.curtidaComentario} onPress={() => curtirComentario(c.id)}
                            accessibilityRole="button" accessibilityLabel={`Curtir comentário de ${c.autor}`}
                            {...(Platform.OS === 'web' ? { 'aria-pressed': !!comCur.curtiu } : { accessibilityState: { selected: !!comCur.curtiu } })}>
                            <Ionicons name={comCur.curtiu ? "heart" : "heart-outline"} size={16} color={comCur.curtiu ? "#E63946" : "#777"} />
                            <Text style={{fontSize: 12, color: '#777', marginLeft: 4}}>{comCur.total}</Text>
                          </TouchableOpacity>}
                        </View>
                        <Text style={styles.comentarioTexto}>{c.texto}</Text>

                        <View style={styles.comentarioAcoes}>
                          {podeInteragir && <TouchableOpacity onPress={() => setRespostaPara(c)} disabled={excluindoComentario} accessibilityRole="button">
                            <Text style={styles.responderText}>Responder</Text>
                          </TouchableOpacity>}
                          {podeExcluirComentario(c) && <TouchableOpacity
                            onPress={() => iniciarExclusaoComentario(c)}
                            disabled={excluindoComentario}
                            accessibilityRole="button"
                            accessibilityLabel={`Excluir comentário de ${c.autor}`}
                          >
                            <Text style={styles.excluirComentarioText}>Excluir</Text>
                          </TouchableOpacity>}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {respostaPara && (
                <View style={styles.respondendoBox}>
                  <Text style={styles.respondendoText}>Respondendo a {respostaPara.autor}</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancelar resposta" onPress={() => setRespostaPara(null)}>
                    <Ionicons name="close-circle" size={16} color="#E63946" />
                  </TouchableOpacity>
                </View>
              )}

              {podeInteragir && <View style={styles.comentarioInputRow}>
                <TextInput
                  style={styles.comentarioInput}
                  placeholder="Escreva um comentário..."
                  accessibilityLabel="Escreva um comentário"
                  placeholderTextColor="#666"
                  value={textoComentario}
                  onChangeText={setTextoComentario}
                />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Enviar comentário" style={styles.enviarComentarioBtn} onPress={enviarComentario}>
                  <Ionicons name="send" size={18} color="#fff" />
                </TouchableOpacity>
              </View>}
                </>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text accessibilityRole="header" style={styles.headerTitle}>
            Eventos
          </Text>
          <Text style={styles.headerSubtitle}>
            Fique por dentro das novidades
          </Text>
        </View>
        {Platform.OS === 'web' && podeMarcarInteresse ? (
          <TouchableOpacity
            style={[styles.filterChip, styles.filtroInteresses]}
            accessibilityRole="button"
            accessibilityLabel="Sincronizar interesses"
            aria-busy={estadoInteresses.carregando}
            disabled={
              (!estadoInteresses.pronto && !estadoInteresses.erro) ||
              estadoInteresses.carregando ||
              estadoInteresses.pendente !== null
            }
            onPress={() => void tentarCarregarInteresses()}
          >
            <Ionicons name="refresh-outline" size={23} color="#2A4B4C" />
          </TouchableOpacity>
        ) : (
          <Ionicons
            name="newspaper-outline"
            size={38}
            color="#C4C2B7"
            style={styles.headerIcon}
          />
        )}
      </View>

      <View style={styles.filterBar}>
        <TouchableOpacity
          testID="filtro-todos"
          style={[
            styles.filterChip,
            filtroAtivo === 'todos' && styles.filterChipActive
          ]}
          onPress={() => alterarFiltro('todos')}
          accessibilityRole="button"
          {...(Platform.OS === 'web' ? { 'aria-pressed': filtroAtivo === 'todos' } : { accessibilityState: { selected: filtroAtivo === 'todos' } })}
        >
          <Text style={[
            styles.filterText,
            filtroAtivo === 'todos' && styles.filterTextActive
          ]}>Todos</Text>
        </TouchableOpacity>

        {filtroDisponivel && (
          <TouchableOpacity
            style={[
              styles.filterChip,
              filtroAtivo === 'minha' && styles.filterChipActive
            ]}
            onPress={() => alterarFiltro('minha')}
            accessibilityRole="button"
            accessibilityLabel="Minha congregação"
            {...(Platform.OS === 'web' ? { 'aria-pressed': filtroAtivo === 'minha' } : { accessibilityState: { selected: filtroAtivo === 'minha' } })}
          >
            <Ionicons
              name="people-outline"
              size={17}
              color={filtroAtivo === 'minha' ? '#FFFFFF' : '#2A4B4C'}
            />
            <Text style={[
              styles.filterText,
              filtroAtivo === 'minha' && styles.filterTextActive
            ]}>Minha congregação</Text>
          </TouchableOpacity>
        )}
        {podeMarcarInteresse && (
          <TouchableOpacity
            style={[
              styles.filterChip,
              styles.filtroInteresses,
              filtroAtivo === 'interesses' && styles.filterChipActive
            ]}
            onPress={() => alterarFiltro('interesses')}
            accessibilityRole="button"
            accessibilityLabel="Filtrar meus interesses"
            {...(Platform.OS === 'web' ? { 'aria-pressed': filtroAtivo === 'interesses' } : { accessibilityState: { selected: filtroAtivo === 'interesses' } })}
            testID="filtro-interesses"
          >
            <Ionicons
              name={
                filtroAtivo === 'interesses'
                  ? 'bookmark'
                  : 'bookmark-outline'
              }
              size={21}
              color={
                filtroAtivo === 'interesses'
                  ? '#FFFFFF'
                  : '#2A4B4C'
              }
            />
          </TouchableOpacity>
        )}

        {usuarioLogado && !convidado && canManage(usuarioLogado) && (
          <TouchableOpacity
            onPress={() => router.push('/criar-post' as any)}
            style={styles.newPostBtn}
            accessibilityRole="button"
            accessibilityLabel="Nova publicação"
            accessibilityHint="Abre a tela de criação de publicação"
          >
            <Ionicons name="add" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {avisoInteresses}
      {statusInteresses}

      {carregando ? (
        <ActivityIndicator accessibilityLabel="Carregando publicações" size="large" color="#2A4B4C" style={{ marginTop: 50 }} />
      ) : erroCarregamento && posts.length === 0 ? (
        <View style={[styles.emptyBox, alturaJanela <= 600 && styles.emptyBoxCompact]}>
          <Ionicons name="cloud-offline-outline" size={50} color="#C4C2B7" />
          <Text accessibilityRole="alert" style={styles.emptyText}>{erroCarregamento}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => { setCarregando(true); void buscarPosts(); }} accessibilityRole="button">
            <Text style={styles.retryText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={postsVisiveis}
          extraData={estadoInteresses}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderPostFeed}
          ListEmptyComponent={
            <View style={[styles.emptyBox, alturaJanela <= 600 && styles.emptyBoxCompact]}>
              <Ionicons
                name={
                  filtroAtivo === 'interesses'
                    ? 'bookmark-outline'
                    : 'newspaper-outline'
                }
                size={50}
                color="#C4C2B7"
              />
              <Text style={styles.emptyText}>
                {filtroAtivo === 'interesses'
                  ? !estadoInteresses.pronto
                    ? estadoInteresses.erro
                      ? 'Não foi possível carregar seus interesses.'
                      : 'Carregando seus interesses...'
                    : 'Você ainda não marcou nenhuma publicação com interesse.'
                  : filtroAtivo === 'minha'
                    ? 'Nenhuma publicação da sua congregação no momento.'
                    : 'Nenhum evento publicado no momento.'}
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={onRefresh}
                disabled={refreshing}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>
                  {refreshing ? 'Atualizando...' : 'Atualizar publicações'}
                </Text>
              </TouchableOpacity>
            </View>
          }
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={5}
          contentContainerStyle={{ padding: 15, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2A4B4C']} tintColor={'#2A4B4C'} />
          }
        />
      )}

      <Modal
        visible={menuDisponivel}
        transparent
        animationType={reduzirMovimento ? 'none' : 'fade'}
        accessibilityLabel="Opções da publicação"
        onShow={() => {
          if (Platform.OS === 'web') document.querySelector<HTMLElement>('[data-testid="mural-cancelar-menu"]')?.focus();
        }}
        onRequestClose={() => setMenuPostId(null)}
      >
        <View style={styles.postMenuOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setMenuPostId(null)}
            accessible={false}
            focusable={false}
          />

          <View testID="mural-menu-publicacao" style={styles.postMenuPanel}>
            <View style={styles.postMenuHandle} />

            <Text style={styles.postMenuTitle}>
              Opções da publicação
            </Text>

            <Text
              style={styles.postMenuSubtitle}
              numberOfLines={2}
            >
              {postMenu?.titulo}
            </Text>

            <TouchableOpacity
              style={styles.postMenuDelete}
              accessibilityRole="button"
              onPress={() => {
                if (!postMenu || !podeExcluirPost(postMenu)) {
                  setMenuPostId(null);
                  return;
                }

                setMenuPostId(null);
                void excluirPost(postMenu.id);
              }}
            >
              <Ionicons
                name="trash-outline"
                size={23}
                color="#B83E43"
              />
              <Text style={styles.postMenuDeleteText}>
                Excluir publicação
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.postMenuCancel}
              testID="mural-cancelar-menu"
              onPress={() => setMenuPostId(null)}
              accessibilityRole="button"
            >
              <Text style={styles.postMenuCancelText}>
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL DE COMENTÁRIOS NO FEED NORMAL */}
      <Modal visible={modalComentariosVisivel} accessibilityLabel="Comentários" animationType={reduzirMovimento ? 'none' : Platform.OS === 'web' ? 'fade' : 'slide'} transparent={true} onRequestClose={fecharComentarios}>
        <View style={styles.modalOverlay}>
          <View testID="mural-modal-comentarios" style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{comentarioParaExcluir ? 'Excluir comentário' : 'Comentários'}</Text>
              <TouchableOpacity style={styles.postIconButton} onPress={fecharComentarios} accessibilityRole="button" accessibilityLabel="Fechar comentários">
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {comentarioParaExcluir ? (
                <ScrollView style={styles.confirmacaoComentarioScroll} contentContainerStyle={styles.confirmacaoComentario}>
                  <View style={styles.confirmacaoComentarioIcone}>
                    <Ionicons name="trash-outline" size={25} color="#D84343" />
                  </View>
                  <Text style={styles.confirmacaoComentarioTitulo}>Excluir este comentário?</Text>
                  <Text style={styles.confirmacaoComentarioAutor}>{comentarioParaExcluir.autor}</Text>
                  <View style={styles.confirmacaoComentarioTrecho}>
                    <Text style={styles.confirmacaoComentarioTexto} numberOfLines={3}>{comentarioParaExcluir.texto}</Text>
                  </View>
                  <Text style={styles.confirmacaoComentarioAviso}>
                    As respostas a este comentário também serão removidas.
                  </Text>
                  <View style={styles.confirmacaoComentarioAcoes}>
                    <TouchableOpacity
                      style={styles.cancelarExclusaoComentario}
                      onPress={() => setComentarioParaExcluir(null)}
                      disabled={excluindoComentario}
                      accessibilityRole="button"
                    >
                      <Text style={styles.cancelarExclusaoComentarioTexto}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.confirmarExclusaoComentario, excluindoComentario && { opacity: 0.6 }]}
                      onPress={() => void excluirComentario()}
                      disabled={excluindoComentario}
                      accessibilityRole="button"
                    >
                      <Text style={styles.confirmarExclusaoComentarioTexto}>
                        {excluindoComentario ? 'Excluindo...' : 'Excluir'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                <>
                  {erroComentario ? (
                    <Text accessibilityRole="alert" style={styles.erroComentario}>{erroComentario}</Text>
                  ) : null}
                  {avisoComentario ? (
                    <Text accessibilityRole="alert" style={styles.avisoComentario}>{avisoComentario}</Text>
                  ) : null}
                <ScrollView style={styles.listaComentarios}>
              {comentarios.length === 0 ? (
                <Text style={styles.emptyComentarios}>{podeInteragir ? 'Nenhum comentário ainda. Seja o primeiro a comentar!' : 'Nenhum comentário disponível.'}</Text>
              ) : (
                comentarios.map((c) => {
                  const comCur = comentariosCurtidas[c.id] || { total: parseInt(c.total_curtidas) || 0, curtiu: c.curtiu_por_mim };

                  return (
                    <View key={c.id} style={[styles.comentarioItem, c.parent_id && { marginLeft: 25, borderLeftWidth: 2, borderLeftColor: '#2A4B4C', paddingLeft: 10 }]}>
                      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2}}>
                        <Text style={styles.comentarioAutor}>{c.autor}</Text>
                        {podeInteragir && <TouchableOpacity style={styles.curtidaComentario} onPress={() => curtirComentario(c.id)}
                          accessibilityRole="button" accessibilityLabel={`Curtir comentário de ${c.autor}`}
                          {...(Platform.OS === 'web' ? { 'aria-pressed': !!comCur.curtiu } : { accessibilityState: { selected: !!comCur.curtiu } })}>
                          <Ionicons name={comCur.curtiu ? "heart" : "heart-outline"} size={16} color={comCur.curtiu ? "#E63946" : "#777"} />
                          <Text style={{fontSize: 12, color: '#777', marginLeft: 4}}>{comCur.total}</Text>
                        </TouchableOpacity>}
                      </View>
                      <Text style={styles.comentarioTexto}>{c.texto}</Text>

                      <View style={styles.comentarioAcoes}>
                        {podeInteragir && <TouchableOpacity onPress={() => setRespostaPara(c)} disabled={excluindoComentario} accessibilityRole="button">
                          <Text style={styles.responderText}>Responder</Text>
                        </TouchableOpacity>}
                        {podeExcluirComentario(c) && <TouchableOpacity
                          onPress={() => iniciarExclusaoComentario(c)}
                          disabled={excluindoComentario}
                          accessibilityRole="button"
                          accessibilityLabel={`Excluir comentário de ${c.autor}`}
                        >
                          <Text style={styles.excluirComentarioText}>Excluir</Text>
                        </TouchableOpacity>}
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {respostaPara && (
              <View style={styles.respondendoBox}>
                <Text style={styles.respondendoText}>Respondendo a {respostaPara.autor}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancelar resposta" onPress={() => setRespostaPara(null)}>
                  <Ionicons name="close-circle" size={16} color="#E63946" />
                </TouchableOpacity>
              </View>
            )}

            {podeInteragir && <View style={styles.comentarioInputRow}>
              <TextInput
                style={styles.comentarioInput}
                placeholder="Escreva um comentário..."
                accessibilityLabel="Escreva um comentário"
                placeholderTextColor="#666"
                value={textoComentario}
                onChangeText={setTextoComentario}
              />
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Enviar comentário" style={styles.enviarComentarioBtn} onPress={enviarComentario}>
                <Ionicons name="send" size={18} color="#fff" />
              </TouchableOpacity>
            </View>}
                </>
              )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  leitorTela: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: {
    backgroundColor: '#2A4B4C',
    paddingTop: 48,
    paddingBottom: 20,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },

  headerContent: {
    flex: 1,
  },

  headerTitle: {
    color: '#F7F5EC',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  headerSubtitle: {
    color: '#E2EAE9',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },

  headerIcon: {
    opacity: 0.8,
  },

  filterBar: {
    width: '100%',
    maxWidth: 670,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 15,
    paddingTop: 14,
    gap: 8,
  },

  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: '#E2EAE9',
    gap: 6,
  },

  filterChipActive: {
    backgroundColor: '#2A4B4C',
  },

  filterText: {
    color: '#2A4B4C',
    fontSize: 13,
    fontWeight: '600',
  },

  filterTextActive: {
    color: '#FFFFFF',
  },

  newPostBtn: {
    backgroundColor: '#2A4B4C',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },

  bannerNovosPosts: { backgroundColor: '#2A4B4C', paddingVertical: 10, paddingHorizontal: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 3 },
  bannerNovosPostsText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  emptyBox: { alignItems: 'center', marginTop: 50, padding: 20 },
  emptyBoxCompact: { marginTop: 16, paddingVertical: 12 },
  emptyText: { color: '#666', fontSize: 14, marginTop: 10 },
  retryButton: { backgroundColor: '#2A4B4C', marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold' },

  // Estilos Feed Normal
  postCard: { backgroundColor: '#fff', borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E2EAE9', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  // No navegador o feed deve ter largura de leitura, sem esticar fotos pela tela inteira.
  // Em celulares preservamos o layout anterior.
  postCardWeb: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  postHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  authorContainer: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  authorAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: '#2A4B4C' },
  authorAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  authorName: { fontSize: 15, fontWeight: 'bold', color: '#2A4B4C' },

  postInfoBox: { paddingHorizontal: 15, paddingTop: 2, paddingBottom: 8 },
  postTitle: { fontSize: 16, fontWeight: '700', color: '#2A4B4C', marginBottom: 5 },
  postLocal: { fontSize: 13, color: '#666', marginBottom: 4 },
  postDesc: { fontSize: 14, color: '#444', lineHeight: 20 },

  // Vídeo no feed (comportamento original mantido)
  mediaContainerFeed: { width: '100%', height: 220, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  // Imagem no feed: largura total; a altura vem da proporção real (aspectRatio definido em ImagemFeed)
  mediaImagemFeed: { width: '100%', backgroundColor: '#E2EAE9', overflow: 'hidden' },
  mediaContentFeed: { width: '100%', height: '100%' },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', width: '100%' },
  videoText: { color: '#fff', marginTop: 6, fontSize: 13 },

  postActionsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 5,
    paddingBottom: 2,
    gap: 4,
  },

  postIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  interesseFullscreen: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  filtroInteresses: {
    width: 44,
    height: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  interesseBotao: {
    marginLeft: 'auto',
  },

  interesseDesabilitado: {
    opacity: 0.45,
  },

  interesseAviso: {
    paddingHorizontal: 15,
    paddingVertical: 8,
  },

  interesseAvisoFullscreen: {
    position: 'absolute',
    top: 50,
    left: 72,
    right: 16,
    zIndex: 30,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
  },

  interesseAvisoTexto: {
    color: '#9B3434',
    fontSize: 12,
  },

  postLikesText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2A4B4C',
    marginBottom: 8,
  },

  postCommentsLink: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: 2,
  },

  postCommentsText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },

  postMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },

  postMenuPanel: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    paddingBottom: 30,
  },

  postMenuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C4C2B7',
    alignSelf: 'center',
    marginBottom: 20,
  },

  postMenuTitle: {
    color: '#2A4B4C',
    fontSize: 18,
    fontWeight: '700',
  },

  postMenuSubtitle: {
    color: '#666',
    fontSize: 13,
    marginTop: 5,
    marginBottom: 18,
  },

  postMenuDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 15,
    backgroundColor: '#FFF1F1',
    borderRadius: 12,
  },

  postMenuDeleteText: {
    color: '#B83E43',
    fontSize: 15,
    fontWeight: '600',
  },

  postMenuCancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2EAE9',
    borderRadius: 12,
    marginTop: 12,
  },

  postMenuCancelText: {
    color: '#2A4B4C',
    fontSize: 14,
    fontWeight: '600',
  },

  // Estilos do Modo Fullscreen
  fullscreenWrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 9999 },
  // A altura de cada slide é definida em tempo de execução (altura real medida da tela)
  fullscreenSlide: { alignSelf: 'stretch', backgroundColor: '#000', position: 'relative', justifyContent: 'center', alignItems: 'center' },

  fullscreenMediaLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  fullscreenImage: { width: '100%', height: '100%' },
  videoFullscreenPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', width: '100%', height: '100%' },
  videoTextLarge: { color: '#fff', marginTop: 10, fontSize: 16, fontWeight: 'bold' },

  backFullscreenBtn: { position: 'absolute', top: 50, left: 20, zIndex: 30, backgroundColor: 'rgba(0,0,0,0.72)', minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 9, borderRadius: 25 },

  floatingRightControls: { position: 'absolute', right: 16, bottom: 160, zIndex: 20, alignItems: 'center', gap: 12 },
  floatingRightControlsCompact: { bottom: 24, gap: 4 },
  floatingActionClean: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 10 },
  floatingTextClean: { color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 3 },

  dropShadow: { textShadowColor: 'rgba(0, 0, 0, 0.75)', textShadowOffset: { width: -1, height: 1 }, textShadowRadius: 5 },
  dropShadowText: { color: '#fff', textShadowColor: 'rgba(0, 0, 0, 0.8)', textShadowOffset: { width: -1, height: 1 }, textShadowRadius: 4 },

  fullscreenFooterClean: { position: 'absolute', bottom: 0, left: 0, right: 84, paddingHorizontal: 20, paddingBottom: 45, paddingTop: 16, zIndex: 20, backgroundColor: 'rgba(0,0,0,0.72)' },
  fullscreenFooterCompact: { paddingBottom: 20, paddingTop: 8 },
  authorRowFooter: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  authorAvatarFooter: { width: 36, height: 36, borderRadius: 18, marginRight: 10, borderWidth: 1, borderColor: '#fff' },
  authorAvatarPlaceholderFooter: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  authorNameFooter: { fontSize: 16, fontWeight: 'bold' },
  fullscreenTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 2 },
  fullscreenLocal: { fontSize: 13, marginBottom: 4 },
  fullscreenDesc: { fontSize: 14, lineHeight: 19 },

  // Modal Comentários
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, width: '100%', maxWidth: 640, alignSelf: 'center', maxHeight: '85%', elevation: 5 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2A4B4C' },
  listaComentarios: { maxHeight: 320, minHeight: 0, flexShrink: 1, marginBottom: 15 },
  emptyComentarios: { color: '#666', fontSize: 13, textAlign: 'center', marginVertical: 20 },
  comentarioItem: { backgroundColor: '#F9F9F6', padding: 10, borderRadius: 8, marginBottom: 8 },
  comentarioAutor: { fontSize: 13, fontWeight: 'bold', color: '#2A4B4C' },
  curtidaComentario: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 },
  comentarioTexto: { fontSize: 14, color: '#333', marginTop: 2 },
  responderText: { fontSize: 11, color: '#2A4B4C', fontWeight: 'bold' },
  comentarioAcoes: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 7 },
  excluirComentarioText: { fontSize: 11, fontWeight: 'bold', color: '#B83E43' },
  erroComentario: { backgroundColor: '#FFE8E9', color: '#A22C33', padding: 10, borderRadius: 9, marginBottom: 12, fontSize: 13 },
  avisoComentario: { backgroundColor: '#E2EAE9', color: '#2A4B4C', padding: 10, borderRadius: 9, marginBottom: 12, fontSize: 13 },
  confirmacaoComentarioScroll: { minHeight: 0, flexShrink: 1, flexGrow: 0 },
  confirmacaoComentario: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  confirmacaoComentarioIcone: { backgroundColor: '#FFE8E9', borderRadius: 28, width: 56, height: 56, justifyContent: 'center', alignItems: 'center' },
  confirmacaoComentarioTitulo: { fontSize: 18, fontWeight: '700', color: '#2A4B4C', textAlign: 'center' },
  confirmacaoComentarioAutor: { fontSize: 13, fontWeight: '700', color: '#2A4B4C' },
  confirmacaoComentarioTrecho: { backgroundColor: '#F7F5EC', padding: 12, borderRadius: 9, alignSelf: 'stretch' },
  confirmacaoComentarioTexto: { fontSize: 14, lineHeight: 19, textAlign: 'center', color: '#444' },
  confirmacaoComentarioAviso: { fontSize: 12, textAlign: 'center', color: '#78634D', marginBottom: 8 },
  confirmacaoComentarioAcoes: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  cancelarExclusaoComentario: { flex: 1, backgroundColor: '#E2EAE9', borderRadius: 12, minHeight: 45, alignItems: 'center', justifyContent: 'center' },
  cancelarExclusaoComentarioTexto: { color: '#2A4B4C', fontWeight: '700' },
  confirmarExclusaoComentario: { flex: 1, backgroundColor: '#B83E43', borderRadius: 12, minHeight: 45, alignItems: 'center', justifyContent: 'center' },
  confirmarExclusaoComentarioTexto: { color: '#FFFFFF', fontWeight: '700' },
  respondendoBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E2EAE9', padding: 6, borderRadius: 6, marginBottom: 8 },
  respondendoText: { fontSize: 12, color: '#2A4B4C' },
  comentarioInputRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  comentarioInput: { flex: 1, backgroundColor: '#F0F0F0', padding: 10, borderRadius: 8, fontSize: 14, color: '#333' },
  enviarComentarioBtn: { backgroundColor: '#2A4B4C', minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', padding: 10, borderRadius: 8, marginLeft: 8 }
});
