// ============================================================
// Route Handler - Đọc PDF bằng OpenRouter Native PDF Support
// File: app/api/extract-pdf/route.ts
//
// OpenRouter tự xử lý PDF thông minh:
// - PDF có text → trích xuất text trực tiếp
// - PDF scan   → OCR tự động
// Model: google/gemma-3-27b-it:free (miễn phí, 140+ ngôn ngữ, Vision)
// ============================================================

import { NextRequest, NextResponse } from "next/server";

// ── Đọc text trực tiếp từ PDF binary (nhanh, không tốn API) ──
function extractTextDirect(buffer: Buffer): string {
  const content = buffer.toString("latin1");
  const parts: string[] = [];

  const blocks = content.match(/BT[\s\S]{0,2000}?ET/g) || [];
  for (const block of blocks) {
    const matches = block.match(/\(([^)\\]{1,200})\)\s*T[jJ]/g) || [];
    for (const m of matches) {
      const txt = m.slice(1, m.lastIndexOf(")"))
        .replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/\\t/g, " ")
        .replace(/\\\\/g, "\\").replace(/\\\(/g, "(").replace(/\\\)/g, ")")
        .replace(/[^\x20-\x7E\u00C0-\u024F]/g, " ")
        .replace(/\s+/g, " ").trim();
      if (txt.length > 1) parts.push(txt);
    }
    const arrays = block.match(/\[([^\]]{0,500})\]\s*TJ/g) || [];
    for (const arr of arrays) {
      const strings = arr.match(/\(([^)\\]{0,100})\)/g) || [];
      for (const s of strings) {
        const txt = s.slice(1, -1).replace(/[^\x20-\x7E]/g, " ").trim();
        if (txt.length > 1) parts.push(txt);
      }
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ── OCR bằng OpenRouter với PDF native support ──────────────
async function ocrWithOpenRouter(buffer: Buffer): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Thiếu OPENROUTER_API_KEY trong .env.local");

  const base64 = buffer.toString("base64");

  // Danh sách model Vision miễn phí đang hoạt động (Feb 2026)
  // Thử lần lượt nếu model trước lỗi
  const models = [
    "google/gemma-3-27b-it:free",              // Gemma 3 - miễn phí, 140+ ngôn ngữ
    "google/gemma-3-12b-it:free",              // Gemma 3 nhỏ hơn - backup
    "meta-llama/llama-3.2-11b-vision-instruct:free", // Llama Vision - backup 2
    "moonshotai/kimi-vl-a3b-thinking:free",    // Kimi VL - backup 3
  ];

  let lastError = "";

  for (const model of models) {
    try {
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
          max_tokens: 4000,
          messages: [
            {
              role: "user",
              content: [
                {
                  // Dùng format "file" của OpenRouter thay vì "image_url"
                  // OpenRouter tự xử lý PDF, trích xuất text tự động
                  type: "file",
                  file: {
                    filename: "document.pdf",
                    file_data: `data:application/pdf;base64,${base64}`,
                  },
                },
                {
                  type: "text",
                  text: "Đây là tài liệu học tập. Hãy OCR và trích xuất TOÀN BỘ nội dung text trong tài liệu này. Giữ nguyên cấu trúc, đoạn văn, tiêu đề. Chỉ trả về nội dung text, không thêm giải thích.",
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        lastError = err.error?.message || `Model ${model} lỗi ${response.status}`;
        console.log(`Model ${model} lỗi:`, lastError);
        continue;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content?.trim();

      if (text && text.length > 20) {
        return text;
      }

      lastError = `Model ${model} trả về nội dung rỗng`;

    } catch (e: any) {
      lastError = e.message;
      continue;
    }
  }

  throw new Error("Không OCR được: " + lastError);
}

// ── Main Route Handler ─────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "Không tìm thấy file" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Kiểm tra định dạng PDF
    if (!buffer.slice(0, 4).toString().startsWith("%PDF")) {
      return NextResponse.json({ error: "File không phải PDF hợp lệ" }, { status: 400 });
    }

    // ── Bước 1: Thử đọc text trực tiếp (tức thì, miễn phí) ──
    const directText = extractTextDirect(buffer);
    if (directText.length > 80) {
      return NextResponse.json({ text: directText, method: "direct" });
    }

    // ── Bước 2: PDF scan → OpenRouter OCR ──
    try {
      const ocrText = await ocrWithOpenRouter(buffer);
      if (ocrText.length > 20) {
        return NextResponse.json({ text: ocrText, method: "openrouter_ocr" });
      }
      return NextResponse.json({
        error: "Không nhận ra được chữ trong PDF này."
      }, { status: 400 });

    } catch (ocrError: any) {
      return NextResponse.json({ error: ocrError.message }, { status: 400 });
    }

  } catch (error: any) {
    return NextResponse.json({ error: "Lỗi server: " + error.message }, { status: 500 });
  }
}