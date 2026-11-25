import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function useReducedMotion() {
  const [reduzir, setReduzir] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const consulta = window.matchMedia('(prefers-reduced-motion: reduce)');
      const atualizar = () => setReduzir(consulta.matches);
      atualizar();
      consulta.addEventListener('change', atualizar);
      return () => consulta.removeEventListener('change', atualizar);
    }

    let ativo = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzir);
    void AccessibilityInfo.isReduceMotionEnabled().then(valor => {
      if (ativo) setReduzir(valor);
    });
    return () => {
      ativo = false;
      subscription.remove();
    };
  }, []);

  return reduzir;
}
