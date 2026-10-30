//! Sentence-aligned Korean translation through the user's logged-in Claude Code CLI.
//!
//! Claude runs with every tool, MCP server, slash command, setting source and session file
//! disabled, in an empty private working directory. Paper text goes in on stdin only.

use crate::model::Unit;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const MODEL: &str = "sonnet";
const BATCH_SENTENCES: usize = 40;
const BATCH_CHARS: usize = 7000;
const TIMEOUT: Duration = Duration::from_secs(300);
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

const SYSTEM_PROMPT: &str = r#"You translate English research-paper text into Korean for Korean researchers.

Input on stdin is JSON: {"paper": title, "units": [{"id": n, "sentences": [english, ...]}]}.
Reply with ONLY this JSON and nothing else: {"units": [{"id": n, "sentences": [korean, ...]}]}

Rules:
- Every input unit appears once with the same id.
- Each unit has exactly as many Korean sentences as English sentences, in the same order. Sentence i translates English sentence i. Never merge, split, drop or reorder sentences.
- Translate everything faithfully. Do not summarize, explain or add anything.
- Use the terminology Korean researchers in this field actually use. Keep terms that are normally written in English (model names, datasets, metrics, acronyms such as BLEU, SD, GPU) in English.
- Write plain academic Korean in the 한다/이다 style.
- Copy every placeholder like ⟦M12⟧ exactly; each is a math expression. Keep citation markers like [5, 2] or (Smith et al., 2020), numbers and units unchanged.
- Headings and captions are short; translate them concisely and keep labels like "Figure 1:" as "그림 1:" and "Table 2:" as "표 2:"."#;

#[derive(Serialize)]
struct Request<'a> {
    paper: &'a str,
    units: &'a [Unit],
}

#[derive(Deserialize)]
struct Reply {
    units: Vec<Unit>,
}

#[derive(Deserialize)]
struct CliEnvelope {
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    result: String,
}

pub fn find_claude() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = &home {
        candidates.push(h.join(".local/bin/claude"));
        candidates.push(h.join(".claude/local/claude"));
        candidates.push(h.join(".npm-global/bin/claude"));
    }
    candidates.push("/opt/homebrew/bin/claude".into());
    candidates.push("/usr/local/bin/claude".into());
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join("claude")));
    }
    candidates.into_iter().find(|p| {
        std::fs::metadata(p).is_ok_and(|m| {
            use std::os::unix::fs::PermissionsExt;
            m.is_file() && m.permissions().mode() & 0o111 != 0
        })
    })
}

/// Login state of the Claude Code CLI, checked with `claude auth status` (no model call).
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub installed: bool,
    pub logged_in: bool,
    pub path: Option<String>,
}

pub fn claude_status() -> ClaudeStatus {
    let Some(claude) = find_claude() else {
        return ClaudeStatus {
            installed: false,
            logged_in: false,
            path: None,
        };
    };
    let mut cmd = Command::new(&claude);
    cmd.env_clear()
        .env("PATH", child_path(&claude))
        .env("LANG", "en_US.UTF-8");
    for key in ["HOME", "USER", "LOGNAME"] {
        if let Some(v) = std::env::var_os(key) {
            cmd.env(key, v);
        }
    }
    let logged_in = cmd
        .args(["auth", "status"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|o| serde_json::from_slice::<serde_json::Value>(&o.stdout).ok())
        .and_then(|v| v.get("loggedIn").and_then(|b| b.as_bool()))
        .unwrap_or(false);
    ClaudeStatus {
        installed: true,
        logged_in,
        path: Some(claude.display().to_string()),
    }
}

/// Groups consecutive units into batches small enough for one reliable reply.
pub fn batches(units: &[Unit]) -> Vec<Vec<Unit>> {
    let mut out: Vec<Vec<Unit>> = Vec::new();
    let mut current: Vec<Unit> = Vec::new();
    let (mut sentences, mut chars) = (0, 0);
    for u in units {
        let len: usize = u.sentences.iter().map(|s| s.len()).sum();
        if !current.is_empty()
            && (sentences + u.sentences.len() > BATCH_SENTENCES || chars + len > BATCH_CHARS)
        {
            out.push(std::mem::take(&mut current));
            sentences = 0;
            chars = 0;
        }
        sentences += u.sentences.len();
        chars += len;
        current.push(u.clone());
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn placeholders(s: &str) -> Vec<&str> {
    let mut out: Vec<&str> = s
        .match_indices('⟦')
        .filter_map(|(i, _)| s[i..].find('⟧').map(|j| &s[i..i + j + '⟧'.len_utf8()]))
        .collect();
    out.sort_unstable();
    out
}

/// A translated unit is usable when it keeps the sentence count and every math placeholder.
fn valid(src: &Unit, ko: &Unit) -> bool {
    src.sentences.len() == ko.sentences.len()
        && src
            .sentences
            .iter()
            .zip(&ko.sentences)
            .all(|(en, k)| placeholders(en) == placeholders(k) && !k.trim().is_empty())
}

pub fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then(|| &text[start..=end])
}

fn private_dir() -> Result<PathBuf, String> {
    use std::sync::atomic::AtomicU64;
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!(
        "nanran-{}-{nanos}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir(&dir).map_err(|_| "작업 폴더를 만들지 못했어요".to_string())?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| "작업 폴더 권한을 설정하지 못했어요".to_string())?;
    Ok(dir)
}

fn child_path(claude: &Path) -> String {
    let mut dirs: Vec<String> = Vec::new();
    if let Some(d) = claude.parent() {
        dirs.push(d.display().to_string());
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(d.into());
    }
    dirs.join(":")
}

/// Runs one translation call. Returns the model's text reply.
pub fn run_claude(claude: &Path, input: &str, cancel: &AtomicBool) -> Result<String, String> {
    run_claude_with(claude, SYSTEM_PROMPT, input, cancel)
}

/// Runs one isolated Claude call with the given system prompt. Returns the model's text reply.
pub fn run_claude_with(
    claude: &Path,
    system_prompt: &str,
    input: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let dir = private_dir()?;
    let mut cmd = Command::new(claude);
    cmd.env_clear()
        .env("PATH", child_path(claude))
        .env("TMPDIR", &dir)
        .env("LANG", "en_US.UTF-8");
    for key in ["HOME", "USER", "LOGNAME"] {
        if let Some(v) = std::env::var_os(key) {
            cmd.env(key, v);
        }
    }
    cmd.current_dir(&dir)
        .args([
            "-p",
            "--model",
            MODEL,
            "--output-format",
            "json",
            "--tools",
            "",
            "--disallowedTools",
            "*",
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
            "--setting-sources",
            "",
            "--disable-slash-commands",
            "--no-chrome",
            "--no-session-persistence",
            "--max-turns",
            "1",
            "--system-prompt",
            system_prompt,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let result = (|| {
        let mut child = cmd
            .spawn()
            .map_err(|_| "Claude Code를 실행하지 못했어요".to_string())?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        let payload = input.as_bytes().to_vec();
        let writer = std::thread::spawn(move || {
            let _ = stdin.write_all(&payload);
        });
        let mut stdout = child.stdout.take().expect("piped stdout");
        let reader = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = (&mut stdout).take(MAX_OUTPUT as u64).read_to_end(&mut buf);
            buf
        });
        let started = Instant::now();
        let status = loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|_| "Claude Code 상태를 확인하지 못했어요")?
            {
                break status;
            }
            if cancel.load(Ordering::Relaxed) || started.elapsed() > TIMEOUT {
                let _ = child.kill();
                let _ = child.wait();
                let _ = writer.join();
                let _ = reader.join();
                return Err(if cancel.load(Ordering::Relaxed) {
                    "취소했어요".to_string()
                } else {
                    "Claude Code 응답 시간이 초과됐어요".to_string()
                });
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let _ = writer.join();
        let out = reader.join().unwrap_or_default();
        let envelope: CliEnvelope = serde_json::from_slice(&out).map_err(|_| {
            if status.success() {
                "Claude Code 응답을 해석하지 못했어요".to_string()
            } else {
                "Claude Code가 실패했어요. 터미널에서 `claude`로 로그인했는지 확인해 주세요"
                    .to_string()
            }
        })?;
        if envelope.is_error || !status.success() {
            return Err(
                "Claude Code가 실패했어요. 로그인 상태나 사용량 한도를 확인해 주세요".into(),
            );
        }
        Ok(envelope.result)
    })();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

/// Translates a batch. Units that come back misaligned are retried one at a time.
pub fn translate_batch(
    claude: &Path,
    title: &str,
    units: &[Unit],
    cancel: &AtomicBool,
) -> Result<Vec<Unit>, String> {
    let call = |units: &[Unit]| -> Result<HashMap<u32, Unit>, String> {
        let input = serde_json::to_string(&Request {
            paper: title,
            units,
        })
        .unwrap();
        let text = run_claude(claude, &input, cancel)?;
        let reply: Reply = extract_json(&text)
            .and_then(|j| serde_json::from_str(j).ok())
            .ok_or_else(|| "번역 결과 형식이 올바르지 않아요".to_string())?;
        Ok(reply.units.into_iter().map(|u| (u.id, u)).collect())
    };
    let mut got = call(units)?;
    let mut out = Vec::with_capacity(units.len());
    for src in units {
        let ko = match got.remove(&src.id) {
            Some(ko) if valid(src, &ko) => ko,
            _ => {
                let mut single = call(std::slice::from_ref(src)).unwrap_or_default();
                match single.remove(&src.id) {
                    Some(ko) if ko.sentences.len() == src.sentences.len() => ko,
                    // Keep the reading flow even if alignment failed twice: show the text unsplit.
                    Some(ko) => Unit {
                        id: src.id,
                        sentences: aligned_fallback(src, ko.sentences),
                    },
                    None => continue,
                }
            }
        };
        out.push(ko);
    }
    Ok(out)
}

fn aligned_fallback(src: &Unit, ko: Vec<String>) -> Vec<String> {
    let mut out = vec![String::new(); src.sentences.len()];
    if let Some(first) = out.first_mut() {
        *first = ko.join(" ");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(id: u32, sentences: &[&str]) -> Unit {
        Unit {
            id,
            sentences: sentences.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn batches_respect_limits_and_order() {
        let units: Vec<Unit> = (0..100).map(|i| unit(i, &["a sentence."; 3])).collect();
        let b = batches(&units);
        assert!(
            b.iter()
                .all(|b| b.iter().map(|u| u.sentences.len()).sum::<usize>() <= BATCH_SENTENCES)
        );
        let ids: Vec<u32> = b.iter().flatten().map(|u| u.id).collect();
        assert_eq!(ids, (0..100).collect::<Vec<_>>());
    }

    #[test]
    fn validation_requires_count_and_placeholders() {
        let src = unit(1, &["We use ⟦M3⟧ and ⟦M4⟧.", "Done."]);
        assert!(valid(&src, &unit(1, &["⟦M4⟧와 ⟦M3⟧을 사용한다.", "끝."])));
        assert!(!valid(&src, &unit(1, &["⟦M3⟧을 사용한다.", "끝."])));
        assert!(!valid(&src, &unit(1, &["⟦M3⟧ ⟦M4⟧ 사용. 끝."])));
    }

    #[test]
    fn extracts_json_from_fenced_reply() {
        assert_eq!(
            extract_json("```json\n{\"units\":[]}\n```"),
            Some("{\"units\":[]}")
        );
    }
}
