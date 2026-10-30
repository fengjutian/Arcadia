use std::{collections::HashMap, sync::Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::rag::{citation::RagAnswer, commands::RagAnswerRequest};

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
pub async fn assistant_task_start(app: AppHandle, request: RagAnswerRequest) -> Result<String, String> {
    if request.provider_id.trim().is_empty() {
        return Err("provider_id is required".into());
    }
    let id = format!("assistant-{}", uuid::Uuid::new_v4());
    let registry = app.state::<AssistantTaskRegistry>();
    registry.insert(AssistantTask {
        id: id.clone(),
        status: "running",
        result: None,
        error: None,
    });

    let task_id = id.clone();
    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = crate::rag::commands::rag_answer(task_app.clone(), request).await;
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
