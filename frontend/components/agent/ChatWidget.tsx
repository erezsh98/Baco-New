"use client";
import { useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";

type Message = { role: "user" | "assistant"; text: string };

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
    setLoading(true);

    const token = localStorage.getItem("access_token");
    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.text,
    }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, token }),
      });
      const data = await res.json();
      const text = data.content?.find((b: { type: string }) => b.type === "text")?.text || "סליחה, לא הצלחתי לעבד את הבקשה.";
      setMessages((prev) => [...prev, { role: "assistant", text }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "שגיאה בתקשורת עם השרת." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-6 left-6 z-50">
      {open ? (
        <div className="bg-white rounded-2xl shadow-2xl w-80 max-w-[calc(100vw-3rem)] flex flex-col" style={{ height: 420 }}>
          <div className="bg-court text-white px-4 py-3 rounded-t-2xl flex justify-between items-center">
            <span className="font-semibold">עוזר TennisLine</span>
            <button onClick={() => setOpen(false)}><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 && (
              <p className="text-muted text-sm text-center mt-4">שלום! איך אוכל לעזור לך להזמין מגרש?</p>
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
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="bg-court text-white rounded-full p-4 shadow-xl hover:bg-court-dark transition"
        >
          <MessageCircle size={24} />
        </button>
      )}
    </div>
  );
}
