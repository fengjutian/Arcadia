use std::{collections::HashMap, sync::Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{
    providers::ChatRequest,
    rag::{citation::{CitationStatus, RagAnswer}, commands::RagAnswerRequest},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTask {
    pub id: String,
    pub status: &'static str,
    pub result: Option<RagAnswer>,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct AssistantTaskRegistry(Mutex<HashMap<String, AssistantTask>>);

impl AssistantTaskRegistry {
    fn insert(&self, task: AssistantTask) {
        if let Ok(mut tasks) = self.0.lock() {
            tasks.insert(task.id.clone(), task);
        }
    }

    fn get(&self, id: &str) -> Option<AssistantTask> {
        self.0.lock().ok()?.get(id).cloned()
    }
}

#[tauri::command]
pub async fn assistant_task_start(
    app: AppHandle,
    request: RagAnswerRequest,
    general_request: Option<ChatRequest>,
    task_id: Option<String>,
) -> Result<String, String> {
    if request.provider_id.trim().is_empty() {
        return Err("provider_id is required".into());
    }
    let id = task_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("assistant-{}", uuid::Uuid::new_v4()));
    let registry = app.state::<AssistantTaskRegistry>();
    registry.insert(AssistantTask {
        id: id.clone(),
        status: "running",
        result: None,
        error: None,
    });

    let provider_id = request.provider_id.clone();
    let task_id = id.clone();
    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = match crate::rag::commands::rag_answer(task_app.clone(), request).await {
            Ok(mut result) if matches!(result.citation_status, CitationStatus::NotRequired | CitationStatus::Invalid) => {
                match general_request {
                    Some(request) => crate::ai_chat_impl(task_app.clone(), provider_id, request).await.map(|response| {
                        // Mark this as a complete answer so the frontend does not start a
                        // second, reload-sensitive request after the background task ends.
                        result.answer = response.content;
                        result.citation_status = CitationStatus::Valid;
                        result
                    }),
                    None => Ok(result),
                }
            }
            other => other,
        };
        let (task, title, body) = match outcome {
            Ok(result) => (
                AssistantTask { id: task_id.clone(), status: "completed", result: Some(result), error: None },
                "知识助手已完成",
                "回答已生成，打开应用即可查看。",
            ),
            Err(error) => (
                AssistantTask { id: task_id.clone(), status: "failed", result: None, error: Some(error.clone()) },
                "知识助手任务失败",
                "生成回答时遇到问题，请打开应用重试。",
            ),
        };
        task_app.state::<AssistantTaskRegistry>().insert(task.clone());
        let _ = task_app.emit("assistant://task-updated", &task);
        let _ = task_app.notification().builder().title(title).body(body).show();
    });

    Ok(id)
}

#[tauri::command]
pub fn assistant_task_get(
    registry: tauri::State<'_, AssistantTaskRegistry>,
    task_id: String,
) -> Result<AssistantTask, String> {
    registry.get(&task_id).ok_or_else(|| "assistant task not found".into())
}
