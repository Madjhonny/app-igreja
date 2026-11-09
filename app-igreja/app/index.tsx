import React, { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function IndexSplash() {
  useEffect(() => {
    verificarSessao();
  }, []);

  const verificarSessao = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const manter = await AsyncStorage.getItem('manterConectado');

      // Tempo de permanência na tela verde antes de redirecionar
      setTimeout(() => {
        if (token && manter === 'true') {
          router.replace('/(tabs)/agenda' as any);
        } else {
          router.replace('/login' as any);
        }
      }, 1200);
    } catch (error) {
      router.replace('/login' as any);
    }
  };

  // Apenas a tela verde limpa, dando continuidade à logo nativa
  return (
    <View style={{ flex: 1, backgroundColor: '#2A4B4C' }} />
  );
}