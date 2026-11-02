pub mod embedding;
pub mod ollama;
pub mod openai;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTool {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolCall {
    pub id: String,
    pub name: String,
    /// Raw JSON arguments emitted by the model.
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub tools: Vec<ChatTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub content: String,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    #[serde(default)]
    pub tool_calls: Vec<ChatToolCall>,
}

/// One delta emitted by a streaming provider. `delta` is the incremental text
/// since the previous chunk (may be empty for finish markers). `done` is true
/// only on the terminal chunk; `finish_reason` is populated on that final
/// chunk and reflects the provider-side reason (`stop`, `length`, …).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChunk {
    pub delta: String,
    #[serde(default)]
    pub finish_reason: Option<String>,
    pub done: bool,
    #[serde(default)]
    pub prompt_tokens: Option<u64>,
    #[serde(default)]
    pub completion_tokens: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("missing api key for this provider")]
    MissingApiKey,
    #[error("http error: {0}")]
    Http(String),
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    #[error("provider error: {status} {body}")]
    ProviderStatus { status: u16, body: String },
    #[error("stream cancelled")]
    Cancelled,
}

impl From<reqwest::Error> for ProviderError {
    fn from(value: reqwest::Error) -> Self {
        ProviderError::Http(value.to_string())
    }
}

#[async_trait::async_trait]
pub trait AiProvider: Send + Sync {
    fn type_id(&self) -> &'static str;
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, ProviderError>;

    /// Stream chat completion deltas into `sink`. Returning `Ok(())` means the
    /// provider finished cleanly; returning `Err` means the stream aborted.
    /// Implementations must close the channel before returning.
    async fn chat_stream(
        &self,
        request: ChatRequest,
        sink: mpsc::Sender<ChatChunk>,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<(), ProviderError>;
}

pub mod cancel {
    use tokio_util::sync::CancellationToken;
    pub fn new() -> CancellationToken {
        CancellationToken::new()
    }
}

/// Append a raw transport chunk to `pending` and decode only complete
/// newline-terminated lines into `out`.
///
/// `reqwest::Response::bytes_stream` yields arbitrary TCP-sized byte slices, so
/// decoding each slice with `String::from_utf8_lossy` corrupts any multi-byte
/// character split across two reads. A UTF-8 code point can never contain
/// `\n`, so waiting for the line terminator guarantees the decoded bytes end on
/// a character boundary. Leftover bytes stay buffered for the next chunk.
pub(crate) fn decode_complete_lines(pending: &mut Vec<u8>, chunk: &[u8], out: &mut String) {
    pending.extend_from_slice(chunk);
    while let Some(pos) = pending.iter().position(|byte| *byte == b'\n') {
        let line: Vec<u8> = pending.drain(..=pos).collect();
        match std::str::from_utf8(&line) {
            Ok(text) => out.push_str(text),
            Err(_) => out.push_str(&String::from_utf8_lossy(&line)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_complete_lines, ChatRequest, ChatResponse};

    #[test]
    fn chat_wire_types_use_camel_case() {
        let request: ChatRequest =
            serde_json::from_str(r#"{"messages":[],"maxTokens":12}"#).expect("request");
        assert_eq!(request.max_tokens, Some(12));

        let response = ChatResponse {
            content: "hello".into(),
            prompt_tokens: Some(7),
            completion_tokens: Some(3),
            tool_calls: Vec::new(),
        };
        let value = serde_json::to_value(&response).expect("response");
        assert_eq!(value["promptTokens"], 7);
        assert_eq!(value["completionTokens"], 3);
        assert!(value.get("prompt_tokens").is_none());
    }

    #[test]
    fn decodes_utf8_split_across_chunks() {
        let text = "data: 中文\n".as_bytes();
        // Split inside the three-byte `中` code point.
        let split = 7;
        let mut pending = Vec::new();
        let mut out = String::new();
        decode_complete_lines(&mut pending, &text[..split], &mut out);
        assert!(out.is_empty());
        // The whole unfinished line stays buffered until its newline arrives.
        assert_eq!(pending.len(), split);
        assert!(std::str::from_utf8(&pending).is_err());
        decode_complete_lines(&mut pending, &text[split..], &mut out);
        assert_eq!(out, "data: 中文\n");
        assert!(!out.contains('\u{FFFD}'));
    }

    #[test]
    fn keeps_partial_line_buffered() {
        let mut pending = Vec::new();
        let mut out = String::new();
        decode_complete_lines(&mut pending, b"{\"a\":1}\n{\"b\":", &mut out);
        assert_eq!(out, "{\"a\":1}\n");
        assert_eq!(pending, b"{\"b\":");
    }
}
