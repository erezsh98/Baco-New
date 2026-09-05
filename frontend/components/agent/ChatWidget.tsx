"use client";
import { useState } from "react";
import { X, Send } from "lucide-react";

type Message = { role: "user" | "assistant"; text: string };

// Chat-bot icon: a robot face inside a speech bubble. Uses currentColor so the
// button can tint it (court green). Eyes are knocked out to the button's bg.
function BotIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {/* side "ears" */}
      <circle cx="2.4" cy="10.5" r="1.4" fill="currentColor" />
      <circle cx="21.6" cy="10.5" r="1.4" fill="currentColor" />
      {/* head / speech bubble */}
      <rect x="3.5" y="3.5" width="17" height="12.5" rx="5.5" fill="currentColor" />
      {/* tail (bottom-left) */}
      <path d="M8 14.5 L8 20 L13 15.5 Z" fill="currentColor" />
      {/* eyes */}
      <circle cx="9.5" cy="9.9" r="1.7" fill="#fff" />
      <circle cx="14.5" cy="9.9" r="1.7" fill="#fff" />
    </svg>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim()) return;
    const userMsg: Message = { role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const token = localStorage.getItem("access_token");
    // Login gate: the assistant is for signed-in users only.
    if (!token) {
      setMessages((prev) => [...prev, { role: "assistant", text: "כדי להשתמש בעוזר יש להתחבר לחשבון." }]);
      return;
    }
    setLoading(true);

    // Remember only the last 5 messages of context.
    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.text,
    })).slice(-5);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, token }),
      });
      const data = await res.json();
      if (!res.ok) {
        // login gate (401) / rate limit (429) / other — show the server message
        setMessages((prev) => [...prev, { role: "assistant", text: data.error || "שגיאה. נסו שוב." }]);
        return;
      }
      const text = data.content?.find((b: { type: string }) => b.type === "text")?.text || "סליחה, לא הצלחתי לעבד את הבקשה.";
      setMessages((prev) => [...prev, { role: "assistant", text }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "שגיאה בתקשורת עם השרת." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher — inline; placed in the navbar next to the menu icon. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="עוזר חכם"
        aria-expanded={open}
        className="grid place-items-center h-9 w-9 rounded-full text-court hover:bg-mint hover:text-court-dark transition"
      >
        <BotIcon size={26} />
      </button>

      {/* Chat panel — opens at the top-left, just under the navbar. */}
      {open && (
        <div className="fixed top-16 left-3 z-50 w-80 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-2xl ring-1 ring-line flex flex-col" style={{ height: 420 }}>
          <div className="bg-court text-white px-4 py-3 rounded-t-2xl flex justify-between items-center">
            <span className="font-semibold">עוזר</span>
            <button onClick={() => setOpen(false)} aria-label="סגור"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-muted text-sm text-center mt-4">שלום! אפשר לשאול אותי על מגרשים פנויים, ההזמנות שלך והכרטיסיות שלך.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                <div className={`rounded-xl px-3 py-2 text-sm max-w-[80%] ${m.role === "user" ? "bg-mint" : "bg-mint"}`}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && <p className="text-muted text-xs text-center">מעבד...</p>}
          </div>
          <div className="border-t p-3 flex gap-2">
            <input
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-court"
              placeholder="הקלד הודעה..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button onClick={send} className="bg-court text-white rounded-lg p-2 hover:bg-court-dark">
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
