export const PAGE_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>twit</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1f2328;
    background: #f4f5f7;
  }
  .app { display: flex; height: 100%; }
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .list-pane {
    width: 340px;
    flex-shrink: 0;
    border-right: 1px solid #e2e4e8;
    background: #fff;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid #eceef1;
  }
  #thread-count { font-weight: 650; }
  #refresh {
    font: inherit;
    cursor: pointer;
    border: 1px solid #cfd3d8;
    background: #fafbfc;
    border-radius: 6px;
    padding: 4px 10px;
  }
  #refresh:hover { background: #f0f2f4; }
  #thread-list { flex: 1; overflow: auto; }
  .thread-item {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    border: 0;
    border-bottom: 1px solid #f0f1f3;
    background: transparent;
    padding: 12px 14px;
    cursor: pointer;
  }
  .thread-item:hover { background: #f7f8fa; }
  .thread-item.selected { background: #eaf1ff; }
  .thread-item .subject { font-weight: 650; }
  .thread-item .meta,
  .thread-item .preview,
  .thread-item .time {
    color: #656d76;
    font-size: 12px;
    margin-top: 4px;
  }
  .thread-item .preview {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #thread-view {
    flex: 1;
    min-width: 0;
  }
  #thread-header {
    padding: 16px 20px;
    border-bottom: 1px solid #eceef1;
    background: #fff;
  }
  #thread-header:empty { display: none; }
  #thread-header .subject { font-size: 18px; font-weight: 650; }
  #thread-header .range,
  #thread-header .people {
    color: #656d76;
    font-size: 13px;
    margin-top: 4px;
  }
  #empty-hint {
    margin: 28px 20px;
    color: #656d76;
  }
  #thread-messages {
    flex: 1;
    overflow: auto;
    padding: 16px 20px 32px;
  }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 12px;
  }
  .card .fromto { font-weight: 650; }
  .card .meta {
    color: #656d76;
    font-size: 12px;
    margin: 4px 0 8px;
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    margin-left: 6px;
    background: #f0f1f3;
  }
  .badge.unread { background: #ffe9c7; color: #7a4d00; }
  .badge.archived { background: #ececec; }
  .msg-body { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<div class="app">
  <aside class="pane list-pane">
    <div class="toolbar">
      <span id="thread-count">대화 0</span>
      <button type="button" id="refresh">새로고침</button>
    </div>
    <div id="thread-list"></div>
  </aside>
  <section class="pane" id="thread-view">
    <div id="thread-header"></div>
    <p id="empty-hint" hidden></p>
    <div id="thread-messages"></div>
  </section>
</div>
<script>
function setText(el, value) { el.textContent = value ?? '' }

function el(tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

let selectedId = null
const threadList = document.getElementById('thread-list')
const threadCount = document.getElementById('thread-count')
const threadHeader = document.getElementById('thread-header')
const threadMessages = document.getElementById('thread-messages')
const emptyHint = document.getElementById('empty-hint')
const refresh = document.getElementById('refresh')

function markSelected(id) {
  selectedId = id
  for (const node of threadList.children) {
    node.classList.toggle('selected', node.getAttribute('data-id') === id)
  }
}

function renderList(threads) {
  threadList.replaceChildren()
  for (const t of threads) {
    const item = el('button', 'thread-item')
    item.type = 'button'
    item.setAttribute('data-id', t.thread_id)
    if (t.thread_id === selectedId) item.classList.add('selected')

    const subject = el('div', 'subject')
    setText(subject, t.subject)
    const meta = el('div', 'meta')
    setText(meta, t.participants.join(', ') + ' · ' + t.message_count + '통')
    const preview = el('div', 'preview')
    setText(preview, t.preview)
    const time = el('div', 'time')
    setText(time, t.last_at)

    item.append(subject, meta, preview, time)
    item.addEventListener('click', function () {
      loadThread(t.thread_id)
    })
    threadList.append(item)
  }
}

function renderHeader(thread) {
  threadHeader.replaceChildren()
  const subject = el('div', 'subject')
  setText(subject, thread.subject)
  const range = el('div', 'range')
  const first = thread.messages[0]
  const last = thread.messages[thread.messages.length - 1]
  setText(range, first && last ? first.id + ' → ' + last.id : '')
  const people = el('div', 'people')
  setText(people, thread.participants.join(', '))
  threadHeader.append(subject, range, people)
}

function renderMessages(messages) {
  threadMessages.replaceChildren()
  for (const m of messages) {
    const card = el('article', 'card')
    const fromto = el('div', 'fromto')
    setText(fromto, m.sender + ' → ' + m.recipient)

    const meta = el('div', 'meta')
    const idNode = el('span')
    setText(idNode, m.id)
    const timeNode = el('span')
    setText(timeNode, m.created_at)
    meta.append(idNode, document.createTextNode(' · '), timeNode)
    if (!m.read) {
      const badge = el('span', 'badge unread')
      setText(badge, '미읽음')
      meta.append(badge)
    }
    if (m.archived) {
      const badge = el('span', 'badge archived')
      setText(badge, '보관')
      meta.append(badge)
    }

    const body = el('div', 'msg-body')
    setText(body, m.body)
    card.append(fromto, meta, body)
    threadMessages.append(card)
  }
  threadMessages.scrollTop = 0
}

function showEmpty() {
  selectedId = null
  setText(threadCount, '대화 0')
  threadHeader.replaceChildren()
  threadMessages.replaceChildren()
  emptyHint.hidden = false
  setText(emptyHint, '표시할 대화가 없습니다.')
}

async function loadThread(id) {
  const res = await fetch('/api/threads/' + encodeURIComponent(id))
  if (!res.ok) return
  const thread = await res.json()
  markSelected(thread.thread_id)
  emptyHint.hidden = true
  renderHeader(thread)
  renderMessages(thread.messages)
}

async function loadList() {
  const data = await fetch('/api/threads').then((r) => r.json())
  setText(threadCount, '대화 ' + data.threads.length)
  renderList(data.threads)
  if (selectedId && data.threads.some((t) => t.thread_id === selectedId)) {
    await loadThread(selectedId)
  } else if (data.threads[0]) {
    await loadThread(data.threads[0].thread_id)
  } else {
    showEmpty()
  }
}

refresh.onclick = loadList
window.addEventListener('load', loadList)
</script>
</body>
</html>
`
