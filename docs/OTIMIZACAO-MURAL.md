# Otimização de imagens do mural

- A seleção continua limitada a fotos. O aplicativo prepara JPEG com lado maior de até 1600 px, preservando a proporção e sem ampliar imagens pequenas. Reduz qualidade e, se necessário, resolução em até quatro tentativas até respeitar o limite de 1,5 MB. A decodificação já é limitada para reduzir o pico de memória.
- A foto anterior permanece selecionada se a nova seleção for cancelada ou falhar. A publicação fica indisponível enquanto a preparação está em andamento.
- O feed e a visualização em tela cheia usam Expo Image, com proporção obtida no próprio carregamento e janela de renderização limitada. A foto inteira continua visível na visualização em tela cheia.
- URLs públicas reconhecidas do Cloudinary solicitam uma única variante de até 1600 × 1600 px com qualidade e formato automáticos. Se a transformação falhar, o original é carregado. As transformações consomem a franquia do fornecedor; acompanhar o uso, sem alterar o plano nesta etapa.
- URLs assinadas da API, Data URIs legadas, fotos de perfil e URLs externas não são reescritas; o cache persistente do Expo Image só é habilitado para imagens públicas reconhecidas do Cloudinary.
- Nenhuma alteração na API, migração de dados ou mudança em arquivos existentes. O novo módulo nativo Expo ImageManipulator será incorporado ao APK da versão consolidada 1.3.0, sem gerar um APK intermediário.

## Testes

`npm run test:network` inclui testes da política de compressão, tamanho, proporção e URL. O teste Playwright do CI seleciona uma imagem real sintética e verifica dimensões e tamanho da prévia, sem publicar ou usar dados de produção.
