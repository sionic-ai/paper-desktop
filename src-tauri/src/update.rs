//! In-app update: compares this build with the latest GitHub release and reruns the
//! one-line installer, detached, into the folder this app was launched from.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

const REPO: &str = "sionic-ai/paper-desktop";
const TIMEOUT: Duration = Duration::from_secs(8);
/// The installer script. The app path reaches it only through `NANRAN_DIR`, so the command
/// line never contains `<DIR>/Nanran.app/Contents/MacOS/nanran` and the installer's
/// `pkill -f` on that path cannot match the installer itself.
const INSTALL: &str =
    "curl -fsSL https://raw.githubusercontent.com/sionic-ai/paper-desktop/main/install.sh | bash";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub available: bool,
}

fn client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!(
            "nanran/",
            env!("CARGO_PKG_VERSION"),
            " (paper reader)"
        ))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(TIMEOUT)
        .timeout(TIMEOUT)
        .build()
        .ok()
}

/// `.../releases/tag/v1.2.3` → `1.2.3`.
fn tag_from_location(location: &str) -> Option<String> {
    let (_, tag) = location.rsplit_once("/releases/tag/")?;
    let tag = tag.split(['?', '#', '/']).next()?.trim();
    let tag = tag.strip_prefix('v').unwrap_or(tag);
    (!tag.is_empty()).then(|| tag.to_string())
}

/// `1.2.3`, `1.2`, `1.2.3-beta.1` → numeric (major, minor, patch). Pre-release and build
/// suffixes are ignored.
fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let core = v.trim().trim_start_matches('v').split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let major = parts.next()??;
    let minor = parts.next().unwrap_or(Some(0))?;
    let patch = parts.next().unwrap_or(Some(0))?;
    parts.next().is_none().then_some((major, minor, patch))
}

/// True only when `latest` is strictly newer than `current`.
pub fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

fn latest_tag() -> Option<String> {
    let http = client()?;
    let from_redirect = http
        .get(format!("https://github.com/{REPO}/releases/latest"))
        .send()
        .ok()
        .and_then(|r| {
            r.headers()
                .get(reqwest::header::LOCATION)?
                .to_str()
                .ok()
                .and_then(tag_from_location)
        });
    if from_redirect.is_some() {
        return from_redirect;
    }
    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
    }
    let release: Release = http
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases/latest"
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())?;
    let tag = release.tag_name.trim();
    let tag = tag.strip_prefix('v').unwrap_or(tag);
    (!tag.is_empty()).then(|| tag.to_string())
}

/// Never fails: without network the answer is "no update known".
pub fn check() -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let latest = latest_tag();
    let available = latest.as_deref().is_some_and(|l| is_newer(l, &current));
    UpdateInfo {
        current,
        latest,
        available,
    }
}

/// `<DIR>/Nanran.app/Contents/MacOS/nanran` → `<DIR>`. `None` outside an `.app` bundle.
pub fn install_dir_from_exe(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let app = contents.parent()?;
    let is_app = app
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("app"));
    (macos.file_name()? == "MacOS" && contents.file_name()? == "Contents" && is_app)
        .then(|| app.parent().map(Path::to_path_buf))
        .flatten()
        .filter(|d| !d.as_os_str().is_empty())
}

/// Starts the installer in its own process group so it outlives this app, which the
/// installer quits, replaces and reopens. Output is appended to `log`.
pub fn install(exe: &Path, log: &Path) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    let dir = install_dir_from_exe(exe)
        .ok_or_else(|| "개발 빌드에서는 앱 안에서 업데이트할 수 없어요".to_string())?;
    let out = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|_| "업데이트 기록 파일을 만들지 못했어요".to_string())?;
    let err = out
        .try_clone()
        .map_err(|_| "업데이트 기록 파일을 열지 못했어요".to_string())?;
    let mut child = Command::new("/bin/bash")
        .arg("-c")
        .arg(INSTALL)
        .env("NANRAN_DIR", &dir)
        .env("NANRAN_NO_CLAUDE", "1")
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .process_group(0)
        .spawn()
        .map_err(|_| "업데이트를 시작하지 못했어요".to_string())?;
    // Reap the child if the app is still running when it ends.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tag_from_redirect() {
        assert_eq!(
            tag_from_location("https://github.com/sionic-ai/paper-desktop/releases/tag/v0.1.2")
                .as_deref(),
            Some("0.1.2")
        );
        assert_eq!(
            tag_from_location("/sionic-ai/paper-desktop/releases/tag/0.2.0?x=1").as_deref(),
            Some("0.2.0")
        );
        assert_eq!(
            tag_from_location("https://github.com/sionic-ai/paper-desktop/releases"),
            None
        );
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(is_newer("1.0", "0.9.9"));
        assert!(!is_newer("0.1.2", "0.1.2"));
        assert!(!is_newer("0.1.1", "0.1.2"));
        assert!(!is_newer("0.1.2-beta", "0.1.2"));
        assert!(is_newer("v0.2.0-rc.1", "0.1.2"));
        assert!(!is_newer("garbage", "0.1.2"));
        assert!(!is_newer("1.2.3.4", "0.1.2"));
    }

    #[test]
    fn install_dir_needs_app_bundle() {
        assert_eq!(
            install_dir_from_exe(Path::new("/Applications/Nanran.app/Contents/MacOS/nanran")),
            Some(PathBuf::from("/Applications"))
        );
        assert_eq!(
            install_dir_from_exe(Path::new(
                "/Users/me/Applications/Nanran.app/Contents/MacOS/nanran"
            )),
            Some(PathBuf::from("/Users/me/Applications"))
        );
        assert_eq!(
            install_dir_from_exe(Path::new("/x/nanran/src-tauri/target/debug/nanran")),
            None
        );
        assert_eq!(
            install_dir_from_exe(Path::new("/Applications/Nanran/Contents/MacOS/nanran")),
            None
        );
        assert_eq!(
            install_dir_from_exe(Path::new("Nanran.app/Contents/MacOS/nanran")),
            None
        );
    }

    #[test]
    fn dev_build_cannot_self_update() {
        let err = install(
            Path::new("/x/target/debug/nanran"),
            &std::env::temp_dir().join("nanran-update-test.log"),
        )
        .unwrap_err();
        assert_eq!(err, "개발 빌드에서는 앱 안에서 업데이트할 수 없어요");
    }

    #[test]
    fn installer_command_has_no_app_path() {
        assert!(!INSTALL.contains("Nanran.app"));
        assert!(!INSTALL.contains("MacOS"));
    }
}
