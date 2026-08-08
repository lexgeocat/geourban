mod geo_bridge;
mod project_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(geo_bridge::SpatialIndexState(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
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
            geo_bridge::subdivide,
            geo_bridge::subdivide_manzano,
            geo_bridge::subdivide_manzano_batch,
            geo_bridge::compute_manzanos_cmd,
            geo_bridge::compute_road_network_net_cmd,
            geo_bridge::match_fragments_batch,
            geo_bridge::spatial_index_load,
            geo_bridge::spatial_index_upsert_batch,
            geo_bridge::spatial_index_remove_batch,
            geo_bridge::spatial_index_clear,
            geo_bridge::spatial_index_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
