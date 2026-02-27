// ============================================================
// Route Handler - Đọc nội dung file .docx bằng mammoth
// File: app/api/extract-docx/route.ts
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export async function POST(req: NextRequest) {
  try {
    // Nhận file dưới dạng FormData
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "Không tìm thấy file" },
        { status: 400 }
      );
    }

    // Chuyển file thành ArrayBuffer để mammoth đọc
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Dùng mammoth để trích xuất text từ .docx
    const result = await mammoth.extractRawText({ buffer });

    if (!result.value || result.value.trim() === "") {
      return NextResponse.json(
        { error: "File DOCX rỗng hoặc không đọc được nội dung" },
        { status: 400 }
      );
    }

    return NextResponse.json({ text: result.value });

  } catch (error: any) {
    return NextResponse.json(
      { error: "Lỗi đọc file DOCX: " + error.message },
      { status: 500 }
    );
  }
}