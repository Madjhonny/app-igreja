import { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { getConnectionStatus, subscribeConnection } from '@/services/network';

export function ConnectionBanner() {
  const status = useSyncExternalStore(subscribeConnection, getConnectionStatus, getConnectionStatus);
  if (status === 'ok') return null;
  return (
    <View style={{ backgroundColor: '#F7F5EC', paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text accessibilityRole="alert" style={{ color: '#2A4B4C', textAlign: 'center' }}>
        Conexão instável com o servidor. Verifique sua internet e tente novamente.
      </Text>
    </View>
  );
}
