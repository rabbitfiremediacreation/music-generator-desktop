use tauri::{menu::MenuItem, AppHandle, Manager, Runtime};

struct SettingsMenu<R: Runtime>(MenuItem<R>);

/// Add the standard macOS settings entry while retaining native editing and window menus.
#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItemKind, PredefinedMenuItem},
        Emitter,
    };

    let menu = Menu::default(app.handle())?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", false, Some("Cmd+Comma"))?;
    if let Some(MenuItemKind::Submenu(application)) = menu.items()?.into_iter().next() {
        application.insert_items(&[&settings, &PredefinedMenuItem::separator(app)?], 2)?;
    }
    app.manage(SettingsMenu(settings));
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() != "settings" {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("open-settings", ());
        }
    });
    Ok(())
}

/// Keep the native entry in sync with the interface language and available actions.
#[tauri::command]
pub fn configure_settings_menu<R: Runtime>(
    app: AppHandle<R>,
    text: String,
    enabled: bool,
) -> Result<(), String> {
    if let Some(settings) = app.try_state::<SettingsMenu<R>>() {
        settings
            .0
            .set_text(text)
            .map_err(|error| error.to_string())?;
        settings
            .0
            .set_enabled(enabled)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
