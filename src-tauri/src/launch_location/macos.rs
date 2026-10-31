use super::{classify, Mount};
use std::{
    ffi::{c_char, c_void, CStr, CString},
    path::PathBuf,
    ptr,
};

type Cf = *const c_void;

#[link(name = "DiskArbitration", kind = "framework")]
extern "C" {
    fn DASessionCreate(allocator: Cf) -> Cf;
    fn DADiskCreateFromBSDName(allocator: Cf, session: Cf, name: *const c_char) -> Cf;
    fn DADiskCopyDescription(disk: Cf) -> Cf;
    static kDADiskDescriptionDeviceModelKey: Cf;
    static kDADiskDescriptionDeviceProtocolKey: Cf;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: Cf);
    fn CFDictionaryGetValue(dictionary: Cf, key: Cf) -> Cf;
    fn CFGetTypeID(value: Cf) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFStringGetCString(value: Cf, buffer: *mut c_char, size: isize, encoding: u32) -> bool;
}

struct OwnedCf(Cf);
impl OwnedCf {
    fn new(value: Cf) -> Option<Self> {
        (!value.is_null()).then(|| Self(value))
    }
}
impl Drop for OwnedCf {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

/// Read device identity through public Disk Arbitration APIs without invoking a child process.
fn is_disk_image(device: &str) -> Option<bool> {
    let device = CString::new(device).ok()?;
    unsafe {
        let session = OwnedCf::new(DASessionCreate(ptr::null()))?;
        let disk = OwnedCf::new(DADiskCreateFromBSDName(
            ptr::null(),
            session.0,
            device.as_ptr(),
        ))?;
        let description = OwnedCf::new(DADiskCopyDescription(disk.0))?;
        let model = string_value(description.0, kDADiskDescriptionDeviceModelKey);
        let protocol = string_value(description.0, kDADiskDescriptionDeviceProtocolKey);
        match (model.as_deref(), protocol.as_deref()) {
            (Some("Disk Image"), _) | (_, Some("Disk Image")) => Some(true),
            (Some(_), Some(_)) => Some(false),
            _ => None,
        }
    }
}

unsafe fn string_value(dictionary: Cf, key: Cf) -> Option<String> {
    let value = CFDictionaryGetValue(dictionary, key);
    if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
        return None;
    }
    let mut buffer = [0 as c_char; 256];
    if !CFStringGetCString(
        value,
        buffer.as_mut_ptr(),
        buffer.len() as isize,
        0x08000100,
    ) {
        return None;
    }
    Some(
        CStr::from_ptr(buffer.as_ptr())
            .to_string_lossy()
            .into_owned(),
    )
}

/// Snapshot mounts into owned memory; getmntinfo's shared buffer is unsafe across startup threads.
fn mounts() -> Option<Vec<Mount>> {
    unsafe {
        let count = libc::getfsstat(ptr::null_mut(), 0, libc::MNT_NOWAIT);
        if count <= 0 {
            return None;
        }
        let mut values = vec![std::mem::zeroed::<libc::statfs>(); count as usize + 16];
        let size = (values.len() * std::mem::size_of::<libc::statfs>())
            .try_into()
            .ok()?;
        let count = libc::getfsstat(values.as_mut_ptr(), size, libc::MNT_NOWAIT);
        if count <= 0 {
            return None;
        }
        Some(
            values
                .iter()
                .take(count as usize)
                .map(|value| Mount {
                    path: PathBuf::from(
                        CStr::from_ptr(value.f_mntonname.as_ptr())
                            .to_string_lossy()
                            .as_ref(),
                    ),
                    source: CStr::from_ptr(value.f_mntfromname.as_ptr())
                        .to_string_lossy()
                        .into_owned(),
                    filesystem: CStr::from_ptr(value.f_fstypename.as_ptr())
                        .to_string_lossy()
                        .into_owned(),
                    read_only: value.f_flags & libc::MNT_RDONLY as u32 != 0,
                })
                .collect(),
        )
    }
}

pub(super) fn inspect() -> Option<bool> {
    let executable = std::env::current_exe().ok()?.canonicalize().ok()?;
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    // Raw development binaries are not application bundles and must keep their normal startup.
    if macos.file_name()? != "MacOS"
        || contents.file_name()? != "Contents"
        || bundle
            .extension()
            .is_none_or(|extension| extension != "app")
    {
        return Some(false);
    }
    classify(bundle, &mounts()?, is_disk_image)
}

#[cfg(test)]
mod tests {
    #[test]
    fn unknown_device_has_no_disk_image_classification() {
        assert_eq!(
            super::is_disk_image("/dev/music-generator-nonexistent"),
            None
        );
    }
}
