//! Agent security utilities.
//!
//! The backend-driven agent runtime (`runtime` / `supervisor` / `tools` /
//! `approval` / `budget` / `checkpoint`) was removed: the product research
//! agent runs on the React side and persists runs through `local_store`.
//! Only the shared security primitives remain:
//!
//! - `mcp_security` — MCP URL validation helpers used by `mcp.rs`
//! - `security` — prompt-injection detection
//! - `security_commands` — Tauri commands exposing those helpers

pub mod mcp_security;
pub mod security;
pub mod security_commands;
