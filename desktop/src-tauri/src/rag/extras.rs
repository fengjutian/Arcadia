//! Embeddings for non-document sources: page notes, clips and archived tabs.
//!
//! Documents get chunked + embedded by the RAG supervisor. Notes/clips/archive
//! entries are much smaller and live in their own tables, so they get a compact
//! parallel index here: one vector per item, keyed by `(kind, source_id, model)`.
//! Without it the extra sources were lexical-only, which made semantic queries
//! miss highlights that used different wording.

use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

use super::vector::{blob_to_vector, cosine_similarity};

/// How many items per kind are indexed in one run.
pub const EXTRA_INDEX_LIMIT: i64 = 500;
const EMBED_BATCH: usize = 16;
/// Cosine gate: below this the hit is noise for small fragments.
const MIN_COSINE: f32 = 0.25;
/// Keep well under the provider's per-input byte limit.
const MAX_EMBED_CHARS: usize = 4_000;

#[derive(Debug, Clone)]
pub struct ExtraSource {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub url: String,
    pub text: String,
}

pub fn kind_label(kind: &str) -> &'static str {
    match kind {
        "note" => "笔记",
        "clip" => "剪藏",
        "archive" => "归档",
        _ => "来源",
    }
}

fn clip_text(text: &str) -> String {
    text.chars().take(MAX_EMBED_CHARS).collect()
}

/// Load every indexable extra source, newest first.
pub fn load_extra_sources(conn: &Connection, limit: i64) -> Result<Vec<ExtraSource>, String> {
    let limit = limit.clamp(1, 5_000);
    let mut out = Vec::new();

    let mut stmt = conn
        .prepare("SELECT id,url,title,quote,comment FROM page_notes ORDER BY created_at DESC LIMIT ?1")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for (id, url, title, quote, comment) in rows.flatten() {
        let text = if comment.trim().is_empty() { quote } else { format!("{quote}\n{comment}") };
        out.push(ExtraSource { kind: "note".into(), id, title, url, text: clip_text(&text) });
    }

    let mut stmt = conn
        .prepare("SELECT id,source_url,title,source_title,content FROM clips ORDER BY created_at DESC LIMIT ?1")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for (id, url, title, source_title, content) in rows.flatten() {
        let title = if title.trim().is_empty() { source_title } else { title };
        out.push(ExtraSource { kind: "clip".into(), id, title, url, text: clip_text(&content) });
    }

    let mut stmt = conn
        .prepare("SELECT id,url,title FROM tab_archive ORDER BY archived_at DESC LIMIT ?1")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for (id, url, title) in rows.flatten() {
        out.push(ExtraSource { kind: "archive".into(), id, title: title.clone(), url: url.clone(), text: clip_text(&format!("{title}\n{url}")) });
    }

    Ok(out)
}

/// Fetch one source by id (used when a vector hit has no lexical counterpart).
pub fn extra_source_by_id(conn: &Connection, kind: &str, id: &str) -> Option<ExtraSource> {
    match kind {
        "note" => conn.query_row(
            "SELECT url,title,quote,comment FROM page_notes WHERE id=?1",
            params![id],
            |row| {
                let url: String = row.get(0)?;
                let title: String = row.get(1)?;
                let quote: String = row.get(2)?;
                let comment: String = row.get(3)?;
                Ok((url, title, quote, comment))
            },
        ).ok().map(|(url, title, quote, comment)| {
            let text = if comment.trim().is_empty() { quote } else { format!("{quote}\n{comment}") };
            ExtraSource { kind: "note".into(), id: id.into(), title, url, text: clip_text(&text) }
        }),
        "clip" => conn.query_row(
            "SELECT source_url,title,source_title,content FROM clips WHERE id=?1",
            params![id],
            |row| {
                let url: String = row.get(0)?;
                let title: String = row.get(1)?;
                let source_title: String = row.get(2)?;
                let content: String = row.get(3)?;
                Ok((url, title, source_title, content))
            },
        ).ok().map(|(url, title, source_title, content)| {
            let title = if title.trim().is_empty() { source_title } else { title };
            ExtraSource { kind: "clip".into(), id: id.into(), title, url, text: clip_text(&content) }
        }),
        "archive" => conn.query_row(
            "SELECT url,title FROM tab_archive WHERE id=?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ).ok().map(|(url, title)| {
            let text = format!("{title}\n{url}");
            ExtraSource { kind: "archive".into(), id: id.into(), title, url, text: clip_text(&text) }
        }),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct ExtraVectorHit {
    pub kind: String,
    pub source_id: String,
    pub score: f32,
}

/// Cosine search over `extra_embeddings` for the active model.
pub fn search_extra_vectors(
    conn: &Connection,
    query: &[f32],
    model: &str,
    limit: usize,
) -> Vec<ExtraVectorHit> {
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }
    let Ok(mut stmt) = conn.prepare(
        "SELECT kind,source_id,vector FROM extra_embeddings WHERE model=?1 AND dims=?2",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map(params![model, query.len() as i64], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Vec<u8>>(2)?,
        ))
    }) else {
        return Vec::new();
    };

    let mut hits: Vec<ExtraVectorHit> = rows
        .flatten()
        .filter_map(|(kind, source_id, bytes)| {
            let vector = blob_to_vector(&bytes);
            let score = cosine_similarity(query, &vector);
            (score >= MIN_COSINE).then_some(ExtraVectorHit { kind, source_id, score })
        })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score));
    hits.truncate(limit);
    hits
}

/// Embed every extra source with the provider's embedding model.
#[tauri::command]
pub async fn rag_reindex_extras(app: AppHandle, provider_id: String) -> Result<i64, String> {
    reindex_impl(app, provider_id, false).await
}

/// Incremental pass: embed only sources that have no vector for the active
/// model yet. Triggered on startup and (debounced) after saving a note/clip or
/// archiving a tab, so users never have to press "index" manually.
#[tauri::command]
pub async fn rag_sync_extras(app: AppHandle) -> Result<i64, String> {
    let database = crate::local_store::connection(&app)?;
    let provider_id: Option<String> = database
        .query_row(
            "SELECT id FROM ai_providers WHERE COALESCE(embedding_model,'') <> '' ORDER BY created_at ASC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    drop(database);
    match provider_id {
        Some(provider_id) => reindex_impl(app, provider_id, true).await,
        None => Ok(0),
    }
}

async fn reindex_impl(app: AppHandle, provider_id: String, only_missing: bool) -> Result<i64, String> {
    let database = crate::local_store::connection(&app)?;
    let request = crate::providers::embedding::read_embedding_request(&database, &provider_id)
        .map_err(|error| error.to_string())?;
    let mut sources = load_extra_sources(&database, EXTRA_INDEX_LIMIT)?;
    if only_missing {
        let model = request.model.clone();
        sources = retain_missing(&database, sources, &model)?;
    }
    drop(database);
    if sources.is_empty() {
        return Ok(0);
    }

    let mut written = 0i64;
    for batch in sources.chunks(EMBED_BATCH) {
        let mut batch_request = request.clone();
        batch_request.inputs = batch.iter().map(|source| source.text.clone()).collect();
        let response = crate::providers::embedding::embed_with_request(batch_request)
            .await
            .map_err(|error| error.to_string())?;
        let model = if response.model.trim().is_empty() { request.model.clone() } else { response.model.clone() };
        let database = crate::local_store::connection(&app)?;
        for (source, vector) in batch.iter().zip(response.vectors.iter()) {
            let bytes: Vec<u8> = vector.iter().flat_map(|value| value.to_le_bytes()).collect();
            database
                .execute(
                    "INSERT INTO extra_embeddings(kind,source_id,model,dims,vector,excerpt,updated_at)
                     VALUES(?1,?2,?3,?4,?5,?6,?7)
                     ON CONFLICT(kind,source_id,model) DO UPDATE SET
                        dims=excluded.dims, vector=excluded.vector, excerpt=excluded.excerpt, updated_at=excluded.updated_at",
                    params![
                        source.kind,
                        source.id,
                        model,
                        vector.len() as i64,
                        bytes,
                        source.text.chars().take(240).collect::<String>(),
                        chrono_like_now()
                    ],
                )
                .map_err(|error| error.to_string())?;
            written += 1;
        }
    }
    Ok(written)
}

fn retain_missing(
    conn: &Connection,
    sources: Vec<ExtraSource>,
    model: &str,
) -> Result<Vec<ExtraSource>, String> {
    let mut statement = conn
        .prepare("SELECT kind,source_id FROM extra_embeddings WHERE model=?1")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![model], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut existing = std::collections::HashSet::new();
    for row in rows.flatten() {
        existing.insert(row);
    }
    Ok(sources
        .into_iter()
        .filter(|source| !existing.contains(&(source.kind.clone(), source.id.clone())))
        .collect())
}

fn chrono_like_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob_of(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|value| value.to_le_bytes()).collect()
    }

    #[test]
    fn cosine_search_returns_the_closest_extra_source() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::local_store::run_migrations(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO extra_embeddings(kind,source_id,model,dims,vector,excerpt,updated_at)
             VALUES('note','n1','m',2,?,'',1)",
            params![blob_of(&[1.0, 0.0])],
        ).unwrap();
        conn.execute(
            "INSERT INTO extra_embeddings(kind,source_id,model,dims,vector,excerpt,updated_at)
             VALUES('clip','c1','m',2,?,'',1)",
            params![blob_of(&[0.0, 1.0])],
        ).unwrap();

        let hits = search_extra_vectors(&conn, &[1.0, 0.0], "m", 5);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "note");
        assert_eq!(hits[0].source_id, "n1");
        assert!(hits[0].score > 0.99);
    }

    #[test]
    fn loads_each_extra_kind() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::local_store::run_migrations(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO page_notes(id,url,title,quote,comment,color,prefix,suffix,document_id,created_at,updated_at)
             VALUES('n1','https://a','T','quote','', 'yellow',NULL,NULL,NULL,1,1)", [],
        ).unwrap();
        conn.execute(
            "INSERT INTO clips(id,kind,content,title,source_url,source_title,note,collection_id,created_at,updated_at)
             VALUES('c1','selection','clip body','C','https://b','S','',NULL,1,1)", [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tab_archive(id,url,title,favicon,archived_at,visited_at,source,workspace_id)
             VALUES('a1','https://c','A',NULL,1,1,'manual',NULL)", [],
        ).unwrap();

        let sources = load_extra_sources(&conn, 10).unwrap();
        assert_eq!(sources.len(), 3);
        let kinds: Vec<&str> = sources.iter().map(|source| source.kind.as_str()).collect();
        assert!(kinds.contains(&"note"));
        assert!(kinds.contains(&"clip"));
        assert!(kinds.contains(&"archive"));
    }

    #[test]
    fn retain_missing_skips_sources_that_already_have_a_vector() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::local_store::run_migrations(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO page_notes(id,url,title,quote,comment,color,prefix,suffix,document_id,created_at,updated_at)
             VALUES('n1','https://a','T','quote','', 'yellow',NULL,NULL,NULL,1,1)", [],
        ).unwrap();
        conn.execute(
            "INSERT INTO clips(id,kind,content,title,source_url,source_title,note,collection_id,created_at,updated_at)
             VALUES('c1','selection','clip body','C','https://b','S','',NULL,1,1)", [],
        ).unwrap();
        conn.execute(
            "INSERT INTO extra_embeddings(kind,source_id,model,dims,vector,excerpt,updated_at)
             VALUES('note','n1','m',2,?,'',1)",
            params![blob_of(&[1.0, 0.0])],
        ).unwrap();

        let sources = load_extra_sources(&conn, 10).unwrap();
        let missing = retain_missing(&conn, sources, "m").unwrap();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].kind, "clip");
    }
}
