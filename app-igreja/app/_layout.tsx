import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { clientMonitor } from '@/services/session';
import { SessionMonitor } from '@/components/session-monitor';
import { AppDialogProvider } from '@/components/app-dialog';
import { ConnectionBanner } from '@/components/connection-banner';

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  useEffect(() => {
    clientMonitor.record('render');
    void clientMonitor.flush();
  }, []);
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#F7F5EC' }}>
      <Text style={{ color: '#2A4B4C', fontSize: 18, textAlign: 'center' }}>Algo deu errado. Tente abrir a tela novamente.</Text>
      <Pressable accessibilityRole="button" onPress={() => { void retry(); }} style={{ backgroundColor: '#2A4B4C', padding: 16, marginTop: 20, borderRadius: 8 }}>
        <Text style={{ color: '#fff' }}>Tentar novamente</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <AppDialogProvider>
      <View style={{ flex: 1 }}>
      <SessionMonitor />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <ConnectionBanner />
      </View>
    </AppDialogProvider>
  );
}
