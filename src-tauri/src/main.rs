#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("papers");
            app.manage(Arc::new(nanran::AppState::new(root)?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            nanran::commands::library_list,
            nanran::commands::library_get,
            nanran::commands::library_remove,
            nanran::commands::open_arxiv,
            nanran::commands::open_pdf,
            nanran::commands::arxiv_search,
            nanran::commands::ai_recommend,
            nanran::commands::open_arxiv_page,
            nanran::commands::translation_start,
            nanran::commands::translation_status,
            nanran::commands::translation_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("nanran failed to start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<nanran::AppState>>().cancel_all();
            }
        });
}
