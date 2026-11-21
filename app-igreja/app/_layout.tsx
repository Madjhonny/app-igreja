import { Stack } from 'expo-router';
import { View } from 'react-native';
import { SessionMonitor } from '@/components/session-monitor';
import { AppDialogProvider } from '@/components/app-dialog';
import { ConnectionBanner } from '@/components/connection-banner';

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
