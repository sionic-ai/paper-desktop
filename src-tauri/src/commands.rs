//! Tauri commands and the translation job runner.

use crate::library::{Library, Meta};
use crate::model::{self, Doc};
use crate::{arxiv, pdf, search, translate};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;

const WORKERS: usize = 3;

#[derive(Default)]
pub(crate) struct Job {
    total: usize,
    done: usize,
    running: bool,
    error: Option<String>,
    cancel: Arc<AtomicBool>,
}

pub struct AppState {
    pub library: Library,
    pub(crate) jobs: Mutex<HashMap<String, Job>>,
}

impl AppState {
    pub fn new(root: PathBuf) -> std::io::Result<Self> {
        Ok(Self {
            library: Library::open(root)?,
            jobs: Mutex::new(HashMap::new()),
        })
    }

    pub fn cancel_all(&self) {
        for job in self.jobs.lock().unwrap().values() {
            job.cancel.store(true, Ordering::Relaxed);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub total: usize,
    pub done: usize,
    pub running: bool,
    pub error: Option<String>,
    /// Unit id → Korean sentences.
    pub units: HashMap<u32, Vec<String>>,
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "작업이 중단됐어요".to_string())?
}

#[tauri::command]
pub fn library_list(state: State<'_, Arc<AppState>>) -> Vec<Meta> {
    state.library.list()
}

#[tauri::command]
pub fn library_get(state: State<'_, Arc<AppState>>, id: String) -> Result<Doc, String> {
    state.library.doc(&id)
}

#[tauri::command]
pub fn library_remove(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    if let Some(job) = state.jobs.lock().unwrap().remove(&id) {
        job.cancel.store(true, Ordering::Relaxed);
    }
    state.library.remove(&id)
}

#[tauri::command]
pub async fn open_arxiv(state: State<'_, Arc<AppState>>, input: String) -> Result<Meta, String> {
    let id = arxiv::parse_id(&input)
        .ok_or_else(|| "arXiv ID나 arxiv.org 주소를 넣어 주세요 (예: 1706.03762)".to_string())?;
    let state = state.inner().clone();
    blocking(move || {
        let doc = arxiv::fetch(&id)?;
        state.library.save(&doc)
    })
    .await
}

#[tauri::command]
pub async fn arxiv_search(query: String, start: usize) -> Result<search::Page, String> {
    blocking(move || search::search(&query, start)).await
}

/// Opens the paper's abstract page on arxiv.org in the default browser. Only arXiv IDs are accepted,
/// so the webview can never open an arbitrary URL.
#[tauri::command]
pub fn open_arxiv_page(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let id = arxiv::parse_id(&id).ok_or_else(|| "arXiv ID가 아니에요".to_string())?;
    app.opener()
        .open_url(format!("https://arxiv.org/abs/{id}"), None::<&str>)
        .map_err(|_| "브라우저를 열지 못했어요".to_string())
}

#[tauri::command]
pub async fn open_pdf(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<Meta>, String> {
    use tauri_plugin_dialog::DialogExt;
    let state = state.inner().clone();
    blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|_| "파일 경로를 읽지 못했어요".to_string())?;
        let bytes = std::fs::read(&path).map_err(|_| "파일을 읽지 못했어요".to_string())?;
        let mut builder = pdf::parse(&bytes)?;
        if builder.title.is_empty() {
            builder.title = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "PDF".into());
        }
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let doc = builder.finish(format!("pdf-{}", model::content_id(&bytes)), &name);
        state.library.save(&doc).map(Some)
    })
    .await
}

#[tauri::command]
pub fn translation_cancel(state: State<'_, Arc<AppState>>, id: String) {
    if let Some(job) = state.jobs.lock().unwrap().get(&id) {
        job.cancel.store(true, Ordering::Relaxed);
    }
}

/// Translates every unit that has no saved translation yet.
#[tauri::command]
pub fn translation_start(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    start_translation(state.inner(), id)
}

#[tauri::command]
pub fn translation_status(state: State<'_, Arc<AppState>>, id: String) -> Result<Status, String> {
    Ok(status(state.inner(), &id))
}

pub fn status(state: &Arc<AppState>, id: &str) -> Status {
    let units = state.library.translations(id);
    let jobs = state.jobs.lock().unwrap();
    let job = jobs.get(id);
    Status {
        total: job.map_or(0, |j| j.total),
        done: job.map_or(0, |j| j.done),
        running: job.is_some_and(|j| j.running),
        error: job.and_then(|j| j.error.clone()),
        units,
    }
}

pub fn start_translation(state: &Arc<AppState>, id: String) -> Result<(), String> {
    let claude = translate::find_claude().ok_or_else(|| {
        "Claude Code CLI를 찾지 못했어요. 설치 후 터미널에서 `claude`로 로그인해 주세요".to_string()
    })?;
    let doc = state.library.doc(&id)?;
    let have = state.library.translations(&id);
    let pending: Vec<model::Unit> = doc
        .units()
        .into_iter()
        .filter(|u| !have.contains_key(&u.id))
        .cloned()
        .collect();
    let batches = translate::batches(&pending);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state.jobs.lock().unwrap();
        if jobs.get(&id).is_some_and(|j| j.running) {
            return Ok(());
        }
        jobs.insert(
            id.clone(),
            Job {
                total: batches.len(),
                done: 0,
                running: !batches.is_empty(),
                error: None,
                cancel: cancel.clone(),
            },
        );
    }
    if batches.is_empty() {
        return Ok(());
    }
    let state = state.clone();
    std::thread::spawn(move || {
        let queue = Mutex::new(batches.into_iter());
        let first_error: Mutex<Option<String>> = Mutex::new(None);
        std::thread::scope(|scope| {
            for _ in 0..WORKERS {
                scope.spawn(|| {
                    loop {
                        if cancel.load(Ordering::Relaxed) {
                            return;
                        }
                        let Some(batch) = queue.lock().unwrap().next() else {
                            return;
                        };
                        match translate::translate_batch(&claude, &doc.title, &batch, &cancel) {
                            Ok(units) => {
                                let _ = state.library.add_translations(&id, &units);
                                if let Some(job) = state.jobs.lock().unwrap().get_mut(&id) {
                                    job.done += 1;
                                }
                            }
                            Err(e) => {
                                first_error.lock().unwrap().get_or_insert(e);
                                cancel.store(true, Ordering::Relaxed);
                                return;
                            }
                        }
                    }
                });
            }
        });
        if let Some(job) = state.jobs.lock().unwrap().get_mut(&id) {
            job.running = false;
            job.error = first_error.into_inner().unwrap();
        }
    });
    Ok(())
}
