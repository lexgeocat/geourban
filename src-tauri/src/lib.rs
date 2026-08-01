mod geo_bridge;
mod project_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project_store::project_save,
            project_store::project_load,
            project_store::project_list,
            project_store::project_delete,
            geo_bridge::geo_engine_version,
            geo_bridge::subdivide,
            geo_bridge::subdivide_manzano,
            geo_bridge::subdivide_manzano_batch,
            geo_bridge::compute_manzanos_cmd,
            geo_bridge::compute_manzanos_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
