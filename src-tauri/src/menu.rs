use std::collections::HashMap;
use tauri::{
    menu::{MenuItem, Submenu},
    AppHandle, Manager, Runtime,
};

struct AppMenu<R: Runtime> {
    sections: [(&'static str, Submenu<R>); 5],
    actions: [MenuItem<R>; 8],
}

#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    use tauri::{
        menu::{
            AboutMetadata, Menu, PredefinedMenuItem as Native, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
        },
        Emitter,
    };

    let item = |id, text, shortcut| MenuItem::with_id(app, id, text, false, shortcut);
    let settings = item("settings", "Settings…", Some("Cmd+Comma"))?;
    let updates = item("updates", "Check for Updates…", None)?;
    let songs_folder = item("songs-folder", "Open Songs Folder", None)?;
    let creator = item("creator", "Show Song Editor", None)?;
    let library = item("library", "Library", None)?;
    let models = item("models", "Models and Hardware…", None)?;
    let phone = item("phone", "Phone Access…", None)?;
    let documentation = item("documentation", "Documentation", None)?;

    let package = app.package_info();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app
            .config()
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let application = Submenu::with_items(
        app,
        &package.name,
        true,
        &[
            &Native::about(app, None, Some(about))?,
            &updates,
            &Native::separator(app)?,
            &settings,
            &Native::separator(app)?,
            &Native::services(app, None)?,
            &Native::separator(app)?,
            &Native::hide(app, None)?,
            &Native::hide_others(app, None)?,
            &Native::show_all(app, None)?,
            &Native::separator(app)?,
            &Native::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &songs_folder,
            &Native::separator(app)?,
            &Native::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &Native::undo(app, None)?,
            &Native::redo(app, None)?,
            &Native::separator(app)?,
            &Native::cut(app, None)?,
            &Native::copy(app, None)?,
            &Native::paste(app, None)?,
            &Native::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &creator,
            &library,
            &Native::separator(app)?,
            &models,
            &phone,
            &Native::separator(app)?,
            &Native::fullscreen(app, None)?,
        ],
    )?;
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[&Native::minimize(app, None)?, &Native::maximize(app, None)?],
    )?;
    let help = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[&documentation])?;

    app.set_menu(Menu::with_items(
        app,
        &[&application, &file, &edit, &view, &window, &help],
    )?)?;
    app.manage(AppMenu {
        sections: [
            ("file", file),
            ("edit", edit),
            ("view", view),
            ("window", window),
            ("help", help),
        ],
        actions: [
            settings,
            updates,
            songs_folder,
            creator,
            library,
            models,
            phone,
            documentation,
        ],
    });
    app.on_menu_event(|app, event| {
        let menu = app.state::<AppMenu<R>>();
        if !menu.actions.iter().any(|item| item.id() == event.id()) {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = app.emit_to("main", "app-menu-action", event.id().as_ref());
        }
    });
    Ok(())
}

#[tauri::command]
pub fn configure_app_menu<R: Runtime>(
    app: AppHandle<R>,
    labels: HashMap<String, String>,
    enabled: Vec<String>,
) -> Result<(), String> {
    let Some(menu) = app.try_state::<AppMenu<R>>() else {
        return Ok(());
    };
    for (id, section) in &menu.sections {
        if let Some(label) = labels.get(*id) {
            section.set_text(label).map_err(|error| error.to_string())?;
        }
    }
    for item in &menu.actions {
        let id: &str = item.id().as_ref();
        if let Some(label) = labels.get(id) {
            item.set_text(label).map_err(|error| error.to_string())?;
        }
        item.set_enabled(enabled.iter().any(|value| value == id))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
