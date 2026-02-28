// ============================================================
// Route Handler - Groq API (text + Vision cho ảnh)
// File: app/api/analyze/route.ts
// Tự động thử model backup nếu model chính bị lỗi
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt } = await req.json();
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Thiếu GROQ_API_KEY trong .env.local" }, { status: 500 });
    }

    // Kiểm tra có ảnh không
    const hasImage = messages.some((msg: any) => {
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some((c: any) =>
        c.type === "image_url" || c.type === "image"
      );
    });

    // Danh sách model thử lần lượt
    const modelsToTry = hasImage
      ? [
          "meta-llama/llama-4-scout-17b-16e-instruct",
          "llama-3.2-11b-vision-preview",
          "llama-3.2-90b-vision-preview",
        ]
      : [
          "llama-3.3-70b-versatile",
          "llama-3.1-70b-versatile",
        ];

    // Chuyển đổi messages sang format Groq
    const groqMessages: any[] = [
      { role: "system", content: systemPrompt }
    ];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        groqMessages.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (Array.isArray(msg.content)) {
        const parts: any[] = [];

        for (const c of msg.content) {
          if (c.type === "text") {
            parts.push({ type: "text", text: c.text || "" });
          } else if (c.type === "image_url") {
            parts.push({ type: "image_url", image_url: c.image_url });
          } else if (c.type === "image" && c.source) {
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:${c.source.media_type};base64,${c.source.data}`
              }
            });
          } else {
            parts.push({ type: "text", text: c.text || "" });
          }
        }

        if (parts.length === 1 && parts[0].type === "text") {
          groqMessages.push({ role: msg.role, content: parts[0].text });
        } else {
          groqMessages.push({ role: msg.role, content: parts });
        }
        continue;
      }

      groqMessages.push({ role: msg.role, content: String(msg.content) });
    }

    // Thử từng model
    let lastError = "";

    for (const model of modelsToTry) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: groqMessages,
            max_tokens: 4000,
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          lastError = err.error?.message || `Model ${model} lỗi ${response.status}`;
          continue;
        }

        const data = await response.json();
        const result = data.choices?.[0]?.message?.content;
        if (result) return NextResponse.json({ result });
        lastError = "Không nhận được kết quả";

      } catch (e: any) {
        lastError = e.message;
        continue;
      }
    }

    return NextResponse.json(
      { error: lastError || "Tất cả model đều lỗi, thử lại sau!" },
      { status: 500 }
    );

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Lỗi server" },
      { status: 500 }
    );
  }
}