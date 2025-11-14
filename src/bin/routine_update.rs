//! Helper binary that re-runs the downloader for every channel already present
//! on disk. Acts like a nightly cron job.

use anyhow::{Context, Result, bail};
use newtube_tools::metadata::MetadataStore;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::env;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

const BASE_DIR: &str = "/yt";
const VIDEOS_SUBDIR: &str = "videos";
const SHORTS_SUBDIR: &str = "shorts";
const WWW_ROOT: &str = "/www/newtube.com";
const METADATA_DB_FILE: &str = "metadata.db";

/// Only grab the small subset of fields we need from `.info.json`.
#[derive(Deserialize)]
struct MinimalInfo {
    channel_url: Option<String>,
    uploader_url: Option<String>,
}

/// Scans on-disk metadata, identifies unique channels, and launches
/// `download_channel` for each.
fn main() -> Result<()> {
    let metadata_path = Path::new(WWW_ROOT).join(METADATA_DB_FILE);
    let _metadata =
        MetadataStore::open(&metadata_path).context("initializing metadata database")?;

    let base_dir = PathBuf::from(BASE_DIR);
    let videos_dir = base_dir.join(VIDEOS_SUBDIR);
    let shorts_dir = base_dir.join(SHORTS_SUBDIR);

    let mut channels = BTreeMap::new();
    collect_channels(&videos_dir, &mut channels)?;
    collect_channels(&shorts_dir, &mut channels)?;

    if channels.is_empty() {
        println!(
            "No previously downloaded channels found in {}.",
            base_dir.display()
        );
        return Ok(());
    }

    let downloader = find_download_channel_executable()?;

    let scheduled: Vec<String> = channels.values().cloned().collect();
    println!("Found {} channel(s) to update.", scheduled.len());
    println!("Channels queued for refresh:");
    for channel in &scheduled {
        println!("  - {}", channel);
    }

    for (index, channel) in scheduled.iter().enumerate() {
        let current = index + 1;
        println!();
        println!(
            "[{}/{}] Updating channel: {}",
            current,
            scheduled.len(),
            channel
        );

        match Command::new(&downloader).arg(channel).status() {
            Ok(status) if status.success() => {
                println!("  Completed update for {}", channel);
            }
            Ok(status) => {
                eprintln!(
                    "  Warning: downloader exited with status {} for {}",
                    status, channel
                );
            }
            Err(err) => {
                eprintln!(
                    "  Warning: failed to run downloader for {}: {}",
                    channel, err
                );
            }
        }
    }

    println!();
    println!("All channel updates complete.");

    Ok(())
}

/// Walks a directory tree looking for `*.info.json` files and extracts the
/// original channel URL so we can re-run downloads later.
fn collect_channels(root: &Path, channels: &mut BTreeMap<String, String>) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
    {
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        if !entry.file_name().to_string_lossy().ends_with(".info.json") {
            continue;
        }

        // Each `.info.json` contains the original uploader metadata, so we read
        // just enough fields to recover a canonical channel URL.
        if let Some(url) = extract_channel_url(entry.path())? {
            let canonical = canonicalize_channel_url(&url);
            channels.entry(canonical).or_insert(url);
        }
    }

    Ok(())
}

/// Reads the minimal metadata needed to figure out which channel a video
/// belongs to.
fn extract_channel_url(path: &Path) -> Result<Option<String>> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(err) => {
            eprintln!("  Warning: could not open {}: {}", path.display(), err);
            return Ok(None);
        }
    };
    let reader = BufReader::new(file);

    match serde_json::from_reader::<_, MinimalInfo>(reader) {
        Ok(info) => {
            let url = info.channel_url.or(info.uploader_url);
            Ok(url.map(|u| u.trim().to_owned()))
        }
        Err(err) => {
            eprintln!("  Warning: could not parse {}: {}", path.display(), err);
            Ok(None)
        }
    }
}

/// Returns a lowercase, slash-normalized version of the channel URL for
/// deduplication.
fn canonicalize_channel_url(url: &str) -> String {
    let trimmed = url.trim();
    let without_slash = trimmed.trim_end_matches('/');
    without_slash.to_ascii_lowercase()
}

/// Finds the `download_channel` executable either via Cargo's env var or by
/// looking next to the current binary (assuming `cargo install`/`cargo build`).
fn find_download_channel_executable() -> Result<PathBuf> {
    if let Ok(path) = env::var("CARGO_BIN_EXE_download_channel") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }

    let mut sibling = env::current_exe().context("locating routine_update executable")?;
    sibling.set_file_name("download_channel");
    if sibling.exists() {
        return Ok(sibling);
    }

    bail!("download_channel binary not found. Build it with `cargo build --bin download_channel`.");
}
