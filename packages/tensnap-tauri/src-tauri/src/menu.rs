use tauri::{menu::*, AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Clone, Copy)]
struct MenuLabels {
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    tools: &'static str,
    help: &'static str,
    new: &'static str,
    open_file: &'static str,
    save: &'static str,
    save_as: &'static str,
    #[cfg(not(target_os = "macos"))]
    exit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    zoom_in: &'static str,
    zoom_out: &'static str,
    reset_zoom: &'static str,
    show_grid: &'static str,
    fullscreen: &'static str,
    settings: &'static str,
    documentation: &'static str,
    keyboard_shortcuts: &'static str,
    about: &'static str,
}

fn labels(locale: &str) -> Option<MenuLabels> {
    match locale {
        "en" => Some(MenuLabels {
            file: "File",
            edit: "Edit",
            view: "View",
            tools: "Tools",
            help: "Help",
            new: "New",
            open_file: "Open File",
            save: "Save",
            save_as: "Save As...",
            #[cfg(not(target_os = "macos"))]
            exit: "Exit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            zoom_in: "Zoom In",
            zoom_out: "Zoom Out",
            reset_zoom: "Reset Zoom",
            show_grid: "Show Grid",
            fullscreen: "Fullscreen",
            settings: "Settings",
            documentation: "Documentation",
            keyboard_shortcuts: "Keyboard Shortcuts",
            about: "About TenSnap",
        }),
        "zh" => Some(MenuLabels {
            file: "文件",
            edit: "编辑",
            view: "视图",
            tools: "工具",
            help: "帮助",
            new: "新建",
            open_file: "打开文件",
            save: "保存",
            save_as: "另存为...",
            #[cfg(not(target_os = "macos"))]
            exit: "退出",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "复制",
            paste: "粘贴",
            select_all: "全选",
            zoom_in: "放大",
            zoom_out: "缩小",
            reset_zoom: "重置缩放",
            show_grid: "显示网格",
            fullscreen: "全屏",
            settings: "设置",
            documentation: "文档",
            keyboard_shortcuts: "键盘快捷键",
            about: "关于 TenSnap",
        }),
        "ja" => Some(MenuLabels {
            file: "ファイル",
            edit: "編集",
            view: "表示",
            tools: "ツール",
            help: "ヘルプ",
            new: "新規",
            open_file: "ファイルを開く",
            save: "保存",
            save_as: "別名で保存...",
            #[cfg(not(target_os = "macos"))]
            exit: "終了",
            undo: "元に戻す",
            redo: "やり直す",
            cut: "切り取り",
            copy: "コピー",
            paste: "貼り付け",
            select_all: "すべて選択",
            zoom_in: "拡大",
            zoom_out: "縮小",
            reset_zoom: "ズームをリセット",
            show_grid: "グリッドを表示",
            fullscreen: "フルスクリーン",
            settings: "設定",
            documentation: "ドキュメント",
            keyboard_shortcuts: "キーボードショートカット",
            about: "TenSnapについて",
        }),
        _ => None,
    }
}

pub fn create_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    create_menu_for_locale(app, "en")
}

fn create_menu_for_locale(app: &AppHandle, locale: &str) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let labels =
        labels(locale).unwrap_or_else(|| labels("en").expect("English menu labels must exist"));
    let menu = Menu::new(app)?;

    // File Menu
    let file_menu = Submenu::with_items(
        app,
        labels.file,
        true,
        &[
            &MenuItem::with_id(app, "new", labels.new, true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", labels.open_file, true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "save", labels.save, true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "save_as",
                labels.save_as,
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(not(target_os = "macos"))]
            &MenuItem::with_id(app, "exit", labels.exit, true, Some("Alt+F4"))?,
        ],
    )?;

    // Edit Menu
    let edit_menu = Submenu::with_items(
        app,
        labels.edit,
        true,
        &[
            &MenuItem::with_id(app, "undo", labels.undo, true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", labels.redo, true, Some("CmdOrCtrl+Shift+Z"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "cut", labels.cut, true, Some("CmdOrCtrl+X"))?,
            &MenuItem::with_id(app, "copy", labels.copy, true, Some("CmdOrCtrl+C"))?,
            &MenuItem::with_id(app, "paste", labels.paste, true, Some("CmdOrCtrl+V"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "select_all",
                labels.select_all,
                true,
                Some("CmdOrCtrl+A"),
            )?,
        ],
    )?;

    // View Menu
    let view_menu = Submenu::with_items(
        app,
        labels.view,
        true,
        &[
            &MenuItem::with_id(app, "zoom_in", labels.zoom_in, true, Some("CmdOrCtrl+Plus"))?,
            &MenuItem::with_id(
                app,
                "zoom_out",
                labels.zoom_out,
                true,
                Some("CmdOrCtrl+Minus"),
            )?,
            &MenuItem::with_id(
                app,
                "reset_zoom",
                labels.reset_zoom,
                true,
                Some("CmdOrCtrl+0"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "show_grid", labels.show_grid, true, None::<&str>)?,
            &MenuItem::with_id(app, "fullscreen", labels.fullscreen, true, Some("F11"))?,
        ],
    )?;

    // Tools Menu
    let tools_menu = Submenu::with_items(
        app,
        labels.tools,
        true,
        &[&MenuItem::with_id(
            app,
            "settings",
            labels.settings,
            true,
            Some("CmdOrCtrl+,"),
        )?],
    )?;

    // Help Menu
    let help_menu = Submenu::with_items(
        app,
        labels.help,
        true,
        &[
            &MenuItem::with_id(
                app,
                "documentation",
                labels.documentation,
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "keyboard_shortcuts",
                labels.keyboard_shortcuts,
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "about", labels.about, true, None::<&str>)?,
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

pub fn set_menu_locale(app: &AppHandle, locale: &str) -> Result<(), String> {
    if labels(locale).is_none() {
        return Err(format!("Unsupported menu locale: {locale}"));
    }
    let menu = create_menu_for_locale(app, locale).map_err(|error| error.to_string())?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|error| error.to_string())
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

#[cfg(test)]
mod tests {
    use super::labels;

    #[test]
    fn supports_every_renderer_locale_with_translated_menu_titles() {
        assert_eq!(labels("en").expect("English labels").file, "File");
        assert_eq!(labels("zh").expect("Chinese labels").file, "文件");
        assert_eq!(labels("ja").expect("Japanese labels").file, "ファイル");
        assert!(labels("fr").is_none());
    }
}
