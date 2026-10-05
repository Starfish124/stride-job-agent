//! jobflow: the job agent, live in the terminal.
//!
//! Reads the server's `/api/stream` (every agent event, plus job counts) and
//! draws people → agents as a rataflow graph, with the raw event feed below.
//! Read-only: nothing here starts, stops or changes anything.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

use rataflow::{Edge, FitViewOptions, Flow, FlowEvent, Node, StepEdge, TextContent};
use ratatui::crossterm::event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind};
use ratatui::crossterm::execute;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, List, ListItem, Paragraph, Sparkline};
use ratatui::{DefaultTerminal, Frame};
use serde::Deserialize;

const DEFAULT_URL: &str = "http://127.0.0.1:7420";
const RUNS_PER_PERSON: usize = 3;
const MAX_FEED: usize = 800;

#[derive(Deserialize, Clone)]
struct RunInfo {
    id: String,
    task: String,
    #[serde(rename = "personId")]
    person_id: String,
    status: String,
    job: String,
}

#[derive(Deserialize, Clone)]
struct AgentEvent {
    kind: String,
    text: String,
}

#[derive(Deserialize)]
struct EventMsg {
    run: RunInfo,
    event: AgentEvent,
    /// Local wall-clock time, formatted by the server.
    t: String,
}

#[derive(Deserialize, Clone, Default)]
struct Stat {
    id: String,
    name: String,
    jobs: u64,
    filtered: u64,
    scored: u64,
    drafted: u64,
    waiting: u64,
    applied: u64,
}

impl Stat {
    fn fields(&self) -> [(&'static str, u64); 6] {
        [
            ("jobs", self.jobs),
            ("filtered", self.filtered),
            ("scored", self.scored),
            ("drafted", self.drafted),
            ("waiting", self.waiting),
            ("applied", self.applied),
        ]
    }
}

enum Msg {
    Connected,
    Live,
    Down(String),
    Stats(Vec<Stat>),
    Event(EventMsg),
}

/// Background thread: hold the SSE stream open, reconnect forever.
fn listen(url: String, tx: Sender<Msg>) {
    loop {
        let result = ureq::get(&format!("{url}/api/stream")).call();
        match result {
            Ok(resp) => {
                if tx.send(Msg::Connected).is_err() {
                    return;
                }
                let reader = BufReader::new(resp.into_body().into_reader());
                let mut kind = String::new();
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    if let Some(k) = line.strip_prefix("event: ") {
                        kind = k.to_string();
                    } else if let Some(d) = line.strip_prefix("data: ") {
                        let msg = match kind.as_str() {
                            "stats" => serde_json::from_str(d).ok().map(Msg::Stats),
                            "event" => serde_json::from_str(d).ok().map(Msg::Event),
                            "live" => Some(Msg::Live),
                            _ => None,
                        };
                        if let Some(m) = msg {
                            if tx.send(m).is_err() {
                                return;
                            }
                        }
                    }
                }
                if tx.send(Msg::Down("stream closed".into())).is_err() {
                    return;
                }
            }
            Err(e) => {
                if tx.send(Msg::Down(e.to_string())).is_err() {
                    return;
                }
            }
        }
        thread::sleep(Duration::from_secs(3));
    }
}

struct Run {
    info: RunInfo,
    last: String,
    events: u64,
    since: String,
}

struct FeedLine {
    run_id: String,
    person: String,
    task: String,
    t: String,
    kind: String,
    text: String,
}

struct App {
    url: String,
    conn: Result<(), String>,
    live: bool,
    stats: Vec<Stat>,
    flash: HashMap<(String, &'static str), Instant>,
    runs: Vec<Run>,
    feed: VecDeque<FeedLine>,
    focus: Option<String>,
    flow: Flow,
    shape: Vec<String>,
    activity: VecDeque<u64>,
    bucket_at: Instant,
    /// Height of the graph panel at the last draw: how many agent nodes fit unscaled.
    graph_rows: u16,
}

impl App {
    fn new(url: String) -> Self {
        Self {
            url,
            conn: Err("connecting…".into()),
            live: false,
            stats: Vec::new(),
            flash: HashMap::new(),
            runs: Vec::new(),
            feed: VecDeque::new(),
            focus: None,
            flow: Flow::with_graph(vec![], vec![]).expect("empty graph"),
            shape: Vec::new(),
            activity: VecDeque::from(vec![0; 60]),
            bucket_at: Instant::now(),
            graph_rows: 0,
        }
    }

    fn on(&mut self, msg: Msg) {
        match msg {
            // The server replays recent history on every connect: start clean.
            Msg::Connected => {
                self.conn = Ok(());
                self.live = false;
                self.runs.clear();
                self.feed.clear();
            }
            Msg::Live => self.live = true,
            Msg::Down(why) => self.conn = Err(why),
            Msg::Stats(new) => {
                let now = Instant::now();
                for s in &new {
                    let old = self.stats.iter().find(|o| o.id == s.id).cloned().unwrap_or_default();
                    for ((name, v), (_, was)) in s.fields().into_iter().zip(old.fields()) {
                        if v != was && !self.stats.is_empty() {
                            self.flash.insert((s.id.clone(), name), now);
                        }
                    }
                }
                self.stats = new;
            }
            Msg::Event(m) => {
                if self.live {
                    *self.activity.back_mut().unwrap() += 1;
                }
                let text = clean(&m.event.text);
                match self.runs.iter_mut().find(|r| r.info.id == m.run.id) {
                    Some(r) => {
                        r.info = m.run.clone();
                        r.events += 1;
                        r.last = text.clone();
                    }
                    None => self.runs.push(Run { info: m.run.clone(), last: text.clone(), events: 1, since: m.t.clone() }),
                }
                self.feed.push_back(FeedLine { run_id: m.run.id, person: m.run.person_id.to_uppercase(), task: m.run.task, t: m.t, kind: m.event.kind, text });
                if self.feed.len() > MAX_FEED {
                    self.feed.pop_front();
                }
            }
        }
    }

    fn tick(&mut self) {
        while self.bucket_at.elapsed() >= Duration::from_secs(1) {
            self.bucket_at += Duration::from_secs(1);
            self.activity.pop_front();
            self.activity.push_back(0);
        }
    }

    /// People in id order, each with the indices of their newest runs that get a node (oldest first).
    /// Everyone keeps a node; runs are trimmed, oldest first from whoever shows most, until the
    /// stack fits the panel unscaled: fit-view would otherwise zoom out and clip the text.
    fn groups(&self) -> Vec<(String, Vec<usize>)> {
        let mut ids: Vec<&str> = self.stats.iter().map(|s| s.id.as_str()).collect();
        ids.sort();
        let mut groups: Vec<(String, Vec<usize>)> = ids
            .into_iter()
            .map(|id| {
                let mine: Vec<usize> = (0..self.runs.len()).filter(|&i| self.runs[i].info.person_id == id).collect();
                (id.to_string(), mine[mine.len().saturating_sub(RUNS_PER_PERSON)..].to_vec())
            })
            .collect();
        let rows = |g: &[(String, Vec<usize>)]| g.iter().map(|(_, r)| r.len().max(1) * 6 + 1).sum::<usize>().saturating_sub(2);
        while rows(&groups) > self.graph_rows as usize {
            let Some(g) = groups.iter_mut().filter(|(_, r)| r.len() > 1).max_by_key(|(_, r)| r.len()) else { break };
            g.1.remove(0);
        }
        groups
    }

    fn shown_run_ids(&self) -> Vec<String> {
        self.groups().into_iter().flat_map(|(_, r)| r).map(|i| self.runs[i].info.id.clone()).collect()
    }

    /// Rebuild the graph when the set of nodes changes; otherwise just refresh the text in place.
    /// Laid out by hand: people on the left, each one's agents stacked beside them, newest on top.
    fn sync_flow(&mut self) {
        let groups = self.groups();
        let mut shape: Vec<String> = Vec::new();
        for (pid, runs) in &groups {
            shape.push(format!("p:{pid}"));
            shape.extend(runs.iter().map(|&i| format!("r:{}", self.runs[i].info.id)));
        }
        if shape != self.shape {
            let mut nodes: Vec<Node<TextContent>> = Vec::new();
            let mut edges: Vec<Edge<StepEdge>> = Vec::new();
            let mut y = 0.0;
            for (pid, runs) in &groups {
                let Some(s) = self.stats.iter().find(|s| &s.id == pid) else { continue };
                let height = runs.len().max(1) as f64 * 6.0 - 1.0;
                nodes.push(Node::new(format!("p:{pid}"), (0.0, y + (height - 5.0) / 2.0), (30.0, 5.0), person_content(s)));
                for (k, &i) in runs.iter().rev().enumerate() {
                    let r = &self.runs[i];
                    nodes.push(Node::new(format!("r:{}", r.info.id), (44.0, y + k as f64 * 6.0), (40.0, 5.0), run_content(r)));
                    edges.push(
                        Edge::new(format!("e:{}", r.info.id), format!("p:{pid}"), format!("r:{}", r.info.id))
                            .with_animated(r.info.status == "running"),
                    );
                }
                y += height + 2.0;
            }
            if let Ok(mut flow) = Flow::with_graph(nodes, edges) {
                flow.request_fit_view_with_options(FitViewOptions { max_zoom: Some(1.0), ..Default::default() });
                self.flow = flow;
                self.shape = shape;
                if let Some(id) = &self.focus {
                    self.flow.select_node(&format!("r:{id}"));
                }
            }
            return;
        }
        for s in &self.stats {
            if let Some(c) = self.flow.node_content_mut(&format!("p:{}", s.id)) {
                *c = person_content(s);
            }
        }
        let updates: Vec<(String, TextContent, bool)> = groups
            .iter()
            .flat_map(|(_, r)| r.iter())
            .map(|&i| {
                let r = &self.runs[i];
                (r.info.id.clone(), run_content(r), r.info.status == "running")
            })
            .collect();
        for (id, content, running) in updates {
            if let Some(c) = self.flow.node_content_mut(&format!("r:{id}")) {
                *c = content;
            }
            self.flow.set_edge_animated(&format!("e:{id}"), running);
        }
    }

    fn cycle_focus(&mut self) {
        let ids = self.shown_run_ids();
        self.focus = match &self.focus {
            None => ids.last().cloned(),
            Some(cur) => ids.iter().position(|i| i == cur).and_then(|p| p.checked_sub(1)).map(|p| ids[p].clone()),
        };
        self.flow.clear_selection();
        if let Some(id) = &self.focus {
            self.flow.select_node(&format!("r:{id}"));
        }
    }
}

fn status_color(status: &str) -> Color {
    match status {
        "running" => Color::Yellow,
        "done" => Color::Green,
        "failed" => Color::Red,
        _ => Color::DarkGray,
    }
}

fn task_color(task: &str) -> Color {
    match task {
        "search" => Color::Blue,
        "apply" => Color::Magenta,
        _ => Color::Cyan,
    }
}

fn person_content(s: &Stat) -> TextContent {
    TextContent::new(Text::from(vec![
        Line::from(format!("{} jobs · {} scored", s.jobs, s.scored)),
        Line::from(format!("{} drafted · {} applied", s.drafted, s.applied)),
        Line::from(format!("{} waiting · {} filtered", s.waiting, s.filtered)),
    ]))
    .with_title(format!(" {} · {} ", s.id.to_uppercase(), s.name))
    .with_border_style(Style::default().fg(Color::White).add_modifier(Modifier::BOLD))
}

fn run_content(r: &Run) -> TextContent {
    let what = if r.info.job.is_empty() { "Indeed · Glassdoor · Google Jobs".to_string() } else { r.info.job.clone() };
    TextContent::new(Text::from(vec![
        Line::from(cut(&what, 36)),
        Line::from(Span::styled(cut(&r.last, 36), Style::default().fg(Color::Gray))),
        Line::from(Span::styled(format!("{} events · since {}", r.events, r.since), Style::default().fg(Color::DarkGray))),
    ]))
    .with_title(format!(" {} · {} ", r.info.task.to_uppercase(), r.info.status))
    .with_border_style(Style::default().fg(status_color(&r.info.status)))
}

/// One line, without the tool-name noise.
fn clean(s: &str) -> String {
    s.replace("mcp__claude-in-chrome__", "").replace('\n', " ⏎ ")
}

fn cut(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n - 1).collect::<String>())
    }
}

fn draw(f: &mut Frame, app: &mut App) {
    let [header, graph, bottom] =
        Layout::vertical([Constraint::Length(1), Constraint::Percentage(58), Constraint::Fill(1)]).areas(f.area());
    let [feed_area, side] = Layout::horizontal([Constraint::Fill(1), Constraint::Length(34)]).areas(bottom);

    // header
    let running = app.runs.iter().filter(|r| r.info.status == "running").count();
    let (dot, state) = match &app.conn {
        Ok(()) => (Span::styled(" ● ", Style::default().fg(Color::Green)), "live".to_string()),
        Err(e) => (Span::styled(" ● ", Style::default().fg(Color::Red)), cut(e, 60)),
    };
    f.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(" jobflow ", Style::default().fg(Color::Black).bg(Color::Yellow).add_modifier(Modifier::BOLD)),
            dot,
            Span::raw(format!("{state}  {}   ", app.url.trim_start_matches("https://"))),
            Span::styled(format!("{running} agent(s) running"), Style::default().fg(if running > 0 { Color::Yellow } else { Color::DarkGray })),
            Span::styled("   q quit · tab focus an agent · f fit · +/- zoom · click a node", Style::default().fg(Color::DarkGray)),
        ])),
        header,
    );

    // graph
    let block = Block::bordered().title(" people → agents ").border_style(Style::default().fg(Color::DarkGray));
    let inner = block.inner(graph);
    app.graph_rows = inner.height;
    f.render_widget(block, graph);
    f.render_widget(&mut app.flow, inner);

    // feed
    let focus_name = app
        .focus
        .as_ref()
        .and_then(|id| app.runs.iter().find(|r| &r.info.id == id))
        .map(|r| format!("{} {}", r.info.task.to_uppercase(), cut(&r.info.job, 30)))
        .unwrap_or_else(|| "all agents".into());
    let rows = feed_area.height.saturating_sub(2) as usize;
    let lines: Vec<ListItem> = app
        .feed
        .iter()
        .filter(|l| app.focus.as_ref().is_none_or(|id| &l.run_id == id))
        .rev()
        .take(rows)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|l| {
            let color = match l.kind.as_str() {
                "tool" => Color::Cyan,
                "result" => Color::Green,
                "error" => Color::Red,
                "status" => Color::Yellow,
                _ => Color::White,
            };
            ListItem::new(Line::from(vec![
                Span::styled(format!("{} ", l.t), Style::default().fg(Color::DarkGray)),
                Span::styled(format!("{:<5}", cut(&l.person, 4)), Style::default().add_modifier(Modifier::BOLD)),
                Span::styled(format!("{:<8}", l.task), Style::default().fg(task_color(&l.task))),
                Span::styled(l.text.clone(), Style::default().fg(color)),
            ]))
        })
        .collect();
    f.render_widget(
        List::new(lines).block(Block::bordered().title(format!(" live feed · {focus_name} ")).border_style(Style::default().fg(Color::DarkGray))),
        feed_area,
    );

    // counts + activity
    let [counts, spark] = Layout::vertical([Constraint::Fill(1), Constraint::Length(5)]).areas(side);
    let mut text: Vec<Line> = Vec::new();
    for s in &app.stats {
        text.push(Line::from(Span::styled(format!("{} · {}", s.id.to_uppercase(), s.name), Style::default().add_modifier(Modifier::BOLD))));
        for (name, v) in s.fields() {
            let hot = app.flash.get(&(s.id.clone(), name)).is_some_and(|t| t.elapsed() < Duration::from_secs(3));
            let style = if hot { Style::default().fg(Color::Black).bg(Color::Yellow) } else { Style::default() };
            text.push(Line::from(vec![Span::raw(format!("  {name:<9}")), Span::styled(format!("{v:>5}"), style)]));
        }
    }
    f.render_widget(Paragraph::new(text).block(Block::bordered().title(" jobs ").border_style(Style::default().fg(Color::DarkGray))), counts);
    let data: Vec<u64> = app.activity.iter().copied().collect();
    f.render_widget(
        Sparkline::default()
            .block(Block::bordered().title(" events / second ").border_style(Style::default().fg(Color::DarkGray)))
            .data(&data)
            .style(Style::default().fg(Color::Yellow)),
        spark,
    );
}

fn run(terminal: &mut DefaultTerminal, app: &mut App, rx: Receiver<Msg>) -> std::io::Result<()> {
    let mut last = Instant::now();
    loop {
        while let Ok(m) = rx.try_recv() {
            app.on(m);
        }
        app.tick();
        app.sync_flow();
        app.flow.tick_animation(last.elapsed());
        last = Instant::now();
        terminal.draw(|f| draw(f, app))?;

        if event::poll(Duration::from_millis(50))? {
            loop {
                match event::read()? {
                    Event::Key(k) if k.kind == KeyEventKind::Press => match k.code {
                        KeyCode::Char('q') | KeyCode::Esc => return Ok(()),
                        KeyCode::Tab => app.cycle_focus(),
                        KeyCode::Char('f') => app.flow.request_fit_view_with_options(FitViewOptions { max_zoom: Some(1.0), ..Default::default() }),
                        KeyCode::Char('+') | KeyCode::Char('=') => app.flow.zoom_in(),
                        KeyCode::Char('-') => app.flow.zoom_out(),
                        _ => {}
                    },
                    Event::Mouse(m) => {
                        for e in app.flow.handle_mouse_event(m).into_events() {
                            if let FlowEvent::NodeClicked { node_id } = e {
                                app.focus = node_id.strip_prefix("r:").map(str::to_string);
                            }
                        }
                    }
                    _ => {}
                }
                if !event::poll(Duration::ZERO)? {
                    break;
                }
            }
        }
    }
}

fn main() -> std::io::Result<()> {
    let url = std::env::args().nth(1).or_else(|| std::env::var("JOBFLOW_URL").ok()).unwrap_or_else(|| DEFAULT_URL.into());
    let (tx, rx) = mpsc::channel();
    let u = url.clone();
    thread::spawn(move || listen(u, tx));

    let mut terminal = ratatui::init();
    execute!(std::io::stdout(), EnableMouseCapture)?;
    let result = run(&mut terminal, &mut App::new(url), rx);
    execute!(std::io::stdout(), DisableMouseCapture)?;
    ratatui::restore();
    result
}
