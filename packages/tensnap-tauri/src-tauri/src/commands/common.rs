use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_os_name_handler() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
pub fn set_menu_locale_handler(app: AppHandle, locale: String) -> Result<(), String> {
    crate::menu::set_menu_locale(&app, &locale)
}

#[tauri::command]
pub fn exit_application_handler(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn open_documentation_handler(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(
            "https://github.com/billstark001/tensnap/tree/main/docs",
            None::<&str>,
        )
        .map_err(|error| error.to_string())
}
