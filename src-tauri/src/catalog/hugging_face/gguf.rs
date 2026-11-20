//! Inspect the bounded GGUF prefix before accepting an uncurated weight file.
struct Header<'a>(&'a [u8]);

impl<'a> Header<'a> {
    fn take(&mut self, bytes: usize) -> Option<&'a [u8]> {
        let (prefix, rest) = self.0.split_at_checked(bytes)?;
        self.0 = rest;
        Some(prefix)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn string(&mut self) -> Option<&'a [u8]> {
        let size = usize::try_from(self.u64()?).ok()?;
        self.take(size)
    }

    fn skip(&mut self, kind: u32, count: usize) -> Option<()> {
        let width: usize = match kind {
            0 | 1 | 7 => 1,
            2 | 3 => 2,
            4..=6 => 4,
            10..=12 => 8,
            8 => {
                for _ in 0..count {
                    self.string()?;
                }
                return Some(());
            }
            _ => return None,
        };
        self.take(width.checked_mul(count)?)?;
        Some(())
    }
}

pub(super) fn matches(
    bytes: &[u8],
    architecture: &str,
    family: Option<&str>,
    precision: &str,
    model_name: Option<&str>,
) -> bool {
    let mut header = Header(bytes);
    let mut has_architecture = false;
    let mut has_family = family.is_none();
    let mut has_name = model_name.is_none();
    if header.take(4) != Some(b"GGUF") || !matches!(header.u32(), Some(2 | 3)) {
        return false;
    }
    let Some((tensors, entries)) = header.u64().zip(header.u64()) else {
        return false;
    };
    if tensors == 0 {
        return false;
    }
    for _ in 0..entries {
        match header.string().zip(header.u32()) {
            Some((b"general.architecture", 8)) => {
                if header.string() != Some(architecture.as_bytes()) {
                    return false;
                }
                has_architecture = true;
            }
            Some((b"audiocpp.model_spec.family", 8)) if family.is_some() => {
                if header.string() != family.map(str::as_bytes) {
                    return false;
                }
                has_family = true;
            }
            Some((b"general.name", 8)) if model_name.is_some() => {
                if header.string() != model_name.map(str::as_bytes) {
                    return false;
                }
                has_name = true;
            }
            Some((b"general.file_type", 8)) => {
                if header.string() != Some(precision.as_bytes()) {
                    return false;
                }
            }
            Some((b"general.file_type", 4)) => {
                let expected = match precision {
                    "F16" => 1,
                    "Q8_0" => 7,
                    "Q4_K_M" => 15,
                    "Q5_K_M" => 17,
                    "Q6_K" => 18,
                    "BF16" => 32,
                    _ => return false,
                };
                if header.u32() != Some(expected) {
                    return false;
                }
            }
            Some((_, 9)) => {
                let Some((kind, count)) = header.u32().zip(header.u64()) else {
                    break;
                };
                // Large embedded tokenizers and sidecars can extend beyond this prefix.
                if usize::try_from(count)
                    .ok()
                    .and_then(|count| header.skip(kind, count))
                    .is_none()
                {
                    break;
                }
            }
            Some((_, kind)) if header.skip(kind, 1).is_some() => {}
            _ => break,
        }
    }
    has_architecture && has_family && has_name
}

#[cfg(test)]
mod tests {
    use super::matches;

    fn string(out: &mut Vec<u8>, value: &str) {
        out.extend((value.len() as u64).to_le_bytes());
        out.extend(value.as_bytes());
    }

    #[test]
    fn rejects_wrong_architecture_package_and_quantization() {
        let mut header = b"GGUF".to_vec();
        header.extend(3_u32.to_le_bytes());
        header.extend(1_u64.to_le_bytes());
        header.extend(4_u64.to_le_bytes());
        for (key, value) in [
            ("general.architecture", "audiocpp"),
            ("audiocpp.model_spec.family", "stable_audio"),
            ("general.file_type", "Q8_0"),
            ("general.name", "Stable Audio 3"),
        ] {
            string(&mut header, key);
            header.extend(8_u32.to_le_bytes());
            string(&mut header, value);
        }
        assert!(matches(
            &header,
            "audiocpp",
            Some("stable_audio"),
            "Q8_0",
            Some("Stable Audio 3")
        ));
        assert!(!matches(
            &header,
            "audiocpp",
            Some("stable_audio"),
            "Q8_0",
            Some("Wrong checkpoint")
        ));
        assert!(!matches(
            &header,
            "audiocpp",
            Some("stable_audio"),
            "F16",
            None
        ));
        assert!(!matches(
            &header,
            "audiocpp",
            Some("mulacover"),
            "Q8_0",
            None
        ));
        assert!(!matches(&header, "acestep-dit", None, "Q8_0", None));
        assert!(!matches(
            b"GGUF",
            "audiocpp",
            Some("stable_audio"),
            "Q8_0",
            None
        ));
    }
}
