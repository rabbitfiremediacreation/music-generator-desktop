use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub struct ImportRequest {
    pub root: String,
    pub songs_source: Option<String>,
    pub songs_dir: String,
    #[serde(default)]
    pub allow_partial: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct MissingAudio {
    pub id: String,
    pub title: String,
    pub file: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ImportIssue {
    pub code: String,
    pub path: String,
}

#[derive(Default, Debug, Serialize)]
pub struct ImportPreview {
    pub songs: usize,
    pub folders: usize,
    pub files: usize,
    pub bytes: u64,
    pub free_bytes: Option<u64>,
    pub songs_source: String,
    pub missing: Vec<MissingAudio>,
    pub issues: Vec<ImportIssue>,
    pub can_import: bool,
}

impl ImportPreview {
    pub(super) fn issue(&mut self, code: &str, path: impl AsRef<std::path::Path>) {
        self.issues.push(ImportIssue {
            code: code.into(),
            path: path.as_ref().to_string_lossy().into(),
        });
    }
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub songs: usize,
    pub files: usize,
    pub songs_dir: String,
    pub missing: Vec<MissingAudio>,
}

#[derive(Clone, Serialize)]
pub struct ImportProgress {
    pub phase: &'static str,
    pub copied_bytes: u64,
    pub total_bytes: u64,
    pub files: usize,
    pub total_files: usize,
}
