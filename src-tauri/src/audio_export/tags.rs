use crate::error::{message, Result};
use lofty::{
    config::{ParseOptions, WriteOptions},
    file::TaggedFileExt,
    probe::Probe,
    tag::{Accessor, Tag, TagExt, TagType},
};
use std::{
    fs::OpenOptions,
    io::{BufReader, Seek},
    path::Path,
};

pub(crate) fn supports(extension: &str) -> bool {
    tag_type(extension).is_some()
}

fn tag_type(extension: &str) -> Option<TagType> {
    match extension {
        "wav" => Some(TagType::RiffInfo),
        "mp3" => Some(TagType::Id3v2),
        "ogg" | "opus" => Some(TagType::VorbisComments),
        _ => None,
    }
}

/// Update a staged audio file so failures cannot publish a partially written tag.
pub(crate) fn write(path: &Path, extension: &str, provenance: &str) -> Result<()> {
    let Some(kind) = tag_type(extension) else {
        return Ok(());
    };
    let write = || -> lofty::error::Result<()> {
        let mut file = OpenOptions::new().read(true).write(true).open(path)?;
        let parsed = Probe::new(BufReader::new(&mut file))
            .guess_file_type()?
            .options(ParseOptions::new().read_properties(false))
            .read()?;
        let mut tag = parsed.tag(kind).cloned().unwrap_or_else(|| Tag::new(kind));
        let previous = tag.comment().unwrap_or_default();
        if previous.ends_with(provenance) {
            return Ok(());
        }
        let comment = if previous.is_empty() {
            provenance.to_owned()
        } else {
            format!("{previous}\n\n{provenance}")
        };
        tag.set_comment(comment);
        file.rewind()?;
        tag.save_to(&mut file, WriteOptions::default())
    };
    write().map_err(|error| message(format!("Unable to write audio provenance: {error}")))
}
