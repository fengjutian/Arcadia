fn main() {
    // The application artwork is configured in tauri.conf.json. Generating a
    // placeholder here would overwrite the title-bar and taskbar icon on every build.
    tauri_build::build();

    embed_common_controls_v6_in_tests();
}

/// Windows test binaries need an explicit comctl32 v6 manifest.
///
/// `tauri` enables `muda/common-controls-v6`, so the dependency graph imports
/// `comctl32!TaskDialogIndirect`. That export lives only in the side-by-side
/// comctl32 v6 assembly, reachable solely through an application manifest that
/// declares `Microsoft.Windows.Common-Controls`.
///
/// The application binary gets that manifest from `tauri_build::build()`, but
/// Cargo's test harness binaries do not: the loader binds the legacy comctl32
/// v5, cannot resolve the import, and the process dies with
/// STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139) before any test runs.
///
/// `rustc-link-arg-tests` scopes the extra manifest input to test targets only,
/// so the shipped application manifest is untouched.
#[cfg(windows)]
fn embed_common_controls_v6_in_tests() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test-manifest.xml");

    if !manifest.is_file() {
        println!(
            "cargo:warning=test-manifest.xml not found at {}; Rust tests will fail to start on Windows",
            manifest.display()
        );
        return;
    }

    println!("cargo:warning=TESTPROBE-BUILDSRAN");
    // link.exe rejects unquoted paths containing spaces, so quote only when needed.
    let rendered = manifest.display().to_string();
    let manifest_input = if rendered.contains(' ') {
        format!("/MANIFESTINPUT:\"{rendered}\"")
    } else {
        format!("/MANIFESTINPUT:{rendered}")
    };

    // rustc passes `/MANIFEST:NO` on MSVC (it owns manifest generation itself and
    // emits none for test harnesses), which silently disables `/MANIFESTINPUT`.
    // User link args are appended after rustc's own, so re-enabling embedding here
    // wins and makes the input below take effect.
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-tests={manifest_input}");
    println!("cargo:rerun-if-changed={}", manifest.display());
}

#[cfg(not(windows))]
fn embed_common_controls_v6_in_tests() {}
