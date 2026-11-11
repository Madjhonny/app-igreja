import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Tabs, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const VERDE = '#2A4B4C';
const BEGE = '#F7F5EC';
const CINZA = '#a3a3a3';
const DURACAO_TRANSICAO = 270;
const LARGURA_INDICADOR = 32;
const suavizacao = Easing.inOut(Easing.cubic);
const usarDriverNativo = Platform.OS !== 'web';
const ordemAbas = ['agenda', 'explore', 'perfil'] as const;
type NomeAba = (typeof ordemAbas)[number];
type NomeIcone = keyof typeof Ionicons.glyphMap;

// Conserva a barra padrão do Expo Router (tema, acessibilidade e fullscreen).
// O indicador animado é apenas um fundo do tabBar, não um novo BottomTabBar.
const DirecaoTransicao = createContext(0);

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
        useNativeDriver: usarDriverNativo,
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

function FundoBarraAnimado({ indiceAtual }: { indiceAtual: number }) {
  const { bottom } = useSafeAreaInsets();
  const [largura, setLargura] = useState(0);
  const progresso = useRef(new Animated.Value(indiceAtual)).current;
  const indiceAnteriorRef = useRef(indiceAtual);

  useEffect(() => {
    if (indiceAnteriorRef.current === indiceAtual) return;
    indiceAnteriorRef.current = indiceAtual;
    progresso.stopAnimation();
    Animated.timing(progresso, {
      toValue: indiceAtual,
      duration: DURACAO_TRANSICAO,
      easing: suavizacao,
      useNativeDriver: usarDriverNativo,
    }).start();
  }, [progresso, indiceAtual]);

  const centros = ordemAbas.map((_, indice) =>
    (indice + 0.5) * largura / ordemAbas.length - LARGURA_INDICADOR / 2,
  );

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={evento => {
        const proximaLargura = evento.nativeEvent.layout.width;
        if (Math.abs(proximaLargura - largura) > 1) setLargura(proximaLargura);
      }}
    >
      {largura > 0 && (
        <Animated.View
          style={[
            styles.indicadorAtivo,
            {
              bottom: bottom + 2,
              transform: [{
                translateX: progresso.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: centros,
                  extrapolate: 'clamp',
                }),
              }],
            },
          ]}
        />
      )}
    </View>
  );
}

export default function TabLayout() {
  const { width: larguraTela } = useWindowDimensions();
  const segmentos = useSegments();
  const nomeAtual = segmentos[segmentos.length - 1] as NomeAba | undefined;
  const posicao = ordemAbas.indexOf(nomeAtual as NomeAba);
  const indiceAtual = posicao >= 0 ? posicao : 0;
  const historico = useRef({ indice: indiceAtual, direcao: 0 });

  if (indiceAtual !== historico.current.indice) {
    historico.current.direcao = Math.sign(indiceAtual - historico.current.indice);
    historico.current.indice = indiceAtual;
  }

  return (
    <DirecaoTransicao.Provider value={historico.current.direcao}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: VERDE,
          tabBarInactiveTintColor: CINZA,
          headerShown: false,
          tabBarStyle: { backgroundColor: BEGE },
          tabBarBackground: () => <FundoBarraAnimado indiceAtual={indiceAtual} />,
          // Transição carrossel: direção baseada na ordem das abas.
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
    </DirecaoTransicao.Provider>
  );
}

const styles = StyleSheet.create({
  indicadorAtivo: {
    position: 'absolute',
    left: 0,
    width: LARGURA_INDICADOR,
    height: 3,
    borderRadius: 3,
    backgroundColor: VERDE,
  },
});
