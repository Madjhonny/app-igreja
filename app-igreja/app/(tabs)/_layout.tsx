import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ 
      tabBarActiveTintColor: '#2A4B4C', 
      tabBarInactiveTintColor: '#a3a3a3', 
      headerShown: false, 
      tabBarStyle: { backgroundColor: '#F7F5EC' } 
    }}>
      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          tabBarAccessibilityLabel: 'Agenda',
          tabBarIcon: ({ color }) => <Ionicons name="calendar" size={24} color={typeof color === 'string' ? color : '#a3a3a3'} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Eventos',
          tabBarAccessibilityLabel: 'Eventos',
          tabBarIcon: ({ color }) => <Ionicons name="megaphone" size={24} color={typeof color === 'string' ? color : '#a3a3a3'} />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: 'Perfil',
          tabBarAccessibilityLabel: 'Perfil',
          tabBarIcon: ({ color }) => <Ionicons name="person" size={24} color={typeof color === 'string' ? color : '#a3a3a3'} />,
        }}
      />
    </Tabs>
  );
}
