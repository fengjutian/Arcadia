use serde::Serialize;
use std::time::Duration;

const BING_RSS_ENDPOINT: &str = "https://www.bing.com/search";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[tauri::command]
pub async fn web_search(query: String, limit: Option<usize>) -> Result<Vec<WebSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 300 {
        return Err("search query must contain 1 to 300 characters".into());
    }
    let limit = limit.unwrap_or(6).clamp(1, 10);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Arcadia/0.5 WebSearch")
        .build()
        .map_err(|error| format!("web search client failed: {error}"))?;
    let response = client
        .get(BING_RSS_ENDPOINT)
        .query(&[("format", "rss"), ("q", query)])
        .send()
        .await
        .map_err(|error| format!("web search request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("web search returned an error: {error}"))?;
    let body = response
        .text()
        .await
        .map_err(|error| format!("web search response failed: {error}"))?;
    Ok(parse_bing_rss(&body, limit))
}

fn parse_bing_rss(xml: &str, limit: usize) -> Vec<WebSearchResult> {
    let mut results = Vec::new();
    let mut rest = xml;
    while results.len() < limit {
        let Some(start) = rest.find("<item>") else { break };
        rest = &rest[start + "<item>".len()..];
        let Some(end) = rest.find("</item>") else { break };
        let item = &rest[..end];
        rest = &rest[end + "</item>".len()..];
        let title = tag_text(item, "title");
        let url = tag_text(item, "link");
        let snippet = strip_html(&tag_text(item, "description"));
        let valid_url = url::Url::parse(&url)
            .ok()
            .filter(|parsed| matches!(parsed.scheme(), "https" | "http"));
        if !title.is_empty() && valid_url.is_some() {
            results.push(WebSearchResult {
                title: truncate(&title, 240),
                url,
                snippet: truncate(&snippet, 1_200),
            });
        }
    }
    results
}

fn tag_text(input: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let Some(start) = input.find(&open) else { return String::new() };
    let value = &input[start + open.len()..];
    let Some(end) = value.find(&close) else { return String::new() };
    decode_entities(value[..end].trim().trim_start_matches("<![CDATA[").trim_end_matches("]]>").trim())
}

fn strip_html(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut inside = false;
    for character in input.chars() {
        match character {
            '<' => inside = true,
            '>' => { inside = false; output.push(' '); }
            _ if !inside => output.push(character),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn truncate(input: &str, maximum: usize) -> String {
    let mut output: String = input.chars().take(maximum).collect();
    if input.chars().count() > maximum { output.push('…'); }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_sanitizes_rss_results() {
        let xml = r#"<rss><channel><item><title>Alpha &amp; Beta</title><link>https://example.com/a</link><description><![CDATA[<b>Useful</b> summary]]></description></item><item><title>Bad</title><link>javascript:alert(1)</link><description>x</description></item></channel></rss>"#;
        assert_eq!(parse_bing_rss(xml, 5), vec![WebSearchResult { title:"Alpha & Beta".into(), url:"https://example.com/a".into(), snippet:"Useful summary".into() }]);
    }

    #[test]
    fn respects_result_limit() {
        let xml = "<item><title>A</title><link>https://a.test</link><description>A</description></item><item><title>B</title><link>https://b.test</link><description>B</description></item>";
        assert_eq!(parse_bing_rss(xml, 1).len(), 1);
    }
}
