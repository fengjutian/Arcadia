fn main() {
    // The application artwork is configured in tauri.conf.json. Generating a
    // placeholder here would overwrite the title-bar and taskbar icon on every build.
    tauri_build::build();

    // `browser_capabilities` reports the Tauri runtime version for diagnostics.
    // `CARGO_PKG_VERSION` is *this crate's* version, not a dependency's, so
    // resolve Tauri's version from the lockfile instead. A build without a
    // readable lockfile just leaves the probe as `None` rather than failing.
    println!("cargo:rerun-if-changed=Cargo.lock");
    if let Some(version) = dependency_version("tauri") {
        println!("cargo:rustc-env=ARCADIA_TAURI_VERSION={version}");
    }
}

/// Reads the resolved version of one package out of `Cargo.lock`.
///
/// `Cargo.lock` is a sequence of `[[package]]` blocks; the `version` line sits
/// directly below `name` inside the matching block. Scanning blocks instead of
/// regexing the whole file keeps a `name = "tauri"` string inside some other
/// package's metadata from being mistaken for the package itself.
fn dependency_version(name: &str) -> Option<String> {
    let lock = std::fs::read_to_string("Cargo.lock").ok()?;
    let needle = format!("name = \"{name}\"");
    let mut lines = lock.lines();
    while let Some(line) = lines.next() {
        if line.trim() != needle {
            continue;
        }
        for line in lines.by_ref() {
            let field = line.trim();
            if let Some(rest) = field.strip_prefix("version = ") {
                return Some(rest.trim_matches('"').to_string());
            }
            // Left the block without finding a version: not the shape we expect.
            if field.starts_with("[[") {
                break;
            }
        }
    }
    None
}
