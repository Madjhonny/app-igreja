import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

const VERDE = '#2A4B4C';
const BEGE = '#F7F5EC';
const CINZA = '#a3a3a3';
const DURACAO_TRANSICAO = 270;
const LARGURA_INDICADOR = 32;
const suavizacao = Easing.inOut(Easing.cubic);

// O indicador do rodapé e as cenas utilizam a mesma duração e curva.
// Preservamos o Tabs e o BottomTabBar originais para não alterar a navegação.
const DirecaoTransicao = createContext(0);

type NomeIcone = keyof typeof Ionicons.glyphMap;

function IconeAba({ nome, cor, selecionado }: { nome: NomeIcone; cor: string; selecionado: boolean }) {
  const direcao = useContext(DirecaoTransicao);
  const deslocamento = useRef(new Animated.Value(0)).current;
  const selecionadoAnterior = useRef(selecionado);

  useEffect(() => {
    if (selecionado && !selecionadoAnterior.current) {
      deslocamento.stopAnimation();
      deslocamento.setValue(direcao * 8);
      Animated.timing(deslocamento, {
        toValue: 0,
        duration: DURACAO_TRANSICAO,
        easing: suavizacao,
        useNativeDriver: true,
      }).start();
    } else if (!selecionado) {
      deslocamento.stopAnimation();
      deslocamento.setValue(0);
    }
    selecionadoAnterior.current = selecionado;
  }, [deslocamento, direcao, selecionado]);

  return (
    <Animated.View style={{ transform: [{ translateX: deslocamento }] }}>
      <Ionicons name={nome} size={24} color={cor} />
    </Animated.View>
  );
}

function BarraAbasAnimada(props: BottomTabBarProps) {
  const { state } = props;
  const [larguraBarra, setLarguraBarra] = useState(0);
  const progresso = useRef(new Animated.Value(state.index)).current;
  const indiceAnterior = useRef(state.index);
  const ultimaDirecao = useRef(0);

  // O sentido vem da ordem real das abas: Agenda (0), Eventos (1), Perfil (2).
  if (state.index !== indiceAnterior.current) {
    ultimaDirecao.current = Math.sign(state.index - indiceAnterior.current);
  }

  useEffect(() => {
    if (state.index === indiceAnterior.current) return;
    indiceAnterior.current = state.index;
    progresso.stopAnimation();
    Animated.timing(progresso, {
      toValue: state.index,
      duration: DURACAO_TRANSICAO,
      easing: suavizacao,
      useNativeDriver: true,
    }).start();
  }, [progresso, state.index]);

  const indices = state.routes.map((_, indice) => indice);
  const centros = state.routes.map((_, indice) =>
    (indice + 0.5) * larguraBarra / state.routes.length - LARGURA_INDICADOR / 2,
  );

  // O mural esconde a barra durante o fullscreen via navigation.setOptions.
  // Evita que o indicador ou o wrapper apareçam nesse modo.
  const rotaAtiva = state.routes[state.index];
  const estiloBarraAtiva = StyleSheet.flatten(props.descriptors[rotaAtiva.key]?.options.tabBarStyle);
  if (estiloBarraAtiva?.display === 'none') {
    return <BottomTabBar {...props} />;
  }

  return (
    <DirecaoTransicao.Provider value={ultimaDirecao.current}>
      <View
        style={styles.barraContainer}
        onLayout={evento => setLarguraBarra(evento.nativeEvent.layout.width)}
      >
        <BottomTabBar {...props} />
        {larguraBarra > 0 && state.routes.length > 1 && (
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.indicadorAtivo,
              {
                bottom: props.insets.bottom + 2,
                transform: [{
                  translateX: progresso.interpolate({
                    inputRange: indices,
                    outputRange: centros,
                    extrapolate: 'clamp',
                  }),
                }],
              },
            ]}
          />
        )}
      </View>
    </DirecaoTransicao.Provider>
  );
}

export default function TabLayout() {
  const { width: larguraTela } = useWindowDimensions();

  return (
    <Tabs
      tabBar={props => <BarraAbasAnimada {...props} />}
      screenOptions={{
        tabBarActiveTintColor: VERDE,
        tabBarInactiveTintColor: CINZA,
        headerShown: false,
        tabBarStyle: { backgroundColor: BEGE },
        // Deslizamento de carrossel: abas à direita vêm da direita; ao voltar, da esquerda.
        transitionSpec: {
          animation: 'timing',
          config: { duration: DURACAO_TRANSICAO, easing: suavizacao },
        },
        sceneStyleInterpolator: ({ current }) => ({
          sceneStyle: {
            transform: [{
              translateX: current.progress.interpolate({
                inputRange: [-1, 0, 1],
                outputRange: [-larguraTela, 0, larguraTela],
              }),
            }],
          },
        }),
      }}
    >
      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          tabBarAccessibilityLabel: 'Agenda',
          tabBarIcon: ({ color, focused }) =>
            <IconeAba nome="calendar" cor={typeof color === 'string' ? color : CINZA} selecionado={focused} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Eventos',
          tabBarAccessibilityLabel: 'Eventos',
          tabBarIcon: ({ color, focused }) =>
            <IconeAba nome="megaphone" cor={typeof color === 'string' ? color : CINZA} selecionado={focused} />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: 'Perfil',
          tabBarAccessibilityLabel: 'Perfil',
          tabBarIcon: ({ color, focused }) =>
            <IconeAba nome="person" cor={typeof color === 'string' ? color : CINZA} selecionado={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barraContainer: { backgroundColor: BEGE },
  indicadorAtivo: {
    position: 'absolute',
    left: 0,
    width: LARGURA_INDICADOR,
    height: 3,
    borderRadius: 3,
    backgroundColor: VERDE,
  },
});
