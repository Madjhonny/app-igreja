import { apiFetch, saveSession } from '@/services/session';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, FlatList, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

// Tokens visuais (somente aparência)
const cores = {
  verde: '#2A4B4C',
  bege: '#F7F5EC',
  neutro: '#C4C2B7',
  suave: '#E2EAE9',
  branco: '#FFFFFF',
  erro: '#E63946',
  verdeTexto: 'rgba(42, 75, 76, 0.72)',
  verdeSutil: 'rgba(42, 75, 76, 0.45)',
};

export default function TelaRegistro() {
  // === ESTADOS DOS CAMPOS ===
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [congregacaoId, setCongregacaoId] = useState<number | null>(null);
  const [congregacaoNome, setCongregacaoNome] = useState('Selecione sua congregação');
  const [listaCongregacoes, setListaCongregacoes] = useState<{ id: number; nome: string }[]>([]);
  const [carregandoCongregacoes, setCarregandoCongregacoes] = useState(true);
  const [erroCongregacoes, setErroCongregacoes] = useState('');
  
  // === ESTADOS DE CONTROLE DE UI ===
  const [modalVisivel, setModalVisivel] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [cadastroConcluido, setCadastroConcluido] = useState(false);
  const [autenticandoConvidado, setAutenticandoConvidado] = useState(false);
  const [erroAcessoConvidado, setErroAcessoConvidado] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmarSenha, setMostrarConfirmarSenha] = useState(false);

  // === ESTADOS DE ERRO ===
  const [erroEmail, setErroEmail] = useState('');
  const [erroSenha, setErroSenha] = useState('');

  // === ESTADO VISUAL (apenas aparência): campo com foco ===
  const [campoFocado, setCampoFocado] = useState<string | null>(null);
  const foco = (campo: string) => ({
    onFocus: () => setCampoFocado(campo),
    onBlur: () => setCampoFocado(null),
  });
  const estadosVisuais = (campo: string, valor: string, erro: string) => [
    valor.length > 0 && styles.inputPreenchido,
    campoFocado === campo && styles.inputFocado,
    !!erro && styles.inputErro,
  ];

  const carregarCongregacoes = useCallback(async () => {
    setErroCongregacoes('');
    setCarregandoCongregacoes(true);
    try {
      const resposta = await apiFetch('/congregacoes');
      const dados = await resposta.json();
      if (!resposta.ok || !Array.isArray(dados)) throw new Error('INVALID_RESPONSE');
      setListaCongregacoes(dados);
    } catch {
      setErroCongregacoes('Não foi possível carregar as congregações.');
    } finally {
      setCarregandoCongregacoes(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(carregarCongregacoes);
  }, [carregarCongregacoes]);

  const escolherFoto = async () => {
    const permissao = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissao.granted === false) {
      Alert.alert('Permissão negada', 'Precisamos de acesso à galeria para escolher uma foto.');
      return;
    }

    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], 
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });

    if (!resultado.canceled && resultado.assets[0].base64) {
      const base64 = resultado.assets[0].base64;
      if (Math.ceil(base64.length * 0.75) > 1_500_000) {
        Alert.alert('Imagem muito grande', 'Escolha uma foto de até 1,5 MB.');
        return;
      }
      setFoto(`data:image/jpeg;base64,${base64}`);
    }
  };

  const aplicarMascaraCPF = (texto: string) => {
    let limpo = texto.replace(/\D/g, '').slice(0, 11);
    limpo = limpo.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    setCpf(limpo);
  };

  const aplicarMascaraTelefone = (texto: string) => {
    let limpo = texto.replace(/\D/g, '').slice(0, 11);
    limpo = limpo.replace(/^(\d{2})(\d)/g, '($1) $2').replace(/(\d)(\d{4})$/, '$1-$2');
    setTelefone(limpo);
  };

  // === VALIDAÇÕES EM TEMPO REAL ===
  const validarEmail = (texto: string) => {
    setEmail(texto);
    const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (texto.length > 0 && !regexEmail.test(texto)) {
      setErroEmail('Formato inválido. Use exemplo@dominio.com');
    } else {
      setErroEmail('');
    }
  };

  const validarSenha = (textoSenhaAtual: string, textoConfirmacao: string) => {
    setSenha(textoSenhaAtual);
    if (textoConfirmacao.length > 0 && textoSenhaAtual !== textoConfirmacao) {
      setErroSenha('As senhas não coincidem.');
    } else {
      setErroSenha('');
    }
  };

  const validarConfirmacaoSenha = (textoConfirmacao: string) => {
    setConfirmarSenha(textoConfirmacao);
    if (textoConfirmacao.length > 0 && senha !== textoConfirmacao) {
      setErroSenha('As senhas não coincidem.');
    } else {
      setErroSenha('');
    }
  };

  const fazerCadastro = async () => {
    if (!nome || !email || !senha || !confirmarSenha || !cpf || !telefone || !congregacaoId) {
      return Alert.alert('Atenção', 'Preencha todos os campos e selecione sua congregação.');
    }

    const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regexEmail.test(email)) {
      setErroEmail('Formato inválido. Use exemplo@dominio.com');
      return Alert.alert('Erro', 'Por favor, corrija o e-mail antes de continuar.');
    }

    if (senha !== confirmarSenha) {
      setErroSenha('As senhas não coincidem.');
      return Alert.alert('Erro', 'As senhas não coincidem. Verifique a digitação.');
    }
    if (senha.length < 10 || !/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/\d/.test(senha)) {
      setErroSenha('Use ao menos 10 caracteres, com maiúscula, minúscula e número.');
      return Alert.alert('Senha fraca', 'Use ao menos 10 caracteres, com maiúscula, minúscula e número.');
    }

    setCarregando(true);
    try {
      const resposta = await apiFetch('/cadastro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_completo: nome, 
          email: email.toLowerCase().trim(), 
          senha, 
          cpf, 
          telefone, 
          foto_perfil: foto, 
          congregacao_id: congregacaoId
        })
      });

      const dados = await resposta.json().catch(() => null);
      const cadastroValido = resposta.status === 201
        && Number.isSafeInteger(dados?.usuario?.id)
        && dados.usuario.status_conta === 'PENDENTE';

      if (cadastroValido) {
        setErroAcessoConvidado('');
        setCadastroConcluido(true);
      } else if (!resposta.ok) {
        Alert.alert('Erro', dados?.erro || 'Falha ao cadastrar.');
      } else {
        Alert.alert('Erro', 'O servidor retornou uma resposta de cadastro inválida. Tente entrar manualmente.');
      }
    } catch {
      Alert.alert('Erro de Conexão', 'Não foi possível conectar ao servidor.');
    } finally {
      setCarregando(false);
    }
  };

  const acessarComoConvidado = async () => {
    if (autenticandoConvidado) return;

    setErroAcessoConvidado('');
    setAutenticandoConvidado(true);
    try {
      const resposta = await apiFetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), senha }),
      });
      const dados = await resposta.json().catch(() => null);
      const sessaoValida = resposta.ok
        && typeof dados?.token === 'string'
        && dados.token.length > 0
        && Number.isSafeInteger(dados?.usuario?.id);

      if (!sessaoValida) {
        setErroAcessoConvidado(
          dados?.erro
            ? `${dados.erro} Você também pode entrar manualmente.`
            : 'Não foi possível acessar como convidado. Entre manualmente para continuar.',
        );
        return;
      }

      await saveSession(dados.token, dados.usuario, false);
      setSenha('');
      setConfirmarSenha('');
      router.replace('/(tabs)/agenda');
    } catch {
      setErroAcessoConvidado('Não foi possível conectar ao servidor. Entre manualmente para continuar.');
    } finally {
      setAutenticandoConvidado(false);
    }
  };

  if (cadastroConcluido) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.headerTitle}>Cadastro concluído</Text>
        </View>

        <ScrollView
          style={styles.painel}
          contentContainerStyle={styles.confirmationContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.confirmationCard}>
            <Ionicons accessibilityElementsHidden importantForAccessibility="no-hide-descendants" name="checkmark-circle" size={64} color={cores.verde} />
            <Text accessibilityRole="header" style={styles.confirmationTitle}>Cadastro realizado com sucesso!</Text>
            <Text style={styles.confirmationText}>Sua conta foi criada e está aguardando aprovação.</Text>
            <Text style={styles.confirmationText}>
              Entre em contato com o secretário da sua congregação para solicitar a aprovação do seu cadastro.
            </Text>
            <Text style={styles.confirmationText}>
              Enquanto aguarda, você poderá acessar o Agenda ADP como convidado e acompanhar as informações disponíveis.
            </Text>

            {!!erroAcessoConvidado && (
              <Text accessibilityRole="alert" style={styles.guestAccessError}>{erroAcessoConvidado}</Text>
            )}

            <TouchableOpacity
              style={[styles.guestAccessButton, autenticandoConvidado && styles.buttonDisabled]}
              onPress={() => void acessarComoConvidado()}
              disabled={autenticandoConvidado}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Acessar como convidado"
              accessibilityState={{ disabled: autenticandoConvidado, busy: autenticandoConvidado }}
            >
              {autenticandoConvidado
                ? <ActivityIndicator color={cores.bege} />
                : <Text style={styles.saveButtonText}>ACESSAR COMO CONVIDADO</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.loginLinkButton}
              onPress={() => router.replace('/login')}
              disabled={autenticandoConvidado}
              accessibilityRole="button"
              accessibilityLabel="Voltar ao login"
              accessibilityState={{ disabled: autenticandoConvidado }}
            >
              <Text style={styles.loginLinkText}>Voltar ao login</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={cores.bege} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Criar Conta</Text>
      </View>

      <KeyboardAvoidingView 
        style={styles.painel} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView 
          style={styles.formContainer}
          contentContainerStyle={styles.scrollContent} // <--- Espaço vazio garantido no final
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled" // <--- Permite clicar mesmo com o teclado aberto
        >
          <View style={styles.formInner}>
            <View style={styles.fotoContainer}>
              <TouchableOpacity onPress={escolherFoto} style={styles.botaoFoto} activeOpacity={0.8}>
                {foto ? (
                  <Image source={{ uri: foto }} style={styles.imagemPerfil} />
                ) : (
                  <View style={styles.fotoPlaceholder}>
                    <Ionicons name="camera" size={34} color={cores.verdeTexto} />
                    <Text style={styles.textoFoto}>Adicionar Foto</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Nome Completo</Text>
            <TextInput
              style={[styles.input, ...estadosVisuais('nome', nome, '')]}
              placeholder="Ex: João da Silva"
              placeholderTextColor={cores.verdeSutil}
              selectionColor={cores.verde}
              value={nome}
              onChangeText={setNome}
              {...foco('nome')}
            />

            <Text style={styles.label}>CPF</Text>
            <TextInput
              style={[styles.input, ...estadosVisuais('cpf', cpf, '')]}
              placeholder="000.000.000-00"
              placeholderTextColor={cores.verdeSutil}
              selectionColor={cores.verde}
              keyboardType="numeric"
              value={cpf}
              onChangeText={aplicarMascaraCPF}
              maxLength={14}
              {...foco('cpf')}
            />

            <Text style={styles.label}>Telefone / WhatsApp</Text>
            <TextInput
              style={[styles.input, ...estadosVisuais('telefone', telefone, '')]}
              placeholder="(00) 00000-0000"
              placeholderTextColor={cores.verdeSutil}
              selectionColor={cores.verde}
              keyboardType="phone-pad"
              value={telefone}
              onChangeText={aplicarMascaraTelefone}
              maxLength={15}
              {...foco('telefone')}
            />

            <Text style={styles.label}>E-mail</Text>
            <TextInput 
              style={[styles.input, ...estadosVisuais('email', email, erroEmail)]} 
              placeholder="Ex: joao@email.com" 
              placeholderTextColor={cores.verdeSutil}
              selectionColor={cores.verde}
              keyboardType="email-address" 
              autoCapitalize="none" 
              value={email} 
              onChangeText={validarEmail} 
              {...foco('email')}
            />
            {erroEmail ? <Text style={styles.errorText}>{erroEmail}</Text> : null}

            <Text style={styles.label}>Senha</Text>
            <View style={[styles.passwordContainer, ...estadosVisuais('senha', senha, erroSenha)]}>
              <TextInput 
                style={styles.passwordInput} 
                placeholder="Crie uma senha forte" 
                placeholderTextColor={cores.verdeSutil}
                selectionColor={cores.verde}
                secureTextEntry={!mostrarSenha} 
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                accessibilityLabel="Senha"
                value={senha} 
                onChangeText={(texto) => validarSenha(texto, confirmarSenha)} 
                {...foco('senha')}
              />
              <TouchableOpacity onPress={() => setMostrarSenha(atual => !atual)} style={styles.eyeIcon} accessibilityRole="button" accessibilityLabel={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}>
                <Ionicons name={mostrarSenha ? "eye-off" : "eye"} size={22} color={cores.verdeTexto} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Confirmar Senha</Text>
            <View style={[styles.passwordContainer, ...estadosVisuais('confirmarSenha', confirmarSenha, erroSenha)]}>
              <TextInput 
                style={styles.passwordInput} 
                placeholder="Repita sua senha" 
                placeholderTextColor={cores.verdeSutil}
                selectionColor={cores.verde}
                secureTextEntry={!mostrarConfirmarSenha} 
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                accessibilityLabel="Confirmar senha"
                value={confirmarSenha} 
                onChangeText={validarConfirmacaoSenha} 
                {...foco('confirmarSenha')}
              />
              <TouchableOpacity onPress={() => setMostrarConfirmarSenha(atual => !atual)} style={styles.eyeIcon} accessibilityRole="button" accessibilityLabel={mostrarConfirmarSenha ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}>
                <Ionicons name={mostrarConfirmarSenha ? "eye-off" : "eye"} size={22} color={cores.verdeTexto} />
              </TouchableOpacity>
            </View>
            {erroSenha ? <Text style={styles.errorText}>{erroSenha}</Text> : null}

            <Text style={styles.label}>Sua Congregação</Text>
            <TouchableOpacity
              style={styles.selectInput}
              onPress={() => setModalVisivel(true)}
              activeOpacity={0.8}
              disabled={carregandoCongregacoes || !!erroCongregacoes}
              accessibilityRole="button"
              accessibilityLabel="Selecionar congregação"
            >
              <Text style={[styles.selectText, congregacaoId !== null && styles.selectTextFilled]}>{congregacaoNome}</Text>
              {carregandoCongregacoes
                ? <ActivityIndicator size="small" color={cores.verde} />
                : <Ionicons name="chevron-down" size={20} color={cores.verde} />}
            </TouchableOpacity>
            {!!erroCongregacoes && (
              <TouchableOpacity onPress={() => void carregarCongregacoes()} accessibilityRole="button">
                <Text accessibilityRole="alert" style={styles.errorText}>{erroCongregacoes} Toque para tentar novamente.</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.saveButton, carregando && styles.buttonDisabled]}
              onPress={fazerCadastro}
              disabled={carregando}
              activeOpacity={0.85}
            >
              {carregando ? <ActivityIndicator color={cores.bege} /> : <Text style={styles.saveButtonText}>CADASTRAR</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal transparent={true} visible={modalVisivel} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalVisivel(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Escolha sua Congregação</Text>
            <FlatList
              data={listaCongregacoes}
              keyExtractor={(item) => item.id.toString()}
              showsVerticalScrollIndicator={false}
              renderItem={({item}) => (
                <TouchableOpacity
                  style={[styles.modalOption, congregacaoId === item.id && styles.modalOptionSelecionada]}
                  onPress={() => { setCongregacaoId(item.id); setCongregacaoNome(item.nome); setModalVisivel(false); }}
                >
                  <Text style={[styles.modalOptionText, congregacaoId === item.id && styles.modalOptionTextSelecionada]}>{item.nome}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.verde },

  // Cabeçalho
  header: { backgroundColor: cores.verde, paddingTop: 52, paddingBottom: 26, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(247, 245, 236, 0.12)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  headerTitle: { color: cores.bege, fontSize: 20, fontWeight: '700', letterSpacing: 0.3 },

  // Painel claro com cantos superiores arredondados sobre o cabeçalho verde
  painel: { flex: 1, backgroundColor: cores.bege, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  formContainer: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 150 },
  formInner: { width: '100%', maxWidth: 480, alignSelf: 'center' },

  fotoContainer: { alignItems: 'center', marginBottom: 12 },
  botaoFoto: { width: 112, height: 112, borderRadius: 56, overflow: 'hidden', backgroundColor: cores.suave, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: cores.neutro },
  fotoPlaceholder: { alignItems: 'center' },
  textoFoto: { fontSize: 12, color: cores.verdeTexto, marginTop: 6 },
  imagemPerfil: { width: '100%', height: '100%' },

  label: { fontSize: 13, fontWeight: '600', color: cores.verde, marginBottom: 8, marginTop: 18, marginLeft: 2 },
  input: {
    height: 54,
    backgroundColor: cores.branco,
    borderWidth: 1,
    borderColor: cores.neutro,
    paddingHorizontal: 16,
    borderRadius: 14,
    fontSize: 16,
    color: cores.verde,
  },

  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 54,
    minHeight: 54,
    backgroundColor: cores.branco,
    borderWidth: 1,
    borderColor: cores.neutro,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 8,
  },
  passwordInput: { flex: 1, minWidth: 0, height: 54, paddingHorizontal: 0, paddingVertical: 0, fontSize: 16, color: cores.verde },
  eyeIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  // Estados visuais dos campos (a ordem no array garante a prioridade: erro > foco > preenchido)
  inputPreenchido: { borderColor: cores.verdeSutil },
  inputFocado: {
    borderColor: cores.verde,
    shadowColor: cores.verde,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  inputErro: { borderColor: cores.erro },
  errorText: { color: cores.erro, fontSize: 12, marginTop: 6, marginLeft: 4, fontWeight: '600' },

  selectInput: {
    height: 54,
    backgroundColor: cores.branco,
    borderWidth: 1,
    borderColor: cores.neutro,
    paddingHorizontal: 16,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectText: { fontSize: 16, color: cores.verdeSutil },
  selectTextFilled: { color: cores.verde, fontWeight: '500' },
  
  saveButton: {
    height: 54,
    backgroundColor: cores.verde,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: 40,
    shadowColor: cores.verde,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  buttonDisabled: { opacity: 0.7 },
  saveButtonText: { color: cores.bege, fontSize: 16, fontWeight: '700', letterSpacing: 1.2 },

  confirmationContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 36 },
  confirmationCard: { width: '100%', maxWidth: 480, alignSelf: 'center', alignItems: 'center', backgroundColor: cores.branco, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 32, borderWidth: 1, borderColor: cores.suave },
  confirmationTitle: { marginTop: 14, marginBottom: 18, color: cores.verde, fontSize: 23, fontWeight: '700', textAlign: 'center' },
  confirmationText: { color: cores.verdeTexto, fontSize: 16, lineHeight: 23, textAlign: 'center', marginBottom: 12 },
  guestAccessError: { width: '100%', color: cores.erro, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, marginBottom: 4, fontWeight: '600' },
  guestAccessButton: { width: '100%', minHeight: 54, backgroundColor: cores.verde, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 18, paddingHorizontal: 12 },
  loginLinkButton: { marginTop: 16, minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  loginLinkText: { color: cores.verde, fontSize: 15, fontWeight: '700' },
  
  // Modal de congregações
  modalOverlay: { flex: 1, backgroundColor: 'rgba(42, 75, 76, 0.55)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: cores.bege, width: '88%', maxWidth: 420, maxHeight: '70%', borderRadius: 20, paddingTop: 24, paddingBottom: 12, paddingHorizontal: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: cores.verde, marginBottom: 12, textAlign: 'center' },
  modalOption: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: cores.suave, borderRadius: 10 },
  modalOptionSelecionada: { backgroundColor: cores.suave },
  modalOptionText: { fontSize: 16, color: cores.verde, textAlign: 'center' },
  modalOptionTextSelecionada: { fontWeight: '700' },
});
