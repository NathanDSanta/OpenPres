import { useEffect, useRef, useState } from "react";
import { Ban, Clock, MessageSquare, MoreHorizontal, RefreshCw, Send, Trash2 } from "lucide-react";
import { useLive, youtubeApi } from "@/api";
import { useMenu } from "@/components/ui/Menu";
import { notifyError, useDialogs } from "@/state/Dialogs";
import type { ChatMessage } from "@/types";

/** The live chat of the broadcast: read, answer and moderate (like OBS's chat dock). */
export default function YoutubeChat() {
  const { data: status, setData: setStatus } = useLive(() => youtubeApi.status());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const since = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const menu = useMenu();
  const { confirm } = useDialogs();
  const chatId = status?.broadcast?.live_chat_id ?? "";

  useEffect(() => {
    setMessages([]);
    since.current = 0;
    if (!chatId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const page = await youtubeApi.chat(since.current);
        if (stopped) return;
        setError(page.error);
        if (page.messages.length) {
          setMessages((old) => {
            const byId = new Map(old.map((m) => [m.id, m]));
            for (const m of page.messages) byId.set(m.id, m);
            return [...byId.values()].sort((a, b) => a.seq - b.seq).slice(-500);
          });
          since.current = page.last_seq;
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const t = setInterval(poll, 2500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [chatId]);

  useEffect(() => {
    if (atBottom.current) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await youtubeApi.send(text);
      setText("");
    } catch (e) {
      notifyError(e);
    } finally {
      setSending(false);
    }
  };

  const moderate = (m: ChatMessage, anchor: HTMLElement) =>
    menu.open(anchor, [
      {
        key: "delete",
        label: "Delete message",
        icon: <Trash2 size={13} />,
        onSelect: () =>
          void youtubeApi
            .remove(m.id)
            .then(() => setMessages((all) => all.map((x) => (x.id === m.id ? { ...x, deleted: true } : x))))
            .catch(notifyError),
      },
      { key: "timeout", label: `Hide ${m.author_name} for 5 minutes`, icon: <Clock size={13} />, onSelect: () => void youtubeApi.ban(m.author_channel_id, 300).catch(notifyError) },
      {
        key: "ban",
        label: `Ban ${m.author_name}`,
        danger: true,
        icon: <Ban size={13} />,
        onSelect: () =>
          void confirm({ title: `Ban ${m.author_name}?`, message: "They can no longer write in your chats.", confirmLabel: "Ban", danger: true }).then((ok) => {
            if (ok) void youtubeApi.ban(m.author_channel_id).catch(notifyError);
          }),
      },
    ]);

  return (
    <section className="panel live-chat">
      <header className="panel-header">
        <h2>
          <MessageSquare size={15} /> Live chat
        </h2>
        <button className="icon-btn" title="Look for the broadcast again" onClick={() => void youtubeApi.refreshBroadcast().then(setStatus).catch(notifyError)}>
          <RefreshCw size={14} />
        </button>
      </header>
      {!status ? (
        <div className="empty">Loading…</div>
      ) : !status.configured || !status.connected ? (
        <div className="empty live-chat-empty">
          <MessageSquare size={26} />
          <strong>Connect your YouTube account</strong>
          <span>In Settings → YouTube. The chat, your broadcast and its stream key then appear here.</span>
        </div>
      ) : !status.broadcast ? (
        <div className="empty live-chat-empty">
          <strong>No live or scheduled broadcast</strong>
          <span>Schedule one in YouTube Studio (or start streaming with the auto-start stream key), then refresh.</span>
          {status.chat_error && <span className="error-text small">{status.chat_error}</span>}
        </div>
      ) : (
        <>
          <div className="live-chat-broadcast">
            <strong title={status.broadcast.title}>{status.broadcast.title}</strong>
            <span className={`chip live-status ${status.broadcast.status}`}>{status.broadcast.status || "unknown"}</span>
          </div>
          <div
            className="live-chat-list"
            ref={list}
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg${m.deleted ? " deleted" : ""}${m.amount ? " super" : ""}`}>
                {m.author_image ? <img className="chat-avatar" src={m.author_image} alt="" referrerPolicy="no-referrer" /> : <span className="chat-avatar" />}
                <div className="chat-body">
                  <span className={`chat-author${m.is_owner ? " owner" : m.is_moderator ? " mod" : m.is_member ? " member" : ""}`}>
                    {m.author_name}
                    {m.amount && <b className="chat-amount">{m.amount}</b>}
                  </span>
                  <span className="chat-text">{m.deleted ? "Message deleted" : m.text}</span>
                </div>
                {!m.is_owner && !m.deleted && (
                  <button className="icon-btn chat-more" onClick={(e) => moderate(m, e.currentTarget)} title="Moderate">
                    <MoreHorizontal size={14} />
                  </button>
                )}
              </div>
            ))}
            {messages.length === 0 && <div className="empty">No messages yet.</div>}
          </div>
          {error && <div className="live-chat-error">{error}</div>}
          <div className="live-chat-input">
            <input
              className="input"
              value={text}
              maxLength={200}
              placeholder={`Chat as ${status.channel_title || "your channel"}…`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
            <button className="btn btn-primary btn-icon" disabled={sending || !text.trim()} onClick={() => void send()} title="Send">
              <Send size={15} />
            </button>
          </div>
        </>
      )}
      {menu.element}
    </section>
  );
}
