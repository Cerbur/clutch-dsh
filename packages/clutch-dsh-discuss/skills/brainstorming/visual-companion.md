# Visual Companion Guide

Browser-based visual brainstorming companion for showing mockups, diagrams, and options.

## When to Use

Decide per question, not per session. Use the browser when the content itself is visual: UI mockups, architecture diagrams, side-by-side visual comparisons, design polish, and spatial relationships. Use the terminal for requirements, conceptual choices, trade-off lists, technical decisions, and ordinary clarifying questions.

A question about a UI topic is not automatically visual. Use a browser when the user would understand the question better by seeing it than by reading it.

## How It Works

The server watches a directory for HTML files and serves the newest one to the browser. Write a content fragment into `screen_dir`; the server wraps it with the frame template and records clicks in `state_dir/events` as JSON lines.

```text
scripts/start-server.sh --project-dir /path/to/project --open
```

The startup JSON contains `url`, `screen_dir`, and `state_dir`. Keep the complete URL, including its session key. With `--project-dir`, screens persist under `.superpowers/brainstorm/`; add that directory to `.gitignore` when appropriate.

## The Loop

1. Confirm `server-info` exists and `server-stopped` does not before referring to the URL or pushing a screen.
2. Write a new semantic HTML filename for each screen. Never reuse a filename; use suffixes such as `layout-v2.html` for iterations.
3. Tell the user what is shown and ask them to inspect or select an option.
4. On the next turn, read `state_dir/events` if it exists and combine it with the user's terminal feedback.
5. Iterate when feedback changes the current screen. When moving back to text-only discussion, push a waiting screen so the browser does not show stale choices.

## Writing Content Fragments

Write only the content inside the page. The server provides the frame, theme, and helper script.

```html
<h2>Which layout works better?</h2>
<p class="subtitle">Consider readability and visual hierarchy</p>

<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Single Column</h3>
      <p>Clean, focused reading experience</p>
    </div>
  </div>
</div>
```

The frame provides `.options`, `.cards`, `.mockup`, `.split`, `.pros-cons`, `.mock-nav`, `.mock-sidebar`, `.mock-content`, `.mock-button`, `.mock-input`, `.placeholder`, `.subtitle`, `.section`, and `.label`. Add `data-multiselect` to an options container for multi-select behavior.

## Browser Events

Events are one JSON object per line, for example:

```jsonl
{
  "type": "click",
  "choice": "a",
  "text": "Option A - Simple Layout",
  "timestamp": 1706000101
}
```

The complete stream shows exploration order. The last choice is usually the final selection, but hesitation can also be useful feedback.

## Design Tips

- Scale fidelity to the question.
- Explain the question on every screen.
- Iterate before advancing.
- Show two to four options at most.
- Use real content when it affects the decision.
- Keep mockups simple and focused on structure.

## Cleaning Up

```text
scripts/stop-server.sh $SESSION_DIR
```

## Reference

The frame template and helper script are the source for available CSS classes and client-side behavior.
