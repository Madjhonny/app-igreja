export const pushAvailable = false;
export function observarAberturaDaAgenda(_podeAbrir: () => Promise<boolean>, _abrir: () => void) {
  return () => {};
}
export const pushPreference = {
  status: async (_userId: number): Promise<'active' | 'pending' | 'off'> => 'off',
  enable: async (_api: string, _userId: number, _auth: string) => false,
  disable: async (_api: string) => true,
  reconcile: async (_api: string, _userId: number | null, _auth: string | null) => {},
};
