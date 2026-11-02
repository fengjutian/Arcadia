fn main() {
    // CEF renderer/GPU/utility subprocesses re-execute this same binary with
    // `--type=...`. They must be handed to CEF before anything else runs.
    #[cfg(all(target_os = "windows", feature = "cef"))]
    if ai_knowledge_browser_lib::engine::cef::run_subprocess_if_needed() {
        return;
    }
    ai_knowledge_browser_lib::run();
}
