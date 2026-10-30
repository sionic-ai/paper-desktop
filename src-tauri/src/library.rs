//! Papers and their translations as JSON files under the app data directory.

use crate::model::{Doc, Unit};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub title: String,
    pub source: String,
    pub added_at: u64,
    pub units: usize,
}

pub struct Library {
    root: PathBuf,
    /// Serializes translation-file read-modify-write across worker threads.
    write: Mutex<()>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !id.contains("..")
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)
        .and_then(|_| std::fs::rename(&tmp, path))
        .map_err(|_| "저장하지 못했어요".to_string())
}

impl Library {
    pub fn open(root: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            write: Mutex::new(()),
        })
    }

    fn path(&self, id: &str, suffix: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("잘못된 논문 ID예요".into());
        }
        Ok(self.root.join(format!("{id}.{suffix}.json")))
    }

    pub fn save(&self, doc: &Doc) -> Result<Meta, String> {
        let meta_path = self.path(&doc.id, "meta")?;
        let added_at = std::fs::read(&meta_path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Meta>(&b).ok())
            .map(|m| m.added_at)
            .unwrap_or_else(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or_default()
            });
        let meta = Meta {
            id: doc.id.clone(),
            title: doc.title.clone(),
            source: doc.source.clone(),
            added_at,
            units: doc.units().len(),
        };
        write_atomic(
            &self.path(&doc.id, "doc")?,
            &serde_json::to_vec(doc).unwrap(),
        )?;
        write_atomic(&meta_path, &serde_json::to_vec(&meta).unwrap())?;
        Ok(meta)
    }

    pub fn list(&self) -> Vec<Meta> {
        let mut out: Vec<Meta> = std::fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".meta.json"))
            .filter_map(|e| std::fs::read(e.path()).ok())
            .filter_map(|b| serde_json::from_slice(&b).ok())
            .collect();
        out.sort_by_key(|m: &Meta| std::cmp::Reverse(m.added_at));
        out
    }

    pub fn doc(&self, id: &str) -> Result<Doc, String> {
        let bytes =
            std::fs::read(self.path(id, "doc")?).map_err(|_| "논문을 찾지 못했어요".to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| "저장된 논문이 손상됐어요".to_string())
    }

    pub fn translations(&self, id: &str) -> HashMap<u32, Vec<String>> {
        self.path(id, "ko")
            .ok()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn add_translations(&self, id: &str, units: &[Unit]) -> Result<(), String> {
        let _guard = self.write.lock().unwrap();
        let mut all = self.translations(id);
        for u in units {
            all.insert(u.id, u.sentences.clone());
        }
        write_atomic(&self.path(id, "ko")?, &serde_json::to_vec(&all).unwrap())
    }

    /// Writing-style version of the saved translations (see `translate::STYLE`); 1 when unrecorded.
    pub fn style(&self, id: &str) -> u32 {
        self.path(id, "style")
            .ok()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(1)
    }

    pub fn set_style(&self, id: &str, style: u32) -> Result<(), String> {
        write_atomic(&self.path(id, "style")?, style.to_string().as_bytes())
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _guard = self.write.lock().unwrap();
        for suffix in ["doc", "meta", "ko", "style"] {
            let _ = std::fs::remove_file(self.path(id, suffix)?);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Builder;

    #[test]
    fn rejects_path_like_ids() {
        for id in ["../x", "a/b", "", "a..b"] {
            assert!(!valid_id(id), "{id}");
        }
        assert!(valid_id("arxiv-1706.03762v7"));
        assert!(valid_id("arxiv-hep-th_9901001"));
    }

    #[test]
    fn round_trips_docs_and_translations() {
        let dir = std::env::temp_dir().join(format!("nanran-lib-test-{}", std::process::id()));
        let lib = Library::open(dir.clone()).unwrap();
        let mut b = Builder::default();
        b.title = "T".into();
        b.para("One. Two.");
        let doc = b.finish("pdf-abc".into(), "a.pdf");
        lib.save(&doc).unwrap();
        assert_eq!(lib.list()[0].units, 1);
        lib.add_translations(
            "pdf-abc",
            &[Unit {
                id: 0,
                sentences: vec!["하나.".into(), "둘.".into()],
            }],
        )
        .unwrap();
        assert_eq!(lib.translations("pdf-abc")[&0].len(), 2);
        assert_eq!(lib.style("pdf-abc"), 1);
        lib.set_style("pdf-abc", 2).unwrap();
        assert_eq!(lib.style("pdf-abc"), 2);
        lib.remove("pdf-abc").unwrap();
        assert!(lib.list().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
