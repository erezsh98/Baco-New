import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "cancel_booking",
    description: "Cancel a future booking by order ID",
    input_schema: {
      type: "object" as const,
      properties: {
        order_id: { type: "number", description: "The booking order ID" },
      },
      required: ["order_id"],
    },
  },
];

export async function POST(req: NextRequest) {
  const { messages, token } = await req.json();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `אתה עוזר חכם לאתר TennisLine - מערכת הזמנת מגרשי טניס.
עזור למשתמשים למצוא ולהזמין מגרשי טניס, לצפות בהזמנות שלהם ולבטל הזמנות.
ענה תמיד בעברית. היה קצר וברור.`,
    tools,
    messages,
  });

  // Handle tool calls by forwarding to backend API
  if (response.stop_reason === "tool_use") {
    const toolResults = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        let result = {};
        try {
          const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
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
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `אתה עוזר חכם לאתר TennisLine. ענה תמיד בעברית.`,
      tools,
      messages: [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ],
    });

    return NextResponse.json({ content: followUp.content });
  }

  return NextResponse.json({ content: response.content });
}
