use serde::{Deserialize, Serialize};
use std::time::Duration;

const BING_ARCHIVE_URL: &str =
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN";

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BingDailyImage {
    date: String,
    url: String,
    title: String,
    copyright: String,
}

#[tauri::command]
pub async fn bing_daily_image() -> Result<BingDailyImage, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| error.to_string())?;
    let archive = client
        .get(BING_ARCHIVE_URL)
        .send()
        .await
        .map_err(|error| format!("Bing daily image request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Bing daily image returned an error: {error}"))?
        .json::<BingArchive>()
        .await
        .map_err(|error| format!("Invalid Bing daily image response: {error}"))?;
    let image = archive
        .images
        .into_iter()
        .next()
        .ok_or_else(|| "Bing daily image response was empty".to_string())?;
    let url = if image.url.starts_with('/') {
        format!("https://www.bing.com{}", image.url)
    } else {
        image.url
    };
    Ok(BingDailyImage {
        date: image.startdate,
        url,
        title: image.title,
        copyright: image.copyright,
    })
}
