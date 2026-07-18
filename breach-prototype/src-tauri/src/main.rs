// BREACH — Tauri desktop shell.
// Wraps the exact same web build (dist/) in a native window. All game logic
// lives in the frontend; this binary just hosts the webview.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running BREACH");
}
