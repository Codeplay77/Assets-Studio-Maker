# Assets Studio Maker

Editor de assets 3D para quem está começando a criar jogos: a liberdade de um programa de
modelagem, com ferramentas que dá para entender no primeiro uso. Você pode encaixar blocos prontos,
sortear modelos, moldar formas novas ou pedir para um agente de IA modelar por você. O projeto é só
para Windows.

> **Estado atual: início do desenvolvimento.** Já dá para montar e modelar, salvar projetos e
> exportar GLB para usar em jogos. Veja o [roteiro](#roteiro).

## O que já funciona

- Biblioteca com 606 modelos prontos em CC0: veículos, construções, ruas, autódromo, natureza e
  personagens
- Mais de 1.300 peças próprias para montar, nos estilos Low poly, Realista, Blocos e Arcade: karts,
  carros, caminhões, ônibus, carretas, motos, casas, prédios, corpo, rosto, cabelo e chapéus, rodas,
  ruas, mobiliário urbano e natureza
- Materiais por peça: fosco, pintura brilhante, metal, vidro e luzes acesas
- Geradores com opções e estilo único: pessoa (homem, mulher, adulto, criança e mais), veículo
  (carros, karts, motos, caminhões, ônibus e carretas), prédio, casa, árvore, cidade (com ruas irregulares, orgânicas ou em grade) e mapa
- Modelagem livre: comece de uma forma básica ou de qualquer peça pronta e edite faces, arestas e
  pontos
- Encaixe por pontos verdes: passe o mouse sobre um bloco e clique em um ponto
- Mover, girar e esticar peças, com valores que se alinham a uma grade
- Cor por peça, duplicar, apagar, desfazer e refazer
- Grupos e seleção múltipla: um modelo gerado se move inteiro
- Salvar e abrir projetos (`.asmproj`)
- Exportar GLB, com a cena inteira ou só a seleção (testado no Godot 4.7)
- Servidor MCP local, para um agente de IA montar modelos no editor

## Modelar do zero

Na aba **Modelar**, escolha uma forma para começar. Para editar uma peça que já está na cena,
selecione e clique em **Modelar esta peça**. Com várias peças selecionadas, **Juntar e modelar**
transforma todas em uma forma só.

Clique em uma face, aresta ou ponto e arraste as setas. Com faces selecionadas, a seta verde aponta
para fora delas.

| Ferramenta | O que faz |
| --- | --- |
| **Puxar** | Puxa as faces para fora e cria paredes novas. Com valor negativo, afunda |
| **Moldura** | Cria uma face menor dentro de cada face |
| **Dividir** | Corta as faces em faces menores |
| **Arredondar** | Transforma cantos em curvas na forma inteira |
| **Suavizar** | Alisa a superfície |
| **Espelhar** | Refaz um lado como reflexo do outro: modele metade e espelhe |
| **Juntar** | Une os pontos selecionados em um só |
| **Criar face** | Fecha um buraco passando pelos pontos selecionados |
| **Arraste suave** | Faz os pontos próximos acompanharem o movimento, bom para formas orgânicas |
| **Chanfrar** | Corta as arestas selecionadas, em reta ou em curva. Sem seleção, corta todas as quinas vivas |
| **Furar** | Abre um furo redondo ou quadrado no meio de cada face selecionada |

Fora das setas, arraste para selecionar com um retângulo. Só entra o que está visível.

Na opção **Esculpir**, passe o pincel sobre a forma para levantar, afundar, alisar, achatar ou
agarrar a superfície. Segure Ctrl para inverter o efeito e Shift para alisar. Formas com poucos
pontos ganham mais detalhe com o botão **Aumentar detalhe**.

Para combinar peças inteiras, deixe uma encostada na outra, selecione as duas e use **Furar**,
**Unir** ou **Comum** no painel da direita. A primeira peça clicada é a que recebe o furo.

Cada face pode ter cor e acabamento próprios. As formas ficam em **Minhas formas**, de onde você
coloca outras cópias na cena. Alterar uma forma muda todas as peças que a usam. Para criar uma
variação, faça uma cópia independente nesse mesmo painel.

## Exportar para um jogo

Clique em **Exportar** (ou Ctrl+E) e escolha:

- **Só o que está selecionado**, para exportar um modelo e deixar o resto da cena de fora
- **Juntar em uma malha só**, mais leve no jogo porque vira uma peça única
- **Centralizar na origem**, que coloca a base do modelo no ponto zero

As cores vão nos vértices do modelo, então não há textura para copiar junto com o arquivo.

## Agente de IA

Um agente de IA pode montar modelos para você neste editor, usando o protocolo MCP. Tudo o que ele
faz aparece na hora, e cada ação pode ser desfeita com Ctrl+Z.

1. Clique no ícone de robô, no canto superior direito, e ligue **Permitir agentes neste computador**
2. Copie o comando (Claude Code) ou o JSON (outros agentes) e adicione ao seu agente
3. Peça algo como "monte um personagem de moletom vermelho" com o editor aberto

O agente não fica preso aos blocos prontos. Ele cria formas novas a partir de formas básicas,
perfis girados, seções, tubos, silhuetas ou polígonos livres, e edita tudo com as mesmas operações
da aba **Modelar**. Também encaixa peças, usa os geradores e recebe imagens do modelo para conferir
o resultado.

O servidor vem desligado e só funciona com o editor aberto. Ele aceita conexões apenas deste
computador e exige uma chave de acesso, que você troca no mesmo painel. O agente não abre nem salva
projetos. As exportações dele vão para `Documentos\Assets Studio Maker\Exportados` e nunca
substituem um arquivo.

| Ferramenta | O que faz |
| --- | --- |
| `get_scene`, `get_part` | Lê a cena, com medidas e encaixes |
| `search_blocks`, `get_block` | Procura blocos e mostra tamanho e encaixes |
| `create_shape` | Cria uma forma nova, com geometria livre |
| `edit_shape` | Puxa faces, fura, chanfra, combina formas, esculpe, arredonda, espelha e pinta |
| `generate` | Gera pessoas, veículos, prédios, casas, árvores, cidades e mapas, com estilo e opções |
| `get_shape`, `list_shapes` | Lê as formas do projeto, inclusive pontos e faces |
| `update_shape`, `duplicate_shape`, `delete_shape` | Altera, copia e apaga formas |
| `convert_to_shape` | Transforma peças prontas em uma forma editável |
| `add_parts`, `attach_part` | Coloca blocos livres ou encaixados em outra peça |
| `update_parts`, `move_parts`, `duplicate_parts`, `remove_parts` | Altera as peças |
| `group_parts`, `clear_scene` | Agrupa as peças e limpa a cena |
| `capture_view` | Devolve imagens do modelo, de vários ângulos |
| `frame_view` | Enquadra o modelo na sua tela |
| `undo`, `redo` | Desfaz e refaz |
| `export_glb` | Exporta um arquivo GLB |

## Geradores

Na aba **Criar**, escolha primeiro o **estilo**: tudo o que você gerar segue esse padrão, então
um boneco de blocos nunca aparece ao lado de um carro realista.

| Estilo | Como é |
| --- | --- |
| **Low poly** | Polígonos à vista, leve e colorido. Usa os modelos CC0 e o personagem low poly |
| **Realista** | Formas suaves e mais detalhe. Usa as peças próprias do editor |
| **Blocos** | Tudo feito de cubos, inclusive pessoas, carros, cidades e mapas |
| **Arcade** | Pintura brilhante, cromados e rodas grandes, no visual do jogo Codeplay in Kart |

Os karts, carros, caminhões, ônibus, carretas, motos, casas e prédios do Arcade têm pintura em
três áreas (principal, secundária e detalhes), além da cor dos aros. Em **Veículo**, o tipo **Kart**
ainda deixa trocar carroceria, rodas, aerofólio, capacete, piloto e macacão. Cada área é uma peça separada, então
também dá para mudar a cor depois, no painel da direita.

Depois clique em um tipo de modelo. As opções abrem no painel da direita: na **Pessoa**, sexo,
idade, porte, altura, pele, cabelo, roupa, barba, óculos, chapéu e mochila. O que ficar em
**Sortear** é decidido pela semente. Clique em **Gerar** e, a partir daí, cada opção alterada
atualiza o mesmo modelo sem mudar o resto. Cada mudança é um Ctrl+Z.

O modelo substitui o que está na cena. Com **Manter o que já está na cena** ligado, ele vai para o
lado do que já existe e o estilo fica preso ao da cena, para não misturar. **Mais um ao lado** soma
outro modelo do mesmo tipo.

Cada modelo sai de um número, a **semente**. A mesma semente com as mesmas opções dá sempre o mesmo
resultado. Nas abas **Peças** e **Biblioteca**, a lista mostra o estilo escolhido; use **Todos** para
ver tudo.

## Atalhos

| Tecla | Ação |
| --- | --- |
| Clique | Coloca o bloco escolhido ou seleciona o modelo inteiro |
| Clique duplo | Seleciona só aquela peça do modelo |
| Shift + clique | Soma à seleção |
| Ctrl+A | Seleciona tudo |
| Ctrl+G / Ctrl+Shift+G | Agrupa / desagrupa |
| Ctrl+N / Ctrl+O / Ctrl+S | Novo / abrir / salvar |
| Ctrl+Shift+S | Salvar como |
| Ctrl+E | Exportar GLB |
| R | Gira o bloco antes de colocar |
| Esc | Termina de colocar ou limpa a seleção |
| W / E / T | Mover / girar / esticar |
| F | Enquadra a peça selecionada ou o modelo inteiro |
| Ctrl+Z / Ctrl+Y | Desfaz / refaz |
| Ctrl+D | Duplica |
| Delete | Apaga |
| Tab | Entra e sai da modelagem da peça selecionada |
| 1 / 2 / 3 | Modelagem: faces / arestas / pontos |
| 4 | Modelagem: esculpir |
| P / I | Modelagem: puxar / moldura |
| B | Modelagem: chanfrar |
| [ / ] | Modelagem: diminuir / aumentar o pincel |
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
| `src/blocks/definitions/family/` | Família Arcade: karts, veículos, casas e prédios, com pintura em camadas |
| `tools/blender/` | Scripts do Blender que modelam os veículos de todos os estilos e geram `public/models/vehicles.bin` |
| `src/blocks/definitions/styleize.ts` | Converte um modelo de um estilo para os outros |
| `src/modeling/` | Malha editável, formas básicas e operações de modelagem |
| `src/viewport/` | Cena 3D e cálculo de encaixe |
| `src/ui/` | Painéis e atalhos |
| `src/mcp/` | Ferramentas do agente de IA |
| `src-tauri/src/document.rs` | O projeto, os comandos e o histórico de desfazer |
| `src-tauri/src/mcp.rs` | Servidor MCP: conexão, chave de acesso e protocolo |

Toda forma criada é uma malha de polígonos guardada no projeto, com o id `shape.N`, que funciona
como qualquer bloco. A interface e o agente usam as mesmas operações, em
`src/modeling/operations.ts`, e o Rust valida o resultado antes de aceitar.

Toda alteração é um comando aplicado em `document.rs`. A interface só desenha o estado que o
Rust publica, e o agente de IA usa esses mesmos comandos. Assim, o que ele faz aparece na hora e
pode ser desfeito. As ferramentas do agente rodam na interface, que já tem o catálogo, os
geradores e o viewport.

Para criar um bloco, adicione-o em `src/blocks/definitions/` e rode `pnpm catalog`. O primeiro
item de `sockets` é o ponto que o bloco usa para se encaixar nos outros. Partes sem `color` seguem
a cor escolhida pela pessoa, e partes com `color` mantêm a própria cor, como vidros e pneus. Com o
`tauri dev` aberto, reinicie depois de `pnpm catalog`, porque o Rust embute o catálogo ao compilar.

## Roteiro

1. **Montagem por blocos e geradores:** feitos
2. **Salvar e exportar:** feitos, com exportação GLB testada no Godot 4.7
3. **Agente de IA:** feito, com servidor MCP local e captura do viewport
4. **Modelagem livre:** feita, com faces, arestas, pontos, furos, chanfros e escultura, pela
   interface e pelo agente
5. **Animação:** esqueleto criado a partir dos encaixes e biblioteca de animações prontas
6. **Linha do tempo:** ajuste simples de poses e novas animações próprias do editor

## Adicionar modelos à biblioteca

Baixe os pacotes listados em [CREDITS.md](CREDITS.md), descompacte cada um em
`<pasta>/<pacote>/x/` e rode:

```powershell
node scripts/import-models.ts <pasta>
pnpm catalog
```

Só adicione modelos CC0. A lista de pacotes, a escala e a categoria ficam no início de
`scripts/import-models.ts`. Registre todo pacote novo em [CREDITS.md](CREDITS.md).

## Veículos feitos no Blender

Todos os veículos do editor (carros, SUVs, picapes, vans, caminhões, ônibus, carretas, motos e karts, com rodas, piloto, capacetes e aerofólios) são modelados por script no Blender 5.1. O mesmo desenho gera os quatro estilos: Arcade e Realista usam o modelo completo, Low poly usa uma versão com poucas faces planas e Blocos usa essa versão convertida em voxels. Seis karts, o piloto e cinco aerofólios vêm do jogo Codeplay in Kart. Para gerar tudo de novo:

```bash
blender -b --factory-startup --python tools/blender/build_vehicles.py -- --export
pnpm catalog
```

O primeiro comando grava `public/models/vehicles.bin` e `src/blocks/definitions/family/baked.generated.ts`. Para ver um modelo sem exportar, use `-- sedan --preview saida.png` no lugar de `-- --export`; acrescente `--lod lp` ou `--lod vx` para ver as versões Low poly e Blocos. Depois de `pnpm catalog`, reinicie o `tauri dev`, porque o núcleo em Rust embute o catálogo.

## Licenças

O código é distribuído sob a [licença MIT](LICENSE), e os recursos de terceiros estão em
[CREDITS.md](CREDITS.md).

A biblioteca de animações planejada vem do
[Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app), cujos modelos, rigs e animações
são CC0. Ela será creditada aqui quando entrar no projeto.
