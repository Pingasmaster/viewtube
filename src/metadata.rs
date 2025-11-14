//! Metadata persistence layer for ViewTube.
//!
//! All structs in this module mirror how metadata is serialized to disk and
//! exposed to the API. The comments intentionally lean verbose so that anyone
//! extending the tooling knows exactly why each piece exists and how the SQLite
//! layout hangs together.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

/// Description of a single downloadable media source (e.g. 1080p mp4).
///
/// Sources can point to files on disk (`path`) or merely expose a streaming
/// endpoint backed by the API. The struct mirrors the JSON persisted inside the
/// SQLite tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSource {
    pub format_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<i64>,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Rows stored in the `videos` and `shorts` tables.
///
/// Many fields are optional so we gracefully handle partially known metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoRecord {
    pub videoid: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub likes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dislikes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub views: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscriber_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thumbnails: Vec<String>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub extras: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<VideoSource>,
}

/// Subtitle manifest for a single video.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub code: String,
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Collection of all subtitle tracks that belong to a video id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleCollection {
    pub videoid: String,
    #[serde(default)]
    pub languages: Vec<SubtitleTrack>,
}

/// Comment stored on disk, mirroring what the frontend expects.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentRecord {
    pub id: String,
    pub videoid: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub author: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub likes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_posted: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_comment_id: Option<String>,
    #[serde(default)]
    pub status_likedbycreator: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_count: Option<i64>,
}

/// Wrapper around the SQLite connection that performs read/write operations.
#[derive(Debug)]
pub struct MetadataStore {
    conn: Connection,
}

impl MetadataStore {
    /// Opens (and if necessary creates) the SQLite DB and ensures the expected
    /// schema exists. WAL mode is enabled to avoid readers blocking writers.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating metadata directory {}", parent.display()))?;
        }

        let conn = Connection::open(path)
            .with_context(|| format!("opening metadata DB {}", path.display()))?;

        conn.pragma_update(None, "journal_mode", &"WAL")
            .context("enabling WAL mode for metadata DB")?;
        conn.pragma_update(None, "synchronous", &"NORMAL")
            .context("setting metadata DB synchronous mode")?;

        let mut store = Self { conn };
        store.ensure_tables()?;
        Ok(store)
    }

    /// Runs the SQL required to create the tables if they do not already
    /// exist. Wrapped in a transaction so a failure leaves the DB untouched.
    fn ensure_tables(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;

        tx.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS videos (
                videoid TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                likes INTEGER,
                dislikes INTEGER,
                views INTEGER,
                upload_date TEXT,
                author TEXT,
                subscriber_count INTEGER,
                duration INTEGER,
                duration_text TEXT,
                channel_url TEXT,
                thumbnail_url TEXT,
                tags_json TEXT DEFAULT '[]',
                thumbnails_json TEXT DEFAULT '[]',
                extras_json TEXT DEFAULT 'null',
                sources_json TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS shorts (
                videoid TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                likes INTEGER,
                dislikes INTEGER,
                views INTEGER,
                upload_date TEXT,
                author TEXT,
                subscriber_count INTEGER,
                duration INTEGER,
                duration_text TEXT,
                channel_url TEXT,
                thumbnail_url TEXT,
                tags_json TEXT DEFAULT '[]',
                thumbnails_json TEXT DEFAULT '[]',
                extras_json TEXT DEFAULT 'null',
                sources_json TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS subtitles (
                videoid TEXT PRIMARY KEY,
                languages_json TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                videoid TEXT NOT NULL,
                author TEXT DEFAULT '',
                text TEXT DEFAULT '',
                likes INTEGER,
                time_posted TEXT,
                parent_comment_id TEXT,
                status_likedbycreator INTEGER NOT NULL DEFAULT 0,
                reply_count INTEGER,
                FOREIGN KEY (videoid) REFERENCES videos(videoid) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_comments_videoid ON comments(videoid);
            CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);
            "#,
        )?;

        tx.commit()?;
        Ok(())
    }

    /// Inserts or updates a long-form video entry.
    pub fn upsert_video(&self, record: &VideoRecord) -> Result<()> {
        self.upsert("videos", record)
    }

    pub fn upsert_short(&self, record: &VideoRecord) -> Result<()> {
        self.upsert("shorts", record)
    }

    /// Shared helper used by both `videos` and `shorts` tables.
    fn upsert(&self, table: &str, record: &VideoRecord) -> Result<()> {
        let tags_json = serde_json::to_string(&record.tags).context("serializing tags")?;
        let thumbnails_json =
            serde_json::to_string(&record.thumbnails).context("serializing thumbnails")?;
        let extras_json =
            serde_json::to_string(&record.extras).context("serializing extra metadata")?;
        let sources_json = serde_json::to_string(&record.sources).context("serializing sources")?;

        self.conn.execute(
            &format!(
                r#"
                INSERT INTO {table} (
                    videoid, title, description, likes, dislikes, views,
                    upload_date, author, subscriber_count, duration, duration_text,
                    channel_url, thumbnail_url, tags_json, thumbnails_json,
                    extras_json, sources_json
                ) VALUES (
                    :videoid, :title, :description, :likes, :dislikes, :views,
                    :upload_date, :author, :subscriber_count, :duration, :duration_text,
                    :channel_url, :thumbnail_url, :tags_json, :thumbnails_json,
                    :extras_json, :sources_json
                )
                ON CONFLICT(videoid) DO UPDATE SET
                    title = excluded.title,
                    description = excluded.description,
                    likes = excluded.likes,
                    dislikes = excluded.dislikes,
                    views = excluded.views,
                    upload_date = excluded.upload_date,
                    author = excluded.author,
                    subscriber_count = excluded.subscriber_count,
                    duration = excluded.duration,
                    duration_text = excluded.duration_text,
                    channel_url = excluded.channel_url,
                    thumbnail_url = excluded.thumbnail_url,
                    tags_json = excluded.tags_json,
                    thumbnails_json = excluded.thumbnails_json,
                    extras_json = excluded.extras_json,
                    sources_json = excluded.sources_json
                "#,
            ),
            params![
                record.videoid,
                record.title,
                record.description,
                record.likes,
                record.dislikes,
                record.views,
                record.upload_date,
                record.author,
                record.subscriber_count,
                record.duration,
                record.duration_text,
                record.channel_url,
                record.thumbnail_url,
                tags_json,
                thumbnails_json,
                extras_json,
                sources_json,
            ],
        )?;

        Ok(())
    }

    /// Stores subtitle metadata in the DB.
    pub fn upsert_subtitles(&self, subtitles: &SubtitleCollection) -> Result<()> {
        let languages_json =
            serde_json::to_string(&subtitles.languages).context("serializing subtitles")?;

        self.conn.execute(
            r#"
            INSERT INTO subtitles (videoid, languages_json)
            VALUES (:videoid, :languages_json)
            ON CONFLICT(videoid) DO UPDATE SET
                languages_json = excluded.languages_json
            "#,
            params![subtitles.videoid, languages_json],
        )?;

        Ok(())
    }

    /// Replaces every stored comment for `videoid` in one transaction so we do
    /// not mix old and new comment trees.
    pub fn replace_comments(&mut self, videoid: &str, comments: &[CommentRecord]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM comments WHERE videoid = ?1", params![videoid])?;

        for comment in comments {
            tx.execute(
                r#"
                INSERT INTO comments (
                    id, videoid, author, text, likes, time_posted,
                    parent_comment_id, status_likedbycreator, reply_count
                ) VALUES (
                    :id, :videoid, :author, :text, :likes, :time_posted,
                    :parent_comment_id, :status_likedbycreator, :reply_count
                )
                "#,
                params![
                    comment.id,
                    comment.videoid,
                    comment.author,
                    comment.text,
                    comment.likes,
                    comment.time_posted,
                    comment.parent_comment_id,
                    comment.status_likedbycreator as i64,
                    comment.reply_count,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }
}

/// Lightweight cloneable reader that opens short‑lived connections for each
/// query. This avoids keeping a single connection open across threads/tasks.
#[derive(Clone)]
pub struct MetadataReader {
    db_path: PathBuf,
}

impl MetadataReader {
    /// Creates a new reader that lazily opens the DB whenever a query runs.
    pub fn new(path: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            db_path: path.as_ref().to_path_buf(),
        })
    }

    fn with_connection<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        // Open a dedicated connection per invocation so long running queries
        // do not block unrelated threads.
        let conn = Connection::open(&self.db_path)
            .with_context(|| format!("opening metadata DB {}", self.db_path.display()))?;
        conn.pragma_update(None, "foreign_keys", &"ON")?;
        f(&conn)
    }

    pub fn list_videos(&self) -> Result<Vec<VideoRecord>> {
        self.fetch_videos_from("videos")
    }

    pub fn list_shorts(&self) -> Result<Vec<VideoRecord>> {
        self.fetch_videos_from("shorts")
    }

    pub fn get_video(&self, videoid: &str) -> Result<Option<VideoRecord>> {
        self.fetch_single("videos", videoid)
    }

    pub fn get_short(&self, videoid: &str) -> Result<Option<VideoRecord>> {
        self.fetch_single("shorts", videoid)
    }

    pub fn get_subtitles(&self, videoid: &str) -> Result<Option<SubtitleCollection>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                r#"
                SELECT languages_json
                FROM subtitles
                WHERE videoid = ?1
                "#,
            )?;

            let json: Option<String> = stmt.query_row([videoid], |row| row.get(0)).optional()?;

            if let Some(languages_json) = json {
                let languages: Vec<SubtitleTrack> =
                    serde_json::from_str(&languages_json).context("parsing subtitle tracks")?;
                Ok(Some(SubtitleCollection {
                    videoid: videoid.to_owned(),
                    languages,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn list_subtitles(&self) -> Result<Vec<SubtitleCollection>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                r#"
                SELECT videoid, languages_json
                FROM subtitles
                "#,
            )?;

            let mut rows = stmt.query([])?;
            let mut results = Vec::new();
            while let Some(row) = rows.next()? {
                let videoid: String = row.get(0)?;
                let languages_json: String = row.get(1)?;
                let languages: Vec<SubtitleTrack> =
                    serde_json::from_str(&languages_json).context("parsing subtitle tracks")?;
                results.push(SubtitleCollection { videoid, languages });
            }
            Ok(results)
        })
    }

    pub fn get_comments(&self, videoid: &str) -> Result<Vec<CommentRecord>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                r#"
                SELECT id, videoid, author, text, likes, time_posted,
                       parent_comment_id, status_likedbycreator, reply_count
                FROM comments
                WHERE videoid = ?1
                ORDER BY time_posted ASC
                "#,
            )?;

            let mut comments = Vec::new();
            let mut rows = stmt.query([videoid])?;
            while let Some(row) = rows.next()? {
                comments.push(row_to_comment(&row)?);
            }
            Ok(comments)
        })
    }

    pub fn list_all_comments(&self) -> Result<Vec<CommentRecord>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                r#"
                SELECT id, videoid, author, text, likes, time_posted,
                       parent_comment_id, status_likedbycreator, reply_count
                FROM comments
                ORDER BY time_posted ASC
                "#,
            )?;

            let mut rows = stmt.query([])?;
            let mut comments = Vec::new();
            while let Some(row) = rows.next()? {
                comments.push(row_to_comment(&row)?);
            }
            Ok(comments)
        })
    }

    fn fetch_videos_from(&self, table: &str) -> Result<Vec<VideoRecord>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(&format!(
                r#"
                SELECT videoid, title, description, likes, dislikes, views,
                       upload_date, author, subscriber_count, duration, duration_text,
                       channel_url, thumbnail_url, tags_json, thumbnails_json,
                       extras_json, sources_json
                FROM {table}
                ORDER BY upload_date DESC, rowid DESC
                "#
            ))?;

            let mut rows = stmt.query([])?;
            let mut records = Vec::new();
            while let Some(row) = rows.next()? {
                records.push(row_to_video_record(&row)?);
            }
            Ok(records)
        })
    }

    fn fetch_single(&self, table: &str, videoid: &str) -> Result<Option<VideoRecord>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(&format!(
                r#"
                SELECT videoid, title, description, likes, dislikes, views,
                       upload_date, author, subscriber_count, duration, duration_text,
                       channel_url, thumbnail_url, tags_json, thumbnails_json,
                       extras_json, sources_json
                FROM {table}
                WHERE videoid = ?1
                "#
            ))?;

            let mut rows = stmt.query([videoid])?;
            if let Some(row) = rows.next()? {
                Ok(Some(row_to_video_record(&row)?))
            } else {
                Ok(None)
            }
        })
    }
}

/// Converts a SQL row into a `VideoRecord`, deserializing the Vec/JSON fields.
fn row_to_video_record(row: &Row<'_>) -> Result<VideoRecord> {
    let tags_json: String = row.get("tags_json")?;
    let thumbnails_json: String = row.get("thumbnails_json")?;
    let extras_json: String = row.get("extras_json")?;
    let sources_json: String = row.get("sources_json")?;

    let tags: Vec<String> = serde_json::from_str(&tags_json).context("parsing stored tags JSON")?;
    let thumbnails: Vec<String> =
        serde_json::from_str(&thumbnails_json).context("parsing stored thumbnails JSON")?;
    let extras: serde_json::Value =
        serde_json::from_str(&extras_json).context("parsing stored extras JSON")?;
    let sources: Vec<VideoSource> =
        serde_json::from_str(&sources_json).context("parsing stored sources JSON")?;

    Ok(VideoRecord {
        videoid: row.get("videoid")?,
        title: row.get("title")?,
        description: row.get("description")?,
        likes: row.get("likes")?,
        dislikes: row.get("dislikes")?,
        views: row.get("views")?,
        upload_date: row.get("upload_date")?,
        author: row.get("author")?,
        subscriber_count: row.get("subscriber_count")?,
        duration: row.get("duration")?,
        duration_text: row.get("duration_text")?,
        channel_url: row.get("channel_url")?,
        thumbnail_url: row.get("thumbnail_url")?,
        tags,
        thumbnails,
        extras,
        sources,
    })
}

/// Converts a SQL row into a `CommentRecord` while normalizing the boolean flag
/// stored as an INTEGER in SQLite.
fn row_to_comment(row: &Row<'_>) -> Result<CommentRecord> {
    Ok(CommentRecord {
        id: row.get("id")?,
        videoid: row.get("videoid")?,
        author: row.get("author")?,
        text: row.get("text")?,
        likes: row.get("likes")?,
        time_posted: row.get("time_posted")?,
        parent_comment_id: row.get("parent_comment_id")?,
        status_likedbycreator: row
            .get::<_, i64>("status_likedbycreator")
            .map(|value| value != 0)?,
        reply_count: row.get("reply_count")?,
    })
}
