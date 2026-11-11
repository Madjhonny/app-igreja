import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { View } from 'react-native';
import { SessionMonitor } from '@/components/session-monitor';
import { AppDialogProvider } from '@/components/app-dialog';

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <AppDialogProvider>
        <View style={{ flex: 1 }}>
          <SessionMonitor />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
      </AppDialogProvider>
    </ThemeProvider>
  );
}
