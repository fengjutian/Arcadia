use serde::{Deserialize, Serialize};
use std::time::Duration;

const SKILLHUB_API: &str = "https://api.skillhub.cn/api/skills";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillHubSearchResult {
    total: u64,
    skills: Vec<SkillHubSkill>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillHubSkill {
    slug: String,
    name: String,
    description: String,
    version: String,
    downloads: u64,
    stars: u64,
    category: Option<String>,
    source: Option<String>,
    icon_url: Option<String>,
    owner_name: Option<String>,
    canonical_name: Option<String>,
    publisher_name: Option<String>,
    publisher_verified: bool,
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    code: i64,
    message: String,
    data: T,
}

#[derive(Debug, Deserialize)]
struct ApiSearchData {
    total: u64,
    skills: Vec<ApiSkill>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiSkill {
    slug: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default, rename = "description_zh")]
    description_zh: Option<String>,
    #[serde(default)]
    version: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    stars: u64,
    category: Option<String>,
    source: Option<String>,
    icon_url: Option<String>,
    owner_name: Option<String>,
    namespace: Option<ApiNamespace>,
    publisher: Option<ApiPublisher>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiNamespace {
    canonical_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiPublisher {
    name: Option<String>,
    #[serde(default)]
    verified: bool,
}

impl From<ApiSkill> for SkillHubSkill {
    fn from(skill: ApiSkill) -> Self {
        let publisher_name = skill
            .publisher
            .as_ref()
            .and_then(|publisher| publisher.name.clone());
        let publisher_verified = skill
            .publisher
            .as_ref()
            .is_some_and(|publisher| publisher.verified);
        Self {
            slug: skill.slug,
            name: skill.name,
            description: skill
                .description_zh
                .filter(|description| !description.trim().is_empty())
                .unwrap_or(skill.description),
            version: skill.version,
            downloads: skill.downloads,
            stars: skill.stars,
            category: skill.category,
            source: skill.source,
            icon_url: skill.icon_url,
            owner_name: skill.owner_name,
            canonical_name: skill
                .namespace
                .and_then(|namespace| namespace.canonical_name),
            publisher_name,
            publisher_verified,
        }
    }
}

#[tauri::command]
pub async fn skillhub_search(
    keyword: String,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<SkillHubSearchResult, String> {
    let page = page.unwrap_or(1).clamp(1, 10_000);
    let page_size = page_size.unwrap_or(24).clamp(1, 48);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| format!("cannot create SkillHub client: {error}"))?;
    let mut query = vec![
        ("sortBy", "downloads".to_string()),
        ("order", "desc".to_string()),
        ("page", page.to_string()),
        ("pageSize", page_size.to_string()),
    ];
    let keyword = keyword.trim();
    if !keyword.is_empty() {
        query.push(("keyword", keyword.chars().take(120).collect()));
    }
    let response = client
        .get(SKILLHUB_API)
        .query(&query)
        .send()
        .await
        .map_err(|error| format!("SkillHub request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("SkillHub HTTP {}", response.status()));
    }
    let body = response
        .text()
        .await
        .map_err(|error| format!("cannot read SkillHub response: {error}"))?;
    let envelope = serde_json::from_str::<ApiEnvelope<ApiSearchData>>(&body)
        .map_err(|error| format!("invalid SkillHub response: {error}"))?;
    if envelope.code != 0 {
        return Err(format!("SkillHub: {}", envelope.message));
    }
    Ok(SkillHubSearchResult {
        total: envelope.data.total,
        skills: envelope.data.skills.into_iter().map(Into::into).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_accepts_both_default_and_chinese_descriptions() {
        let body = r#"{
            "code": 0,
            "message": "success",
            "data": {
                "total": 1,
                "skills": [{
                    "slug": "search",
                    "name": "Search",
                    "description": "English",
                    "description_zh": "中文",
                    "version": "1.0.0",
                    "downloads": 12,
                    "stars": 3,
                    "iconUrl": "https://example.com/icon.png",
                    "ownerName": "owner",
                    "namespace": {"canonicalName": "@owner/search"},
                    "publisher": {"name": "Publisher", "verified": true}
                }]
            }
        }"#;
        let envelope: ApiEnvelope<ApiSearchData> = serde_json::from_str(body).unwrap();
        let skill: SkillHubSkill = envelope.data.skills.into_iter().next().unwrap().into();
        assert_eq!(skill.description, "中文");
        assert_eq!(skill.canonical_name.as_deref(), Some("@owner/search"));
        assert!(skill.publisher_verified);
    }
}
