use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerDto {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub z_index: i64,
    pub color: String,
    pub fill_color: String,
    pub visible: bool,
    pub locked: bool,
    pub opacity: f64,
    pub show_label: bool,
    pub show_cota: bool,
    pub color_mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureDto {
    pub id: String,
    pub layer_id: Option<String>,
    pub kind: String,
    pub geometry_wkb_b64: String,
    pub properties_json: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreetDto {
    pub id: String,
    pub name: String,
    pub start_x: f64,
    pub start_y: f64,
    pub end_x: f64,
    pub end_y: f64,
    pub width_m: f64,
    pub side_width_m: f64,
    pub waypoints_json: Option<String>,
    pub layer_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundaboutDto {
    pub id: String,
    pub name: String,
    pub center_x: f64,
    pub center_y: f64,
    pub radius_m: f64,
    pub sides: i64,
    pub rotation: f64,
    pub road_width_m: f64,
    pub sidewalk_width_m: f64,
    pub layer_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPayload {
    pub layers: Vec<LayerDto>,
    pub features: Vec<FeatureDto>,
    pub streets: Vec<StreetDto>,
    pub roundabouts: Vec<RoundaboutDto>,
    pub meta_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub name: String,
    pub modified_at_ms: i64,
    pub size_bytes: i64,
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver el directorio de datos de la app: {e}"))?;
    let dir = base.join("projects");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear el directorio de proyectos: {e}"))?;
    Ok(dir)
}

fn project_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\', '\0']) {
        return Err("Nombre de proyecto inválido.".into());
    }
    Ok(projects_dir(app)?.join(format!("{name}.guproj")))
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS layers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  z_index INTEGER NOT NULL,
  color TEXT NOT NULL,
  fill_color TEXT NOT NULL,
  visible INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  opacity REAL NOT NULL,
  show_label INTEGER NOT NULL,
  show_cota INTEGER NOT NULL,
  color_mode TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  layer_id TEXT,
  kind TEXT NOT NULL,
  geometry BLOB NOT NULL,
  properties TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_features_layer ON features(layer_id);
CREATE TABLE IF NOT EXISTS streets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_x REAL NOT NULL,
  start_y REAL NOT NULL,
  end_x REAL NOT NULL,
  end_y REAL NOT NULL,
  width_m REAL NOT NULL,
  side_width_m REAL NOT NULL,
  waypoints_json TEXT,
  layer_id TEXT
);
CREATE TABLE IF NOT EXISTS roundabouts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  center_x REAL NOT NULL,
  center_y REAL NOT NULL,
  radius_m REAL NOT NULL,
  sides INTEGER NOT NULL,
  rotation REAL NOT NULL,
  road_width_m REAL NOT NULL,
  sidewalk_width_m REAL NOT NULL,
  layer_id TEXT
);
CREATE TABLE IF NOT EXISTS project_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
";

fn open_fresh(path: &PathBuf) -> Result<Connection, String> {
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("No se pudo limpiar el archivo previo: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn open_existing(path: &PathBuf) -> Result<Connection, String> {
    if !path.exists() {
        return Err("El proyecto no existe.".into());
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.encode(bytes)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.decode(s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_save(app: AppHandle, name: String, payload: ProjectPayload) -> Result<(), String> {
    let path = project_path(&app, &name)?;
    let mut conn = open_fresh(&path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO layers (id, name, kind, z_index, color, fill_color, visible, locked, opacity, show_label, show_cota, color_mode)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .map_err(|e| e.to_string())?;
        for l in &payload.layers {
            stmt.execute(params![
                l.id,
                l.name,
                l.kind,
                l.z_index,
                l.color,
                l.fill_color,
                l.visible,
                l.locked,
                l.opacity,
                l.show_label,
                l.show_cota,
                l.color_mode,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    {
        let mut stmt = tx
            .prepare_cached("INSERT INTO features (id, layer_id, kind, geometry, properties) VALUES (?1, ?2, ?3, ?4, ?5)")
            .map_err(|e| e.to_string())?;
        for f in &payload.features {
            let geom = base64_decode(&f.geometry_wkb_b64)?;
            stmt.execute(params![f.id, f.layer_id, f.kind, geom, f.properties_json])
                .map_err(|e| e.to_string())?;
        }
    }

    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO streets (id, name, start_x, start_y, end_x, end_y, width_m, side_width_m, waypoints_json, layer_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(|e| e.to_string())?;
        for s in &payload.streets {
            stmt.execute(params![
                s.id,
                s.name,
                s.start_x,
                s.start_y,
                s.end_x,
                s.end_y,
                s.width_m,
                s.side_width_m,
                s.waypoints_json,
                s.layer_id,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO roundabouts (id, name, center_x, center_y, radius_m, sides, rotation, road_width_m, sidewalk_width_m, layer_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(|e| e.to_string())?;
        for r in &payload.roundabouts {
            stmt.execute(params![
                r.id,
                r.name,
                r.center_x,
                r.center_y,
                r.radius_m,
                r.sides,
                r.rotation,
                r.road_width_m,
                r.sidewalk_width_m,
                r.layer_id,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    tx.execute(
        "INSERT INTO project_meta (key, value) VALUES ('meta', ?1)",
        params![payload.meta_json],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn project_load(app: AppHandle, name: String) -> Result<ProjectPayload, String> {
    let path = project_path(&app, &name)?;
    let conn = open_existing(&path)?;

    let mut layers = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name, kind, z_index, color, fill_color, visible, locked, opacity, show_label, show_cota, color_mode FROM layers ORDER BY z_index")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LayerDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    z_index: row.get(3)?,
                    color: row.get(4)?,
                    fill_color: row.get(5)?,
                    visible: row.get(6)?,
                    locked: row.get(7)?,
                    opacity: row.get(8)?,
                    show_label: row.get(9)?,
                    show_cota: row.get(10)?,
                    color_mode: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            layers.push(r.map_err(|e| e.to_string())?);
        }
    }

    let mut features = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, layer_id, kind, geometry, properties FROM features")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let geom: Vec<u8> = row.get(3)?;
                Ok(FeatureDto {
                    id: row.get(0)?,
                    layer_id: row.get(1)?,
                    kind: row.get(2)?,
                    geometry_wkb_b64: base64_encode(&geom),
                    properties_json: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            features.push(r.map_err(|e| e.to_string())?);
        }
    }

    let mut streets = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name, start_x, start_y, end_x, end_y, width_m, side_width_m, waypoints_json, layer_id FROM streets")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(StreetDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    start_x: row.get(2)?,
                    start_y: row.get(3)?,
                    end_x: row.get(4)?,
                    end_y: row.get(5)?,
                    width_m: row.get(6)?,
                    side_width_m: row.get(7)?,
                    waypoints_json: row.get(8)?,
                    layer_id: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            streets.push(r.map_err(|e| e.to_string())?);
        }
    }

    let mut roundabouts = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, name, center_x, center_y, radius_m, sides, rotation, road_width_m, sidewalk_width_m, layer_id FROM roundabouts")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(RoundaboutDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    center_x: row.get(2)?,
                    center_y: row.get(3)?,
                    radius_m: row.get(4)?,
                    sides: row.get(5)?,
                    rotation: row.get(6)?,
                    road_width_m: row.get(7)?,
                    sidewalk_width_m: row.get(8)?,
                    layer_id: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            roundabouts.push(r.map_err(|e| e.to_string())?);
        }
    }

    let meta_json: String = conn
        .query_row(
            "SELECT value FROM project_meta WHERE key = 'meta'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "{}".to_string());

    Ok(ProjectPayload {
        layers,
        features,
        streets,
        roundabouts,
        meta_json,
    })
}

#[tauri::command]
pub fn project_list(app: AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let dir = projects_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("guproj") {
            continue;
        }
        let name = match path.file_stem().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified_at_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(ProjectSummary {
            name,
            modified_at_ms,
            size_bytes: metadata.len() as i64,
        });
    }
    out.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    Ok(out)
}

#[tauri::command]
pub fn project_delete(app: AppHandle, name: String) -> Result<(), String> {
    let path = project_path(&app, &name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
