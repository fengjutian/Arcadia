//! Production Agent runtime.
//!
//! Batch 1 of the Agent epic shipped only the state-machine and risk enums.
//! Batch 8 supplies:
//! - `runtime` — supervisor + state transitions + recovery
//! - `approval` — argument-hash-bound approvals
//! - `budget` — step / token / cost enforcement
//! - `checkpoint` — JSON snapshot save/restore
//! - `tools` — `AgentTool` trait + registry
//! - `commands` — legacy Tauri surface (`agent_start` / `pause` / …), currently
//!   **not registered**
//!
//! Spec C2 / C6 / C7 / C11 / C12 are addressed here. The full LLM driver
//! stays on the React side via the existing `ai_chat` Tauri command; this
//! runtime owns the *state* and *audit*, the LLM owns the *generation*.
//!
//! Status: the backend supervisor is **not started** (see `lib.rs`). The
//! product research agent persists runs through `local_record_agent_run` and
//! drives MCP tools from the frontend. These modules are kept for a future
//! backend-driven agent; do not assume they execute in production.

pub mod approval;
pub mod budget;
pub mod checkpoint;
pub mod commands;
pub mod mcp_security;
pub mod runtime;
pub mod security;
pub mod security_commands;
pub mod supervisor;
pub mod tools;
pub mod types;

pub use types::{AgentStatus, ApprovalStatus, StepStatus, ToolRisk};

pub use runtime::{create_run, transition, AgentRunMeta};
pub use supervisor::{recover_expired_runs, AgentSupervisor};
