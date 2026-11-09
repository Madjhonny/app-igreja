import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Dizemos para o app que a tela inicial (index) existe e é a primeira */}
      <Stack.Screen name="index" />
      {/* Dizemos que as abas também existem para quando formos chamá-las */}
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}