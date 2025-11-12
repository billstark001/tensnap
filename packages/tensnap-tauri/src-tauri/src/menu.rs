use tauri::{AppHandle, Manager, menu::*, WebviewWindow, Emitter};

pub fn create_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let menu = Menu::new(app)?;

    // File Menu
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", "Open File", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, "exit", "Exit", true, Some("Alt+F4"))?,
        ],
    )?;

    // Edit Menu
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "cut", "Cut", true, Some("CmdOrCtrl+X"))?,
            &MenuItem::with_id(app, "copy", "Copy", true, Some("CmdOrCtrl+C"))?,
            &MenuItem::with_id(app, "paste", "Paste", true, Some("CmdOrCtrl+V"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "select_all", "Select All", true, Some("CmdOrCtrl+A"))?,
        ],
    )?;

    // View Menu
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?,
            &MenuItem::with_id(app, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+Minus"))?,
            &MenuItem::with_id(app, "reset_zoom", "Reset Zoom", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "show_grid", "Show Grid", true, None::<&str>)?,
            &MenuItem::with_id(app, "show_toolbar", "Show Toolbar", true, None::<&str>)?,
            &MenuItem::with_id(app, "fullscreen", "Fullscreen", true, Some("F11"))?,
        ],
    )?;

    // Tools Menu
    let tools_menu = Submenu::with_items(
        app,
        "Tools",
        true,
        &[
            &MenuItem::with_id(app, "settings", "Settings", true, Some("CmdOrCtrl+,"))?,
        ],
    )?;

    // Help Menu
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "documentation", "Documentation", true, None::<&str>)?,
            &MenuItem::with_id(app, "keyboard_shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "about", "About TenSnap", true, None::<&str>)?,
        ],
    )?;

    // Add all submenus to the main menu
    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    menu.append(&view_menu)?;
    menu.append(&tools_menu)?;
    menu.append(&help_menu)?;

    Ok(menu)
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let window = app.get_webview_window("main");
    
    if let Some(window) = window {
        match event.id().as_ref() {
            // File menu
            "new" => emit_event(&window, "menu:new"),
            "open" => emit_event(&window, "menu:open"),
            "save" => emit_event(&window, "menu:save"),
            "save_as" => emit_event(&window, "menu:save-as"),
            "exit" => {
                app.exit(0);
            }

            // Edit menu
            "undo" => emit_event(&window, "menu:undo"),
            "redo" => emit_event(&window, "menu:redo"),
            "cut" => emit_event(&window, "menu:cut"),
            "copy" => emit_event(&window, "menu:copy"),
            "paste" => emit_event(&window, "menu:paste"),
            "select_all" => emit_event(&window, "menu:select-all"),

            // View menu
            "zoom_in" => emit_event(&window, "menu:zoom-in"),
            "zoom_out" => emit_event(&window, "menu:zoom-out"),
            "reset_zoom" => emit_event(&window, "menu:reset-zoom"),
            "show_grid" => emit_event(&window, "menu:show-grid"),
            "show_toolbar" => emit_event(&window, "menu:show-toolbar"),
            "fullscreen" => {
                if let Ok(is_fullscreen) = window.is_fullscreen() {
                    let _ = window.set_fullscreen(!is_fullscreen);
                }
            }

            // Tools menu
            "settings" => emit_event(&window, "menu:settings"),

            // Help menu
            "documentation" => emit_event(&window, "menu:documentation"),
            "keyboard_shortcuts" => emit_event(&window, "menu:keyboard-shortcuts"),
            "about" => emit_event(&window, "menu:about"),

            _ => {}
        }
    }
}

fn emit_event(window: &WebviewWindow, event: &str) {
    if let Err(e) = window.emit(event, ()) {
        eprintln!("Failed to emit event {}: {}", event, e);
    }
}
