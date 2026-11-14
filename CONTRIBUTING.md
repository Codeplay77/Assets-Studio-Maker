# Como contribuir

Obrigado por querer ajudar o Assets Studio Maker. Toda contribuição conta: relatar um erro,
sugerir uma ideia, melhorar um texto, criar um gerador novo ou trazer modelos CC0.

## Relatar um erro ou sugerir algo

Abra uma [issue](https://github.com/Codeplay77/Assets-Studio-Maker/issues) com um dos modelos
prontos. Para erros, conte o que você fez, o que esperava e o que aconteceu, com a versão do Windows
e, se der, uma imagem ou o arquivo `.asmproj`. Antes, procure se alguém já abriu uma issue igual.

Falhas de segurança não vão em issues públicas: veja a [política de segurança](SECURITY.md).

## Preparar o ambiente

Você precisa do Windows, do [Rust](https://rustup.rs), do [Node.js](https://nodejs.org) 24, do
[pnpm](https://pnpm.io) e das ferramentas de C++ do Visual Studio.

```powershell
git clone https://github.com/<seu-usuario>/Assets-Studio-Maker.git
cd Assets-Studio-Maker
pnpm install
pnpm tauri dev
```

Para mexer nos veículos, nos modelos do Poly Haven ou nas pessoas do Realista, instale também o
[Blender](https://www.blender.org) 5.1 (as pessoas pedem ainda o MPFB e o pacote de recursos do
MakeHuman). Os comandos de cada pacote estão no [README](README.md#desenvolvimento).

## Enviar uma mudança

1. Para mudanças grandes, abra uma issue antes e combine a ideia
2. Faça um fork e crie um branch com um nome curto, como `gerador-animais`
3. Faça a mudança e confira no editor, com `pnpm tauri dev`
4. Confira se tudo compila:

   ```powershell
   npx tsc --noEmit -p .
   cargo check --manifest-path src-tauri/Cargo.toml
   ```

5. Abra um pull request contando o que mudou e por quê. Para mudanças visuais, mande imagens do
   antes e do depois

## Regras do projeto

**Idioma.** O editor é em português do Brasil: textos da interface, nomes de blocos, opções dos
geradores e mensagens de erro. O código, os nomes de variáveis e os comentários ficam em inglês.

**Estilos.** Tudo o que se gera pertence a um estilo só: Low poly, Realista, Blocos ou Arcade. Um
gerador ou bloco novo precisa existir nos quatro. Os estilos se diferenciam na forma, não só no
material: Realista tem proporções e detalhes reais, Arcade tem formas de brinquedo, Blocos é feito
de cubos e Low poly tem faces planas à vista.

**Blocos.** Os blocos são definidos em `src/blocks/definitions/`. Depois de mudar algum, rode
`pnpm catalog`, que gera o `src/blocks/blocks.json`; não edite esse arquivo à mão. O primeiro
encaixe (`sockets`) de um bloco é o ponto que ele usa para se prender aos outros.

**Alterações no projeto.** Toda alteração passa por um comando em `src-tauri/src/document.rs`,
para poder ser desfeita e para que o agente de IA use o mesmo caminho da interface.

**Modelos gerados.** Antes de dar um modelo novo por pronto, gere vários exemplos em todos os
estilos e confira as imagens de perto, com as medidas reais. Conte os triângulos: são assets para
jogos.

**Assets de terceiros.** Só entram modelos, animações e texturas CC0, de fontes que mostram a
licença, como as publicações do próprio autor. Registre cada pacote novo nos créditos do
[README](README.md#créditos-e-agradecimentos) e no [CREDITS.md](CREDITS.md). Não envie os pacotes
baixados: só os arquivos que os scripts geram em `public/models/` e `public/animations/`, e os
scripts que os geram.

**Pacotes binários.** Os arquivos `.bin` são gerados por scripts. Para mudá-los, mude o script e
rode de novo, e explique no pull request o que mudou no pacote.

## Licença das contribuições

Ao enviar uma contribuição, você concorda que ela seja distribuída sob a [licença MIT](LICENSE)
do projeto.

Quem participa do projeto segue o [código de conduta](CODE_OF_CONDUCT.md).
