#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, sync::Mutex};
use tauri::{path::BaseDirectory, Manager, RunEvent};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

struct DesktopSidecar(Mutex<Option<CommandChild>>);

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let script = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../server/desktop-server.mjs")
            } else {
                app.path().resolve("server/desktop-server.mjs", BaseDirectory::Resource)?
            };
            let data_dir = app.path().app_data_dir()?.join("storage");
            let command = app.shell().sidecar("node")
                .map_err(|error| { eprintln!("[Desktop] 无法定位 Node Sidecar: {error}"); error })?
                .arg(script)
                .env("PORT", "18080")
                .env("INFINITE_CANVAS_DATA_DIR", data_dir);
            let (mut rx, child) = command.spawn()
                .map_err(|error| { eprintln!("[Desktop] 无法启动 Node Sidecar: {error}"); error })?;
            app.manage(DesktopSidecar(Mutex::new(Some(child))));
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => print!("[Storage] {}", String::from_utf8_lossy(&line)),
                        CommandEvent::Stderr(line) => eprint!("[Storage] {}", String::from_utf8_lossy(&line)),
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无限画布桌面应用启动失败");
    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            if let Some(child) = app.state::<DesktopSidecar>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
