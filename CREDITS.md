# Créditos

O código do Assets Studio Maker é distribuído sob a [licença MIT](LICENSE). Estes são os
recursos de terceiros incluídos no aplicativo, com os detalhes de cada conversão. O resumo, com
todos os autores, está na seção [Créditos e agradecimentos](README.md#créditos-e-agradecimentos)
do README.

## Modelos 3D (CC0 1.0)

Criados por [Kenney](https://kenney.nl). O domínio público não exige atribuição, mas o crédito é
merecido. Os arquivos em `public/models/pack.bin` foram convertidos pelo
`scripts/import-models.ts`: as texturas viraram cores por vértice e as escalas foram ajustadas.

| Pacote | Versão | Origem |
| --- | --- | --- |
| Car Kit | 3.1 | [OpenGameArt](https://opengameart.org/content/car-kit) |
| City Kit (Commercial) | 2.1 | [OpenGameArt](https://opengameart.org/content/city-kit-commercial) |
| City Kit (Suburban) | 2.0 | [OpenGameArt](https://opengameart.org/content/city-kit-suburban) |
| City Kit (Roads) | 2.2 | [OpenGameArt](https://opengameart.org/content/city-kit-roads) |
| Racing Kit | 1.2 | [OpenGameArt](https://opengameart.org/content/racing-kit) |
| Nature Kit | 2.1 | [OpenGameArt](https://opengameart.org/content/nature-kit) |
| Blocky Characters | 2.0 | [OpenGameArt](https://opengameart.org/content/blocky-characters) |

Cada pacote traz um `License.txt` com "License: (Creative Commons Zero, CC0)".

## Móveis e interiores (CC0 1.0)

Os móveis de Low poly e Blocos ficam em `public/models/interior.bin`, gerado pelo
`scripts/import-interior.ts`: as texturas viraram cores por vértice, as escalas foram levadas a
medidas reais e a frente de cada peça ficou virada para +Z.

| Pacote | Autor | Origem | Estilo no editor |
| --- | --- | --- | --- |
| Furniture Kit 1.0 (120 modelos) | [Kenney](https://kenney.nl) | [OpenGameArt](https://opengameart.org/content/furniture-kit) | Low poly e, convertido em cubos, Blocos |

O Furniture Kit traz o mesmo `License.txt` dos outros pacotes da Kenney.

## Realista: modelos, texturas e céu (CC0 1.0)

Tudo o que o estilo Realista traz de fora vem do [Poly Haven](https://polyhaven.com), cujo acervo
inteiro é CC0, e é baixado pelo `scripts/download-realistic.ts`.

- **145 modelos** (móveis, plantas, árvores, pedras e objetos de rua) ficam em
  `public/models/realista.bin`, com as texturas originais em `public/textures/ph.*`. O
  `tools/blender/prepare_polyhaven.py` reduz cada um a um tamanho de jogo sem perder as texturas,
  separa as versões que vêm lado a lado num arquivo e faz uma cópia leve das plantas e pedras, e o
  `scripts/import-realistic.ts` gera o pacote. As texturas foram regravadas no formato do glTF
  (cor, relevo e um mapa com oclusão, rugosidade e metal).
- **39 texturas** que se repetem (paredes, telhados, ruas, terreno, pisos, madeira, tecido,
  metal e casca de árvore) ficam em `public/textures/`, como o Poly Haven as publica em 1k. A
  de solo para pintar é uma cópia em cinza da textura de chão de floresta.
- **O céu** que ilumina as cenas Realistas fica em `public/environments/sky.hdr`. Kloofendal 48d Partly Cloudy (Pure Sky), de Greg Zaal, Jarod Guest ([kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)).

Modelos:

| Modelo | Autor | Página |
| --- | --- | --- |
| Alarm Clock 01 | Yann Kervran, James Ray Cock | [alarm_clock_01](https://polyhaven.com/a/alarm_clock_01) |
| Anthurium Botany 01 | Rob Tuytel, Rico Cilliers | [anthurium_botany_01](https://polyhaven.com/a/anthurium_botany_01) |
| Arm Chair 01 | Kirill Sannikov | [ArmChair_01](https://polyhaven.com/a/ArmChair_01) |
| Bar Chair Round 01 | Dairon Sanchez | [bar_chair_round_01](https://polyhaven.com/a/bar_chair_round_01) |
| Boombox | Thomas Paul Mouilleron | [boombox](https://polyhaven.com/a/boombox) |
| Calathea Orbifolia 01 | Rob Tuytel, Rico Cilliers | [calathea_orbifolia_01](https://polyhaven.com/a/calathea_orbifolia_01) |
| Cardboard Box 01 | Rahul Chaudhary | [cardboard_box_01](https://polyhaven.com/a/cardboard_box_01) |
| Cash Register 01 | Joe Seabuhr | [CashRegister_01](https://polyhaven.com/a/CashRegister_01) |
| Ceiling Fan | Ulan Cabanilla | [ceiling_fan](https://polyhaven.com/a/ceiling_fan) |
| Ceramic Vase 01 | James Ray Cock | [ceramic_vase_01](https://polyhaven.com/a/ceramic_vase_01) |
| Ceramic Vase 02 | James Ray Cock | [ceramic_vase_02](https://polyhaven.com/a/ceramic_vase_02) |
| Ceramic Vase 03 | James Ray Cock | [ceramic_vase_03](https://polyhaven.com/a/ceramic_vase_03) |
| Chandelier 01 | Kirill Sannikov | [Chandelier_01](https://polyhaven.com/a/Chandelier_01) |
| Chinese Screen Panels | Kirill Sannikov | [chinese_screen_panels](https://polyhaven.com/a/chinese_screen_panels) |
| Classic Laptop | Arrangemonk | [classic_laptop](https://polyhaven.com/a/classic_laptop) |
| Classic Console 01 | Kirill Sannikov | [ClassicConsole_01](https://polyhaven.com/a/ClassicConsole_01) |
| Classic Nightstand 01 | Kirill Sannikov | [ClassicNightstand_01](https://polyhaven.com/a/ClassicNightstand_01) |
| Coffee Table Round 01 | Ulan Cabanilla | [coffee_table_round_01](https://polyhaven.com/a/coffee_table_round_01) |
| Coffee Table 01 | Fernando Quinn | [CoffeeTable_01](https://polyhaven.com/a/CoffeeTable_01) |
| Desk Lamp Arm 01 | Yann Kervran, Kuutti Siitonen | [desk_lamp_arm_01](https://polyhaven.com/a/desk_lamp_arm_01) |
| Dining Chair 02 | James Ray Cock | [dining_chair_02](https://polyhaven.com/a/dining_chair_02) |
| Dining Table | Aron Łyczek | [dining_table](https://polyhaven.com/a/dining_table) |
| Drawer Cabinet | Ulan Cabanilla | [drawer_cabinet](https://polyhaven.com/a/drawer_cabinet) |
| Electric Stove | Kuutti Siitonen | [electric_stove](https://polyhaven.com/a/electric_stove) |
| Fancy Picture Frame 01 | Rob Tuytel, Rico Cilliers | [fancy_picture_frame_01](https://polyhaven.com/a/fancy_picture_frame_01) |
| Fire Alarm | Slinc | [fire_alarm](https://polyhaven.com/a/fire_alarm) |
| Folding Wooden Stool | Ulan Cabanilla | [folding_wooden_stool](https://polyhaven.com/a/folding_wooden_stool) |
| Gaming Console | Sean Buckley | [gaming_console](https://polyhaven.com/a/gaming_console) |
| Gothic Bed 01 | Kirill Sannikov | [GothicBed_01](https://polyhaven.com/a/GothicBed_01) |
| Gothic Cabinet 01 | Kirill Sannikov | [GothicCabinet_01](https://polyhaven.com/a/GothicCabinet_01) |
| Gothic Commode 01 | Kirill Sannikov | [GothicCommode_01](https://polyhaven.com/a/GothicCommode_01) |
| Green Chair 01 | Kirill Sannikov | [GreenChair_01](https://polyhaven.com/a/GreenChair_01) |
| Hanging Industrial Lamp | Kuutti Siitonen | [hanging_industrial_lamp](https://polyhaven.com/a/hanging_industrial_lamp) |
| Hanging Picture Frame 01 | James Ray Cock | [hanging_picture_frame_01](https://polyhaven.com/a/hanging_picture_frame_01) |
| Industrial Coffee Table | Ulan Cabanilla | [industrial_coffee_table](https://polyhaven.com/a/industrial_coffee_table) |
| Industrial Wall Lamp | Kuutti Siitonen | [industrial_wall_lamp](https://polyhaven.com/a/industrial_wall_lamp) |
| Mantel Clock 01 | Yann Kervran, Rico Cilliers | [mantel_clock_01](https://polyhaven.com/a/mantel_clock_01) |
| Metal Office Desk | Ulan Cabanilla | [metal_office_desk](https://polyhaven.com/a/metal_office_desk) |
| Metal Stool 01 | Ulan Cabanilla | [metal_stool_01](https://polyhaven.com/a/metal_stool_01) |
| Metal Trash Can | GurJas Studios | [metal_trash_can](https://polyhaven.com/a/metal_trash_can) |
| Mid Century Lounge Chair | Kuutti Siitonen | [mid_century_lounge_chair](https://polyhaven.com/a/mid_century_lounge_chair) |
| Modern Arm Chair 01 | Vibrant Nordic | [modern_arm_chair_01](https://polyhaven.com/a/modern_arm_chair_01) |
| Modern Ceiling Lamp 01 | James Ray Cock | [modern_ceiling_lamp_01](https://polyhaven.com/a/modern_ceiling_lamp_01) |
| Modern Coffee Table 01 | Amin | [modern_coffee_table_01](https://polyhaven.com/a/modern_coffee_table_01) |
| Modern Coffee Table 02 | Amin | [modern_coffee_table_02](https://polyhaven.com/a/modern_coffee_table_02) |
| Modern Wooden Cabinet | Patrik Pangerl | [modern_wooden_cabinet](https://polyhaven.com/a/modern_wooden_cabinet) |
| Old Bed Frame | Luca B | [old_bed_frame](https://polyhaven.com/a/old_bed_frame) |
| Ornate Mirror 01 | James Ray Cock | [ornate_mirror_01](https://polyhaven.com/a/ornate_mirror_01) |
| Ottoman 01 | Caspian Fortune | [Ottoman_01](https://polyhaven.com/a/Ottoman_01) |
| Pachira Aquatica 01 | Rob Tuytel, Rico Cilliers | [pachira_aquatica_01](https://polyhaven.com/a/pachira_aquatica_01) |
| Painted Wooden Cabinet | Kirill Sannikov | [painted_wooden_cabinet](https://polyhaven.com/a/painted_wooden_cabinet) |
| Painted Wooden Cabinet 02 | Kirill Sannikov | [painted_wooden_cabinet_02](https://polyhaven.com/a/painted_wooden_cabinet_02) |
| Painted Wooden Chair 02 | Kirill Sannikov | [painted_wooden_chair_02](https://polyhaven.com/a/painted_wooden_chair_02) |
| Painted Wooden Nightstand | Kirill Sannikov | [painted_wooden_nightstand](https://polyhaven.com/a/painted_wooden_nightstand) |
| Painted Wooden Shelves | Kirill Sannikov | [painted_wooden_shelves](https://polyhaven.com/a/painted_wooden_shelves) |
| Painted Wooden Sofa | Kirill Sannikov | [painted_wooden_sofa](https://polyhaven.com/a/painted_wooden_sofa) |
| Painted Wooden Table | Kirill Sannikov | [painted_wooden_table](https://polyhaven.com/a/painted_wooden_table) |
| Planter Pot Clay | Amal Kumar | [planter_pot_clay](https://polyhaven.com/a/planter_pot_clay) |
| Plastic Crate 01 | PierreB3D | [plastic_crate_01](https://polyhaven.com/a/plastic_crate_01) |
| Plastic Monobloc Chair 01 | Kuutti Siitonen | [plastic_monobloc_chair_01](https://polyhaven.com/a/plastic_monobloc_chair_01) |
| Potted Plant 01 | Rico Cilliers | [potted_plant_01](https://polyhaven.com/a/potted_plant_01) |
| Potted Plant 02 | Rico Cilliers | [potted_plant_02](https://polyhaven.com/a/potted_plant_02) |
| Potted Plant 04 | James Ray Cock | [potted_plant_04](https://polyhaven.com/a/potted_plant_04) |
| Projector Screen | PeterM | [projector_screen](https://polyhaven.com/a/projector_screen) |
| Rockingchair 01 | Jorge Camacho | [Rockingchair_01](https://polyhaven.com/a/Rockingchair_01) |
| Round Wooden Table 01 | Ulan Cabanilla | [round_wooden_table_01](https://polyhaven.com/a/round_wooden_table_01) |
| Round Wooden Table 02 | Ulan Cabanilla | [round_wooden_table_02](https://polyhaven.com/a/round_wooden_table_02) |
| Rubber Duck Toy | Plat251 | [rubber_duck_toy](https://polyhaven.com/a/rubber_duck_toy) |
| School Chair 01 | Ethan Place | [SchoolChair_01](https://polyhaven.com/a/SchoolChair_01) |
| School Desk 01 | Ethan Place | [SchoolDesk_01](https://polyhaven.com/a/SchoolDesk_01) |
| Shelf 01 | Gabriel Radić | [Shelf_01](https://polyhaven.com/a/Shelf_01) |
| Side Table 01 | James Ray Cock | [side_table_01](https://polyhaven.com/a/side_table_01) |
| Side Table Tall 01 | James Ray Cock | [side_table_tall_01](https://polyhaven.com/a/side_table_tall_01) |
| Small Wooden Table 01 | Ulan Cabanilla | [small_wooden_table_01](https://polyhaven.com/a/small_wooden_table_01) |
| Sofa 01 | Kirill Sannikov | [Sofa_01](https://polyhaven.com/a/Sofa_01) |
| Sofa 02 | Kirill Sannikov | [sofa_02](https://polyhaven.com/a/sofa_02) |
| Sofa 03 | Fran Calvente | [sofa_03](https://polyhaven.com/a/sofa_03) |
| Standing Chalkboard 01 | ParzivalCG | [standing_chalkboard_01](https://polyhaven.com/a/standing_chalkboard_01) |
| Standing Picture Frame 01 | James Ray Cock | [standing_picture_frame_01](https://polyhaven.com/a/standing_picture_frame_01) |
| Steel Frame Shelves 01 | James Ray Cock | [steel_frame_shelves_01](https://polyhaven.com/a/steel_frame_shelves_01) |
| Television 01 | Gabriel Radić | [Television_01](https://polyhaven.com/a/Television_01) |
| Television 02 | Benny Weimer | [television_02](https://polyhaven.com/a/television_02) |
| Throw Pillows 01 | Serhii Khromov | [throw_pillows_01](https://polyhaven.com/a/throw_pillows_01) |
| Vintage Cabinet 01 | Rico Cilliers | [vintage_cabinet_01](https://polyhaven.com/a/vintage_cabinet_01) |
| Vintage Day Bed | Aron Łyczek | [vintage_day_bed](https://polyhaven.com/a/vintage_day_bed) |
| Vintage Electric Kettle | SV Garip | [vintage_electric_kettle](https://polyhaven.com/a/vintage_electric_kettle) |
| Vintage Grandfather Clock 01 | Yann Kervran, James Ray Cock | [vintage_grandfather_clock_01](https://polyhaven.com/a/vintage_grandfather_clock_01) |
| Vintage Microwave | Adam Nekola | [vintage_microwave](https://polyhaven.com/a/vintage_microwave) |
| Vintage Suitcase | Maximilian Schuster | [vintage_suitcase](https://polyhaven.com/a/vintage_suitcase) |
| Vintage Wooden Drawer 01 | James Ray Cock | [vintage_wooden_drawer_01](https://polyhaven.com/a/vintage_wooden_drawer_01) |
| Wall Clock | PierreB3D | [wall_clock](https://polyhaven.com/a/wall_clock) |
| Wet Floor Sign 01 | Fran Calvente | [WetFloorSign_01](https://polyhaven.com/a/WetFloorSign_01) |
| Wicker Basket 02 | Kuutti Siitonen | [wicker_basket_02](https://polyhaven.com/a/wicker_basket_02) |
| Wooden Bookshelf Worn | Ulan Cabanilla | [wooden_bookshelf_worn](https://polyhaven.com/a/wooden_bookshelf_worn) |
| Wooden Crate 01 | James Ray Cock | [wooden_crate_01](https://polyhaven.com/a/wooden_crate_01) |
| Wooden Display Shelves 01 | James Ray Cock | [wooden_display_shelves_01](https://polyhaven.com/a/wooden_display_shelves_01) |
| Wooden Stool 01 | Kuutti Siitonen | [wooden_stool_01](https://polyhaven.com/a/wooden_stool_01) |
| Wooden Stool 02 | Kuutti Siitonen | [wooden_stool_02](https://polyhaven.com/a/wooden_stool_02) |
| Wooden Chair 01 | Jake Mobley | [WoodenChair_01](https://polyhaven.com/a/WoodenChair_01) |
| Wooden Table 01 | Ethan Place | [WoodenTable_01](https://polyhaven.com/a/WoodenTable_01) |
| Wooden Table 02 | Fran Calvente | [WoodenTable_02](https://polyhaven.com/a/WoodenTable_02) |
| Boulder 01 | Rico Cilliers | [boulder_01](https://polyhaven.com/a/boulder_01) |
| Celandine 01 | Rob Tuytel, Rico Cilliers | [celandine_01](https://polyhaven.com/a/celandine_01) |
| Dandelion 01 | Rob Tuytel, Rico Cilliers | [dandelion_01](https://polyhaven.com/a/dandelion_01) |
| Dead Tree Trunk 02 | Jenelle van Heerden, Rico Cilliers | [dead_tree_trunk_02](https://polyhaven.com/a/dead_tree_trunk_02) |
| Fern 02 | Rob Tuytel, Rico Cilliers | [fern_02](https://polyhaven.com/a/fern_02) |
| Fir Sapling | Rob Tuytel, Rico Cilliers | [fir_sapling](https://polyhaven.com/a/fir_sapling) |
| Fir Tree 01 | Rob Tuytel, Rico Cilliers | [fir_tree_01](https://polyhaven.com/a/fir_tree_01) |
| Flower Gazania | James Ray Cock, Jenelle van Heerden | [flower_gazania](https://polyhaven.com/a/flower_gazania) |
| Grass Bermuda 01 | Rico Cilliers | [grass_bermuda_01](https://polyhaven.com/a/grass_bermuda_01) |
| Grass Medium 01 | Rob Tuytel, Rico Cilliers | [grass_medium_01](https://polyhaven.com/a/grass_medium_01) |
| Grass Medium 02 | Rico Cilliers | [grass_medium_02](https://polyhaven.com/a/grass_medium_02) |
| Island Tree 01 | Rob Tuytel, Rico Cilliers | [island_tree_01](https://polyhaven.com/a/island_tree_01) |
| Island Tree 02 | Rob Tuytel, Rico Cilliers | [island_tree_02](https://polyhaven.com/a/island_tree_02) |
| Island Tree 03 | Rob Tuytel, Rico Cilliers | [island_tree_03](https://polyhaven.com/a/island_tree_03) |
| Jacaranda Tree | Rob Tuytel, Rico Cilliers | [jacaranda_tree](https://polyhaven.com/a/jacaranda_tree) |
| Namaqualand Boulder 02 | Greg Zaal, Rico Cilliers | [namaqualand_boulder_02](https://polyhaven.com/a/namaqualand_boulder_02) |
| Nettle Plant | Rob Tuytel, Rico Cilliers | [nettle_plant](https://polyhaven.com/a/nettle_plant) |
| Periwinkle Plant | Amal Kumar | [periwinkle_plant](https://polyhaven.com/a/periwinkle_plant) |
| Pine Sapling Medium | Rob Tuytel, Rico Cilliers | [pine_sapling_medium](https://polyhaven.com/a/pine_sapling_medium) |
| Quiver Tree 01 | James Ray Cock, Dario Barresi, Rico Cilliers | [quiver_tree_01](https://polyhaven.com/a/quiver_tree_01) |
| Rock 07 | Jenelle van Heerden | [rock_07](https://polyhaven.com/a/rock_07) |
| Rock 09 | Jenelle van Heerden | [rock_09](https://polyhaven.com/a/rock_09) |
| Rock Moss Set 01 | Kless Gyzen | [rock_moss_set_01](https://polyhaven.com/a/rock_moss_set_01) |
| Shrub 01 | Rico Cilliers | [shrub_01](https://polyhaven.com/a/shrub_01) |
| Shrub 02 | Rico Cilliers | [shrub_02](https://polyhaven.com/a/shrub_02) |
| Shrub 03 | Rico Cilliers | [shrub_03](https://polyhaven.com/a/shrub_03) |
| Shrub 04 | Rico Cilliers | [shrub_04](https://polyhaven.com/a/shrub_04) |
| Stone 01 | Dario Barresi, Rico Cilliers | [stone_01](https://polyhaven.com/a/stone_01) |
| Tree Small 02 | Rico Cilliers | [tree_small_02](https://polyhaven.com/a/tree_small_02) |
| Tree Stump 01 | Rob Tuytel | [tree_stump_01](https://polyhaven.com/a/tree_stump_01) |
| Wild Rooibos Bush | James Ray Cock, Jenelle van Heerden | [wild_rooibos_bush](https://polyhaven.com/a/wild_rooibos_bush) |
| Concrete Road Barrier | Amal Kumar | [concrete_road_barrier](https://polyhaven.com/a/concrete_road_barrier) |
| Exterior Aircon Unit | Monsta3D | [exterior_aircon_unit](https://polyhaven.com/a/exterior_aircon_unit) |
| Fire Hydrant | Gonçalo Felício | [fire_hydrant](https://polyhaven.com/a/fire_hydrant) |
| Outdoor Table Chair Set 01 | James Ray Cock | [outdoor_table_chair_set_01](https://polyhaven.com/a/outdoor_table_chair_set_01) |
| Painted Wooden Bench | Kirill Sannikov | [painted_wooden_bench](https://polyhaven.com/a/painted_wooden_bench) |
| Planter Box 01 | James Ray Cock | [planter_box_01](https://polyhaven.com/a/planter_box_01) |
| Security Camera 01 | Alexander Otterbeck, Yann Kervran | [security_camera_01](https://polyhaven.com/a/security_camera_01) |
| Street Lamp 01 | Josh Dean | [street_lamp_01](https://polyhaven.com/a/street_lamp_01) |
| Street Lamp 02 | Josh Dean | [street_lamp_02](https://polyhaven.com/a/street_lamp_02) |
| Trashbag | Benny Weimer | [trashbag](https://polyhaven.com/a/trashbag) |
| Utility Box 01 | James Ray Cock | [utility_box_01](https://polyhaven.com/a/utility_box_01) |
| Water Manhole Cover | Raunox | [water_manhole_cover](https://polyhaven.com/a/water_manhole_cover) |
| Wooden Picnic Table | Ulan Cabanilla | [wooden_picnic_table](https://polyhaven.com/a/wooden_picnic_table) |

Texturas:

| Textura no editor | Nome no Poly Haven | Autor | Página |
| --- | --- | --- | --- |
| Reboco pintado | White Stucco | Amal Kumar | [white_stucco](https://polyhaven.com/a/white_stucco) |
| Parede lisa | Painted Plaster Wall | Amal Kumar | [painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall) |
| Tijolo vermelho | Red Brick | Rob Tuytel | [red_brick](https://polyhaven.com/a/red_brick) |
| Tijolo antigo | Brick Wall 02 | Dimitrios Savva | [brick_wall_02](https://polyhaven.com/a/brick_wall_02) |
| Concreto | Concrete Wall 008 | Dario Barresi, Charlotte Baglioni | [concrete_wall_008](https://polyhaven.com/a/concrete_wall_008) |
| Pedra | Stone Wall | Dario Barresi, Charlotte Baglioni | [stone_wall](https://polyhaven.com/a/stone_wall) |
| Tábuas | Brown Planks 05 | Rob Tuytel | [brown_planks_05](https://polyhaven.com/a/brown_planks_05) |
| Chapa ondulada | Corrugated Iron | Jenelle van Heerden, Dimitrios Savva | [corrugated_iron](https://polyhaven.com/a/corrugated_iron) |
| Telha de barro | Clay Roof Tiles | Amal Kumar | [clay_roof_tiles](https://polyhaven.com/a/clay_roof_tiles) |
| Telha cinza | Grey Roof Tiles | Rob Tuytel | [grey_roof_tiles](https://polyhaven.com/a/grey_roof_tiles) |
| Ardósia | Roof Slates 02 | Rob Tuytel | [roof_slates_02](https://polyhaven.com/a/roof_slates_02) |
| Manta asfáltica | Bitumen | Rob Tuytel | [bitumen](https://polyhaven.com/a/bitumen) |
| Asfalto | Asphalt 02 | Rob Tuytel | [asphalt_02](https://polyhaven.com/a/asphalt_02) |
| Calçada de concreto | Concrete Pavement | Charlotte Baglioni | [concrete_pavement](https://polyhaven.com/a/concrete_pavement) |
| Calçada de tijolo | Brick Pavement | Charlotte Baglioni | [brick_pavement](https://polyhaven.com/a/brick_pavement) |
| Paralelepípedo | Cobblestone Floor 01 | Rob Tuytel | [cobblestone_floor_01](https://polyhaven.com/a/cobblestone_floor_01) |
| Grama | Leafy Grass | Charlotte Baglioni | [leafy_grass](https://polyhaven.com/a/leafy_grass) |
| Chão de floresta | Forest Ground 01 | Rob Tuytel | [forrest_ground_01](https://polyhaven.com/a/forrest_ground_01) |
| Terra | Dirt | Charlotte Baglioni | [dirt](https://polyhaven.com/a/dirt) |
| Areia | Sand 02 | Charlotte Baglioni | [sand_02](https://polyhaven.com/a/sand_02) |
| Rocha | Rock Face | Greg Zaal, Dario Barresi | [rock_face](https://polyhaven.com/a/rock_face) |
| Neve | Snow 02 | Rob Tuytel | [snow_02](https://polyhaven.com/a/snow_02) |
| Cascalho | Gravel Ground 01 | Rob Tuytel | [gravel_ground_01](https://polyhaven.com/a/gravel_ground_01) |
| Solo para pintar | Forest Ground 01 | Rob Tuytel | [forrest_ground_01](https://polyhaven.com/a/forrest_ground_01) |
| Piso laminado | Laminate Floor 02 | Dario Barresi, Charlotte Baglioni | [laminate_floor_02](https://polyhaven.com/a/laminate_floor_02) |
| Taco | Herringbone Parquet | Jenelle van Heerden, Sergej Majboroda | [herringbone_parquet](https://polyhaven.com/a/herringbone_parquet) |
| Porcelanato | Floor Tiles 08 | Rob Tuytel | [floor_tiles_08](https://polyhaven.com/a/floor_tiles_08) |
| Mármore | Marble 01 | Rob Tuytel | [marble_01](https://polyhaven.com/a/marble_01) |
| Azulejo | Long White Tiles | Jenelle van Heerden, Sergej Majboroda | [long_white_tiles](https://polyhaven.com/a/long_white_tiles) |
| Carvalho | Oak Veneer 01 | Jenelle van Heerden | [oak_veneer_01](https://polyhaven.com/a/oak_veneer_01) |
| Madeira escura | Dark Wood | Dario Barresi, Dimitrios Savva, Rico Cilliers | [dark_wood](https://polyhaven.com/a/dark_wood) |
| Tecido de algodão | Cotton Jersey | colormass, Rico Cilliers | [cotton_jersey](https://polyhaven.com/a/cotton_jersey) |
| Veludo | Velour Velvet | colormass, Rico Cilliers | [velour_velvet](https://polyhaven.com/a/velour_velvet) |
| Couro | Brown Leather | Rob Tuytel | [brown_leather](https://polyhaven.com/a/brown_leather) |
| Jeans | Denim Fabric | Rob Tuytel | [denim_fabric](https://polyhaven.com/a/denim_fabric) |
| Chapa xadrez | Metal Plate | Rob Tuytel | [metal_plate](https://polyhaven.com/a/metal_plate) |
| Metal enferrujado | Rusty Metal | Rob Tuytel | [rusty_metal](https://polyhaven.com/a/rusty_metal) |
| Casca de árvore | Bark Brown 02 | Rob Tuytel | [bark_brown_02](https://polyhaven.com/a/bark_brown_02) |
| Casca de pinheiro | Pine Bark | Dimitrios Savva | [pine_bark](https://polyhaven.com/a/pine_bark) |

## Pessoas do Realista (CC0 1.0)

As pessoas do estilo Realista são do [MakeHuman](http://www.makehumancommunity.org) e ficam em
`public/models/pessoas.bin`, com as texturas em `public/textures/mh.*`. Tudo o que entra no editor
é CC0 1.0: o corpo base, as formas de corpo, o esqueleto "game engine" com seus pesos (que vêm com o
MPFB) e o pacote [makehuman system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html)
(peles, olhos, sobrancelhas, cílios, cabelos, roupas, sapatos e chapéu).

O `tools/blender/make_people.py` monta os corpos no Blender com o
[MPFB](https://extensions.blender.org/add-ons/mpfb/), o MakeHuman para Blender. O código do MPFB é
GPL 3.0 e não faz parte do editor: ele só é usado para gerar os modelos. O script veste cada corpo,
reduz as roupas a um tamanho de jogo, passa os pesos para os 52 ossos das animações do Mesh2Motion
(o corpo e três em cada dedo) e grava cada pessoa com os braços abaixados. As texturas foram
reduzidas, as das roupas e dos cabelos que mudam de cor ficaram em tons de cinza, a pele ficou com
tom neutro para receber a cor escolhida, e o logotipo do MakeHuman foi apagado das camisetas. O
`scripts/import-people.ts` gera o pacote.

## Animações (CC0 1.0)

As 162 animações humanas vêm do [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app), cujo
README declara que "the art assets (3d models, rigs, animations) are all licensed under CC0". O
`scripts/import-animations.ts` converteu `human-base-animations.glb` e
`human-addon-animations.glb` para `public/animations/human.bin`: cada clipe foi amostrado a 30
quadros por segundo e guarda só as rotações dos ossos usados pelos personagens do editor: os do
corpo e os dos dedos, que as pessoas do Realista usam para fechar e abrir as mãos.

Os clipes de terceiros que o Mesh2Motion traz em `static/animations/CarnegieMellonAnimations/` não
entram no editor.

As 12 danças da categoria Dança que começam com "Dança:" (samba no pé, forró, axé, frevo, passinho,
disco, balanço do hip hop, robô, twist, salsa, passo de lado com palmas e rock na guitarra) foram
feitas para o editor pelo `tools/blender/make_dances.py`, sobre o esqueleto do
`human-base-animations.glb` do Mesh2Motion, e fazem parte do projeto.

Os 27 golpes da categoria Luta que começam com "Combate:" e "Capoeira:" (guarda, jab, direto,
gancho, uppercut, sequências, soco no corpo, cotovelada, joelhada, chutes frontal, lateral, circular
e baixo, esquivas, bloqueio, empurrão, agarrar, golpe de martelo, golpes recebidos, atordoado,
provocação, comemoração, ginga e meia-lua de frente) foram feitos para o editor pelo
`tools/blender/make_combat.py`, sobre o mesmo esqueleto, e também fazem parte do projeto.

## Bibliotecas incluídas no aplicativo

| Biblioteca | Licença |
| --- | --- |
| [Inter](https://rsms.me/inter/) (fonte) | SIL Open Font License 1.1 |
| [Lucide](https://lucide.dev) (ícones) | ISC |
| [three.js](https://threejs.org) | MIT |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | MIT |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT |
| [React](https://react.dev) | MIT |
| [Zustand](https://zustand.docs.pmnd.rs) | MIT |
| [Tauri](https://tauri.app) e [tauri-plugin-dialog](https://github.com/tauri-apps/plugins-workspace) | MIT ou Apache 2.0 |
| [serde](https://serde.rs) e [serde_json](https://github.com/serde-rs/json) | MIT ou Apache 2.0 |
| [tiny_http](https://github.com/tiny-http/tiny-http) | MIT ou Apache 2.0 |
| [getrandom](https://github.com/rust-random/getrandom) | MIT ou Apache 2.0 |
| [percent-encoding](https://github.com/servo/rust-url) | MIT ou Apache 2.0 |
