import { Stack } from 'expo-router';
import { View } from 'react-native';
import { SessionMonitor } from '@/components/session-monitor';

export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <SessionMonitor />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </View>
  );
}
