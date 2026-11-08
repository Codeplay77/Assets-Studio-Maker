# Assets Studio Maker

Editor de assets 3D para quem está começando a criar jogos. Você monta personagens e objetos
encaixando blocos prontos, sem precisar aprender modelagem. O projeto é só para Windows.

> **Estado atual: início do desenvolvimento.** Já dá para montar modelos, mas ainda não dá para
> salvar nem exportar. Veja o [roteiro](#roteiro).

## O que já funciona

- Biblioteca com 606 modelos prontos em CC0: veículos, construções, ruas, autódromo, natureza e
  personagens
- 171 peças próprias para montar: corpo, rosto, cabelo e chapéus, veículos, rodas, ruas, pistas,
  prédios, mobiliário urbano e natureza
- Materiais por peça: fosco, pintura brilhante, metal, vidro e luzes acesas
- Geradores aleatórios de pessoa, boneco, veículo, prédio, casa, árvore, cidade e pista
- Encaixe por pontos verdes: passe o mouse sobre um bloco e clique em um ponto
- Mover, girar e esticar peças, com valores que se alinham a uma grade
- Cor por peça, duplicar, apagar, desfazer e refazer

## Geradores

Na aba **Criar**, cada clique sorteia um modelo novo e enquadra a câmera nele. O modelo
substitui o que está na cena, e Ctrl+Z traz tudo de volta. Para ir somando modelos lado a lado,
marque **Manter o que já está na cena**.

Cada modelo sai de um número, a **semente**. Digite a semente e clique em **Repetir** para obter
exatamente o mesmo resultado.

## Atalhos

| Tecla | Ação |
| --- | --- |
| Clique | Coloca o bloco escolhido ou seleciona uma peça |
| R | Gira o bloco antes de colocar |
| Esc | Termina de colocar ou limpa a seleção |
| W / E / T | Mover / girar / esticar |
| F | Enquadra a peça selecionada ou o modelo inteiro |
| Ctrl+Z / Ctrl+Y | Desfaz / refaz |
| Ctrl+D | Duplica |
| Delete | Apaga |
| Botão direito | Gira a câmera |
| Botão do meio | Arrasta a câmera |
| Roda do mouse | Aproxima ou afasta |

## Como rodar

Você precisa do [Rust](https://rustup.rs), do [Node.js](https://nodejs.org), do
[pnpm](https://pnpm.io) e das ferramentas de C++ do Visual Studio.

```powershell
pnpm install
pnpm tauri dev
```

Para rodar os testes:

```powershell
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Como o projeto é organizado

A interface e o viewport 3D são feitos em TypeScript com React e Three.js. O Rust guarda o
projeto e aplica todas as alterações.

| Pasta | Conteúdo |
| --- | --- |
| `src/blocks/definitions/` | Onde cada bloco é definido |
| `src/blocks/blocks.json` | Catálogo gerado, lido pela interface e pelo Rust |
| `src/generators/` | Geradores aleatórios |
| `src/viewport/` | Cena 3D e cálculo de encaixe |
| `src/ui/` | Painéis e atalhos |
| `src-tauri/src/document.rs` | O projeto, os comandos e o histórico de desfazer |

Toda alteração é um comando aplicado em `document.rs`. A interface só desenha o estado que o
Rust publica, e o agente de IA vai usar esses mesmos comandos. Assim, o que ele fizer aparece
na hora e pode ser desfeito.

Para criar um bloco, adicione-o em `src/blocks/definitions/` e rode `pnpm catalog`. O primeiro
item de `sockets` é o ponto que o bloco usa para se encaixar nos outros. Partes sem `color` seguem
a cor escolhida pela pessoa, e partes com `color` mantêm a própria cor, como vidros e pneus. Com o
`tauri dev` aberto, reinicie depois de `pnpm catalog`, porque o Rust embute o catálogo ao compilar.

## Roteiro

1. **Montagem por blocos e geradores:** feitos
2. **Salvar e exportar:** projeto em arquivo e exportação para GLB, testada no Godot
3. **Agente de IA:** servidor MCP local e captura do viewport, para um agente montar o modelo
   para você
4. **Animação:** esqueleto criado a partir dos encaixes e biblioteca de animações prontas
5. **Linha do tempo:** ajuste simples de poses e novas animações próprias do editor

## Adicionar modelos à biblioteca

Baixe os pacotes listados em [CREDITS.md](CREDITS.md), descompacte cada um em
`<pasta>/<pacote>/x/` e rode:

```powershell
node scripts/import-models.ts <pasta>
pnpm catalog
```

Só adicione modelos CC0. A lista de pacotes, a escala e a categoria ficam no início de
`scripts/import-models.ts`. Registre todo pacote novo em [CREDITS.md](CREDITS.md).

## Licenças

O código é distribuído sob a [licença MIT](LICENSE), e os recursos de terceiros estão em
[CREDITS.md](CREDITS.md).

A biblioteca de animações planejada vem do
[Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app), cujos modelos, rigs e animações
são CC0. Ela será creditada aqui quando entrar no projeto.
