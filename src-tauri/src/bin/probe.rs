//! Command-line check of import and translation without the GUI.
//!
//! nanran-probe parse <arxiv-id | file.pdf>            print block statistics
//! nanran-probe translate <arxiv-id | file.pdf> [n]    translate the first n units (default 6)
//! nanran-probe dump <arxiv-id | file.pdf>             print every block on one line
//! nanran-probe import <arxiv-id | file.pdf> <dir> [n] save into a library dir with n translated units

use nanran::model::{Block, Builder, Doc};
use std::sync::atomic::AtomicBool;

fn load(arg: &str) -> Doc {
    if arg.ends_with(".pdf") {
        let bytes = std::fs::read(arg).expect("read pdf");
        let b: Builder = nanran::pdf::parse(&bytes).expect("parse pdf");
        b.finish(format!("pdf-{}", nanran::model::content_id(&bytes)), arg)
    } else {
        let id = nanran::arxiv::parse_id(arg).expect("arxiv id");
        nanran::arxiv::fetch(&id).expect("fetch")
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (cmd, target) = (args[1].as_str(), args[2].as_str());
    let doc = load(target);
    let mut counts = std::collections::BTreeMap::new();
    let mut embedded = 0;
    for b in &doc.blocks {
        let k = match b {
            Block::Heading { .. } => "heading",
            Block::Para { .. } => "para",
            Block::Static { .. } => "static",
            Block::Figure { images, .. } => {
                embedded += images.iter().filter(|i| i.starts_with("data:")).count();
                "figure"
            }
            Block::Equation { .. } => "equation",
            Block::Table { .. } => "table",
        };
        *counts.entry(k).or_insert(0) += 1;
    }
    let units = doc.units();
    let sentences: usize = units.iter().map(|u| u.sentences.len()).sum();
    println!("title: {}", doc.title);
    println!("source: {}", doc.source);
    println!("blocks: {counts:?}");
    println!(
        "units: {} sentences: {sentences} math: {} embedded images: {embedded}",
        units.len(),
        doc.math.len()
    );
    for b in doc
        .blocks
        .iter()
        .filter(|b| matches!(b, Block::Heading { .. }))
        .take(40)
    {
        if let Block::Heading { level, unit } = b {
            println!(
                "  {}{}",
                "  ".repeat(*level as usize - 1),
                unit.sentences.join(" ")
            );
        }
    }
    if cmd == "dump" {
        for b in &doc.blocks {
            let line = match b {
                Block::Heading { level, unit } => {
                    format!("H{level} {}", unit.sentences.join(" | "))
                }
                Block::Para { unit } => format!("P  {}", unit.sentences.join(" | ")),
                Block::Static { text, code } => {
                    format!("S{} {text}", if *code { "c" } else { " " })
                }
                Block::Figure { images, caption } => format!(
                    "F  {} imgs; {:?}",
                    images.len(),
                    caption.as_ref().map(|c| &c.sentences)
                ),
                Block::Equation { tex } => format!("E  {}", tex.join(" \\\\ ")),
                Block::Table { caption, rows } => format!(
                    "T  {}x{}; {:?}",
                    rows.len(),
                    rows.first().map_or(0, |r| r.len()),
                    caption.as_ref().map(|c| &c.sentences)
                ),
            };
            println!("{}", line.chars().take(220).collect::<String>());
        }
    }
    if cmd == "job" {
        // Runs the same background job the app starts, on a library dir.
        let dir = std::path::PathBuf::from(&args[3]);
        let state = std::sync::Arc::new(nanran::AppState::new(dir).expect("state"));
        state.library.save(&doc).expect("save");
        let started = std::time::Instant::now();
        nanran::commands::start_translation(&state, doc.id.clone()).expect("start");
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let s = nanran::commands::status(&state, &doc.id);
            println!(
                "{:>4.0}s batches {}/{} units {} running {} error {:?}",
                started.elapsed().as_secs_f32(),
                s.done,
                s.total,
                s.units.len(),
                s.running,
                s.error
            );
            if !s.running {
                let bad = doc
                    .units()
                    .iter()
                    .filter(|u| {
                        s.units
                            .get(&u.id)
                            .is_none_or(|k| k.len() != u.sentences.len())
                    })
                    .count();
                println!(
                    "units {} translated {} misaligned-or-missing {bad}",
                    doc.units().len(),
                    s.units.len()
                );
                return;
            }
        }
    }
    if cmd == "import" {
        let dir = std::path::PathBuf::from(&args[3]);
        let n: usize = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(20);
        let lib = nanran::library::Library::open(dir).expect("library");
        lib.save(&doc).expect("save");
        let claude = nanran::translate::find_claude().expect("claude cli");
        let pending: Vec<_> = units.into_iter().take(n).cloned().collect();
        for batch in nanran::translate::batches(&pending) {
            let ko = nanran::translate::translate_batch(
                &claude,
                &doc.title,
                &batch,
                &AtomicBool::new(false),
            )
            .expect("translate");
            lib.add_translations(&doc.id, &ko)
                .expect("save translations");
        }
        println!(
            "saved {} with {} translated units",
            doc.id,
            lib.translations(&doc.id).len()
        );
        return;
    }
    if cmd == "translate" {
        let n: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(6);
        let claude = nanran::translate::find_claude().expect("claude cli");
        let batch: Vec<_> = units.into_iter().take(n).cloned().collect();
        let started = std::time::Instant::now();
        let ko = nanran::translate::translate_batch(
            &claude,
            &doc.title,
            &batch,
            &AtomicBool::new(false),
        )
        .expect("translate");
        println!("translated {} units in {:?}", ko.len(), started.elapsed());
        for (en, ko) in batch.iter().zip(&ko) {
            for (e, k) in en.sentences.iter().zip(&ko.sentences) {
                println!("EN {e}\nKO {k}\n");
            }
        }
    }
}
