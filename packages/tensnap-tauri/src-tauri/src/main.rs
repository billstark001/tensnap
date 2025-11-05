// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::file_system::*;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_file_handler,
            read_file_handler,
            delete_file_handler,
            list_files_handler,
            create_directory_handler,
            read_directory_handler,
            delete_directory_handler,
            file_exists_handler,
            directory_exists_handler,
            get_file_metadata_handler
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
