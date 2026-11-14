// The textured materials of the Realista style: photographs of real surfaces, all from Poly Haven
// (CC0). scripts/download-realistic.ts fetches them and scripts/import-realistic.ts copies them to
// public/textures/<id>/ as color, normal and arm (occlusion, roughness, metalness) images.
import { peopleSurfaces } from "./definitions/people.generated.ts";
import { modelSurfaces } from "./definitions/realistic.generated.ts";

export type SurfaceGroup = "wall" | "roof" | "street" | "ground" | "floor" | "wood" | "fabric" | "metal" | "nature" | "model";

export interface SurfaceDef {
  id: string;
  name: string;
  group: SurfaceGroup;
  /**
   * Meters one copy of the texture covers, across and up. The editor projects tiling textures on
   * every face by itself; models that bring their own texture layout leave this out.
   */
  size?: [number, number];
  /** The color image is a PNG whose transparent pixels cut the surface away (leaves, fringes). */
  cutout?: boolean;
  /**
   * Drawn from both sides: thin sheets such as leaves, cloth and paper have no back of their own.
   * Cut-out surfaces are, unless this is false (tree impostors bring a face for each side).
   */
  double?: boolean;
  /**
   * A gray copy of the photo that keeps only its detail, for ground painted vertex by vertex: the
   * paint gives the color and the texture the grain. Its color image is a PNG.
   */
  detail?: boolean;
  /** The asset it comes from on Poly Haven. */
  source: string;
  /** The texture's average color, for styles that draw the same piece without textures. */
  tone?: string;
}

export const SURFACE_GROUPS: { id: SurfaceGroup; name: string }[] = [
  { id: "wall", name: "Paredes" },
  { id: "roof", name: "Telhados" },
  { id: "street", name: "Ruas e calçadas" },
  { id: "ground", name: "Terreno" },
  { id: "floor", name: "Pisos" },
  { id: "wood", name: "Madeira" },
  { id: "fabric", name: "Tecidos" },
  { id: "metal", name: "Metal" },
  { id: "nature", name: "Natureza" },
];

const tile = (id: string, name: string, group: SurfaceGroup, meters: number | [number, number], source: string, tone: string): SurfaceDef => ({
  id,
  name,
  group,
  size: typeof meters === "number" ? [meters, meters] : meters,
  source,
  tone,
});

/**
 * Light, plain textures (plaster, paint, cotton) are meant to take the part's color; the others
 * keep their own and are placed with a white fixed color.
 */
export const TILING_SURFACES: SurfaceDef[] = [
  tile("plaster", "Reboco pintado", "wall", 2, "white_stucco", "#d7d3d0"),
  // Gray, so a room's walls come out in exactly the paint chosen for them.
  { ...tile("plaster_smooth", "Parede lisa", "wall", 2, "painted_plaster_wall", "#aba3a0"), detail: true },
  tile("brick_red", "Tijolo vermelho", "wall", 1.4, "red_brick", "#8e6750"),
  tile("brick_old", "Tijolo antigo", "wall", 2, "brick_wall_02", "#a28e76"),
  tile("concrete", "Concreto", "wall", 2.71, "concrete_wall_008", "#8d8670"),
  tile("stone_wall", "Pedra", "wall", 2, "stone_wall", "#a2927a"),
  tile("planks", "Tábuas", "wall", 1, "brown_planks_05", "#9a9488"),
  tile("corrugated", "Chapa ondulada", "wall", 1.12, "corrugated_iron", "#aab3ae"),
  tile("roof_clay", "Telha de barro", "roof", 4, "clay_roof_tiles", "#59331c"),
  tile("roof_grey", "Telha cinza", "roof", 3, "grey_roof_tiles", "#615c4b"),
  tile("roof_slate", "Ardósia", "roof", 3, "roof_slates_02", "#908675"),
  tile("roof_flat", "Manta asfáltica", "roof", 20, "bitumen", "#3b3634"),
  tile("asphalt", "Asfalto", "street", 3, "asphalt_02", "#5a5a55"),
  tile("sidewalk", "Calçada de concreto", "street", 1.8, "concrete_pavement", "#7f7466"),
  tile("sidewalk_brick", "Calçada de tijolo", "street", 2, "brick_pavement", "#4f3b32"),
  tile("cobblestone", "Paralelepípedo", "street", 1, "cobblestone_floor_01", "#8f826e"),
  tile("grass", "Grama", "ground", 2, "leafy_grass", "#978359"),
  tile("forest_ground", "Chão de floresta", "ground", 2, "forrest_ground_01", "#91875d"),
  tile("dirt", "Terra", "ground", 2, "dirt", "#63523e"),
  tile("sand", "Areia", "ground", 2.14, "sand_02", "#615648"),
  tile("rock", "Rocha", "ground", 2.38, "rock_face", "#614631"),
  tile("snow", "Neve", "ground", 2, "snow_02", "#a5a5a7"),
  tile("gravel", "Cascalho", "ground", 3, "gravel_ground_01", "#928368"),
  { ...tile("ground_detail", "Solo para pintar", "ground", 2, "forrest_ground_01", "#d1d1d1"), detail: true },
  tile("laminate", "Piso laminado", "floor", 1.7, "laminate_floor_02", "#9b8063"),
  tile("parquet", "Taco", "floor", 3.4, "herringbone_parquet", "#93704d"),
  tile("floor_tiles", "Porcelanato", "floor", 1.5, "floor_tiles_08", "#887564"),
  tile("marble", "Mármore", "floor", 1.5, "marble_01", "#b19d7a"),
  tile("wall_tiles", "Azulejo", "floor", 1.27, "long_white_tiles", "#cdc6b6"),
  tile("wood_oak", "Carvalho", "wood", 1.83, "oak_veneer_01", "#a17e57"),
  tile("wood_dark", "Madeira escura", "wood", 2, "dark_wood", "#5d2b18"),
  // Gray, so a duvet or a curtain comes out in exactly the color it is given.
  { ...tile("cotton", "Tecido de algodão", "fabric", 0.264, "cotton_jersey", "#c2ab9d"), detail: true },
  tile("velvet", "Veludo", "fabric", [0.284, 0.273], "velour_velvet", "#ae2d47"),
  tile("leather", "Couro", "fabric", 0.4, "brown_leather", "#512d10"),
  tile("denim", "Jeans", "fabric", 0.1, "denim_fabric", "#4e718e"),
  tile("metal_plate", "Chapa xadrez", "metal", 0.5, "metal_plate", "#3d321c"),
  tile("rust", "Metal enferrujado", "metal", 1.5, "rusty_metal", "#a2622e"),
  tile("bark", "Casca de árvore", "nature", 1, "bark_brown_02", "#5f5640"),
  tile("bark_pine", "Casca de pinheiro", "nature", 2, "pine_bark", "#675340"),
];

/** Every surface the editor knows, in a fixed order: a surface's place in it is its slot. */
export const SURFACES: SurfaceDef[] = [...TILING_SURFACES, ...modelSurfaces, ...peopleSurfaces];

const indexById = new Map(SURFACES.map((surface, index) => [surface.id, index]));

export function hasSurface(id: string): boolean {
  return indexById.has(id);
}

export function surfaceIndex(id: string): number {
  const index = indexById.get(id);
  if (index === undefined) throw new Error(`Textura desconhecida: ${id}`);
  return index;
}

export function getSurface(id: string): SurfaceDef {
  return SURFACES[surfaceIndex(id)];
}

/** Where the images of a surface are served from. */
export function surfaceFolder(surface: SurfaceDef): string {
  return `/textures/${surface.id}`;
}
