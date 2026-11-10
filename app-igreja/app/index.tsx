import { Redirect } from 'expo-router';

// The login screen validates remembered sessions before entering the app.
export default function IndexSplash() {
  return <Redirect href="/login" />;
}
