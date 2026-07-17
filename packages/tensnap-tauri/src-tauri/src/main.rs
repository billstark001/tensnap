// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;

use commands::common::*;
use menu::create_menu;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_os_name_handler,
            set_menu_locale_handler,
            exit_application_handler,
        ])
        .menu(create_menu)
        .on_menu_event(menu::handle_menu_event)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
