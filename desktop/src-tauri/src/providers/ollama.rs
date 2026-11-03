use super::{AiProvider, ChatChunk, ChatMessage, ChatRequest, ChatResponse, ChatToolCall, ProviderError};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub struct OllamaProvider {
    pub base_url: String,
    pub model: String,
    pub timeout: Duration,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OllamaTool>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct OllamaTool {
    #[serde(rename = "type")]
    kind: &'static str,
    function: OllamaFunction,
}

#[derive(Debug, Serialize)]
struct OllamaFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    #[serde(default)]
    message: Option<OllamaResponseMessage>,
}

#[derive(Debug, Deserialize)]
struct OllamaResponseMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<OllamaToolCall>,
}

#[derive(Debug, Deserialize)]
struct OllamaToolCall {
    #[serde(default)]
    function: Option<OllamaToolCallFunction>,
}

#[derive(Debug, Deserialize)]
struct OllamaToolCallFunction {
    #[serde(default)]
    name: String,
    #[serde(default)]
    arguments: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct OllamaStreamChunk {
    #[serde(default)]
    message: Option<OllamaResponseMessage>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    done_reason: Option<String>,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
}

#[async_trait]
impl AiProvider for OllamaProvider {
    fn type_id(&self) -> &'static str {
        "ollama"
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, ProviderError> {
        let client = reqwest::Client::builder().timeout(self.timeout).build()?;
        let messages: Vec<OllamaMessage> =
            request.messages.into_iter().map(message_to_wire).collect();
        let tools = request
            .tools
            .into_iter()
            .map(|tool| OllamaTool {
                kind: "function",
                function: OllamaFunction {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            })
            .collect();
        let body = OllamaRequest {
            model: self.model.clone(),
            messages,
            tools,
            stream: false,
        };
        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
        let response = client.post(url).json(&body).send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(ProviderError::ProviderStatus {
                status: status.as_u16(),
                body: sanitize_body(&text),
            });
        }
        let parsed: OllamaResponse = serde_json::from_str(&text).map_err(|error| {
            ProviderError::InvalidResponse(format!("{error}: {}", sanitize_body(&text)))
        })?;
        let mut content = String::new();
        let mut tool_calls = Vec::new();
        if let Some(message) = parsed.message {
            content = message.content.unwrap_or_default();
            for (index, call) in message.tool_calls.into_iter().enumerate() {
                if let Some(function) = call.function {
                    if !function.name.is_empty() {
                        tool_calls.push(ChatToolCall {
                            id: format!("ollama-{index}"),
                            name: function.name,
                            arguments: serde_json::to_string(&function.arguments)
                                .unwrap_or_else(|_| "{}".into()),
                        });
                    }
                }
            }
        }
        let content = content.trim().to_string();
        if content.is_empty() && tool_calls.is_empty() {
            return Err(ProviderError::InvalidResponse(
                "empty assistant content".into(),
            ));
        }
        Ok(ChatResponse {
            content,
            prompt_tokens: None,
            completion_tokens: None,
            tool_calls,
        })
    }

    async fn chat_stream(
        &self,
        request: ChatRequest,
        sink: mpsc::Sender<ChatChunk>,
        cancel: CancellationToken,
    ) -> Result<(), ProviderError> {
        let client = reqwest::Client::builder().timeout(self.timeout).build()?;
        let messages: Vec<OllamaMessage> =
            request.messages.into_iter().map(message_to_wire).collect();
        let body = OllamaRequest {
            model: self.model.clone(),
            messages,
            tools: Vec::new(),
            stream: true,
        };
        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
        let response = client.post(url).json(&body).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::ProviderStatus {
                status: status.as_u16(),
                body: sanitize_body(&body),
            });
        }
        let mut byte_stream = response.bytes_stream();
        let mut pending: Vec<u8> = Vec::new();
        let mut buffer = String::new();
        let mut prompt_tokens: Option<u64> = None;
        let mut completion_tokens: Option<u64> = None;

        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    return Err(ProviderError::Cancelled);
                }
                next = byte_stream.next() => {
                    let Some(item) = next else { break };
                    let chunk = match item {
                        Ok(bytes) => bytes,
                        Err(error) => return Err(ProviderError::Http(error.to_string())),
                    };
                    super::decode_complete_lines(&mut pending, &chunk, &mut buffer);
                    for chunk in parse_ndjson_chunk(&mut buffer, &mut prompt_tokens, &mut completion_tokens) {
                        if sink.send(ChatChunk {
                            delta: chunk.delta,
                            finish_reason: chunk.finish_reason,
                            done: chunk.done,
                            prompt_tokens: chunk.prompt_tokens,
                            completion_tokens: chunk.completion_tokens,
                        }).await.is_err() {
                            return Ok(());
                        }
                        if chunk.done {
                            return Ok(());
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

/// One delta extracted from Ollama's NDJSON stream. `delta` is the incremental
/// message.content; `done: true` means the server has signalled completion and
/// `prompt_tokens` / `completion_tokens` are populated.
#[derive(Debug, PartialEq, Eq)]
pub struct OllamaDelta {
    pub delta: String,
    pub finish_reason: Option<String>,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub done: bool,
}

/// Split a buffered chunk of Ollama NDJSON text into zero or more delta
/// records. Each non-empty line is parsed as a JSON object; unparseable lines
/// are skipped silently. Any incomplete trailing line stays in `buffer`.
pub fn parse_ndjson_chunk(
    buffer: &mut String,
    prompt_tokens: &mut Option<u64>,
    completion_tokens: &mut Option<u64>,
) -> Vec<OllamaDelta> {
    let mut out: Vec<OllamaDelta> = Vec::new();
    while let Some(idx) = buffer.find('\n') {
        let line: String = buffer.drain(..=idx).collect();
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed.is_empty() {
            continue;
        }
        let parsed: OllamaStreamChunk = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(count) = parsed.prompt_eval_count {
            *prompt_tokens = Some(count);
        }
        if let Some(count) = parsed.eval_count {
            *completion_tokens = Some(count);
        }
        let delta = parsed
            .message
            .as_ref()
            .and_then(|m| m.content.clone())
            .unwrap_or_default();
        out.push(OllamaDelta {
            delta,
            finish_reason: if parsed.done {
                parsed.done_reason.clone().or(Some("stop".into()))
            } else {
                None
            },
            prompt_tokens: if parsed.done { *prompt_tokens } else { None },
            completion_tokens: if parsed.done {
                *completion_tokens
            } else {
                None
            },
            done: parsed.done,
        });
    }
    out
}

fn message_to_wire(message: ChatMessage) -> OllamaMessage {
    OllamaMessage {
        role: message.role,
        content: message.content,
    }
}

fn sanitize_body(body: &str) -> String {
    body.chars().take(400).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ndjson_parses_increments_then_done_with_usage() {
        let mut buf = String::new();
        let mut pt = None;
        let mut ct = None;
        buf.push_str("{\"message\":{\"content\":\"Hel\"}}\n");
        buf.push_str("{\"message\":{\"content\":\"lo\"}}\n");
        buf.push_str("{\"message\":{\"content\":\" world\"},\"done\":true,\"prompt_eval_count\":4,\"eval_count\":2}\n");
        let out = parse_ndjson_chunk(&mut buf, &mut pt, &mut ct);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].delta, "Hel");
        assert!(!out[0].done);
        assert_eq!(out[1].delta, "lo");
        assert_eq!(out[2].delta, " world");
        assert!(out[2].done);
        assert_eq!(out[2].prompt_tokens, Some(4));
        assert_eq!(out[2].completion_tokens, Some(2));
    }

    #[test]
    fn ndjson_keeps_partial_line_in_buffer() {
        let mut buf = String::new();
        let mut pt = None;
        let mut ct = None;
        buf.push_str("{\"message\":{\"content\":\"ok\"}}\n{\"message\":{\"content\":\"par");
        let out = parse_ndjson_chunk(&mut buf, &mut pt, &mut ct);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].delta, "ok");
        assert!(buf.contains("par"));
    }

    #[tokio::test]
    async fn sends_tools_and_parses_ollama_tool_calls() {
        use std::io::{BufRead, Read, Write};
        use std::net::TcpListener;
        use std::sync::{Arc, Mutex};

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ollama mock");
        let address = listener.local_addr().expect("ollama address");
        let seen = Arc::new(Mutex::new(None::<serde_json::Value>));
        let server_seen = seen.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut reader = std::io::BufReader::new(stream.try_clone().expect("clone"));
            let mut line = String::new();
            reader.read_line(&mut line).expect("request line");
            let mut length = 0usize;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).expect("header");
                if header == "\r\n" || header.is_empty() {
                    break;
                }
                if let Some((name, value)) = header.split_once(':') {
                    if name.eq_ignore_ascii_case("content-length") {
                        length = value.trim().parse().unwrap_or(0);
                    }
                }
            }
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).expect("body");
            *server_seen.lock().unwrap() = Some(serde_json::from_slice(&body).expect("json body"));
            let response = serde_json::json!({
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "function": {"name": "search", "arguments": {"query": "cats"}}
                    }]
                }
            })
            .to_string();
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",
                response.len()
            );
            stream.write_all(reply.as_bytes()).expect("response");
        });

        let provider = OllamaProvider {
            base_url: format!("http://{address}"),
            model: "mock".into(),
            timeout: Duration::from_secs(5),
        };
        let request = ChatRequest {
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "find cats".into(),
            }],
            temperature: Some(0.0),
            max_tokens: Some(64),
            tools: vec![crate::providers::ChatTool {
                name: "search".into(),
                description: "Search the web".into(),
                parameters: serde_json::json!({"type": "object"}),
            }],
        };
        let response = provider.chat(request).await.expect("ollama chat");
        assert_eq!(response.content, "");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].name, "search");
        assert_eq!(response.tool_calls[0].arguments, "{\"query\":\"cats\"}");

        server.join().expect("ollama mock");
        let sent = seen.lock().unwrap().clone().expect("request body");
        assert_eq!(sent["tools"][0]["type"], "function");
        assert_eq!(sent["tools"][0]["function"]["name"], "search");
    }

    #[test]
    fn ndjson_skips_blank_and_invalid_lines() {
        let mut buf = String::new();
        let mut pt = None;
        let mut ct = None;
        buf.push_str("\nnot-json\n{\"message\":{\"content\":\"ok\"}}\n");
        let out = parse_ndjson_chunk(&mut buf, &mut pt, &mut ct);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].delta, "ok");
    }
}
