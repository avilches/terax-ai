pub mod modules;

use modules::{agent, fs, git, history, pty, shell, window_state, workspace};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::PhysicalPosition;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().expect("LaunchDir mutex poisoned").take()
}

fn parse_launch_dir() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&arg) else {
            continue;
        };
        if !canon.is_dir() {
            continue;
        }
        return Some(crate::modules::fs::to_canon(&canon));
    }
    None
}

fn create_app_window(
    app: &tauri::AppHandle,
    label: String,
    entry: Option<&window_state::WindowEntry>,
) -> Result<(), String> {
    let geo = entry.map(|e| &e.geometry);
    let width = geo.map(|g| g.width).unwrap_or(1280.0);
    let height = geo.map(|g| g.height).unwrap_or(800.0);
    let ws_count = entry
        .and_then(|e| e.workspaces.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    log::info!(
        "[window] create_app_window: label={label} size={width}x{height} workspaces={ws_count}"
    );

    // Size only in the builder — position is applied on first Focused(true) to work
    // around macOS cascade which overrides any position set before or at show().
    let builder =
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Terax")
            .inner_size(width, height)
            .min_inner_size(640.0, 480.0)
            .resizable(true)
            .visible(false);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    // Save geometry on close; remove from state only if other windows remain open.
    // When the last window closes (app quit), keep the state so it restores next launch.
    let app_handle = app.clone();
    let win_label = label.clone();
    // Flag: geometry has been applied on first focus (only once per window lifetime).
    let geo_applied = Arc::new(AtomicBool::new(false));
    let geo_applied_clone = geo_applied.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            let mgr = app_handle.state::<window_state::WindowStateManager>();
            // Apply saved geometry on the FIRST focus event. macOS cascade has finished
            // positioning the window by this point, so set_position/set_size are respected.
            if !geo_applied_clone.swap(true, Ordering::Relaxed) {
                if let Some(entry) = mgr.get_entry(&win_label) {
                    let g = &entry.geometry;
                    if let Some(w) = app_handle.get_webview_window(&win_label) {
                        let monitor_ok = g.monitor.as_deref().map_or(true, |saved| {
                            app_handle.available_monitors()
                                .ok()
                                .map(|ms| ms.iter().any(|m| m.name().map_or(false, |n| n == saved)))
                                .unwrap_or(true)
                        });
                        if g.maximized {
                            let _ = w.maximize();
                        } else {
                            let _ = w.set_size(tauri::LogicalSize::new(g.width, g.height));
                            if (g.x != 0.0 || g.y != 0.0) && monitor_ok {
                                let _ = w.set_position(tauri::LogicalPosition::new(g.x, g.y));
                                log::info!("[window] geometry applied for {win_label}: pos=({},{}) size={}x{}", g.x, g.y, g.width, g.height);
                            } else if !monitor_ok {
                                log::info!("[window] monitor {:?} not found, skipping position restore", g.monitor);
                            }
                        }
                    }
                }
            }
            mgr.set_focused_window(&win_label);
            mgr.save();
        }
        WindowEvent::CloseRequested { .. } => {
            let mgr = app_handle.state::<window_state::WindowStateManager>();
            if let Some(w) = app_handle.get_webview_window(&win_label) {
                // scale_factor uses unwrap_or so a failure there doesn't prevent saving pos/size.
                let scale = w.scale_factor().unwrap_or(1.0);
                let maximized = w.is_maximized().unwrap_or(false);
                match (w.outer_position(), w.inner_size()) {
                  (Ok(pos), Ok(inner)) => {
                    let logical_size = inner.to_logical::<f64>(scale);
                    let logical_pos = pos.to_logical::<f64>(scale);
                    let monitor = w.current_monitor()
                        .ok()
                        .flatten()
                        .and_then(|m| m.name().map(|n| n.to_string()));
                    log::info!(
                        "[window] saving geometry for {win_label}: pos=({},{}) size={}x{} maximized={maximized}",
                        logical_pos.x, logical_pos.y, logical_size.width, logical_size.height
                    );
                    mgr.update_geometry(
                        &win_label,
                        logical_pos.x,
                        logical_pos.y,
                        logical_size.width,
                        logical_size.height,
                        maximized,
                        monitor,
                    );
                    mgr.save();
                  }
                  (Err(e), _) => log::warn!("[window] CloseRequested: outer_position() failed for {win_label}: {e}"),
                  (_, Err(e)) => log::warn!("[window] CloseRequested: inner_size() failed for {win_label}: {e}"),
                }
            }
        }
        WindowEvent::Destroyed => {
            // Count live main windows after this one is gone.
            let live = app_handle
                .webview_windows()
                .into_keys()
                .filter(|l| l.starts_with("w-"))
                .count();
            let mgr = app_handle.state::<window_state::WindowStateManager>();
            if live > 0 {
                // User closed one window while others are open — remove from state.
                log::info!("[window] Destroyed {win_label}: {live} window(s) remain, removing from state");
                mgr.remove_window(&win_label);
                mgr.save();
            } else {
                // Last window closed (app quit) — keep state to restore next launch.
                log::info!("[window] Destroyed {win_label}: last window, keeping state for restore");
            }
            if live == 0 {
                if let Some(s) = app_handle.get_webview_window("settings") {
                    let _ = s.close();
                }
            }
        }
        _ => {}
    });

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            let _ = window.emit("terax:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(600.0, 700.0)
        .resizable(false)
        .visible(false)
        .always_on_top(true);

    // On non-macOS, set the active main window as parent so settings
    // minimizes with it.
    #[cfg(not(target_os = "macos"))]
    let builder = {
        let parent_win = app
            .webview_windows()
            .into_values()
            .find(|w| w.label().starts_with("w-"));
        match parent_win {
            Some(p) => builder.parent(&p).map_err(|e| e.to_string())?,
            None => builder,
        }
    };

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    #[cfg(target_os = "macos")]
    {
        let main_win = app
            .webview_windows()
            .into_values()
            .find(|w| w.label().starts_with("w-"));
        if let Some(main) = main_win {
            if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) =
                (main.outer_position(), main.outer_size(), window.outer_size())
            {
                let x = main_pos.x
                    + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
                let y = main_pos.y
                    + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
                let _ = window.set_position(PhysicalPosition::new(x, y));
            } else {
                let _ = window.center();
            }
        } else {
            let _ = window.center();
        }
    }

    Ok(())
}

#[tauri::command]
async fn open_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let id = window_state::generate_window_id();
    {
        let mgr = app.state::<window_state::WindowStateManager>();
        mgr.add_window(id.clone());
        mgr.save();
    }
    create_app_window(&app, id, None)
}

#[tauri::command]
fn window_get_state(
    app: tauri::AppHandle,
    label: String,
) -> Option<window_state::WindowEntry> {
    let entry = app.state::<window_state::WindowStateManager>().get_entry(&label);
    match &entry {
        Some(e) => {
            let ws = e.workspaces.as_array().map(|a| a.len()).unwrap_or(0);
            log::info!("[window] window_get_state: label={label} → found ({ws} workspace(s))");
        }
        None => log::warn!("[window] window_get_state: label={label} → NOT FOUND in state"),
    }
    entry
}

#[tauri::command]
fn window_save_workspace_state(
    app: tauri::AppHandle,
    label: String,
    workspaces: serde_json::Value,
    active_index: usize,
) {
    let mgr = app.state::<window_state::WindowStateManager>();
    mgr.update_workspace(&label, workspaces, active_index);
    mgr.save();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_dir = parse_launch_dir();
    workspace::init_launch_cwd(cli_dir.as_deref());

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            let state_path = data_dir.join("workspaces.json");
            let mgr = window_state::WindowStateManager::new(state_path);
            mgr.load();
            let order = mgr.window_order();
            app.manage(mgr);

            let handle = app.handle().clone();
            if order.is_empty() {
                let id = window_state::generate_window_id();
                let mgr = handle.state::<window_state::WindowStateManager>();
                mgr.add_window(id.clone());
                mgr.save();
                create_app_window(&handle, id, None)
                    .map_err(std::io::Error::other)?;
            } else {
                let focused_label = handle
                    .state::<window_state::WindowStateManager>()
                    .get_focused_window();
                let entries: Vec<_> = {
                    let m = handle.state::<window_state::WindowStateManager>();
                    order.iter().map(|id| (id.clone(), m.get_entry(id))).collect()
                };
                for (id, entry) in entries {
                    if let Err(e) = create_app_window(&handle, id.clone(), entry.as_ref()) {
                        eprintln!("terax: failed to restore window {id}: {e}");
                    }
                }
                // Re-focus the window that had focus when the app last closed.
                // create_app_window calls set_focus() on each window, so without
                // this the last-created window would have focus instead.
                let target = focused_label
                    .as_deref()
                    .and_then(|l| handle.get_webview_window(l))
                    .or_else(|| {
                        // Fallback: focus the first window in order.
                        order.first().and_then(|l| handle.get_webview_window(l))
                    });
                if let Some(w) = target {
                    let _ = w.set_focus();
                }
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(history::HistoryState::default())
        .manage(fs::grep::ContentSearchState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(cli_dir)))
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_shell_name,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            get_launch_dir,
            open_settings_window,
            open_main_window,
            window_get_state,
            window_save_workspace_state,
            agent::agent_enable_claude_hooks,
            agent::agent_claude_hooks_status,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
