import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
    name: "cancel_booking",
    description: "Cancel a future booking by order ID",
    input_schema: {
      type: "object" as const,
      properties: { order_id: { type: "number", description: "The booking order ID" } },
      required: ["order_id"],
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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: `אתה עוזר חכם לאתר TennisLine - מערכת הזמנת מגרשי טניס.
עזור למשתמשים למצוא ולהזמין מגרשי טניס, לצפות בהזמנות שלהם ולבטל הזמנות.
ענה תמיד בעברית. היה קצר וברור.`,
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
          } else if (block.name === "cancel_booking") {
            const input = block.input as { order_id: number };
            const res = await fetch(`${backendUrl}/bookings/${input.order_id}`, {
              method: "DELETE",
              headers,
            });
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
      system: `אתה עוזר חכם לאתר TennisLine. ענה תמיד בעברית.`,
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
