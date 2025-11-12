#[tauri::command]
pub fn get_os_name_handler() -> String {
    std::env::consts::OS.to_string()
}
