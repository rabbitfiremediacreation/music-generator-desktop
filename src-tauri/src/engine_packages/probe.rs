use super::{
    install::{activate, unpack},
    release,
};
use crate::error::{message, Result};
use std::{
    fs,
    io::{self, Read, Seek},
    path::Path,
};
use tokio_util::sync::CancellationToken;

/// Exercise the same installer with the release archives supplied over a smoke-test stream.
pub(crate) fn install_probe_archives(data: &Path) -> Result<()> {
    fs::create_dir_all(data)?;
    let mut input = io::stdin().lock();
    let mut paths = std::collections::BTreeMap::new();
    for package in &release().packages {
        fs::create_dir_all(package.root(data))?;
        let mut archive = tempfile::tempfile_in(data)?;
        io::copy(&mut (&mut input).take(package.bytes), &mut archive)?;
        archive.rewind()?;
        let staging = unpack(
            package,
            &package.root(data),
            archive,
            &CancellationToken::new(),
        )?;
        activate(package, data, staging)?;
        let (_, installed) = package
            .installed(data)
            .ok_or_else(|| message("engine_package_invalid"))?;
        paths.insert(&package.id, installed.join("engine"));
    }
    println!("{}", serde_json::to_string(&paths)?);
    Ok(())
}

pub fn cli() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--engine-package-probe")) {
        return None;
    }
    let result = args
        .next()
        .ok_or_else(|| message("Missing engine package probe folder"))
        .and_then(|data| install_probe_archives(Path::new(&data)));
    Some(match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Engine package probe: {error}");
            1
        }
    })
}
