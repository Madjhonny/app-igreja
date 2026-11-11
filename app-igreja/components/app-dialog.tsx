import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type DialogAction = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
};

export type ConflictDetail = {
  titulo: string;
  evento_conflitante: string;
  origem: string;
  congregacao?: string;
  data_inicio?: string;
  data_fim?: string;
  horario?: string;
  duracao_minutos?: number;
  evento_conflitante_data_inicio?: string;
  evento_conflitante_data_fim?: string;
  evento_conflitante_horario?: string;
  evento_conflitante_duracao_minutos?: number;
};

export type AppDialogOptions = {
  title: string;
  message?: string;
  buttons?: DialogAction[];
  details?: { label: string; value: string | number }[];
  conflicts?: ConflictDetail[];
};

type AppDialogApi = {
  showDialog: (options: AppDialogOptions) => void;
  alert: (title: string, message?: string, buttons?: DialogAction[]) => void;
};

const DialogContext = createContext<AppDialogApi | null>(null);

const cores = {
  principal: '#2A4B4C',
  fundo: '#F7F5EC',
  suave: '#E2EAE9',
  neutro: '#C4C2B7',
  perigo: '#B83E43',
  texto: '#263F40',
};

function dataVisivel(data?: string) {
  const valor = String(data || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor || 'Data não informada';
  return valor.split('-').reverse().join('/');
}

function periodo(item: ConflictDetail, prefixo = '') {
  const inicio = item[(prefixo + 'data_inicio') as keyof ConflictDetail] as string | undefined;
  const fim = item[(prefixo + 'data_fim') as keyof ConflictDetail] as string | undefined;
  const horario = item[(prefixo + 'horario') as keyof ConflictDetail] as string | undefined;
  const duracao = item[(prefixo + 'duracao_minutos') as keyof ConflictDetail] as number | undefined;
  const datas = inicio
    ? dataVisivel(inicio) + (fim && String(inicio).slice(0, 10) !== String(fim).slice(0, 10)
      ? ' a ' + dataVisivel(fim)
      : '')
    : 'Data não informada';
  const duracaoTexto = duracao ? ' · ' + duracao + ' min' : '';
  return datas + (horario ? ' · ' + String(horario).slice(0, 5) + duracaoTexto : '');
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<AppDialogOptions | null>(null);
  const { height } = useWindowDimensions();

  const showDialog = useCallback((options: AppDialogOptions) => setDialog(options), []);
  const alert = useCallback((title: string, message = '', buttons?: DialogAction[]) => {
    showDialog({ title, message, buttons });
  }, [showDialog]);

  const context = useMemo(() => ({ showDialog, alert }), [showDialog, alert]);

  const concluir = (action?: DialogAction) => {
    setDialog(null);
    // Executa a ação escolhida mesmo se a tela de origem navegar após o clique.
    if (action?.onPress) void action.onPress();
  };

  const buttons: DialogAction[] = dialog?.buttons?.length ? dialog.buttons : [{ text: 'Entendi' }];

  return (
    <DialogContext.Provider value={context}>
      {children}
      <Modal
        visible={!!dialog}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          const cancelar = buttons.find(b => b.style === 'cancel');
          concluir(cancelar);
        }}
      >
        <View style={{
          flex: 1, justifyContent: 'center', alignItems: 'center',
          backgroundColor: 'rgba(12, 27, 28, 0.62)', padding: 18,
        }}>
          <View style={{
            backgroundColor: '#FFFFFF', borderRadius: 20, width: '100%',
            maxWidth: 550, maxHeight: Math.max(300, height * 0.82),
            overflow: 'hidden', borderWidth: 1, borderColor: cores.suave,
          }}>
            <View style={{
              paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14,
              backgroundColor: cores.fundo, flexDirection: 'row', alignItems: 'center', gap: 10,
            }}>
              <Ionicons name="information-circle-outline" size={28} color={cores.principal} />
              <Text accessibilityRole="header" style={{
                color: cores.principal, fontSize: 19, fontWeight: '800', flex: 1,
              }}>{dialog?.title || 'Aviso'}</Text>
            </View>
            <ScrollView
              style={{ maxHeight: Math.max(170, height * 0.55) }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 18, gap: 12 }}
              showsVerticalScrollIndicator
            >
              {dialog?.message ? (
                <Text style={{ fontSize: 15, lineHeight: 23, color: cores.texto }}>
                  {dialog.message}
                </Text>
              ) : null}

              {dialog?.details?.length ? (
                <View style={{ backgroundColor: cores.suave, padding: 12, borderRadius: 12, gap: 7 }}>
                  {dialog.details.map((item, i) => (
                    <Text key={i} style={{ fontSize: 14, color: cores.principal }}>
                      <Text style={{ fontWeight: '700' }}>{item.label}:</Text> {item.value}
                    </Text>
                  ))}
                </View>
              ) : null}

              {dialog?.conflicts?.map((item, i) => (
                <View key={i} style={{
                  borderColor: '#E5D8C2', borderWidth: 1, borderRadius: 12,
                  backgroundColor: '#FFF9F1', padding: 12, gap: 7,
                }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: cores.principal }}>
                    {i + 1}. {item.titulo}
                  </Text>
                  <Text style={{ color: cores.texto, fontSize: 13 }}>
                    {periodo(item)}
                  </Text>
                  <Text style={{ color: cores.perigo, fontSize: 13, fontWeight: '700' }}>
                    Conflita com: {item.evento_conflitante}
                  </Text>
                  <Text style={{ color: cores.texto, fontSize: 13 }}>
                    {periodo(item, 'evento_conflitante_')}
                  </Text>
                  {item.congregacao ? (
                    <Text style={{ color: cores.texto, fontSize: 13 }}>
                      Congregação: {item.congregacao}
                    </Text>
                  ) : null}
                  <Text style={{ color: '#687879', fontSize: 12 }}>Origem: {item.origem}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={{
              padding: 16, borderTopWidth: 1, borderColor: cores.suave,
              flexDirection: 'row', flexWrap: 'wrap', gap: 10,
            }}>
              {buttons.map((action, i) => {
                const destructive = action.style === 'destructive';
                const cancel = action.style === 'cancel';
                return (
                  <TouchableOpacity
                    key={i}
                    accessibilityRole="button"
                    onPress={() => concluir(action)}
                    activeOpacity={0.8}
                    style={{
                      flexGrow: 1, flexBasis: 160, minHeight: 44, paddingVertical: 12,
                      paddingHorizontal: 12, borderRadius: 12, alignItems: 'center',
                      justifyContent: 'center', backgroundColor: cancel ? cores.suave
                        : destructive ? cores.perigo : cores.principal,
                    }}
                  >
                    <Text style={{
                      color: cancel ? cores.principal : '#FFFFFF',
                      fontWeight: '700', fontSize: 14, textAlign: 'center',
                    }}>{action.text}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </DialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogApi {
  const context = useContext(DialogContext);
  if (!context) throw new Error('AppDialogProvider não encontrado na raiz do aplicativo.');
  return context;
}

// API compatível com Alert.alert, porém implementada como modal do Agenda ADP.
export function useAppAlert() {
  const { alert } = useAppDialog();
  return useMemo(() => ({ alert }), [alert]);
}
