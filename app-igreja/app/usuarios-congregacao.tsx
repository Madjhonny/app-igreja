import React, { useState, useCallback } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, Image, ScrollView } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

export default function TelaUsuariosCongregacao() {
  const { congregacaoNome } = useLocalSearchParams();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [tokenMaster, setTokenMaster] = useState('');
  const [usuarioLogado, setUsuarioLogado] = useState<any>(null);
  const [listaCongregacoes, setListaCongregacoes] = useState<any[]>([]);

  const [usuarioSelecionado, setUsuarioSelecionado] = useState<any>(null);
  const [modalDetalhesVisivel, setModalDetalhesVisivel] = useState(false);
  const [modalStatusVisivel, setModalStatusVisivel] = useState(false);
  const [modalNivelVisivel, setModalNivelVisivel] = useState(false);
  const [modalTrocarCongregacaoVisivel, setModalTrocarCongregacaoVisivel] = useState(false);

  useFocusEffect(useCallback(() => { carregarDadosIniciais(); }, [congregacaoNome]));

  const carregarDadosIniciais = async () => {
    setCarregando(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      const userData = await AsyncStorage.getItem('userData');
      if (!token || !userData) return router.replace('/login');
      
      setTokenMaster(token);
      setUsuarioLogado(JSON.parse(userData));

      // Busca congregações cadastradas
      const respCong = await fetch('http://192.168.1.71:3000/congregacoes');
      if (respCong.ok) {
        setListaCongregacoes(await respCong.json());
      }

      // Busca usuários
      const resposta = await fetch('http://192.168.1.71:3000/usuarios', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (resposta.ok) {
        const todosUsuarios = await resposta.json();
        const filtrados = todosUsuarios.filter((u: any) => u.congregacao === congregacaoNome);
        setUsuarios(filtrados);
      } else {
        router.back();
      }
    } catch (error) {
      Alert.alert('Erro', 'Falha na conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  };

  const alterarStatus = async (novoStatus: string) => {
    setModalStatusVisivel(false);
    try {
      const resposta = await fetch(`http://192.168.1.71:3000/usuarios/${usuarioSelecionado.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenMaster}` },
        body: JSON.stringify({ status_conta: novoStatus })
      });
      if (resposta.ok) {
        setUsuarioSelecionado({ ...usuarioSelecionado, status_conta: novoStatus });
        carregarDadosIniciais();
      }
    } catch (error) { Alert.alert('Erro', 'Falha na conexão.'); }
  };

  const alterarNivel = async (novoNivel: string) => {
    setModalNivelVisivel(false);
    try {
      const resposta = await fetch(`http://192.168.1.71:3000/usuarios/${usuarioSelecionado.id}/nivel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenMaster}` },
        body: JSON.stringify({ nivel_acesso: novoNivel })
      });
      if (resposta.ok) {
        setUsuarioSelecionado({ ...usuarioSelecionado, nivel_acesso: novoNivel });
        carregarDadosIniciais();
      }
    } catch (error) { Alert.alert('Erro', 'Falha na conexão.'); }
  };

  const alterarCongregacao = async (novaCongregacaoId: number, nomeNovaCongregacao: string) => {
    setModalTrocarCongregacaoVisivel(false);
    try {
      const resposta = await fetch(`http://192.168.1.71:3000/usuarios/${usuarioSelecionado.id}/congregacao`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenMaster}` },
        body: JSON.stringify({ congregacao_id: novaCongregacaoId })
      });
      if (resposta.ok) {
        const dados = await resposta.json();
        setUsuarioSelecionado(dados.usuario);
        carregarDadosIniciais();
        Alert.alert("Sucesso", `Congregação alterada para ${nomeNovaCongregacao} com sucesso!`);
      } else {
        const err = await resposta.json();
        Alert.alert("Erro", err.erro || "Não foi possível alterar a congregação.");
      }
    } catch (error) { Alert.alert('Erro', 'Falha na conexão.'); }
  };

  const abrirDetalhes = (usuario: any) => {
    setUsuarioSelecionado(usuario);
    setModalDetalhesVisivel(true);
  };

  const renderUsuario = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.card} onPress={() => abrirDetalhes(item)}>
      <View style={styles.cardRow}>
        {item.foto_perfil ? (
          <Image source={{ uri: item.foto_perfil }} style={styles.avatarPequeno} />
        ) : (
          <View style={styles.avatarPlaceholderPequeno}>
            <Ionicons name="person" size={24} color="#999" />
          </View>
        )}
        <View style={styles.cardContent}>
          <Text style={styles.nome} numberOfLines={1}>{item.nome_completo}</Text>
          <Text style={styles.infoText}>⭐ {item.nivel_acesso}</Text>
        </View>
        <View style={[styles.badge, item.status_conta === 'PENDENTE' ? styles.badgePendente : styles.badgeAprovado]}>
          <Text style={styles.badgeText}>{item.status_conta}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const ehMaster = usuarioLogado?.nivel_acesso === 'MASTER';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#F7F5EC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {congregacaoNome}
        </Text>
      </View>

      {carregando ? (
        <ActivityIndicator size="large" color="#2A4B4C" style={{ marginTop: 50 }} />
      ) : (
        <FlatList 
          data={usuarios} 
          keyExtractor={(item) => item.id.toString()} 
          renderItem={renderUsuario} 
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={50} color="#C4C2B7" />
              <Text style={styles.emptyText}>Nenhum usuário nesta congregação.</Text>
            </View>
          }
        />
      )}

      {/* Modal de Detalhes do Usuário */}
      <Modal transparent={true} visible={modalDetalhesVisivel} animationType="slide">
        <View style={styles.modalFullOverlay}>
          <View style={styles.modalDetalhesContent}>
            <TouchableOpacity style={styles.closeModalButton} onPress={() => setModalDetalhesVisivel(false)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>

            <View style={styles.detalhesHeader}>
              {usuarioSelecionado?.foto_perfil ? (
                <Image source={{ uri: usuarioSelecionado.foto_perfil }} style={styles.avatarGrande} />
              ) : (
                <View style={styles.avatarPlaceholderGrande}>
                  <Ionicons name="person" size={50} color="#999" />
                </View>
              )}
              <Text style={styles.detalhesNome}>{usuarioSelecionado?.nome_completo}</Text>

              {/* Se for Master, o nome da congregação abaixo do nome vira um botão interativo para troca */}
              {ehMaster ? (
                <TouchableOpacity style={styles.trocarCongregacaoTag} onPress={() => setModalTrocarCongregacaoVisivel(true)}>
                  <Ionicons name="business" size={14} color="#2A4B4C" style={{ marginRight: 5 }} />
                  <Text style={styles.detalhesCongregacaoLink}>📍 {usuarioSelecionado?.congregacao} (Toque para alterar)</Text>
                  <Ionicons name="create-outline" size={14} color="#2A4B4C" style={{ marginLeft: 5 }} />
                </TouchableOpacity>
              ) : (
                <Text style={styles.detalhesCongregacao}>📍 {usuarioSelecionado?.congregacao}</Text>
              )}
            </View>

            <View style={styles.detalhesBox}>
              <Text style={styles.detalhesInfo}>📧 {usuarioSelecionado?.email}</Text>
              <Text style={styles.detalhesInfo}>📞 {usuarioSelecionado?.telefone || 'Não informado'}</Text>
              <Text style={styles.detalhesInfo}>🪪 CPF: {usuarioSelecionado?.cpf || 'Não informado'}</Text>
              <Text style={styles.detalhesInfo}>⭐ Nível: {usuarioSelecionado?.nivel_acesso}</Text>
              <Text style={styles.detalhesInfo}>🛡️ Status: {usuarioSelecionado?.status_conta}</Text>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity 
                style={[styles.actionButton, !ehMaster && { width: '100%', flex: undefined }]} 
                onPress={() => setModalStatusVisivel(true)}
              >
                <Ionicons name="shield-checkmark" size={16} color="#2A4B4C" />
                <Text style={styles.actionText}>Aprovar/Status</Text>
              </TouchableOpacity>

              {ehMaster && (
                <TouchableOpacity style={styles.actionButton} onPress={() => setModalNivelVisivel(true)}>
                  <Ionicons name="star" size={16} color="#2A4B4C" />
                  <Text style={styles.actionText}>Mudar Nível</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de Status */}
      <Modal transparent={true} visible={modalStatusVisivel} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalStatusVisivel(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Alterar Status</Text>
            {['APROVADO', 'PENDENTE', 'RECUSADO', 'BLOQUEADO'].map((status) => (
              <TouchableOpacity key={status} style={styles.modalOption} onPress={() => alterarStatus(status)}>
                <Text style={styles.modalOptionText}>{status}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal de Nível (Apenas Master) */}
      {ehMaster && (
        <Modal transparent={true} visible={modalNivelVisivel} animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalNivelVisivel(false)}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Promover/Rebaixar</Text>
              {['MEMBRO', 'ADMIN', 'MASTER'].map((nivel) => (
                <TouchableOpacity key={nivel} style={styles.modalOption} onPress={() => alterarNivel(nivel)}>
                  <Text style={styles.modalOptionText}>{nivel}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Modal de Alteração de Congregação (Exclusivo Master) */}
      {ehMaster && (
        <Modal transparent={true} visible={modalTrocarCongregacaoVisivel} animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalTrocarCongregacaoVisivel(false)}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Alterar Congregação</Text>
              <Text style={{fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 15}}>Selecione a nova congregação para este membro:</Text>
              <ScrollView style={{ maxHeight: 250 }}>
                {listaCongregacoes.map((c) => (
                  <TouchableOpacity 
                    key={c.id} 
                    style={[styles.modalOption, usuarioSelecionado?.congregacao_id === c.id && { backgroundColor: '#E2EAE9' }]} 
                    onPress={() => alterarCongregacao(c.id, c.nome)}
                  >
                    <Text style={[styles.modalOptionText, usuarioSelecionado?.congregacao_id === c.id && { fontWeight: 'bold', color: '#2A4B4C' }]}>
                      {c.nome} {usuarioSelecionado?.congregacao_id === c.id ? '(Atual)' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F5EC' },
  header: { backgroundColor: '#2A4B4C', paddingTop: 50, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { marginRight: 15 },
  headerTitle: { color: '#F7F5EC', fontSize: 20, fontWeight: 'bold', flex: 1 },
  listContainer: { padding: 15 },
  emptyContainer: { alignItems: 'center', marginTop: 50 },
  emptyText: { color: '#666', fontSize: 15, marginTop: 10 },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, elevation: 3 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  avatarPequeno: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#eee', marginRight: 15 },
  avatarPlaceholderPequeno: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  cardContent: { flex: 1 },
  nome: { fontSize: 16, fontWeight: 'bold', color: '#2A4B4C' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgePendente: { backgroundColor: '#E63946' },
  badgeAprovado: { backgroundColor: '#4CAF50' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  infoText: { fontSize: 12, color: '#666', marginTop: 3 },
  modalFullOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalDetalhesContent: { backgroundColor: '#F7F5EC', borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 20, minHeight: '60%' },
  closeModalButton: { alignSelf: 'flex-end', padding: 5 },
  detalhesHeader: { alignItems: 'center', marginBottom: 20 },
  avatarGrande: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#2A4B4C' },
  avatarPlaceholderGrande: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#E2EAE9', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#2A4B4C' },
  detalhesNome: { fontSize: 22, fontWeight: 'bold', color: '#2A4B4C', marginTop: 10 },
  detalhesCongregacao: { fontSize: 16, color: '#666', marginTop: 4 },
  trocarCongregacaoTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E2EAE9', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, marginTop: 6, borderWidth: 1, borderColor: '#2A4B4C' },
  detalhesCongregacaoLink: { fontSize: 14, color: '#2A4B4C', fontWeight: 'bold' },
  detalhesBox: { backgroundColor: '#fff', padding: 15, borderRadius: 15, marginBottom: 20, elevation: 2 },
  detalhesInfo: { fontSize: 15, color: '#444', marginBottom: 10, fontWeight: '500' },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  actionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E2EAE9', paddingHorizontal: 15, paddingVertical: 12, borderRadius: 8, flex: 0.48, justifyContent: 'center', borderWidth: 1, borderColor: '#2A4B4C' },
  actionText: { color: '#2A4B4C', fontWeight: 'bold', marginLeft: 5, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', width: '80%', borderRadius: 15, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2A4B4C', marginBottom: 15, textAlign: 'center' },
  modalOption: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE', paddingHorizontal: 10, borderRadius: 6 },
  modalOptionText: { fontSize: 15, color: '#333', textAlign: 'center' }
});