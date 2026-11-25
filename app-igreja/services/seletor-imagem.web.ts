import type { ImagePickerOptions, ImagePickerResult } from 'expo-image-picker';

function escolherArquivo(): Promise<File | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.dataset.testid = 'file-input';

    function limpar() {
      input.removeEventListener('change', selecionar);
      input.removeEventListener('cancel', cancelar);
      input.remove();
    }
    function selecionar() {
      const arquivo = input.files?.[0] ?? null;
      limpar();
      resolve(arquivo);
    }
    function cancelar() {
      limpar();
      resolve(null);
    }

    input.addEventListener('change', selecionar);
    input.addEventListener('cancel', cancelar);
    document.body.appendChild(input);
    try {
      input.click();
    } catch (erro) {
      limpar();
      reject(erro);
    }
  });
}

function lerDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(leitor.error);
    leitor.onload = () => resolve(String(leitor.result));
    leitor.readAsDataURL(arquivo);
  });
}

export async function selecionarImagem({ base64 = false }: ImagePickerOptions): Promise<ImagePickerResult> {
  const arquivo = await escolherArquivo();
  if (!arquivo) return { canceled: true, assets: null };
  if (!arquivo.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');

  const uri = base64 ? await lerDataUrl(arquivo) : URL.createObjectURL(arquivo);
  try {
    const imagem = new Image();
    imagem.src = uri;
    await imagem.decode();
    return { canceled: false, assets: [{
      uri, width: imagem.naturalWidth, height: imagem.naturalHeight, type: 'image',
      mimeType: arquivo.type, fileName: arquivo.name, fileSize: arquivo.size, file: arquivo,
      base64: base64 ? uri.slice(uri.indexOf(',') + 1) : undefined,
    }] };
  } catch (erro) {
    if (!base64) URL.revokeObjectURL(uri);
    throw erro;
  }
}
