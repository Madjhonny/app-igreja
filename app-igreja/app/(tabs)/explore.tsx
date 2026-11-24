import { useAppDialog } from '@/components/app-dialog';
import { apiUrl, apiFetch, authenticatedFetch, canInteract, canManage, isGuestMode, refreshSession } from '@/services/session';
import { useSessionUser } from '@/hooks/use-session-user';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, ScrollView, TextInput, Modal, ActivityIndicator, Dimensions, FlatList, RefreshControl, StatusBar, BackHandler, PixelRatio, Platform } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage, type ImageLoadEventData } from 'expo-image';
import { imageAspectRatio, optimizedMuralUrl } from '@/services/mural-image';
import { filtrarPublicacoes, podeFiltrarCongregacao, type FiltroMural } from '@/services/mural-feed';
import { indiceValido, limitarIndice, indicePorDeslocamento } from '@/services/mural-navigation';

// Altura da janela usada apenas como valor inicial; no fullscreen a altura real é medida via onLayout
const { height } = Dimensions.get('window');

// Compatibilidade com URLs temporárias relativas da API e imagens antigas em Data URI.
const origemImagem = (valor: string) => valor.startsWith('/') ? apiUrl(valor) : valor;

// Limita o cache de proporções às últimas 100 imagens, sem cache persistente de links assinados.
const proporcoesCache = new Map<number, { uri: string; razao: number }>();

const ImagemMural = React.memo(function ImagemMural({ postId, uri, fullscreen = false }: { postId: number; uri: string; fullscreen?: boolean }) {
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
    style={fullscreen ? styles.fullscreenImage : styles.mediaContentFeed}
    contentFit="contain"
    cachePolicy={otimizada !== uri ? 'memory-disk' : 'none'}
    recyclingKey={fonte}
    onLoad={onLoad}
    onError={() => { if (!fallback && otimizada !== uri) setFallback(true); }}
  />;
  return fullscreen ? imagem : <View style={[styles.mediaImagemFeed, { aspectRatio: razao }]}>{imagem}</View>;
});

export default function TelaEventos() {
  const { alert: mostrarDialogo } = useAppDialog();
  const [posts, setPosts] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erroCarregamento, setErroCarregamento] = useState('');
  
  const [usuarioLogado, setUsuarioLogado] = useSessionUser();
  const [convidado, setConvidado] = useState(false);
  const [filtro, setFiltro] = useState<FiltroMural>('todos');

  // Controle do modo Fullscreen e navegação por slides
  const [modoFullscreen, setModoFullscreen] = useState(false);
  const [indiceInicial, setIndiceInicial] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const navigation = useNavigation();

  // Medidas reais da área do fullscreen (cada slide ocupa exatamente uma "página")
  const [alturaPagina, setAlturaPagina] = useState(height);
  const [fullscreenMedido, setFullscreenMedido] = useState(false);
  // Na Web, o onLayout inicial pode não disparar quando a camada é absoluta.
  // A lista já pode usar a altura inicial da janela sem aguardar essa medição.
  // Índice do slide visível (usado como ponto de partida ao abrir e se a lista precisar ser recriada)
  const indiceAtualRef = useRef(0);

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

  // Oculta completamente a barra inferior de navegação do aplicativo ao entrar no modo Fullscreen
  useEffect(() => {
    const parentNav = navigation.getParent();
    if (parentNav) {
      parentNav.setOptions({
        tabBarStyle: { display: modoFullscreen ? 'none' : 'flex' }
      });
    }
  }, [modoFullscreen, navigation]);

  const buscarPosts = useCallback(async (isRefresh = false) => {
    // Mantem os eventos visiveis ao retornar para a aba.
    setErroCarregamento('');
    try {
      const modoConvidado = await isGuestMode();
      const resposta = modoConvidado
        ? await apiFetch('/publico/mural')
        : await authenticatedFetch('/mural?midia=link');
      if (resposta.ok) {
        const dados = await resposta.json();
        setPosts(dados);

        const mapCurtidas: { [key: number]: { total: number, curtiu: boolean } } = {};
        dados.forEach((p: any) => {
          mapCurtidas[p.id] = { total: p.totalCurtidas, curtiu: p.curtiuPorMim };
        });
        setPostsCurtidas(mapCurtidas);
      } else {
        const dados = await resposta.json().catch(() => ({}));
        setErroCarregamento(dados.erro || 'Não foi possível carregar as publicações.');
      }
    } catch {
      setErroCarregamento('Falha de conexão. Verifique sua internet e tente novamente.');
    } finally {
      if (!isRefresh) setCarregando(false);
      setRefreshing(false);
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

        if (ativo) await buscarPosts(false);
      } catch {
        if (ativo) setErroCarregamento('Falha de conexão. Verifique sua internet e tente novamente.');
      }
    })();
    return () => { ativo = false; };
  }, [buscarPosts, setUsuarioLogado]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void buscarPosts(true);
  }, [buscarPosts]);

  const podeInteragir = !convidado && canInteract(usuarioLogado);

  const congregacaoId = usuarioLogado?.congregacao_id;
  const filtroDisponivel = podeFiltrarCongregacao(congregacaoId, convidado);
  const filtroAtivo = filtroDisponivel ? filtro : 'todos';

  const postsVisiveis = React.useMemo(
    () => filtrarPublicacoes(posts, filtroAtivo, congregacaoId, convidado),
    [posts, filtroAtivo, congregacaoId, convidado]
  );

  // Reinicia a selecao quando o contexto da sessao muda.
  const contextoFiltro = JSON.stringify([
    usuarioLogado?.id ?? null,
    congregacaoId ?? null,
    convidado
  ]);

  const [contextoAnterior, setContextoAnterior] = useState(contextoFiltro);

  if (contextoAnterior !== contextoFiltro) {
    setContextoAnterior(contextoFiltro);
    setFiltro('todos');
    setModoFullscreen(false);
    setIndiceInicial(0);
  } else if (modoFullscreen && postsVisiveis.length === 0) {
    setModoFullscreen(false);
    setIndiceInicial(0);
  }

  const alterarFiltro = (novoFiltro: FiltroMural) => {
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
    if (!usuarioLogado || !canManage(usuarioLogado)) return false;
    if (usuarioLogado.nivel_acesso === 'MASTER') return true;
    if (usuarioLogado.nivel_acesso === 'ADMIN' && post.congregacao_id === usuarioLogado.congregacao_id) return true;
    return false;
  };

  const abrirFullscreenNoPost = (index: number) => {
    if (!indiceValido(index, postsVisiveis.length)) return;
    indiceAtualRef.current = index;
    setIndiceInicial(index);
    setModoFullscreen(true);
  };

  // Renderização da lista principal (feed tradicional)
  const renderPostFeed = ({ item: post, index }: { item: any, index: number }) => {
    const curInfo = postsCurtidas[post.id] || { total: post.totalCurtidas, curtiu: post.curtiuPorMim };
    const autorFoto = post.autor_foto;

    return (
      <TouchableOpacity style={[styles.postCard, Platform.OS === 'web' && styles.postCardWeb]} activeOpacity={0.95} onPress={() => abrirFullscreenNoPost(index)}>
        <View style={styles.postHeader}>
          <TouchableOpacity 
            style={styles.authorContainer} 
            onPress={(e) => { e.stopPropagation(); if (!convidado) router.push({ pathname: '/perfil-publico', params: { id: post.usuario_id } } as any); }}
          >
            {autorFoto ? (
              <Image source={{ uri: autorFoto }} style={styles.authorAvatar} />
            ) : (
              <View style={styles.authorAvatarPlaceholder}>
                <Ionicons name="person" size={18} color="#777" />
              </View>
            )}
            <View>
              <Text style={styles.authorName}>{post.autor}</Text>
            </View>
          </TouchableOpacity>

          {podeExcluirPost(post) && (
            <TouchableOpacity onPress={(e) => { e.stopPropagation(); excluirPost(post.id); }} style={{ padding: 5 }}>
              <Ionicons name="trash-outline" size={18} color="#E63946" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.postInfoBox}>
          <Text style={styles.postTitle}>{post.titulo}</Text>
          {post.local ? <Text style={styles.postLocal}>📍 {post.local}</Text> : null}
          <Text style={styles.postDesc} numberOfLines={2}>{post.descricao}</Text>
        </View>

        {post.midia ? (
          post.tipo === 'video' ? (
            <View style={styles.mediaContainerFeed}>
              <View style={styles.videoPlaceholder}>
                <Ionicons name="play-circle" size={40} color="#fff" />
                <Text style={styles.videoText}>Vídeo</Text>
              </View>
            </View>
          ) : (
            <ImagemMural key={post.midia} postId={post.id} uri={origemImagem(post.midia)} />
          )
        ) : null}

        <View style={styles.postActionsFooter} onStartShouldSetResponder={() => true}>
          {podeInteragir && <TouchableOpacity style={styles.actionButton} onPress={() => curtirPost(post.id)} accessibilityRole="button" accessibilityLabel="Curtir publicação">
            <Ionicons name={curInfo.curtiu ? "heart" : "heart-outline"} size={22} color={curInfo.curtiu ? "#E63946" : "#444"} />
            <Text style={[styles.actionCount, curInfo.curtiu && { color: '#E63946', fontWeight: 'bold' }]}>
              {curInfo.total}
            </Text>
          </TouchableOpacity>}

          <TouchableOpacity style={styles.actionButton} onPress={() => abrirComentarios(post.id)} accessibilityRole="button" accessibilityLabel="Ver comentários">
            <Ionicons name="chatbubble-outline" size={20} color="#444" />
            <Text style={styles.actionCount}>{podeInteragir ? 'Comentar' : 'Ver comentários'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // Renderização do Slide Fullscreen Individual (Estilo Reels/TikTok limpo)
  const renderPostFullscreen = ({ item: post }: { item: any }) => {
    const curInfo = postsCurtidas[post.id] || { total: post.totalCurtidas, curtiu: post.curtiuPorMim };
    const autorFoto = post.autor_foto;

    return (
      <View style={[styles.fullscreenSlide, { height: alturaPagina }]}>
        {/* Camada de Mídia Principal (Ocupa 100% da página; a foto é exibida inteira, sem cortes nem distorção) */}
        <View style={styles.fullscreenMediaLayer}>
          {post.midia ? (
            post.tipo === 'video' ? (
              <View style={styles.videoFullscreenPlaceholder}>
                <Ionicons name="play-circle" size={70} color="#fff" />
                <Text style={styles.videoTextLarge}>Vídeo indisponível nesta versão</Text>
              </View>
            ) : (
              <ImagemMural key={post.midia} postId={post.id} uri={origemImagem(post.midia)} fullscreen />
            )
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 }}>
              <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', fontWeight: 'bold' }}>{post.titulo}</Text>
            </View>
          )}
        </View>

        {/* Botão de Voltar Flutuante no Topo Esquerdo */}
        <TouchableOpacity style={styles.backFullscreenBtn} onPress={() => setModoFullscreen(false)}>
          <Ionicons name="arrow-back" size={26} color="#fff" />
        </TouchableOpacity>

        {/* Ícones Flutuantes na Lateral Direita */}
        <View style={styles.floatingRightControls}>
          {podeInteragir && <TouchableOpacity style={styles.floatingActionClean} onPress={() => curtirPost(post.id)} accessibilityRole="button" accessibilityLabel="Curtir publicação">
            <Ionicons name={curInfo.curtiu ? "heart" : "heart-outline"} size={36} color={curInfo.curtiu ? "#E63946" : "#fff"} style={styles.dropShadow} />
            <Text style={[styles.floatingTextClean, styles.dropShadowText]}>{curInfo.total}</Text>
          </TouchableOpacity>}

          <TouchableOpacity style={styles.floatingActionClean} onPress={() => abrirComentarios(post.id)} accessibilityRole="button" accessibilityLabel="Ver comentários">
            <Ionicons name="chatbubble-outline" size={32} color="#fff" style={styles.dropShadow} />
            <Text style={[styles.floatingTextClean, styles.dropShadowText]}>{podeInteragir ? 'Comentar' : 'Comentários'}</Text>
          </TouchableOpacity>
        </View>

        {/* Nome do Autor e Legenda no Rodapé */}
        <View style={styles.fullscreenFooterClean}>
          <TouchableOpacity 
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

          <Text style={[styles.fullscreenTitle, styles.dropShadowText]}>{post.titulo}</Text>
          {post.local ? <Text style={[styles.fullscreenLocal, styles.dropShadowText]}>📍 {post.local}</Text> : null}
          <Text style={[styles.fullscreenDesc, styles.dropShadowText]} numberOfLines={3}>{post.descricao}</Text>
        </View>
      </View>
    );
  };

  // Se estiver em modo fullscreen, substitui a tela por uma camada independente acima de tudo
  if (modoFullscreen && postsVisiveis.length > 0) {
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
            extraData={postsCurtidas}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderPostFullscreen}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            snapToInterval={alturaPagina}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            bounces={false}
            overScrollMode="never"
            initialScrollIndex={limitarIndice(indiceInicial, postsVisiveis.length)}
            getItemLayout={(data, index) => ({ length: alturaPagina, offset: alturaPagina * index, index })}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            onMomentumScrollEnd={(e) => {
              // Registra o slide atual e garante que a lista nunca fique parada entre duas publicações
              const offsetY = e.nativeEvent.contentOffset.y;
              const indice = indicePorDeslocamento(offsetY, alturaPagina, postsVisiveis.length);
              indiceAtualRef.current = indice;
              const alvo = indice * alturaPagina;
              if (Math.abs(offsetY - alvo) > 1) {
                flatListRef.current?.scrollToOffset({ offset: alvo, animated: true });
              }
            }}
          />
        )}

        {/* MODAL DE COMENTÁRIOS NO MODO FULLSCREEN */}
        <Modal visible={modalComentariosVisivel} animationType="slide" transparent={true} onRequestClose={fecharComentarios}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{comentarioParaExcluir ? 'Excluir comentário' : 'Comentários'}</Text>
                <TouchableOpacity onPress={fecharComentarios}>
                  <Ionicons name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>

              {comentarioParaExcluir ? (
                <View style={styles.confirmacaoComentario}>
                  <View style={styles.confirmacaoComentarioIcone}>
                    <Ionicons name="trash-outline" size={25} color="#D84343" />
                  </View>
                  <Text style={styles.confirmacaoComentarioTitulo}>Excluir este comentário?</Text>
                  <Text style={styles.confirmacaoComentarioAutor}>{comentarioParaExcluir.autor}</Text>
                  <Text style={styles.confirmacaoComentarioTrecho} numberOfLines={3}>{comentarioParaExcluir.texto}</Text>
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
                </View>
              ) : (
                <>
                  {erroComentario ? (
                    <Text accessibilityRole="alert" style={styles.erroComentario}>{erroComentario}</Text>
                  ) : null}
                  {avisoComentario ? (
                    <Text accessibilityRole="alert" style={styles.avisoComentario}>{avisoComentario}</Text>
                  ) : null}
                  <ScrollView style={{ maxHeight: 320, marginBottom: 15 }}>
                {comentarios.length === 0 ? (
                  <Text style={styles.emptyComentarios}>{podeInteragir ? 'Nenhum comentário ainda. Seja o primeiro a comentar!' : 'Nenhum comentário disponível.'}</Text>
                ) : (
                  comentarios.map((c) => {
                    const comCur = comentariosCurtidas[c.id] || { total: parseInt(c.total_curtidas) || 0, curtiu: c.curtiu_por_mim };

                    return (
                      <View key={c.id} style={[styles.comentarioItem, c.parent_id && { marginLeft: 25, borderLeftWidth: 2, borderLeftColor: '#2A4B4C', paddingLeft: 10 }]}>
                        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2}}>
                          <Text style={styles.comentarioAutor}>{c.autor}</Text>
                          {podeInteragir && <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center'}} onPress={() => curtirComentario(c.id)}>
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
                  <TouchableOpacity onPress={() => setRespostaPara(null)}>
                    <Ionicons name="close-circle" size={16} color="#E63946" />
                  </TouchableOpacity>
                </View>
              )}

              {podeInteragir && <View style={styles.comentarioInputRow}>
                <TextInput 
                  style={styles.comentarioInput} 
                  placeholder="Escreva um comentário..." 
                  placeholderTextColor="#999"
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
        <Ionicons
          name="newspaper-outline"
          size={38}
          color="#C4C2B7"
          style={styles.headerIcon}
        />
      </View>

      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[
            styles.filterChip,
            filtroAtivo === 'todos' && styles.filterChipActive
          ]}
          onPress={() => alterarFiltro('todos')}
          accessibilityRole="button"
          accessibilityState={{ selected: filtroAtivo === 'todos' }}
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
            accessibilityState={{ selected: filtroAtivo === 'minha' }}
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

      {carregando ? (
        <ActivityIndicator size="large" color="#2A4B4C" style={{ marginTop: 50 }} />
      ) : erroCarregamento && posts.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="cloud-offline-outline" size={50} color="#C4C2B7" />
          <Text accessibilityRole="alert" style={styles.emptyText}>{erroCarregamento}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => { setCarregando(true); void buscarPosts(false); }} accessibilityRole="button">
            <Text style={styles.retryText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={postsVisiveis}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderPostFeed}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="newspaper-outline" size={50} color="#C4C2B7" />
              <Text style={styles.emptyText}>
                {filtroAtivo === 'minha'
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

      {/* MODAL DE COMENTÁRIOS NO FEED NORMAL */}
      <Modal visible={modalComentariosVisivel} animationType="slide" transparent={true} onRequestClose={fecharComentarios}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{comentarioParaExcluir ? 'Excluir comentário' : 'Comentários'}</Text>
              <TouchableOpacity onPress={fecharComentarios}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {comentarioParaExcluir ? (
                <View style={styles.confirmacaoComentario}>
                  <View style={styles.confirmacaoComentarioIcone}>
                    <Ionicons name="trash-outline" size={25} color="#D84343" />
                  </View>
                  <Text style={styles.confirmacaoComentarioTitulo}>Excluir este comentário?</Text>
                  <Text style={styles.confirmacaoComentarioAutor}>{comentarioParaExcluir.autor}</Text>
                  <Text style={styles.confirmacaoComentarioTrecho} numberOfLines={3}>{comentarioParaExcluir.texto}</Text>
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
                </View>
              ) : (
                <>
                  {erroComentario ? (
                    <Text accessibilityRole="alert" style={styles.erroComentario}>{erroComentario}</Text>
                  ) : null}
                  {avisoComentario ? (
                    <Text accessibilityRole="alert" style={styles.avisoComentario}>{avisoComentario}</Text>
                  ) : null}
                  <ScrollView style={{ maxHeight: 320, marginBottom: 15 }}>
              {comentarios.length === 0 ? (
                <Text style={styles.emptyComentarios}>{podeInteragir ? 'Nenhum comentário ainda. Seja o primeiro a comentar!' : 'Nenhum comentário disponível.'}</Text>
              ) : (
                comentarios.map((c) => {
                  const comCur = comentariosCurtidas[c.id] || { total: parseInt(c.total_curtidas) || 0, curtiu: c.curtiu_por_mim };

                  return (
                    <View key={c.id} style={[styles.comentarioItem, c.parent_id && { marginLeft: 25, borderLeftWidth: 2, borderLeftColor: '#2A4B4C', paddingLeft: 10 }]}>
                      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2}}>
                        <Text style={styles.comentarioAutor}>{c.autor}</Text>
                        {podeInteragir && <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center'}} onPress={() => curtirComentario(c.id)}>
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
                <TouchableOpacity onPress={() => setRespostaPara(null)}>
                  <Ionicons name="close-circle" size={16} color="#E63946" />
                </TouchableOpacity>
              </View>
            )}

            {podeInteragir && <View style={styles.comentarioInputRow}>
              <TextInput 
                style={styles.comentarioInput} 
                placeholder="Escreva um comentário..." 
                placeholderTextColor="#999"
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
    minHeight: 40,
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

  postInfoBox: { paddingHorizontal: 15, paddingBottom: 8 },
  postTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 2 },
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
    borderTopWidth: 1,
    borderTopColor: '#E2EAE9',
    paddingVertical: 12,
    paddingHorizontal: 15,
  },
  actionButton: { flexDirection: 'row', alignItems: 'center', marginRight: 25 },
  actionCount: { fontSize: 14, color: '#444', marginLeft: 6 },

  // Estilos do Modo Fullscreen
  fullscreenWrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 9999 },
  // A altura de cada slide é definida em tempo de execução (altura real medida da tela)
  fullscreenSlide: { alignSelf: 'stretch', backgroundColor: '#000', position: 'relative', justifyContent: 'center', alignItems: 'center' },
  
  fullscreenMediaLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  fullscreenImage: { width: '100%', height: '100%' },
  videoFullscreenPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', width: '100%', height: '100%' },
  videoTextLarge: { color: '#fff', marginTop: 10, fontSize: 16, fontWeight: 'bold' },

  backFullscreenBtn: { position: 'absolute', top: 50, left: 20, zIndex: 30, backgroundColor: 'rgba(0,0,0,0.4)', padding: 10, borderRadius: 25 },

  floatingRightControls: { position: 'absolute', right: 20, bottom: 160, zIndex: 20, alignItems: 'center', gap: 20 },
  floatingActionClean: { alignItems: 'center', justifyContent: 'center' },
  floatingTextClean: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 4 },

  dropShadow: { textShadowColor: 'rgba(0, 0, 0, 0.75)', textShadowOffset: { width: -1, height: 1 }, textShadowRadius: 5 },
  dropShadowText: { color: '#fff', textShadowColor: 'rgba(0, 0, 0, 0.8)', textShadowOffset: { width: -1, height: 1 }, textShadowRadius: 4 },

  fullscreenFooterClean: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 45, paddingTop: 40, zIndex: 20 },
  authorRowFooter: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  authorAvatarFooter: { width: 36, height: 36, borderRadius: 18, marginRight: 10, borderWidth: 1, borderColor: '#fff' },
  authorAvatarPlaceholderFooter: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  authorNameFooter: { fontSize: 16, fontWeight: 'bold' },
  fullscreenTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 2 },
  fullscreenLocal: { fontSize: 13, marginBottom: 4 },
  fullscreenDesc: { fontSize: 14, lineHeight: 19 },

  // Modal Comentários
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '75%', elevation: 5 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2A4B4C' },
  emptyComentarios: { color: '#888', fontSize: 13, textAlign: 'center', marginVertical: 20 },
  comentarioItem: { backgroundColor: '#F9F9F6', padding: 10, borderRadius: 8, marginBottom: 8 },
  comentarioAutor: { fontSize: 13, fontWeight: 'bold', color: '#2A4B4C' },
  comentarioTexto: { fontSize: 14, color: '#333', marginTop: 2 },
  responderText: { fontSize: 11, color: '#2A4B4C', fontWeight: 'bold' },
  comentarioAcoes: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 7 },
  excluirComentarioText: { fontSize: 11, fontWeight: 'bold', color: '#B83E43' },
  erroComentario: { backgroundColor: '#FFE8E9', color: '#A22C33', padding: 10, borderRadius: 9, marginBottom: 12, fontSize: 13 },
  avisoComentario: { backgroundColor: '#E2EAE9', color: '#2A4B4C', padding: 10, borderRadius: 9, marginBottom: 12, fontSize: 13 },
  confirmacaoComentario: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  confirmacaoComentarioIcone: { backgroundColor: '#FFE8E9', borderRadius: 28, width: 56, height: 56, justifyContent: 'center', alignItems: 'center' },
  confirmacaoComentarioTitulo: { fontSize: 18, fontWeight: '700', color: '#2A4B4C', textAlign: 'center' },
  confirmacaoComentarioAutor: { fontSize: 13, fontWeight: '700', color: '#2A4B4C' },
  confirmacaoComentarioTrecho: { fontSize: 14, textAlign: 'center', color: '#444', backgroundColor: '#F7F5EC', padding: 12, borderRadius: 9, alignSelf: 'stretch' },
  confirmacaoComentarioAviso: { fontSize: 12, textAlign: 'center', color: '#78634D', marginBottom: 8 },
  confirmacaoComentarioAcoes: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  cancelarExclusaoComentario: { flex: 1, backgroundColor: '#E2EAE9', borderRadius: 12, minHeight: 45, alignItems: 'center', justifyContent: 'center' },
  cancelarExclusaoComentarioTexto: { color: '#2A4B4C', fontWeight: '700' },
  confirmarExclusaoComentario: { flex: 1, backgroundColor: '#B83E43', borderRadius: 12, minHeight: 45, alignItems: 'center', justifyContent: 'center' },
  confirmarExclusaoComentarioTexto: { color: '#FFFFFF', fontWeight: '700' },
  respondendoBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E2EAE9', padding: 6, borderRadius: 6, marginBottom: 8 },
  respondendoText: { fontSize: 12, color: '#2A4B4C' },
  comentarioInputRow: { flexDirection: 'row', alignItems: 'center' },
  comentarioInput: { flex: 1, backgroundColor: '#F0F0F0', padding: 10, borderRadius: 8, fontSize: 14, color: '#333' },
  enviarComentarioBtn: { backgroundColor: '#2A4B4C', justifyContent: 'center', alignItems: 'center', padding: 10, borderRadius: 8, marginLeft: 8 }
});
