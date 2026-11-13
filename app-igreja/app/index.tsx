import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { getSessionToken, isGuestMode } from '@/services/session';

type RotaInicial = '/login' | '/(tabs)/agenda';

export default function IndexSplash() {
  const [destino, setDestino] = useState<RotaInicial | null>(null);

  useEffect(() => {
    let ativo = true;

    const decidirRota = async () => {
      try {
        const [token, convidado] = await Promise.all([
          getSessionToken(),
          isGuestMode(),
        ]);

        if (ativo) {
          setDestino(!token && convidado ? '/(tabs)/agenda' : '/login');
        }
      } catch {
        if (ativo) setDestino('/login');
      }
    };

    void decidirRota();

    return () => {
      ativo = false;
    };
  }, []);

  // Aguarda o armazenamento local antes de decidir a rota inicial.
  if (!destino) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#2A4B4C',
        }}
      >
        <ActivityIndicator size="large" color="#F7F5EC" />
      </View>
    );
  }

  return <Redirect href={destino} />;
}
