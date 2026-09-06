// The Twin app shell (desktop + mobile).
//
// On DESKTOP the shell provides what a browser tab cannot:
//   1. A GLOBAL shortcut (default ⌘K, rebindable in Settings → Appearance)
//      that summons a Spotlight-style search window from any app. The JS side
//      registers the accelerator (plugin-global-shortcut) and invokes
//      `toggle_spotlight`; window management lives here.
//   2. Staying alive with no window: closing the main window hides it, so the
//      global shortcut keeps working. Clicking the dock icon brings it back.
// The spotlight window is a separate WebView on the same origin, so it reads
// the same IndexedDB the main window writes (LocalRepository) — no IPC needed.
//
// On MOBILE (iOS/Android) none of that applies: there are no global hotkeys and
// no multi-window, so the shell is just the SPA host. The same web build runs
// unchanged in the platform WebView, with the local IndexedDB backend. All the
// desktop machinery below is gated with cfg(desktop) so it neither compiles nor
// links into the mobile app.

#[cfg(desktop)]
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
const SPOTLIGHT: &str = "spotlight";

#[cfg(desktop)]
fn show_spotlight(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(SPOTLIGHT) {
        // Re-emitting lets the page clear its query and re-read fresh rows
        // (the local backend hydrates per page load; the page reloads itself).
        let _ = w.emit("spotlight:show", ());
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SPOTLIGHT, WebviewUrl::App("/spotlight".into()))
        .title("Twin Search")
        .inner_size(640.0, 420.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .build();
    if let Ok(w) = built {
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
#[tauri::command]
fn toggle_spotlight(app: tauri::AppHandle) {
    match app.get_webview_window(SPOTLIGHT) {
        Some(w) if w.is_visible().unwrap_or(false) => {
            let _ = w.hide();
        }
        _ => show_spotlight(&app),
    }
}

#[cfg(desktop)]
#[tauri::command]
fn hide_spotlight(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(SPOTLIGHT) {
        let _ = w.hide();
    }
}

/// Spotlight result chosen: surface the main window on that record and hide
/// the overlay. The main window listens for `twin:navigate` and goto()s.
#[cfg(desktop)]
#[tauri::command]
fn open_in_main(app: tauri::AppHandle, path: String) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("twin:navigate", path);
        let _ = main.show();
        let _ = main.set_focus();
    }
    hide_spotlight(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Desktop-only: global shortcut + window-state plugins, the spotlight IPC
    // commands, and the hide-on-close window behaviour.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Remember main-window size/position between launches. The spotlight
        // window is excluded implicitly: it is created per-summon and centered.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            toggle_spotlight,
            hide_spotlight,
            open_in_main
        ])
        .on_window_event(|window, event| match event {
            // Main window: close = hide, so the app (and the global shortcut)
            // stays alive in the background — the whole point of the feature.
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                let _ = window.hide();
                api.prevent_close();
            }
            // Spotlight: clicking anywhere else dismisses it, like Spotlight.
            tauri::WindowEvent::Focused(false) if window.label() == SPOTLIGHT => {
                let _ = window.hide();
            }
            _ => {}
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building twin")
        .run(|app, event| {
            // macOS dock click with no visible window → bring the main one back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            let _ = (app, &event);
        });
}
