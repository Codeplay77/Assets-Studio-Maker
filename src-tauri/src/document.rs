//! The project document and every operation that can change it.
//!
//! The UI and the MCP server both go through [`Editor::apply`], so anything an agent does
//! shows up live and can be undone like a user action. Error messages are in Portuguese
//! because they reach the person using the editor.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

pub type PartId = u64;

const HISTORY_LIMIT: usize = 200;
const MIN_SCALE: f64 = 0.01;
const IDENTITY_ROTATION: [f64; 4] = [0.0, 0.0, 0.0, 1.0];
const UNIT_SCALE: [f64; 3] = [1.0, 1.0, 1.0];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub id: PartId,
    pub block: String,
    pub position: [f64; 3],
    pub rotation: [f64; 4],
    pub scale: [f64; 3],
    pub color: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub parts: Vec<Part>,
    pub next_id: PartId,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            name: "Sem título".to_string(),
            parts: Vec::new(),
            next_id: 1,
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
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    AddPart(NewPart),
    /// Several parts as one undo step, optionally replacing everything in the scene.
    AddParts {
        parts: Vec<NewPart>,
        replace: bool,
    },
    UpdatePart {
        id: PartId,
        position: Option<[f64; 3]>,
        rotation: Option<[f64; 4]>,
        scale: Option<[f64; 3]>,
        color: Option<String>,
    },
    RemoveParts {
        ids: Vec<PartId>,
    },
    DuplicateParts {
        ids: Vec<PartId>,
        offset: [f64; 3],
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

fn add_part(project: &mut Project, part: NewPart, catalog: &Catalog) -> Result<PartId, String> {
    let default_color = catalog
        .default_color(&part.block)
        .ok_or_else(|| format!("bloco desconhecido: \"{}\"", part.block))?;
    let color = match part.color {
        Some(color) => normalize_color(&color)?,
        None => default_color.to_string(),
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
    });
    Ok(id)
}

fn execute(
    project: &mut Project,
    command: Command,
    catalog: &Catalog,
) -> Result<Vec<PartId>, String> {
    match command {
        Command::AddPart(part) => Ok(vec![add_part(project, part, catalog)?]),
        Command::AddParts { parts, replace } => {
            if replace {
                project.parts.clear();
            }
            parts
                .into_iter()
                .map(|part| add_part(project, part, catalog))
                .collect()
        }
        Command::UpdatePart {
            id,
            position,
            rotation,
            scale,
            color,
        } => {
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
            Ok(vec![id])
        }
        Command::RemoveParts { ids } => {
            let wanted: HashSet<PartId> = ids.iter().copied().collect();
            let existing: HashSet<PartId> = project.parts.iter().map(|part| part.id).collect();
            if let Some(missing) = wanted.iter().find(|id| !existing.contains(id)) {
                return Err(format!("peça não encontrada: {missing}"));
            }
            project.parts.retain(|part| !wanted.contains(&part.id));
            Ok(ids)
        }
        Command::DuplicateParts { ids, offset } => {
            check_position(offset)?;
            let mut created = Vec::with_capacity(ids.len());
            for id in ids {
                let mut copy = project
                    .parts
                    .iter()
                    .find(|part| part.id == id)
                    .cloned()
                    .ok_or_else(|| format!("peça não encontrada: {id}"))?;
                copy.id = project.next_id;
                project.next_id += 1;
                for axis in 0..3 {
                    copy.position[axis] += offset[axis];
                }
                created.push(copy.id);
                project.parts.push(copy);
            }
            Ok(created)
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshot {
    pub project: Project,
    pub can_undo: bool,
    pub can_redo: bool,
    pub revision: u64,
}

#[derive(Debug, Default)]
pub struct Editor {
    project: Project,
    undo_stack: Vec<Project>,
    redo_stack: Vec<Project>,
    revision: u64,
}

impl Editor {
    pub fn snapshot(&self) -> EditorSnapshot {
        EditorSnapshot {
            project: self.project.clone(),
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            revision: self.revision,
        }
    }

    /// Runs on a copy, so a command that fails halfway leaves the project untouched.
    pub fn apply(&mut self, command: Command, catalog: &Catalog) -> Result<Vec<PartId>, String> {
        let mut next = self.project.clone();
        let affected = execute(&mut next, command, catalog)?;
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
mod tests {
    use super::*;

    fn catalog() -> Catalog {
        Catalog::embedded().expect("catalog parses")
    }

    fn new_part(block: &str) -> NewPart {
        NewPart {
            block: block.to_string(),
            position: [0.0, 0.25, 0.0],
            rotation: IDENTITY_ROTATION,
            scale: UNIT_SCALE,
            color: None,
        }
    }

    fn add(block: &str) -> Command {
        Command::AddPart(new_part(block))
    }

    fn update_position(id: PartId, position: [f64; 3]) -> Command {
        Command::UpdatePart {
            id,
            position: Some(position),
            rotation: None,
            scale: None,
            color: None,
        }
    }

    #[test]
    fn adding_uses_the_catalog_color_and_sequential_ids() {
        let catalog = catalog();
        let mut editor = Editor::default();
        assert_eq!(editor.apply(add("basic.cube"), &catalog).unwrap(), vec![1]);
        assert_eq!(editor.apply(add("nature.rock"), &catalog).unwrap(), vec![2]);
        let parts = editor.snapshot().project.parts;
        assert_eq!(parts[0].color, "#8a9bb0");
        assert_eq!(parts[1].color, "#7d8590");
    }

    #[test]
    fn unknown_block_is_rejected_and_leaves_no_history() {
        let catalog = catalog();
        let mut editor = Editor::default();
        assert!(editor.apply(add("nope"), &catalog).is_err());
        let snapshot = editor.snapshot();
        assert!(snapshot.project.parts.is_empty());
        assert!(!snapshot.can_undo);
        assert_eq!(snapshot.revision, 0);
    }

    #[test]
    fn undo_and_redo_restore_each_state() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        editor
            .apply(update_position(1, [1.0, 2.0, 3.0]), &catalog)
            .unwrap();

        assert!(editor.undo());
        assert_eq!(editor.snapshot().project.parts[0].position, [0.0, 0.25, 0.0]);
        assert!(editor.redo());
        assert_eq!(editor.snapshot().project.parts[0].position, [1.0, 2.0, 3.0]);
        assert!(!editor.redo());
    }

    #[test]
    fn a_new_command_clears_redo() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        editor.undo();
        editor.apply(add("basic.plate"), &catalog).unwrap();
        assert!(!editor.snapshot().can_redo);
    }

    #[test]
    fn updating_to_the_same_value_adds_no_history() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        let revision = editor.snapshot().revision;
        editor
            .apply(update_position(1, [0.0, 0.25, 0.0]), &catalog)
            .unwrap();
        assert_eq!(editor.snapshot().revision, revision);
    }

    #[test]
    fn invalid_values_are_rejected() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        let rejected = [
            update_position(1, [f64::NAN, 0.0, 0.0]),
            Command::UpdatePart {
                id: 1,
                position: None,
                rotation: Some([0.0; 4]),
                scale: None,
                color: None,
            },
            Command::UpdatePart {
                id: 1,
                position: None,
                rotation: None,
                scale: Some([0.0, 1.0, 1.0]),
                color: None,
            },
            Command::UpdatePart {
                id: 1,
                position: None,
                rotation: None,
                scale: None,
                color: Some("vermelho".to_string()),
            },
            update_position(99, [0.0; 3]),
        ];
        for command in rejected {
            assert!(editor.apply(command, &catalog).is_err());
        }
    }

    #[test]
    fn rotation_is_normalized() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        editor
            .apply(
                Command::UpdatePart {
                    id: 1,
                    position: None,
                    rotation: Some([0.0, 0.0, 0.0, 2.0]),
                    scale: None,
                    color: None,
                },
                &catalog,
            )
            .unwrap();
        assert_eq!(editor.snapshot().project.parts[0].rotation, IDENTITY_ROTATION);
    }

    #[test]
    fn duplicating_is_all_or_nothing() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        let failed = editor.apply(
            Command::DuplicateParts {
                ids: vec![1, 99],
                offset: [1.0, 0.0, 0.0],
            },
            &catalog,
        );
        assert!(failed.is_err());
        assert_eq!(editor.snapshot().project.parts.len(), 1);

        let created = editor
            .apply(
                Command::DuplicateParts {
                    ids: vec![1],
                    offset: [1.0, 0.0, 0.0],
                },
                &catalog,
            )
            .unwrap();
        assert_eq!(created, vec![2]);
        assert_eq!(editor.snapshot().project.parts[1].position, [1.0, 0.25, 0.0]);
    }

    #[test]
    fn removing_a_missing_part_changes_nothing() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        let result = editor.apply(Command::RemoveParts { ids: vec![1, 99] }, &catalog);
        assert!(result.is_err());
        assert_eq!(editor.snapshot().project.parts.len(), 1);
    }

    #[test]
    fn history_is_bounded() {
        let catalog = catalog();
        let mut editor = Editor::default();
        for _ in 0..(HISTORY_LIMIT + 10) {
            editor.apply(add("basic.cube"), &catalog).unwrap();
        }
        let mut steps = 0;
        while editor.undo() {
            steps += 1;
        }
        assert_eq!(steps, HISTORY_LIMIT);
    }

    #[test]
    fn duplicate_block_ids_are_rejected() {
        let json = r##"{"blocks":[
            {"id":"a","color":"#000000","sockets":[{}]},
            {"id":"a","color":"#000000","sockets":[{}]}
        ]}"##;
        assert!(Catalog::parse(json).is_err());
    }

    #[test]
    fn commands_deserialize_from_the_ui_format() {
        let json = r##"{"type":"updatePart","id":3,"position":[1,2,3]}"##;
        let command: Command = serde_json::from_str(json).unwrap();
        assert!(matches!(command, Command::UpdatePart { id: 3, .. }));

        let json = r##"{"type":"addPart","block":"basic.cube","position":[0,0,0]}"##;
        let command: Command = serde_json::from_str(json).unwrap();
        assert!(matches!(command, Command::AddPart(part) if part.rotation == IDENTITY_ROTATION));

        let json = r##"{"type":"addParts","replace":true,"parts":[{"block":"basic.cube","position":[0,0,0]}]}"##;
        let command: Command = serde_json::from_str(json).unwrap();
        assert!(matches!(command, Command::AddParts { replace: true, .. }));
    }

    #[test]
    fn a_batch_is_one_undo_step() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        let created = editor
            .apply(
                Command::AddParts {
                    parts: vec![new_part("basic.plate"), new_part("nature.rock")],
                    replace: true,
                },
                &catalog,
            )
            .unwrap();
        assert_eq!(created, vec![2, 3]);
        assert_eq!(editor.snapshot().project.parts.len(), 2);

        assert!(editor.undo());
        let parts = editor.snapshot().project.parts;
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].block, "basic.cube");
    }

    #[test]
    fn a_batch_with_a_bad_part_changes_nothing() {
        let catalog = catalog();
        let mut editor = Editor::default();
        editor.apply(add("basic.cube"), &catalog).unwrap();
        let result = editor.apply(
            Command::AddParts {
                parts: vec![new_part("basic.plate"), new_part("nope")],
                replace: true,
            },
            &catalog,
        );
        assert!(result.is_err());
        assert_eq!(editor.snapshot().project.parts.len(), 1);
    }
}
