import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // Identity-linked API keys must say which workspace the request runs in. Set
  // ANTHROPIC_WORKSPACE_ID for such a key; harmless (omitted) for a plain
  // workspace-scoped key.
  ...(process.env.ANTHROPIC_WORKSPACE_ID
    ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
    : {}),
});
const MODEL = "claude-haiku-4-5";

// Simple in-memory per-user rate limit. Fine for a single frontend instance;
// if the frontend is ever scaled out, move this to a shared store (Redis).
const WINDOW_MS = 60_000;    // 1-minute sliding window
const MAX_PER_WINDOW = 5;    // messages per user per window
const hits = new Map<number, number[]>();
function rateLimited(userId: number): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(userId, recent); return true; }
  recent.push(now);
  hits.set(userId, recent);
  return false;
}

const tools: Anthropic.Tool[] = [
  {
    name: "search_courts",
    description: "Search for available tennis courts by date, time, and area",
    input_schema: {
      type: "object" as const,
      properties: {
        from_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        to_date: { type: "string", description: "End date (YYYY-MM-DD)" },
        from_hour: { type: "number", description: "Earliest hour (0-23)" },
        to_hour: { type: "number", description: "Latest hour (0-23)" },
        area_id: { type: "number", description: "Area ID to filter by" },
        club_id: { type: "number", description: "Club ID to filter by (use the clubs list in the system prompt to map a club name to its id)" },
      },
      required: ["from_date", "to_date"],
    },
  },
  {
    name: "get_my_bookings",
    description: "Get the user's upcoming bookings",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_my_tickets",
    description:
      "Get the user's tickets: punch cards (כרטיסיות), subscriptions (מנוי) and refund credits (זיכוי). " +
      "Each item has club_name, ticket_type (מנוי/זיכוי or a punch-card name), punches_left, unlimited, valid_until and is_valid. " +
      "Use this to answer what punch cards the user has, where they are a מנוי, or whether they have a זיכוי in a given club.",
    input_schema: {
      type: "object" as const,
      properties: {
        club_id: { type: "number", description: "Optional club ID to filter to one club (map a club name via the clubs list in the system prompt)" },
        include_all: { type: "boolean", description: "Set true to also include expired / used-up tickets (default false = only currently valid)" },
      },
      required: [],
    },
  },
];

export async function POST(req: NextRequest) {
  const { messages, token } = await req.json();
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

  // Login gate — verify the session against the backend BEFORE spending any
  // Anthropic tokens, so anonymous/forged callers can't run up the bill.
  if (!token) {
    return NextResponse.json({ error: "כדי להשתמש בעוזר יש להתחבר לחשבון." }, { status: 401 });
  }
  let userId: number;
  try {
    const meRes = await fetch(`${backendUrl}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) {
      return NextResponse.json({ error: "כדי להשתמש בעוזר יש להתחבר לחשבון." }, { status: 401 });
    }
    userId = (await meRes.json()).id;
  } catch {
    return NextResponse.json({ error: "שגיאת אימות. נסו שוב מאוחר יותר." }, { status: 502 });
  }

  // Rate limit per authenticated user.
  if (rateLimited(userId)) {
    return NextResponse.json({ error: "שלחת יותר מדי הודעות. המתן/י רגע ונסה/י שוב." }, { status: 429 });
  }

  // Conversation memory: keep only the last 5 messages as context (and it must
  // start with a user turn for the Anthropic API).
  const history = (Array.isArray(messages) ? messages : []).slice(-5);
  while (history.length && history[0].role !== "user") history.shift();

  // Give the model today's date and the club list so it resolves "today" and
  // club names itself instead of asking the user.
  const today = new Date().toISOString().slice(0, 10);
  let clubsLine = "";
  try {
    const cRes = await fetch(`${backendUrl}/clubs`);
    if (cRes.ok) clubsLine = (await cRes.json()).map((c: { id: number; club_name: string }) => `${c.club_name} (id ${c.id})`).join(", ");
  } catch { /* ignore — search still works without the map */ }

  const system = `אתה העוזר החכם של BACO — מערכת להזמנת מגרשי טניס אונליין.
אתה עוזר מידע בלבד: אתה עונה על שאלות ומספק מידע, אך אינך מבצע שום פעולה שמשנה נתונים.
אתה יכול: לחפש מגרשים פנויים לפי תאריך/שעה/מועדון, להציג את ההזמנות העתידיות של המשתמש, ולהציג את הכרטיסיות שלו — כולל כרטיסיות ניקוב, מנויים (מנוי) וזיכויים (זיכוי) לפי מועדון.
אתה לא: מזמין מגרשים, מבטל הזמנות, רוכש כרטיסיות, או מבצע כל שינוי אחר. אם מבקשים ממך פעולה כזו, הסבר בנימוס שאתה עוזר מידע בלבד ושהמשתמש יכול לבצע את הפעולה בעצמו במסכי האתר.
כדי לענות על "אילו כרטיסיות יש לי", "היכן אני מנוי", או "האם יש לי זיכוי במועדון X" — השתמש בכלי get_my_tickets (עם club_id של אותו מועדון במידת הצורך).
כשמברכים אותך לשלום, קבל את המשתמש בברכה: "ברוך הבא ל-BACO 🎾".
התאריך היום הוא ${today}. פענח בעצמך ביטויי זמן יחסיים ("היום", "מחר", "סוף השבוע") לתאריכים בפורמט YYYY-MM-DD — אל תבקש מהמשתמש להזין תאריך אם אפשר להסיק אותו.
מועדונים זמינים: ${clubsLine || "—"}. כשמשתמש מציין שם מועדון, השתמש ב-club_id המתאים.
בחיפוש ליום בודד, קבע to_date שווה ל-from_date.
ענה תמיד בעברית. היה קצר וברור.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system,
    tools,
    messages: history,
  });

  // Handle tool calls by forwarding to backend API
  if (response.stop_reason === "tool_use") {
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        let result = {};
        try {
          const headers = token ? { Authorization: `Bearer ${token}` } : {};

          if (block.name === "search_courts") {
            const params = new URLSearchParams(block.input as Record<string, string>);
            const res = await fetch(`${backendUrl}/courts/search?${params}`, { headers });
            result = await res.json();
          } else if (block.name === "get_my_bookings") {
            const res = await fetch(`${backendUrl}/bookings/future`, { headers });
            result = await res.json();
          } else if (block.name === "get_my_tickets") {
            const input = block.input as { club_id?: number; include_all?: boolean };
            const params = new URLSearchParams();
            if (input.club_id) params.set("club_id", String(input.club_id));
            if (input.include_all) params.set("include_all", "true");
            const res = await fetch(`${backendUrl}/tickets/my?${params}`, { headers });
            result = await res.json();
          }
        } catch {
          result = { error: "Failed to execute action" };
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
    }

    // Continue conversation with tool results
    const followUp = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system,
      tools,
      messages: [
        ...history,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ],
    });

    return NextResponse.json({ content: followUp.content });
  }

  return NextResponse.json({ content: response.content });
}
