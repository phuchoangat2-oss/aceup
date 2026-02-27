"use client";
// ============================================================
// AceUp - Phiên bản hoàn chỉnh (tất cả lỗi đã được sửa)
// - PDF: đọc qua server API (không dùng thư viện ngoài)
// - DOCX: đọc qua server API (mammoth)
// - Ảnh: Groq Vision model tự động
// - Timeline fix: xử lý cả object lẫn string
// ============================================================

import { useState, useRef, useCallback, useEffect, ReactNode } from "react";
import {
  Upload, FileText, Image, Zap, BookOpen, Gamepad2, Trophy,
  Smile, Minimize2, Moon, Sun, Trash2, Clock,
  CheckSquare, Brain, Layers, Copy, X,
  AlertCircle, Loader2, ChevronDown, ChevronUp, Sparkles,
  GraduationCap, Target, BarChart3, PanelLeft
} from "lucide-react";

// ============================================================
// TYPES
// ============================================================
interface Persona {
  id: string;
  label: string;
  icon: ReactNode;
  desc: string;
  color: string;
  bg: string;
  border: string;
  prompt: string;
}
interface LengthOption { id: string; label: string; desc: string; icon: string; }
interface ModeOption { id: string; label: string; icon: ReactNode; }
interface FileData { type: "image" | "pdf" | "docx" | "text"; content: string; mediaType?: string; name: string; }
interface HistoryItem { id: number; name: string; persona: string; mode: string; result: string; timestamp: number; }
interface ExtractedInfo { formulas?: string[]; definitions?: string[]; timelines?: any[]; keywords?: string[]; }

// ============================================================
// CONSTANTS
// ============================================================
const PERSONAS: Persona[] = [
  {
    id: "traditional", label: "Hàn Lâm", icon: <GraduationCap size={16} />,
    desc: "Nghiêm túc, học thuật", color: "from-blue-500 to-blue-700",
    bg: "bg-blue-50 dark:bg-blue-950", border: "border-blue-300 dark:border-blue-700",
    prompt: "Hãy viết theo phong cách hàn lâm, nghiêm túc, chính xác và học thuật. Sử dụng ngôn ngữ chuyên ngành phù hợp."
  },
  {
    id: "gamer", label: "Gamer", icon: <Gamepad2 size={16} />,
    desc: "Level up kiến thức!", color: "from-purple-500 to-pink-600",
    bg: "bg-purple-50 dark:bg-purple-950", border: "border-purple-300 dark:border-purple-700",
    prompt: "Hãy viết theo phong cách game thủ. Dùng thuật ngữ game như: level up, boss, nerf, buff, combo, skill, EXP, quest, checkpoint, respawn, OP, grind, meta..."
  },
  {
    id: "athlete", label: "Vận Động Viên", icon: <Trophy size={16} />,
    desc: "Về đích với kiến thức", color: "from-orange-500 to-red-500",
    bg: "bg-orange-50 dark:bg-orange-950", border: "border-orange-300 dark:border-orange-700",
    prompt: "Hãy viết theo phong cách vận động viên thể thao. Dùng thuật ngữ: tăng tốc, về đích, chiến thuật, phòng thủ, tấn công, huấn luyện, sprint, warm-up, PB..."
  },
  {
    id: "genz", label: "Gen Z", icon: <Smile size={16} />,
    desc: "No cap, rất ez 💅", color: "from-pink-400 to-yellow-400",
    bg: "bg-pink-50 dark:bg-pink-950", border: "border-pink-300 dark:border-pink-700",
    prompt: "Hãy viết theo phong cách Gen Z - hài hước, ngắn gọn. Dùng: no cap, bussin, slay, vibe, lowkey, NGL, POV, understood the assignment, it's giving, rizz..."
  },
  {
    id: "minimal", label: "Tối Giản", icon: <Minimize2 size={16} />,
    desc: "Chỉ tinh túy", color: "from-gray-500 to-gray-700",
    bg: "bg-gray-50 dark:bg-gray-900", border: "border-gray-300 dark:border-gray-600",
    prompt: "Hãy viết cực kỳ súc tích, tối giản. Chỉ từ khóa, bullet points ngắn. Format: ký hiệu → nghĩa. Bỏ hết câu dẫn nhập và kết luận."
  }
];

const LENGTHS: LengthOption[] = [
  { id: "short", label: "Tóm Tắt", desc: "5-7 dòng", icon: "⚡" },
  { id: "medium", label: "Trung Bình", desc: "15-20 dòng", icon: "📖" },
  { id: "detailed", label: "Chi Tiết", desc: "Đầy đủ", icon: "🔬" }
];

const MODES: ModeOption[] = [
  { id: "normal", label: "Thường", icon: <BookOpen size={14} /> },
  { id: "catchup", label: "Catch-up 🔥", icon: <Zap size={14} /> }
];

// ============================================================
// UTILITIES
// ============================================================
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const formatDate = (ts: number) => new Date(ts).toLocaleString("vi-VN");

// Đọc DOCX qua server API
const extractDocxText = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/extract-docx", { method: "POST", body: formData });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Lỗi đọc DOCX"); }
  const data = await res.json();
  return data.text;
};

// Đọc PDF qua server API
// Xử lý PDF thông minh:
// 1. Thử đọc text trực tiếp từ server
// 2. Nếu không được (PDF scan) → chuyển thành base64 → Groq Vision OCR
const handlePdfFile = async (
  file: File,
  onFileLoad: (f: FileData) => void
): Promise<void> => {
  // Gửi file lên server → server tự xử lý:
  // - PDF có text → đọc text trực tiếp
  // - PDF scan    → OCR tự động qua OCR.space
  const formData = new FormData();
  formData.append("file", file);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 30s cho OCR

  try {
    const res = await fetch("/api/extract-pdf", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Không đọc được PDF");
    }

    if (data.text && data.text.length > 20) {
      // Thành công! Gửi text cho AI phân tích
      onFileLoad({
        type: "text",
        content: data.text,
        name: file.name
      });
    } else {
      throw new Error("PDF không có nội dung đọc được");
    }

  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === "AbortError") {
      alert("⏱️ OCR mất quá nhiều thời gian. File PDF có thể quá lớn. Hãy thử file nhỏ hơn!");
    } else {
      alert("❌ " + (e.message || "Lỗi đọc PDF"));
    }
  }
};

// Gọi API phân tích AI
const callAnalyzeAPI = async (messages: any[], systemPrompt: string): Promise<string> => {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, systemPrompt }),
  });
  if (!response.ok) { const err = await response.json(); throw new Error(err.error || "API Error"); }
  const data = await response.json();
  return data.result;
};

const buildPrompt = (persona: Persona, length: string, mode: string): string =>
  `Bạn là AceUp AI - trợ lý học tập thông minh cho học sinh Việt Nam ôn thi quốc gia.
Nhiệm vụ: Phân tích và tóm tắt tài liệu học thuật thành nội dung dễ hiểu, hấp dẫn.

Phong cách: ${persona.label}
${persona.prompt}

Quy tắc:
- Luôn trả lời bằng tiếng Việt
- Nhận diện và phân loại: 📐 Công thức, 📚 Định nghĩa, 📅 Mốc thời gian, 🔑 Từ khóa
- Dùng emoji phù hợp, format Markdown rõ ràng

${mode === "catchup" ? "CATCH-UP MODE 🚀:\n- Bắt đầu bằng ✅ CHECKLIST HỌC NHANH\n- Highlight ⭐ CHẮC CHẮN THI\n- Kết thúc bằng 💡 TIP ÔN THI\n" : ""}
Độ dài: ${length === "short" ? "5-7 dòng" : length === "medium" ? "15-20 dòng" : "Chi tiết đầy đủ"}

CẤU TRÚC BẮT BUỘC - Luôn phải có đủ 3 phần này dù ở chế độ nào:
## 📝 TÓM TẮT NHANH
(2-3 câu tóm gọn toàn bộ nội dung)

## 📚 NỘI DUNG CHÍNH
(Phân tích chi tiết theo phong cách và độ dài đã chọn)

## ⭐ ĐIỂM CẦN NHỚ
(3-5 bullet points quan trọng nhất)`;

// ============================================================
// SUB-COMPONENTS
// ============================================================
const Skeleton = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 rounded-lg ${className}`} />
);

const Badge = ({ children, color = "blue" }: { children: ReactNode; color?: string }) => {
  const colors: Record<string, string> = {
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    purple: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    green: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    orange: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.blue}`}>{children}</span>;
};

// ============================================================
// FILE UPLOAD COMPONENT
// ============================================================
const FileUpload = ({ onFileLoad, isLoading }: { onFileLoad: (f: FileData) => void; isLoading: boolean }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showText, setShowText] = useState(false);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    const type = file.type;
    setProcessing(true);

    try {
      if (type.startsWith("image/")) {
        // Ảnh → base64 → Groq Vision
        const b64 = await fileToBase64(file);
        onFileLoad({ type: "image", content: b64, mediaType: type, name: file.name });

      } else if (name.endsWith(".pdf")) {
        // PDF → thử đọc text, nếu không được thì dùng Groq Vision OCR
        await handlePdfFile(file, onFileLoad);
        return; // handlePdfFile đã gọi onFileLoad rồi

      } else if (name.endsWith(".docx")) {
        // DOCX → server API mammoth
        const text = await extractDocxText(file);
        onFileLoad({ type: "text", content: text, name: file.name });

      } else {
        // TXT, PPTX, các file text khác
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          onFileLoad({ type: "text", content, name: file.name });
        };
        reader.readAsText(file, "UTF-8");
      }
    } catch (e: any) {
      alert("❌ " + (e.message || "Lỗi đọc file"));
    } finally {
      setProcessing(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  return (
    <div className="space-y-3">
      {/* Vùng kéo thả */}
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !processing && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-300
          ${isDragging ? "border-violet-400 bg-violet-50 dark:bg-violet-950 scale-[1.02]" : "border-slate-200 dark:border-slate-700 hover:border-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/30"}
          ${processing ? "opacity-60 cursor-wait" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.pptx,.txt,.png,.jpg,.jpeg,.webp"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          disabled={isLoading || processing}
        />
        <div className="flex flex-col items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-violet-400 to-blue-500 shadow-lg transition-transform ${isDragging ? "scale-110 rotate-3" : ""}`}>
            {processing ? <Loader2 size={20} className="text-white animate-spin" /> : <Upload size={20} className="text-white" />}
          </div>
          <div>
            <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">
              {processing ? "Đang đọc file..." : "Kéo thả hoặc click để chọn"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">PDF • DOCX • TXT • JPG • PNG</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            {[{ icon: <FileText size={11} />, label: "PDF" }, { icon: <FileText size={11} />, label: "DOCX" }, { icon: <Image size={11} />, label: "Ảnh OCR" }]
              .map(({ icon, label }) => (
                <span key={label} className="flex items-center gap-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-lg text-slate-600 dark:text-slate-400">
                  {icon} {label}
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Dán text */}
      <button onClick={() => setShowText(!showText)} className="w-full text-sm text-violet-600 dark:text-violet-400 hover:underline flex items-center justify-center gap-1">
        {showText ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Hoặc dán văn bản trực tiếp
      </button>
      {showText && (
        <div className="space-y-2">
          <textarea value={textInput} onChange={(e) => setTextInput(e.target.value)}
            placeholder="Dán nội dung tài liệu vào đây..."
            className="w-full h-28 p-3 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" />
          <button
            onClick={() => { if (textInput.trim()) { onFileLoad({ type: "text", content: textInput, name: "Văn bản trực tiếp" }); setTextInput(""); setShowText(false); } }}
            disabled={!textInput.trim() || isLoading}
            className="w-full py-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Xử lý văn bản →
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================
// STYLE SELECTOR
// ============================================================
const StyleSelector = ({ selected, onChange }: { selected: Persona; onChange: (p: Persona) => void }) => (
  <div className="space-y-2">
    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
      <Brain size={12} /> Phong Cách Viết
    </label>
    {PERSONAS.map((p) => (
      <button key={p.id} onClick={() => onChange(p)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all duration-200
          ${selected.id === p.id ? `${p.bg} ${p.border} shadow-sm` : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800"}`}
      >
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center text-white flex-shrink-0`}>{p.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-slate-800 dark:text-slate-200">{p.label}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{p.desc}</div>
        </div>
        {selected.id === p.id && <div className="w-4 h-4 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex-shrink-0" />}
      </button>
    ))}
  </div>
);

// ============================================================
// SUMMARY DISPLAY
// ============================================================
const SummaryDisplay = ({ result, persona, mode }: { result: string; persona: Persona; mode: ModeOption }) => {
  const [copied, setCopied] = useState(false);

  const renderInline = (text: string): ReactNode[] =>
    text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-bold text-slate-900 dark:text-white">{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*")) return <em key={i} className="italic">{part.slice(1, -1)}</em>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="bg-violet-100 dark:bg-violet-900 text-violet-800 dark:text-violet-200 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
      return part;
    });

  const renderMarkdown = (text: string): ReactNode[] =>
    text.split("\n").map((line, i) => {
      if (line.startsWith("### ")) return <h3 key={i} className="text-base font-bold mt-4 mb-1 text-slate-800 dark:text-slate-100">{renderInline(line.slice(4))}</h3>;
      if (line.startsWith("## ")) return <h2 key={i} className="text-lg font-bold mt-5 mb-2 text-slate-900 dark:text-slate-50">{renderInline(line.slice(3))}</h2>;
      if (line.startsWith("# ")) return <h1 key={i} className="text-xl font-extrabold mt-5 mb-2 text-slate-900 dark:text-white">{renderInline(line.slice(2))}</h1>;
      if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="ml-4 mb-1 text-slate-700 dark:text-slate-300 list-disc list-inside text-sm">{renderInline(line.slice(2))}</li>;
      if (/^\d+\. /.test(line)) return <li key={i} className="ml-4 mb-1 text-slate-700 dark:text-slate-300 list-decimal list-inside text-sm">{renderInline(line.replace(/^\d+\. /, ""))}</li>;
      if (line === "---") return <hr key={i} className="my-3 border-slate-200 dark:border-slate-700" />;
      if (!line.trim()) return <div key={i} className="h-2" />;
      return <p key={i} className="text-sm text-slate-700 dark:text-slate-300 mb-1 leading-relaxed">{renderInline(line)}</p>;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${persona.color} flex items-center justify-center text-white`}>{persona.icon}</div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{persona.label}</span>
          {mode.id === "catchup" && <Badge color="orange">⚡ Catch-up</Badge>}
        </div>
        <button onClick={() => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-600 transition-colors px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
          {copied ? <><CheckSquare size={12} className="text-green-500" /> Đã copy!</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <div className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 p-5 min-h-32">
        {renderMarkdown(result)}
      </div>
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================
export default function AceUp() {
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentFile, setCurrentFile] = useState<FileData | null>(null);
  const [persona, setPersona] = useState<Persona>(PERSONAS[0]);
  const [length, setLength] = useState<LengthOption>(LENGTHS[0]);
  const [mode, setMode] = useState<ModeOption>(MODES[0]);
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedInfo, setExtractedInfo] = useState<ExtractedInfo | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("aceup_history") || "[]"); }
    catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem("aceup_history", JSON.stringify(history.slice(0, 20))); }
    catch {}
  }, [history]);

  const handleFileLoad = useCallback((fileData: FileData) => {
    setCurrentFile(fileData);
    setResult(null);
    setError(null);
    setExtractedInfo(null);
  }, []);

  // Phân loại thông tin tự động
  const extractInfo = async (text: string) => {
    try {
      const raw = await callAnalyzeAPI(
        [{ role: "user", content: `Phân tích:\n\n${text.slice(0, 2000)}` }],
        `Phân tích văn bản học thuật, trả về JSON thuần:
{"formulas":["chuỗi"],"definitions":["chuỗi"],"timelines":["chuỗi"],"keywords":["chuỗi"]}
Chỉ JSON, không markdown, không giải thích.`
      );
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setExtractedInfo(parsed);
    } catch {}
  };

  const handleAnalyze = async () => {
    if (!currentFile) return;
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const systemPrompt = buildPrompt(persona, length.id, mode.id);
      let messages: any[];

      if (currentFile.type === "image") {
        // Ảnh hoặc PDF scan → Groq Vision OCR
        const isPdf = currentFile.mediaType === "application/pdf";
        messages = [{
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${currentFile.mediaType || "image/jpeg"};base64,${currentFile.content}`
              }
            },
            {
              type: "text",
              text: isPdf
                ? `Đây là file PDF "${currentFile.name}". Hãy OCR toàn bộ nội dung, sau đó phân tích và tóm tắt theo phong cách ${persona.label}. Phân loại: 📐 Công thức, 📚 Định nghĩa, 📅 Mốc thời gian, 🔑 Từ khóa.`
                : `OCR và tóm tắt ảnh tài liệu này theo phong cách ${persona.label}. Phân loại: 📐 Công thức, 📚 Định nghĩa, 📅 Mốc, 🔑 Từ khóa.`
            }
          ]
        }];
      } else {
        // Text (từ PDF, DOCX, TXT)
        messages = [{
          role: "user",
          content: `Phân tích và tóm tắt tài liệu sau:\n\n---\n${currentFile.content.slice(0, 8000)}\n---\n\nPhân loại: 📐 Công thức, 📚 Định nghĩa, 📅 Mốc, 🔑 Từ khóa.`
        }];
        // Chạy song song phân loại tags
        extractInfo(currentFile.content);
      }

      const output = await callAnalyzeAPI(messages, systemPrompt);
      setResult(output);
      setHistory(prev => [{
        id: Date.now(), name: currentFile.name,
        persona: persona.id, mode: mode.id,
        result: output, timestamp: Date.now()
      }, ...prev.slice(0, 19)]);

    } catch (e: any) {
      setError(e.message || "Có lỗi xảy ra.");
    } finally {
      setIsLoading(false);
    }
  };

  // Helper chuyển any → string an toàn cho Badge
  const toStr = (val: any): string => {
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null)
      return val.description || val.start || val.label || JSON.stringify(val);
    return String(val);
  };

  return (
    <div className={darkMode ? "dark" : ""}>
      <div className="flex h-screen bg-gradient-to-br from-slate-50 via-violet-50/30 to-blue-50/20 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 overflow-hidden">

        {/* SIDEBAR */}
        <aside className={`${sidebarOpen ? "w-72" : "w-0"} flex-shrink-0 h-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200/60 dark:border-slate-700/60 flex flex-col overflow-hidden transition-all duration-300`}>
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {/* Logo */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg">
                  <Zap size={18} className="text-white" />
                </div>
                <div>
                  <h1 className="font-black text-lg text-slate-900 dark:text-white">AceUp</h1>
                  <p className="text-[10px] text-slate-400">AI Study Accelerator</p>
                </div>
              </div>
            </div>

            {/* Upload */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Upload size={11} /> Tải Tài Liệu
              </h2>
              <FileUpload onFileLoad={handleFileLoad} isLoading={isLoading} />
            </div>

            {/* File hiện tại */}
            {currentFile && (
              <div className="mx-4 my-3 p-3 rounded-xl bg-violet-50 dark:bg-violet-950 border border-violet-200 dark:border-violet-800">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-violet-500 flex items-center justify-center flex-shrink-0">
                    {currentFile.type === "image" ? <Image size={13} className="text-white" /> : <FileText size={13} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-violet-800 dark:text-violet-200 truncate">{currentFile.name}</p>
                    <p className="text-[10px] text-violet-500 capitalize">{currentFile.type}</p>
                  </div>
                  <button onClick={() => { setCurrentFile(null); setResult(null); }} className="text-violet-400 hover:text-violet-600"><X size={12} /></button>
                </div>
              </div>
            )}

            {/* Lịch sử */}
            {history.length > 0 && (
              <div className="p-4">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Clock size={11} /> Lịch Sử ({history.length})
                </h2>
                {history.slice(0, 8).map(item => (
                  <div key={item.id} className="group flex items-center gap-2 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center flex-shrink-0">
                      <FileText size={14} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0" onClick={() => {
                      setResult(item.result);
                      setPersona(PERSONAS.find(p => p.id === item.persona) || PERSONAS[0]);
                    }}>
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{item.name}</div>
                      <div className="text-[10px] text-slate-400">{formatDate(item.timestamp)}</div>
                    </div>
                    <button onClick={() => setHistory(prev => prev.filter(h => h.id !== item.id))}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900 text-slate-400 hover:text-red-500 transition-all">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button onClick={() => setHistory([])} className="mt-2 text-xs text-slate-400 hover:text-red-500 flex items-center gap-1">
                  <Trash2 size={10} /> Xóa tất cả
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <header className="h-14 flex items-center justify-between px-5 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-700/60 flex-shrink-0">
            <div className="flex items-center gap-3">
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors">
                <PanelLeft size={16} />
              </button>
              <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Sparkles size={14} className="text-violet-500" />
                <span>Học thông minh hơn với AI</span>
              </div>
            </div>
            <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors">
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto p-5 space-y-5">

              {/* Welcome */}
              {!currentFile && !result && (
                <div className="text-center py-16 space-y-4">
                  <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center shadow-2xl">
                    <GraduationCap size={36} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white">Chào mừng đến AceUp! 🚀</h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto text-sm">
                      Upload tài liệu (PDF, DOCX, ảnh...) và để AI biến chúng thành nội dung siêu dễ học.
                    </p>
                  </div>
                  <div className="flex justify-center gap-3 flex-wrap pt-2">
                    {["📚 Tóm tắt thông minh", "🎮 5 phong cách học", "⚡ Catch-up Mode", "🔍 OCR từ ảnh"].map(f => (
                      <span key={f} className="text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full text-slate-600 dark:text-slate-300 shadow-sm">{f}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Settings */}
              {currentFile && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1 bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-4">
                    <StyleSelector selected={persona} onChange={setPersona} />
                  </div>
                  <div className="md:col-span-2 space-y-4">
                    <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-4 space-y-4">
                      {/* Độ dài */}
                      <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <BarChart3 size={12} /> Độ Dài
                        </label>
                        <div className="flex gap-2">
                          {LENGTHS.map(l => (
                            <button key={l.id} onClick={() => setLength(l)}
                              className={`flex-1 py-2 px-2 rounded-xl text-xs font-medium border-2 transition-all text-center
                                ${length.id === l.id ? "border-violet-400 bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300" : "border-transparent bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                              <div className="text-base">{l.icon}</div>
                              <div>{l.label}</div>
                              <div className="text-[10px] opacity-60">{l.desc}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Chế độ */}
                      <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Target size={12} /> Chế Độ
                        </label>
                        <div className="flex gap-2">
                          {MODES.map(m => (
                            <button key={m.id} onClick={() => setMode(m)}
                              className={`flex-1 py-2 px-3 rounded-xl text-xs font-medium border-2 transition-all flex items-center justify-center gap-1.5
                                ${mode.id === m.id ? "border-orange-400 bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300" : "border-transparent bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                              {m.icon} {m.label}
                            </button>
                          ))}
                        </div>
                        {mode.id === "catchup" && (
                          <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-1.5 flex items-center gap-1">
                            <Zap size={10} /> Checklist nhanh + Highlight &quot;Chắc chắn thi&quot;
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Nút phân tích */}
                    <button onClick={handleAnalyze} disabled={isLoading || !currentFile}
                      className={`w-full py-4 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all duration-300 shadow-lg
                        ${isLoading ? "bg-slate-400 cursor-not-allowed" : "bg-gradient-to-r from-violet-500 to-blue-600 hover:from-violet-600 hover:to-blue-700 hover:scale-[1.01] active:scale-[0.99]"}`}>
                      {isLoading ? <><Loader2 size={16} className="animate-spin" /> Đang phân tích...</> : <><Sparkles size={16} /> Phân Tích với AI → {persona.label}</>}
                    </button>
                  </div>
                </div>
              )}

              {/* Loading Skeleton */}
              {isLoading && (
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-5 space-y-3">
                  <div className="flex items-center gap-2 mb-4">
                    <Loader2 size={16} className="animate-spin text-violet-500" />
                    <span className="text-sm text-violet-600 dark:text-violet-400 font-medium">AI đang xử lý tài liệu...</span>
                  </div>
                  {["w-full","w-5/6","w-full","w-3/4","w-full","w-4/5"].map((w, i) => <Skeleton key={i} className={`h-4 ${w}`} />)}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-start gap-3">
                  <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">Có lỗi xảy ra</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{error}</p>
                  </div>
                </div>
              )}

              {/* Extracted Tags */}
              {extractedInfo && !isLoading && (
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-4">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Layers size={11} /> Phân Loại Tự Động
                  </h3>
                  <div className="space-y-2">
                    {(extractedInfo.keywords?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-xs text-slate-500 w-full">🔑 Từ khóa:</span>
                        {extractedInfo.keywords!.slice(0, 8).map((k, i) => <Badge key={i} color="blue">{toStr(k)}</Badge>)}
                      </div>
                    )}
                    {(extractedInfo.formulas?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-xs text-slate-500 w-full">📐 Công thức:</span>
                        {extractedInfo.formulas!.slice(0, 4).map((f, i) => <Badge key={i} color="purple">{toStr(f)}</Badge>)}
                      </div>
                    )}
                    {(extractedInfo.timelines?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-xs text-slate-500 w-full">📅 Mốc:</span>
                        {extractedInfo.timelines!.slice(0, 4).map((t, i) => <Badge key={i} color="green">{toStr(t)}</Badge>)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Result */}
              {result && !isLoading && (
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-5">
                  <SummaryDisplay result={result} persona={persona} mode={mode} />
                </div>
              )}

              <div className="h-6" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}