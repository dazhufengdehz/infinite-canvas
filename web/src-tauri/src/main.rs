#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;

struct DesktopProcesses {
    storage: Child,
    canvas_agent: Option<Child>,
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_open_urls(app, argv);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let storage = spawn_storage(&app.handle()).expect("无法启动桌面存储服务");
            let canvas_agent = spawn_canvas_agent(&app.handle());
            app.manage(Mutex::new(DesktopProcesses { storage, canvas_agent }));
            #[cfg(desktop)]
            {
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    handle_open_urls(&app_handle, event.urls());
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_canvas_agent_config])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(processes) = app_handle.try_state::<Mutex<DesktopProcesses>>() {
                if let Ok(mut processes) = processes.lock() {
                    // 先让存储服务把队列写完，再等待退出；超时才强制结束。
                    request_storage_shutdown();
                    stop_child_gracefully(&mut processes.storage);
                    if let Some(agent) = processes.canvas_agent.as_mut() {
                        stop_child(agent);
                    }
                }
            }
        }
    });
}

fn spawn_storage(app: &AppHandle) -> Result<Child, Box<dyn std::error::Error>> {
    let resource_dir = app.path().resolve("", BaseDirectory::Resource)?;
    let server = app.path().resolve("server/desktop-server.mjs", BaseDirectory::Resource)?;
    let node = sidecar_path(&resource_dir)?;
    let data_dir = app.path().app_data_dir()?;
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home {
        std::fs::create_dir_all(Path::new(&home).join(".infinite-canvas"))?;
    }
    Ok(Command::new(node)
        .arg(server)
        .current_dir(resource_dir)
        .env("INFINITE_CANVAS_DESKTOP", "1")
        .env("INFINITE_CANVAS_DATA_DIR", data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?)
}

/// 已运行的 Agent 继续归原进程管理；桌面端只关闭自己启动的子进程。
fn spawn_canvas_agent(app: &AppHandle) -> Option<Child> {
    if read_canvas_agent_config().as_ref().is_some_and(canvas_agent_online) {
        return None;
    }
    let package_dir = app.path().resolve("canvas-agent", BaseDirectory::Resource).expect("缺少 Canvas Agent Sidecar");
    let node = sidecar_path(&app.path().resolve("", BaseDirectory::Resource).expect("无法定位桌面资源目录")).expect("无法定位 Node Sidecar");
    let child = Command::new(node)
        .arg(package_dir.join("dist/index.js"))
        .arg("--no-open")
        .current_dir(package_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("无法启动 Canvas Agent Sidecar");
    Some(child)
}

fn stop_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// 通知存储服务把写队列清空后自行退出。
fn request_storage_shutdown() {
    use std::io::Write;
    let Ok(address) = "127.0.0.1:18080".parse::<SocketAddr>() else { return };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else { return };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let request = "POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1:18080\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(request.as_bytes());
    let _ = stream.flush();
}

fn stop_child_gracefully(child: &mut Child) {
    for _ in 0..30 {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn sidecar_path(resource_dir: &Path) -> std::io::Result<PathBuf> {
    let target = current_target();
    let binary_name = format!("node-{}{}", target, std::env::consts::EXE_SUFFIX);
    let packaged = resource_dir.join("binaries").join(binary_name);
    if packaged.exists() {
        return Ok(packaged);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("node-{}{}", target, std::env::consts::EXE_SUFFIX));
    if dev.exists() {
        return Ok(dev);
    }
    Err(std::io::Error::new(std::io::ErrorKind::NotFound, format!("Node Sidecar 不存在：{}", packaged.display())))
}

#[tauri::command]
fn get_canvas_agent_config() -> Option<Value> {
    read_canvas_agent_config()
}

fn read_canvas_agent_config() -> Option<Value> {
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
    } else {
        std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))
    }?;
    let file = Path::new(&home).join(".infinite-canvas").join("canvas-agent.json");
    let value: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    let url = value.get("url")?.as_str()?.trim().trim_end_matches('/');
    let token = value.get("token")?.as_str()?.trim();
    if url.is_empty() || token.is_empty() {
        return None;
    }
    Some(json!({ "url": url, "token": token }))
}

fn canvas_agent_online(config: &Value) -> bool {
    let Some(url) = config.get("url").and_then(Value::as_str) else { return false };
    let Some(authority) = url.strip_prefix("http://").and_then(|value| value.split('/').next()) else { return false };
    let Ok(address) = authority.parse::<SocketAddr>() else { return false };
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn current_target() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" }
    } else if cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    }
}

fn handle_open_urls<S: AsRef<str>>(app: &AppHandle, urls: Vec<S>) {
    for url in urls {
        let url = url.as_ref();
        if url.starts_with("infinite-canvas://") {
            let _ = app.emit("deep-link", url);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }
    }
}
