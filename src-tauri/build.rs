fn main() {
    #[cfg(target_os = "windows")]
    {
        use std::env;
        use std::fs;
        use std::path::PathBuf;

        if let (Ok(manifest_dir), Ok(out_dir)) = (env::var("CARGO_MANIFEST_DIR"), env::var("OUT_DIR")) {
            let vendor_dir = PathBuf::from(manifest_dir).join("vendor").join("geos");
            let mut target_dir = PathBuf::from(out_dir);
            // OUT_DIR is target/<profile>/build/<pkg>/out -> go up 3 levels to target/<profile>
            if target_dir.pop() && target_dir.pop() && target_dir.pop() {
                for dll in ["geos.dll", "geos_c.dll"] {
                    let src = vendor_dir.join(dll);
                    if src.exists() {
                        let _ = fs::copy(&src, target_dir.join(dll));
                    }
                }
            }
        }
    }

    tauri_build::build()
}
