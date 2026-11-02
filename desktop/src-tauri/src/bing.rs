use serde::{Deserialize, Serialize};
use std::time::Duration;

const BING_ARCHIVE_URL: &str =
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n={count}&mkt=zh-CN";
const BING_ARCHIVE_MAX_COUNT: u32 = 8;

#[derive(Debug, Deserialize)]
struct BingArchive {
    images: Vec<BingArchiveImage>,
}

#[derive(Debug, Deserialize)]
struct BingArchiveImage {
    startdate: String,
    url: String,
    title: String,
    copyright: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BingDailyImage {
    date: String,
    url: String,
    title: String,
    copyright: String,
}

async fn fetch_images(count: u32) -> Result<Vec<BingDailyImage>, String> {
    let count = count.clamp(1, BING_ARCHIVE_MAX_COUNT);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| error.to_string())?;
    let archive = client
        .get(BING_ARCHIVE_URL.replace("{count}", &count.to_string()))
        .send()
        .await
        .map_err(|error| format!("Bing daily image request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Bing daily image returned an error: {error}"))?
        .json::<BingArchive>()
        .await
        .map_err(|error| format!("Invalid Bing daily image response: {error}"))?;
    let images: Vec<BingDailyImage> = archive
        .images
        .into_iter()
        .map(|image| {
            let url = if image.url.starts_with('/') {
                format!("https://www.bing.com{}", image.url)
            } else {
                image.url
            };
            BingDailyImage {
                date: image.startdate,
                url,
                title: image.title,
                copyright: image.copyright,
            }
        })
        .collect();
    if images.is_empty() {
        return Err("Bing daily image response was empty".to_string());
    }
    Ok(images)
}

#[tauri::command]
pub async fn bing_daily_image() -> Result<BingDailyImage, String> {
    fetch_images(1)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "Bing daily image response was empty".to_string())
}

/// Returns the most recent Bing wallpapers (today first) so the UI can keep a
/// visible history of previously loaded daily images.
#[tauri::command]
pub async fn bing_daily_images(count: Option<u32>) -> Result<Vec<BingDailyImage>, String> {
    fetch_images(count.unwrap_or(BING_ARCHIVE_MAX_COUNT)).await
}
