// ============================================================
// Route Handler - Phân tích AI bằng OpenRouter
// File: app/api/analyze/route.ts
// Dùng model miễn phí của OpenRouter - không cần thẻ
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt } = await req.json();

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Thiếu OPENROUTER_API_KEY trong .env.local" },
        { status: 500 }
      );
    }

    // Kiểm tra có ảnh không để chọn model phù hợp
    const hasImage = messages.some((msg: any) => {
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some((c: any) =>
        c.type === "image_url" || c.type === "image"
      );
    });

    // Model miễn phí:
    // - Có ảnh → dùng Gemini Flash (Vision, tiếng Việt tốt nhất)
    // - Chỉ text → dùng Llama 3.3 70B (mạnh, nhanh)
    const model = "openrouter/free";

    // Chuyển đổi messages sang format OpenRouter
    const formattedMessages: any[] = [
      { role: "system", content: systemPrompt }
    ];

    for (const msg of messages) {
      // Content là string đơn giản
      if (typeof msg.content === "string") {
        formattedMessages.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Content là mảng (có ảnh)
      if (Array.isArray(msg.content)) {
        const parts: any[] = [];

        for (const c of msg.content) {
          if (c.type === "text") {
            parts.push({ type: "text", text: c.text || "" });
          }
          else if (c.type === "image_url") {
            parts.push({ type: "image_url", image_url: c.image_url });
          }
          else if (c.type === "image" && c.source) {
            // Format cũ → chuyển sang image_url
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:${c.source.media_type};base64,${c.source.data}`
              }
            });
          }
          else {
            parts.push({ type: "text", text: c.text || "" });
          }
        }

        // Nếu chỉ có 1 phần text → gửi string thẳng
        if (parts.length === 1 && parts[0].type === "text") {
          formattedMessages.push({ role: msg.role, content: parts[0].text });
        } else {
          formattedMessages.push({ role: msg.role, content: parts });
        }
        continue;
      }

      formattedMessages.push({ role: msg.role, content: String(msg.content) });
    }

    // Gọi OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://aceup.app",
        "X-Title": "AceUp Study Tool",
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        max_tokens: 4000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return NextResponse.json(
        { error: err.error?.message || "Lỗi từ OpenRouter API" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content;

    if (!result) {
      return NextResponse.json(
        { error: "Không nhận được kết quả. Vui lòng thử lại." },
        { status: 500 }
      );
    }

    return NextResponse.json({ result });

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Lỗi server" },
      { status: 500 }
    );
  }
}