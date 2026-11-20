use super::{catalog, Catalog, Selection};
use crate::{
    admission::profile_for_song,
    db::Database,
    error::{message, Result},
    verification::ModelVerifier,
};
use serde::Deserialize;
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ModelRemoval {
    File { file: String },
    Profile { selection: Selection },
}

impl ModelRemoval {
    fn files(&self, catalog: &Catalog, root: &Path) -> Result<Vec<String>> {
        match self {
            Self::File { file } => {
                if catalog
                    .profiles
                    .iter()
                    .filter(|profile| profile.files.len() > 1 && profile.files.contains(file))
                    .count()
                    == 1
                {
                    return Err(message("model_remove_use_profile"));
                }
                if *file != crate::titles::manifest().model.file
                    && !catalog.models.iter().any(|asset| &asset.file == file)
                {
                    return Err(message("Unknown model"));
                }
                Ok(vec![file.clone()])
            }
            Self::Profile { selection } => {
                let profile = catalog
                    .profile(selection)
                    .ok_or_else(|| message("Unknown model profile"))?;
                let assets = catalog.required(selection)?;
                Ok(assets
                    .into_iter()
                    .filter(|asset| {
                        !catalog.profiles.iter().any(|other| {
                            other.selection != profile.selection
                                && other.files.contains(&asset.file)
                                && other.files.iter().any(|file| {
                                    !profile.files.contains(file) && root.join(file).is_file()
                                })
                        })
                    })
                    .map(|asset| asset.file)
                    .collect())
            }
        }
    }
}

/// The caller holds the Models permit across validation and deletion.
pub fn remove_installed(
    db: &Database,
    target: &ModelRemoval,
    stop_engine: impl FnOnce(),
) -> Result<()> {
    let settings = db.settings()?;
    let catalog = catalog();
    let models_dir = Path::new(&settings.models_dir);
    let files = target.files(&catalog, models_dir)?;
    let uses_files = |selection: &Selection| -> Result<bool> {
        Ok(catalog
            .required(selection)?
            .iter()
            .any(|asset| files.contains(&asset.file)))
    };
    if matches!(target, ModelRemoval::Profile { selection } if *selection == Selection::from_settings(&settings))
        || uses_files(&Selection::from_settings(&settings))?
    {
        return Err(message("model_remove_active"));
    }
    for params in db.pending_song_params()? {
        let selection = profile_for_song(&settings, &params)?;
        if uses_files(&selection)? {
            return Err(message("model_remove_queued"));
        }
    }
    let root = match models_dir.canonicalize() {
        Ok(root) => root,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let mut paths = Vec::new();
    for file in files {
        for name in [format!("{file}.part"), file] {
            if let Some(path) = removable_file(&root, &name)? {
                paths.push(path);
            }
        }
    }
    if paths.is_empty() {
        return Ok(());
    }
    stop_engine();
    ModelVerifier::open(&db.root).forget(&paths)?;
    for path in paths {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn removable_file(root: &Path, name: &str) -> Result<Option<PathBuf>> {
    let path = root.join(name);
    let metadata = match path.symlink_metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let parent = path.parent().ok_or_else(|| message("Invalid model path"))?;
    if parent.canonicalize()? != parent || !(metadata.is_file() || metadata.is_symlink()) {
        return Err(message("model_remove_unsafe"));
    }
    Ok(Some(path))
}
