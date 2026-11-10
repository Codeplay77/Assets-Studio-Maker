//! The project document and every operation that can change it.
//!
//! The UI and the MCP server both go through [`Editor::apply`], so anything an agent does
//! shows up live and can be undone like a user action. Error messages are in Portuguese
//! because they reach the person using the editor.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

pub type PartId = u64;
pub type GroupId = u64;

const FILE_FORMAT: &str = "assets-studio-maker";
const FILE_VERSION: u32 = 2;
const HISTORY_LIMIT: usize = 200;
const MIN_SCALE: f64 = 0.01;
const IDENTITY_ROTATION: [f64; 4] = [0.0, 0.0, 0.0, 1.0];
const UNIT_SCALE: [f64; 3] = [1.0, 1.0, 1.0];
const SHAPE_PREFIX: &str = "shape.";
/// How the parts of a generated model refer to the shapes created along with them.
const NEW_SHAPE_PREFIX: char = '@';
const MAX_SHAPES: usize = 512;
const MAX_SHAPE_VERTICES: usize = 20_000;
const MAX_SHAPE_FACES: usize = 20_000;
const MAX_PROJECT_VERTICES: usize = 200_000;
const MAX_FACE_SIDES: usize = 256;
const MAX_MATERIALS: usize = 256;
const MAX_SOCKETS: usize = 24;
const MAX_NAME_CHARS: usize = 80;
const MAX_COORDINATE: f64 = 100_000.0;
const MAX_SMOOTH_ANGLE: f64 = 180.0;
const DEFAULT_SMOOTH_ANGLE: f64 = 35.0;
const MAX_ANIMATIONS: usize = 256;
const MAX_CLIP_CHARS: usize = 80;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub id: PartId,
    pub block: String,
    pub position: [f64; 3],
    pub rotation: [f64; 4],
    pub scale: [f64; 3],
    pub color: String,
    /// Parts sharing a group are selected and moved together.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<GroupId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub parts: Vec<Part>,
    pub next_id: PartId,
    #[serde(default = "first_group")]
    pub next_group: GroupId,
    /// Shapes made in this project. History holds many copies of the project, so they are shared.
    #[serde(default)]
    pub shapes: Vec<Arc<CustomShape>>,
    #[serde(default = "first_group")]
    pub next_shape: u64,
    /// The animations each character carries into an export, as clip ids, under the id of the
    /// character's hips part.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub animations: BTreeMap<PartId, Vec<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Finish {
    Matte,
    Gloss,
    Metal,
    Glass,
    Glow,
}

/// A face without `color` follows the color of the part using the shape.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeMaterial {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shade: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish: Option<Finish>,
    /// Takes its colors from the shape's `vertex_colors`, so they blend across the faces.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub painted: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ShapeSocket {
    pub id: String,
    pub p: [f64; 3],
    pub n: [f64; 3],
}

fn default_smooth_angle() -> f64 {
    DEFAULT_SMOOTH_ANGLE
}

/// A polygon mesh that belongs to the project. Parts use it through the block id `shape.N`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomShape {
    /// Assigned by the editor when a shape is created.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub color: String,
    pub vertices: Vec<[f64; 3]>,
    pub faces: Vec<Vec<u32>>,
    /// One material index per face. Left empty, every face uses the first material.
    #[serde(default)]
    pub face_materials: Vec<u32>,
    #[serde(default)]
    pub materials: Vec<ShapeMaterial>,
    /// Edges sharper than this stay hard: 0 is fully faceted and 180 fully smooth.
    #[serde(default = "default_smooth_angle")]
    pub smooth_angle: f64,
    /// Attachment points. Left empty, the editor derives them from the shape's bounds.
    #[serde(default)]
    pub sockets: Vec<ShapeSocket>,
    /// One 0xRRGGBB color per vertex, for materials that are painted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vertex_colors: Vec<u32>,
    /// Made by a generator: it goes away together with the model that uses it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub generated: bool,
}

fn first_group() -> GroupId {
    1
}

impl Default for Project {
    fn default() -> Self {
        Self {
            name: "Sem título".to_string(),
            parts: Vec::new(),
            next_id: 1,
            next_group: first_group(),
            shapes: Vec::new(),
            next_shape: first_group(),
            animations: BTreeMap::new(),
        }
    }
}

fn default_rotation() -> [f64; 4] {
    IDENTITY_ROTATION
}

fn default_scale() -> [f64; 3] {
    UNIT_SCALE
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPart {
    pub block: String,
    pub position: [f64; 3],
    #[serde(default = "default_rotation")]
    pub rotation: [f64; 4],
    #[serde(default = "default_scale")]
    pub scale: [f64; 3],
    pub color: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartUpdate {
    pub id: PartId,
    pub position: Option<[f64; 3]>,
    pub rotation: Option<[f64; 4]>,
    pub scale: Option<[f64; 3]>,
    pub color: Option<String>,
}

/// Where to put a new part that uses a shape being created.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapePlacement {
    pub position: [f64; 3],
    #[serde(default = "default_rotation")]
    pub rotation: [f64; 4],
    #[serde(default = "default_scale")]
    pub scale: [f64; 3],
    pub color: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    AddPart(NewPart),
    /// Several parts as one undo step, optionally replacing everything in the scene.
    AddParts {
        parts: Vec<NewPart>,
        replace: bool,
        /// Puts the new parts in one group, so they move as a single model.
        #[serde(default)]
        group: bool,
        /// Parts that go away in the same undo step, for swapping one model for another.
        #[serde(default)]
        remove: Vec<PartId>,
        /// Shapes made for this model. A part uses one through the block id `@index`.
        #[serde(default)]
        shapes: Vec<CustomShape>,
    },
    UpdatePart {
        id: PartId,
        position: Option<[f64; 3]>,
        rotation: Option<[f64; 4]>,
        scale: Option<[f64; 3]>,
        color: Option<String>,
    },
    /// Changes several parts as one undo step.
    UpdateParts {
        updates: Vec<PartUpdate>,
    },
    SetGrouped {
        ids: Vec<PartId>,
        grouped: bool,
    },
    RemoveParts {
        ids: Vec<PartId>,
    },
    DuplicateParts {
        ids: Vec<PartId>,
        offset: [f64; 3],
    },
    /// Creates a shape and, in the same undo step, places it and removes the parts it replaces.
    /// Returns the shape's number followed by the new part ids.
    AddShape {
        shape: CustomShape,
        #[serde(default)]
        parts: Vec<ShapePlacement>,
        #[serde(default)]
        remove_parts: Vec<PartId>,
    },
    /// Replaces a shape's contents. Every part using it changes together.
    UpdateShape {
        shape: CustomShape,
    },
    /// Deletes a shape and the parts using it, and returns the ids of those parts.
    RemoveShape {
        id: String,
    },
    /// Chooses the animations a character carries into an export. `part` is its hips; an empty
    /// list takes them all away.
    SetAnimations {
        part: PartId,
        clips: Vec<String>,
    },
}

#[derive(Debug, Deserialize)]
struct CatalogFile {
    blocks: Vec<BlockDef>,
}

#[derive(Debug, Deserialize)]
struct BlockDef {
    id: String,
    color: String,
    sockets: Vec<SocketDef>,
}

#[derive(Debug, Deserialize)]
struct SocketDef {}

/// Block ids and their default colors, read from the catalog shared with the UI.
#[derive(Debug)]
pub struct Catalog {
    default_colors: HashMap<String, String>,
}

impl Catalog {
    pub fn embedded() -> Result<Self, String> {
        Self::parse(include_str!("../../src/blocks/blocks.json"))
    }

    fn parse(json: &str) -> Result<Self, String> {
        let file: CatalogFile = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let mut default_colors = HashMap::with_capacity(file.blocks.len());
        for block in file.blocks {
            if block.sockets.is_empty() {
                return Err(format!("o bloco \"{}\" não tem pontos de encaixe", block.id));
            }
            let color = normalize_color(&block.color)?;
            if default_colors.insert(block.id.clone(), color).is_some() {
                return Err(format!("o bloco \"{}\" está duplicado no catálogo", block.id));
            }
        }
        Ok(Self { default_colors })
    }

    fn default_color(&self, block: &str) -> Option<&str> {
        self.default_colors.get(block).map(String::as_str)
    }
}

fn check_finite(values: &[f64], label: &str) -> Result<(), String> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(format!("{label} contém um valor inválido"))
    }
}

fn check_position(position: [f64; 3]) -> Result<[f64; 3], String> {
    check_finite(&position, "a posição")?;
    Ok(position)
}

fn normalize_rotation(rotation: [f64; 4]) -> Result<[f64; 4], String> {
    check_finite(&rotation, "a rotação")?;
    let length = rotation.iter().map(|v| v * v).sum::<f64>().sqrt();
    if length < 1e-9 {
        return Err("a rotação não pode ser zero".to_string());
    }
    Ok(rotation.map(|v| v / length))
}

fn check_scale(scale: [f64; 3]) -> Result<[f64; 3], String> {
    check_finite(&scale, "a escala")?;
    if scale.iter().any(|v| *v < MIN_SCALE) {
        return Err(format!("a escala precisa ser pelo menos {MIN_SCALE}"));
    }
    Ok(scale)
}

fn normalize_color(color: &str) -> Result<String, String> {
    let is_hex = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if is_hex {
        Ok(color.to_ascii_lowercase())
    } else {
        Err(format!("cor inválida: \"{color}\" (use o formato #rrggbb)"))
    }
}

fn check_name(name: &str, label: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("{label} precisa ter de 1 a {MAX_NAME_CHARS} caracteres"));
    }
    Ok(name.to_string())
}

fn check_coordinates(point: &[f64; 3], label: &str) -> Result<(), String> {
    check_finite(point, label)?;
    if point.iter().any(|value| value.abs() > MAX_COORDINATE) {
        return Err(format!("{label} está longe demais da origem"));
    }
    Ok(())
}

fn check_material(material: &mut ShapeMaterial) -> Result<(), String> {
    if let Some(color) = &material.color {
        material.color = Some(normalize_color(color)?);
    }
    if let Some(shade) = material.shade {
        if !shade.is_finite() || !(0.0..=1.0).contains(&shade) {
            return Err("o tom de um material precisa estar entre 0 e 1".to_string());
        }
    }
    Ok(())
}

fn check_face(face: &[u32], vertices: usize) -> Result<(), String> {
    if face.len() < 3 || face.len() > MAX_FACE_SIDES {
        return Err(format!("cada face precisa ter de 3 a {MAX_FACE_SIDES} vértices"));
    }
    let mut used = HashSet::with_capacity(face.len());
    for &index in face {
        if index as usize >= vertices {
            return Err(format!("uma face usa o vértice {index}, que não existe"));
        }
        if !used.insert(index) {
            return Err(format!("uma face repete o vértice {index}"));
        }
    }
    Ok(())
}

fn check_sockets(sockets: &[ShapeSocket]) -> Result<(), String> {
    if sockets.len() > MAX_SOCKETS {
        return Err(format!("uma forma pode ter no máximo {MAX_SOCKETS} encaixes"));
    }
    let mut names = HashSet::with_capacity(sockets.len());
    for socket in sockets {
        check_name(&socket.id, "o nome do encaixe")?;
        if !names.insert(socket.id.as_str()) {
            return Err(format!("encaixe repetido: \"{}\"", socket.id));
        }
        check_coordinates(&socket.p, "a posição do encaixe")?;
        check_coordinates(&socket.n, "a direção do encaixe")?;
        if socket.n.iter().all(|value| *value == 0.0) {
            return Err("a direção de um encaixe não pode ser zero".to_string());
        }
    }
    Ok(())
}

/// Shapes come from agents and from files, so nothing in them is trusted.
fn normalize_shape(shape: &mut CustomShape) -> Result<(), String> {
    shape.name = check_name(&shape.name, "o nome da forma")?;
    shape.color = normalize_color(&shape.color)?;
    if shape.vertices.is_empty() || shape.vertices.len() > MAX_SHAPE_VERTICES {
        return Err(format!("uma forma precisa ter de 1 a {MAX_SHAPE_VERTICES} vértices"));
    }
    if shape.faces.is_empty() || shape.faces.len() > MAX_SHAPE_FACES {
        return Err(format!("uma forma precisa ter de 1 a {MAX_SHAPE_FACES} faces"));
    }
    for vertex in &shape.vertices {
        check_coordinates(vertex, "um vértice")?;
    }
    // Editing can add or remove vertices; the paint then no longer lines up with them.
    if shape.vertex_colors.len() != shape.vertices.len() {
        shape.vertex_colors.clear();
    }
    if shape.vertex_colors.iter().any(|color| *color > 0xFF_FFFF) {
        return Err("uma cor de vértice é inválida".to_string());
    }
    for face in &shape.faces {
        check_face(face, shape.vertices.len())?;
    }

    if shape.materials.is_empty() {
        shape.materials.push(ShapeMaterial::default());
    }
    if shape.materials.len() > MAX_MATERIALS {
        return Err(format!("uma forma pode ter no máximo {MAX_MATERIALS} materiais"));
    }
    for material in &mut shape.materials {
        check_material(material)?;
    }
    if shape.face_materials.is_empty() {
        shape.face_materials = vec![0; shape.faces.len()];
    }
    if shape.face_materials.len() != shape.faces.len() {
        return Err("é preciso um material para cada face".to_string());
    }
    if shape.face_materials.iter().any(|index| *index as usize >= shape.materials.len()) {
        return Err("uma face usa um material que não existe".to_string());
    }

    if !shape.smooth_angle.is_finite() || !(0.0..=MAX_SMOOTH_ANGLE).contains(&shape.smooth_angle) {
        return Err(format!("o ângulo de suavização precisa estar entre 0 e {MAX_SMOOTH_ANGLE}"));
    }
    check_sockets(&shape.sockets)
}

fn check_shape_totals(project: &Project) -> Result<(), String> {
    if project.shapes.len() > MAX_SHAPES {
        return Err(format!("um projeto pode ter no máximo {MAX_SHAPES} formas"));
    }
    let total: usize = project.shapes.iter().map(|shape| shape.vertices.len()).sum();
    if total > MAX_PROJECT_VERTICES {
        return Err(format!("as formas do projeto passam de {MAX_PROJECT_VERTICES} vértices"));
    }
    Ok(())
}

fn shape_number(id: &str) -> Option<u64> {
    id.strip_prefix(SHAPE_PREFIX)?.parse().ok()
}

/// The color a new part gets, or None when the block doesn't exist.
fn default_block_color(project: &Project, block: &str, catalog: &Catalog) -> Option<String> {
    if block.starts_with(SHAPE_PREFIX) {
        let shape = project.shapes.iter().find(|shape| shape.id == block)?;
        return Some(shape.color.clone());
    }
    catalog.default_color(block).map(str::to_string)
}

/// A shape made by a generator has no use without the parts of its model.
fn drop_unused_generated_shapes(project: &mut Project) {
    let used: HashSet<&str> = project.parts.iter().map(|part| part.block.as_str()).collect();
    project.shapes.retain(|shape| !shape.generated || used.contains(shape.id.as_str()));
}

fn take_group_id(project: &mut Project) -> GroupId {
    let group = project.next_group;
    project.next_group += 1;
    group
}

fn apply_update(project: &mut Project, update: PartUpdate) -> Result<PartId, String> {
    let PartUpdate {
        id,
        position,
        rotation,
        scale,
        color,
    } = update;
    let part = project
        .parts
        .iter_mut()
        .find(|part| part.id == id)
        .ok_or_else(|| format!("peça não encontrada: {id}"))?;
    if let Some(position) = position {
        part.position = check_position(position)?;
    }
    if let Some(rotation) = rotation {
        part.rotation = normalize_rotation(rotation)?;
    }
    if let Some(scale) = scale {
        part.scale = check_scale(scale)?;
    }
    if let Some(color) = color {
        part.color = normalize_color(&color)?;
    }
    Ok(id)
}

fn add_part(
    project: &mut Project,
    part: NewPart,
    group: Option<GroupId>,
    catalog: &Catalog,
) -> Result<PartId, String> {
    let default_color = default_block_color(project, &part.block, catalog)
        .ok_or_else(|| format!("bloco desconhecido: \"{}\"", part.block))?;
    let color = match part.color {
        Some(color) => normalize_color(&color)?,
        None => default_color,
    };
    let id = project.next_id;
    project.next_id += 1;
    project.parts.push(Part {
        id,
        block: part.block,
        position: check_position(part.position)?,
        rotation: normalize_rotation(part.rotation)?,
        scale: check_scale(part.scale)?,
        color,
        group,
    });
    Ok(id)
}

fn remove_existing_parts(project: &mut Project, ids: &[PartId]) -> Result<(), String> {
    let wanted: HashSet<PartId> = ids.iter().copied().collect();
    let existing: HashSet<PartId> = project.parts.iter().map(|part| part.id).collect();
    if let Some(missing) = wanted.iter().find(|id| !existing.contains(id)) {
        return Err(format!("peça não encontrada: {missing}"));
    }
    project.parts.retain(|part| !wanted.contains(&part.id));
    Ok(())
}

fn execute(
    project: &mut Project,
    command: Command,
    catalog: &Catalog,
) -> Result<Vec<PartId>, String> {
    match command {
        Command::AddPart(part) => Ok(vec![add_part(project, part, None, catalog)?]),
        Command::AddParts {
            parts,
            replace,
            group,
            remove,
            shapes,
        } => {
            if replace {
                project.parts.clear();
            }
            // A part that is already gone is fine: the goal is that it not be there.
            let remove: HashSet<PartId> = remove.into_iter().collect();
            project.parts.retain(|part| !remove.contains(&part.id));
            drop_unused_generated_shapes(project);

            let mut new_shapes = Vec::with_capacity(shapes.len());
            for mut shape in shapes {
                normalize_shape(&mut shape)?;
                shape.id = format!("{SHAPE_PREFIX}{}", project.next_shape);
                project.next_shape += 1;
                shape.generated = true;
                new_shapes.push(shape.id.clone());
                project.shapes.push(Arc::new(shape));
            }
            check_shape_totals(project)?;

            let group = (group && parts.len() > 1).then(|| take_group_id(project));
            parts
                .into_iter()
                .map(|mut part| {
                    if let Some(index) = part.block.strip_prefix(NEW_SHAPE_PREFIX) {
                        part.block = index
                            .parse::<usize>()
                            .ok()
                            .and_then(|index| new_shapes.get(index).cloned())
                            .ok_or_else(|| format!("forma nova inexistente: \"{}\"", part.block))?;
                    }
                    add_part(project, part, group, catalog)
                })
                .collect()
        }
        Command::UpdatePart {
            id,
            position,
            rotation,
            scale,
            color,
        } => {
            let update = PartUpdate {
                id,
                position,
                rotation,
                scale,
                color,
            };
            Ok(vec![apply_update(project, update)?])
        }
        Command::UpdateParts { updates } => updates
            .into_iter()
            .map(|update| apply_update(project, update))
            .collect(),
        Command::SetGrouped { ids, grouped } => {
            let wanted: HashSet<PartId> = ids.iter().copied().collect();
            let found = project
                .parts
                .iter()
                .filter(|part| wanted.contains(&part.id))
                .count();
            if found != wanted.len() {
                return Err("alguma das peças não existe mais".to_string());
            }
            if grouped && wanted.len() < 2 {
                return Err("selecione pelo menos duas peças para agrupar".to_string());
            }
            let group = grouped.then(|| take_group_id(project));
            for part in project.parts.iter_mut().filter(|part| wanted.contains(&part.id)) {
                part.group = group;
            }
            Ok(ids)
        }
        Command::RemoveParts { ids } => {
            remove_existing_parts(project, &ids)?;
            drop_unused_generated_shapes(project);
            Ok(ids)
        }
        Command::DuplicateParts { ids, offset } => {
            check_position(offset)?;
            let mut created = Vec::with_capacity(ids.len());
            // Copies of a group form a new group of their own.
            let mut new_groups: HashMap<GroupId, GroupId> = HashMap::new();
            for id in ids {
                let mut copy = project
                    .parts
                    .iter()
                    .find(|part| part.id == id)
                    .cloned()
                    .ok_or_else(|| format!("peça não encontrada: {id}"))?;
                copy.id = project.next_id;
                project.next_id += 1;
                if let Some(group) = copy.group {
                    let existing = new_groups.get(&group).copied();
                    let new_group = existing.unwrap_or_else(|| take_group_id(project));
                    new_groups.insert(group, new_group);
                    copy.group = Some(new_group);
                }
                for axis in 0..3 {
                    copy.position[axis] += offset[axis];
                }
                created.push(copy.id);
                project.parts.push(copy);
            }
            Ok(created)
        }
        Command::AddShape {
            mut shape,
            parts,
            remove_parts,
        } => {
            normalize_shape(&mut shape)?;
            let number = project.next_shape;
            project.next_shape += 1;
            shape.id = format!("{SHAPE_PREFIX}{number}");
            let block = shape.id.clone();
            project.shapes.push(Arc::new(shape));
            check_shape_totals(project)?;

            remove_existing_parts(project, &remove_parts)?;
            let mut created = vec![number];
            for placement in parts {
                let ShapePlacement {
                    position,
                    rotation,
                    scale,
                    color,
                } = placement;
                let part = NewPart {
                    block: block.clone(),
                    position,
                    rotation,
                    scale,
                    color,
                };
                created.push(add_part(project, part, None, catalog)?);
            }
            Ok(created)
        }
        Command::UpdateShape { mut shape } => {
            normalize_shape(&mut shape)?;
            let slot = project
                .shapes
                .iter_mut()
                .find(|existing| existing.id == shape.id)
                .ok_or_else(|| format!("forma não encontrada: {}", shape.id))?;
            *slot = Arc::new(shape);
            check_shape_totals(project)?;
            Ok(Vec::new())
        }
        Command::RemoveShape { id } => {
            let before = project.shapes.len();
            project.shapes.retain(|shape| shape.id != id);
            if project.shapes.len() == before {
                return Err(format!("forma não encontrada: {id}"));
            }
            let removed = project
                .parts
                .iter()
                .filter(|part| part.block == id)
                .map(|part| part.id)
                .collect();
            project.parts.retain(|part| part.block != id);
            Ok(removed)
        }
        Command::SetAnimations { part, clips } => {
            if !project.parts.iter().any(|existing| existing.id == part) {
                return Err(format!("peça não encontrada: {part}"));
            }
            let clips = check_clips(clips)?;
            if clips.is_empty() {
                project.animations.remove(&part);
            } else {
                project.animations.insert(part, clips);
            }
            Ok(vec![part])
        }
    }
}

/// Clip ids come from the editor's library, which the core does not know; it only keeps them sane.
fn check_clips(clips: Vec<String>) -> Result<Vec<String>, String> {
    if clips.len() > MAX_ANIMATIONS {
        return Err(format!("um personagem pode levar no máximo {MAX_ANIMATIONS} animações"));
    }
    let mut seen = HashSet::new();
    let mut kept = Vec::with_capacity(clips.len());
    for clip in clips {
        let clip = clip.trim().to_string();
        if clip.is_empty() || clip.chars().count() > MAX_CLIP_CHARS {
            return Err("nome de animação inválido".to_string());
        }
        if seen.insert(clip.clone()) {
            kept.push(clip);
        }
    }
    Ok(kept)
}

/// A character that is gone takes its animations with it.
fn drop_orphan_animations(project: &mut Project) {
    if project.animations.is_empty() {
        return;
    }
    let ids: HashSet<PartId> = project.parts.iter().map(|part| part.id).collect();
    project.animations.retain(|part, _| ids.contains(part));
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshot {
    pub project: Project,
    pub can_undo: bool,
    pub can_redo: bool,
    pub revision: u64,
    /// True when the scene differs from what was last saved.
    pub dirty: bool,
    pub path: Option<String>,
}

/// The JSON written to a project file.
pub fn project_to_json(project: &Project) -> Result<String, String> {
    serde_json::to_string_pretty(&serde_json::json!({
        "format": FILE_FORMAT,
        "version": FILE_VERSION,
        "project": project,
    }))
    .map_err(|error| error.to_string())
}

/// Reads a project file. Files can be edited by hand, so nothing in them is trusted.
pub fn project_from_json(json: &str, catalog: &Catalog) -> Result<Project, String> {
    #[derive(Deserialize)]
    struct ProjectFile {
        format: String,
        version: u32,
        project: Project,
    }

    let file: ProjectFile = serde_json::from_str(json)
        .map_err(|_| "este arquivo não é um projeto válido".to_string())?;
    if file.format != FILE_FORMAT {
        return Err("este arquivo não é um projeto do Assets Studio Maker".to_string());
    }
    if file.version > FILE_VERSION {
        return Err("este projeto foi salvo por uma versão mais nova do editor".to_string());
    }

    let mut project = file.project;
    check_shape_totals(&project)?;
    let mut shape_ids = HashSet::new();
    let mut highest_shape = 0;
    for shape in &mut project.shapes {
        let number = shape_number(&shape.id)
            .ok_or_else(|| format!("o projeto tem uma forma inválida: \"{}\"", shape.id))?;
        if !shape_ids.insert(shape.id.clone()) {
            return Err(format!("o projeto tem formas repetidas: {}", shape.id));
        }
        highest_shape = highest_shape.max(number);
        normalize_shape(Arc::make_mut(shape))?;
    }
    project.next_shape = project.next_shape.max(highest_shape + 1);

    let mut seen = HashSet::new();
    for part in &mut project.parts {
        if !seen.insert(part.id) {
            return Err(format!("o projeto tem peças repetidas: {}", part.id));
        }
        let known = if part.block.starts_with(SHAPE_PREFIX) {
            shape_ids.contains(&part.block)
        } else {
            catalog.default_color(&part.block).is_some()
        };
        if !known {
            return Err(format!("o projeto usa um bloco desconhecido: \"{}\"", part.block));
        }
        part.position = check_position(part.position)?;
        part.rotation = normalize_rotation(part.rotation)?;
        part.scale = check_scale(part.scale)?;
        part.color = normalize_color(&part.color)?;
    }
    // Ids must stay ahead of everything in the file, even if it was edited by hand.
    let highest = project.parts.iter().map(|part| part.id).max().unwrap_or(0);
    project.next_id = project.next_id.max(highest + 1);
    let highest_group = project.parts.iter().filter_map(|part| part.group).max().unwrap_or(0);
    project.next_group = project.next_group.max(highest_group + 1);
    for clips in project.animations.values_mut() {
        *clips = check_clips(std::mem::take(clips))?;
    }
    project.animations.retain(|_, clips| !clips.is_empty());
    drop_orphan_animations(&mut project);
    Ok(project)
}

#[derive(Debug, Default)]
pub struct Editor {
    project: Project,
    undo_stack: Vec<Project>,
    redo_stack: Vec<Project>,
    revision: u64,
    saved: Project,
    path: Option<String>,
}

impl Editor {
    pub fn snapshot(&self) -> EditorSnapshot {
        EditorSnapshot {
            project: self.project.clone(),
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            revision: self.revision,
            dirty: self.project != self.saved,
            path: self.path.clone(),
        }
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn path(&self) -> Option<&str> {
        self.path.as_deref()
    }

    /// Starts over with another document: a new file, or one just opened.
    pub fn replace_document(&mut self, project: Project, path: Option<String>) {
        self.saved = project.clone();
        self.project = project;
        self.path = path;
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.revision += 1;
    }

    pub fn mark_saved(&mut self, path: String, name: String) {
        // History gets the name too, or undoing back to the saved state would look unsaved.
        for project in self.undo_stack.iter_mut().chain(self.redo_stack.iter_mut()) {
            project.name = name.clone();
        }
        self.project.name = name;
        self.saved = self.project.clone();
        self.path = Some(path);
        self.revision += 1;
    }

    /// Runs on a copy, so a command that fails halfway leaves the project untouched.
    pub fn apply(&mut self, command: Command, catalog: &Catalog) -> Result<Vec<PartId>, String> {
        let mut next = self.project.clone();
        let affected = execute(&mut next, command, catalog)?;
        drop_orphan_animations(&mut next);
        if next != self.project {
            self.undo_stack
                .push(std::mem::replace(&mut self.project, next));
            if self.undo_stack.len() > HISTORY_LIMIT {
                self.undo_stack.remove(0);
            }
            self.redo_stack.clear();
            self.revision += 1;
        }
        Ok(affected)
    }

    pub fn undo(&mut self) -> bool {
        let Some(previous) = self.undo_stack.pop() else {
            return false;
        };
        self.redo_stack
            .push(std::mem::replace(&mut self.project, previous));
        self.revision += 1;
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo_stack.pop() else {
            return false;
        };
        self.undo_stack
            .push(std::mem::replace(&mut self.project, next));
        self.revision += 1;
        true
    }
}

#[cfg(test)]
#[path = "tests/document.rs"]
mod tests;
