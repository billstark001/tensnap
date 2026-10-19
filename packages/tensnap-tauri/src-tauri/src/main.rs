// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;

use commands::common::*;
use menu::create_menu;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_os_name_handler,
            open_documentation_handler,
            set_menu_locale_handler,
            exit_application_handler,
        ])
        .menu(create_menu)
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                for (label, child) in window.app_handle().webview_windows() {
                    if label.starts_with("dialog-") {
                        let _ = child.destroy();
                    }
                }
            } else if window.label().starts_with("dialog-")
                && matches!(event, tauri::WindowEvent::Destroyed)
            {
                let descendant_prefix = format!("{}-", window.label());
                for (label, child) in window.app_handle().webview_windows() {
                    if label.starts_with(&descendant_prefix) {
                        let _ = child.destroy();
                    }
                }
            }
        })
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
